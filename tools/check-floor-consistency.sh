#!/bin/bash
# The macOS floor lives in FIVE places that cannot read each other at
# runtime: (1) tools/macos-floor, which the builders read; (2) and (3)
# install/setup.sh's MACOS_FLOOR_MAJOR and MACOS_FLOOR_MINOR literals (the
# installer is a standalone file a user pipes from curl, so it cannot
# source a repo file); (4) the Info.plist heredoc's interpolation of those
# literals; (5) the README's prose. This check is what makes "the numbers
# cannot drift apart silently" a fact instead of a hope: it runs inside
# `yarn test`, so a drift fails the suite.
#
# It also pins the board's IDENTITY TOKENS: healthy() in install/kosmos and
# the bundle smoke test recognise the board by the substrings "Agent
# Workforce" / "Kosmos" in its page. Rename the page heading without
# updating them and start/status silently misreport while the smoke test
# fails good bundles -- the same drift class as the floor.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOOR="$(cat "$HERE/tools/macos-floor")"
case "$FLOOR" in
  *[!0-9.]*|*.*.*|.*|*.) echo "FAIL: tools/macos-floor must be MAJOR.MINOR (got '$FLOOR')" >&2; exit 1 ;;
  *.*) ;;
  *) echo "FAIL: tools/macos-floor must be MAJOR.MINOR (got '$FLOOR')" >&2; exit 1 ;;
esac
MAJ="${FLOOR%%.*}"; MIN="${FLOOR#*.}"
S_MAJ="$(sed -n 's/^MACOS_FLOOR_MAJOR=\([0-9]*\)$/\1/p' "$HERE/install/setup.sh")"
S_MIN="$(sed -n 's/^MACOS_FLOOR_MINOR=\([0-9]*\)$/\1/p' "$HERE/install/setup.sh")"
if [ "$MAJ" != "$S_MAJ" ] || [ "$MIN" != "$S_MIN" ]; then
  echo "FAIL: tools/macos-floor says $FLOOR but install/setup.sh says ${S_MAJ:-?}.${S_MIN:-?}" >&2
  exit 1
fi
if ! grep -q "LSMinimumSystemVersion</key><string>\$MACOS_FLOOR_MAJOR.\$MACOS_FLOOR_MINOR" "$HERE/install/setup.sh"; then
  echo "FAIL: setup.sh's Info.plist does not interpolate the floor variables" >&2
  exit 1
fi
if ! grep -q "macOS $FLOOR+" "$HERE/README.md"; then
  echo "FAIL: README.md does not state the macOS $FLOOR+ floor" >&2
  exit 1
fi
# The page must carry an identity token the health checks match on. Both
# consumers (install/kosmos healthy() and the bundle smoke test) accept
# EITHER token -- "Agent Workforce" was the page's name before the 2026-08-16
# product-name correction, "Kosmos" is its name after -- so the page passes
# with either, and the consumer check below pins that BOTH matchers really do
# accept both, or an old page and a new matcher (or vice versa) could stop
# recognising each other across an update.
if ! grep -q "Agent Workforce" "$HERE/web/index.html" && ! grep -q "Kosmos" "$HERE/web/index.html"; then
  echo "FAIL: web/index.html carries neither identity token ('Agent Workforce' or 'Kosmos') that healthy() and the bundle smoke test match on" >&2
  exit 1
fi
for consumer in "$HERE/install/kosmos" "$HERE/tools/build-kosmos-bundle.sh"; do
  if ! grep -q "Agent Workforce" "$consumer" || ! grep -q "Kosmos" "$consumer"; then
    echo "FAIL: identity-token consumer $consumer no longer accepts both 'Agent Workforce' and 'Kosmos'" >&2
    exit 1
  fi
done
echo "floor consistent at $FLOOR; identity tokens consistent"
