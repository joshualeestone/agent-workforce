---
pre_challenge: true
method: challenge-loop
branch: room-polish
diff_hash: 80eec5edf7dc6f2cbe7e52f516209ac71c2820f3a804deafeb91622b71a0aedd
subdir_audit: passed
timestamp: 2026-08-18T21:36:00Z
iterations: 5
converged: true
---

# Challenge-Loop Proof: room-polish

Five iterations of fresh, blind review agents. Convergence: iterations 4
and 5 consecutively free of blockers, warnings, and new conventions.
Validation (yarn type-check/lint/test + shell suite) passed on the final
tree; subdir CLAUDE.md audit clean (no subdir CLAUDE.md files changed).

## Iteration 1 (1 WARNING, 2 CONVENTION, 2 NIT)

[WARNING] server.test.js — the group could_not test pinned only the
sentence prefix, leaving the plan's "because verbatim, esc'd" honesty
constraint unpinned. FIXED: asserts the because rides along and that a
markup-carrying because arrives escaped (raw markup asserted absent).
[CONVENTION] server.test.js — TOLD_PRELUDE hand-copied esc with wrong
null-handling. FIXED: lifts the page's real esc via pageFnSource.
[CONVENTION] web/index.html — PR must carry a dark-scheme screenshot since
text-level tests cannot see rendering. ACTIONED at PR time (dark shots of
the failed/placed pills, the collapsed roster, the valve band).
[NIT] insideDark marker-order inference. FIXED in iteration 1-2 window:
brace-matched block measurement with a negative control.
[NIT] STATE_COPY partial stand-in uncommented. FIXED: commented as
deliberately partial.

## Iteration 2 (0 blockers/warnings/conventions, 3 NIT)

[NIT] pjToldGroupLine trusted its caller's pre-filter for the
not_tried/empty case. FIXED: local explicit guard.
[NIT] insideDark loop start unguarded against a missing brace. FIXED.
[NIT] STATE_COPY key-drift residual. DEFERRED: other surface tests
exercise the real const; the stand-in feeds only an unasserted caption.

## Iteration 3 (1 WARNING, 3 NIT)

[WARNING] web/index.html — the group could_not frame spliced singular
engine becauses ("this agent has no folder…") into a plural sentence,
reading as a contradiction. FIXED: the frame introduces the reason
("Each for the same reason: <because>."), pinned by test and verified
rendered (room-polish-couldnot.png, attached to the PR).
[NIT] pjMember's doc block left heading pjToldLine after the extraction.
FIXED: moved back onto pjMember.
[NIT] valve band emitted an empty .msg-t span carrying the new margin.
FIXED: span only when a timestamp exists.
[NIT] positive collapse only on hand-built stand-ins. FIXED: suppress
test widened to a two-agent produced roster; collapse exercised on real
producer rows.

## Iteration 4 (0 blockers/warnings, 1 CONVENTION dedup, 2 NIT)

[CONVENTION] screenshot-not-in-tree — duplicate of iteration 1's PR
evidence item, already tracked; screenshots attached at PR time.
[NIT] group fallback "its instructions" singular in plural frame. FIXED:
fallback is our own text (not engine verbatim) so it takes the plural;
pinned by test.
[NIT] paintOneProject wiring untested. FIXED after iteration 5 confirmed
it (see below).

## Iteration 5 (0 blockers/warnings/conventions, 2 NIT) — CONVERGED

[NIT] paintOneProject wiring pin suggested (function tests stay green if
the append is dropped). FIXED: source-level pin asserting the
pjSharedTold call and pj-told-group literal, with a CSS-presence control.
[NIT] singular engine sentence inside the colon-introduced group frame —
observation only; recorded as the deliberate verbatim-honesty trade-off.

## Strengths carried across passes

[STRENGTH] Rendered-line equality as the collapse key makes the group
claim exactly as true as the rows it replaces; the plural told form keeps
the hedge verbatim.
[STRENGTH] Presence-before-absence throughout: light rules pinned before
dark twins; the verdict span proven present before proven suppressed; a
pre-control that the produced member carries a verdict at all; a negative
control turning insideDark on a light rule.
[STRENGTH] Real producers: fleet board -> create -> syncAgent -> list for
the member fixture; the page's own esc lifted by source.
[STRENGTH] Dark values are family-consistent (255,140,130 attn red;
121,197,157 working green), never invented.

### Final Ledger

| # | Iter | Category   | Location                    | Status   | Resolution |
|---|------|------------|-----------------------------|----------|------------|
| 1 | 1    | WARNING    | server.test.js (group pin)  | FIXED    | 7919f5a    |
| 2 | 1    | CONVENTION | server.test.js (esc copy)   | FIXED    | 7919f5a    |
| 3 | 1    | CONVENTION | PR evidence (dark shots)    | ACTIONED | at PR      |
| 4 | 1    | NIT        | dark-block assertion        | FIXED    | 7919f5a    |
| 5 | 1    | NIT        | STATE_COPY comment          | FIXED    | 7919f5a    |
| 6 | 2    | NIT        | pjToldGroupLine guard       | FIXED    | 77515b4    |
| 7 | 2    | NIT        | insideDark -1 guard         | FIXED    | 77515b4    |
| 8 | 2    | NIT        | STATE_COPY key drift        | DEFERRED | real const exercised elsewhere |
| 9 | 3    | WARNING    | group frame plural/singular | FIXED    | it-3 commit |
| 10| 3    | NIT        | pjMember doc block          | FIXED    | it-3 commit |
| 11| 3    | NIT        | empty .msg-t span           | FIXED    | it-3 commit |
| 12| 3    | NIT        | produced-row collapse case  | FIXED    | it-3 commit |
| 13| 4    | NIT        | plural group fallback       | FIXED    | it-4 commit |
| 14| 5    | NIT        | paintOneProject wiring pin  | FIXED    | final commit |
| 15| 5    | NIT        | singular-in-frame remark    | DEFERRED | deliberate verbatim trade-off |

Also fixed in-branch (reported by Mona Lisa's drawing pass, verified in
the build before changing): the valve band concatenated sentence and
timestamp with no separator; .msg-valve .msg-t { margin-left: .5em; }
(pack value, FROZEN-2026-08-18c), scoped so the flex-gapped header
timestamp is untouched.
