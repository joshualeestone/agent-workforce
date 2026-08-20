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

    KOSMOS_REPO=<worktree> python3 Projects/kosmos-design/jargon.py --engine

- **kind:** guard · **pass:** `== 8` · **before (fixed counter):** 57 · **after:** 8

🛑 **THE NUMBERS IN THE FIRST VERSION OF THIS PLAN WERE BOTH WRONG, and the
counter was wrong with them.** It said 44 → 6 and that six was the pass. Mona
Lisa then found two defects in `jargon.py` itself:

- it read only single- and double-quoted literals, so **every sentence assembled
  from a template literal was invisible** — and `remove.js` composes several
  that way. Its own docstring said it could not see runtime-assembled sentences,
  and the issue's done-condition was set on the number anyway;
- it held a **hardcoded path**, so it could only ever measure `main`. It could
  not have verified this branch before merge. It honours `KOSMOS_REPO` now.

On the fixed counter: `main` is **57**, not 44, and this branch is **8**.

⚠️ **So the sweep is better than "44 to 6" in absolute terms and less complete in
relative ones**, and the honest form of both numbers is the command above rather
than either figure.

### What the remaining eight are

| count | what | why it stays |
|---|---|---|
| 2 | `connect.js:146,147` — `stderr` in an object literal | a FIELD NAME, not copy. It was briefly renamed here and reverted: four call sites read `.stderr`, so renaming it is a behaviour change wearing a copy branch. |
| 4 | `create.js:708,715,722,761` — the README pointer | ruled ("say what to do in the sentence, never name a document") but the words are **not written yet**. Mona Lisa's. |
| 1 | `messages.js:141` | reachable only from a shell, by measurement. Expected, not unfixed. |
| 1 | `remove.js:857` — `${found.session}` | the checker matches the word inside an **identifier**; the sentence itself says "something called X is still running". |

**Eight is the pass and fewer is a failure**, for the same reason six was: four of
these are waiting on words, and the other four are things the checker cannot
distinguish from copy.

## Two defects the patch introduced, found by applying it

0. **A step label that contradicts its sibling in the same list.** The patch
   rewrote `it had no startup job to stop` to `there was nothing running to
   stop`, which drops the referent (the job) and takes the session's. The very
   next step is labelled `stopped it`, so a jobless agent with a live session
   got a list saying both. **That row is reverted here** -- the old wording is
   jargon and the new one is a contradiction, and choosing words that lose
   "startup job" without borrowing the session's is a copy decision. Flagged.
   ⚠️ My own re-aimed test pin had come to rest on that label, so the suite was
   certifying the contradiction: the assertion's message says it checks what was
   true "of the job" while the label it matched said nothing about one.
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
