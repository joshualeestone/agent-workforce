# project-page: the project page, matched to the pack and extended

Date: 2026-08-19 ~9:40 PM. Branch `project-page`. Source: Josh's marked
screenshot (Discord, 2026-08-19 9:16 PM) plus four follow-up messages,
built against `kosmos-app-style.FROZEN-2026-08-19.html`, sha
27a18327525f13524d4fd6b1b27c34edb62d7fbefd86a4a2cc31d2e2561c5b84,
which matches CURRENT-FREEZE as of this writing.

## ⚠️ The screenshot is three fixes behind main, and the plan says so

The 0.2.0 bump was #85. #86, #87 and #88 landed after it and were
never released, so no installed board had run them when the screenshot
was taken. They ship in 0.2.1 tonight. Three of Josh's marks are
therefore ALREADY DONE and are not in this branch's scope:

- "Add Search" on the Conversation header -> #88.
- delete "Kosmos told each of them where this folder is" -> #87.
- delete "Remove from project" from the member rows -> #87, which moved
  it to Project settings under Josh's own 2026-08-18 ruling.

Planning from the screenshot without this check would have rebuilt
shipped work. Waiting on a re-screenshot at 0.2.1 before treating any
remaining VISUAL mark as real.

## Two piles, kept separate on purpose

**Restore-to-pack** (the pack draws it, the app does not match; no
design decision needed):

- Header larger; project purpose line under it.
- Delete the "Putting an agent here tells it where this project's
  folder is" hint (web/index.html:2967).
- Sponsor picker and "Put it on this project" styled to the pack.
- Conversation box styled to the pack and made tall enough to fill the
  column.
- Composer: bigger field, `+` for attachments, large Post button INSIDE
  the box, and the helper line under it.
- Member avatars render rather than sitting as empty rings. NOTE: read
  off two circles in the markup; Josh has not confirmed this reading
  and it may instead be about the Paused label.

**Net new, NOT in the pack** (needs Mona Lisa or a ruling before
build):

- **Project Documents.** The pack's project page has three columns,
  members / conversation / tasks, and no documents section. Josh's
  spec, from four messages: files come from the conversation, both the
  ones he drops in and the ones agents produce to share; catalogued;
  a list, click to open, and opening LAUNCHES the file; no add control
  in the section itself because adding happens through the composer's
  `+`; last ~10 with a view-all to a screen of every file for the
  project.
- **Task status** on the task cards.

## ⚠️ The dependency that the screenshot could not carry

Josh X'd out the whole "Talk to one of them" box (web/index.html:3015).
Deleting the surface is right and matches the pack, which draws an
agent's question as a MESSAGE in the room carrying a "Needs you" pill
(pack line 3175) rather than as a separate 1:1 panel.

**But that box is not only a 1:1 chat.** It also holds the only place a
person can SEE and ANSWER an agent's blocking terminal question: the
`pj-question` region, the monospaced `pj-screen` pane that preserves
the columns a Claude prompt draws its options in, and the
`pj-answer-how` line teaching that a number typed into the box is how
you answer.

The room cannot inherit that for free. The room renders POSTED
messages, and a blocking question is a terminal STATE that no agent
ever posted. So the order is forced:

1. the room can carry an agent's question and its answer, THEN
2. "Talk to one of them" is deleted.

Reversing them removes the only answering path in the product. This is
the same terminal-versus-transcript boundary that came up twice
tonight, arriving a third time as a build dependency.

## Deliberately not in this slice

The six nits deferred on #89. The `answer-panel` branch (14 commits,
last touched 2026-08-19 14:47 at challenge-loop iteration 10, no PR),
which touches the same answering surface and must be reconciled with
this plan before either lands.

## Known red in `render-projects.js`, PRE-EXISTING, deliberately not fixed here

`docs/browser-checks/render-projects.js` reports `✖ 4 contrast failures`. All
four are the same two selectors in both schemes:

    #panel-projects .pj-member .pj-told
    #panel-projects .pj-member .drop

They are not contrast failures. They are the check's own honest refusal to
pass on a selector it never found ("A MISS IS RECORDED, not skipped. Skipping
is how four selectors went unmeasured under a printed pass"). Both elements
LEFT the one-project view in #87, which moved removal to Project settings and
stopped the members column saying the folder was told. The check was never
updated, so it has been red since #87 merged.

**MEASURED, not inferred (2026-08-19 21:59).** Splinter's challenge was that a
branch cannot tell "pre-existing red" from "red I introduced" by looking at
itself, and he was right. So the control was run: `origin/main` at 973866b,
clean worktree, main's OWN copy of the checker (sha c4088cce4401), against a
second sandboxed board on port 4742.

    main:        ✖ 4 contrast failures — .pj-told and .drop, light and dark
    this branch: ✖ 4 contrast failures — the same two, the same schemes

Identical. This branch introduces no new failure, and every other step is green
on both. The weaker static evidence still holds and is kept because it is cheap
to re-run: `git diff origin/main -- web/index.html` touches neither selector,
and both strings are still in the file, just rendered on a different screen.

**Not repaired here, on purpose.** The honest repair relocates the coverage to
`render-pjsettings.js`, which today has no contrast pass at all (87 lines), so
it is new checking code rather than a moved line. Writing that inside an
unrelated branch at speed is the shape this codebase already has a lesson
about: a fix for a coverage problem that quietly makes the suite greener while
covering less. It gets its own chunk.

**Do not "fix" it by deleting the two selectors.** That turns a visible red
into an invisible gap, which is strictly worse.

⚠️ One more will join it: `#pj-one-view .flabel` in the same list resolves
today only because "Talk to one of them" still wears that class. When that box
is deleted the selector goes unmeasurable too, and the same repair covers both.

## ⚠️ Read this next to the 926/926: the browser check is RED and is being carried

Stated plainly because the two sentences sit together and the second is easy to
read as green. On every commit of this branch:

- `yarn test` RUNS and PASSES. 926/926.
- `docs/browser-checks/render-projects.js` RUNS and FAILS, with the 4
  pre-existing contrast failures described above.

So this branch is proceeding past a known red, deliberately, with the red
diagnosed and attributed to #87 rather than to this work. It is not "both
checks pass". Anyone reading 926/926 and assuming the screens are green is
reading it wrong.

Every other check in that run is green, including the members-wording step that
this branch broke and repaired, so the red is exactly four measurements wide and
its boundary is known.

## 🛑 `.cstep` is a NAME COLLISION — do not port the pack's rules for it

Recorded against the CLASS rather than a file, because a warning that names a
file protects that file and not the defect.

- **Build** (web/index.html:2723, 2791): `<div class="cstep" id="cstep-role">`
  wrapping an `<h2>`. A section CONTAINER in the create panel. It has no rule
  and renders as a plain div, which is what it wants. Nothing is wrong today.
- **Pack**: `.cstep` is an inline-flex CHIP, with `.cstep b` as a 22px circle,
  plus `:hover` and a `.csteps.cprev` dashed variant. Seven rules.

Same word, two different objects. Porting the pack's `.cstep` turns the create
panel's section wrappers into inline-flex chips with circles in them. Found by
Mona Lisa. This is the second instance tonight of a class name meaning
different things in the two files; the first was `.panel`, where the pack's
wears `--page-*` mock-chrome tokens and the build's is a real surface.

## ⚠️ Project documents has TWO possible sources and they are not the same set

Found by Mona Lisa re-verifying her spec against 0.2.3, and it needs Josh
rather than either of us.

    built    GET /api/project/:id/documents reads the PROJECT FOLDER
    specced  engine/projects.js:9 -- "everything this module writes lives in
             app data, NEVER in the project folder (§7b)"

So a file attached through the composer's `+` would land in app data and would
NOT appear in the documents list. The attach chunk and the documents list,
which we have both been treating as one feature, are today two lists of two
different things.

**Neither of us was careless. Josh said both, sixteen seconds apart:**

    21:23  "all files, files i dropped in and agent files"
    21:23  "it would be files from the conversation"

My route comment cites the first, her spec cites the second.

- **folder only** misses everything attached in chat, which is exactly what the
  `+` will create.
- **conversation only** misses everything an agent WRITES while working, which
  is most of what a project produces, and is his "agent files".
- **both, merged** is what the first sentence asks for, and the only option
  that neither breaks §7b nor hides a category the person watched arrive.

Recommendation: merge. Recorded rather than built, because the disagreement is
between two of his sentences, not between two of our readings.

⚠️ **A merged list changes a copy ruling.** Mona Lisa ruled that "These are
Kosmos's copies. Your originals have not changed" sits once under the list.
That is true of a conversation-only list, where every row is a copy, and FALSE
on a merged one: a folder file IS the original, and editing it edits the real
thing. On a merged list the line has to be per row and only on the copies.

**Nothing shipped tonight is wrong under either answer.** The folder list is
true about the folder and says so; it is only incomplete under the merged
answer, and the `+` that would expose the gap is deliberately not built.
