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
if ! grep -q "Agent Workforce" "$HERE/web/index.html"; then
  echo "FAIL: web/index.html no longer carries the 'Agent Workforce' identity token that healthy() and the bundle smoke test match on" >&2
  exit 1
fi
if ! grep -q "Agent Workforce" "$HERE/install/kosmos" || ! grep -q "Agent Workforce" "$HERE/tools/build-kosmos-bundle.sh"; then
  echo "FAIL: an identity-token consumer (install/kosmos or the bundle smoke test) no longer matches on 'Agent Workforce'" >&2
  exit 1
fi
echo "floor consistent at $FLOOR; identity tokens consistent"
