# "Nothing yet" is not "we could not look"

## The state that started it

Josh made an agent, and its card said **Unknown** under a dashed ring whose
screen-reader label read *"Memory could not be read."* That is a **claim**:
something exists and we failed at it. The agent was thirty seconds old and had
nothing to read. He screenshotted a working agent and asked how to stop it.

🔑 **Mona Lisa's rule, which decides every case below:** "not yet" is a claim
about where an agent is in its life; "unknown" is an admission about what we can
see. **A wrong claim is worse than a vague admission, so any case that cannot be
told apart without a threshold resolves to the admission.**

⚠️ **The threshold specifically refused is the agent's age.** It was the obvious
separator and it would have looked principled. It is a number somebody chose.

## What the engine already knew, and lost twice

`readContext` never had one null bucket. It had five, each carrying a `because`,
and `context` is serialised whole — so the split needed no new state. But two of
the five straddled it, and both were falsy-collapses:

1. **`tailBytes` returns `''` for an empty file and `null` for a failed read**,
   and the caller tested `if (!text)`. An empty transcript is exactly the state
   Claude Code leaves one in the instant it opens the file, so **the newest
   agent on the machine was the one reported as unreadable.**
2. **`transcriptFor` returns a bare `null`** both when no session was ever
   registered (nothing has existed to read) and when a registry entry's file is
   gone (it was read once and is not there now).

## The mapping

| | |
|---|---|
| **Not yet read** | no registry entry · empty transcript · no usage rows yet |
| **Unknown** | real read failure · usage present but summing to zero · identity refused · registry entry whose file is gone |

A **seventh** case surfaced while writing it: a measured agent whose model has no
known ceiling. We read the memory and cannot express it as a percentage, so the
card shows the unknown badge for an agent we measured exactly. `notYet` is false;
whether "Unknown" is the right word there belongs with #149/#150 and is recorded
in the code rather than fixed here.

## Five surfaces, one derivation

The fact has **five** renderers: the card badge, the ring's `aria-label`, the
list row, the Memory box and the detail header. This file's own comments record
them drifting apart **twice**, each time because somebody updated the surfaces
they could see. So `memUnknown(ctx)` is the single derivation and all five call
it, the way `memBand` and `pctOf` already are.

The Memory box's sentence splits too, and it is the one that mattered most:
*"We could not read Dan's memory"* is the longest, most confident statement of
the fact anywhere on the screen.

⚠️ **`word` and `aria` are kept disjoint as strings** in both branches, so an
assertion about one cannot be satisfied by the other. That property held by luck
of wording before; the new pair shares "not", "read" and "yet", so it is pinned.

## Evidence

- `yarn test`: **1027 pass, 0 fail** (65 → 71 in `status.test.js`, plus six new
  in `web.memory-words.test.js`).
- **Five deliberate breaks on `status.js`**, each reverted after the named test
  was watched to fail: re-collapsing `if (!text)`, calling every missing
  transcript "not yet", calling a never-registered agent unreadable, calling
  zero usage "not yet", and a positive control that removes every successful
  reading.
- **Four on `web/index.html`**: flipping the default, restoring the literal on
  the card, letting the aria label contain the badge word, swapping the words.
- **`docs/browser-checks/render-memory-words.js`, run in a real browser**, because nothing
  else here can see layout: "Not yet read" is 78px on a 275px card, 98px clear
  on each side, 11px above the name and 4px below the presence dot — the same
  gaps "Unknown" has. Page overflow 0. Proven able to fail by widening the word
  (caught: hangs outside the card) and by deleting the badge (caught: drew 0).

## What testing changed

- **A "no Unknown anywhere" check that a correct implementation could not
  satisfy.** It failed on `memUnknown`'s own definition, which is the one place
  that word belongs. Re-aimed at the page minus the derivation, with a control
  that fails if the exclusion starts hiding too much.
- **A call-site count broken by a comment.** Filtering comment lines does not
  work here: block comments have unmarked continuation lines. The count is over
  the whole file and the rule is that the name does not appear in prose — a
  false failure instead of a false pass.
- **Five comments were re-aimed**, because they quoted "Unknown" as the word the
  card shows, and that stopped being true.

## What the blind pass found, and both of its blockers were in this change

1. **The Memory box sentence was ungrammatical.** The box composes
   `"<name>'s " + lead`, and the new branch's lead read
   **"Dan's has not written anything to read yet."** The unknown lead had been
   written to fit that possessive and the new one had not — and **nothing had
   ever composed it**: six tests exercised `word` and `aria` and never `lead`.
   The test now asserts the sentence, built the way the page builds it.

2. **"No usage rows" was decided from a 256KB window, not a transcript.**
   `tailBytes` reads the last 256KB of a file that reaches 8MB, so one
   oversized tool result at the end pushes every usage row out of view — and a
   heavily used agent would have shown **Not yet read** with "that is normal for
   an agent this new. There is nothing wrong with it" while sitting at 95%.
   **That is this change's own bug with the sign flipped.** It is separable
   without a threshold, because the read already knows whether it covered the
   file, so `tailBytes` now returns that fact rather than the caller guessing.

Also from that pass, each fixed:

- **The note claimed an age the engine refused to know.** "Normal for an agent
  this new" asserts both an age and a diagnosis on a signal that supports
  neither. It now attributes normality to the class, not to this agent.
- **An empty registry list has five causes, not one.** A corrupt entry, an entry
  with no session id, a refused name and a name collision were all reported as
  "it has not started a session yet" — a claim about the agent made out of a
  failure of ours.
- **The list row announced "Not yet read memory"**, because the screen-reader
  suffix appended a noun to whichever word arrived.
- **Two comments still quoted "Memory could not be read."** as the sentence the
  ring carries, one of them the entire justification for hiding the badge from
  screen readers.
- **The hardcoded check lived at `/Users/agent1/…`**, so it would have printed
  "SKIPPED" on every other machine including Josh's second Mac Mini. It now
  follows the fifteen existing browser checks: `require('playwright')` with
  `NODE_PATH`, in `docs/browser-checks/`, and out of `package.json` — that
  directory's README says plainly these are not test-suite lanes.
- **The check could not see an invisible caption.** It measured geometry only,
  which a caption at `opacity: 0` satisfies perfectly. And its "visible" test
  had no size component, so the **detail header measured 0x0 while reporting
  visible** — every assertion about that surface passed on something that was
  not on screen.

🔑 **And once the check could see that surface, it found a real defect that
predates this change:** the detail header's caption hangs **15px below its
header** with nothing reserving space for it. The card's rule is scoped to
`.agauge`; `.dav-wrap` never got an equivalent. Live for "Unknown" too, and no
test could have caught it, because the suite reads text.

⚠️ **I reverted my own uncommitted work twice with `git checkout` while proving
mutations fire.** Both times the fix and the mutation went together and the
"restored" run silently measured a tree without the fix. Committing before every
perturbation is the only reason the third round was trustworthy.

## Not in this change

- The `Unknown` shown for a measured agent with an unknown model ceiling.
- Anything about the model pill (#149/#150).
