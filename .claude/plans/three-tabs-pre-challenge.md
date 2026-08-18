---
pre_challenge: true
method: challenge-loop
branch: three-tabs
diff_hash: 7f0ee2ab9e82fc40dd9c2d5e13fbd79d32ef4db9da07e30269f3cb8da6fad43d
subdir_audit: passed
timestamp: 2026-08-18T04:17:24Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (light per the standing rigor split; a ruled removal)
**Converged:** Yes -- the round's one WARNING and one NIT were fixed in
the same sitting (29e2af2); nothing else found.
**Total findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Fixed:** 2 | **Deferred:** 0

### Iteration 1
- [WARNING] web/index.html boot path -- ?tab=joint (a formerly valid,
  bookmarkable value) stranded the tablist with nothing selected
  (showTab deselects before bailing on an unknown tab; ARIA violation,
  no visual selection) --> FIXED: joint aliases to projects at boot
  (where its content lives, per the ruling), and any unknown tab falls
  back to the board instead of stranding.
- [NIT] first-run CSS comment still said "four tabs" --> FIXED.
- [STRENGTH] (reviewer) the removal is otherwise complete: repo-wide
  sweep found no stranded references in server.js, engine/, tests, or
  drives; no tab logic addresses tabs by index or count; PANELS updated
  in lockstep; 823/823 green.

### The removal's invisible half (checked BEFORE the tab came off)
Mona Lisa's rule, run proactively for the first time: a removal is two
changes and only one is visible where you made it. Engine-level positive
check in a sandboxed store: a project with TWO agents lands in the ONE
Projects list with both agents readable. Joint was never a second list;
nothing strands. The four-tab default held until Josh ruled ("drop to
the pack's 3 tabs"), and the tab and the name flipped together per the
settled coupling.
