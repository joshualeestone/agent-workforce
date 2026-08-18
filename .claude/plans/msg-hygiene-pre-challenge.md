---
pre_challenge: true
method: challenge-loop
branch: msg-hygiene
diff_hash: 1d183c3508d522758a39526b54ca0ecb5eb2654c2fa83c4065d0175915c6bf46
subdir_audit: passed
timestamp: 2026-08-18T16:10:36Z
iterations: 1
converged: true
---

# Challenge Loop Proof: msg-hygiene

One blind pass (fresh agent, no prior-review access), which traced every
appendLog writer and every readLog/record consumer. No blockers; every
finding fixed, none deferred.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 1 | [WARNING] | engine/messages.js id scan | A shape-failing foreign append no longer reserved its id: the next send could re-mint a delivered id and overwrite its spill file | FIXED 3359d16 (ids mint over parse-only rows; tested) |
| 2 | 1 | [NIT] | pairCount comment | Described a defense the upstream filter now makes unreachable on the main path | FIXED (clause added) |
| 3 | 1 | [NIT] | rowShaped at | Date.parse coerces, so a bare-number at slipped through to a screen sort expecting ISO strings | FIXED (string required) |
| 4 | 1 | [NIT] | tests | Non-object JSON lines (42, "str", [1,2], null) exercised nothing | FIXED (all four in the drop test) |

[STRENGTH] noted by the pass: the record() test is presence-before-
absence (one valid row of every kind, including the gone-agent row
pinning the no-roster-filter claim and an unknown kind, before any drop
is asserted); the validator demands only fields every writer emits, so
no engine-written row can be retro-dropped and the valve fails open,
never closed; the header paragraph is honest scoping, naming the exact
hole the validation exists for.

Suite 848/848; validation-log clean for this diff.
