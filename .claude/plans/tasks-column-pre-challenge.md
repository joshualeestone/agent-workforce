---
pre_challenge: true
method: challenge-loop
branch: tasks-column
diff_hash: 3c4d602151ff7388942676ee44e524f2e16f7b642ed3a7f75d98c8a277ba60c3
subdir_audit: passed
timestamp: 2026-08-17T02:21:06Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No (closed after iteration 1 under the operator's standing
stop rule: the round found zero BLOCKERs, and every finding it raised was
fixed before this proof; nothing deferred.)
**Total findings:** 12 (0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 6 NITs)
**Fixed:** 12 | **Deferred:** 0

### Per-Iteration Breakdown

#### Iteration 1 (0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 6 NITs)
- [WARNING] the view dialog's click derived its act from state fresher
  than its label (the poll could invert Mark-as-done into a silent
  reopen) --> FIXED (act captured at open; a moved world repaints the
  dialog instead of acting)
- [WARNING] the task list repainted unconditionally every poll tick,
  destroying keyboard focus --> FIXED (change-guarded, the removed-
  list's own pattern; guard cleared on project switch)
- [WARNING] a non-string who was silently stored as unassigned (a 200
  the caller reads as an assignment) and who had no length cap -->
  FIXED (present-but-invalid who refused with its own sentence; WHO_MAX;
  tests aimed at the dropped-assignment class)
- [WARNING] the New-task backdrop deleted typed words on a misclick -->
  FIXED (backdrop inert while anything is typed; Escape/Cancel stay the
  explicit discards)
- [CONVENTION] describe() left tasks/taskCounter un-normalized against
  its own healed-shape rule --> FIXED (tasks: [], taskCounter: 0 for
  legacy records)
- [CONVENTION] the door comment described a reveal that "lasts until
  the next repaint", behaviour never built --> FIXED (comment states
  the real model: survives repaints and same-project Back-and-return,
  resets on switch)
- [NIT] focus restore targeted the first card, not the opener --> FIXED
  (exact card, New task as the stable landing after a repaint)
- [NIT] dead pj-tasks-msg element --> FIXED (removed)
- [NIT] t.number interpolated raw --> FIXED (coerced)
- [NIT] chip initial took one UTF-16 unit --> FIXED (Array.from)
- [NIT] pjReload double-painted --> FIXED (loadProjects already paints)
- [NIT] an orphaned dialog's button silently did nothing --> FIXED
  (closes instead)

### Final Ledger (compressed)
4 WARNINGs, 2 CONVENTIONs, 6 NITs: all FIXED in commit after 562011c;
zero deferred. The connect-test flake observed mid-run is pre-existing,
recorded in the plan, and did not reproduce for the reviewer.

### Strengths (reviewer)
- The number issued inside the same atomic mutate that stores the task;
  refusals spend neither a number nor a record, proven on the store.
- The guard test asserts by persisted-state count with the
  sibling-does-not-inherit framing.
- The drive-through called out for real keypresses on the trap, verbatim
  pins on the blessed copy, measured column/door split, and the genuine
  project-switch bounce; 792/792 beside it.

### Verification at close
node --test 792/792; committed drive green end to end after the fixes
(TASKS DRIVE OK, 0 page errors); screenshots committed (modal, column,
view dialog with the blessed close-note on screen).
