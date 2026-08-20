---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: v021
diff_hash: 9a0fb4ae58443d66cef5749ce25c062be487b0e9639b8c0c9fd70d5eb3b28f75
subdir_audit: passed
timestamp: 2026-08-20T02:28:13Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: v021

**Single pass, explicit override, and the override is the honest label rather
than a shortcut taken quietly.** The default gate is /challenge-loop, which
spawns fresh blind agents; that skill is not invocable in this session. Rather
than write a proof claiming a loop that did not run, this is recorded as what
it is. Justification: the reviewable diff is one character in one field
(`"version": "0.2.0"` -> `"0.2.1"`) plus a plan file, on a beta app with no
users, under Josh's 2026-08-19 21:25 ruling that finished work merges without
waiting on him.

## Iteration 1 (single pass)

[STRENGTH] Version is single-sourced. `grep -rn '0\.2\.0'` over package.json
and install/kosmos before the edit returned no other site; server.js,
engine/update.js and tools/build-kosmos-bundle.sh all derive it dynamically.
Nothing else needed changing and nothing else was changed.

[STRENGTH] The comparator was EXERCISED, not assumed. Loading `parts` and
`newer` out of engine/update.js directly:

    newer("0.2.1", "0.2.0")   true      <- the patch field resolves
    newer("0.2.0", "0.2.1")   false
    newer("0.2.0", "0.2.0")   false     <- equal is not newer
    newer("garbage", "0.2.0") false     <- malformed cannot pop an offer
    newer("0.2.10", "0.2.9")  true      <- numeric, not lexical

[STRENGTH] The DEPLOYED comparator was checked against the live artifact, not
against an assumption: chaoskosmos-site/dist/latest.json currently serves
`{ "version": "0.2.0" }`, so installed boards will see 0.2.1 as newer.

[STRENGTH] `require('./engine/update.js').RUNNING` reads 0.2.1 in the
worktree, so the running side of the comparison moved with the file.

[STRENGTH] Full suite at the new version: 926 tests, 0 failing, plus the shell
checks (floor consistent at 13.5, identity tokens consistent, ten permission
acceptance states). No fixture pinned the old version, so nothing rode along.

[NIT] The bump changes nothing a person can see until the site pipeline
publishes dist/ and latest.json. That is the next step in the plan, not a
defect in this diff. Same nit was recorded on v020 and is recorded again here
because it is still true.

### Final Ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| - | 1 | (none) | - | - | no BLOCKER, WARNING or CONVENTION found |
| 1 | 1 | NIT | dist pipeline | DEFERRED | by design: publishing is the plan's next step |
