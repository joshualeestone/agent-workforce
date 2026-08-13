#!/bin/bash
# The install lifecycle, as a runnable regression test.
#
# Everything the installer's comments describe as measured-and-fixed (the
# staged swap, the identity probes, the honest refusals, the reversible
# uninstall) was verified by hand at least once; this harness is what keeps
# those verifications true without a human re-driving them. It runs the real
# setup.sh, piped into `sh` from stdin the way the marketing line does, with
# EVERY root the scripts write to overridden into a disposable sandbox.
#
# ⚠️ NOT part of plain `yarn test`, deliberately: it needs the staged trees
# in dist/ (build them first: tools/build-tmux-bundle.sh and
# tools/build-kosmos-bundle.sh, KOSMOS_ALLOW_MINOS=1 for a dev machine),
# it binds a TCP port, and it starts and stops real processes. Run it as
# `yarn test:install` before shipping installer changes.
#
# ⚠️ SAFE ON A MACHINE WITH A REAL BOARD: the port is probed free first,
# every root is under mktemp, and nothing touches launchd or tmux state
# outside the sandbox (the launchd dir is overridden; the tmux ownership
# predicate keeps session kills away from anything not marked ours).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
TMUX_SRC="$HERE/dist/tmux-bundle"
KOS_SRC="$HERE/dist/kosmos-bundle"

if [ ! -d "$TMUX_SRC" ] || [ ! -d "$KOS_SRC" ]; then
  echo "SKIP: dist/ staged trees missing. Build them first:" >&2
  echo "  KOSMOS_ALLOW_MINOS=1 tools/build-tmux-bundle.sh dist" >&2
  echo "  KOSMOS_ALLOW_MINOS=1 tools/build-kosmos-bundle.sh dist" >&2
  exit 1
fi

SB="$(mktemp -d)"
trap 'for _h in home home2 home3; do if [ -f "$SB/$_h/board.pid" ]; then kill "$(cat "$SB/$_h/board.pid")" 2>/dev/null || true; fi; done; chmod -R u+w "$SB" 2>/dev/null || true; rm -rf "$SB"' EXIT
mkdir -p "$SB/data" "$SB/launch"

# A free port, probed rather than assumed: several agents and a real board
# share dev machines.
PORT=4460
while curl -s -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; do
  PORT=$((PORT + 1))
  [ "$PORT" -lt 4500 ] || { echo "FAIL: no free port found in 4460-4499" >&2; exit 1; }
done

export KOSMOS_HOME="$SB/home" KOSMOS_BIN_DIR="$SB/bin" KOSMOS_APP_DIR="$SB/apps"
export KOSMOS_TMUX_SRC="$TMUX_SRC" KOSMOS_SRC="$KOS_SRC" KOSMOS_PORT="$PORT"
export AGENT_WORKFORCE_DATA="$SB/data" AGENT_WORKFORCE_LAUNCH="$SB/launch"

PASS=0; FAIL=0
chk() {
  if eval "$2"; then PASS=$((PASS + 1)); echo "PASS  $1"
  else FAIL=$((FAIL + 1)); echo "FAIL  $1"; fi
}

echo "== install (piped into sh, local sources, port $PORT) =="
RC=0; cat "$SETUP" | sh > "$SB/install.log" 2>&1 || RC=$?
chk "install exits 0" "[ $RC -eq 0 ]"
chk "board answers" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
chk "command works through the symlink" "\"$SB/bin/kosmos\" status | grep -q running"
chk "app bundle created" "[ -x \"$SB/apps/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "VERSION record installed" "[ -f \"$SB/home/VERSION\" ]"

echo "== update (stale file must not survive; board must restart) =="
touch "$SB/home/app/engine/stale-marker.js"
PID1="$(cat "$SB/home/board.pid")"
RC=0; cat "$SETUP" | sh > "$SB/update.log" 2>&1 || RC=$?
chk "update exits 0" "[ $RC -eq 0 ]"
chk "stale file gone (swap, not merge)" "[ ! -e \"$SB/home/app/engine/stale-marker.js\" ]"
chk "board restarted (new pid)" "[ \"$PID1\" != \"$(cat "$SB/home/board.pid")\" ]"
chk "board serves after update" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"

echo "== refusals speak sentences =="
OUT="$(sh -s -- --uninstal < "$SETUP" 2>&1 || true)"
chk "typo flag refuses instead of installing" "echo \"\$OUT\" | grep -q 'The only option is --uninstall'"

echo "== uninstall reverses the machine =="
printf '<plist/>' > "$SB/launch/com.kosmos.agent.tiharness.plist"
RC=0; sh -s -- --uninstall < "$SETUP" > "$SB/uninstall.log" 2>&1 || RC=$?
chk "uninstall exits 0" "[ $RC -eq 0 ]"
chk "home gone" "[ ! -d \"$SB/home\" ]"
chk "symlink gone" "[ ! -e \"$SB/bin/kosmos\" ] && [ ! -L \"$SB/bin/kosmos\" ]"
chk "app gone" "[ ! -d \"$SB/apps/Kosmos.app\" ]"
chk "agent plist removed" "[ ! -e \"$SB/launch/com.kosmos.agent.tiharness.plist\" ]"
chk "user data untouched" "[ -d \"$SB/data\" ]"
chk "port released (uninstall stopped the board itself)" "! curl -s -m 1 -o /dev/null http://127.0.0.1:$PORT/"

echo "== the download path (file:// origin, no local-copy shortcut) =="
# The local-copy branch above never runs reachable(), verify_download() or
# tar; the release path must be driven too, and curl serves file:// for
# both probes, so no server is needed. A flipped byte in the sidecar must
# refuse in a sentence.
mkdir -p "$SB/dist"
cp "$HERE/dist/tmux-arm64.tar.gz" "$HERE/dist/tmux-arm64.tar.gz.sha256" \
   "$HERE/dist/kosmos-arm64.tar.gz" "$HERE/dist/kosmos-arm64.tar.gz.sha256" "$SB/dist/" 2>/dev/null \
  || { echo "SKIP download-path pass: packed tarballs missing from dist/"; exit 0; }
unset KOSMOS_TMUX_SRC KOSMOS_SRC
export KOSMOS_RELEASE_BASE="file://$SB/dist"
RC=0; cat "$SETUP" | sh > "$SB/dl-install.log" 2>&1 || RC=$?
chk "download-path install exits 0" "[ $RC -eq 0 ]"
chk "download-path board answers" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
"$SB/bin/kosmos" stop > /dev/null 2>&1
sh -s -- --uninstall < "$SETUP" > /dev/null 2>&1
printf 'x' >> "$SB/dist/kosmos-arm64.tar.gz"
RC=0; cat "$SETUP" | sh > "$SB/tamper.log" 2>&1 || RC=$?
chk "tampered download refuses" "[ $RC -ne 0 ]"
chk "tamper refusal speaks a sentence" "grep -q 'did not arrive intact' \"$SB/tamper.log\""
chk "no stage residue after refusal" "[ -z \"\$(ls -d \"$SB/home\"/.kosmos.stage.* 2>/dev/null)\" ]"

echo "== the Applications probe (system folder when writable, home when not) =="
# ⚠️ These passes leave KOSMOS_APP_DIR EMPTY on purpose -- they exercise the
# very branches that override bypasses -- so every OTHER root the probe code
# can touch is pointed into the sandbox instead: KOSMOS_SYS_APP_DIR replaces
# /Applications and HOME replaces the real home. A fallback that only ever
# runs where the primary works is untested by construction; the probe's
# failure leg is the one a standard (non-admin) user lives on.
export KOSMOS_TMUX_SRC="$TMUX_SRC" KOSMOS_SRC="$KOS_SRC"
unset KOSMOS_RELEASE_BASE
SBH="$SB/probe-home"
SYS_OK="$SB/sysapps"
mkdir -p "$SBH" "$SYS_OK"
# A stale icon from a pre-2026-08-13 install: the system-folder install must
# clean it up, or the machine keeps two Kosmos icons, one of them dead-stale.
mkdir -p "$SBH/Applications/Kosmos.app"
export KOSMOS_HOME="$SB/home2" KOSMOS_BIN_DIR="$SB/bin2"
RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" sh > "$SB/probe1.log" 2>&1 || RC=$?
chk "probe install exits 0" "[ $RC -eq 0 ]"
chk "app landed in the system folder" "[ -x \"$SYS_OK/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "transcript names Applications" "grep -q 'you will find it in Applications, as Kosmos' \"$SB/probe1.log\""
chk "stale home-folder icon cleaned up" "[ ! -d \"$SBH/Applications/Kosmos.app\" ]"
chk "no probe residue in the system folder" "[ -z \"\$(ls -A \"$SYS_OK\" | grep -v '^Kosmos.app\$')\" ]"
"$SB/bin2/kosmos" stop > /dev/null 2>&1 || true

SYS_RO="$SB/sysro"
mkdir -p "$SYS_RO"
chmod 555 "$SYS_RO"
export KOSMOS_HOME="$SB/home3" KOSMOS_BIN_DIR="$SB/bin3"
RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO" sh > "$SB/probe2.log" 2>&1 || RC=$?
chk "fallback install exits 0" "[ $RC -eq 0 ]"
chk "app fell back to the home folder" "[ -x \"$SBH/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "transcript names the home folder" "grep -q 'Applications folder inside your home folder' \"$SB/probe2.log\""
chk "no probe residue in the read-only folder" "[ -z \"\$(ls -A \"$SYS_RO\")\" ]"
chmod 755 "$SYS_RO"

# The uninstall sweep must clear BOTH default locations (older installs wrote
# the home folder, newer prefer the system one) -- seed the system folder
# with the pass-1 app still there and the home folder with pass-2's.
RC=0; HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" sh -s -- --uninstall < "$SETUP" > "$SB/probe-un.log" 2>&1 || RC=$?
chk "sweep uninstall exits 0" "[ $RC -eq 0 ]"
chk "system-folder icon swept" "[ ! -d \"$SYS_OK/Kosmos.app\" ]"
chk "home-folder icon swept" "[ ! -d \"$SBH/Applications/Kosmos.app\" ]"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
