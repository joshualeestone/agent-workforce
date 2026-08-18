---
pre_challenge: true
method: challenge-loop
branch: group-reasons
diff_hash: 65cd12a4b51cf1c1d310324713544bea3185d0b72836a411a415927af230b7af
subdir_audit: passed
timestamp: 2026-08-18T22:35:00Z
iterations: 5
converged: true
---

# Challenge-Loop Proof: group-reasons

Five fresh blind passes; iterations 4 and 5 consecutively free of
blockers/warnings/conventions. Full validation green each round.

## Iteration 1 (1 WARNING, 3 NIT)

[WARNING] engine/projects.test.js - the mapping test's keys were copies
of the map keys; author-site drift undetected. FIXED: source pin added
(then hardened further in 2 and 3).
[NIT] aria-label containment (WCAG 2.5.3). FIXED (reworked again in 2).
[NIT] told/not_tried becauseGroup-null uncovered. FIXED: both asserted.
[NIT] "Remove from project" strings unpinned. FIXED: render asserts.

## Iteration 2 (1 BLOCKER, 1 WARNING, 2 NIT)

[BLOCKER] the source pin scanned projects.js WITH the map in it - the
pin contained a copy of every key and could never fail. FIXED: the
GROUP_BECAUSE declaration is stripped before scanning, with a control
proving the strip worked.
[WARNING] the aria comment claimed substring containment that was false
(name interpolated mid-string). FIXED: accessible name now STARTS with
the visible label ("Remove from project: <name>"); test asserts the
containment property itself.
[NIT] button asserts wedged inside the CONTROL sandwich. FIXED: moved.
[NIT] draft plural tension ("one ... for them"). TRACKED: Mona Lisa's
bless-or-replace pass on all eight drafts.

## Iteration 3 (2 WARNING, 2 NIT)

[WARNING] duplicated author sites (you.js carries verbatim twins for the
you-block) let an edit to the FEEDING copy pass the pin. FIXED: the pin
scans only the modules whose verdicts reach project.told (stripped
projects.js, workerfile.js), each singular pinned to its feeding file.
[WARNING] unmapped-but-identical becauses collapsed to a reasonless line
while suppression hid the per-member rows - total information loss.
FIXED: collapse is conditional (told always; could_not only with the
plural sibling); unmapped reasons keep their rows; the reasonless
sentence survives only as pjToldGroupLine's defensive arm, tested
directly. Flagged to Mona Lisa for explicit confirmation.
[NIT] stale "Take-off buttons" comment. FIXED.
[NIT] property-vs-copy comment overstatement. FIXED: comment now names
the copy pin and the property assert separately.

## Iteration 4 (0 blockers/warnings/conventions, 2 NIT)

[NIT] strip-window control covered only the first map entry. FIXED:
controls at BOTH ends of the window.
[NIT] no nudge for authors of NEW becauses to add a map row. DEFERRED:
the information-safe fallback (per-member rows, no collapse) is the
designed behavior; Mona Lisa's pass tracked in the plan.

## Iteration 5 (0 blockers/warnings/conventions, 2 NIT) - CONVERGED

[NIT] draft wording row 2 ("one ... for them"). TRACKED for her pass.
[NIT] leak-guard scope comment. FIXED: write-back named as the guarded
failure.

### Final Ledger

| # | Iter | Category | Location | Status | Resolution |
|---|------|----------|----------|--------|------------|
| 1 | 1 | WARNING | mapping test copies | FIXED | source pin |
| 2 | 1 | NIT | aria containment | FIXED | reworked it-2 |
| 3 | 1 | NIT | told/not_tried null | FIXED | asserted |
| 4 | 1 | NIT | button strings unpinned | FIXED | render asserts |
| 5 | 2 | BLOCKER | pin scanned its own copy | FIXED | strip + control |
| 6 | 2 | WARNING | false substring claim | FIXED | label-leading aria |
| 7 | 2 | NIT | asserts in control sandwich | FIXED | moved |
| 8 | 2 | NIT | draft plural tension | TRACKED | her pass |
| 9 | 3 | WARNING | twin author sites | FIXED | feeding-module pin |
| 10 | 3 | WARNING | reason loss on collapse | FIXED | conditional collapse |
| 11 | 3 | NIT | stale comment | FIXED | renamed |
| 12 | 3 | NIT | comment overstatement | FIXED | reworded |
| 13 | 4 | NIT | one-ended strip control | FIXED | both ends |
| 14 | 4 | NIT | new-because nudge | DEFERRED | designed fallback |
| 15 | 5 | NIT | leak-guard comment | FIXED | write-back named |
