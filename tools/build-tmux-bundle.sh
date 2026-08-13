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
# Usage:  tools/build-tmux-bundle.sh [output-dir]        (default: dist)
# Output: <out>/tmux-bundle/{bin,lib,VERSION,THIRD-PARTY-NOTICES.txt} and
#         <out>/tmux-<arch>.tar.gz (+ .sha256), ad-hoc signed, relocatable.

set -euo pipefail
# ⚠️ nullglob: with no dylibs collected (a differently-linked source build),
# every `lib/*.dylib` loop and argument list must become empty, not the
# literal string `lib/*.dylib` handed to install_name_tool and codesign.
shopt -s nullglob

# ⚠️ Same argument shape as build-kosmos-bundle.sh: $1 is the OUTPUT dir;
# the staged bundle lands in a subdirectory and the tarball beside it. The
# old shape ($1 = the bundle dir, tarball in its PARENT) wrote artifacts one
# level above where the caller pointed.
OUTDIR="${1:-dist}"
OUT="$OUTDIR/tmux-bundle"
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
# Resolve a path through any chain of symlinks with nothing but cd/pwd and
# readlink: Homebrew's dylibs are links into the Cellar, and the copy must
# take the real file. python3 did this in one line and was also the one
# build dependency the header claims not to have -- on a Mac without the
# developer tools, merely invoking it pops the install dialog.
resolve_file() {
  local f="$1" d
  while [ -L "$f" ]; do
    d="$(cd "$(dirname "$f")" && pwd -P)"
    f="$(readlink "$f")"
    case "$f" in /*) ;; *) f="$d/$f" ;; esac
  done
  printf '%s/%s' "$(cd "$(dirname "$f")" && pwd -P)" "$(basename "$f")"
}

deps_of() {
  otool -L "$1" 2>/dev/null | tail -n +2 | awk '{print $1}' \
    | grep -vE '^/usr/lib|^/System|^@' || true
}

collect() {
  local file="$1" dep base real
  for dep in $(deps_of "$file"); do
    base="$(basename "$dep")"
    [ -f "$OUT/lib/$base" ] && continue
    real="$(resolve_file "$dep")"
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
  install_name_tool -id "@loader_path/$(basename "$lib")" "$lib" 2>/dev/null
  repoint "$lib" "@loader_path"
done

# ⚠️ MANDATORY on arm64. install_name_tool invalidates the signature, and macOS
# refuses to execute an arm64 binary with a broken one. Ad-hoc (`-s -`) needs no
# Apple identity and no notarisation; see the header.
echo "==> ad-hoc signing"
codesign -f -s - "$OUT"/lib/*.dylib "$OUT/bin/tmux" 2>&1 | sed 's/^/    /'

echo "==> verifying"
# ⚠️ THE FINISHED BINARY MUST RUN. codesign -v checks the signature, not
# that the relocated dylibs load; this file's own history is a plausible
# bundle that would not execute, caught only by running it. The VERSION
# heredoc's `|| echo unknown` must never be the only execution test.
"$OUT/bin/tmux" -V >/dev/null 2>&1 || {
  echo "FAIL: the finished tmux does not run after relocation and re-signing." >&2
  exit 1
}
# ⚠️ EVERY binary in the bundle, not only tmux: collect() is recursive
# precisely because a bundled dylib can depend on another non-system one,
# and repoint() silences install_name_tool, so a dylib that kept a Homebrew
# load path would otherwise pass this build and break on a clean Mac.
# ⚠️ @rpath dependencies fail too: deps_of deliberately skips @-prefixed
# entries (they are what repoint WRITES), which means an @rpath dependency
# was never collected or rewritten -- it resolves through LC_RPATH into the
# build machine's filesystem and breaks on a clean Mac just as surely as a
# literal /opt path. So does a surviving LC_RPATH itself.
for f in "$OUT/bin/tmux" "$OUT"/lib/*.dylib; do
  # ⚠️ An ALLOWLIST: this loop is the backstop for the case collect/repoint
  # did NOT handle, and a denylist of the prefixes we already know about
  # (/opt, /usr/local, @rpath) cannot catch the one that surprises us
  # (/nix/store, a custom-prefix Homebrew). Anything that is not a system
  # library or one of our own rewritten references fails.
  if otool -L "$f" | tail -n +2 | awk '{print $1}' \
      | grep -vE '^/usr/lib/|^/System/|^@executable_path/|^@loader_path/' | grep -q .; then
    echo "FAIL: an unresolved load path survived in $(basename "$f"). This bundle would break on a clean Mac." >&2
    otool -L "$f" >&2
    exit 1
  fi
  if otool -l "$f" | grep -q LC_RPATH; then
    echo "FAIL: $(basename "$f") carries an LC_RPATH into the build machine's filesystem." >&2
    exit 1
  fi
done
# ⚠️ VERIFY THE SIGNATURE EXPLICITLY. This is the step that was silently skipped
# when the script died early, and an unsigned arm64 binary will not execute at
# all. Checking it here turns that failure from "mysterious crash on a stranger's
# Mac" into "the build refused to finish".
for f in "$OUT/bin/tmux" "$OUT"/lib/*.dylib; do
  codesign -v "$f" 2>/dev/null || { echo "FAIL: invalid signature on $f" >&2; exit 1; }
done
_dylibs=("$OUT"/lib/*.dylib)
echo "    signatures valid on tmux and ${#_dylibs[@]} dylibs"
echo "==> ok: $(du -sh "$OUT" | cut -f1) at $OUT"
echo "    load paths:"
otool -L "$OUT/bin/tmux" | tail -n +2 | sed 's/^/      /'

# ---- the deployment floor, gated ---------------------------------------------
# ⚠️ A binary copied off a build machine inherits that machine's OS as its
# minimum: this exact bundle, built from this Mac's Homebrew tmux, stamps
# minos 26.0 (measured with otool) and dyld would load it on NOTHING older,
# while the installer promises macOS 13.5. The floor is read out of every
# artifact and compared, so the promise and the binaries cannot drift apart
# silently. Until a tmux built against the floor SDK is sourced, a release
# build of this bundle FAILS here on purpose; KOSMOS_ALLOW_MINOS=1 permits
# a LOCAL TEST BUILD only.
FLOOR="$(cat "$(dirname "$0")/macos-floor")"
case "$FLOOR" in
  [0-9]*.[0-9]|[0-9]*.[0-9][0-9]) ;;
  *) echo "FAIL: tools/macos-floor must be MAJOR.MINOR (got '$FLOOR')" >&2; exit 1 ;;
esac
FLOOR_MAJOR="${FLOOR%%.*}"; FLOOR_MINOR="${FLOOR#*.}"
for f in "$OUT/bin/tmux" "$OUT"/lib/*.dylib; do
  minos="$(otool -l "$f" 2>/dev/null | awk '/LC_BUILD_VERSION/{v=1} v && /minos/{print $2; exit}')"
  [ -n "$minos" ] || minos="$(otool -l "$f" 2>/dev/null | awk '/LC_VERSION_MIN_MACOSX/{v=1} v && /version/{print $2; exit}')"
  # ⚠️ CANNOT-READ REFUSES. A gate that passes what it cannot see is the
  # green-on-blind failure shape this repo's README bans; both load-command
  # spellings are parsed above, so an empty result means something new.
  if [ -z "$minos" ]; then
    if [ -n "${KOSMOS_ALLOW_MINOS:-}" ]; then
      echo "    WARN: cannot read a deployment target from $(basename "$f") (allowed: TEST BUILD)"
      continue
    fi
    echo "FAIL: cannot read a deployment target from $(basename "$f"); refusing to certify the floor." >&2
    exit 1
  fi
  major="${minos%%.*}"; minor="${minos#*.}"; minor="${minor%%.*}"
  if [ "$major" -gt "$FLOOR_MAJOR" ] || { [ "$major" -eq "$FLOOR_MAJOR" ] && [ "$minor" -gt "$FLOOR_MINOR" ]; }; then
    if [ -n "${KOSMOS_ALLOW_MINOS:-}" ]; then
      echo "    WARN: $(basename "$f") needs macOS $minos > floor $FLOOR_MAJOR.$FLOOR_MINOR (allowed: TEST BUILD)"
    else
      echo "FAIL: $(basename "$f") requires macOS $minos, above the installer's $FLOOR_MAJOR.$FLOOR_MINOR floor." >&2
      echo "      Source binaries built for the floor (see the header), or KOSMOS_ALLOW_MINOS=1 for a local test build." >&2
      exit 1
    fi
  fi
done

# ---- what shipped, recorded ---------------------------------------------------
# The Node half of a release is pinned and checksummed; the tmux half must at
# least RECORD what a user got, or no report is ever traceable to a binary.
{
  echo "tmux:   $("$OUT/bin/tmux" -V 2>/dev/null || echo unknown)"
  echo "source: $SRC_TMUX"
  echo "built:  $(date -u +%Y-%m-%dT%H:%M:%SZ) on macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"
} > "$OUT/VERSION"

# ---- third-party notices -------------------------------------------------------
# The tarball redistributes tmux, ncurses, libevent and utf8proc binaries;
# all four licences require their notices to travel with the binaries.
NOTICES="$(dirname "$0")/third-party-notices.txt"
if [ ! -f "$NOTICES" ]; then
  echo "FAIL: $NOTICES is missing; the bundle may not ship binaries without their licence notices." >&2
  exit 1
fi
cp "$NOTICES" "$OUT/THIRD-PARTY-NOTICES.txt"

# ---- the tarball the installer downloads, and its checksum -------------------
# ⚠️ The .sha256 is not decoration: install/setup.sh REFUSES a download whose
# checksum file is missing or mismatched, so publishing the tarball without
# this file next to it bricks the install on purpose.
ARCH="$(uname -m)"
TARBALL="$OUTDIR/tmux-$ARCH.tar.gz"
tar -czf "$TARBALL" -C "$OUT" bin lib VERSION THIRD-PARTY-NOTICES.txt
( cd "$(dirname "$TARBALL")" && shasum -a 256 "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" )
echo "==> packed: $(du -sh "$TARBALL" | cut -f1) at $TARBALL (+ .sha256)"
