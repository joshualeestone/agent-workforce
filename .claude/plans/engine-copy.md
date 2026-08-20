# engine-copy -- the engine stops talking to somebody with a terminal

Patch: `~/work/Josh-Brain/Projects/kosmos-engine-copy-PATCH-2026-08-20.md`
(Mona Lisa, keyed on exact current strings rather than line numbers, so it
survives the files moving). Tracked as kosmos#108.

## Why

Sentences the ENGINE produces reach the screen verbatim. Twenty-eight of them
were written in the vocabulary of the thing underneath rather than the thing a
person is looking at: "we could not ask tmux what is running", "no Claude
process in this pane", "we do not know which pane this agent is in". The person
this product promises will never need a terminal is being handed one in prose.

## Scope

41 replacements across eight engine files, plus the test pins that hold them.
No behaviour changes: every edit is a string.

## The verification, and its polarity

    python3 Projects/kosmos-design/jargon.py --engine

- **kind:** guard · **pass:** `== 6` · **before:** 44 · **after:** 6

⚠️ **SIX IS THE PASS, AND FEWER IS A FAILURE**, which is the opposite of how a
count usually reads. Five of the six are false positives the checker cannot
distinguish (`stderr` twice in a code fragment, `directory` in two developer
errors and one internal message), and the sixth is `messages.js:141`, which is
correct as it stands:

> we cannot tell which agent is sending this: `kosmos msg` takes the sender from
> TMUX_PANE, and it is not set here. Run it inside the session that agent runs in.

**That one names a variable on purpose.** Measured: `web/index.html` contains
zero references to `/api/msg`, the page does not fetch `/api/messages` either,
and the only producers of `from_pane` are `kosmos msg` and `kosmos post` in
`install/kosmos`. So a person using Kosmos cannot reach that sentence at all;
its only reader is whoever typed the command into a shell, and for that reader
naming the variable is the one useful thing it can say.

⚠️ **The checker cannot see reachability**, so it flags that line forever. It is
recorded as an EXPECTED hit rather than an unfixed one, so nobody fixes correct
copy to make a number go down.

## Two defects the patch introduced, found by applying it

1. **A sentence starting lower case, on the removal dialog.** The patch splits
   `It has no startup job, so Kosmos cannot start it again for you -- you would
   start it...` into two sentences, and the second half kept its lower-case
   opening: `...for you. you would start it...`. Capitalised. This is the screen
   the patch itself calls highest-stakes.
2. **Two sibling refusals stopped reading alike.** `paneRoster` now says "we
   could not see what is running on this computer" and `snapshot` says "we could
   not check what it is doing on this computer" -- and `snapshot`'s "it" has no
   referent when the thing being read is the whole machine. The property both
   hold (an unreadable answer is not an empty fleet) is unchanged and asserted
   separately now. Flagged to Mona Lisa rather than rewritten here: it is her
   copy and the fix is a wording choice.

## Test pins

Thirteen tests pinned the old sentences and had to move with them. Two kinds:

- **whole-string pins** (`projects.test.js`'s singular/plural table,
  `remove.test.js`): replaced by the same find/replace as the source.
- **fragment pins** (`/sits in its composer/`, `/do not know which pane/`,
  `/anonymous/`, `/could not read/`, `/will not speak/`, `/cannot tie/`): each
  re-aimed at a phrase of the NEW sentence that still asserts the same property.
  These are the ones worth reviewing: a fragment can be re-aimed at a phrase
  that no longer carries the property it was written for.

`server.test.js`'s create-record test pinned `/startup job/` against a step
label that is now "set it up to keep running"; same property, new phrase.

## What this branch does NOT do

- No line numbers. Nothing carries block provenance and nothing computes it.
- No `.pj-screen` scrollbar, no `.dspan`, no question-width work: that is a
  separate pass and it gates PR two of the answer panel (kosmos#111, #113).
