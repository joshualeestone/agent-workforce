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
# LaunchServices too: setup.sh skips lsregister whenever a sandbox
# override is set, so sandbox bundles never enter the operator's real
# machine-global database (dozens of dead mktemp paths had registered
# under the production bundle id before that gate existed).

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
# The board-kill list is a glob, not a hardcoded home/home2/... list: a
# future pass that adds a seventh sandbox home must not silently leak a
# board process onto the operator's machine.
trap 'for _p in "$SB"/home*/board.pid; do if [ -f "$_p" ]; then kill "$(cat "$_p")" 2>/dev/null || true; fi; done; chflags -R nouchg "$SB" 2>/dev/null || true; chmod -R u+w "$SB" 2>/dev/null || true; rm -rf "$SB"' EXIT
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
# A test that steals the operator's browser is a test nobody runs twice:
# every pass suppresses the fresh-install open unless it deliberately
# substitutes the recording stub below to assert the open itself.
export KOSMOS_NO_OPEN=1
# Points the system-folder probe at a directory that must stay EMPTY for
# every pass that sets KOSMOS_APP_DIR: the override must bypass the probe
# entirely, or every sandboxed run on a dev machine would be creating and
# removing directories in the real /Applications.
mkdir -p "$SB/sysnever"
export KOSMOS_SYS_APP_DIR="$SB/sysnever"
# The directory's fractional mtime, not its contents: a probe that mkdirs
# and then rmdirs leaves the folder empty, so an emptiness check cannot
# fail for the thing it names. A create-and-remove does move the mtime.
SYSNEVER_MTIME="$(stat -f %Fm "$SB/sysnever")"
# A convention-not-enforcement net for the operator's REAL folders: the
# probe passes below run with KOSMOS_APP_DIR deliberately empty, relying on
# every such invocation also overriding HOME. Snapshot the real folders and
# fail loudly at the end if anything changed them.
# Names alone cannot see an in-place replacement (the single most likely
# real-folder mutation on a dev machine with a real Kosmos install), so the
# snapshot hashes name + mtime + size of every top-level entry.
real_apps_fingerprint() {
  # ⚠️ A MISSING FOLDER FINGERPRINTS AS "absent", IT DOES NOT KILL THE RUN.
  # A never-touched Mac has no ~/Applications until something creates it,
  # and under set -euo pipefail a failing find aborted the whole harness
  # with zero output before a single assertion ran (measured with
  # HOME=/tmp/kosmos-nohome: exit 1, no sentences). %Fm not %m, so a
  # same-second create-and-delete still moves the fingerprint.
  [ -d "$1" ] || { printf 'absent\n'; return 0; }
  find "$1" -maxdepth 1 -exec stat -f '%N %Fm %z' {} \; 2>/dev/null | sort | shasum | cut -d' ' -f1 || true
}
REAL_HOME_APPS_BEFORE="$(real_apps_fingerprint "$HOME/Applications")"
REAL_SYS_APPS_BEFORE="$(real_apps_fingerprint /Applications)"
cat > "$SB/open-stub" <<EOS
#!/bin/sh
echo "\$@" >> "$SB/opened.log"
EOS
chmod +x "$SB/open-stub"

PASS=0; FAIL=0; SKIPS=0
chk() {
  if eval "$2"; then PASS=$((PASS + 1)); echo "PASS  $1"
  else FAIL=$((FAIL + 1)); echo "FAIL  $1"; fi
}

seed_kosmos_bundle() { # $1 = Applications dir, $2 = the KOSMOS_HOME it bakes
  mkdir -p "$1/Kosmos.app/Contents/MacOS"
  printf '#!/bin/bash\nKOSMOS_HOME="${KOSMOS_HOME:-%s}"\n' "$2" > "$1/Kosmos.app/Contents/MacOS/Kosmos"
}
seed_residue() { # $1 = full residue path, $2 = the KOSMOS_HOME it bakes
  mkdir -p "$1/Contents/MacOS"
  printf '#!/bin/bash\nKOSMOS_HOME="${KOSMOS_HOME:-%s}"\n' "$2" > "$1/Contents/MacOS/Kosmos"
}

echo "== install (piped into sh, local sources, port $PORT) =="
RC=0; cat "$SETUP" | sh > "$SB/install.log" 2>&1 || RC=$?
chk "install exits 0" "[ $RC -eq 0 ]"
chk "board answers" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
chk "command works through the symlink" "\"$SB/bin/kosmos\" status | grep -q running"
chk "app bundle created" "[ -x \"$SB/apps/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "VERSION record installed" "[ -f \"$SB/home/VERSION\" ]"
chk "KOSMOS_APP_DIR bypasses the probe entirely" "[ \"\$(stat -f %Fm \"$SB/sysnever\")\" = \"$SYSNEVER_MTIME\" ] && [ -z \"\$(ls -A \"$SB/sysnever\")\" ]"
# The generated launcher, actually executed: the account guard must PASS
# for the account that installed (a uid compare, exactly the leg the old
# under-HOME proxy false-alarmed on), the env KOSMOS_HOME override must be
# honored, and `open` must be what it invokes. The stub home keeps the
# real board and the real browser out of it. The refusal leg is driven
# just below by a copy with a wrong baked uid, since a real second uid is
# not available to the harness.
mkdir -p "$SB/fakehome/bin"
printf '#!/bin/sh\necho "$@" >> "%s/launcher.log"\nexit 0\n' "$SB" > "$SB/fakehome/bin/kosmos"
chmod +x "$SB/fakehome/bin/kosmos"
RC=0; KOSMOS_HOME="$SB/fakehome" "$SB/apps/Kosmos.app/Contents/MacOS/Kosmos" > /dev/null 2>&1 || RC=$?
chk "launcher passes its own account and opens" "[ $RC -eq 0 ] && grep -qx 'open' \"$SB/launcher.log\""
chk "the launcher bakes this install's port" "grep -q \"KOSMOS_PORT:-$PORT\" \"$SB/apps/Kosmos.app/Contents/MacOS/Kosmos\""
# The NEGATIVE control: the refusal is the guard's whole purpose, and
# without this the entire uid block could be deleted while the suite
# stayed green. A copy with a wrong baked uid must refuse (exit 1) and
# invoke nothing. osascript is swapped for /usr/bin/true in the copy so
# the alert never reaches the operator's screen on a GUI dev machine.
sed -e 's|!= "[0-9][0-9]*"|!= "99999"|' -e 's|/usr/bin/osascript|/usr/bin/true|' \
  "$SB/apps/Kosmos.app/Contents/MacOS/Kosmos" > "$SB/other-account-launcher"
chmod +x "$SB/other-account-launcher"
LNS_BEFORE="$(wc -l < "$SB/launcher.log" | tr -d ' ')"
RC=0; KOSMOS_HOME="$SB/fakehome" "$SB/other-account-launcher" > /dev/null 2>&1 || RC=$?
chk "launcher refuses a different account" "[ $RC -eq 1 ] && [ \"\$(wc -l < \"$SB/launcher.log\" | tr -d ' ')\" = \"$LNS_BEFORE\" ]"

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
seed_residue "$SB/apps/.Kosmos.app.stage.333" "$SB/home"
seed_residue "$SB/apps/.Kosmos.app.old.444" "$SB/home"
RC=0; sh -s -- --uninstall < "$SETUP" > "$SB/uninstall.log" 2>&1 || RC=$?
chk "uninstall exits 0" "[ $RC -eq 0 ]"
chk "home gone" "[ ! -d \"$SB/home\" ]"
chk "symlink gone" "[ ! -e \"$SB/bin/kosmos\" ] && [ ! -L \"$SB/bin/kosmos\" ]"
chk "app gone" "[ ! -d \"$SB/apps/Kosmos.app\" ]"
chk "override-branch stage and aside residue swept" "[ ! -e \"$SB/apps/.Kosmos.app.stage.333\" ] && [ ! -e \"$SB/apps/.Kosmos.app.old.444\" ]"
chk "agent plist removed" "[ ! -e \"$SB/launch/com.kosmos.agent.tiharness.plist\" ]"
chk "user data untouched" "[ -d \"$SB/data\" ]"
chk "port released (uninstall stopped the board itself)" "! curl -s -m 1 -o /dev/null http://127.0.0.1:$PORT/"

echo "== the download path (file:// origin, no local-copy shortcut) =="
# The local-copy branch above never runs reachable(), verify_download() or
# tar; the release path must be driven too, and curl serves file:// for
# both probes, so no server is needed. A flipped byte in the sidecar must
# refuse in a sentence.
mkdir -p "$SB/dist"
# ⚠️ A missing tarball SKIPS ONLY THIS BLOCK, loudly and counted. The first
# version exited 0 here, so a machine with the staged trees but not the
# packed tarballs ran none of the later passes and still printed "N
# passed, 0 failed" -- a partial run indistinguishable from a full one.
if cp "$HERE/dist/tmux-arm64.tar.gz" "$HERE/dist/tmux-arm64.tar.gz.sha256" \
   "$HERE/dist/kosmos-arm64.tar.gz" "$HERE/dist/kosmos-arm64.tar.gz.sha256" "$SB/dist/" 2>/dev/null; then
  unset KOSMOS_TMUX_SRC KOSMOS_SRC
  export KOSMOS_RELEASE_BASE="file://$SB/dist"
  RC=0; cat "$SETUP" | sh > "$SB/dl-install.log" 2>&1 || RC=$?
  chk "download-path install exits 0" "[ $RC -eq 0 ]"
  chk "download-path board answers" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
  "$SB/bin/kosmos" stop > /dev/null 2>&1 || true
  sh -s -- --uninstall < "$SETUP" > /dev/null 2>&1 || true
  printf 'x' >> "$SB/dist/kosmos-arm64.tar.gz"
  RC=0; cat "$SETUP" | sh > "$SB/tamper.log" 2>&1 || RC=$?
  chk "tampered download refuses" "[ $RC -ne 0 ]"
  chk "tamper refusal speaks a sentence" "grep -q 'did not arrive intact' \"$SB/tamper.log\""
  chk "no stage residue after refusal" "[ -z \"\$(ls -d \"$SB/home\"/.kosmos.stage.* 2>/dev/null)\" ]"
else
  echo "SKIP download-path passes: packed tarballs missing from dist/ (later passes still run)"
  SKIPS=$((SKIPS + 1))
fi

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
# The fixture is a REAL bundle carrying the launcher line, because the
# cleanup (rightly) demands proof of ownership before deleting; a bare
# directory would pin nothing but the ownership refusal.
seed_kosmos_bundle "$SBH/Applications" "$SB/home2"
export KOSMOS_HOME="$SB/home2" KOSMOS_BIN_DIR="$SB/bin2"
# KOSMOS_NO_OPEN is cleared and the open command is the recording stub, so
# this pass also pins the one behavior a hardcoded /usr/bin/open hid from
# the suite: a fresh install invokes the open, an update does not.
RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/probe1.log" 2>&1 || RC=$?
chk "probe install exits 0" "[ $RC -eq 0 ]"
chk "app landed in the system folder" "[ -x \"$SYS_OK/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "transcript names Applications" "grep -q 'you will find it in Applications, as Kosmos' \"$SB/probe1.log\""
chk "stale home-folder icon cleaned up" "[ ! -d \"$SBH/Applications/Kosmos.app\" ]"
chk "the move is named in the transcript" "grep -q 'icon moved here' \"$SB/probe1.log\""
chk "no probe residue in the system folder" "[ -z \"\$(ls -A \"$SYS_OK\" | grep -v '^Kosmos.app\$')\" ]"
chk "the TCC warm-up prints for a system-folder icon" "grep -q 'manage apps' \"$SB/probe1.log\""
chk "fresh install opened the dashboard" "[ \"\$(wc -l < \"$SB/opened.log\" 2>/dev/null | tr -d ' ')\" = \"1\" ] && grep -q \"127.0.0.1:$PORT\" \"$SB/opened.log\""

# The update run through the same probe env must NOT open the browser.
RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/probe1b.log" 2>&1 || RC=$?
chk "probe update exits 0" "[ $RC -eq 0 ]"
chk "update did not open the dashboard" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"1\" ]"
"$SB/bin2/kosmos" stop > /dev/null 2>&1 || true

export KOSMOS_HOME="$SB/home3" KOSMOS_BIN_DIR="$SB/bin3"
if [ "$(id -u)" -eq 0 ]; then
  # chmod 555 does not deny root, so the probe would succeed against the
  # "read-only" folder and every fallback assertion would fail for an
  # environment reason. Skip loudly and seed the icon the sweep pass below
  # expects the fallback install to have left.
  echo "SKIP fallback leg: running as root, chmod 555 does not deny root"
  SKIPS=$((SKIPS + 1))
  seed_kosmos_bundle "$SBH/Applications" "$SB/home3"
else
  SYS_RO="$SB/sysro"
  mkdir -p "$SYS_RO"
  chmod 555 "$SYS_RO"
  # KOSMOS_NO_OPEN stays exported here: a fresh install with the suppressor
  # set must stay quiet, which pins the suppressor itself.
  RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO" KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/probe2.log" 2>&1 || RC=$?
  chk "fallback install exits 0" "[ $RC -eq 0 ]"
  chk "app fell back to the home folder" "[ -x \"$SBH/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "transcript names the home folder" "grep -q 'you will find it in the Applications folder inside your home folder' \"$SB/probe2.log\""
  chk "no probe residue in the read-only folder" "[ -z \"\$(ls -A \"$SYS_RO\")\" ]"
  chk "no TCC warm-up when the icon goes to the home folder" "! grep -q 'manage apps' \"$SB/probe2.log\""
  chk "KOSMOS_NO_OPEN suppressed the fresh-install open" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"1\" ]"
  chmod 755 "$SYS_RO"
fi

echo "== the uninstall sweep proves ownership before deleting =="
# The system-folder icon was installed by the home2 install; this uninstall
# runs as the home3 install, so the sweep must take the per-user icon and
# REFUSE the shared one it does not own, in a sentence.
RC=0; HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" sh -s -- --uninstall < "$SETUP" > "$SB/probe-un.log" 2>&1 || RC=$?
chk "sweep uninstall exits 0" "[ $RC -eq 0 ]"
chk "home-folder icon swept" "[ ! -d \"$SBH/Applications/Kosmos.app\" ]"
chk "another install's system icon left alone" "[ -d \"$SYS_OK/Kosmos.app\" ]"
chk "the refusal speaks a sentence" "grep -q \"in $SYS_OK could not be proven to belong to this install\" \"$SB/probe-un.log\""
# The OWNER's uninstall takes it. Probe and stage residue are seeded first
# so the sweep the served header PROMISES ("--uninstall sweeps it") is
# pinned rather than assumed, in both folders.
# The swept residue must be PROVABLY OURS (the sweep now demands the same
# launcher token as the visible bundle); one foreign aside is seeded too
# and must survive, named, because an aside can be another account's only
# surviving icon.
seed_residue "$SYS_OK/.Kosmos.app.stage.999" "$SB/home2"
seed_residue "$SYS_OK/.Kosmos.app.old.111" "$SB/home2"
seed_residue "$SYS_OK/.Kosmos.app.old.333" "/another/accounts/kosmos"
seed_residue "$SBH/Applications/.Kosmos.app.stage.888" "$SB/home2"
seed_residue "$SBH/Applications/.Kosmos.app.old.222" "$SB/home2"
mkdir -p "$SYS_OK/.kosmos-write-probe.777"
export KOSMOS_HOME="$SB/home2" KOSMOS_BIN_DIR="$SB/bin2"
RC=0; HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" sh -s -- --uninstall < "$SETUP" > "$SB/probe-un2.log" 2>&1 || RC=$?
chk "owner uninstall exits 0" "[ $RC -eq 0 ]"
chk "system-folder icon swept by its owner" "[ ! -d \"$SYS_OK/Kosmos.app\" ]"
chk "our stage and probe residue swept from the system folder" "[ ! -e \"$SYS_OK/.Kosmos.app.stage.999\" ] && [ ! -e \"$SYS_OK/.kosmos-write-probe.777\" ] && [ ! -e \"$SYS_OK/.Kosmos.app.old.111\" ]"
chk "the foreign aside survives" "[ -d \"$SYS_OK/.Kosmos.app.old.333\" ]"
chk "the foreign aside is named" "grep -q '.Kosmos.app.old.333 could not be proven to belong to this install' \"$SB/probe-un2.log\""
chk "stage residue swept from the home folder" "[ ! -e \"$SBH/Applications/.Kosmos.app.stage.888\" ]"
chk "aside residue swept from the home folder" "[ ! -e \"$SBH/Applications/.Kosmos.app.old.222\" ]"

echo "== aliased folders (~/Applications symlinked to the system folder) =="
# The failure this pins: with ~/Applications a symlink to the system
# folder, the stale-icon cleanup and the home-folder sweep both look
# THROUGH the link at the bundle the other branch owns. Delete either
# pwd -P guard in setup.sh and these assertions fail: the install would
# remove the app it just wrote, the foreign uninstall would delete a
# bundle its ownership check had just refused.
SBH3="$SB/alias-home"
SYSALIAS="$SB/sysalias"
mkdir -p "$SBH3" "$SYSALIAS"
ln -s "$SYSALIAS" "$SBH3/Applications"
export KOSMOS_HOME="$SB/home4" KOSMOS_BIN_DIR="$SB/bin4"
RC=0; cat "$SETUP" | HOME="$SBH3" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS" sh > "$SB/alias.log" 2>&1 || RC=$?
chk "aliased install exits 0" "[ $RC -eq 0 ]"
chk "app survives its own stale-icon cleanup" "[ -x \"$SYSALIAS/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "no phantom move sentence" "! grep -q 'icon moved here' \"$SB/alias.log\""
"$SB/bin4/kosmos" stop > /dev/null 2>&1 || true
# A DIFFERENT install's uninstall in the aliased world: the ownership
# check refuses the system icon, and the home sweep must not delete it
# through the symlink either.
RC=0; HOME="$SBH3" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS" KOSMOS_HOME="$SB/home5" KOSMOS_BIN_DIR="$SB/bin5" sh -s -- --uninstall < "$SETUP" > "$SB/alias-un.log" 2>&1 || RC=$?
chk "foreign uninstall exits 0 in the aliased world" "[ $RC -eq 0 ]"
chk "refused bundle survives the aliased home sweep" "[ -d \"$SYSALIAS/Kosmos.app\" ]"
# The owner's uninstall takes it, exactly once, with no survivor note.
RC=0; HOME="$SBH3" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS" sh -s -- --uninstall < "$SETUP" > "$SB/alias-un2.log" 2>&1 || RC=$?
chk "owner uninstall exits 0 in the aliased world" "[ $RC -eq 0 ]"
chk "aliased bundle removed by its owner" "[ ! -d \"$SYSALIAS/Kosmos.app\" ]"
chk "no spurious survivor note" "! grep -q 'could not remove' \"$SB/alias-un2.log\""

echo "== a foreign Kosmos.app in the system folder is never claimed =="
# The failure this pins: an app named Kosmos that this installer did NOT
# create sits at the system path. make_app begins with rm -rf on its
# target, so claiming the path destroys a stranger's app while printing
# success. The install must divert to the per-user folder, say so, and
# leave the foreign bundle byte-identical.
SYS_FOREIGN="$SB/sysforeign"
mkdir -p "$SYS_FOREIGN/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# not ours\nKOSMOS_HOME="${KOSMOS_HOME:-/somewhere/else/kosmos}"\n' > "$SYS_FOREIGN/Kosmos.app/Contents/MacOS/KosmosDesktop"
SBH4="$SB/divert-home"
mkdir -p "$SBH4"
export KOSMOS_HOME="$SB/home6" KOSMOS_BIN_DIR="$SB/bin6"
RC=0; cat "$SETUP" | HOME="$SBH4" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_FOREIGN" sh > "$SB/divert.log" 2>&1 || RC=$?
chk "divert install exits 0" "[ $RC -eq 0 ]"
chk "foreign bundle untouched" "grep -q 'not ours' \"$SYS_FOREIGN/Kosmos.app/Contents/MacOS/KosmosDesktop\""
chk "our app went to the home folder instead" "[ -x \"$SBH4/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the divert speaks its own sentence" "grep -q 'something else already has the Kosmos spot' \"$SB/divert.log\""
"$SB/bin6/kosmos" stop > /dev/null 2>&1 || true

echo "== foreign bundle PLUS aliased folders: no icon at all, said honestly =="
# The composed case: something not ours holds the system spot AND the home
# Applications folder is a symlink to the same place. "Divert to the home
# folder" would write straight back through the link onto the bundle the
# ownership check just refused, so the only honest outcome is no icon,
# with a sentence, and the stranger's app byte-identical.
SYSALIAS2="$SB/sysalias2"
mkdir -p "$SYSALIAS2/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# stranger\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/at/all}"\n' > "$SYSALIAS2/Kosmos.app/Contents/MacOS/Kosmos"
SBH7="$SB/alias-foreign-home"
mkdir -p "$SBH7"
ln -s "$SYSALIAS2" "$SBH7/Applications"
export KOSMOS_HOME="$SB/home9" KOSMOS_BIN_DIR="$SB/bin9"
RC=0; cat "$SETUP" | HOME="$SBH7" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS2" sh > "$SB/alias-foreign.log" 2>&1 || RC=$?
chk "foreign-aliased install exits 0" "[ $RC -eq 0 ]"
chk "the stranger's app is byte-identical" "grep -q 'stranger' \"$SYSALIAS2/Kosmos.app/Contents/MacOS/Kosmos\""
chk "no icon was written anywhere" "[ \"\$(ls -A \"$SYSALIAS2\" | grep -cv '^Kosmos.app\$')\" = \"0\" ]"
chk "the skip speaks its own sentence" "grep -q 'is the same folder, so no icon was created' \"$SB/alias-foreign.log\""
"$SB/bin9/kosmos" stop > /dev/null 2>&1 || true

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP wedge and survivor-note legs: running as root, chmod denials do not bind"
  SKIPS=$((SKIPS + 1))
else
  echo "== a bundle that cannot be replaced sends the icon to the home folder =="
  # The retry leg: the system folder is writable (the probe passes) but the
  # bundle inside it cannot be moved aside (user-immutable, the flag a
  # leftover can carry; rename fails EPERM on an immutable source, and
  # chflags binds even root, unlike the chmod shapes). The ownership line
  # matches, so the divert does not fire; make_app must fail on the swap,
  # clean its stage AND its aside, leave the old bundle whole, and the
  # retry must land the icon in the home folder.
  SYS_WEDGE="$SB/syswedge"
  seed_kosmos_bundle "$SYS_WEDGE" "$SB/home7"
  chflags uchg "$SYS_WEDGE/Kosmos.app"
  SBH5="$SB/wedge-home"
  mkdir -p "$SBH5"
  export KOSMOS_HOME="$SB/home7" KOSMOS_BIN_DIR="$SB/bin7"
  RC=0; cat "$SETUP" | HOME="$SBH5" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_WEDGE" sh > "$SB/wedge.log" 2>&1 || RC=$?
  chk "wedge install exits 0" "[ $RC -eq 0 ]"
  chk "retry landed the icon in the home folder" "[ -x \"$SBH5/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "retry sentence names the home folder" "grep -q 'you will find it in the Applications folder inside your home folder' \"$SB/wedge.log\""
  chk "the unmovable bundle was never gutted" "[ -f \"$SYS_WEDGE/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "the surviving system icon is named" "grep -q 'could not be replaced; use the' \"$SB/wedge.log\""
  chk "no stage or aside residue in the wedged folder" "[ -z \"\$(ls -A \"$SYS_WEDGE\" | grep -v '^Kosmos.app\$')\" ]"
  chflags nouchg "$SYS_WEDGE/Kosmos.app"
  "$SB/bin7/kosmos" stop > /dev/null 2>&1 || true

  echo "== a deep-locked old bundle can no longer wedge the slot =="
  # The reproduced husk: rm -rf on a bundle with one unwritable nested
  # directory deletes the launcher, then dies, leaving a husk no later
  # ownership check can prove and no uninstall will touch. The rename-
  # aside swap must leave the VISIBLE slot holding a complete bundle at
  # every moment; the locked residue may survive only under the hidden
  # aside name.
  SYS_DEEP="$SB/sysdeep"
  seed_kosmos_bundle "$SYS_DEEP" "$SB/home19"
  mkdir -p "$SYS_DEEP/Kosmos.app/Contents/Resources/sub"
  touch "$SYS_DEEP/Kosmos.app/Contents/Resources/sub/keep"
  chmod 555 "$SYS_DEEP/Kosmos.app/Contents/Resources/sub"
  SBH17="$SB/deep-home"
  mkdir -p "$SBH17"
  export KOSMOS_HOME="$SB/home19" KOSMOS_BIN_DIR="$SB/bin19"
  RC=0; cat "$SETUP" | HOME="$SBH17" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_DEEP" sh > "$SB/deep.log" 2>&1 || RC=$?
  chk "deep-locked reinstall exits 0" "[ $RC -eq 0 ]"
  chk "the visible slot holds a complete bundle" "[ -x \"$SYS_DEEP/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "the new bundle is provably ours" "grep -qF \":-$SB/home19}\\\"\" \"$SYS_DEEP/Kosmos.app/Contents/MacOS/Kosmos\""
  chk "the locked aside is named at install time" "grep -q 'could not remove the leftover hidden folder' \"$SB/deep.log\""
  "$SB/bin19/kosmos" stop > /dev/null 2>&1 || true
  # ⚠️ The lock STAYS for the uninstall. The first version of this pass
  # unlocked before uninstalling, which undid the exact condition under
  # test and let a silent best-effort sweep read as a kept promise. The
  # served header says the sweep names what it cannot remove; hold it to
  # that.
  RC=0; HOME="$SBH17" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_DEEP" sh -s -- --uninstall < "$SETUP" > "$SB/deep-un.log" 2>&1 || RC=$?
  chk "deep-world uninstall exits 0" "[ $RC -eq 0 ]"
  chk "deep-world slot fully cleared" "[ ! -e \"$SYS_DEEP/Kosmos.app\" ]"
  # The aside here is OUR OWN, gutted unprovable by its best-effort
  # cleanup dying on the locked dir; either it is gone, or the transcript
  # names it (as unremovable, or as unprovable, whichever was observed).
  chk "surviving locked residue is gone or named" "[ -z \"\$(ls -A \"$SYS_DEEP\" 2>/dev/null | grep '.Kosmos.app.old')\" ] || grep -Eq 'could not remove the leftover hidden folder|could not be proven to belong to this install' \"$SB/deep-un.log\""
  chmod -R u+w "$SYS_DEEP" 2>/dev/null || true

  echo "== a survivor is NAMED (positive control for the could-not-remove note) =="
  # Without this pass the survivor-note branches could be deleted whole and
  # the suite would stay green: the note was only ever asserted absent. A
  # write-locked containing folder makes the owner's own rm fail, which
  # must produce the sentence, not silence.
  SYS_LOCKED="$SB/syslocked"
  seed_kosmos_bundle "$SYS_LOCKED" "$SB/home8"
  chmod 555 "$SYS_LOCKED"
  export KOSMOS_HOME="$SB/home8" KOSMOS_BIN_DIR="$SB/bin8"
  SBH6="$SB/locked-home"
  mkdir -p "$SBH6"
  RC=0; HOME="$SBH6" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_LOCKED" sh -s -- --uninstall < "$SETUP" > "$SB/locked-un.log" 2>&1 || RC=$?
  chk "locked uninstall exits 0" "[ $RC -eq 0 ]"
  chk "the survivor is named" "grep -q 'could not remove' \"$SB/locked-un.log\""
  chk "the survivor survives" "[ -d \"$SYS_LOCKED/Kosmos.app\" ]"
  chmod 755 "$SYS_LOCKED"
fi

echo "== the cleanup and uninstall notes each have a driving pass =="
# A foreign Kosmos.app in the HOME folder at cleanup time: the system-folder
# install must leave it and name it (setup.sh's "not created by this
# install is in the Applications folder inside your home folder").
SBH9="$SB/foreign-home"
mkdir -p "$SBH9/Applications/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# theirs\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours}"\n' > "$SBH9/Applications/Kosmos.app/Contents/MacOS/Kosmos"
SYS_OK3="$SB/sysok3"
mkdir -p "$SYS_OK3"
export KOSMOS_HOME="$SB/home10" KOSMOS_BIN_DIR="$SB/bin10"
RC=0; cat "$SETUP" | HOME="$SBH9" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK3" sh > "$SB/fhome.log" 2>&1 || RC=$?
chk "foreign-home install exits 0" "[ $RC -eq 0 ]"
chk "foreign home bundle survives the cleanup" "grep -q 'theirs' \"$SBH9/Applications/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the foreign home bundle is named" "grep -q 'not created by this install is in the Applications folder inside your home folder' \"$SB/fhome.log\""
"$SB/bin10/kosmos" stop > /dev/null 2>&1 || true
# Its uninstall drives the home-folder refusal note too.
RC=0; HOME="$SBH9" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK3" sh -s -- --uninstall < "$SETUP" > "$SB/fhome-un.log" 2>&1 || RC=$?
chk "foreign-home uninstall exits 0" "[ $RC -eq 0 ]"
chk "home refusal speaks its sentence" "grep -q 'inside your home folder was not created by this install' \"$SB/fhome-un.log\""
chk "foreign home bundle survives uninstall" "[ -d \"$SBH9/Applications/Kosmos.app\" ]"

# An unresolvable SYSTEM folder on uninstall: the fail-closed note must
# name the side that failed the check, and the home icon must survive.
SBH10="$SB/nosys-home"
mkdir -p "$SBH10"
seed_kosmos_bundle "$SBH10/Applications" "$SB/home11"
export KOSMOS_HOME="$SB/home11" KOSMOS_BIN_DIR="$SB/bin11"
RC=0; HOME="$SBH10" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SB/no-such-sys" sh -s -- --uninstall < "$SETUP" > "$SB/nosys-un.log" 2>&1 || RC=$?
chk "no-sys uninstall exits 0" "[ $RC -eq 0 ]"
chk "fail-closed note names the system folder" "grep -q \"could not check $SB/no-such-sys\" \"$SB/nosys-un.log\""
chk "home icon left alone under fail-closed" "[ -d \"$SBH10/Applications/Kosmos.app\" ]"

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP chmod-denial note legs: running as root"
  SKIPS=$((SKIPS + 1))
else
  # The move-cleanup's OWN failure note: a write-locked home Applications
  # makes the stale icon undeletable, and the survivor must be named
  # ("an older Kosmos icon is still...").
  SBH11="$SB/locked-stale-home"
  seed_kosmos_bundle "$SBH11/Applications" "$SB/home12"
  # Lock the INNERMOST directory, not Applications: rm -rf deletes
  # depth-first, so an outer lock lets the launcher be deleted before the
  # failure, and the next run reads the gutted husk as foreign (measured:
  # the first version of this pass locked Applications and the uninstall
  # printed the refusal note instead of the could-not-remove note). With
  # MacOS/ locked the launcher survives every failed rm, so ownership
  # stays provable across both runs.
  chmod 555 "$SBH11/Applications/Kosmos.app/Contents/MacOS"
  SYS_OK4="$SB/sysok4"
  mkdir -p "$SYS_OK4"
  export KOSMOS_HOME="$SB/home12" KOSMOS_BIN_DIR="$SB/bin12"
  RC=0; cat "$SETUP" | HOME="$SBH11" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK4" sh > "$SB/stale-locked.log" 2>&1 || RC=$?
  chk "locked-stale install exits 0" "[ $RC -eq 0 ]"
  chk "undeletable stale icon is named" "grep -q 'an older Kosmos icon is still' \"$SB/stale-locked.log\""
  "$SB/bin12/kosmos" stop > /dev/null 2>&1 || true

  # The home-folder "could not remove" on uninstall: the folder stays
  # locked so the home sweep's rm fails and must name the survivor.
  RC=0; HOME="$SBH11" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK4" sh -s -- --uninstall < "$SETUP" > "$SB/locked-home-un.log" 2>&1 || RC=$?
  chmod -R u+w "$SBH11" 2>/dev/null || true
  chk "locked-home uninstall exits 0" "[ $RC -eq 0 ]"
  chk "home survivor is named" "grep -q \"could not remove $SBH11/Applications/Kosmos.app\" \"$SB/locked-home-un.log\""

  # The last give-up sentence: probe fails AND the home folder cannot take
  # a bundle either; Kosmos itself must still install and say so.
  SYS_RO2="$SB/sysro2"
  mkdir -p "$SYS_RO2"
  chmod 555 "$SYS_RO2"
  SBH12="$SB/no-icon-home"
  mkdir -p "$SBH12/Applications"
  chmod 555 "$SBH12/Applications"
  export KOSMOS_HOME="$SB/home13" KOSMOS_BIN_DIR="$SB/bin13"
  RC=0; cat "$SETUP" | HOME="$SBH12" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO2" sh > "$SB/noicon.log" 2>&1 || RC=$?
  chk "no-icon install exits 0" "[ $RC -eq 0 ]"
  chk "the give-up sentence prints" "grep -q 'could not create the app icon, but Kosmos itself is fine' \"$SB/noicon.log\""
  chmod 755 "$SYS_RO2" "$SBH12/Applications"
  "$SB/bin13/kosmos" stop > /dev/null 2>&1 || true
fi

echo "== a link entry at the SYSTEM path is never claimed (dangling or resolvable) =="
# The install-side mirror of the uninstall's -L discipline: a symlink
# whose target cannot be stat'd (dangling here; another user's mode-700
# home in the field) fails -e, and an -e-only occupancy gate would let
# the probe claim the slot and rm -rf the link. The install must divert
# and leave the link byte-identical.
SYS_LNK="$SB/syslnk"
mkdir -p "$SYS_LNK"
ln -s "$SB/nowhere/Kosmos.app" "$SYS_LNK/Kosmos.app"
SBH18="$SB/lnk-home"
mkdir -p "$SBH18"
export KOSMOS_HOME="$SB/home20" KOSMOS_BIN_DIR="$SB/bin20"
RC=0; cat "$SETUP" | HOME="$SBH18" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_LNK" sh > "$SB/syslnk.log" 2>&1 || RC=$?
chk "system-link install exits 0" "[ $RC -eq 0 ]"
chk "the link entry survives untouched" "[ -L \"$SYS_LNK/Kosmos.app\" ] && [ \"\$(readlink \"$SYS_LNK/Kosmos.app\")\" = \"$SB/nowhere/Kosmos.app\" ]"
chk "the install diverted to the home folder" "[ -x \"$SBH18/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the divert names the occupied spot" "grep -q 'something else already has the Kosmos spot' \"$SB/syslnk.log\""
"$SB/bin20/kosmos" stop > /dev/null 2>&1 || true
# The RESOLVABLE case: a user's link pointing at a bundle whose launcher
# would pass the ownership grep. Deciding by content would claim and
# replace the link; deciding by linkness must divert and leave both the
# link and its target byte-identical.
SYS_LNK2="$SB/syslnk2"
REALB="$SB/realbundle"
mkdir -p "$SYS_LNK2"
seed_kosmos_bundle "$REALB" "$SB/home23"
ln -s "$REALB/Kosmos.app" "$SYS_LNK2/Kosmos.app"
SBH21="$SB/lnk2-home"
mkdir -p "$SBH21"
export KOSMOS_HOME="$SB/home23" KOSMOS_BIN_DIR="$SB/bin23"
RC=0; cat "$SETUP" | HOME="$SBH21" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_LNK2" sh > "$SB/syslnk2.log" 2>&1 || RC=$?
chk "resolvable-link install exits 0" "[ $RC -eq 0 ]"
chk "the resolvable link survives untouched" "[ -L \"$SYS_LNK2/Kosmos.app\" ] && [ \"\$(readlink \"$SYS_LNK2/Kosmos.app\")\" = \"$REALB/Kosmos.app\" ]"
chk "the link's target survives untouched" "[ -f \"$REALB/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the resolvable-link install diverted home" "[ -x \"$SBH21/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
"$SB/bin23/kosmos" stop > /dev/null 2>&1 || true

echo "== a link entry is decided by its target, and each skip sentence is its own =="
# The unknown-skip leg: a dangling home Applications symlink plus a foreign
# system bundle. The install must refuse to guess, write no icon, and say
# "could not be checked" rather than "is the same folder".
SYS_F2="$SB/sysforeign2"
mkdir -p "$SYS_F2/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# stranger2\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/2}"\n' > "$SYS_F2/Kosmos.app/Contents/MacOS/Kosmos"
SBH13="$SB/dangling-home"
mkdir -p "$SBH13"
ln -s "$SB/does-not-exist" "$SBH13/Applications"
export KOSMOS_HOME="$SB/home15" KOSMOS_BIN_DIR="$SB/bin15"
RC=0; cat "$SETUP" | HOME="$SBH13" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_F2" sh > "$SB/unknown-skip.log" 2>&1 || RC=$?
chk "unknown-skip install exits 0" "[ $RC -eq 0 ]"
chk "unknown-skip speaks its own sentence" "grep -q 'could not be checked, so no icon was created' \"$SB/unknown-skip.log\""
chk "unknown-skip does not claim the same-folder cause" "! grep -q 'is the same folder' \"$SB/unknown-skip.log\""
chk "the second stranger is untouched" "grep -q 'stranger2' \"$SYS_F2/Kosmos.app/Contents/MacOS/Kosmos\""
"$SB/bin15/kosmos" stop > /dev/null 2>&1 || true

# A home-folder LINK at uninstall: one pointing at the system bundle this
# uninstall sweeps is our residue and goes; one pointing anywhere else is
# left and named as a link.
SYS_OK5="$SB/sysok5"
seed_kosmos_bundle "$SYS_OK5" "$SB/home16"
SBH14="$SB/link-home"
mkdir -p "$SBH14/Applications"
ln -s "$SYS_OK5/Kosmos.app" "$SBH14/Applications/Kosmos.app"
export KOSMOS_HOME="$SB/home16" KOSMOS_BIN_DIR="$SB/bin16"
RC=0; HOME="$SBH14" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK5" sh -s -- --uninstall < "$SETUP" > "$SB/link-un.log" 2>&1 || RC=$?
chk "link uninstall exits 0" "[ $RC -eq 0 ]"
chk "our link swept with its bundle" "[ ! -e \"$SBH14/Applications/Kosmos.app\" ] && [ ! -L \"$SBH14/Applications/Kosmos.app\" ]"
chk "the link sweep is named" "grep -q 'removing a link that pointed at the removed Kosmos app' \"$SB/link-un.log\""
ln -s "$SB/somewhere-else/Kosmos.app" "$SBH14/Applications/Kosmos.app"
RC=0; HOME="$SBH14" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK5" sh -s -- --uninstall < "$SETUP" > "$SB/link-un2.log" 2>&1 || RC=$?
chk "foreign link survives" "[ -L \"$SBH14/Applications/Kosmos.app\" ]"
chk "foreign link is named as a link" "grep -q 'is a link this install did not create' \"$SB/link-un2.log\""

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP stale-system-icon leg: running as root"
  SKIPS=$((SKIPS + 1))
else
  # The two-icon state, named: the probe fails on a machine whose earlier
  # install owns a system icon; the fresh icon goes home and the stale
  # one is called out.
  SYS_RO3="$SB/sysro3"
  seed_kosmos_bundle "$SYS_RO3" "$SB/home17"
  chmod 555 "$SYS_RO3"
  SBH15="$SB/stale-sys-home"
  mkdir -p "$SBH15"
  export KOSMOS_HOME="$SB/home17" KOSMOS_BIN_DIR="$SB/bin17"
  RC=0; cat "$SETUP" | HOME="$SBH15" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO3" sh > "$SB/stale-sys.log" 2>&1 || RC=$?
  chk "stale-sys install exits 0" "[ $RC -eq 0 ]"
  chk "fresh icon landed in the home folder" "[ -x \"$SBH15/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "the unreachable system icon is named" "grep -q 'could not be updated from this account' \"$SB/stale-sys.log\""
  chmod 755 "$SYS_RO3"
  "$SB/bin17/kosmos" stop > /dev/null 2>&1 || true
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP foreign-home-fallback leg: running as root"
  SKIPS=$((SKIPS + 1))
else
  echo "== the home folder gets the same ownership gate =="
  # The one path that used to replace without proof: probe fails, the
  # fallback targets ~/Applications, and a stranger's Kosmos.app already
  # sits there. No icon may be written, the stranger stays byte-identical,
  # and the sentence says so.
  SYS_RO6="$SB/sysro6"
  mkdir -p "$SYS_RO6"
  chmod 555 "$SYS_RO6"
  SBH20="$SB/foreign-fallback-home"
  mkdir -p "$SBH20/Applications/Kosmos.app/Contents/MacOS"
  printf '#!/bin/bash\n# their home app\nKOSMOS_HOME="${KOSMOS_HOME:-/their/place}"\n' > "$SBH20/Applications/Kosmos.app/Contents/MacOS/Kosmos"
  export KOSMOS_HOME="$SB/home22" KOSMOS_BIN_DIR="$SB/bin22"
  RC=0; cat "$SETUP" | HOME="$SBH20" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO6" sh > "$SB/foreign-fb.log" 2>&1 || RC=$?
  chk "foreign-fallback install exits 0" "[ $RC -eq 0 ]"
  chk "the stranger's home app is untouched" "grep -q 'their home app' \"$SBH20/Applications/Kosmos.app/Contents/MacOS/Kosmos\""
  chk "no icon was written over it" "grep -q 'left alone and no icon was created' \"$SB/foreign-fb.log\""
  chmod 755 "$SYS_RO6"
  "$SB/bin22/kosmos" stop > /dev/null 2>&1 || true
fi

echo "== the KOSMOS_HOME delete gate demands Kosmos-specific evidence =="
# A bare VERSION file is not proof: KOSMOS_HOME pointed at a folder
# holding one (the shape of KOSMOS_HOME=$HOME with a stray ~/VERSION)
# must be refused in a sentence, with the folder left intact.
NOTKOS="$SB/not-kosmos"
mkdir -p "$NOTKOS"
printf '1.0\n' > "$NOTKOS/VERSION"
printf 'precious\n' > "$NOTKOS/user-data.txt"
RC=0; KOSMOS_HOME="$NOTKOS" KOSMOS_BIN_DIR="$SB/bin-nk" sh -s -- --uninstall < "$SETUP" > "$SB/notkos.log" 2>&1 || RC=$?
chk "not-a-Kosmos-install uninstall exits 0" "[ $RC -eq 0 ]"
chk "the folder is refused in a sentence" "grep -q 'does not look like a Kosmos install' \"$SB/notkos.log\""
chk "the folder survives with its contents" "grep -q 'precious' \"$NOTKOS/user-data.txt\""

echo "== the KOSMOS_HOME character guard refuses in a sentence =="
# Brand-new safety code protecting every grep -F ownership gate from
# failing open; each refused class must exit 2 with the sentence and
# without installing anything.
RC=0; KOSMOS_HOME="$SB/evil\"quote" sh < "$SETUP" > "$SB/guard1.log" 2>&1 || RC=$?
chk "a quote in KOSMOS_HOME is refused" "[ $RC -eq 2 ] && grep -q 'would defeat the safety checks' \"$SB/guard1.log\""
RC=0; KOSMOS_HOME="$SB/evil}brace" sh < "$SETUP" > "$SB/guard2.log" 2>&1 || RC=$?
chk "a closing brace in KOSMOS_HOME is refused" "[ $RC -eq 2 ] && grep -q 'would defeat the safety checks' \"$SB/guard2.log\""
RC=0; KOSMOS_HOME="$(printf '%s\n%s' "$SB/evil" "line")" sh < "$SETUP" > "$SB/guard3.log" 2>&1 || RC=$?
chk "a newline in KOSMOS_HOME is refused" "[ $RC -eq 2 ] && grep -q 'would defeat the safety checks' \"$SB/guard3.log\""

echo "== both folders foreign: both named, both untouched =="
# Foreign in the system spot AND a foreign Kosmos.app in the home folder:
# the divert has nowhere to write, both refusals must speak, and both
# strangers stay byte-identical.
SYS_F3="$SB/sysforeign3"
mkdir -p "$SYS_F3/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# stranger3\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/3}"\n' > "$SYS_F3/Kosmos.app/Contents/MacOS/Kosmos"
SBH22="$SB/dual-foreign-home"
mkdir -p "$SBH22/Applications/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# their home app 2\nKOSMOS_HOME="${KOSMOS_HOME:-/their/place/2}"\n' > "$SBH22/Applications/Kosmos.app/Contents/MacOS/Kosmos"
export KOSMOS_HOME="$SB/home24" KOSMOS_BIN_DIR="$SB/bin24"
RC=0; cat "$SETUP" | HOME="$SBH22" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_F3" sh > "$SB/dual.log" 2>&1 || RC=$?
chk "dual-foreign install exits 0" "[ $RC -eq 0 ]"
chk "the home stranger survives" "grep -q 'their home app 2' \"$SBH22/Applications/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the system stranger survives" "grep -q 'stranger3' \"$SYS_F3/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the home refusal speaks" "grep -q 'not created by this install is in the Applications folder inside' \"$SB/dual.log\""
chk "the system spot is named too" "grep -q 'something else also has the Kosmos spot' \"$SB/dual.log\""
"$SB/bin24/kosmos" stop > /dev/null 2>&1 || true
# NOT drivable here, recorded rather than implied: the APP_SYS_FAILED
# sentence (a refused write into a writable, empty system folder needs a
# TCC denial the harness cannot produce) and make_app's restore-failure
# note (the slot would have to become unwritable between two renames in
# one run). Both legs are reasoned and hand-verified, not pinned.

echo "== the KOSMOS_PORT guard refuses in a sentence =="
RC=0; KOSMOS_PORT="80abc" sh < "$SETUP" > "$SB/portg1.log" 2>&1 || RC=$?
chk "a non-numeric KOSMOS_PORT is refused" "[ $RC -eq 2 ] && grep -q 'KOSMOS_PORT must be a number' \"$SB/portg1.log\""
RC=0; KOSMOS_PORT="4317}\"; echo PWNED; :\"" sh < "$SETUP" > "$SB/portg2.log" 2>&1 || RC=$?
chk "an injection-shaped KOSMOS_PORT is refused" "[ $RC -eq 2 ] && ! grep -q PWNED \"$SB/portg2.log\""

echo "== the override uninstall proves ownership too =="
# The KOSMOS_APP_DIR branch used to delete any Kosmos.app by name; the
# header bound is unconditional, so a stranger's bundle in the override
# dir must survive, named.
APPS_F="$SB/apps-foreign"
mkdir -p "$APPS_F/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# override stranger\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/override}"\n' > "$APPS_F/Kosmos.app/Contents/MacOS/Kosmos"
RC=0; KOSMOS_APP_DIR="$APPS_F" KOSMOS_HOME="$SB/home25" KOSMOS_BIN_DIR="$SB/bin25" sh -s -- --uninstall < "$SETUP" > "$SB/ovf-un.log" 2>&1 || RC=$?
chk "override-foreign uninstall exits 0" "[ $RC -eq 0 ]"
chk "the override stranger survives" "grep -q 'override stranger' \"$APPS_F/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the override stranger is named" "grep -q 'could not be proven to belong to this install' \"$SB/ovf-un.log\""

echo "== a stranger's board on the port is never presented as this install's =="
# cmd_start's healthy() accepts any Kosmos-identifying board, so a fresh
# install onto an occupied port must say so, not print "Kosmos is
# running", and must NOT open a browser onto the stranger's board.
export KOSMOS_HOME="$SB/home26" KOSMOS_BIN_DIR="$SB/bin26" KOSMOS_APP_DIR="$SB/apps26"
RC=0; cat "$SETUP" | sh > "$SB/first-board.log" 2>&1 || RC=$?
chk "first board install exits 0" "[ $RC -eq 0 ]"
# ⚠️ Probe-style env, deliberately: with KOSMOS_APP_DIR set, the sandbox
# belt suppresses the open on its own and BOARD_OURS is never consulted
# (proven by mutation: deleting the BOARD_OURS clause kept the suite
# green in that shape). With KOSMOS_APP_DIR empty and the stub as the
# open command, BOARD_OURS is the SOLE suppressor, so this pass pins it.
SBH23="$SB/stranger-home"
SYS28="$SB/sys28"
mkdir -p "$SBH23" "$SYS28"
export KOSMOS_HOME="$SB/home27" KOSMOS_BIN_DIR="$SB/bin27"
OPENED_BEFORE_STRANGER="$(wc -l < "$SB/opened.log" | tr -d ' ')"
RC=0; cat "$SETUP" | HOME="$SBH23" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS28" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/stranger-board.log" 2>&1 || RC=$?
chk "occupied-port install exits 0" "[ $RC -eq 0 ]"
chk "the occupied port is named, not claimed" "grep -q 'could not confirm its own board' \"$SB/stranger-board.log\" && ! grep -q '^  Kosmos is running\.\$' \"$SB/stranger-board.log\""
chk "no browser was opened onto the stranger's board" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"$OPENED_BEFORE_STRANGER\" ]"
"$SB/bin26/kosmos" stop > /dev/null 2>&1 || true

echo "== a link at the SYSTEM path survives uninstall, named =="
# The round-14 gap: an owned-target LINK at the system entry passed the
# leaf -L and the grep (both follow links) and was deleted as "the
# Kosmos app". Linkness must decide at the root for the uninstall too.
SYS29="$SB/sys29"
REALB2="$SB/realbundle2"
mkdir -p "$SYS29"
seed_kosmos_bundle "$REALB2" "$SB/home28"
ln -s "$REALB2/Kosmos.app" "$SYS29/Kosmos.app"
SBH24="$SB/lnk3-home"
mkdir -p "$SBH24"
export KOSMOS_HOME="$SB/home28" KOSMOS_BIN_DIR="$SB/bin28"
RC=0; HOME="$SBH24" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS29" sh -s -- --uninstall < "$SETUP" > "$SB/lnk3-un.log" 2>&1 || RC=$?
chk "owned-target-link uninstall exits 0" "[ $RC -eq 0 ]"
chk "the link survives the uninstall" "[ -L \"$SYS29/Kosmos.app\" ]"
chk "its target survives too" "[ -f \"$REALB2/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the link is named, not claimed" "grep -q 'could not be proven to belong to this install' \"$SB/lnk3-un.log\""

echo "== the production open default is real =="
# Every observing pass substitutes the recording stub, and command -v
# silently no-ops on an unresolvable value, so a typo in the default
# would disable the branch's headline behavior on every real install
# while the suite stayed green. Pin the literal and the binary.
chk "the served file defaults to /usr/bin/open" "grep -q 'KOSMOS_OPEN_CMD:-/usr/bin/open' \"$SETUP\""
chk "/usr/bin/open exists on this machine" "[ -x /usr/bin/open ]"

echo "== the open gate's sandbox belt, and a file-shadowed Applications =="
# The [ -z KOSMOS_APP_DIR ] clause in the open gate: a fresh sandboxed
# install with the suppressor CLEARED must still not open. Without this
# pass the belt could be deleted and the suite would stay green, because
# every other override pass inherits the global KOSMOS_NO_OPEN.
OPENED_LINES_BEFORE="$(wc -l < "$SB/opened.log" | tr -d ' ')"
export KOSMOS_HOME="$SB/home18" KOSMOS_BIN_DIR="$SB/bin18"
RC=0; cat "$SETUP" | KOSMOS_APP_DIR="$SB/apps18" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/belt.log" 2>&1 || RC=$?
chk "belt install exits 0" "[ $RC -eq 0 ]"
chk "the verbatim override alone suppresses the open" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"$OPENED_LINES_BEFORE\" ]"
"$SB/bin18/kosmos" stop > /dev/null 2>&1 || true

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP file-shadowed leg: running as root (the read-only probe dir does not bind)"
  SKIPS=$((SKIPS + 1))
else
  # ~/Applications exists as a regular FILE and the probe fails: the icon
  # step used to die here, aborting before "Starting Kosmos" on a run
  # that could still deliver a working install. It must finish, say the
  # give-up sentence, and leave the board running.
  SYS_RO5="$SB/sysro5"
  mkdir -p "$SYS_RO5"
  chmod 555 "$SYS_RO5"
  SBH19="$SB/file-home"
  mkdir -p "$SBH19"
  touch "$SBH19/Applications"
  export KOSMOS_HOME="$SB/home21" KOSMOS_BIN_DIR="$SB/bin21"
  RC=0; cat "$SETUP" | HOME="$SBH19" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO5" sh > "$SB/fileapps.log" 2>&1 || RC=$?
  chk "file-shadowed Applications does not abort the install" "[ $RC -eq 0 ]"
  chk "the give-up sentence prints for the shadowed folder" "grep -q 'could not create the app icon, but Kosmos itself is fine' \"$SB/fileapps.log\""
  chk "the board still came up" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
  "$SB/bin21/kosmos" stop > /dev/null 2>&1 || true
  chmod 755 "$SYS_RO5"
fi

echo "== the operator's real folders were never touched =="
chk "real home Applications unchanged (a FAIL here can also mean something else changed it DURING the run; check before blaming the installer)" "[ \"\$(real_apps_fingerprint \"$HOME/Applications\")\" = \"$REAL_HOME_APPS_BEFORE\" ]"
chk "real /Applications unchanged (a FAIL here can also mean something else changed it DURING the run; check before blaming the installer)" "[ \"\$(real_apps_fingerprint /Applications)\" = \"$REAL_SYS_APPS_BEFORE\" ]"

echo
if [ "$SKIPS" -gt 0 ]; then
  echo "$PASS passed, $FAIL failed, $SKIPS block(s) SKIPPED (a skipped run is NOT a full run)"
else
  echo "$PASS passed, $FAIL failed"
fi
[ "$FAIL" -eq 0 ]
