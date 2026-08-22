#!/bin/bash
# Build the Kosmos app bundle the installer downloads: kosmos-<arch>.tar.gz,
# containing the app, a private Node runtime, and the `kosmos` command.
#
# The installer (install/setup.sh) extracts this into $KOSMOS_HOME and expects:
#
#   bin/kosmos          the command (install/kosmos, this repo)
#   runtime/bin/node    a Node that runs from a home folder on a clean Mac
#   app/                server.js, engine/, web/, bin/, package.json
#
# ⚠️ WHY A WHOLE NODE SHIPS. The app is dependency-free by design (node:*
# builtins only, no node_modules), so the ONLY thing between a clean Mac and a
# running board is a Node binary. macOS does not ship one, and asking a
# non-technical person to install Node is the install we are replacing. The
# official arm64 binary is ~50MB on disk and ~30MB compressed, which is the
# bulk of this bundle; that is the price of "paste one line".
#
# ⚠️ THE RUNTIME IS DOWNLOADED FROM nodejs.org AND CHECKSUM-VERIFIED against
# the SHASUMS256.txt published next to it, then the four files we take keep
# Apple's own signature (nodejs.org macOS binaries are signed and notarised;
# re-signing them ad-hoc would replace a real identity with none). The version
# is PINNED, not "latest": the bundle must not change under us because a
# release day happened.
#
# ⚠️ NODE_SOURCE overrides the download for offline builds and tests, same
# pattern as TMUX_SOURCE in build-tmux-bundle.sh. A bundle built that way is
# for TESTING: a Homebrew node links only system libraries today, but the
# release bundle is built from the official binary, always.
#
# Usage:  tools/build-kosmos-bundle.sh [output-dir]
# Output: <out>/kosmos-<arch>.tar.gz plus the staged tree it was made from.

set -euo pipefail
# One EXIT trap, registered before anything can create a temp resource: six
# exit-1 paths once sat between the download's mktemp and a trap that was
# "folded in" later, each leaking ~150MB of Node tarball per failed build.
TMP=""; SMOKE_LOG=""; SMOKE_ROOTS=""
trap 'rm -rf "${TMP:-}" "${SMOKE_LOG:-}" "${SMOKE_ROOTS:-}"' EXIT

NODE_VERSION="${KOSMOS_NODE_VERSION:-24.19.0}"
OUT="${1:-dist}"
ARCH="$(uname -m)"
STAGE="$OUT/kosmos-bundle"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/app" "$STAGE/runtime/bin"

# ---- the app ---------------------------------------------------------------
# ⚠️ AN EXPLICIT LIST, NOT AN EXCLUDE LIST. `cp -R . minus tests` rots the
# other way: the next stray file in the repo root ships to every user. Naming
# what ships means a new runtime file has to be added here consciously, and
# the smoke test below fails loudly if a required one is forgotten.
echo "==> staging the app"
cp "$REPO/server.js" "$REPO/package.json" "$STAGE/app/"
mkdir -p "$STAGE/app/engine" "$STAGE/app/bin"
for f in "$REPO"/engine/*.js; do
  case "$f" in *.test.js) ;; *) cp "$f" "$STAGE/app/engine/" ;; esac
done
cp -R "$REPO/web" "$STAGE/app/web"
# 🛑 BAKE THE VERSION INTO THE PAGE. It used to be readable only from the status
# poll, so on a machine whose board was not running the version was unknown for
# the same reason everything else was (#269). A fact about the bundle must not
# require the bundle's API.
#
# ⚠️ SUBSTITUTED HERE RATHER THAN COMMITTED, so a source checkout keeps the
# marker and the page falls back to the polled value. And VERIFIED, because a
# silent no-op sed would ship the marker itself to a person's screen: the check
# below fails the build rather than shipping "version __KOSMOS_VERSION__".
_ver="$(KOSMOS_PKG="$STAGE/app/package.json" "$STAGE/runtime/bin/node" -p 'JSON.parse(require("fs").readFileSync(process.env.KOSMOS_PKG,"utf8")).version')"
[ -n "$_ver" ] || { echo "could not read the version to bake into the page" >&2; exit 1; }
sed -i '' "s/__KOSMOS_VERSION__/$_ver/" "$STAGE/app/web/index.html" 2>/dev/null \
  || sed -i "s/__KOSMOS_VERSION__/$_ver/" "$STAGE/app/web/index.html"
grep -q "__KOSMOS_VERSION__" "$STAGE/app/web/index.html" && {
  echo "the version marker survived the bake; the page would ship it verbatim" >&2; exit 1; }
grep -q "content=\"$_ver\"" "$STAGE/app/web/index.html" || {
  echo "the version was not baked into the page" >&2; exit 1; }
echo "==> baked version $_ver into the page"
cp "$REPO/bin/agent-supervisor.sh" "$STAGE/app/bin/"
chmod +x "$STAGE/app/bin/agent-supervisor.sh"
# The app icon artwork, when it exists: the installer looks for
# app/assets/Kosmos.icns is the ONE asset that ships, named explicitly
# per this file's own explicit-list rule: a wildcard copy of assets/
# would silently ship the next stray master/mock dropped in that folder
# to every user. Build-time sources (the 1024 masters) stay repo-only.
if [ -f "$REPO/assets/Kosmos.icns" ]; then
  mkdir -p "$STAGE/app/assets"
  cp "$REPO/assets/Kosmos.icns" "$STAGE/app/assets/Kosmos.icns"
fi

# ---- the command ------------------------------------------------------------
cp "$REPO/install/kosmos" "$STAGE/bin/kosmos"
chmod +x "$STAGE/bin/kosmos"

# ---- the runtime ------------------------------------------------------------
node_arch() {
  case "$ARCH" in
    arm64) echo arm64 ;;
    x86_64) echo x64 ;;
    *) echo "error: unsupported arch $ARCH" >&2; exit 1 ;;
  esac
}

if [ -n "${NODE_SOURCE:-}" ]; then
  echo "==> using local node: $NODE_SOURCE (TEST BUILD, not for release)"
  [ -x "$NODE_SOURCE" ] || { echo "error: $NODE_SOURCE is not executable" >&2; exit 1; }
  cp "$NODE_SOURCE" "$STAGE/runtime/bin/node"
else
  NARCH="$(node_arch)"
  TARBALL="node-v$NODE_VERSION-darwin-$NARCH.tar.gz"
  BASE="https://nodejs.org/dist/v$NODE_VERSION"
  TMP="$(mktemp -d)"
  echo "==> downloading node v$NODE_VERSION ($NARCH) from nodejs.org"
  curl -fL --progress-bar "$BASE/$TARBALL" -o "$TMP/$TARBALL"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  echo "==> verifying checksum"
  WANT="$(grep " $TARBALL\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
  [ -n "$WANT" ] || { echo "error: $TARBALL not in SHASUMS256.txt" >&2; exit 1; }
  GOT="$(shasum -a 256 "$TMP/$TARBALL" | awk '{print $1}')"
  if [ "$WANT" != "$GOT" ]; then
    echo "FAIL: checksum mismatch on $TARBALL" >&2
    echo "  want $WANT" >&2
    echo "  got  $GOT" >&2
    exit 1
  fi
  echo "    checksum ok"
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  cp "$TMP/node-v$NODE_VERSION-darwin-$NARCH/bin/node" "$STAGE/runtime/bin/node"
  # ⚠️ Node's LICENSE travels with the binary. It is the single file that
  # carries the notices for Node AND everything Node bundles (OpenSSL, ICU,
  # V8, zlib, ...), all of which require their notices to accompany binary
  # redistribution. The tmux bundle refuses to pack without its notices;
  # the same rule holds here.
  cp "$TMP/node-v$NODE_VERSION-darwin-$NARCH/LICENSE" "$STAGE/runtime/LICENSE"
fi
if [ ! -f "$STAGE/runtime/LICENSE" ]; then
  # ⚠️ Its own flag, not KOSMOS_ALLOW_MINOS: one flag meaning both "I accept
  # a wrong floor" and "I accept a missing licence" does not stay legible,
  # and someone overriding the floor for its documented dev-machine reason
  # must not silently disable the licence check too.
  if [ -n "${KOSMOS_ALLOW_NO_LICENSE:-}" ]; then
    echo "TEST BUILD: runtime licence file not available from NODE_SOURCE" > "$STAGE/runtime/LICENSE"
    echo "    WARN: no runtime LICENSE (allowed: KOSMOS_ALLOW_NO_LICENSE test build)"
  else
    echo "FAIL: no LICENSE for the bundled runtime; binaries may not ship without their notices." >&2
    echo "      (NODE_SOURCE test builds may set KOSMOS_ALLOW_NO_LICENSE=1.)" >&2
    exit 1
  fi
fi
chmod +x "$STAGE/runtime/bin/node"

# ⚠️ VERIFY THE RUNTIME RUNS HERE, the same lesson as the tmux bundle: an
# arm64 binary with a broken signature does not run at all, and finding that
# out on a stranger's Mac is the expensive place to find it.
"$STAGE/runtime/bin/node" --version >/dev/null || {
  echo "FAIL: the staged node does not run" >&2; exit 1; }

# ⚠️ THE DEPLOYMENT FLOOR IS GATED AT BUILD TIME. The installer refuses
# machines below macOS 13.5 in a sentence; that number is only honest if no
# shipped binary demands MORE. A binary copied off a new build machine
# quietly inherits that machine's OS as its minimum (measured: a Homebrew
# tmux from this Mac stamps minos 26.0 and would load on nothing older),
# so the floor is read out of the artifact with otool and compared, not
# assumed. KOSMOS_ALLOW_MINOS=1 overrides for LOCAL TEST BUILDS ONLY.
. "$(dirname "${BASH_SOURCE[0]}")/lib/floor-gate.sh"
floor_gate "$STAGE/runtime/bin/node"

# ---- smoke test -------------------------------------------------------------
# ⚠️ THE STAGED TREE IS WHAT GETS TESTED, not the repo, AND A REAL REQUEST IS
# MADE. "The process stayed alive" cannot catch the ship list missing a file
# the server reads per request (web/index.html is read on every GET), so a
# bundle with no UI at all would boot, idle, and ship. PORT=0 still asks the
# OS for a free port -- the server prints the port it actually bound, and
# that line is parsed rather than guessed, so this never collides with a
# real board on this machine.
echo "==> smoke test: the staged app boots and serves its page"
SMOKE_LOG="$(mktemp)"
# ⚠️ Disposable roots for ALL FIVE of the app's roots: without these the
# staged server points at the BUILD MACHINE'S live store, launchd
# directory, tmux fleet, claude config and config-root scan. Today's
# server only reads on GET /, so nothing is mutated -- but that is a
# property of the current server, not of this test, and a future
# boot-time write must land in a throwaway, never in the operator's real
# data. If the app grows a sixth root, it must be added here.
SMOKE_ROOTS="$(mktemp -d)"
PORT=0 AGENT_WORKFORCE_DATA="$SMOKE_ROOTS/data" \
  AGENT_WORKFORCE_LAUNCH="$SMOKE_ROOTS/launch" \
  AGENT_WORKFORCE_WORKERS="$SMOKE_ROOTS/workers" \
  AGENT_WORKFORCE_CONFIG_ROOT="$SMOKE_ROOTS/config" \
  AGENT_WORKFORCE_CLAUDE_CONFIG="$SMOKE_ROOTS/claude.json" \
  "$STAGE/runtime/bin/node" "$STAGE/app/server.js" > "$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
SMOKE_URL=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  SMOKE_URL="$(sed -n 's/.*\(http:\/\/127\.0\.0\.1:[0-9]*\).*/\1/p' "$SMOKE_LOG" | head -1)"
  [ -n "$SMOKE_URL" ] && break
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 0.5
done
smoke_fail() {
  echo "FAIL: $1" >&2
  sed 's/^/    /' "$SMOKE_LOG" >&2
  kill "$SMOKE_PID" 2>/dev/null || true
  rm -f "$SMOKE_LOG"
  rm -rf "$SMOKE_ROOTS"
  exit 1
}
[ -n "$SMOKE_URL" ] || smoke_fail "the staged app never announced a port. It said:"
PAGE="$(curl -fsS -m 5 "$SMOKE_URL/" 2>/dev/null)" || smoke_fail "the staged app did not answer at $SMOKE_URL. It said:"
# ⚠️ A case STATEMENT, NOT `printf | grep -q`, AND THIS WAS MEASURED HERE:
# under pipefail, grep -q exits on its early match, printf takes SIGPIPE
# writing the rest of a 250KB page, and the PIPELINE reports failure on a
# page that matched. The first run of this smoke test failed its own
# healthy bundle exactly that way. No pipe, no signal, no lie.
case "$PAGE" in
  *"Agent Workforce"*|*Kosmos*) ;;
  *) smoke_fail "the staged app answered with something that is not its own page:" ;;
esac
# `|| true` on the kill as well: a smoke server that answered and then
# exited on its own makes a bare kill fail, and under set -e that aborted
# the build AFTER the smoke test had passed.
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
echo "    boots, answers at $SMOKE_URL, and serves its own page"
rm -f "$SMOKE_LOG"
rm -rf "$SMOKE_ROOTS"

# ---- the tarball ------------------------------------------------------------
# What shipped, recorded, same argument as the tmux bundle and stronger
# here: this is the half that pins the exact build (package.json is bumped
# per release since 0.1.1, but the commit is what a user report must be
# traceable to, and the stamp carries both).
{
  echo "app:    $(cd "$REPO" && git describe --always --dirty 2>/dev/null || echo unknown) (package.json $(KOSMOS_PKG="$STAGE/app/package.json" "$STAGE/runtime/bin/node" -p 'JSON.parse(require("fs").readFileSync(process.env.KOSMOS_PKG,"utf8")).version' 2>/dev/null || echo '?'))"
  echo "node:   $("$STAGE/runtime/bin/node" --version)"
  echo "built:  $(date -u +%Y-%m-%dT%H:%M:%SZ) on macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"
} > "$STAGE/VERSION"

echo "==> packing"
TARBALL_OUT="$OUT/kosmos-$ARCH.tar.gz"
rm -f "$TARBALL_OUT"
tar -czf "$TARBALL_OUT" -C "$STAGE" bin app runtime VERSION
# ⚠️ The .sha256 is what install/setup.sh verifies before extracting; a
# tarball published without it refuses to install, on purpose.
( cd "$OUT" && shasum -a 256 "$(basename "$TARBALL_OUT")" > "$(basename "$TARBALL_OUT").sha256" )
echo "==> ok: $(du -sh "$TARBALL_OUT" | cut -f1) at $TARBALL_OUT (+ .sha256)"
echo "    contains: $(tar -tzf "$TARBALL_OUT" | wc -l | tr -d ' ') files"

# ---- the installer travels WITH the release ---------------------------------
# ⚠️ Card #54, and 2026-08-17 is the incident it closes: install/setup.sh
# was reviewed and correct while the SITE served a 1569-line stale copy
# for 51 minutes -- review was spent on the right file and a different
# file shipped. The build now emits the installer beside the tarball, so
# the site release step copies dist/* and cannot cut a release that
# leaves /setup behind. The version number is the forcing function: a
# bundle at N with an installer from N-1 cannot happen when both ride
# one dist/ from one build.
cp "$REPO/install/setup.sh" "$OUT/setup"
( cd "$OUT" && shasum -a 256 setup > setup.sha256 )
echo "==> installer emitted at $OUT/setup (+ .sha256), byte-for-byte install/setup.sh"
