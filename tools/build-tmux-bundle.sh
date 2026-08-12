#!/bin/bash
# Build a RELOCATABLE tmux that runs on a Mac with no Homebrew.
#
# ⚠️ WHY THIS EXISTS, AND WHY IT IS NOT A STATIC BUILD.
#
# macOS does not ship tmux. `/usr/bin/tmux` does not exist, measured. And the
# board is built from `tmux list-panes`, so tmux is not a nice-to-have that can
# degrade into a warning: without it there is no product. That makes shipping
# tmux the single hardest part of a one-command install.
#
# The plan assumed this meant a static build plus Apple signing and
# notarisation, and costed it as the most expensive option. Both halves turned
# out to be wrong:
#
#   1. NOTARISATION IS NOT REQUIRED for our delivery shape. Measured: an
#      ad-hoc-signed binary with no Apple developer identity runs fine from a
#      home folder, and still runs when carrying the quarantine attribute a
#      browser download sets. Gatekeeper's notarisation check applies to apps
#      being LAUNCHED, not to a command-line binary a script executes.
#
#   2. A STATIC BUILD IS NOT REQUIRED EITHER. tmux links against exactly three
#      non-system libraries (utf8proc, ncursesw, libevent_core). Everything else
#      it needs is in /usr/lib, which is on every Mac. So the binary and those
#      three dylibs can simply be copied and their load paths rewritten to
#      `@executable_path`, which is what this script does. No compiler, no
#      autotools, no build dependencies. The result is ~1.8MB.
#
# ⚠️ THE TWO STRINGS THAT SURVIVE, and why only one of them matters.
# After rewriting, `strings` still finds two /opt/homebrew paths. Neither is a
# link path (`otool -L` is clean), so neither affects loading:
#
#   tmux     /opt/homebrew/etc/tmux.conf:~/.tmux.conf:...
#            The config search path. That file will not exist on a clean Mac and
#            tmux falls through to the user's own paths. Harmless.
#
#   ncurses  /opt/homebrew/Cellar/ncurses/<v>/share/terminfo
#            ⚠️ THIS ONE COULD BITE. It is the compiled-in terminfo directory,
#            and it will not exist on a clean Mac. macOS does ship
#            /usr/share/terminfo (verified: xterm-256color is present), and
#            ncurses is expected to fall back to it, BUT that fallback is an
#            assumption rather than something measured here.
#
#            So we do not rely on it: the installer pins TERMINFO_DIRS to the
#            system location. That converts an unknown into a known, which is
#            cheaper than testing the unknown on every macOS version.
#
# Usage:  tools/build-tmux-bundle.sh [output-dir]
# Output: <out>/bin/tmux and <out>/lib/*.dylib, ad-hoc signed, relocatable.

set -euo pipefail

OUT="${1:-dist/tmux-bundle}"
SRC_TMUX="${TMUX_SOURCE:-$(command -v tmux || true)}"

if [ -z "$SRC_TMUX" ] || [ ! -x "$SRC_TMUX" ]; then
  echo "error: no tmux to bundle. Install one (brew install tmux) or set TMUX_SOURCE." >&2
  exit 1
fi

echo "==> bundling $("$SRC_TMUX" -V) from $SRC_TMUX"
rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/lib"
cp "$SRC_TMUX" "$OUT/bin/tmux"
chmod u+w "$OUT/bin/tmux"

# ⚠️ RECURSIVE. A bundled dylib can itself depend on another non-system dylib,
# and a one-level copy produces a bundle that works on THIS machine (where the
# missing one is still in /opt/homebrew) and fails on a clean one. That is the
# whole class of bug this script exists to avoid, so it must not be introduced
# by the script itself.
# ⚠️ `deps_of` EXISTS BECAUSE `set -o pipefail` MADE AN EMPTY RESULT FATAL.
# The first version piped straight into `while read`, and a library with NO
# non-system dependencies (libutf8proc is one) makes `grep` exit 1, which under
# `pipefail` + `set -e` killed the script MID-LOOP.
#
# It failed in the worst possible way: the load paths had already been rewritten,
# so the bundle looked finished and correct, but the script died before the
# re-signing step. The result was a plausible bundle with an INVALID SIGNATURE,
# which macOS refuses to execute on arm64. Caught by running it and checking the
# artifact, not by reading the script.
#
# `|| true` makes "no dependencies" the ordinary answer it always was.
deps_of() {
  otool -L "$1" 2>/dev/null | tail -n +2 | awk '{print $1}' \
    | grep -vE '^/usr/lib|^/System|^@' || true
}

collect() {
  local file="$1" dep base real
  for dep in $(deps_of "$file"); do
    base="$(basename "$dep")"
    [ -f "$OUT/lib/$base" ] && continue
    real="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$dep")"
    [ -f "$real" ] || { echo "    warn: cannot resolve $dep" >&2; continue; }
    cp "$real" "$OUT/lib/$base"
    chmod u+w "$OUT/lib/$base"
    echo "    + $base"
    collect "$OUT/lib/$base"
  done
}
echo "==> collecting non-system dependencies"
collect "$OUT/bin/tmux"

repoint() {
  local file="$1" prefix="$2" dep
  for dep in $(deps_of "$file"); do
    install_name_tool -change "$dep" "$prefix/$(basename "$dep")" "$file" 2>/dev/null
  done
}
echo "==> rewriting load paths"
repoint "$OUT/bin/tmux" "@executable_path/../lib"
for lib in "$OUT"/lib/*.dylib; do
  install_name_tool -id "@loader_path/$(basename "$lib")" "$lib"
  repoint "$lib" "@loader_path"
done

# ⚠️ MANDATORY on arm64. install_name_tool invalidates the signature, and macOS
# refuses to execute an arm64 binary with a broken one. Ad-hoc (`-s -`) needs no
# Apple identity and no notarisation; see the header.
echo "==> ad-hoc signing"
codesign -f -s - "$OUT"/lib/*.dylib "$OUT/bin/tmux" 2>&1 | sed 's/^/    /'

echo "==> verifying"
if otool -L "$OUT/bin/tmux" | tail -n +2 | awk '{print $1}' | grep -qE '^/opt/|^/usr/local/'; then
  echo "FAIL: a Homebrew load path survived. This bundle would break on a clean Mac." >&2
  otool -L "$OUT/bin/tmux" >&2
  exit 1
fi
# ⚠️ VERIFY THE SIGNATURE EXPLICITLY. This is the step that was silently skipped
# when the script died early, and an unsigned arm64 binary will not execute at
# all. Checking it here turns that failure from "mysterious crash on a stranger's
# Mac" into "the build refused to finish".
for f in "$OUT/bin/tmux" "$OUT"/lib/*.dylib; do
  codesign -v "$f" 2>/dev/null || { echo "FAIL: invalid signature on $f" >&2; exit 1; }
done
echo "    signatures valid on tmux and $(ls "$OUT"/lib/*.dylib | wc -l | tr -d ' ') dylibs"
echo "==> ok: $(du -sh "$OUT" | cut -f1) at $OUT"
echo "    load paths:"
otool -L "$OUT/bin/tmux" | tail -n +2 | sed 's/^/      /'
