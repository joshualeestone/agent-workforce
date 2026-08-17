---
pre_challenge: true
method: challenge-loop
branch: commitments-join
diff_hash: 2494c2ce3dab76f8c4b4fa95cc3086486abe5748e870d6e1afdcdab7600fd09e
subdir_audit: passed
timestamp: 2026-08-17T05:30:56Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 22 (0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, 15 NITs)
**Fixed:** 7 WARNINGs + 8 NITs taken | **Deferred:** 2 NITs (agreed scope / stated design)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] engine/tasks.js / engine/projects.js — Join scoped by assignee+number only; one agent on two projects each holding "task 1" rendered a definite "says it is on this" on both from a single commitment --> FIXED (18db7ee, cross-project ambiguity guard: colliding (who, number) joins as claimed:null with reason)
- [WARNING] server.js — Route answered told for a non-member assignee whose membership-derived block never listed the task --> FIXED (18db7ee, assignment requires membership, refused inside the same atomic mutate)
- [NIT] engine/tasks.js — Non-integer stored number interpolates regex (1.5 matches "task 175") --> FIXED (18db7ee)
- [NIT] engine/projects.js — Per-describe read amplification --> FIXED later (cb0fb3c/172eed9, WeakMap memo per snapshot)

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Duplicates of prior findings (confirmed resolved):** ambiguity guard, membership refusal
- [WARNING] engine/projects.js — Member REMOVAL re-created told-when-not through the other door (removal does not unassign; block derives from membership) --> FIXED (cb0fb3c, departed assignee joins as could-not-tell with reason)
- [WARNING] engine/tasks.js — Trailing \b sits between "1" and ".", so "task 1.5" in a REPORT joined task 1 --> FIXED (cb0fb3c, two lookaheads; "task 1." still matches)
- [NIT] engine/tasks.js — Hardcoded 'unknown' string; unrecognized states fell to the definite branch --> FIXED (cb0fb3c, definite branch allowlisted on producer's STATE vocabulary)
- [NIT] engine/projects.js — counts rebuilt per describe --> FIXED (cb0fb3c, WeakMap memo)
- [NIT] engine/projects.js — NaN keys collapse; NaN in because-sentence --> FIXED (cb0fb3c, non-integers excluded from count, routed to whole-number reason)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings (confirmed resolved):** removal door, boundary, state allowlist
- [WARNING] engine/projects.js — Ambiguity count included departed-project leftovers, suppressing the live project's join with a false because-sentence --> FIXED (d2bba40, count mirrors the taught convention: member tasks only; no-haunt test)
- [WARNING] server.js — told verdict on task routes had zero test coverage --> FIXED (d2bba40, wire tests: absent when unassigned, present in vocabulary when assigned, on create/close/reopen)
- [NIT] engine/projects.js — Inner readAll binding shadowed the join's all parameter --> FIXED (d2bba40, renamed)
- [NIT] engine/tasks.js — isInteger admits 1.5e21 whose string interpolates a dot --> FIXED (d2bba40, isSafeInteger in matcher, count, teaching lines)

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Duplicates of prior findings (confirmed resolved):** count scope, told coverage
- [WARNING] engine/projects.js — Join did not inherit the borrowed-name gate its sibling consumers carry (status answers unknown, GET 404s, while the join spoke for the name) --> FIXED (0d0546e-range commit "iteration 4", gate inherited; tied-vs-stranger test)
- [WARNING] engine/tasks.js — Number(true) is 1, Number(null) is 0: hand-edited non-number types passed the guard --> FIXED (iteration 4 commit, non-coercing typeof checks in all three sites)
- [NIT] engine/projects.js — Ambiguity sentence claimed "projects" for a same-project duplicate --> FIXED (reworded to name the tasks, true in both cases)
- [NIT] engine/projects.js — Two-arg describe fallback readAll could throw --> FIXED (try/catch, judge from the one project in hand)
- [NIT] plan file — Stale 799/799 count --> FIXED
#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings (confirmed resolved):** borrowed gate, type guards
- [WARNING] engine/projects.js — Borrowed-name gate failed OPEN on an unreadable roster (null collapsed into "no pane holds the name" while sibling consumers fail closed) --> FIXED (iteration 5 commit, fails closed with tellAgent's own sentence; null-roster test)
- [NIT] server.projects.test.js — told pin accepted not_tried, a state live sync never produces --> FIXED (tightened to told/could_not)
- [NIT] engine/projects.js — readings memoized per describe, not per snapshot --> FIXED (readings ride the same WeakMap snapshot as the counts)

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** — no new actionable findings.
- [NIT] ambiguous() lacked the type guard its two siblings carry --> FIXED (172eed9)
- [NIT] told shape differs between task routes (bare verdict) and project routes (array) --> FIXED (172eed9, shape comment)
- [NIT] plan count 800 vs 801 --> FIXED (172eed9)
- [NIT] Teaching trailer over-promises for colliding numbers --> DEFERRED: agreed scope; the plan defers unambiguous teaching to the next slice ("refusing to guess is this one")

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/projects.js:365 | Cross-project (who, number) collision rendered definite claims | FIXED | 18db7ee |
| 2 | 1 | WARNING | server.js:1868 | told answered for non-member assignee | FIXED | 18db7ee |
| 3 | 2 | WARNING | engine/projects.js | Member removal resurrected told-when-not | FIXED | cb0fb3c |
| 4 | 2 | WARNING | engine/tasks.js | \b admitted "task 1.5" as task 1 | FIXED | cb0fb3c |
| 5 | 3 | WARNING | engine/projects.js:384 | Departed leftovers polluted ambiguity count + false reason | FIXED | d2bba40 |
| 6 | 3 | WARNING | server.js:1871 | told verdict untested | FIXED | d2bba40 |
| 7 | 4 | WARNING | engine/projects.js:413 | Borrowed-name gate not inherited | FIXED | iter-4 commit |
| 8 | 4 | WARNING | engine/tasks.js:178 | Coercing number guard (true→1) | FIXED | iter-4 commit |
| 9 | 5 | WARNING | engine/projects.js:427 | Gate failed open on unreadable roster | FIXED | iter-5 commit |
| 10 | 6 | NIT | engine/projects.js:1379 | Teaching trailer over-promise on collisions | DEFERRED | Agreed scope: next slice teaches the unambiguous spelling |

(NITs 11-22: eight taken as fixes across cb0fb3c/d2bba40/iter-4/iter-5/172eed9 as itemized above; one deferred.)

### NITs (non-blocking, across all iterations)
- Teaching trailer promises the says-line an ambiguous number cannot deliver (iteration 6) — deferred to the next slice with the unambiguous spelling.
- All others taken; see per-iteration breakdown.

### Strengths (across all iterations)
- Three-answer honesty contract carried end to end with no leak; definite branch allowlisted on the producer's STATE vocabulary; UI renders only claimed === true (every iteration confirmed independently).
- Matcher boundary precise and tested in both directions (task 12, task 1.5, "task 1." terminal-dot case, non-number types).
- Membership refusal inside the same atomic mutate as the write; no TOCTOU.
- All sibling gates inherited (borrowed name, fail-closed roster), each pinned by a dedicated test including presence-before-absence controls.
- Resource discipline: counts and readings memoized per store snapshot via WeakMap.
- Test hygiene: DATA-root sandbox added the moment tests began writing commitments; drive asserts the negative before the positive and measures the full arc live.
