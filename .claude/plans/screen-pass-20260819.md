# screen-pass — Josh's 2026-08-19 screen-by-screen review

**Branch:** `screen-pass` · **Author:** Angel · **Reviewer:** `joshualeestone`

## Why this branch exists

Josh went through the running app screen by screen on 2026-08-19, screenshotting
each one and marking it up against the design pack, and produced roughly forty
findings across the agents index, the create-agent flow and the agent detail
page. This branch is the build's answer to the subset that is **behaviour, data,
and whether what is on screen is true**.

⚠️ **The lane split matters for reading this diff.** Mona Lisa owns copy and the
wording of layout; Angel owns behaviour, data and truth. Several findings on the
same screen are deliberately half-done here, and that is the split rather than an
oversight. Where a change was held for her ruling it says so at the site.

📌 **Most of it is a restore.** Mona Lisa checked every item against the pack and
found them already drawn, including the box order. Large in lines, small in
decisions.

## What is in it

### The create flow
The app paints its own ground rather than the page surround; the create steps sit
on the page rather than in a card, **left-aligned within the app column** (not
within the window — `margin: 0` put the form outside the centred 1320px column
above 1368px wide); six copy deletions Josh called; the version line moves to the
foot, **after** the removal alert rather than between it and the section it
describes; a **parsed** role is sentence-cased; the project picker is chips again;
one primary button, right-aligned, the same size on both steps; the post-creation
screen keeps its card (`.dbox`, which is what the pack draws — see below).

### One appearance for every control
The page had **six selects and five separate copies of "how a select looks"** in
three visual languages. They share one rule and differ only in width.

⚠️ **`appearance: none` is the load-bearing line.** Measured in both engines:
WebKit renders a declared 20px radius as **5px** and drops the padding; Chromium
honours everything. Kosmos opens the **default** browser (`/usr/bin/open`), which
on a stock Mac is Safari.

⚠️ **`.frow select` was too broad** and caught `#lim-tier`, a control inside the
sentence "Stop them after [n] exchanges an hour": 307px before, 69px after.

### `--field-fill`: the container declares what its fields are filled with
"Fields go white" made every field `--bg-elevated`, which is the *same colour* as
an elevated container. Fixed three times by enumerating containers, and each
round shipped believing it was complete. 🔑 **A rule that has to enumerate its own
blast radius will keep being wrong** — the container now declares `--field-fill`
and fields inherit it.

Also fixed here: `#pj-post` (the project room's post box) had **no CSS rule at
all** — the build carries the pack's `.composer .inp` rule with the class filed
off, so it took the width and left the skin behind.

### The model we wrote down is read back
`create.plannedModelArg(name)` reads the `--model` argument out of the launchd job
`plistFor` wrote. It lives **beside the writer**, and it is the one call site
handed an unvalidated `a.sessionName`, so it validates against `NAME_RE` first.

`/api/status` carries `plannedModelName` **when no live model was read, plus every
stopped agent** — a transcript says what an agent RAN as, only the job says what
it will START on. Gated on `isNamedOurs` with the other name-keyed fields.

`runsOnLine(a)` takes its tense from **`cardStOf(a).pres`, the same derivation the
presence dot draws** — three presence values, three tenses, and `unsure` gets no
tense at all. ⚠️ This function produced **three false tenses in one day** before
that: a present tense about an agent that never started, a future tense about one
running right now, and a present tense about one that had stopped. Every time the
value was right and the lead was the lie.

Every surface names the same model: `card()`, `lrow()` and the detail meta line
all route through `modelLine`, which prefers the job for a stopped agent.

### Honesty
- **The unknown-memory caption is visible again** on the card (`.membadge unk` →
  "Unknown"), the list row (`.pct` → "Unknown", never blank: a blank number cell
  reads as `0%`, which for memory means "loads of room") and `memoryBox`.
  ⚠️ The badge string and the ring's `aria-label` are **deliberately disjoint**;
  when the badge was a prefix of the label, a test asserting it passed with the
  badge deleted.
- **`removedUnreadable`**: "no agents removed" and "we could not ask" were the
  same blank screen on first load. That section is the way back from a removal,
  and the Remove confirmation is light *because* removal is recoverable.

### Dark mode
- `body` paints `--k-bg`, not `--bg`: equal in light, and in dark `--bg` made
  cards render **darker than the page they sit on**.
- `prefers-contrast: more` set `--label-2` on bare `:root` after the dark block —
  a contrast *failure* produced by the contrast setting.
- `#firstrun` pins both token systems (it re-pinned only the `k-` half), and pins
  `--label-2`/`--separator` **in dark only**, so the wizard stops declining the
  person's stated contrast preference in light.
- **`.llm-m` was a porting gap**, not dead code: the install screen's six provider
  discs rendered fully styled at **0×0**.

### Navigation and the detail page
A tab click lands at the top of its section's own state — it forgets the project
you were inside. ⚠️ It does **not** reset scroll. The detail boxes are in Josh's
order (Runs on, Memory, Conversation, Instructions); `.dgrid` is two columns, so
source order is the reading order in pairs. The detail header gets the card's own
badge with the task beside it.

## Deliberately NOT in it

- **The Picture box stays** until the edit modal that absorbs it exists.
- **The Conversation box keeps its title** until Mona Lisa retitles it.
- **The agent-page composer** is a separate branch (`answer-panel`).
- The edit pencils and their modal, the avatar context ring, the ASSIGNED TO
  chips, Fresh Start, and the Runs On provider/account controls are catalogued.
- ⚠️ **Field boundary contrast.** Measured with the alpha composited: 1.77:1
  light, 2.35:1 dark, against WCAG 1.4.11's 3:1. `--border-strong` at `0.5`
  clears both. Ruled by Josh to land as **its own change** with a visible
  before-and-after, not folded in here.

## How it was verified

- `npm test`: **924 tests**, 0 failing, three consecutive clean runs.
- **Rendered in WebKit and Chromium, light and dark.** Dark is not optional: the
  two token systems are equal in light and divergent in dark, and every defect of
  that class on this branch was invisible in light.
- **A standing check**, `docs/browser-checks/render-fields.js`: every select
  renders our control and not the browser's; no field is the same fill as its
  container; no field's relationship to its container flips between schemes; the
  unknown caption does not paint over the presence dot; the list row's unknown
  cell is not blank. It validates its contrast function on six known pairs first,
  prints every denominator, and treats a **missing fixture as a failure**.
- **Mutation-tested**, including the checks themselves. ⚠️ Three guards written on
  this branch could not catch the defect they were written for until mutated: the
  unknown-badge assertion (satisfied by an `aria-label`), the browser check's list
  cell (read `textContent`, counting a hidden span), and the stray-declaration
  scanner (a regex that rejected every custom property containing a digit).
  🔑 **A check's pass means nothing until it has been watched failing on *the*
  defect, not merely on some defect.**
- **A brace-aware scan** in the suite for declarations orphaned outside a
  selector — the branch shipped one, and it cost `#firstrun` its background while
  reading in the diff as a plausible brace move.
