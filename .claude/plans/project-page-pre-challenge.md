---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: project-page
diff_hash: 17255900a72dfbd4a47b12edca411e83806dd5171e45ce1fe9e144f81ab5a4f8
subdir_audit: passed
timestamp: 2026-08-20T05:28:23Z
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

## Second slice on the same branch (2026-08-19, after #91)

#91 shipped the restore-to-pack half. This adds the rename, Project documents,
the open-a-local-file route, two backwards create-flow comments, and the second
`.flabel` dependency. Reviewed the same way: single pass, explicit override,
every visual change rendered rather than read.

[STRENGTH] **A version REGRESSION was caught before the PR, not by a test.**
This branch was cut when main was 0.2.1 and main is now 0.2.2, so merging it
as-is would have set `package.json` BACK to 0.2.1 — which every board already
on 0.2.2 reads as "no update available", silently. Nothing in the suite pins the
version to a number, so nothing would have failed. Fixed by merging main in
first, and the conflicts resolved toward this branch only after confirming that
the only main-side commits touching those files were this branch's own squash
(#91) and the bump (#92).

[STRENGTH] The merge was verified by CONTENT, not by the merge exiting 0: spot
probes for five distinct pieces of #91's shipped work and four of tonight's, all
present, then 938 tests and both browser checks re-run on the merged tree.

[STRENGTH] The open-file gate that matters is proven: deleting the containment
check turns the suite red with "a symlink out of the project was opened".

[STRENGTH] The route test caught a defect **because it asserted the sentence**.
`readBody` resolves a Buffer; the first version read `.name` off it and
refused every open with "no file was named", while the escape case still
returned 409. A status-only assertion would have passed on a route that could
neither open nor properly refuse.

[WARNING -> RESOLVED] The `d-rename` field first reused `id="d-name"`, which
was already the page heading. Caught by geometry (59x16 is text, not a field)
after Playwright's `fill` refused to act — the refusal was the only honest
signal in the run.

[NIT] The documents "view all" reveals the folder in Finder rather than opening
a dedicated screen. Labelled for what it does rather than what Josh asked for,
with the screen recorded as a later slice.

### Second-slice ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| 6 | 1 | BLOCKER | package.json | FIXED | merged main; version regression caught pre-PR |
| 7 | 1 | BLOCKER | web/index.html d-name | FIXED | renamed to d-rename; id collision |
| 8 | 1 | BLOCKER | server.js open-file | FIXED | readBody returns a Buffer, not JSON |
| 9 | 1 | BLOCKER | render-projects.js contrast sweep | FIXED | selector asserted with `expect` |
| 10 | 1 | NIT | documents view-all | DEFERRED | by design: screen is a later slice |

## Third slice on the same branch (2026-08-19, after #93)

Member faces, task status, and the role-hint copy fix. Same review shape:
single pass, explicit override, every visual change rendered rather than read.

[STRENGTH] **The version regression was caught a SECOND time, the same way.**
Branch at 0.2.2, main at 0.2.3; merging as-is would have set it backwards and
every board on 0.2.3 would read that as "no update available", silently. The
suite pins no version to a number, so nothing would have failed. This is now a
known trap with a known check, and the check is "compare both sides before
merging", not a test.

[STRENGTH] The plan-file conflict was resolved toward this branch only AFTER
proving ours is a SUPERSET: every heading on main's side was confirmed present
here first. "Take ours" on a file both sides edited is otherwise a silent
deletion.

[STRENGTH] **Two real defects in the test harness, both fixed rather than
worked around.** `pageConstSource` matched only object consts, so lifting an
array asserted "DISC_TINTS vanished from the page" about a const sitting right
there; and after that was widened, `DISC_INKS` still "vanished" because it is
written with two spaces before its `=`. Both failures said the same untrue
sentence about different causes. Now a whitespace-tolerant regex over either
opener.

[STRENGTH] The pjMember test lifts the REAL disc helpers rather than stubs. It
went red with "discTint is not defined", which is the extraction harness working
as designed; stubbing would have kept it green while no longer exercising the
face branch.

[WARNING -> RESOLVED] **The first verification of task status was worthless and
reported 4 of 4.** It measured `.tkcard-who`, the WRAPPER, so it read
textDecoration 'none' for every state including the one whose point is a
decoration -- and still counted four distinct signatures because the TEXT was in
the signature. Re-measured on the mark elements: `.tkunk` is underline/dotted
in both schemes, `.tksay` is none. Second time tonight a check of mine answered
confidently about the wrong element.

[NIT] `claimed` true and false deliberately share `.tksay`: same kind of
statement, same voice, opposite polarity. Distinguished by their words, which is
the distinction that is real.

[NIT] Project documents reads the project FOLDER while the attach path would
write to app data (§7b), so the two would disagree once the `+` lands.
Recorded in the plan with Mona Lisa's merge recommendation; it needs Josh,
because it is two of HIS sentences that disagree.

### Third-slice ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| 11 | 1 | BLOCKER | package.json | FIXED | version regression caught pre-PR, second time |
| 12 | 1 | BLOCKER | server.test.js pageConstSource | FIXED | arrays + whitespace-tolerant matcher |
| 13 | 1 | WARNING | task-status verification | FIXED | re-measured on the mark, not the wrapper |
| 14 | 1 | NIT | documents source | DEFERRED | needs Josh; recorded with options |

## Fourth slice (2026-08-19, after #95)

The pack's treatment of the "+ Add member" button, and a recorded NON-answer.

[STRENGTH] ⚠️ THE VERSION TRAP APPEARED A THIRD TIME AND WAS CAUGHT A THIRD
TIME. Branch 0.2.3, main 0.2.4. Same silent failure, same defence: compare both
sides before merging.

[STRENGTH] ⚠️ THE MERGE COMMIT FAILED LOUDLY AND THAT WAS THE POINT. One
conflict was reported in the tail I read; a SECOND (the plan file) was not, and
`git commit` refused with "you have unmerged files" rather than committing a
half-resolved tree. Resolved only after confirming again that this branch's plan
is a superset of main's, heading by heading.

[STRENGTH] The button is FROZEN-2026-08-19:3022 verbatim: quiet, full column
width, .875rem, the pack's padding, sentence case.

[STRENGTH] ⚠️ AND THE TWO CONTROLS JOSH ACTUALLY CIRCLED ARE RECORDED AS
UNANSWERABLE rather than invented. The Sponsor picker and "Put it on this
project" live in the revealed state of that control, which the pack does not
draw at all. Two circles on one screen, one with a pack answer and one without,
is exactly where inventing the second is indistinguishable from having matched
something.

[WARNING -> RESOLVED] My first measurement reported `fullWidth:false` on a
full-width button: it subtracted the column's padding and forgot its 1px border.
Re-measured against clientWidth minus padding, 212 = 212. Third probe of mine
tonight that measured a NEIGHBOUR of the thing I meant.

### Fourth-slice ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| 15 | 1 | BLOCKER | package.json | FIXED | version regression, caught third time |
| 16 | 1 | WARNING | full-width probe | FIXED | measured the content box, not the border box |
| 17 | 1 | NIT | Sponsor picker / confirm button | DEFERRED | no pack drawing exists; recorded |

## Fifth slice (2026-08-20): path citations

[STRENGTH] **The escape is not relaxed, and the guard is PROVEN.** Deleting the
per-token escapes turns the suite red with "a script tag beside a citation was
not escaped". Verified in a real browser on a body containing all four cases at
once: two chips for the two files that exist, a path shown as written with the
basename in `data-ref`, a non-existent file left as plain text, and
`<script>alert(1)</script>` rendered escaped with no raw tag in the markup.

[STRENGTH] **The client does not sniff.** A token becomes a chip only when it
matches a file the folder contains right now, which is also what makes the
chip's promise keepable: "Show me" goes through the same route with the same
three gates, so a chip is never offered for something the opener would refuse.

[STRENGTH] The two escape tests cover DIFFERENT escapes, measured by
perturbation rather than assumed: the byte-for-byte test stays GREEN when the
per-token escapes are deleted, because its bodies never reach that path. The
test file says so where someone would otherwise delete one as a duplicate.

[STRENGTH] `names` comes from the SAME folder read as the capped list. Behind
a second route, a file past the cap would render as dead text while its
neighbour rendered as a chip: one file, two appearances, decided by sort order.

[BLOCKER -> FIXED] ⚠️ **A previous commit on this branch shipped CONFLICT
MARKERS.** A resolve script asserted and died; the `git add` and `git commit`
on the following lines ran anyway, and `git add` does not care about markers.
Caught by "every CSS declaration in the page sits inside a selector" failing
with "the brace walk ended at depth -1" -- a CSS-structure test doing a merge
check's job, because `<<<<<<<` is not valid CSS. The resolve is now gated on a
proven zero-marker count, and this branch is pushed only after the same check.

[NIT] The per-agent thread (`pj-msg-text`) still escapes plainly and does not
link. The pack draws `.ref` in the room; that surface is part of the
answer-panel chunk and will get it there rather than by a drive-by.

[NIT] ⚠️ Sandboxing DATA/WORKERS/LAUNCH/PROJECTS does NOT sandbox tmux: a test
post into a sandboxed room typed into a live agent's session. Recorded in the
plan.

### Fifth-slice ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| 18 | 1 | BLOCKER | web/index.html | FIXED | conflict markers committed; resolve now gated |
| 19 | 1 | BLOCKER | package.json | FIXED | version regression, caught a FOURTH time |
| 20 | 1 | NIT | pj-msg-text | DEFERRED | belongs to the answer-panel chunk |
| 21 | 1 | NIT | tmux not sandboxed | DEFERRED | recorded; needs a fixture, not a flag |

## Sixth slice (2026-08-20): external links

[STRENGTH] **Not a sniffer, and the distinction is load-bearing.** `https://`
is a DELIMITER, not an inference: a token either starts with it or does not. The
test is a literal prefix rather than a URL parse, so there is no scheme for it
to be tricked about -- `javascript:`, `data:`, `file:` and `vbscript:`
are not matched at all and return as plain escaped text, PROVEN with a positive
control that a real URL still links.

[STRENGTH] `rel="noreferrer noopener"` on the one click in this product that
leaves the machine.

[STRENGTH] Verified in a real browser, both schemes, WITHOUT touching tmux: the
fixture message was written into the sandbox store rather than posted through
the route, because a real post types into a live agent's session and this test
needed a render, not a delivery. 2 links, correct hrefs, trailing full stop
excluded, no dangerous scheme linked, no raw script, 0 page errors.

[BLOCKER -> FIXED, MINE] ⚠️ **I had the build order wrong and Mona Lisa caught
it with my own rule.** I grouped `.quoteb` with `.xlink` as "unambiguous".
Its only plausible trigger is a leading `>`, which is also shell redirects,
diff markers and arrows in prose, and its false positive wraps an agent's OWN
prose in a blockquote -- asserting *these are not my words*, a claim about
AUTHORSHIP. My benign-failure test was right; I scored it by whether anything
would RENDER rather than by what a wrong render would CLAIM.

[STRENGTH] **The merge was proven rather than judged.** Thirteen conflict hunks
across three files, resolved wholesale toward this branch only after showing
the sole main-side commit touching them is this branch's own squash (#99), then
verified by content, then gated on a zero-marker count.

[NIT] There is NO message corpus: the Kosmos room has never carried a message,
so the spec's evidence claim is a transfer from the fleet. Recorded so nobody
measures an empty file and concludes agents do not cite paths.

### Sixth-slice ledger

| # | Iter | Category | File:Line | Status | Resolution |
|---|------|----------|-----------|--------|------------|
| 22 | 1 | BLOCKER | build order | FIXED | .quoteb moved behind an explicit marker |
| 23 | 1 | BLOCKER | package.json | FIXED | version regression, caught a FIFTH time |
| 24 | 1 | NIT | .quoteb | DEFERRED | ships on an engine marker or not at all |
| 25 | 1 | NIT | no corpus | DEFERRED | recorded; measurement must use fleet data |
