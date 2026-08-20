---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: project-page
diff_hash: f9abf91f0cf53fd50ef164ef8e382926278543a702ff4c3b11f9588ba5785a27
subdir_audit: passed
timestamp: 2026-08-20T03:10:34Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: project-page (chunk A)

**Single pass, explicit override, labelled honestly.** /challenge-loop is not
invocable in this session; a proof claiming a loop that never ran is worse than
an accurate single pass. Josh's 2026-08-19 21:25 and 21:40 rulings stand: beta
app, no users, finished work merges without waiting, decide blockers and keep
moving.

## ⚠️ READ FIRST: this branch ships with a KNOWN RED, on purpose

- `yarn test` RUNS and PASSES: 926/926, three runs.
- `docs/browser-checks/render-projects.js` RUNS and FAILS: 2 contrast
  measurements, `.pj-told` in light and dark.

That red is **not "both checks pass"**. It is inherited, measured, and
deliberately not papered over. See the ledger.

## Iteration 1 (single pass)

[STRENGTH] **Every visual change was rendered, not read.** Two thirds of the
last CSS branch was rules that read correctly in the diff and lost the cascade,
so source-reading tests are the wrong instrument here. `render-projects.js`
and `render-fields.js` were run in a real browser after each change, and the
room was inspected as a screenshot in BOTH schemes.

[STRENGTH] **The check caught a defect the 926 could not.** Swapping the column
headers from `.flabel` to `.dlab` broke the checker's own selector, which
located the members heading by class and so walked down the page and reported
the heading had been renamed to "Talk to one of them" — at 926/926 green. That
is a confident wrong answer, not a silent one. Repaired to locate by STRUCTURE
(the element before the members list) and to assert it is a heading element.

[STRENGTH] **The inherited red was MEASURED against a control**, not asserted
from inside this branch. `origin/main` at 973866b, clean worktree, main's own
checker sha c4088cce4401, a separately sandboxed board: identical failures.
A branch cannot tell "pre-existing" from "mine" by reading its own diff.

[STRENGTH] `.linkish` was declared twice at equal specificity and the later
rule re-set every property the earlier one had. Verified property by property
before removal, so the claim "it contributed nothing" is checked rather than
plausible. Removed rather than commented, per this file's own rule about
`.pjthread` and `.fr-back`.

[STRENGTH] The three token corrections change RENDERED values (16->10, 16->12,
8->12), so `render-fields.js` was run after them specifically: every field and
control invariant holds in both engines and both schemes, 0 fields flipping
their relationship to their container between light and dark.

[STRENGTH] **Two claims were deliberately NOT shipped.** The pack draws a `+`
attach button and a hint promising drop-to-attach. This build has neither an
attachment path nor a Documents surface, so both would be false. Held with the
reason recorded at the site.

[WARNING -> RESOLVED] Turning the composer's `<input>` into a `<textarea>`
silently changed what Enter means: the existing handler caught EVERY Enter,
which cost nothing on an element that could not hold a newline and makes a
growing field unwritable past one line. Fixed with `!e.shiftKey`; Enter still
posts, which is the behaviour people already have.

[WARNING -> RESOLVED] A restored draft would have come back one row tall,
because the grow runs on `input` and setting `.value` in code fires no such
event. Wired explicitly at the restore site.

[NIT] `.pjmid` and `.pj3` still carry values this file inherited rather than
derived; a full class-system reconciliation with the pack is deliberately not
in this branch (recorded in the plan).

### Final Ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| 1 | 1 | WARNING | web/index.html keydown | FIXED | Enter still posts; Shift+Enter newline |
| 2 | 1 | WARNING | web/index.html draft restore | FIXED | grow called at the restore site |
| 3 | 1 | BLOCKER | render-projects.js members heading | FIXED | located by structure, not class |
| 4 | 1 | (inherited) | render-projects.js .pj-told | DEFERRED | red on main too, measured; needs a failed-tell fixture that does not exist |
| 5 | 1 | NIT | class-system reconciliation | DEFERRED | by design: out of this branch's scope, in the plan |
