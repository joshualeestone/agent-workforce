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
trap 'if [ -f "$SB/home/board.pid" ]; then kill "$(cat "$SB/home/board.pid")" 2>/dev/null || true; fi; rm -rf "$SB"' EXIT
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
cat "$SETUP" | sh > "$SB/install.log" 2>&1
chk "install exits 0" "[ $? -eq 0 ]"
chk "board answers" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
chk "command works through the symlink" "\"$SB/bin/kosmos\" status | grep -q running"
chk "app bundle created" "[ -x \"$SB/apps/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "VERSION record installed" "[ -f \"$SB/home/VERSION\" ]"

echo "== update (stale file must not survive; board must restart) =="
touch "$SB/home/app/engine/stale-marker.js"
PID1="$(cat "$SB/home/board.pid")"
cat "$SETUP" | sh > "$SB/update.log" 2>&1
chk "update exits 0" "[ $? -eq 0 ]"
chk "stale file gone (swap, not merge)" "[ ! -e \"$SB/home/app/engine/stale-marker.js\" ]"
chk "board restarted (new pid)" "[ \"$PID1\" != \"$(cat "$SB/home/board.pid")\" ]"
chk "board serves after update" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"

echo "== refusals speak sentences =="
"$SB/bin/kosmos" stop > /dev/null 2>&1
OUT="$(sh -s -- --uninstal < "$SETUP" 2>&1 || true)"
chk "typo flag refuses instead of installing" "echo \"\$OUT\" | grep -q 'The only option is --uninstall'"

echo "== uninstall reverses the machine =="
printf '<plist/>' > "$SB/launch/com.kosmos.agent.tiharness.plist"
sh -s -- --uninstall < "$SETUP" > "$SB/uninstall.log" 2>&1
chk "uninstall exits 0" "[ $? -eq 0 ]"
chk "home gone" "[ ! -d \"$SB/home\" ]"
chk "symlink gone" "[ ! -e \"$SB/bin/kosmos\" ] && [ ! -L \"$SB/bin/kosmos\" ]"
chk "app gone" "[ ! -d \"$SB/apps/Kosmos.app\" ]"
chk "agent plist removed" "[ ! -e \"$SB/launch/com.kosmos.agent.tiharness.plist\" ]"
chk "user data untouched" "[ -d \"$SB/data\" ]"
chk "port released" "! curl -s -m 1 -o /dev/null http://127.0.0.1:$PORT/"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
