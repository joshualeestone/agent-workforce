---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: v022
diff_hash: 2a48745603d7b097d9f29389e22b06542644dd3362e6053cbadcfcc6414150d5
subdir_audit: passed
timestamp: 2026-08-20T03:11:31Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: v022

Single pass, explicit override, labelled as such. Same reasoning as v021: the
reviewable diff is one character in one field plus a plan file, /challenge-loop
is not invocable here, and a proof claiming a loop that never ran is worse.

## Iteration 1 (single pass)

[STRENGTH] Version single-sourced. Grep over the repo for the old string before
the edit found it only in package.json; server.js, engine/update.js and
tools/build-kosmos-bundle.sh all derive it.

[STRENGTH] The comparator was exercised rather than assumed, at the ACTUAL pair
this release ships:

    newer("0.2.2", "0.2.1")   true
    newer("0.2.1", "0.2.2")   false
    newer("0.2.2", "0.2.2")   false
    newer("garbage", "0.2.1") false

[STRENGTH] The DEPLOYED comparator checked against the live artifact, not an
assumption: installkosmos.com/dist/latest.json currently serves 0.2.1.

[STRENGTH] Full suite at the new version: 926 tests, 0 failing, plus the shell
checks. No fixture pinned the old version.

[NIT] Invisible to a person until the site pipeline publishes. That is the next
step in the plan, and the plan names the verification (read the version back out
of the SERVED tarball, with the previous tarball as a positive control).

### Final Ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| - | 1 | (none) | - | - | no BLOCKER, WARNING or CONVENTION |
| 1 | 1 | NIT | publish | DEFERRED | by design: next step in the plan |
