# Restart port — state, and the one task left

**Branch:** `restart-with-consequences` (a PORT of `add-restart-with-consequences`
onto current main, not a merge of its history)
**Date:** 2026-08-11

## Why a port

That branch is six merges behind and conflicts in five files / ~4,900 lines.
⚠️ **All fifteen symbols it adds to `status.js` are already on main** — its
status work was an early version of the roster rework that later shipped as
#21/#22, and shipped better (its `parsePanes` is the OLD one, the one that
produced thirteen phantom agents). Most of the conflict was two versions of the
same work colliding, and the newer one had already won.

## Done, and verified

- `engine/lifecycle.js` + its 22 tests — **ported unchanged**, pass against main.
- The routes (`/api/agent/:name/(restart|clear|compact)`, `/api/actions`), the
  three request helpers, the per-agent verdicts on the board.
- The dialog: markup, styles, behaviour, the `rotate-ccw` icon. **Verified in a
  browser** — it reproduces the screen Josh approved, GENTLEST tag and all.
- `engine/commitments.js` tombstoning, **three-way merged cleanly**.
- ⚠️ **A live defect on main, found by the port and fixed:** a different
  *spelling* of an agent's name wrote to the real agent. See the commit; the fix
  is loose-to-notice / exact-to-permit, tested and mutation-verified.

**376 tests green. Nothing half-wired.**

## The one task left: the route tests

⚠️ **I failed at this four ways in one session. Do not start a fifth script.**

1. Extracting blocks by brace-matching — over-captured (34 blocks holding 105 tests).
2. Splitting on test boundaries — correct blocks, but their fixture helpers were left behind.
3. Lifting the helpers separately — over-captured again (one came out 840 lines).
4. Three-way merging the whole file — **closest by far.**

**Start from 4.** `git merge-file` on `server.test.js` against the common base
gives **only 3 conflict hunks**, and a name-by-name comparison showed **109 tests
in the union with zero lost from either side.** The merged-with-conflicts file is
parked at `.claude/plans/route-tests-merged-WIP.txt`.

Two of the three hunks are append collisions (main added tests here, the branch
added tests there). **Keeping both sides is the right resolution and does NOT
parse as-is**, because the hunk boundaries cut through blocks. So they need
resolving **by hand, per hunk** — reading where each block actually starts and
ends — which is judgement, not another rule.

**The check that matters when it is done:** compare test names against both
sides, not the pass count. A dropped test does not disturb a green suite.

## Known, and deliberately not ported

- Two tests exercising `ageText`, a page function main does not have. Making
  them pass would mean re-adding dead code to satisfy a test.
- The cross-site refusal test expects wording main phrases differently — a
  one-line expectation change, once the file parses.
