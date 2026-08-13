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
cp "$REPO/bin/agent-supervisor.sh" "$STAGE/app/bin/"
chmod +x "$STAGE/app/bin/agent-supervisor.sh"

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
  trap 'rm -rf "$TMP"' EXIT
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
fi
chmod +x "$STAGE/runtime/bin/node"

# ⚠️ VERIFY THE RUNTIME RUNS HERE, the same lesson as the tmux bundle: an
# arm64 binary with a broken signature does not run at all, and finding that
# out on a stranger's Mac is the expensive place to find it.
"$STAGE/runtime/bin/node" --version >/dev/null || {
  echo "FAIL: the staged node does not run" >&2; exit 1; }

# ---- smoke test -------------------------------------------------------------
# ⚠️ THE STAGED TREE IS WHAT GETS TESTED, not the repo. The failure this
# catches is the explicit ship list above missing a file the server needs:
# the repo copy would run fine while the bundle is broken. PORT=0 asks the OS
# for a free port, so this never collides with a real board on this machine.
echo "==> smoke test: the staged app boots from the staged runtime"
SMOKE_LOG="$(mktemp)"
PORT=0 "$STAGE/runtime/bin/node" "$STAGE/app/server.js" > "$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
sleep 1.5
if kill -0 "$SMOKE_PID" 2>/dev/null; then
  kill "$SMOKE_PID" 2>/dev/null; wait "$SMOKE_PID" 2>/dev/null || true
  echo "    boots and stays up"
else
  echo "FAIL: the staged app died on boot. It said:" >&2
  sed 's/^/    /' "$SMOKE_LOG" >&2
  exit 1
fi
rm -f "$SMOKE_LOG"

# ---- the tarball ------------------------------------------------------------
echo "==> packing"
TARBALL_OUT="$OUT/kosmos-$ARCH.tar.gz"
rm -f "$TARBALL_OUT"
tar -czf "$TARBALL_OUT" -C "$STAGE" bin app runtime
echo "==> ok: $(du -sh "$TARBALL_OUT" | cut -f1) at $TARBALL_OUT"
echo "    contains: $(tar -tzf "$TARBALL_OUT" | wc -l | tr -d ' ') files"
