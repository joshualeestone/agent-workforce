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
#
# ⚠️ THE FILE LIST INCLUDES SHELL, AND IT DID NOT UNTIL 2026-08-22. It globbed
# `*.js` and `*.html` only, so `install/setup.sh` — the file a stranger's whole
# first impression runs through — was UNPROVABLE. Every mutation aimed at it
# reported "the mutation did not apply", which reads as a badly written
# expression rather than as a hole in the tool, and the two guards written for
# it that night were covered by tests that READ the file with nothing ever
# showing they could fail.
# 📌 `install/kosmos` is named explicitly because it carries no extension: the
# launcher is shell, it holds one of the three copies of the default port, and
# a glob by suffix cannot see it. A list that misses a file silently is the
# same defect one level up.
#
# 🛑 AND A MUTATION IN SHELL CANNOT BE PROVED BY THE NODE SUITE. `yarn test`
# never executes setup.sh; what covers it is `tools/test-install.sh`, which
# really installs. So a shell mutation must name that file as its test target,
# and it takes minutes rather than seconds. The tool does not enforce which
# runner you point it at — it cannot know — but the trap is worth stating: a
# shell break "proved" against a node test file goes green for the same reason
# the mutation used to not apply at all.
before="$(git rev-parse HEAD)"
echo "── $LABEL"
node -e "
const fs = require('node:fs');
const paths = process.argv.slice(1);
for (const f of paths) { let s = fs.readFileSync(f, 'utf8'); const was = s; ${EXPR}; if (s !== was) fs.writeFileSync(f, s); }
" $(git ls-files '*.js' '*.html' '*.sh' 'install/kosmos' | tr '\n' ' ') 2>/dev/null

if git diff --quiet; then
  echo "    ⚠️  THE MUTATION DID NOT APPLY — nothing changed, so nothing was proven."
  exit 1
fi
git diff --stat | tail -1 | sed 's/^/    changed: /'

# 🛑 A SHELL MUTATION CANNOT BE PROVED BY THE NODE SUITE, and this refuses
# rather than leaving it to a person to remember. `yarn test` never executes
# install/setup.sh or install/kosmos: it reads them, at most. So a break in
# shell "proved" against a .test.js file goes GREEN for the same reason the
# mutation used to not apply at all — the runner never touched the changed
# bytes — and a green run is read as "the guard held", which is the exact
# inversion this tool exists to prevent.
#
# ⚠️ REFUSAL RATHER THAN A WARNING. A warning printed above a green result is
# read as a green result; the whole point of this tool is that its output is
# trusted. Splinter's line when the glob was widened: the enforcement was "a
# person knowing", which is the thing we had spent the evening replacing.
#
# 📌 It restores first, so a refusal never leaves the tree broken.
_changed_shell="$(git diff --name-only | grep -E '\.sh$|^install/kosmos$' || true)"
case "$TESTFILE" in
  *.test.js)
    if [ -n "$_changed_shell" ]; then
      echo "    🛑 THIS MUTATION CHANGED SHELL, AND $TESTFILE CANNOT EXECUTE IT."
      echo "$_changed_shell" | sed 's/^/       changed: /'
      echo "       yarn test never runs these files, so a green result here would"
      echo "       mean the runner did not touch the break, not that a guard held."
      echo "       Point it at tools/test-install.sh (minutes, it really installs)."
      git checkout -q -- .
      echo "    restored"
      exit 1
    fi
    ;;
esac

# 🛑 THREE OUTCOMES, AND THE THIRD IS THE ONE THIS TOOL GOT WRONG FIRST.
# Pointed at a test file that does not exist, the original printed "restored"
# and nothing else — indistinguishable from "the mutation fired no test". The
# runner never ran and the tool had no way to say so.
#
# ⚠️ THAT IS THE SHAPE LEO HIT THE SAME DAY: a harness passed cargo's arguments
# as one quoted string, cargo errored, the usage error matched no known failure
# pattern, and all fifteen mutations scored GREEN. Anything classifying outcomes
# by pattern-match needs an explicit UNRECOGNISED branch, or every unanticipated
# failure lands on the default — and the default is always success.
#
# 🔑 A UNIFORM RESULT IS AN INSTRUMENT SMELL, NOT A FINDING.
out="$(node --test "$TESTFILE" 2>&1)"
summary="$(printf '%s' "$out" | grep -E '^ℹ (pass|fail) ' | head -2)"
failed="$(printf '%s' "$out" | sed -n '/failing tests:/,$p' | grep -c '^✖')"

if [ -z "$summary" ]; then
  echo "    🛑 THE RUNNER PRODUCED NO SUMMARY, so nothing is proven either way."
  printf '%s\n' "$out" | head -4 | sed 's/^/      /'
  git checkout -q -- .
  exit 1
elif [ "$failed" -gt 0 ]; then
  printf '%s' "$out" | sed -n '/failing tests:/,$p' | grep '^✖' | sed 's/^/    /' | head -4
else
  echo "    ⚠️  NOTHING WENT RED. The break applied and no test noticed it."
  printf '%s' "$summary" | sed 's/^/      /'
fi
git checkout -q -- .
[ "$(git rev-parse HEAD)" = "$before" ] || { echo "    HEAD moved; something is wrong"; exit 1; }
git diff --quiet || { echo "    restore failed"; exit 1; }
echo "    restored"
