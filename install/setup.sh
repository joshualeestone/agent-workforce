#!/bin/bash
# Kosmos installer. One line, no sudo, nothing outside your home folder.
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
#     the documented disqualifying failure (requirements §122): a blank terminal
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

set -euo pipefail

KOSMOS_HOME="${KOSMOS_HOME:-$HOME/.local/share/kosmos}"
BIN_DIR="${KOSMOS_BIN_DIR:-$HOME/.local/bin}"
LOG_DIR="$KOSMOS_HOME/logs"
LOG="$LOG_DIR/install.log"

# ---- where the pieces come from --------------------------------------------
# ⚠️ BOTH SOURCES ARE OVERRIDABLE, and that is what makes the clean-machine test
# possible. On a release these fetch from the published URL. For the first run on
# a never-touched Mac we want to test the INSTALLER, not the CDN, so
# KOSMOS_TMUX_SRC and KOSMOS_SRC can point at local files carried over on a
# thumb drive. Same code path, one variable different.
KOSMOS_RELEASE_BASE="${KOSMOS_RELEASE_BASE:-https://chaoskosmos.com/dist}"

fetch_tmux() {
  local dest="$1"
  mkdir -p "$dest"
  if [ -n "${KOSMOS_TMUX_SRC:-}" ]; then
    info "using local copy: $KOSMOS_TMUX_SRC"
    [ -d "$KOSMOS_TMUX_SRC" ] || return 1
    cp -R "$KOSMOS_TMUX_SRC/." "$dest/"
  else
    local url="$KOSMOS_RELEASE_BASE/tmux-$ARCH.tar.gz"
    info "downloading from $url"
    # ⚠️ Progress is ON. `curl -fsSL` is silent, and several minutes of nothing
    # is the failure this whole file is written against.
    curl -fL --progress-bar "$url" -o "$dest/tmux.tar.gz" || return 1
    tar -xzf "$dest/tmux.tar.gz" -C "$dest" && rm -f "$dest/tmux.tar.gz"
  fi
  [ -x "$dest/bin/tmux" ] || return 1

  # ⚠️ VERIFY THE THING WE JUST PLACED, rather than assuming the copy worked.
  # An arm64 binary with a broken signature does not run at all, and the failure
  # is silent and baffling. Better to say so here than to have the board come up
  # empty later with no explanation.
  if ! codesign -v "$dest/bin/tmux" 2>/dev/null; then
    info "the copy of tmux did not arrive intact"
    return 1
  fi
  return 0
}

install_kosmos() {
  local dest="$1"
  mkdir -p "$dest/bin"
  if [ -n "${KOSMOS_SRC:-}" ]; then
    info "using local copy: $KOSMOS_SRC"
    [ -d "$KOSMOS_SRC" ] || return 1
    cp -R "$KOSMOS_SRC/." "$dest/"
  else
    local url="$KOSMOS_RELEASE_BASE/kosmos-$ARCH.tar.gz"
    info "downloading from $url"
    curl -fL --progress-bar "$url" -o "$dest/kosmos.tar.gz" || return 1
    tar -xzf "$dest/kosmos.tar.gz" -C "$dest" && rm -f "$dest/kosmos.tar.gz"
  fi
  [ -x "$dest/bin/kosmos" ] || return 1
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
start_log() {
  mkdir -p "$LOG_DIR"
  exec 3>&1
  exec > >(tee -a "$LOG") 2>&1
  printf '\n=== kosmos install %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
}

# ---- uninstall --------------------------------------------------------------
uninstall() {
  step "Removing Kosmos."
  if [ -d "$KOSMOS_HOME" ]; then
    info "deleting $KOSMOS_HOME"
    rm -rf "$KOSMOS_HOME"
  fi
  for f in kosmos; do
    [ -e "$BIN_DIR/$f" ] && { info "removing $BIN_DIR/$f"; rm -f "$BIN_DIR/$f"; }
  done
  # The icon goes too, or uninstall leaves a dead app that opens nothing.
  [ -d "$HOME/Applications/Kosmos.app" ] && { info "removing the Kosmos app"; rm -rf "$HOME/Applications/Kosmos.app"; }
  # ⚠️ Deliberately NOT removed: the user's agents, their instruction files, and
  # anything under ~/work. Uninstalling the app must never delete somebody's
  # work, and an installer that cleans up too enthusiastically is worse than one
  # that leaves a folder behind.
  printf '\n  Kosmos is removed. Your agents and their files were left alone.\n\n'
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall

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
FRESH_INSTALL=yes
[ -d "$KOSMOS_HOME" ] && FRESH_INSTALL=no

start_log

printf '\n  Installing Kosmos\n'
printf '  This takes a couple of minutes and does not need your password.\n'

step "Checking this Mac."
case "$(uname -s)" in
  Darwin) ;;
  *) die "Kosmos runs on macOS. This looks like $(uname -s)." ;;
esac
ARCH="$(uname -m)"
info "macOS $(sw_vers -productVersion 2>/dev/null || echo '?') on $ARCH"
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
if [ -x "$KOSMOS_HOME/tmux/bin/tmux" ]; then
  info "the terminal manager is already here"
else
  info "installing a private copy of tmux (about 2MB, nothing system-wide)"
  # In a real release this fetches the signed bundle from the release URL. Kept
  # as a function so the clean-machine test can point it at a local file.
  fetch_tmux "$KOSMOS_HOME/tmux" || die "Could not set up the terminal manager."
fi
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
install_kosmos "$KOSMOS_HOME" || die "Could not install Kosmos."
ln -sf "$KOSMOS_HOME/bin/kosmos" "$BIN_DIR/kosmos"
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
# ⚠️ AND THIS DOES NOT REOPEN THE SETTLED "NO .app" DECISION. Requirements §122
# ruled out a DOWNLOADABLE app, because an unsigned app that arrives from the
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
  local app="$1"
  local target="$app/Contents"
  rm -rf "$app"
  mkdir -p "$target/MacOS" "$target/Resources"

  cat > "$target/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Kosmos</string>
  <key>CFBundleDisplayName</key><string>Kosmos</string>
  <key>CFBundleIdentifier</key><string>com.chaoskosmos.kosmos</string>
  <key>CFBundleExecutable</key><string>Kosmos</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleIconFile</key><string>Kosmos</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><false/>
</dict></plist>
PLIST

  # ⚠️ IT STARTS THE BOARD IF IT IS NOT RUNNING, rather than only opening a URL.
  # An icon that opens a dead page after a reboot is worse than no icon: the
  # person concludes the product broke, and they are not wrong to.
  cat > "$target/MacOS/Kosmos" <<LAUNCH
#!/bin/bash
KOSMOS_HOME="\${KOSMOS_HOME:-$KOSMOS_HOME}"
if ! /usr/bin/curl -fsS -m 2 http://127.0.0.1:4317/ >/dev/null 2>&1; then
  "\$KOSMOS_HOME/bin/kosmos" start >/dev/null 2>&1
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    /usr/bin/curl -fsS -m 1 http://127.0.0.1:4317/ >/dev/null 2>&1 && break
    sleep 1
  done
fi
exec /usr/bin/open "http://127.0.0.1:4317"
LAUNCH
  chmod +x "$target/MacOS/Kosmos"

  # The icon is optional so the installer never fails for the want of artwork.
  [ -f "$KOSMOS_HOME/Kosmos.icns" ] && cp "$KOSMOS_HOME/Kosmos.icns" "$target/Resources/Kosmos.icns"

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
APP_DIR="$HOME/Applications"
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
printf '  Your dashboard: http://127.0.0.1:4317\n\n'
printf '  To remove it later:  curl -fsSL https://chaoskosmos.com/setup | sh -s -- --uninstall\n\n'
