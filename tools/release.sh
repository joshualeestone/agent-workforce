#!/bin/bash
# Cut a release: bump, test, build, publish, and verify what is SERVED.
#
#   bash tools/release.sh 0.2.12
#
# ⚠️ THIS SCRIPT LIVED IN A SCRATCHPAD FOR THREE RELEASES. Every improvement it
# gained — including the step that copies `/setup`, added after the installer
# served on the site was found a whole change stale — would have died with the
# session that wrote it. A release procedure that is not in the repo is a
# procedure the next person reconstructs from memory, which is how the same step
# goes missing twice.
#
# ⚠️ IT DOES NOT VERIFY ANYTHING ITSELF. `tools/verify-served.sh` does that, and
# it derives the artifact list from the code that FETCHES each one. Two
# derivations of "what a user receives" is this codebase's worst habit, and the
# first one is what missed `/setup`.
set -euo pipefail
V="${1:-}"
[ -n "$V" ] || { echo "usage: bash tools/release.sh <version>   e.g. 0.2.12"; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
[ -d "$SITE/dist" ] || { echo "no site checkout at $SITE (set KOSMOS_SITE)"; exit 1; }

echo "== 1. main, clean, and carrying what you mean to ship =="
git -C "$REPO" fetch origin -q
[ "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" = main ] || { echo "not on main"; exit 1; }
[ -z "$(git -C "$REPO" status --porcelain)" ] || { echo "main is dirty"; exit 1; }
git -C "$REPO" log --oneline -8 | cat

echo "== 2. the version, in one place =="
node -e "
const fs=require('fs'),p='$REPO/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
if(j.version!=='$V'){ j.version='$V'; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n'); console.log('   bumped to $V'); }
else console.log('   already $V');"

echo "== 3. the whole suite, on the tree that ships =="
( cd "$REPO" && yarn test 2>&1 | grep -E '^ℹ (tests|pass|fail)' )

echo "== 4. build =="
( cd "$REPO" && bash tools/build-kosmos-bundle.sh dist )
cp "$REPO/dist/kosmos-arm64.tar.gz" "$REPO/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/"
node -e "require('node:fs').writeFileSync('$SITE/dist/latest.json', JSON.stringify({version:'$V'})+'\n')"
echo "   latest.json -> $(cat "$SITE/dist/latest.json")"

# 🛑 THE INSTALLER, SERVED FROM THE SITE ROOT AND NOT FROM dist/. Copying the
# bundle does not carry it, and BOTH paths run it: a new install (`curl … /setup
# | sh`) and an existing one updating itself (engine/update.js re-runs
# `setupUrl()`). It was stale on the site by a whole change before this step
# existed, while three correct checks of the bundle passed.
echo "== 5. the installer =="
cp "$REPO/dist/setup" "$SITE/setup"
cp "$REPO/dist/setup.sha256" "$SITE/setup.sha256"
diff -q "$SITE/setup" "$REPO/install/setup.sh" >/dev/null || { echo "the emitted installer is not install/setup.sh"; exit 1; }
sh -n "$SITE/setup" || { echo "the installer about to be published does not parse"; exit 1; }
echo "   /setup copied and parses"

echo "== 6. what we are about to publish says $V =="
tar -xzOf "$SITE/dist/kosmos-arm64.tar.gz" app/package.json | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const v=JSON.parse(s).version;
  console.log('   bundled version:', v);
  if(v!=='$V'){ console.error('   THE BUNDLE IS NOT $V'); process.exit(1); }
});"

echo "== 7. the versions page needs its entry BEFORE you deploy =="
grep -q "id=\"v$(echo "$V" | tr . -)\"" "$SITE/versions.html" \
  && echo "   $V is on the page" \
  || { echo "   $V has no entry in $SITE/versions.html. Write it (ruled copy, real timestamp) and re-run."; exit 1; }

echo "== 8. deploy =="
( cd "$SITE" && vercel deploy --prod --yes )

echo "== 9. verify what is SERVED, from the code that fetches it =="
# ⚠️ Retried, because a deploy is live before every edge has it, and a single
# read cannot tell "not published" from "not yet".
for i in 1 2 3 4 5 6; do
  if bash "$REPO/tools/verify-served.sh"; then exit 0; fi
  echo "   (attempt $i did not match; waiting)"
  sleep 10
done
echo "SOMETHING A USER RECEIVES IS STILL WRONG AFTER SIX READS"
exit 1
