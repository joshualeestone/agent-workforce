#!/bin/sh
# Kosmos installer. One line, no sudo, nothing outside your home folder.
#
# ⚠️ THE SHEBANG SAYS sh BECAUSE THE PAGE SAYS sh. This file's contract is
# the interpreter the marketing line actually invokes: macOS /bin/sh, which
# is bash 3.2 in POSIX mode (the Darwin gate below runs before anything
# non-POSIX, so a Linux dash never gets past the first sentence). `local`
# and `set -o pipefail` are safe under macOS sh specifically, and that is
# the only sh this file supports.
#
#   curl -fsSL https://chaoskosmos.com/setup | sh
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
#   - Nothing needs sudo. Nothing is written outside $HOME.
#   - Running it twice is safe and says so.
#
# ⚠️ AND IT MUST BE REVERSIBLE. `--uninstall` genuinely returns the machine to
# before. That is not politeness: the first run on a never-touched Mac is the
# most valuable test this project will ever get, and it is worth exactly once
# unless we can put the machine back.

# ⚠️ THE macOS CHECK RUNS BEFORE ANY set OPTION. `set -o pipefail` is not
# POSIX; on a Linux dash the old order died with a raw shell error before
# reaching the friendly "Kosmos runs on macOS" sentence below.
case "$(uname -s)" in
  Darwin) ;;
  *) printf '\n  Kosmos runs on macOS. This looks like %s.\n\n' "$(uname -s)" >&2; exit 1 ;;
esac

set -euo pipefail

KOSMOS_HOME="${KOSMOS_HOME:-$HOME/.local/share/kosmos}"
BIN_DIR="${KOSMOS_BIN_DIR:-$HOME/.local/bin}"
# ⚠️ Overridable for the same reason the sources are: the sandboxed test of
# this installer must not write an app icon into the real ~/Applications of
# the machine it runs on. Everything this script writes goes under a root the
# test can point somewhere disposable.
APP_DIR="${KOSMOS_APP_DIR:-$HOME/Applications}"
# The port everything below names. Overridable for the sandboxed installer
# test; the app icon and the closing sentences bake in whatever was installed.
PORT="${KOSMOS_PORT:-4317}"
LOG_DIR="$KOSMOS_HOME/logs"
LOG="$LOG_DIR/install.log"

# ---- where the pieces come from --------------------------------------------
# ⚠️ BOTH SOURCES ARE OVERRIDABLE, and that is what makes the clean-machine test
# possible. On a release these fetch from the published URL. For the first run on
# a never-touched Mac we want to test the INSTALLER, not the CDN, so
# KOSMOS_TMUX_SRC and KOSMOS_SRC can point at local files carried over on a
# thumb drive. Same code path, one variable different.
KOSMOS_RELEASE_BASE="${KOSMOS_RELEASE_BASE:-https://chaoskosmos.com/dist}"

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
  curl -fsL "$url.sha256" -o "$file.sha256" 2>/dev/null || { info "the download's checksum file is missing"; return 1; }
  want="$(awk '{print $1; exit}' "$file.sha256")"
  got="$(shasum -a 256 "$file" | awk '{print $1}')"
  rm -f "$file.sha256"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    info "the download did not arrive intact (checksum mismatch)"
    return 1
  fi
  return 0
}

# ⚠️ FETCHED INTO A FRESH STAGE AND SWAPPED, never merged over what is there.
# Merging an update over an old tree keeps files the new version deleted, and
# a half-failed copy leaves a tree that LOOKS installed. The swap means the
# destination is only ever a complete old version or a complete new one.
fetch_tmux() {
  local dest="$1"
  local stage="$dest.stage.$$"
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
    if ! curl -fsIL -m 15 "$url" >/dev/null 2>&1; then
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
    info "the copy of tmux will not run on this Mac"
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
  rm -rf "$stage"
  mkdir -p "$stage" || { rm -rf "$stage"; return 1; }
  if [ -n "${KOSMOS_SRC:-}" ]; then
    info "using local copy: $KOSMOS_SRC"
    [ -d "$KOSMOS_SRC" ] || { rm -rf "$stage"; return 1; }
    cp -R "$KOSMOS_SRC/." "$stage/" || { rm -rf "$stage"; return 1; }
  else
    local url="$KOSMOS_RELEASE_BASE/kosmos-$ARCH.tar.gz"
    if ! curl -fsIL -m 15 "$url" >/dev/null 2>&1; then
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
  mkdir -p "$LOG_DIR"
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
  # The board first, while the command that knows how still exists: deleting
  # the folder under a running server leaves it serving ghosts.
  if [ -x "$KOSMOS_HOME/bin/kosmos" ]; then
    info "stopping the board"
    "$KOSMOS_HOME/bin/kosmos" stop >/dev/null 2>&1 || true
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
    info "stopping the background job for $_name"
    # ⚠️ enable BEFORE bootout, the order the app's own runbook uses. The
    # app's Remove path runs `launchctl disable`, which writes a per-user
    # override keyed on the LABEL that outlives the plist. Booting out and
    # deleting the plist while that override stands leaves a machine where
    # a reinstalled Kosmos creates an agent with the same name and launchd
    # silently refuses to start it, with nothing on disk to explain why.
    /bin/launchctl enable "gui/$(id -u)/$_label" 2>/dev/null || true
    /bin/launchctl bootout "gui/$(id -u)/$_label" 2>/dev/null || true
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
    if [ -x "$KOSMOS_HOME/tmux/bin/tmux" ]; then
      "$KOSMOS_HOME/tmux/bin/tmux" kill-session -t "=$_name" 2>/dev/null || true
    fi
    rm -f "$_plist"
  done
  if [ -d "$KOSMOS_HOME" ]; then
    info "deleting $KOSMOS_HOME"
    rm -rf "$KOSMOS_HOME"
  fi
  # The icon goes too, or uninstall leaves a dead app that opens nothing.
  [ -d "$APP_DIR/Kosmos.app" ] && { info "removing the Kosmos app"; rm -rf "$APP_DIR/Kosmos.app"; }
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
  # Claim only what was observed: on a machine with no agents, "your agents
  # were stopped" would be the file's own sin of asserting the unobserved.
  if [ "$_agents_stopped" = "yes" ]; then
    printf '\n  Kosmos is removed. Your agents were stopped; their files were left alone\n'
    printf '  (in your Library/Application Support/AgentWorkforce folder and their own folders).\n\n'
  else
    printf '\n  Kosmos is removed.\n\n'
  fi
  exit 0
}

# ⚠️ AN UNRECOGNISED FLAG REFUSES, IT DOES NOT INSTALL. The one argument
# this script takes is the one that UNDOES the install; a typo in it
# (--uninstal, -uninstall, --help) silently doing the opposite would be
# indefensible. No argument at all is the install.
case "${1:-}" in
  "") ;;
  --uninstall) uninstall ;;
  *)
    printf '\n  The only option is --uninstall. To install, run it with no options:\n' >&2
    printf '    curl -fsSL https://chaoskosmos.com/setup | sh\n\n' >&2
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

mkdir -p "$KOSMOS_HOME" "$BIN_DIR"

# ---- tmux -------------------------------------------------------------------
# ⚠️ THE HARD PART, AND WHY IT IS SOLVED THIS WAY. macOS does not ship tmux, and
# Kosmos is built on it: the board reads what your agents are doing from tmux, so
# without it there is no product and it cannot degrade to a warning.
#
# We ship our own rather than asking for Homebrew, which would mean sudo and a
# multi-gigabyte developer-tools download in front of someone who was told this
# takes one line. Ours is ~2MB, lives in this folder, and touches nothing else.
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
fetch_tmux "$KOSMOS_HOME/tmux" || die "Could not set up the terminal manager. It is safe to paste the install line and try again; if it keeps failing, your network may be blocking the download."
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
if [ "$FRESH_INSTALL" = "no" ] && [ -x "$KOSMOS_HOME/bin/kosmos" ]; then
  info "pausing Kosmos for the update"
  "$KOSMOS_HOME/bin/kosmos" stop >/dev/null 2>&1 || true
fi
install_kosmos "$KOSMOS_HOME" || die "Could not install Kosmos. It is safe to paste the install line and try again; if it keeps failing, your network may be blocking the download."
ln -sfn "$KOSMOS_HOME/bin/kosmos" "$BIN_DIR/kosmos"
info "installed to $KOSMOS_HOME"
ok

# ⚠️ Say it, do not assume it. A binary in ~/.local/bin is useless to somebody
# whose shell does not look there, and silently not working is the worst outcome.
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) info "note: add $BIN_DIR to your PATH to run 'kosmos' from anywhere" ;;
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
make_app() {
  # ⚠️ TWO STATEMENTS, NOT ONE. `local app="$1" target="$app/Contents"` looks fine
  # and fails under `set -u`: bash does not make `app` visible to later
  # assignments in the SAME `local` statement, so `$app` is unbound and the whole
  # step dies. Measured, after the installer reported "app: unbound variable" and
  # created nothing.
  #
  # ⚠️ EVERY STEP CARRIES ITS OWN `|| return 1`. This function runs as an `if`
  # condition, and that DISABLES `set -e` for its whole body (measured: a
  # failing mkdir inside it did not abort, and the caller printed success
  # over a bundle that was never created). The fallback branch at the call
  # site is only reachable if failures are returned by hand.
  local app="$1"
  local target="$app/Contents"
  # The version the app reports is the one that was installed, read from the
  # installed bundle itself, so the plist cannot drift from package.json.
  local ver
  ver="$(KOSMOS_PKG="$KOSMOS_HOME/app/package.json" \
    "$KOSMOS_HOME/runtime/bin/node" -p 'require(process.env.KOSMOS_PKG).version' 2>/dev/null)" || ver="0.0.0"
  rm -rf "$app" || return 1
  mkdir -p "$target/MacOS" "$target/Resources" || return 1

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
  <key>CFBundleIconFile</key><string>Kosmos</string>
  <key>LSMinimumSystemVersion</key><string>$MACOS_FLOOR_MAJOR.$MACOS_FLOOR_MINOR</string>
  <key>LSUIElement</key><false/>
</dict></plist>
PLIST

  # ⚠️ IT STARTS THE BOARD IF IT IS NOT RUNNING, rather than only opening a
  # URL, and it does so through `kosmos open`, which is the one place that
  # knows how to start, health-check and identify the board (a squatter on
  # the port must not be opened and called Kosmos). If that fails, the icon
  # says so in a dialog instead of opening a dead page: an icon that opens a
  # browser error is how a person concludes the product broke, and they are
  # not wrong to. osascript ships on every Mac; if even the dialog fails
  # there is nothing left this launcher can do quietly, and it exits.
  cat > "$target/MacOS/Kosmos" <<LAUNCH || return 1
#!/bin/bash
KOSMOS_HOME="\${KOSMOS_HOME:-$KOSMOS_HOME}"
# The port this install chose travels with the icon; without it, an install
# on a non-default port produced an icon that opened the default one.
export KOSMOS_PORT="\${KOSMOS_PORT:-$PORT}"
if ! "\$KOSMOS_HOME/bin/kosmos" open >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display alert "Kosmos could not start" message "Something went wrong bringing Kosmos up. The details are in $KOSMOS_HOME/logs/board.log. Reinstalling usually fixes it: paste the install line into Terminal again." as critical' >/dev/null 2>&1
  exit 1
fi
LAUNCH
  chmod +x "$target/MacOS/Kosmos" || return 1

  # The icon is optional so the installer never fails for the want of
  # artwork; it ships inside the bundle at app/assets/ when it exists. Until
  # the artwork lands the app shows the generic icon -- tracked on the
  # launch list, since the icon rationale above is only satisfied by a real
  # one. (CFBundleIconFile pointing at a file that is absent is harmless:
  # macOS falls back to the generic icon either way.)
  [ -f "$KOSMOS_HOME/app/assets/Kosmos.icns" ] && cp "$KOSMOS_HOME/app/assets/Kosmos.icns" "$target/Resources/Kosmos.icns"

  # ⚠️ TELL macOS THE APP EXISTS. A freshly created bundle is not in the
  # LaunchServices database, and until it is, it can show a generic icon or
  # behave oddly when opened. Measured: straight after creation, lsregister knew
  # nothing about it.
  #
  # On a machine that has run this before, this is also what makes a REPLACED
  # bundle pick up a new icon instead of the cached old one. Failure here is not
  # fatal, the app still works, so it never aborts the install.
  local lsreg=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  [ -x "$lsreg" ] && "$lsreg" -f "$app" >/dev/null 2>&1 || true
  return 0
}

step "Adding Kosmos to your Applications."
mkdir -p "$APP_DIR"
if make_app "$APP_DIR/Kosmos.app"; then
  info "you will find it in Applications, as Kosmos"
  ok
else
  info "could not create the app icon, but Kosmos itself is fine"
fi

# ---- start ------------------------------------------------------------------
step "Starting Kosmos."
"$KOSMOS_HOME/bin/kosmos" start || die "Kosmos installed but would not start."
ok

printf '\n  Kosmos is running.\n'
printf '  Open it and it will walk you through connecting your AI account.\n'
printf '  Your dashboard: http://127.0.0.1:%s\n\n' "$PORT"
printf '  To remove it later:  curl -fsSL https://chaoskosmos.com/setup | sh -s -- --uninstall\n\n'
