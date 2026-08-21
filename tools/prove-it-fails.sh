#!/bin/bash
# Break the code on purpose and watch the named test go red.
#
#   bash tools/prove-it-fails.sh <test-file> <label> <node-expression>
#
# 🛑 IT REFUSES ON A DIRTY TREE, AND THAT REFUSAL IS THE WHOLE POINT. The loop
# ends in `git checkout` to undo the break, and `git checkout` discards
# UNCOMMITTED work with no warning. On 2026-08-21 that ate a real fix SEVEN
# TIMES in one day — twice it went unnoticed until a test written minutes later
# failed, and once a reverted state was committed on top.
#
# ⚠️ "Commit before you perturb" was written down after the first one and failed
# six more times. A habit that has to hold seven times a day is not a habit, it
# is a load-bearing assumption (Mona Lisa). So the tool holds it instead: it
# cannot run against work that a checkout would destroy.
#
# The expression is plain node, given the file as `f`:
#
#   bash tools/prove-it-fails.sh engine/trust.test.js "drop the symlink guard" \
#     "s = s.replace(\"if (fs.lstatSync\", \"if (false && fs.lstatSync\")"
set -uo pipefail
TESTFILE="${1:-}"; LABEL="${2:-}"; EXPR="${3:-}"
[ -n "$TESTFILE" ] && [ -n "$LABEL" ] && [ -n "$EXPR" ] || {
  echo "usage: bash tools/prove-it-fails.sh <test-file> <label> <node-expression>"; exit 2; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "REFUSING: the tree is dirty, and this ends in a checkout that would destroy it."
  echo "$DIRTY" | sed 's/^/    /'
  echo "  Commit first. That is the whole reason this refusal exists."
  exit 1
fi

# Which files the expression touches is not knowable, so the whole tree is
# restored — safe precisely because the tree was clean a moment ago.
before="$(git rev-parse HEAD)"
echo "── $LABEL"
node -e "
const fs = require('node:fs');
const paths = process.argv.slice(1);
for (const f of paths) { let s = fs.readFileSync(f, 'utf8'); const was = s; ${EXPR}; if (s !== was) fs.writeFileSync(f, s); }
" $(git ls-files '*.js' '*.html' | tr '\n' ' ') 2>/dev/null

if git diff --quiet; then
  echo "    ⚠️  THE MUTATION DID NOT APPLY — nothing changed, so nothing was proven."
  exit 1
fi
git diff --stat | tail -1 | sed 's/^/    changed: /'

node --test "$TESTFILE" 2>&1 | sed -n '/failing tests:/,$p' | grep '^✖' | sed 's/^/    /' | head -4
red=$?
git checkout -q -- .
[ "$(git rev-parse HEAD)" = "$before" ] || { echo "    HEAD moved; something is wrong"; exit 1; }
git diff --quiet || { echo "    restore failed"; exit 1; }
echo "    restored"
