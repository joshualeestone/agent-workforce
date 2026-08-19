# screen-pass — Josh's 2026-08-19 screen-by-screen review

**Branch:** `screen-pass` · **Author:** Angel · **Reviewer:** `joshualeestone`

## Why this branch exists

Josh went through the running app screen by screen on 2026-08-19, screenshotting
each one and marking it up against the design pack, and produced roughly forty
findings across the agents index, the create-agent flow and the agent detail
page. This branch is the build's answer to the subset that is **behaviour, data,
and whether what is on screen is true**.

⚠️ **The lane split matters for reading this diff.** Mona Lisa owns copy and
layout wording (the Instructions lede, the Talk-to title, the Fresh start button
language). Angel owns behaviour, data and truth. Several findings on the same
screen are therefore deliberately half-done here, and that is the split rather
than an oversight. Where a change was held for her ruling it says so at the site.

📌 **Almost none of this is new design.** Mona Lisa checked every item against
the pack and found them all already drawn, including the box order. This branch
is mostly a **restore**, which is why it is large in lines and small in
decisions.

## What is in it

### 1. The create flow (commits 1–8, landed before this file was written)

The app paints its own ground rather than the page surround; the create steps sit
on the page rather than in a card; six copy deletions Josh called; the version
line moves to the foot and drops its claim; the role keeps its own capitals in
the step-two heading; a **parsed** role is sentence-cased (not title-cased,
because a parsed role is the agent's own prose and title-casing it invents
emphasis); the project picker is chips again and says so at count one; one
primary button, right-aligned, the same size on both steps.

### 2. One appearance for every select, and the fields go white (commit 9)

The page had **six selects and five separate copies of "how a select looks"**, in
three visual languages, plus one control with nothing at all. They now share one
rule and differ only in width.

⚠️ **`appearance: none` is the load-bearing line.** Measured in both engines:
WebKit renders a declared 20px radius as **5px**, does not apply the padding, and
draws its own arrow, while honouring background and border; Chromium honours all
of it. Kosmos opens the **default** browser (`/usr/bin/open`, `install/setup.sh`),
which on a stock Mac is Safari. The arrow is **two gradients rather than an SVG
data URI** so it takes `var(--label-2)` directly and follows dark mode,
`prefers-contrast` and the future `data-theme` toggle without restatement.

### 3. The model we wrote down is read back (commits 10–12)

`create.plannedModelArg(name)` reads the `--model` argument out of the launchd
job `plistFor` wrote. It lives **beside the writer** because the argument order
is the supervisor's contract.

`/api/status` carries `plannedModelName`, **only when no live model was read**,
**gated on `isNamedOurs`** with the other three name-keyed fields.

`runsOnLine(a)` gives three states: `Right now:` when running, `Will start on`
when created but never run, and a bare `Unknown Model` with **no lead** when
neither is known — because nothing is running in that case either, so a present
tense was as false there as on a planned model.

The compact surfaces (card, list row, detail meta) name a planned model
**plainly**: a tense is asserted by words, and none of those three say any.

### 4. Navigation and the detail page (commits 13–15)

A tab click lands at the top of its section's own state — it forgets the
project you were inside. ⚠️ It does NOT reset scroll; nothing in the page
scrolls on tab change. The earlier wording here was broader than what shipped. `showTab`'s restore of
`PJ_CURRENT` is correct for its programmatic callers, so the reset lives on the
**click**, the only place that can know a person did it.

The detail boxes are in Josh's order (Runs on, Memory, Conversation,
Instructions). `.dgrid` is two columns, so **source order is not reading order** —
the requested sequence is the source order read in pairs, which is what the pack
renders.

The detail header gets **the card's own badge**, off `cardStOf` / `STATE_COPY` /
`GLYPH` rather than a second copy, with the task beside it.

## Deliberately NOT in it

- **The Picture box stays** until the edit modal that absorbs it exists. Deleting
  it now removes the only way to set an avatar with no replacement in place.
- **The Conversation box keeps its title** until Mona Lisa retitles it.
- **The agent-page composer** is a separate branch (`answer-panel`).
- The edit pencils and their modal, the avatar context ring, the ASSIGNED TO
  chips, the Fresh Start section, and the Runs On provider/account controls are
  catalogued and queued, not built here.

## How it was verified

- `npm test`: **920 tests**, 0 failing.
- **Rendered in WebKit and Chromium**, not only Chromium, because the select
  defect is invisible in Chromium and `docs/browser-checks/` is Chromium by
  default.
- **Mutation-tested**: the plist index, the null-means-unknown rule, the
  `isNamedOurs` gate, the live-model precedence, the tab reset's scope, and the
  planned-model fallback were each broken on purpose and confirmed to fail a
  test. ⚠️ One mutation **survived** the first time (the precedence), which is
  why `runsOnLine` now carries a card holding a live and a planned model that
  disagree.
- Reading order measured by **rendered geometry** (sorted by top, then left), not
  by DOM sequence.
- `pageerror` listened for on every render, because a null at load kills every
  listener registered after it and leaves a page that still looks correct.
