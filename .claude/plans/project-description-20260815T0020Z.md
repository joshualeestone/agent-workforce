# project-description: the one-line description field

Date: 2026-08-15 (overnight run). Owner: Angel. Directive: Josh, twice on
2026-08-14 (placement under the title, editing home in project settings),
with Mona Lisa's pack rendering it on every card; PIN-2026-08-14-1913CDT
covers "Project card and detail description rendering". Cap for this
branch's challenge loop: 6 rounds, set before starting, sized to blast
radius (one optional string in the PROJECTS record; the worst it can
break is a card's text).

## What this adds

- `engine/projects.js`: `cleanDescription` (one-line fold like the name's,
  trim, 200-char cap), `create({ description })` storing it (empty string
  when absent), and `setDescription(id, text)` where explicit empty
  CLEARS, deliberately unlike the profile displayName's blank-drop: a
  description is optional by design and the settings screen offers
  clearing. Legacy records read as '' everywhere via describe; a setDescription write adds the field (a name-only edit leaves the record keyless, which describe covers) and
  read as '' everywhere.
- `server.js`: POST /api/projects passes it through; PUT /api/project/:id
  now moves each field only when the request carries it (the route used
  to run rename unconditionally), and re-tells members only on a rename,
  since the managed block carries the name and nothing else.
- `web/index.html`: the card row gains an escaped one-line description
  between name and path; the detail renders it directly under the title.
  Both absent entirely when there is none (no empty grey line). The CSS
  uses --label-2 per the twice-measured AA rule on this screen.
- Tests: engine (trim/fold/cap/optional; update/clear/legacy-heal), route
  (create carries, GET lists, description-only PUT leaves the name alone,
  rename-only PUT leaves the description alone, explicit empty clears),
  source pins for both rendering arms, and a rendered-page pass in
  render-projects.js asserting the row, the absence arm, and the detail.

## Out of scope tonight

The editing UI (the pencil lives in project settings, an unpinned
screen); the pack's three-column detail. The route is the write path
until settings lands.

## Verification

node --test (742 after round 1), render-projects.js and render-thread.js
against the sandboxed fixture, then the challenge loop (rounds recorded
below).

## Review round 1 (2026-08-14 evening)

Seven warnings, all fixed:
- The PUT applied rename and setDescription as two independent writes, so a
  failure in the second reported failure for a rename that had persisted.
  Engine gains `edit(id, fields)`: every carried field validated BEFORE one
  mutate, so a save applies whole or not at all (tested engine and route).
- A PUT carrying no recognised field answered 200; now refused ("nothing
  here we can change"), because a typo'd key reporting saved is a save the
  person believes happened.
- One rule for what a description IS on both routes: strings only
  (cleanDescription throws on non-strings; POST's String() coercion that
  stored "[object Object]" is gone; null is refused too, since the blessed
  clear is the explicit empty string).
- The harness now drives the DETAIL's absence arm (undescribed project,
  hidden === true), measures both description tokens in the contrast sweep,
  and renders a description at the 200-char cap asserting one-line
  truncation on the row.
- The textContent render of the detail is pinned in server.test.js beside
  the row's esc() pin, so an innerHTML swap goes red.
- `.pj-desc` lost font/line-height to `.panel p` on specificity; both
  selectors now carry the element and the comment tells the truth.
- The cap cuts characters (an emoji survives whole or not at all) and trims
  the cut; describe() normalizes description to '' for legacy records so
  the API reads as '' everywhere, not only the two web renderers.

## Review round 2 (2026-08-14 late evening)

No blockers. Four warnings, all fixed:
- The description validation was the one refusal firing AFTER makeFolder,
  so a type-refused create left an orphan folder no record pointed at
  (the parked-spot rationale covers I/O failures the retry adopts, not
  refusals nobody retries). Hoisted above the mkdir; a regression test
  counts the projects root before and after a refused create.
- cleanName now carries the same words-or-refused rule as
  cleanDescription ({name:{}} stored "[object Object]", and the name is
  what syncAgent writes into every member's boot file). The server
  comment's claimed symmetry is real now instead of documented-only.
- The re-tell gate is self-guarding: blockBody's test asserts the block
  does NOT carry the description, so if it ever joins the block, the
  description-only-saves-do-not-re-tell gate goes red in the same change.
- The harness closes its browser in the tail finally, so a throw reds
  instead of hanging (a prior run sat 2 days 23 hours as "still running").
Nits: the emoji-cap comment is scoped to what was measured (code points,
not graphemes); whitespace-only-clears is stated where the rule lives; the
escaping proof is now RENDERED, not only source-pinned -- the fixture
description carries live markup and the harness asserts it appears as
verbatim text with no element born from it, in row and detail both.

## Review round 3 (2026-08-14, ~10 PM)

No blockers. Both warnings closed with tests that can fail:
- The cleanName guard now has coverage on every writer (object, number,
  array, boolean refused at create and edit; a refused write changes
  nothing; null keeps its older absence sentence, and the comment claims
  only that).
- The re-tell gate is held in BOTH directions against a real board
  fixture: a rename rewrites the member's boot file to the new name, and
  a description-only save leaves the file byte-identical.
Nits: the orphan-folder test gained its positive control (the same shape
without the bad field does reach makeFolder); the detail's absence arm
asserts RENDERED absence (display, rect) rather than the attribute the
author-rule trap can beat; the harness asserts row and detail render the
same token size (the check that reds the cascade regression, and the CSS
comment now claims exactly that); setDescription noted as the deferred
settings-screen write path; the detail's description-vs-path visual
differentiation deferred to the design pass.

## Review round 4 (2026-08-14, ~10:50 PM)

One blocker, in the round-3 test itself: the re-tell byte comparison
measured idempotence, never the gate (blockBody splices back identical
text, so a re-tell on a description-only save changes nothing the file
can show; the reviewer deleted the gate and the test stayed green). The
gate is now held by the TOLD STAMP, which syncAgent moves on every call:
unchanged after a description-only save, moved after a rename. Verified
by planting the gate-deletion mutant, which reds this test by name; a
5ms breath covers the stamp's millisecond granularity. Also: the stale
~/kosmos-demo left by a killed harness run (which blocked every
subsequent run at the reuse guard) is cleared, and the guard's message
now names the cause and the fix; the detail absence arm fails loudly if
the element vanishes; route-level non-string NAME refusals are tested on
both routes; the cap comment says 200 code points with the human
approximation named; fixture names are distinct; the mangled comment
wrap fixed. Known and accepted: rename(id, undefined) now answers
"nothing here we can change" (no non-test caller).

## Review round 5 (2026-08-14, ~11:15 PM)

No blockers. Four warnings, all closed:
- The 5ms clock breath moved to where it protects the assertion that
  catches a deleted gate (before the description-only PUT; the two stamps
  ran 1ms apart under load).
- Over-length descriptions are REFUSED with a sentence, like the name at
  120: silent truncation answered success while cutting the person's
  words. Counted in code points (200 emoji legal, 201 refused); engine,
  route, and the legacy cap tests all follow.
- null means absence for a description, as it already did for name and
  folder in create (it was the one field where null meant malformed);
  clears on edit, empty on create, tested at both layers.
- The detail's description renders in full ink over the grey path (the
  two were byte-identical typography reading as one metadata block; the
  pin asks for a title-plus-statement pair). The row/detail size equality
  check still holds; ink change only.
Nits: the plan's legacy-write claim scoped to what the code does.
Recorded coverage gap, accepted: a change moving row and detail sizes
together stays green (the equality is the check; the callout intent is
prose).
