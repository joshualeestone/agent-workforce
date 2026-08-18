#!/bin/sh
# Kosmos installer. One line, no sudo, no password. Everything lives in your
# home folder except: the app icon, which goes to /Applications when this
# user can write there without a password (macOS admin accounts can), and
# into the Applications folder inside your home folder otherwise; the
# icon's one-line registration with macOS (so Spotlight knows it exists);
# and, on --uninstall, the launchd bookkeeping that removes agents'
# background jobs. In
# /Applications it only ever replaces a Kosmos icon it can prove it created
# itself (by the icon's own contents); its write check creates and removes
# one empty hidden folder there; and the icon is assembled in a hidden
# .Kosmos.app.stage.<pid> folder beside its spot and renamed into place,
# with the replaced icon renamed aside as .Kosmos.app.old.<pid> until the
# swap completes (an interrupted run can leave either hidden folder
# behind; --uninstall sweeps both when it can prove they are this
# install's own, and names anything it leaves). macOS may show its own one-time
# "Terminal wants to manage apps" dialog for the icon step. It never
# touches any other app. A fresh
# install that confirms its own board is running finishes by opening your
# browser at the Kosmos dashboard; updates never do, and KOSMOS_NO_OPEN=1
# turns it off.
#
# ⚠️ THE SHEBANG SAYS sh BECAUSE THE PAGE SAYS sh. This file's contract is
# the interpreter the marketing line actually invokes: macOS /bin/sh, which
# is bash 3.2 in POSIX mode (the Darwin gate below runs before anything
# non-POSIX, so a Linux dash never gets past the first sentence). `local`
# and `set -o pipefail` are safe under macOS sh specifically, and that is
# the only sh this file supports.
#
#   curl -fsSL https://installkosmos.com/setup | sh
#
# ⚠️ WHO THIS IS FOR, because it governs every decision below. The person running
# this has been handed a line to paste by someone they trust, in a room, and has
# possibly never opened Terminal before. They are not debugging. If something
# goes wrong they will not read a stack trace, they will conclude the product is
# broken and stop. So:
#
#   - EVERY step prints what it is doing BEFORE it does it. A silent install is
#     the documented disqualifying failure (launch decision, 2026-08-11: a
#     silent install disqualifies the product): a blank terminal
#     for several minutes reads as broken, and the person quits before it
#     finishes. Measured on a competitor the same week this was written: ten
#     minutes of no output at all while it downloaded a database.
#   - Every failure prints what to do next, in a sentence, not an error code.
#   - Nothing needs sudo. Nothing is written outside $HOME except: the app
#     icon (and the write probe that decides where it can go), which uses
#     /Applications only when this user can already write there without a
#     password; the icon's one-line registration with macOS
#     (LaunchServices, so Spotlight knows it exists); and, on --uninstall,
#     the launchd enable/bootout that removes agents' background jobs. The
#     header sentence above lists the same three exceptions; when one
#     list changes the other must, because this file is served verbatim at
#     https://installkosmos.com/setup and these sentences are what a cautious
#     person reads before piping it into sh.
#   - Running it twice is safe and says so.
#
# ⚠️ AND IT MUST BE REVERSIBLE. `--uninstall` genuinely returns the machine to
# before. That is not politeness: the first run on a never-touched Mac is the
# most valuable test this project will ever get, and it is worth exactly once
# unless we can put the machine back. One stated bound: anything the
# uninstall cannot PROVE this installer created is left alone and named,
# never deleted; on the rare machine where that leaves something behind,
# the sentence says what it is.

# ⚠️ THE macOS CHECK RUNS BEFORE ANY set OPTION. `set -o pipefail` is not
# POSIX; on a Linux dash the old order died with a raw shell error before
# reaching the friendly "Kosmos runs on macOS" sentence below.
case "$(uname -s)" in
  Darwin) ;;
  *) printf '\n  Kosmos runs on macOS. This looks like %s.\n\n' "$(uname -s)" >&2; exit 1 ;;
esac

set -euo pipefail

KOSMOS_HOME="${KOSMOS_HOME:-$HOME/.local/share/kosmos}"
# Slash-normalized, because install/kosmos self-derives ITS home from its
# own location and the two strings must compare equal: a trailing slash
# on $HOME (measured) made every ownership and board proof in this file
# use //-flavored paths the launcher never bakes.
KOSMOS_HOME="$(printf '%s' "$KOSMOS_HOME" | /usr/bin/tr -s '/')"
KOSMOS_HOME="${KOSMOS_HOME%/}"
# ⚠️ SHELL-SIGNIFICANT CHARACTERS IN KOSMOS_HOME ARE REFUSED OUTRIGHT.
# Two separate mechanisms make them catastrophic rather than awkward. A
# NEWLINE: the ownership checks below prove a bundle is ours with
# `grep -F` on a token built from this value, and grep -F treats a
# newline in the pattern as a pattern SEPARATOR -- the token degrades
# into two alternatives, one of which (`}"`) matches every launcher ever
# written, silently turning every ownership gate on every rm -rf
# fail-OPEN. A QUOTE, DOLLAR, BACKTICK or BACKSLASH: the value is baked
# into the generated .app launcher through an unquoted heredoc, so those
# write a launcher that is syntactically broken or that runs command
# substitution at CLICK time. Same posture as the KOSMOS_HOME=$HOME
# guard on the uninstall path: the catastrophic misuses of an override
# are refused in a sentence, not survived.
# The closing brace is refused for a THIRD mechanism: the launcher bakes
# the value inside ${KOSMOS_HOME:-<value>}, so a } in the value closes the
# expansion early and the launcher runs fine while resolving the WRONG
# home -- an icon that alerts "could not start" forever, reproduced in
# review with /tmp/ku}rt resolving to /tmp/kurt}.
# (--uninstall is refused too, deliberately: its own deletion gates
# depend on this same value, and running them against a poisoned one is
# worse than asking the user to fix it first.)
case "$KOSMOS_HOME" in
  /*) ;;
  *)
    printf '\n  KOSMOS_HOME must be an absolute path (a relative one would resolve against whatever folder the icon is opened from). Unset it and run again.\n\n' >&2
    exit 2
    ;;
esac
# Dot components are refused too: the ownership and board proofs compare
# this string EXACTLY against paths the launcher and the ps table carry,
# and /tmp/./k versus /tmp/k would fail every proof while both name the
# same folder.
case "$KOSMOS_HOME" in
  */.|*/..|*/./*|*/../*)
    printf '\n  KOSMOS_HOME must not contain . or .. path components. Unset it and run again.\n\n' >&2
    exit 2
    ;;
esac
case "$KOSMOS_HOME" in
  *"
"*|*'"'*|*'$'*|*'`'*|*'\'*|*'}'*)
    printf '\n  KOSMOS_HOME contains a character (newline, quote, dollar, backtick, backslash or }) that would defeat the safety checks below. Unset it (or fix the home folder it defaults from) and run again.\n\n' >&2
    exit 2
    ;;
esac
BIN_DIR="${KOSMOS_BIN_DIR:-$HOME/.local/bin}"
# ⚠️ Overridable for the same reason the sources are: the sandboxed test of
# this installer must not write an app icon into the real Applications
# folders of the machine it runs on. Everything this script writes goes
# under a root the test can point somewhere disposable. When the override is
# set it is used VERBATIM -- no probing, no fallback -- so a sandbox stays a
# sandbox.
#
# ⚠️ WITHOUT the override, the icon goes to /Applications when this user can
# write there without a password, and only otherwise to ~/Applications.
# Measured on the first real clean-machine run (2026-08-13): the icon went
# to ~/Applications, the tester opened Finder's Applications (which shows
# /Applications), and concluded it "did not put it in my applications". For
# this installer's audience, an app that is not where people look does not
# exist. macOS gives admin users group write on /Applications, so the common
# case needs no password; the probe is an actual mkdir, not `-w`, because
# ACLs can make `-w` lie in both directions.
# ⚠️ THE ownership predicate, defined ONCE. Every rm -rf and every claim
# in this file is gated by this exact function; it was previously
# hand-assembled at a dozen sites in four different guard combinations,
# and every gap a review found was a site missing one guard the others
# had. It returns 0 only for a REAL directory bundle -- no symlink at
# the root, at Contents, at MacOS, or at the launcher leaf, because a
# link at any level would make the content check read a file the bundle
# does not own -- whose launcher carries this install's anchored token
# (`:-<home>}"`, closing brace and quote included, so prefix-related
# homes cannot cross-match). /usr/bin/grep by absolute path: this answer
# decides where rm -rf points, so it must not be answerable by whatever
# a user's PATH puts in front of grep (the same argument the write
# probe's /bin/mkdir records).
bundle_is_ours() {
  [ -d "$1" ] || return 1
  [ ! -L "$1" ] || return 1
  [ ! -L "$1/Contents" ] || return 1
  [ ! -L "$1/Contents/MacOS" ] || return 1
  [ ! -L "$1/Contents/MacOS/Kosmos" ] || return 1
  # A regular file, or no proof: a FIFO at the leaf would block the grep
  # forever (measured), and a hang with no sentence is the worst outcome
  # this file is written against. Same hardening class and cost as the
  # stage's bare mkdir.
  [ -f "$1/Contents/MacOS/Kosmos" ] || return 1
  /usr/bin/grep -qF ":-$KOSMOS_HOME}\"" "$1/Contents/MacOS/Kosmos" 2>/dev/null
}

# SYS_APP_DIR is overridable ONLY so the harness can drive the probe AND its
# fallback against disposable directories -- a fallback that can only run
# where the primary works is untested by construction, and the probe's
# failure leg is exactly the one a standard (non-admin) user will live on.
# Test-only by contract, and SYMMETRIC by obligation: an install driven
# with this override must be uninstalled with the same value, or the
# sweep looks at the real /Applications and the sandboxed icon is
# orphaned.
SYS_APP_DIR="${KOSMOS_SYS_APP_DIR:-/Applications}"
# ⚠️ APP_DIR IS RESOLVED LAZILY, by the install path only, right before the
# icon is written. Resolving it here would run the write probe on EVERY
# invocation -- --uninstall, the unrecognised-flag refusal, the platform
# refusals -- and a run that refuses to do anything must not mutate
# /Applications. Until resolve_app_dir runs, APP_DIR carries the override
# or the safe per-user default, which is all the uninstall path needs.
APP_DIR="${KOSMOS_APP_DIR:-$HOME/Applications}"
APP_OTHER_OWNER=no
APP_SKIP_ICON=no
APP_SKIP_REASON=""
APP_SYS_STALE=no
APP_SYS_FAILED=no
APP_HOME_FOREIGN=no
resolve_app_dir() {
  # The verbatim override is a sandbox: no probing, no fallback.
  [ -n "${KOSMOS_APP_DIR:-}" ] && { APP_DIR="$KOSMOS_APP_DIR"; return 0; }
  APP_DIR="$HOME/Applications"
  # ⚠️ NEVER CLAIM A BUNDLE THIS INSTALL CANNOT PROVE IS ITS OWN. The
  # launcher bakes the installing user's KOSMOS_HOME as its default, so on
  # a Mac with two admin accounts, replacing the shared /Applications icon
  # would break the other account's working install, and every reinstall
  # would clobber the icon back and forth between them.
  #
  # ⚠️ POSITIVE PROOF, NOT ABSENCE OF DISPROOF. make_app begins with rm -rf
  # on its target, so claiming the path IS the destructive act. If ANYTHING
  # sits at the system path, it is claimed only on evidence: the launcher
  # line naming this KOSMOS_HOME, matched WITH its closing token
  # (`:-<home>}"`) so two homes in a prefix relationship cannot
  # cross-match. Everything else -- a third-party app that happens to be
  # named Kosmos, a half-written bundle, an unreadable launcher, a
  # different executable name -- diverts to the per-user folder, and the
  # icon step says so. (The first version keyed on the launcher FILE
  # existing, which made the install fail destructive exactly where the
  # uninstall below fails safe: a stranger's app was rm -rf'd while the
  # transcript printed success.)
  # -e OR -L, like every occupancy gate in this file: a symlink entry whose
  # target cannot be stat'd (dangling, or pointing into another user's
  # mode-700 home) fails -e alone, and the probe would then claim the slot
  # and rm -rf the link -- install failing destructive on exactly the
  # multi-account shape the uninstall below refuses. Measured in review.
  # A LINK ENTRY IS NEVER OURS: this installer never creates links, and
  # grep would follow one onto whatever it points at, claiming a user's
  # link to our own bundle and silently deleting it. Linkness decides
  # first; only a real directory earns the content check.
  if { [ -e "$SYS_APP_DIR/Kosmos.app" ] || [ -L "$SYS_APP_DIR/Kosmos.app" ]; } \
     && ! bundle_is_ours "$SYS_APP_DIR/Kosmos.app"; then
    APP_OTHER_OWNER=yes
    # ⚠️ THE DIVERT ITSELF NEEDS THE ALIASING GUARD. "Send the icon to the
    # per-user folder instead" is only an escape if the per-user folder is
    # a DIFFERENT folder: with ~/Applications symlinked to the system one,
    # writing "to the home folder" resolves straight back onto the foreign
    # bundle this branch just refused to claim, and make_app's opening
    # rm -rf would destroy it under a sentence saying it was left alone.
    # Same physical folder, or existing-but-unresolvable: no icon at all,
    # said honestly, fail closed. A home Applications folder that does not
    # exist yet cannot alias anything, so the divert proceeds and creates
    # it.
    if [ -e "$HOME/Applications" ] || [ -L "$HOME/Applications" ]; then
      _home_apps_phys="$(cd "$HOME/Applications" 2>/dev/null && pwd -P)" || _home_apps_phys=""
      _sys_apps_phys="$(cd "$SYS_APP_DIR" 2>/dev/null && pwd -P)" || _sys_apps_phys=""
      # The two skip reasons get distinct sentences: "same folder" was
      # OBSERVED only on the equal-paths leg; the unresolvable legs know
      # merely that the folder could not be checked, and the sentence must
      # not claim more than that.
      if [ -n "$_home_apps_phys" ] && [ -n "$_sys_apps_phys" ]; then
        [ "$_home_apps_phys" = "$_sys_apps_phys" ] && { APP_SKIP_ICON=yes; APP_SKIP_REASON=same; }
      else
        APP_SKIP_ICON=yes
        APP_SKIP_REASON=unknown
      fi
    fi
    return 0
  fi
  # Old probe residue is cleaned before probing (the rmdir below is
  # best-effort, so a bizarre failure could have left one), which keeps
  # litter from ever accumulating; -f makes an unmatched glob harmless.
  # (Two accounts installing at the same instant could sweep each other's
  # live probe and fail one install with an unexplained transcript;
  # bounded, rare, and accepted rather than complicated away.)
  rm -rf "$SYS_APP_DIR"/.kosmos-write-probe.* 2>/dev/null || true
  # /bin/mkdir and /bin/rmdir by absolute path: the probe's answer decides
  # where an rm -rf will later point, so it must not be answerable by
  # whatever a user's PATH puts in front of mkdir.
  if /bin/mkdir "$SYS_APP_DIR/.kosmos-write-probe.$$" 2>/dev/null; then
    /bin/rmdir "$SYS_APP_DIR/.kosmos-write-probe.$$" 2>/dev/null \
      || rm -rf "$SYS_APP_DIR/.kosmos-write-probe.$$" 2>/dev/null || true
    APP_DIR="$SYS_APP_DIR"
  elif bundle_is_ours "$SYS_APP_DIR/Kosmos.app"; then
    # The probe FAILED on a machine where an earlier run of this install
    # already put an icon in the system folder (admin rights since lost,
    # folder since locked). The fresh icon goes to the home folder, and
    # the now-unreachable system icon is NAMED, or the user ends up with
    # two Kosmos icons and a sentence describing one.
    APP_SYS_STALE=probe
  fi
  return 0
}
# The port everything below names. Overridable for the sandboxed installer
# test; the app icon and the closing sentences bake in whatever was installed.
PORT="${KOSMOS_PORT:-4317}"
# The port is baked into the same unquoted launcher heredoc the
# KOSMOS_HOME character guard protects, so it gets the same posture:
# anything but digits is refused in a sentence (reproduced in review: a
# crafted KOSMOS_PORT ran a command at click time). The '' arm is
# unreachable belt (the :- default already replaced an empty value).
# Length-bounded BEFORE any numeric compare: test(1) overflows on huge
# digit strings and fails OPEN with raw shell errors (measured), so the
# case refuses empties, non-digits, leading zeros (they would be baked
# verbatim into the launcher URL), and anything over five digits, and
# only then is the in-range compare safe.
case "$PORT" in
  ''|*[!0-9]*|0*|??????*)
    printf '\n  KOSMOS_PORT must be a number from 1 to 65535, with no leading zeros. Unset it and run again.\n\n' >&2
    exit 2
    ;;
esac
if [ "$PORT" -gt 65535 ]; then
  printf '\n  KOSMOS_PORT must be a number from 1 to 65535. Unset it and run again.\n\n' >&2
  exit 2
fi
LOG_DIR="$KOSMOS_HOME/logs"
LOG="$LOG_DIR/install.log"

# ---- where the pieces come from --------------------------------------------
# ⚠️ BOTH SOURCES ARE OVERRIDABLE, and that is what makes the clean-machine test
# possible. On a release these fetch from the published URL. For the first run on
# a never-touched Mac we want to test the INSTALLER, not the CDN, so
# KOSMOS_TMUX_SRC and KOSMOS_SRC can point at local files carried over on a
# thumb drive. Same code path, one variable different.
KOSMOS_RELEASE_BASE="${KOSMOS_RELEASE_BASE:-https://installkosmos.com/dist}"

# ⚠️ EVERY DOWNLOAD IS CHECKSUM-VERIFIED before anything is extracted. The
# build publishes a .sha256 next to each tarball; a mismatch, a truncated
# download, or a missing checksum file all refuse in a sentence.
# ⚠️ WHAT THIS IS AND IS NOT: the checksum travels from the SAME origin over
# the SAME channel as the tarball, so it catches corruption, truncation and
# a half-updated CDN -- it adds nothing against a compromised origin, which
# already served this very script. Signing with a key that does not travel
# beside the artifact is the upgrade, and is on the launch security list.
# ⚠️ shasum, not sha256sum: macOS ships shasum, and this is the user path
# where nothing beyond a clean Mac may be assumed.
verify_download() {
  local file="$1" url="$2" want got
  curl -fsL -m 30 "$url.sha256" -o "$file.sha256" 2>/dev/null || {
    info "the download could not be verified (its verification file is missing)."
    info "This usually means the download site is mid-update. Wait a minute, then paste the install line again."
    return 1
  }
  want="$(awk '{print $1; exit}' "$file.sha256")"
  got="$(shasum -a 256 "$file" | awk '{print $1}')"
  rm -f "$file.sha256"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    info "the download did not arrive intact."
    info "Paste the install line again; if it keeps happening, the download site may be mid-update."
    return 1
  fi
  return 0
}

# A HEAD probe first, and a one-byte ranged GET before refusing: some static
# origins reject HEAD (405) while serving GET fine, and "check your internet
# connection" for a working connection is the wrong sentence.
reachable() {
  curl -fsIL -m 15 "$1" >/dev/null 2>&1 && return 0
  curl -fsL -r 0-0 -m 15 -o /dev/null "$1" >/dev/null 2>&1
}

# ⚠️ FETCHED INTO A FRESH STAGE AND SWAPPED, never merged over what is there.
# Merging an update over an old tree keeps files the new version deleted, and
# a half-failed copy leaves a tree that LOOKS installed. The swap means the
# destination is only ever a complete old version or a complete new one.
fetch_tmux() {
  local dest="$1"
  local stage="$dest.stage.$$"
  # Sweep leftovers from interrupted PREVIOUS attempts (each run stages
  # under a fresh $$, so an interrupt -- not a failure path -- accumulates
  # ~130MB per Ctrl-C otherwise, invisibly, forever).
  rm -rf "$dest".stage.* 2>/dev/null || true
  # ⚠️ EVERY failure path removes the stage. Returning without cleanup left a
  # partial stage directory behind per attempt (a new $$ each run), so a
  # flaky connection accumulated half-downloads in the user's install.
  rm -rf "$stage"
  mkdir -p "$stage" || { rm -rf "$stage"; return 1; }
  if [ -n "${KOSMOS_TMUX_SRC:-}" ]; then
    info "using local copy: $KOSMOS_TMUX_SRC"
    [ -d "$KOSMOS_TMUX_SRC" ] || { rm -rf "$stage"; return 1; }
    cp -R "$KOSMOS_TMUX_SRC/." "$stage/" || { rm -rf "$stage"; return 1; }
  else
    local url="$KOSMOS_RELEASE_BASE/tmux-$ARCH.tar.gz"
    # A reachability probe first, so the two failures a launch-day install
    # actually hits (no network, a half-published CDN) refuse in a sentence
    # instead of a curl error code. The real download keeps its progress
    # bar, which lives on stderr and cannot be silenced without losing it.
    if ! reachable "$url"; then
      info "could not reach the download at $url"
      info "Check your internet connection and paste the install line again; it is safe to re-run."
      rm -rf "$stage"; return 1
    fi
    info "downloading from $url"
    # ⚠️ Progress is ON. `curl -fsSL` is silent, and several minutes of nothing
    # is the failure this whole file is written against.
    curl -fL --progress-bar "$url" -o "$stage/tmux.tar.gz" || { rm -rf "$stage"; return 1; }
    verify_download "$stage/tmux.tar.gz" "$url" || { rm -rf "$stage"; return 1; }
    tar -xzf "$stage/tmux.tar.gz" -C "$stage" || { rm -rf "$stage"; return 1; }
    rm -f "$stage/tmux.tar.gz"
  fi
  [ -x "$stage/bin/tmux" ] || { rm -rf "$stage"; return 1; }

  # ⚠️ VERIFY THE THING WE JUST PLACED, rather than assuming the copy worked.
  # An arm64 binary with a broken signature does not run at all, and the failure
  # is silent and baffling. Better to say so here than to have the board come up
  # empty later with no explanation.
  if ! codesign -v "$stage/bin/tmux" 2>/dev/null; then
    info "the copy of tmux did not arrive intact"
    rm -rf "$stage"
    return 1
  fi
  # ⚠️ AND VERIFY IT RUNS ON THIS MAC, the same check the Node runtime gets
  # at build time. A binary built against a newer macOS than this one loads
  # nothing and says nothing; without this line the first symptom is a board
  # that reads every agent as unknown, which nobody would ever trace to dyld.
  if ! "$stage/bin/tmux" -V >/dev/null 2>&1; then
    info "the copy of tmux will not run on this Mac."
    info "That is a problem with the download itself, not with your Mac or your network; trying again will not fix it. We need to publish a corrected download."
    rm -rf "$stage"
    return 1
  fi
  rm -rf "$dest" || { rm -rf "$stage"; return 1; }
  mv "$stage" "$dest" || { rm -rf "$stage"; return 1; }
  return 0
}

install_kosmos() {
  local dest="$1"
  local stage="$dest/.kosmos.stage.$$"
  rm -rf "$dest"/.kosmos.stage.* 2>/dev/null || true
  rm -rf "$stage"
  mkdir -p "$stage" || { rm -rf "$stage"; return 1; }
  if [ -n "${KOSMOS_SRC:-}" ]; then
    info "using local copy: $KOSMOS_SRC"
    [ -d "$KOSMOS_SRC" ] || { rm -rf "$stage"; return 1; }
    cp -R "$KOSMOS_SRC/." "$stage/" || { rm -rf "$stage"; return 1; }
  else
    local url="$KOSMOS_RELEASE_BASE/kosmos-$ARCH.tar.gz"
    if ! reachable "$url"; then
      info "could not reach the download at $url"
      info "Check your internet connection and paste the install line again; it is safe to re-run."
      rm -rf "$stage"; return 1
    fi
    info "downloading from $url"
    curl -fL --progress-bar "$url" -o "$stage/kosmos.tar.gz" || { rm -rf "$stage"; return 1; }
    verify_download "$stage/kosmos.tar.gz" "$url" || { rm -rf "$stage"; return 1; }
    tar -xzf "$stage/kosmos.tar.gz" -C "$stage" || { rm -rf "$stage"; return 1; }
    rm -f "$stage/kosmos.tar.gz"
  fi
  # ⚠️ THE STAGE IS VERIFIED, THEN SWAPPED. On the update path the old
  # bundle already satisfies checks against $dest, so a failed copy used to
  # read as a successful update: the check must look at what just arrived,
  # never at what was already there. Only the bundle's three components are
  # replaced; tmux/, logs/ and the pidfile are the machine's own state.
  # ⚠️ Three renames, not one, so there IS a small window where an interrupt
  # leaves part-old, part-new -- stated rather than claimed away. The board
  # is stopped during the swap, every rename is same-filesystem, and the
  # recovery is the installer's own re-run, which `kosmos start` names when
  # the tree is incomplete.
  [ -x "$stage/bin/kosmos" ] || { rm -rf "$stage"; return 1; }
  [ -x "$stage/runtime/bin/node" ] || { rm -rf "$stage"; return 1; }
  [ -f "$stage/app/server.js" ] || { rm -rf "$stage"; return 1; }
  [ -f "$stage/app/web/index.html" ] || { rm -rf "$stage"; return 1; }
  # The runtime must RUN here, the same probe the tmux bundle gets: a
  # binary that will not load fails silently and baffling, and the floor
  # gate upstream makes that unlikely, not impossible.
  if ! "$stage/runtime/bin/node" --version >/dev/null 2>&1; then
    info "the runtime will not run on this Mac"
    rm -rf "$stage"
    return 1
  fi
  local part
  for part in bin app runtime; do
    rm -rf "$dest/$part" || { rm -rf "$stage"; return 1; }
    mv "$stage/$part" "$dest/$part" || { rm -rf "$stage"; return 1; }
  done
  # The bundle's VERSION record rides along (what shipped, traceable to a
  # binary); optional so an older bundle without one still installs.
  if [ -f "$stage/VERSION" ]; then
    rm -f "$dest/VERSION"
    mv "$stage/VERSION" "$dest/VERSION" || { rm -rf "$stage"; return 1; }
  fi
  rm -rf "$stage"
  return 0
}

# ---- how it talks -----------------------------------------------------------
# ⚠️ Plain sentences, no jargon, no filenames the reader did not choose. The one
# screen a non-technical person cannot get past is the one written for somebody
# else.
step()  { printf '\n  %s\n' "$*"; }
info()  { printf '     %s\n' "$*"; }
ok()    { printf '     done\n'; }
die()   {
  printf '\n  Something went wrong.\n     %s\n\n' "$*" >&2
  [ -f "$LOG" ] && printf '  The details are in %s\n\n' "$LOG" >&2
  exit 1
}

# Everything also goes to a log, so one run produces a transcript rather than a
# memory of what happened. That is what makes the clean-machine test worth
# something afterwards.
#
# ⚠️ A FIFO AND tee, NOT `exec > >(tee ...)`. The page tells people to pipe
# this into `sh`, and macOS sh is bash in POSIX mode, where process
# substitution is a SYNTAX ERROR: the exact line the marketing page hands out
# died on line one of real use. Caught by running the script with sh, the way
# a user actually will, instead of with bash, the way its author did. The
# fifo spelling is plain POSIX and behaves identically; it is unlinked as
# soon as both ends are open, so nothing is left behind.
start_log() {
  mkdir -p "$LOG_DIR" || die "Could not create $KOSMOS_HOME. Check that your home folder is writable."
  printf '\n=== kosmos install %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
  _pipe="$LOG_DIR/.log.pipe.$$"
  rm -f "$_pipe"
  if mkfifo "$_pipe" 2>/dev/null; then
    tee -a "$LOG" < "$_pipe" &
    exec > "$_pipe" 2>&1
    rm -f "$_pipe"
  fi
  # No fifo (exotic filesystem): the install still narrates on screen, it
  # just loses the file transcript. Never fail the install for the log.
  # ⚠️ NO fd IS SAVED HERE. An `exec 3>&1` looked tidy and was never read;
  # its only effect was to be inherited by every child, which is exactly the
  # descriptor leak that once held a curl | sh install open forever.
}

# ---- uninstall --------------------------------------------------------------
# (Uninstall narrates to the screen only: its file transcript would live in
# the very folder being deleted, and tee holding an unlinked file preserves
# nothing. The screen is the record here, deliberately.)
uninstall() {
  step "Removing Kosmos."
  # Shared by the icon removals below: unregister BEFORE deleting (a -u on
  # an already-deleted path is likely a no-op, leaving the stale Spotlight
  # record the call exists to clear) and re-register on a failed removal
  # so a named survivor is not one Spotlight denies. Sandboxed runs never
  # touch the machine-global database.
  _lsreg=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  _lsreg_u() {
    [ -z "${KOSMOS_APP_DIR:-}${KOSMOS_SYS_APP_DIR:-}" ] || return 0
    [ -x "$_lsreg" ] && "$_lsreg" -u "$1" >/dev/null 2>&1 || true
  }
  _lsreg_f() {
    [ -z "${KOSMOS_APP_DIR:-}${KOSMOS_SYS_APP_DIR:-}" ] || return 0
    [ -x "$_lsreg" ] && "$_lsreg" -f "$1" >/dev/null 2>&1 || true
  }
  # The board first, while the command that knows how still exists: deleting
  # the folder under a running server leaves it serving ghosts.
  if [ -x "$KOSMOS_HOME/bin/kosmos" ]; then
    info "stopping the board"
    "$KOSMOS_HOME/bin/kosmos" stop >/dev/null 2>&1 || true
    # A refused stop (a board this command did not start) is NAMED rather
    # than glossed: the files still come off, but an orphan process would
    # keep the port and answer errors from a deleted tree, so the user
    # hears about it and gets the way out.
    if curl -fsS -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
      info "note: something is still answering on port $PORT that this uninstall could not stop."
      info "It was not started by the kosmos command. Quit it, or restart your Mac, to finish."
    fi
  fi
  _agents_stopped=no
  # ⚠️ THE SYMLINK GOES BEFORE THE FOLDER, AND `-L` IS CHECKED. `-e` follows
  # symlinks, so once the folder was deleted the dangling link answered
  # "nothing there" and survived every uninstall -- the user was told Kosmos
  # was removed while a dead `kosmos` stayed on their PATH. Measured.
  if [ -e "$BIN_DIR/kosmos" ] || [ -L "$BIN_DIR/kosmos" ]; then
    info "removing $BIN_DIR/kosmos"
    rm -f "$BIN_DIR/kosmos"
  fi
  # The PATH lines the installer wrote come out with the command they
  # served: exactly the marker and its export, by whole-line match, and
  # nothing else in the person's profile. awk (not grep -v) because an
  # empty result is a legitimate outcome (a profile that held only our
  # block), not a pipeline error to branch on.
  _profile="${KOSMOS_PROFILE_FILE:-$HOME/.zprofile}"
  # Same sandbox gate as the install side: a harness run touches only a
  # profile it names explicitly, never the operator's real one.
  if [ -n "${KOSMOS_APP_DIR:-}${KOSMOS_SYS_APP_DIR:-}" ] && [ -z "${KOSMOS_PROFILE_FILE:-}" ]; then
    _profile=""
  fi
  _marker="# kosmos: PATH for the kosmos command (removed by --uninstall)"
  _pline="export PATH=\"$BIN_DIR:\$PATH\""
  if [ -n "$_profile" ] && [ -f "$_profile" ] && grep -qxF "$_marker" "$_profile" 2>/dev/null; then
    info "removing the kosmos PATH line from ${_profile##*/}"
    _ptmp="$(mktemp "${TMPDIR:-/tmp}/kosmos-profile.XXXXXXXXXX" 2>/dev/null || true)"
    # The export is matched by ADJACENCY to the marker as well as by exact
    # text: an uninstall run with a different KOSMOS_BIN_DIR than the
    # install would otherwise remove the marker and orphan the export it
    # explained. Only an export-PATH-shaped line right after the marker
    # qualifies; anything else the person wrote there is printed untouched.
    # The single blank line the install printed before the marker is
    # swallowed with it (held one line, flushed unless the marker follows),
    # so install/uninstall cycles do not accumulate blank lines.
    if [ -n "$_ptmp" ] \
       && awk -v m="$_marker" -v p="$_pline" '
            skip { skip=0; if ($0 == p || $0 ~ /^export PATH=".*:\$PATH"$/) next }
            $0 == m { skip=1; blank=0; next }
            { if (blank) print ""; blank=0 }
            $0 == "" { blank=1; next }
            { print }
            END { if (blank) print "" }
          ' "$_profile" > "$_ptmp" 2>/dev/null \
       && cat "$_ptmp" > "$_profile" 2>/dev/null; then
      rm -f "$_ptmp"
    else
      rm -f "$_ptmp" 2>/dev/null || true
      info "note: could not edit ${_profile##*/}; the leftover kosmos PATH line is harmless and safe to delete by hand"
    fi
  fi
  # ⚠️ THE AGENTS' BACKGROUND JOBS ARE STOPPED AND REMOVED. The app installs
  # one launchd job per agent (com.kosmos.agent.*), set to start at every
  # login. With Kosmos gone there is no UI left to manage them, and "left
  # alone" would mean invisible processes restarting forever with a manual
  # launchctl recipe as the only exit. The jobs are app plumbing; the
  # agents' FILES are user work and stay.
  _agents_dir="${AGENT_WORKFORCE_LAUNCH:-$HOME/Library/LaunchAgents}"
  for _plist in "$_agents_dir"/com.kosmos.agent.*.plist; do
    [ -e "$_plist" ] || continue
    _label="$(basename "$_plist" .plist)"
    _name="${_label#com.kosmos.agent.}"
    _agents_stopped=yes
    info "removing the background job for $_name"
    # ⚠️ enable BEFORE bootout, the order the app's own runbook uses. The
    # app's Remove path runs `launchctl disable`, which writes a per-user
    # override keyed on the LABEL that outlives the plist. Booting out and
    # deleting the plist while that override stands leaves a machine where
    # a reinstalled Kosmos creates an agent with the same name and launchd
    # silently refuses to start it, with nothing on disk to explain why.
    /bin/launchctl enable "gui/$(/usr/bin/id -u)/$_label" 2>/dev/null || true
    /bin/launchctl bootout "gui/$(/usr/bin/id -u)/$_label" 2>/dev/null || true
    # The agent itself runs in a detached tmux session that outlives its
    # launchd job; with Kosmos gone it would keep running against a tmux
    # binary deleted out from under it. Killed BY NAME, one session per
    # plist found, never kill-server: on a machine with other tmux use,
    # the server is not ours to kill.
    # ⚠️ `=$_name`, NEVER the bare name: tmux target resolution falls back
    # to a PREFIX match, and this repo has already measured `kill-session
    # -t sam` killing samantha-discord (bin/agent-supervisor.sh records the
    # incident). The = forces an exact match, the same form every engine
    # call site uses.
    # ...and only after PROVING OWNERSHIP the way the supervisor does: the
    # session must carry @kosmos_agent naming itself, or a user's own
    # `tmux new -s notes` would die for sharing a name with an agent's
    # leftover plist.
    if [ -x "$KOSMOS_HOME/tmux/bin/tmux" ]; then
      _owner="$("$KOSMOS_HOME/tmux/bin/tmux" show-options -t "=$_name" -v @kosmos_agent 2>/dev/null)" || _owner=""
      if [ "$_owner" = "$_name" ]; then
        "$KOSMOS_HOME/tmux/bin/tmux" kill-session -t "=$_name" 2>/dev/null || true
      fi
    fi
    rm -f "$_plist"
  done
  if [ -d "$KOSMOS_HOME" ]; then
    # ⚠️ REFUSE TO DELETE A FOLDER THAT IS NOT A KOSMOS INSTALL. KOSMOS_HOME
    # is overridable by design, and the one catastrophic misuse is pointing
    # it at a real folder (KOSMOS_HOME=$HOME) on the uninstall path: every
    # other destructive path here is bounded by a fixed leaf name, and this
    # one must be bounded by evidence.
    # A bare VERSION file proves nothing about this installer (common
    # enough that KOSMOS_HOME=$HOME plus a ~/VERSION would have deleted
    # the home folder); the VERSION leg exists for PARTIAL installs, and
    # a partial install always has one of our trees beside it.
    if [ -x "$KOSMOS_HOME/bin/kosmos" ] \
       || { [ -f "$KOSMOS_HOME/VERSION" ] && { [ -d "$KOSMOS_HOME/app" ] || [ -d "$KOSMOS_HOME/tmux" ]; }; }; then
      info "deleting $KOSMOS_HOME"
      rm -rf "$KOSMOS_HOME"
    else
      info "note: $KOSMOS_HOME does not look like a Kosmos install, so it was left alone."
    fi
  fi
  # The icon goes too, or uninstall leaves a dead app that opens nothing.
  # BOTH default locations are swept -- installs before 2026-08-13 wrote
  # ~/Applications, newer ones prefer /Applications -- each bounded by the
  # fixed leaf name. Under the VERBATIM override only the override dir is
  # touched: KOSMOS_APP_DIR set means a sandbox, and a sandboxed uninstall
  # reaching into the machine's REAL Applications folders would delete a
  # real install out from under the person running the test.
  # (KOSMOS_SYS_APP_DIR alone does NOT sandbox the home-folder sweep in
  # the else-branch below; a hand-driven --uninstall using it must
  # override HOME too, as the harness always does.)
  if [ -n "${KOSMOS_APP_DIR:-}" ]; then
    # The SAME ownership gate as every other destructive site: the header
    # promise ("anything the uninstall cannot PROVE this installer
    # created is left alone and named") is unconditional, and the
    # override path is not an exemption. -e OR -L like every sibling, so
    # a dangling link is named rather than silently surviving.
    if [ -e "$APP_DIR/Kosmos.app" ] || [ -L "$APP_DIR/Kosmos.app" ]; then
      if bundle_is_ours "$APP_DIR/Kosmos.app"; then
        info "removing the Kosmos app"
        _lsreg_u "$APP_DIR/Kosmos.app"
        rm -rf "$APP_DIR/Kosmos.app" 2>/dev/null || { _lsreg_f "$APP_DIR/Kosmos.app"; info "note: could not remove $APP_DIR/Kosmos.app; drag it to the Trash to finish."; }
      else
        info "note: the Kosmos.app in $APP_DIR could not be proven to belong to this install and was left alone."
      fi
    fi
    for _res in "$APP_DIR"/.Kosmos.app.stage.* "$APP_DIR"/.Kosmos.app.old.*; do
      { [ -e "$_res" ] || [ -L "$_res" ]; } || continue
      if bundle_is_ours "$_res"; then
        rm -rf "$_res" 2>/dev/null || info "note: could not remove the leftover hidden folder $_res; drag it to the Trash to finish."
      else
        # "could not be proven": a foreign account's aside fails the grep,
        # but so does OUR OWN aside after its best-effort cleanup gutted
        # the launcher out of it (measured in the deep-locked world), and
        # "not created by this install" would be false there. Claim only
        # the failed proof.
        info "note: the leftover hidden folder $_res could not be proven to belong to this install and was left alone."
      fi
    done
  else
    # A hand-driven --uninstall with only the test-only KOSMOS_SYS_APP_DIR
    # override still sweeps the REAL home Applications folder (HOME decides
    # that side), and a prior reviewer proved the mistake is easy to make;
    # the sweep is at least named so a mis-driven run is visible.
    if [ -n "${KOSMOS_SYS_APP_DIR:-}" ]; then
      info "note: the home-folder side of this sweep uses $HOME/Applications (KOSMOS_SYS_APP_DIR does not sandbox it; override HOME too in a test)"
    fi
    _sys_swept=no
    # The SYSTEM folder is shared between accounts, so its icon is deleted
    # only after PROVING OWNERSHIP the same way the tmux session kill does:
    # the bundle's launcher must name THIS install's KOSMOS_HOME. Without
    # the predicate, one account's uninstall would delete another
    # account's working icon. The HOME folder needs no predicate -- it is
    # per-user by construction.
    # -e OR -L, the same shape as resolve_app_dir's aliasing check: a
    # dangling symlink named Kosmos.app is residue too, and -d alone
    # leaves it invisible forever on the path whose header promises the
    # machine is returned to before.
    # (Ownership cannot be proven through a dangling link, so the refusal
    # note prints; that is honest, and the note names the survivor.)
    if [ -e "$SYS_APP_DIR/Kosmos.app" ] || [ -L "$SYS_APP_DIR/Kosmos.app" ]; then
      # The same anchored token as resolve_app_dir: the closing `}"` keeps
      # two homes in a prefix relationship from cross-matching, because
      # this grep is the sole gate on an rm -rf in a shared folder.
      if bundle_is_ours "$SYS_APP_DIR/Kosmos.app"; then
        info "removing the Kosmos app from $SYS_APP_DIR"
        # A standard user cannot always delete from /Applications; an icon
        # that survives is NAMED, never silently skipped. The flag feeds
        # the home-folder link branch below: a link is our residue only
        # when THIS RUN removed the bundle it pointed at.
        _lsreg_u "$SYS_APP_DIR/Kosmos.app"
        if rm -rf "$SYS_APP_DIR/Kosmos.app" 2>/dev/null; then
          _sys_swept=yes
        else
          _lsreg_f "$SYS_APP_DIR/Kosmos.app"
          info "note: could not remove $SYS_APP_DIR/Kosmos.app; drag it to the Trash to finish."
        fi
      else
        # "could not be proven": the failed match observed exactly that
        # and nothing more -- it covers another account's Kosmos, a
        # third-party app carrying the name, and a user's link to our
        # own bundle (linkness fails the proof by design).
        info "note: the Kosmos app in $SYS_APP_DIR could not be proven to belong to this install and was left alone."
      fi
    fi
    # ⚠️ Skipped when the two folders are physically the same (~/Applications
    # symlinked to /Applications): the ownership-checked branch above
    # already decided that bundle's fate, and this delete would override
    # its refusal through the symlink. FAIL CLOSED, the same shape as the
    # install-side guard: an unresolvable folder is a reason to leave the
    # bundle alone and say so, never a license to delete through it.
    _home_apps_phys="$(cd "$HOME/Applications" 2>/dev/null && pwd -P)" || _home_apps_phys=""
    _sys_apps_phys="$(cd "$SYS_APP_DIR" 2>/dev/null && pwd -P)" || _sys_apps_phys=""
    # -e OR -L, the same shape as the system-folder gate above: -d follows
    # symlinks, so a dangling link named Kosmos.app here would survive
    # every uninstall in silence, against the survivor-is-NAMED rule.
    #
    # A LINK ENTRY is decided by its target, not by the tests below (which
    # would follow it onto whatever it points at): a link at the system
    # bundle this uninstall just swept is our residue and goes; any other
    # link was not made by this installer and is left, named.
    if [ -L "$HOME/Applications/Kosmos.app" ]; then
      _lnk_target="$(readlink "$HOME/Applications/Kosmos.app" 2>/dev/null)" || _lnk_target=""
      # BOTH conditions: pointing at our slot is not enough, because the
      # bundle there may have been foreign and refused two lines up (or
      # absent entirely), and "pointed at the removed Kosmos app" must
      # never print on a run that removed nothing. Measured in review:
      # the target-only version deleted a user's link to a refused
      # bundle, under two adjacent contradictory sentences.
      if [ "$_lnk_target" = "$SYS_APP_DIR/Kosmos.app" ] && [ "$_sys_swept" = "yes" ]; then
        info "removing a link that pointed at the removed Kosmos app from $HOME/Applications"
        rm -f "$HOME/Applications/Kosmos.app" 2>/dev/null || info "note: could not remove $HOME/Applications/Kosmos.app; drag it to the Trash to finish."
      else
        info "note: the Kosmos.app in the Applications folder inside your home folder is a link this install did not create; it was left alone."
      fi
    elif [ -e "$HOME/Applications/Kosmos.app" ]; then
      if [ -n "$_home_apps_phys" ] && [ -n "$_sys_apps_phys" ] && [ "$_home_apps_phys" != "$_sys_apps_phys" ]; then
        # The same ownership token as the system folder: uninstalling
        # Kosmos must not delete somebody's unrelated app that happens to
        # carry the name, even in the per-user folder.
        if bundle_is_ours "$HOME/Applications/Kosmos.app"; then
          info "removing the Kosmos app from $HOME/Applications"
          _lsreg_u "$HOME/Applications/Kosmos.app"
          rm -rf "$HOME/Applications/Kosmos.app" 2>/dev/null || { _lsreg_f "$HOME/Applications/Kosmos.app"; info "note: could not remove $HOME/Applications/Kosmos.app; drag it to the Trash to finish."; }
        else
          info "note: the Kosmos.app in the Applications folder inside your home folder was not created by this install and was left alone."
        fi
      elif [ -z "$_home_apps_phys" ]; then
        # The fail-closed note names the folder that actually failed the
        # check; blaming the home folder when the system one was the
        # unresolvable side would claim something never observed. (This
        # leg is believed unreachable -- seeing the entry already needs
        # the search bit cd needs -- and is kept as defense; no driving
        # pass is possible.)
        info "note: could not check the Applications folder inside your home folder; the Kosmos icon there was left alone."
      elif [ -z "$_sys_apps_phys" ]; then
        info "note: could not check $SYS_APP_DIR, so the Kosmos icon in the Applications folder inside your home folder was left alone."
      fi
    fi
    # Probe and stage residue from any earlier run goes too; the loop
    # CHECKS ITS RESULT and names any survivor, because the served header
    # promises this sweep and a deep-locked leftover really can refuse an
    # rm (measured: the best-effort version left a hidden .old folder in
    # the system folder under a closing line saying the machine was back
    # to before). The -e||-L test per entry keeps an unmatched glob
    # harmless. (Same accepted race as the probe sweep: a second
    # account's in-flight install could lose its hidden stage to this
    # sweep; bounded, rare.)
    rm -rf "$SYS_APP_DIR"/.kosmos-write-probe.* 2>/dev/null || true
    # ⚠️ WITH THE SAME OWNERSHIP PROOF as the visible bundle: an aside can
    # be another ACCOUNT'S only surviving icon (the restore-failure note
    # sends them to it by name), and residue that carries no provable
    # launcher is left and named rather than deleted, per the header's
    # stated bound.
    for _res in "$SYS_APP_DIR"/.Kosmos.app.stage.* "$SYS_APP_DIR"/.Kosmos.app.old.* \
                "$HOME/Applications"/.Kosmos.app.stage.* "$HOME/Applications"/.Kosmos.app.old.*; do
      { [ -e "$_res" ] || [ -L "$_res" ]; } || continue
      if bundle_is_ours "$_res"; then
        rm -rf "$_res" 2>/dev/null || info "note: could not remove the leftover hidden folder $_res; drag it to the Trash to finish."
      else
        # "could not be proven": a foreign account's aside fails the grep,
        # but so does OUR OWN aside after its best-effort cleanup gutted
        # the launcher out of it (measured in the deep-locked world), and
        # "not created by this install" would be false there. Claim only
        # the failed proof.
        info "note: the leftover hidden folder $_res could not be proven to belong to this install and was left alone."
      fi
    done
  fi
  # The shared supervisor is app plumbing (the same argument as the launchd
  # jobs) and goes; the STORE next to it is the user's agent records and
  # stays, and the closing sentence names where.
  _support="${AGENT_WORKFORCE_DATA:-$HOME/Library/Application Support}/AgentWorkforce"
  if [ -d "$_support/bin" ]; then
    info "removing the shared supervisor"
    rm -rf "$_support/bin"
  fi
  # ⚠️ Deliberately NOT removed: the user's agents' folders, their instruction
  # files, and anything under ~/work. Uninstalling the app must never delete
  # somebody's work, and an installer that cleans up too enthusiastically is
  # worse than one that leaves a folder behind.
  # Claim only what was observed: the plists were REMOVED (we removed them);
  # "stopped" would assert an outcome the best-effort bootout never checked.
  # And on a machine with no agents, say nothing about agents at all.
  if [ "$_agents_stopped" = "yes" ]; then
    printf '\n  Kosmos is removed. Your agents\047 background jobs were removed; their files were left alone\n'
    printf '  (in your Library/Application Support/AgentWorkforce folder and their own folders).\n\n'
  else
    printf '\n  Kosmos is removed.\n\n'
  fi
  # ⚠️ Named, not removed: the install may have recorded the agent
  # permission setting in Claude Code's own config, but that file can carry
  # the person's real settings and the same key set by their own hand --
  # an uninstaller cannot tell, so deleting it would overstep. The
  # reversibility contract is honored by NAMING what was left, per the
  # header's rule that anything not removed is left alone and named.
  if [ -f "$HOME/.claude/settings.json" ] && grep -q 'skipDangerousModePermissionPrompt' "$HOME/.claude/settings.json" 2>/dev/null; then
    printf '  One setting was left in place: skipDangerousModePermissionPrompt in\n'
    printf '  ~/.claude/settings.json (agents skip per-action permission prompts).\n'
    printf '  Delete that line there if you want the question back.\n\n'
  fi
  exit 0
}

# ⚠️ EVERYTHING SIDE-EFFECTFUL LIVES IN main, INVOKED ON THE LAST LINE.
# A `curl | sh` reader executes stdin incrementally, so a connection dropped
# mid-file would otherwise run the script's PREFIX and then die with a raw
# syntax error -- half an install performed by a truncated download. With
# the wrapper, a truncated file parses (or fails to parse) without ever
# having done anything: main only runs if the closing line arrived.
main() {

# ⚠️ AN UNRECOGNISED FLAG REFUSES, IT DOES NOT INSTALL. The one argument
# this script takes is the one that UNDOES the install; a typo in it
# (--uninstal, -uninstall, --help) silently doing the opposite would be
# indefensible. No argument at all is the install.
case "${1:-}" in
  "") ;;
  --uninstall) uninstall ;;
  *)
    printf '\n  The only option is --uninstall. To install, run it with no options:\n' >&2
    printf '    curl -fsSL https://installkosmos.com/setup | sh\n\n' >&2
    exit 2
    ;;
esac

# ---- preflight --------------------------------------------------------------
# ⚠️ ASK WHETHER THIS IS A FRESH MACHINE **BEFORE** ANYTHING CREATES A DIRECTORY.
# The first version asked afterwards, and `start_log` had already made
# $KOSMOS_HOME/logs to write into. So the installer created the evidence it then
# used to decide, and told a person installing for the very first time
# "Kosmos is already installed here."
#
# Caught by running it against a genuinely empty directory. On the never-touched
# Mac that is the FIRST SENTENCE the user would have read, and it says the
# product is confused about its own state on the one run where trust is decided.
# ⚠️ Keyed on the INSTALLED PRODUCT, not on the directory existing: start_log
# creates $KOSMOS_HOME/logs before anything can fail, so a run that died at a
# dropped download left the directory behind, and the RETRY -- the likeliest
# second run there is -- opened with "already installed here" on a machine
# where Kosmos has never run. The launcher existing is what installed means.
FRESH_INSTALL=yes
[ -x "$KOSMOS_HOME/bin/kosmos" ] && FRESH_INSTALL=no

start_log

printf '\n  Installing Kosmos\n'
printf '  This takes a couple of minutes and does not need your password.\n'

step "Checking this Mac."
# (A second Darwin check, deliberately: the one at the top of the file runs
# before the log exists and protects the shell from non-bash sh; this one
# puts the refusal INTO the narrated transcript for the supported flow.)
case "$(uname -s)" in
  Darwin) ;;
  *) die "Kosmos runs on macOS. This looks like $(uname -s)." ;;
esac
ARCH="$(uname -m)"
# ⚠️ Named refusal, not a mystery. Without this an Intel Mac asks the CDN for
# a bundle that does not exist and the experience is a bare "Could not
# install Kosmos" after a 404. Say the real reason in a sentence.
case "$ARCH" in
  arm64) ;;
  *) die "Kosmos needs a Mac with Apple silicon (M1 or newer). This Mac is $ARCH." ;;
esac
# ⚠️ THE macOS FLOOR IS GATED HERE, IN A SENTENCE, NOT DISCOVERED AT THE
# LAST STEP. The shipped Node runtime is built with minos 13.5 (measured
# with otool on the artifact), so on an older macOS the entire narrated
# install would succeed and then die at "Starting Kosmos." with a log
# nobody reads -- the exact opposite of the named-refusal rule above. The
# build gates its artifacts against this same floor, so the number here
# and the binaries cannot drift apart silently.
MACOS_FLOOR_MAJOR=13
MACOS_FLOOR_MINOR=5
_osver="$(sw_vers -productVersion 2>/dev/null || echo 0.0)"
[ -n "$_osver" ] || _osver="0.0"
_osmajor="${_osver%%.*}"
_osrest="${_osver#*.}"
_osminor="${_osrest%%.*}"
case "$_osmajor" in (*[!0-9]*|'') _osmajor=0 ;; esac
case "$_osminor" in (*[!0-9]*|'') _osminor=0 ;; esac
if [ "$_osver" = "0.0" ]; then
  die "Kosmos could not read this Mac's macOS version, so it cannot confirm it will run here. Kosmos needs macOS $MACOS_FLOOR_MAJOR.$MACOS_FLOOR_MINOR or newer."
fi
if [ "$_osmajor" -lt "$MACOS_FLOOR_MAJOR" ] || { [ "$_osmajor" -eq "$MACOS_FLOOR_MAJOR" ] && [ "$_osminor" -lt "$MACOS_FLOOR_MINOR" ]; }; then
  die "Kosmos needs macOS $MACOS_FLOOR_MAJOR.$MACOS_FLOOR_MINOR or newer. This Mac is on $_osver. Updating macOS in System Settings gets you there."
fi
info "macOS $_osver on $ARCH"
ok

# ⚠️ IDEMPOTENT, AND IT SAYS SO. Somebody who is not sure whether it worked will
# run it again. That must be safe and must not look like a failure.
if [ "$FRESH_INSTALL" = "no" ]; then
  info "Kosmos is already installed here. Updating it in place."
fi

mkdir -p "$KOSMOS_HOME" "$BIN_DIR" || die "Could not create $KOSMOS_HOME. Check that your home folder is writable."

# ---- tmux -------------------------------------------------------------------
# ⚠️ THE HARD PART, AND WHY IT IS SOLVED THIS WAY. macOS does not ship tmux, and
# Kosmos is built on it: the board reads what your agents are doing from tmux, so
# without it there is no product and it cannot degrade to a warning.
#
# We ship our own rather than asking for Homebrew, which would mean sudo and a
# multi-gigabyte developer-tools download in front of someone who was told this
# takes one line. Ours is ~2MB, lives in this folder, and touches nothing else.
# ⚠️ THE PAUSE HAPPENS BEFORE THE tmux SWAP, not between tmux and Kosmos:
# swapping tmux under a live board leaves a window where the binary the
# board polls does not exist (every agent reads as unknown), and a version
# change would strand the running tmux server on a protocol the new client
# cannot speak.
if [ "$FRESH_INSTALL" = "no" ] && [ -x "$KOSMOS_HOME/bin/kosmos" ]; then
  info "pausing Kosmos for the update"
  "$KOSMOS_HOME/bin/kosmos" stop >/dev/null 2>&1 || true
  # Identity, not a bare 200: naming a stranger "a Kosmos board" hands out
  # advice ('kosmos stop') that the very next command refuses, and every
  # rerun reproduces it. Same lesson the kosmos command's health check
  # carries; the advice differs by who is actually on the port.
  _pausebody="$(curl -fsS -m 2 "http://127.0.0.1:$PORT/" 2>/dev/null)" || _pausebody=""
  case "$_pausebody" in
    *"Agent Workforce"*|*Kosmos*)
      die "A Kosmos board is still running on port $PORT and could not be paused for the update. Stop it first ('kosmos stop', or quit whatever started it), then paste the install line again."
      ;;
    "") ;;
    *)
      die "Another app on this Mac is using port $PORT, which Kosmos needs. Quit that app, then paste the install line again."
      ;;
  esac
fi

step "Setting up the pieces Kosmos needs."
# ⚠️ FETCHED ON EVERY RUN, not only the first. The old guard skipped this
# whole step when a tmux was already present, which froze every machine at
# whatever tmux its FIRST install shipped -- no path to ever deliver a fix.
# The staged swap makes re-fetching safe, and the download is ~700KB.
info "installing a private copy of tmux (about 2MB, nothing system-wide)"
# On a release this fetches the checksum-verified bundle from the release
# URL (the binaries inside carry ad-hoc signatures; nothing here is Apple-
# signed, and saying "signed" would overclaim). Kept as a function so the
# clean-machine test can point it at a local file.
fetch_tmux "$KOSMOS_HOME/tmux" || die "Could not set up the terminal manager. The lines above say why, and whether trying again can help."
ok

# ⚠️ TERMINFO IS PINNED RATHER THAN TRUSTED. The bundled ncurses carries a
# compiled-in path to the terminfo database from the machine it was built on,
# which will not exist here. macOS ships its own at /usr/share/terminfo and
# ncurses is expected to fall back to it, but "expected to" is doing work in that
# sentence and this is the machine where it would fail. Pinning it converts an
# assumption into a fact, for free.
export TERMINFO_DIRS="${TERMINFO_DIRS:-/usr/share/terminfo}"

# ---- providers: deliberately NOT here -----------------------------------------
# ⚠️ THE INSTALLER NEVER MENTIONS A PROVIDER BY NAME, AND THAT IS A RULE RATHER
# THAN AN OMISSION. Decided with Josh, 2026-08-12.
#
# An earlier version of this file checked for Claude Code here and reported on
# it. Harmless today, when Claude is the only option, and a trap the moment there
# is a second one: the assumption spreads, and adding OpenAI then means either
# bloating this one line toward 700MB or bolting on a separate mechanism.
#
# So this script installs the PLATFORM: a runtime, a terminal multiplexer, and
# Kosmos. **Choosing a provider inside the app is what installs that provider**,
# which is also the click that signs you into it.
#
# Three things that gets us:
#   1. The terminal step drops to ~130MB instead of ~400MB. In a room of thirty
#      people watching a black screen, that difference is the whole experience.
#   2. The large download happens inside our UI, where a real progress bar can
#      live, instead of in a terminal where silence reads as a hang.
#   3. Nobody downloads a provider they will never use.
#
# ⚠️ What it costs, so nobody is surprised: the user is NOT finished when this
# script finishes. The provider screen has to survive being quit and resumed
# mid-download, because somebody will close the laptop.

# ---- kosmos itself ----------------------------------------------------------
step "Installing Kosmos."
# ⚠️ THE RUNNING BOARD STOPS BEFORE THE SWAP, or the update does not happen.
# The swap replaces app/ and runtime/ on disk, but the OLD process keeps
# serving from memory, and the final `kosmos start` sees a healthy port and
# returns without starting anything -- so the installer would print
# "Kosmos is running" while the machine keeps executing the previous
# version until a reboot. Stopping first also closes the window where the
# live server's web/index.html is deleted out from under it mid-install.
# (The board was already paused above, before the tmux swap; a refused
# pause has already refused the whole update in a sentence.)
install_kosmos "$KOSMOS_HOME" || die "Could not install Kosmos. The line above says why. It is safe to paste the install line and try again."
ln -sfn "$KOSMOS_HOME/bin/kosmos" "$BIN_DIR/kosmos" || die "Could not place the kosmos command in $BIN_DIR. Check that your home folder is writable."
info "installed to $KOSMOS_HOME"
ok

# ⚠️ WIRED, not narrated. A binary in ~/.local/bin is useless to somebody
# whose shell does not look there, and the note this used to print reached
# nobody: measured 2026-08-18, the person AND every agent on the machine got
# "command not found" from the taught command, the agents silently (their
# failure happens before the engine, so nothing draws it anywhere). zsh is
# the macOS default login shell, so the line lands in ~/.zprofile (created
# if absent), marker-guarded so reruns never duplicate it; --uninstall
# removes exactly the two lines this writes and nothing else. A profile we
# cannot write degrades to the old honest note, never to silence.
PROFILE_FILE="${KOSMOS_PROFILE_FILE:-$HOME/.zprofile}"
# ⚠️ A SANDBOXED RUN NEVER TOUCHES THE REAL PROFILE. Same keying as the
# lsregister gate: any app-dir override means a test harness, and the only
# profile such a run may write is one it names explicitly. The first
# harness run after this feature leaked a sandbox bin path into the
# operator's real ~/.zprofile; this gate is that measurement.
if [ -n "${KOSMOS_APP_DIR:-}${KOSMOS_SYS_APP_DIR:-}" ] && [ -z "${KOSMOS_PROFILE_FILE:-}" ]; then
  PROFILE_FILE=""
fi
PATH_MARKER="# kosmos: PATH for the kosmos command (removed by --uninstall)"
PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    if [ -z "$PROFILE_FILE" ]; then
      info "skipping the shell profile (sandboxed run, no profile named)"
    elif [ -z "${KOSMOS_PROFILE_FILE:-}" ] && [ -n "${SHELL:-}" ] && [ "${SHELL##*/}" != "zsh" ]; then
      # An EXPLICIT KOSMOS_PROFILE_FILE outranks this hedge: a bash user
      # pointing at their own ~/.bash_profile asked for exactly this write.
      # ⚠️ The claim must not outrun the file: ~/.zprofile is read by zsh
      # only, and a bash/fish login shell would get "success" and a command
      # that still fails -- the silent class this whole step exists to end.
      # An empty $SHELL falls through to wiring: the macOS default is zsh.
      info "note: typing 'kosmos' in Terminal will not work yet on this Mac (your login shell is ${SHELL##*/}, and this installer only knows how to wire zsh); the app icon step below and the closing lines cover how to open Kosmos"
    else
      case "$BIN_DIR" in
        *"
"*|*'"'*|*'$'*|*'`'*|*'\'*)
          # Same class as the KOSMOS_HOME guard above: these characters
          # would corrupt (or execute inside) a file sourced at every
          # login. Refuse the write, keep the honest note.
          info "note: typing 'kosmos' in Terminal will not work yet on this Mac (the bin folder's name contains a character unsafe to write into ${PROFILE_FILE##*/}); the app icon step below and the closing lines cover how to open Kosmos"
          ;;
        *)
          if [ -f "$PROFILE_FILE" ] && grep -qxF "$PATH_MARKER" "$PROFILE_FILE" 2>/dev/null; then
            # No works-claim here: the wired export names whatever bin dir
            # the EARLIER install used, which this run cannot vouch for.
            info "the kosmos command is already wired into ${PROFILE_FILE##*/}"
          elif { printf '\n%s\n%s\n' "$PATH_MARKER" "$PATH_LINE" >> "$PROFILE_FILE"; } 2>/dev/null; then
            info "wired ${PROFILE_FILE##*/} so typing 'kosmos' works in NEW Terminal windows (windows already open keep their old PATH)"
          else
            info "note: typing 'kosmos' in Terminal will not work yet on this Mac (could not write ${PROFILE_FILE##*/}); the app icon step below and the closing lines cover how to open Kosmos"
          fi
          ;;
      esac
    fi
    ;;
esac

# ---- the front door -----------------------------------------------------------
# ⚠️ AN ICON IS HOW A NON-TECHNICAL PERSON OWNS SOFTWARE, and without one this
# whole install produces a URL. Josh, 2026-08-12: "Typing some huge, super
# technical-looking 127.0.0.1:4317 is super scary looking for a non-technical
# person... Nobody will ever come back to this after the install essentially."
# He is right, and it would have been the quiet reason the product got installed
# once and never opened again.
#
# ⚠️ AND THIS DOES NOT REOPEN THE SETTLED "NO .app" DECISION. The launch
# decision of 2026-08-11 ruled out a DOWNLOADABLE app, because an unsigned app that arrives from the
# internet carries a quarantine attribute and Gatekeeper shows the "unidentified
# developer" block, which needs an Apple developer account to clear.
#
# An app BUILT HERE is never downloaded, so it is never quarantined, so
# Gatekeeper never runs. MEASURED: a locally-created .app has no extended
# attributes at all and macOS reports it as a proper application bundle. We still
# ship one terminal line. That line just leaves an icon behind.
# ⚠️ STAGED, LIKE EVERY OTHER SWAP IN THIS FILE. The bundle is built complete
# in a hidden sibling and renamed into place, because a build that dies
# between mkdir and the launcher write used to leave a launcher-less husk at
# the real path -- which every later run's ownership check read as foreign
# (divert forever) and which --uninstall refused to touch for the same
# reason: a permanently wedged Applications slot the documented uninstall
# could not reach, on the file whose header promises reversibility. The
# stage is cleaned on every failure path, and uninstall sweeps stage
# residue too.
make_app() {
  # ⚠️ TWO STATEMENTS, NOT ONE. `local app="$1" target="$app/Contents"` looks fine
  # and fails under `set -u`: bash does not make `app` visible to later
  # assignments in the SAME `local` statement, so `$app` is unbound and the whole
  # step dies. Measured, after the installer reported "app: unbound variable" and
  # created nothing.
  local app="$1"
  local appdir stage
  appdir="$(dirname "$app")"
  stage="$appdir/.Kosmos.app.stage.$$"
  # Sweep SIBLING pids too, the same opening move as fetch_tmux and
  # install_kosmos and for the same reason: every interrupted run would
  # otherwise leave a complete hidden bundle copy accumulating under a
  # fresh pid until an uninstall the user may never run. WITH the
  # ownership proof, because an aside in a SHARED folder can be another
  # account's only surviving icon; a foreign or unprovable residue is
  # skipped silently here (the uninstall names them). (Same accepted
  # two-accounts-at-the-same-instant race as the probe sweep.)
  local _res
  for _res in "$appdir"/.Kosmos.app.stage.* "$appdir"/.Kosmos.app.old.*; do
    { [ -e "$_res" ] || [ -L "$_res" ]; } || continue
    if bundle_is_ours "$_res"; then
      rm -rf "$_res" 2>/dev/null || true
    fi
  done
  rm -rf "$stage" 2>/dev/null || true
  # (The own-pid stage and aside this run creates are cleaned WITHOUT the
  # ownership predicate, deliberately: a partial stage is unprovable by
  # construction, and refusing to clean our own current-run scratch would
  # leave it forever. The predicate gates only OTHER pids' residue.)
  # ⚠️ mkdir WITHOUT -p, by absolute path, as the stage's first act: -p
  # follows a symlink planted at this predictable name and would build the
  # bundle at the link's target, then install the link itself as
  # Kosmos.app. A bare mkdir fails on ANYTHING already at the path,
  # including a symlink slipped in after the rm above. (In /Applications
  # the planter is already an admin, so this is hardening rather than a
  # live hole; it costs one word.)
  /bin/mkdir "$stage" 2>/dev/null || return 1
  if ! build_app_bundle "$stage"; then
    rm -rf "$stage" 2>/dev/null || true
    return 1
  fi
  # ⚠️ THE OLD BUNDLE IS RENAMED ASIDE, NEVER rm -rf'd IN PLACE. rm -rf is
  # depth-first and can die partway (one root-owned nested directory is
  # enough), which GUTS the bundle -- launcher gone, husk left -- and a
  # launcher-less husk is unprovable to every later ownership check:
  # installs divert forever and uninstall refuses it. A rename cannot
  # partially gut a tree, so the visible Kosmos.app is only ever complete
  # (old) or complete (new). The aside copy is deleted best-effort and its
  # name is swept by --uninstall.
  local aside
  aside="$(dirname "$app")/.Kosmos.app.old.$$"
  rm -rf "$aside" 2>/dev/null || true
  if [ -e "$app" ] || [ -L "$app" ]; then
    # ⚠️ RE-VERIFIED IMMEDIATELY BEFORE THE RENAME: ownership was proved
    # at resolve time, and in a shared folder the occupant can change
    # between then and now. The displaced bundle gets deleted, so the
    # proof must be contemporaneous with the displacement, or the header
    # sentence "only ever replaces a Kosmos icon it can prove it created"
    # holds only usually.
    if ! bundle_is_ours "$app"; then
      rm -rf "$stage" 2>/dev/null || true
      return 1
    fi
    if ! mv "$app" "$aside" 2>/dev/null; then
      rm -rf "$stage" 2>/dev/null || true
      return 1
    fi
  fi
  if ! mv "$stage" "$app" 2>/dev/null; then
    # Put the old bundle back, best-effort -- a failed swap must not leave
    # the slot empty when a working icon existed seconds ago -- and if
    # even that fails, SAY where the icon went instead of losing it in
    # silence.
    if [ -e "$aside" ] || [ -L "$aside" ]; then
      mv "$aside" "$app" 2>/dev/null \
        || info "note: the previous Kosmos icon could not be put back; it is in the hidden folder $aside"
    fi
    rm -rf "$stage" 2>/dev/null || true
    return 1
  fi
  rm -rf "$aside" 2>/dev/null \
    || info "note: could not remove the leftover hidden folder $aside; drag it to the Trash to finish."

  # ⚠️ TELL macOS THE APP EXISTS. A freshly created bundle is not in the
  # LaunchServices database, and until it is, it can show a generic icon or
  # behave oddly when opened. Measured: straight after creation, lsregister knew
  # nothing about it.
  #
  # On a machine that has run this before, this is also what makes a REPLACED
  # bundle pick up a new icon instead of the cached old one. Failure here is not
  # fatal, the app still works, so it never aborts the install.
  # ⚠️ NEVER FROM A SANDBOX: lsregister writes the operator's REAL
  # machine-global LaunchServices database, under the production bundle
  # id. Measured after harness runs: dozens of dead mktemp paths
  # registered against com.chaoskosmos.kosmos. Any override set means a
  # harness, and a harness must leave that database alone.
  if [ -z "${KOSMOS_APP_DIR:-}${KOSMOS_SYS_APP_DIR:-}" ]; then
    local lsreg=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
    # ⚠️ TOUCH BEFORE REGISTERING. MEASURED (Josh's clean-machine install,
    # 2026-08-17): app present, Get Info previews the icon, the Dock draws
    # the generic tile. MEASURED on this machine (2026-08-17): mv preserves
    # a directory's mtime, so the .app arrives with the stage's timestamp
    # rather than a fresh one. HYPOTHESIS, unverifiable here: icon consumers
    # keying a re-read off that mtime never look again. The touch is the non-invasive subset of the
    # manual remedy that ships (touch + register, WITHOUT the killall Dock
    # a person can run); if the Dock's in-session cache was the operative
    # ingredient, a clean install may still draw generic and this area is
    # NOT ruled out -- the next clean-machine run is the first real test.
    # -c so the only thing this line can ever do is bump a time.
    /usr/bin/touch -c "$app" 2>/dev/null || true
    [ -x "$lsreg" ] && "$lsreg" -f "$app" >/dev/null 2>&1 || true
  fi
  return 0
}

build_app_bundle() {
  # ⚠️ EVERY STEP CARRIES ITS OWN `|| return 1`. This function runs as an `if`
  # condition, and that DISABLES `set -e` for its whole body (measured: a
  # failing mkdir inside it did not abort, and the caller printed success
  # over a bundle that was never created). The fallback branch at the call
  # site is only reachable if failures are returned by hand.
  local app="$1"
  local target="$app/Contents"
  # The version the app reports is the one that was installed, read from the
  # installed bundle itself, so the plist cannot drift from package.json.
  # The baked uid is captured and VALIDATED before the heredoc: an empty
  # substitution would bake `!= ""`, which is always true, and the icon
  # would refuse every account including the installing one, forever.
  # (The same shape as the empty-ver guard below, and the same lesson as
  # the retired under-HOME proxy that degenerated when HOME was empty.)
  local owner_uid
  owner_uid="$(/usr/bin/id -u)" || owner_uid=""
  case "$owner_uid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  local ver
  ver="$(KOSMOS_PKG="$KOSMOS_HOME/app/package.json" \
    "$KOSMOS_HOME/runtime/bin/node" -p 'JSON.parse(require("fs").readFileSync(process.env.KOSMOS_PKG,"utf8")).version' 2>/dev/null)" || ver="0.0.0"
  [ -n "$ver" ] || ver="0.0.0"
  mkdir -p "$target/MacOS" "$target/Resources" || return 1

  # ⚠️ THE ARCHITECTURE IS DECLARED, because the executable is a shell
  # script: LaunchServices cannot read an arch from a non-Mach-O file and
  # on Apple silicon it then demands Rosetta before opening the app at
  # all (measured on the first real desktop click, 2026-08-13: "To open
  # Kosmos, you need to install Rosetta" for a fully native app).
  # LSArchitecturePriority arm64 + LSRequiresNativeExecution tell it the
  # truth and the prompt never appears.
  cat > "$target/Info.plist" <<PLIST || return 1
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Kosmos</string>
  <key>CFBundleDisplayName</key><string>Kosmos</string>
  <key>CFBundleIdentifier</key><string>com.chaoskosmos.kosmos</string>
  <key>CFBundleExecutable</key><string>Kosmos</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$ver</string>
  <key>CFBundleVersion</key><string>$ver</string>
  <key>CFBundleIconFile</key><string>Kosmos</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string></array>
  <key>LSRequiresNativeExecution</key><true/>
  <key>LSMinimumSystemVersion</key><string>$MACOS_FLOOR_MAJOR.$MACOS_FLOOR_MINOR</string>
  <key>LSUIElement</key><false/>
</dict></plist>
PLIST

  # ⚠️ IT STARTS THE BOARD IF IT IS NOT RUNNING, rather than only opening a
  # URL, and it does so through `kosmos open`, which is the one place that
  # knows how to start, health-check and identify the board (a NON-Kosmos
  # squatter on the port must not be opened and called Kosmos; another
  # account's Kosmos is indistinguishable to that check, which is why the
  # fresh-install open in this file demands the pidfile proof instead).
  # If that fails, the icon
  # says so in a dialog instead of opening a dead page: an icon that opens a
  # browser error is how a person concludes the product broke, and they are
  # not wrong to. osascript ships on every Mac; if even the dialog fails
  # there is nothing left this launcher can do quietly, and it exits.
  cat > "$target/MacOS/Kosmos" <<LAUNCH || return 1
#!/bin/bash
KOSMOS_HOME="\${KOSMOS_HOME:-$KOSMOS_HOME}"
# The account that installed Kosmos, as a BAKED UID compared exactly at
# click time. On a Mac with several accounts, the shared Applications icon
# would otherwise start (or fail to start) the INSTALLING account's
# private tree for whoever clicks it; the other account gets a sentence
# pointing at the install line instead. A uid compare, not an
# is-KOSMOS_HOME-under-HOME proxy: the proxy false-alarmed on the
# installing account itself whenever KOSMOS_HOME was overridden outside
# the home folder, and degenerated to match-anything when HOME was empty.
if [ "\$(/usr/bin/id -u)" != "$owner_uid" ]; then
  /usr/bin/osascript -e 'display alert "Kosmos was installed by a different account" message "This Kosmos belongs to another user of this Mac. To use Kosmos from this account, paste the install line from installkosmos.com into Terminal." as critical' >/dev/null 2>&1
  exit 1
fi
# The port this install chose travels with the icon; without it, an install
# on a non-default port produced an icon that opened the default one.
export KOSMOS_PORT="\${KOSMOS_PORT:-$PORT}"
if ! "\$KOSMOS_HOME/bin/kosmos" open >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display alert "Kosmos could not start" message "Something went wrong bringing Kosmos up. Reinstalling usually fixes it: paste the install line into Terminal again." as critical' >/dev/null 2>&1
  exit 1
fi
LAUNCH
  chmod +x "$target/MacOS/Kosmos" || return 1

  # The icon is optional so the installer never fails for the want of
  # artwork; it ships inside the bundle at app/assets/ (the gold-K
  # Kosmos.icns landed 2026-08-13, macOS-shaped). (CFBundleIconFile
  # pointing at a file that is absent is harmless: macOS falls back to
  # the generic icon either way. A Dock that already pins Kosmos may
  # keep its cached tile until the Dock restarts; that is the Dock's
  # cache, not a bad icns.)
  [ -f "$KOSMOS_HOME/app/assets/Kosmos.icns" ] && cp "$KOSMOS_HOME/app/assets/Kosmos.icns" "$target/Resources/Kosmos.icns"
  return 0
}

step "Adding Kosmos to your Applications."
resolve_app_dir
# ⚠️ THE ONE DIALOG THIS RUN CAN SHOW IS NAMED BEFORE IT CAN APPEAR.
# Anticipatory, NOT measured on this machine (which had already granted
# Terminal everything): Apple's App Management (TCC, macOS 13+) documents
# that modifying app bundles can prompt "Terminal would like to manage
# apps". The person this file is written for was promised no password and
# no surprises; an unexplained system dialog mid-run reads as "something
# went wrong". A denial is handled below (the icon falls back to the home
# folder).
# On every system-folder write, not only the first: App Management is
# documented for MODIFYING an installed bundle, so the replace case is
# the one MOST likely to raise the dialog, and the earlier
# first-write-only gate silenced the sentence exactly there. One line of
# transcript per update is the cost; an unexplained system dialog is the
# alternative.
if [ "$APP_SKIP_ICON" != "yes" ] && [ -z "${KOSMOS_APP_DIR:-}" ] && [ "$APP_DIR" = "$SYS_APP_DIR" ]; then
  info "if your Mac asks whether Terminal can manage apps, that is this step; Allow puts the icon in Applications"
fi
APP_MADE=no
if [ "$APP_SKIP_ICON" = "yes" ]; then
  : # said below, where the not-made sentences live
elif ! mkdir -p "$APP_DIR" 2>/dev/null; then
  # NON-fatal, like every other icon failure in this step: an unwritable
  # or file-shadowed Applications folder must not abort a run that can
  # still deliver a working Kosmos. The give-up sentence below covers it.
  :
# (Under the verbatim KOSMOS_APP_DIR override this gate is skipped by
# design; a foreign occupant there still cannot be destroyed, because
# make_app re-verifies ownership contemporaneously and fails into the
# generic give-up sentence instead of the specific left-alone one.)
elif [ -z "${KOSMOS_APP_DIR:-}" ] && [ "$APP_DIR" != "$SYS_APP_DIR" ] \
     && { [ -e "$APP_DIR/Kosmos.app" ] || [ -L "$APP_DIR/Kosmos.app" ]; } \
     && ! bundle_is_ours "$APP_DIR/Kosmos.app"; then
  # ⚠️ THE HOME FOLDER GETS THE SAME OWNERSHIP GATE AS EVERY OTHER
  # destructive site. This was the one path left that replaced an
  # occupant without proof -- while the uninstall sweep and the stale
  # cleanup on the SAME directory both refuse without it -- and make_app
  # renames the occupant aside and deletes it. A stranger's app named
  # Kosmos.app in the user's own folder is theirs; no icon is written,
  # and the sentence below says so.
  APP_HOME_FOREIGN=yes
elif make_app "$APP_DIR/Kosmos.app"; then
  APP_MADE=yes
elif [ -z "${KOSMOS_APP_DIR:-}" ] && [ "$APP_DIR" = "$SYS_APP_DIR" ]; then
  # ⚠️ A WRITABLE FOLDER IS NOT A CREATABLE BUNDLE. The mkdir probe proves
  # POSIX write on the directory; a root-owned leftover Kosmos.app or a
  # TCC App Management denial can still fail the bundle write inside it.
  # Before 2026-08-13 the icon reliably landed in ~/Applications, so
  # ending with NO icon anywhere would be strictly worse than the
  # discoverability bug this branch fixes. One retry into the per-user
  # folder before giving up -- guarded by the same aliasing test as the
  # divert, because "retry in the home folder" is only a retry when the
  # home folder is a different folder.
  _retry_ok=no
  if [ ! -e "$HOME/Applications" ] && [ ! -L "$HOME/Applications" ]; then
    _retry_ok=yes
  else
    _home_apps_phys="$(cd "$HOME/Applications" 2>/dev/null && pwd -P)" || _home_apps_phys=""
    _sys_apps_phys="$(cd "$SYS_APP_DIR" 2>/dev/null && pwd -P)" || _sys_apps_phys=""
    if [ -n "$_home_apps_phys" ] && [ -n "$_sys_apps_phys" ] && [ "$_home_apps_phys" != "$_sys_apps_phys" ]; then
      _retry_ok=yes
    fi
  fi
  # The system-folder outcome is recorded BEFORE the retry can branch
  # away (including the aliased _retry_ok=no leg): the transcript
  # otherwise went quiet about Applications entirely on those legs,
  # right after the TCC warm-up set the expectation that an icon would
  # land there. The reason is "swap", not "probe": this account could
  # write the folder.
  if [ -e "$SYS_APP_DIR/Kosmos.app" ] || [ -L "$SYS_APP_DIR/Kosmos.app" ]; then
    APP_SYS_STALE=swap
  else
    APP_SYS_FAILED=yes
  fi
  if [ "$_retry_ok" = "yes" ]; then
    APP_DIR="$HOME/Applications"
    # The same home-folder ownership gate as the direct path above: the
    # retry must not replace an occupant it cannot prove is ours either.
    if { [ -e "$APP_DIR/Kosmos.app" ] || [ -L "$APP_DIR/Kosmos.app" ]; } \
       && ! bundle_is_ours "$APP_DIR/Kosmos.app"; then
      APP_HOME_FOREIGN=yes
    elif mkdir -p "$APP_DIR" 2>/dev/null && make_app "$APP_DIR/Kosmos.app"; then
      APP_MADE=yes
    fi
  fi
fi
if [ "$APP_MADE" = "yes" ]; then
  # The sentence names where the icon ACTUALLY went. "you will find it in
  # Applications" was printed on the run that put it in ~/Applications, and
  # the tester could not find it -- a true sentence read as a false one.
  if [ "$APP_DIR" = "$SYS_APP_DIR" ]; then
    info "you will find it in Applications, as Kosmos"
    # An earlier install may have left the icon in ~/Applications (the only
    # place this script wrote before 2026-08-13). Once the icon lives in
    # the system folder, the old one is a second, staler Kosmos in the
    # place nobody looks -- removed, bounded by the fixed leaf name, and
    # the MOVE IS NAMED: a person whose Dock pointed at the old bundle now
    # holds a dead Dock icon, and a silent move is how that reads as "the
    # product broke". Never under the verbatim override (a KOSMOS_APP_DIR
    # sandbox must not reach into the home folder at all).
    #
    # ⚠️ AND ONLY WHEN THE TWO FOLDERS ARE PHYSICALLY DIFFERENT. `-d` follows
    # symlinks: on a machine where ~/Applications is a symlink to
    # /Applications (or the harness points SYS_APP_DIR into the home
    # folder), the "stale icon" IS the bundle written two lines up, and
    # this cleanup would delete the app it just installed while printing
    # success. Reproduced during review; the pwd -P compare is the guard.
    # ⚠️ AND NEVER WHEN THE ENTRY ITSELF IS A SYMLINK. bundle_is_ours
    # already rejects a link at the root, so without this guard nothing
    # would be deleted; but the phys compares and the left-alone note
    # below would still fire on a link to the bundle just written,
    # narrating a stale icon that does not exist. A link is not a stale
    # bundle; it is left exactly as found, silently.
    if [ -z "${KOSMOS_APP_DIR:-}" ] && [ -d "$HOME/Applications/Kosmos.app" ] && [ ! -L "$HOME/Applications/Kosmos.app" ]; then
      _home_apps_phys="$(cd "$HOME/Applications" 2>/dev/null && pwd -P)" || _home_apps_phys=""
      _app_dir_phys="$(cd "$APP_DIR" 2>/dev/null && pwd -P)" || _app_dir_phys=""
      if [ -n "$_home_apps_phys" ] && [ -n "$_app_dir_phys" ] && [ "$_home_apps_phys" != "$_app_dir_phys" ]; then
        # ⚠️ AND ONLY WITH PROOF OF OWNERSHIP, the same anchored token as
        # everywhere else: "the stale icon this script wrote before
        # 2026-08-13" is the only bundle this cleanup exists for, and a
        # genuine one always carries the launcher line. Anything else
        # named Kosmos.app in the user's own folder is theirs, is left
        # alone, and is named.
        if bundle_is_ours "$HOME/Applications/Kosmos.app"; then
          # Unregister BEFORE the removal (lsregister searches paths for
          # applications, so -u on an already-deleted path is likely a
          # no-op and would leave the stale Spotlight record this call
          # exists to clear), and RE-register on the failure leg so a
          # bundle the note tells the user to go find is not one
          # Spotlight says does not exist. Both directions best-effort,
          # both skipped in a sandbox.
          _lsreg=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
          if [ -z "${KOSMOS_APP_DIR:-}${KOSMOS_SYS_APP_DIR:-}" ]; then
            [ -x "$_lsreg" ] && "$_lsreg" -u "$HOME/Applications/Kosmos.app" >/dev/null 2>&1 || true
          fi
          if rm -rf "$HOME/Applications/Kosmos.app" 2>/dev/null; then
            info "note: the Kosmos icon moved here from the Applications folder inside your home folder."
            info "If Kosmos was in your Dock, remove it and drag the new one in."
          else
            if [ -z "${KOSMOS_APP_DIR:-}${KOSMOS_SYS_APP_DIR:-}" ]; then
              [ -x "$_lsreg" ] && "$_lsreg" -f "$HOME/Applications/Kosmos.app" >/dev/null 2>&1 || true
            fi
            info "note: an older Kosmos icon is still in the Applications folder inside your home folder; drag it to the Trash."
          fi
        else
          info "note: a Kosmos.app not created by this install is in the Applications folder inside your home folder; it was left alone."
        fi
      elif [ -z "$_home_apps_phys" ]; then
        # The fail-closed legs say so, split the same way as the
        # uninstall's guard: the note names the side that actually failed
        # the check. Only the physically-equal leg stays silent, because
        # there the "stale icon" is the bundle just written and nothing
        # is stale. (The home leg is believed unreachable -- the -d test
        # above already needs the search bit cd needs -- and is kept as
        # defense; no driving pass is possible.)
        info "note: could not check the Applications folder inside your home folder; anything there was left alone."
      elif [ -z "$_app_dir_phys" ]; then
        info "note: could not check $APP_DIR, so anything in the Applications folder inside your home folder was left alone."
      fi
    fi
  else
    if [ "$APP_OTHER_OWNER" = "yes" ]; then
      # Claims only what the failed ownership match observed: "not created
      # by this install" covers another account's Kosmos AND a third-party
      # app carrying the name, where "another account has Kosmos" would
      # assert something never established.
      info "something else already has the Kosmos spot in Applications, so yours went to the"
      info "Applications folder inside your home folder, as Kosmos (or type Kosmos into Spotlight)"
    else
      info "you will find it in the Applications folder inside your home folder, as Kosmos"
      info "(or type Kosmos into Spotlight)"
      if [ "$APP_SYS_STALE" = "probe" ]; then
        info "note: the older Kosmos icon in Applications could not be updated from this account;"
        info "use the new one (the old one may be out of date)"
      elif [ "$APP_SYS_STALE" = "swap" ]; then
        # "could not be replaced" and nothing more: this leg fires on ANY
        # make_app failure in a writable system folder (an immutable
        # bundle, a TCC denial, a failed stage), and the transcript must
        # not name a cause it never observed.
        info "note: the older Kosmos icon in Applications could not be replaced; use the"
        info "new one (the old one may be out of date)"
      elif [ "$APP_SYS_FAILED" = "yes" ]; then
        # No cause named: this leg fires on any refused write (TCC, full
        # disk, a lost race), and the transcript claims only the outcome.
        info "note: the icon could not be put into Applications this time; the one in"
        info "your home folder works the same"
      fi
    fi
  fi
  ok
elif [ "$APP_HOME_FOREIGN" = "yes" ]; then
  info "note: a Kosmos.app not created by this install is in the Applications folder inside"
  info "your home folder; it was left alone and no icon was created."
  if [ "$APP_OTHER_OWNER" = "yes" ]; then
    info "(something else also has the Kosmos spot in Applications; it was left alone too)"
  fi
  if [ "$APP_SYS_STALE" = "swap" ]; then
    info "(the Kosmos icon already in Applications could not be replaced and is still there)"
  elif [ "$APP_SYS_STALE" = "probe" ]; then
    info "(the Kosmos icon already in Applications could not be updated from this account and is still there)"
  elif [ "$APP_SYS_FAILED" = "yes" ]; then
    info "(no icon could be put into Applications this time either)"
  fi
  info "The closing lines below say how to open Kosmos."
elif [ "$APP_SKIP_ICON" = "yes" ]; then
  # The fail-closed leg of the divert's aliasing guard: something not ours
  # holds the system spot AND the home Applications folder is (or cannot be
  # proven not to be) the same physical folder, so there is nowhere an icon
  # can go without touching a stranger's app. Say so, claiming only what
  # the resolve actually observed; the dashboard address in the closing
  # lines still opens Kosmos.
  if [ "$APP_SKIP_REASON" = "same" ]; then
    info "something else already has the Kosmos spot in Applications, and this Mac's home"
    info "Applications folder is the same folder, so no icon was created."
  else
    info "something else already has the Kosmos spot in Applications, and the folders"
    info "around it could not be checked, so no icon was created."
  fi
  info "The closing lines below say how to open Kosmos."
else
  info "could not create the app icon, but Kosmos itself is fine"
  if [ "$APP_SYS_STALE" != "no" ]; then
    info "(the Kosmos icon already in Applications is still there from before)"
  elif [ "$APP_OTHER_OWNER" = "yes" ]; then
    info "(something else has the Kosmos spot in Applications; it was left alone)"
  fi
fi

# ---- the permission acceptance (#46, Josh's ruling 2026-08-17) --------------
# Agents run Claude Code with permission prompts skipped; the FIRST such run
# on a machine shows Claude Code's own full-screen acceptance wall, and an
# agent stuck at it looks exactly like an agent thinking (Josh met this on a
# clean Mac: his first message sat against a wall of warning text). His
# ruling, verbatim intent: no extra click, no extra screen -- "when they're
# installing it they're giving us permission to do all of those things." So
# the install records the acceptance the wall exists to collect.
#
# ⚠️ The key is skipDangerousModePermissionPrompt in ~/.claude/settings.json.
# The fleet bulletin's trap: defaultMode alone is NOT enough; only this key
# stops the wall. MERGE, never clobber -- the file may carry a person's real
# Claude Code settings, and an installer that eats somebody's config to set
# one flag is worse than the wall. The merge runs on the Node runtime THIS
# INSTALL just verified runnable -- /usr/bin/python3 is a Command Line Tools
# shim, and its first invocation on a clean Mac can pop Apple's developer-
# tools dialog mid-install, the exact machine this block exists for. If the
# file exists but cannot be parsed as JSON (or is not an object), LEAVE IT
# ALONE and say so (fail-soft: the wall appearing later is recoverable; a
# clobbered config is not) -- one Enter in the agent's session clears it,
# per docs/clean-machine-retest.md. The symlink, mode, and zero-byte edges
# are each pinned by tools/test-permission-acceptance.sh.
_claude_settings="$HOME/.claude/settings.json"
if "$KOSMOS_HOME/runtime/bin/node" - "$_claude_settings" <<'NODEEOF' 2>/dev/null
const fs = require('fs');
const p = require('path');
// realpath FIRST: the file may be a symlink into a dotfiles repo, and a
// rename over the link would sever it, stranding the dotfiles copy while
// the setting stops tracking. Writing through preserves the arrangement.
let target = process.argv[2];
try {
  target = fs.realpathSync(target);
} catch {
  // Absent is the clean case -- unless the PATH ITSELF is a dangling
  // symlink: renaming over that would replace the link with a file, the
  // exact severing realpath exists to prevent. Somebody's arrangement;
  // leave it and let the wall be the recoverable outcome.
  try { if (fs.lstatSync(target).isSymbolicLink()) process.exit(1); } catch { /* truly absent */ }
}
let data = {};
let prevMode = null;                     // any existing file's mode survives,
                                         // zero-byte included: empty carries
                                         // nobody's settings but the chmod was
                                         // still somebody's hand
try {
  const st = fs.statSync(target);
  prevMode = st.mode & 0o7777;
  if (st.size > 0) {
    data = JSON.parse(fs.readFileSync(target, 'utf8'));   // throws -> refusal
    if (!data || typeof data !== 'object' || Array.isArray(data)) process.exit(1);
  }
} catch (err) {
  if (err && err.code === 'ENOENT') { /* absent is the clean case */ }
  else if (err instanceof SyntaxError) process.exit(1);   // somebody's file, leave it
  else process.exit(1);
}
if (data.skipDangerousModePermissionPrompt === true) process.exit(0);
data.skipDangerousModePermissionPrompt = true;
fs.mkdirSync(p.dirname(target), { recursive: true });
const tmp = target + '.kosmos.new';
// Born at the preserved mode, not chmodded into it: a tightened file's
// merged contents must never sit world-readable even for the window
// between write and chmod (the chmod after still runs for umask
// exactness).
fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', prevMode !== null ? { mode: prevMode } : {});
if (prevMode !== null) {
  // The person may have tightened their settings file; a replace must not
  // silently widen it back to the umask default.
  fs.chmodSync(tmp, prevMode);
}
fs.renameSync(tmp, target);
NODEEOF
then
  info "agents will not stop to ask permission for each action; installing is that permission"
  info "(this answers Claude Code's one-time skip-permissions question for this whole Mac,"
  info "so anything else using that mode will not ask either)"
else
  info "could not record the agent permission setting; the first agent may show a"
  info "one-time question in its own window, and answering it once clears it for good"
fi

# ---- start ------------------------------------------------------------------
step "Starting Kosmos."
KOSMOS_SAY_INDENT="     " "$KOSMOS_HOME/bin/kosmos" start || die "Kosmos installed but would not start. What it said is above; it is safe to paste the install line again."
ok

# ⚠️ PROVE THE BOARD ON THE PORT IS THIS INSTALL'S OWN. cmd_start's
# healthy() accepts ANY board identifying as Kosmos on the port, so on a
# Mac where another account's Kosmos already holds it, a fresh install
# "succeeds" without ever starting its own board -- and the closing
# sentences (and the browser open below) would present the OTHER
# install's board as the result of this one. Measured in review: a fresh
# install onto an occupied port printed "Kosmos is running" and opened a
# stranger's board. The pidfile cmd_start writes for a board it actually
# started is the proof; no pidfile with a live pid means the port is
# someone else's.
BOARD_OURS=no
if [ -f "$KOSMOS_HOME/board.pid" ]; then
  _bpid="$(cat "$KOSMOS_HOME/board.pid" 2>/dev/null)" || _bpid=""
  case "$_bpid" in
    ''|*[!0-9]*) ;;
    *)
      # The pid must BE the board, matched on THIS install's full server
      # path -- deliberately STRICTER than install/kosmos's running_pid,
      # which matches any *app/server.js*: a recycled pid, or another
      # install's live server behind a stale pidfile, must not read as
      # ours, because this flag gates the browser open. The harness pins
      # the anchoring with another install's live server pid; do not
      # "align" the two patterns.
      case "$(/bin/ps -ww -p "$_bpid" -o command= 2>/dev/null)" in
        *"$KOSMOS_HOME/app/server.js"*) BOARD_OURS=yes ;;
      esac
      ;;
  esac
fi

if [ "$BOARD_OURS" = "yes" ]; then
  printf '\n  Kosmos is running.\n'
  printf '  Open it and it will walk you through connecting your AI account.\n'
  printf '  Your dashboard: http://127.0.0.1:%s\n\n' "$PORT"
else
  printf '\n  Kosmos is installed, but could not confirm a board of its own is running on\n'
  printf '  port %s. Something else may already be using that port (often another\n' "$PORT"
  printf '  account%ss Kosmos; each account runs its own).\n' "'"
  if [ "$APP_MADE" = "yes" ]; then
    printf '  (The Kosmos icon this install created is tied to port %s and will open\n' "$PORT"
    printf '  whichever Kosmos answers there.)\n'
  fi
  printf '  Start yours on a different port, for example:\n'
  _alt=$((PORT + 1))
  [ "$_alt" -le 65535 ] || _alt=$((PORT - 1))
  printf '    KOSMOS_PORT=%s %s/kosmos start\n' "$_alt" "$BIN_DIR"
  printf '  and it will print your dashboard address.\n\n'
fi
printf '  To remove it later:  curl -fsSL https://installkosmos.com/setup | sh -s -- --uninstall\n\n'

# ⚠️ A FRESH INSTALL ENDS LOOKING AT KOSMOS, NOT AT A PROMPT. Measured on the
# first real clean-machine run (2026-08-13): every step succeeded and the
# tester's report opened with "It did not open the window or the app" --
# for this installer's audience, a URL printed in a transcript is not a
# running product. Fresh installs only: yanking the browser on an update
# would punish exactly the people who already know where the board is.
# Best-effort by design (`|| true`): over ssh or headless, `open` fails and
# the URL two lines up is still the whole answer.
#
# Opening the RAW URL is safe because the gate below requires BOARD_OURS:
# the pidfile proof above established that the thing answering the port
# is the board THIS install started, not merely something identifying as
# Kosmos (cmd_start's healthy() cannot tell those apart, which is exactly
# why the pidfile is the instrument). (install/kosmos's cmd_open is the
# other place this URL is spelled; keep the two together.)
#
# Two knobs, each doing exactly one job. KOSMOS_NO_OPEN: any non-empty
# value suppresses the open (yes, even "no" or "0" -- it is an internal
# is-it-set knob, recorded here so nobody is surprised); the harness
# exports it globally because a test that steals the operator's browser is
# a test nobody runs twice. KOSMOS_OPEN_CMD exists ONLY so the harness can
# substitute a recording stub and assert both legs -- a hardcoded
# /usr/bin/open made this block the one new behavior the suite could not
# see at all. Unguarded by choice, unlike KOSMOS_HOME and KOSMOS_PORT:
# it is never baked into anything and anyone who can set it can already
# run commands as this user.
OPEN_CMD="${KOSMOS_OPEN_CMD:-/usr/bin/open}"
# command -v rather than -x: it resolves a bare command name as well as a
# path, so an override like KOSMOS_OPEN_CMD=open does not silently no-op.
# The sandbox overrides also suppress the open (belt to KOSMOS_NO_OPEN's
# braces): either override set means a harness, and a harness must not
# depend solely on remembering the other knob. KOSMOS_SYS_APP_DIR gets
# one carve-out -- a set KOSMOS_OPEN_CMD re-enables it -- because the
# probe passes are exactly where the recording stub must be allowed to
# observe the open.
if [ "$BOARD_OURS" = "yes" ] && [ "$FRESH_INSTALL" = "yes" ] && [ -z "${KOSMOS_NO_OPEN:-}" ] && [ -z "${KOSMOS_APP_DIR:-}" ] \
   && { [ -z "${KOSMOS_SYS_APP_DIR:-}" ] || [ -n "${KOSMOS_OPEN_CMD:-}" ]; } \
   && command -v "$OPEN_CMD" >/dev/null 2>&1; then
  # Named before it happens, per the header's every-step rule: a browser
  # window appearing unannounced reads as "something went wrong", and on
  # a cold browser start the prompt returns seconds before the window.
  printf '  Opening your dashboard in the browser...\n\n'
  # </dev/null: the spawned process must not inherit the curl|sh pipe --
  # the same class as cmd_start's measured never-returning install.
  "$OPEN_CMD" "http://127.0.0.1:$PORT" </dev/null >/dev/null 2>&1 \
    || printf '  note: your browser could not be opened; the address above is your dashboard.\n\n'
fi
}

main "$@"
