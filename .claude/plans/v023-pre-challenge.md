---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: v023
diff_hash: f796a47a9010f1890087e0ed07d9832f5ed7c4ccf63e12f9d1cfd014fabf2c6c
subdir_audit: passed
timestamp: 2026-08-20T04:06:06Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: v023

Single pass, explicit override, labelled honestly. One character in one field
plus a plan file.

## Iteration 1 (single pass)

[STRENGTH] Version single-sourced; nothing else in the repo hardcodes it.

[STRENGTH] Comparator exercised at the ACTUAL pair this release ships:

    newer("0.2.3", "0.2.2")   true
    newer("0.2.2", "0.2.3")   false
    newer("0.2.3", "0.2.3")   false
    newer("garbage", "0.2.2") false

[STRENGTH] The DEPLOYED comparator read from the live artifact rather than
assumed: installkosmos.com/dist/latest.json currently serves 0.2.2.

[STRENGTH] Full suite at the new version: 938 tests, 0 failing.

[STRENGTH] ⚠️ THE REGRESSION THIS BUMP EXISTS TO AVOID WAS ALREADY CAUGHT ONCE
TONIGHT, on #93, and is worth restating here because this file is where someone
will look. A branch cut at an older version silently REVERTS package.json when
merged, and every board on the newer version reads that as "no update
available". Nothing in the suite pins the version to a number, so nothing fails.
The only defence is checking both sides before merging, which is not a test and
should not be mistaken for one.

[NIT] Invisible until the site pipeline publishes; the plan names that step and
its verification.

### Final Ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| - | 1 | (none) | - | - | no BLOCKER, WARNING or CONVENTION |
| 1 | 1 | NIT | publish | DEFERRED | by design: next step in the plan |
