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

- **kind:** guard · **pass:** `== 5` · **main (same tool):** 62 · **this branch:** 5

⚠️ **This number has moved three times and every move was the TOOL, not the
branch.** 8 with the counter as it read this afternoon, 11 once the backslash
blindness was lifted, then **5** once Mona Lisa found a third defect: the pattern
required 15+ characters *inside* the quotes, so the regex **paired the closing
quote of a short literal with the opening quote of the next one** and swallowed
the real sentence between them. `server.js:707` came back as
`', commitments: [], reportedAt: null, because: '`. That was manufacturing false
positives out of junk spans *and* hiding real ones, in every file, for as long as
the tool has existed.

> 🔑 **The count went DOWN when the checker got stricter.** Any story that treats
> a falling number as progress would have read that backwards.

🛑 **THE NUMBERS IN THE FIRST VERSION OF THIS PLAN WERE BOTH WRONG, and the
counter was wrong with them.** It said 44 → 6 and that six was the pass. Mona
Lisa then found two defects in `jargon.py` itself:

- it read only single- and double-quoted literals, so **every sentence assembled
  from a template literal was invisible**, and `remove.js` composes several
  that way. Its own docstring said it could not see runtime-assembled sentences,
  and the issue's done-condition was set on the number anyway;
- it held a **hardcoded path**, so it could only ever measure `main`. It could
  not have verified this branch before merge. It honours `KOSMOS_REPO` now.

On the counter as it read this afternoon: `main` was **57**, not 44, and this
branch **8**. Both of those figures are superseded by the block above; they are
kept because the SHAPE of the correction is the durable part and the numbers are
not.

⚠️ **So the sweep is better than "44 to 6" in absolute terms and less complete in
relative ones**, and the honest form of both numbers is the command above rather
than either figure.

### What the remaining five are

| count | what | why it stays |
|---|---|---|
| 3 | `connect.js:735,799,1095` | `${x.stdout}\n${x.stderr}` interpolations. **Identifiers, not copy.** Renaming the field is a behaviour change wearing a copy branch: four call sites read `.stderr`, which is why the rename was tried here and reverted. |
| 1 | `messages.js:141` | reachable **only from a shell**, by measurement: the page never fetches `/api/msg` or `/api/messages`, and the only producers of `from_pane` are `kosmos msg` and `kosmos post`. Expected, not unfixed. ⚠️ Her ruling §5 and her patch disagree about whether this names `TMUX_PANE`; flagged to her, tree currently names it. |
| 1 | `remove.js:857` | `${found.session}` is an **identifier**. The reader sees "something called casey is still running"; the word is not on the screen. |

**Five is the pass and fewer is a failure**: four of these are things the checker
cannot distinguish from copy, and the fifth is correct copy for a reader who is
not in the product at all.


### 🛑 The checker has two blind spots, both measured, neither one closed here

**Eight is a floor over a NARROWER INPUT than this plan used to claim.**

1. **`jargon.py`'s literal patterns exclude the backslash** (`'([^'\\\\\\n]{15,})'`),
   so **any sentence containing an escape is invisible to it** -- and a curly
   apostrophe is written `\\u2019`. Measured by lifting the exclusion: **seven
   more hits appear**, four of them user-facing (`messages.js:319`, `:538`,
   `:687`, `status.js:1670`). Those four are fixed on this branch, so the count
   does not move, but they were fixed **by reading, not by the checker**.
2. **`--engine` globs `engine/*.js` only**, and `server.js` authors screen
   sentences too. `server.js:707` and `:726` still carry
   *"we cannot tie this pane to an agent by name"*, which the board renders on
   every poll, one file away from the engine sentence this branch rewrote.

📌 **Both are Mona Lisa's tool and her copy.** Reported rather than changed here:
widening either one changes what `== 8` means, and a verification whose polarity
moves under you is worse than one with a stated limit.

### 🛑 The second verification is RETIRED, and the reason is the finding

I built a guard that read Mona Lisa's **PATCH** file (07:14) and required every
ruled replacement to be present in the tree. It was green at `== 5`.

⚠️ **It drove me to reintroduce a defect she had already ruled against by name.**
Her **RULING** doc (18:22) supersedes the patch wherever they overlap, and on
`status.js` it says so explicitly:

| | |
|---|---|
| was | `the pane mentions a usage limit` |
| her patch | `it says it has hit a usage limit` |
| **her ruling** | **`its screen mentions a usage limit`** |

> 🔑 *"The jargon was `pane`. `mentions` was correct and I should not have touched
> it. The markers are substring matches over the last 25 lines, so a 429 in a log
> matches. 'It says it has hit' attributes a statement to the agent and asserts
> the limit is real."*

**I had flagged that exact over-attribution in my own first pass**, and then a
green check told me the tree disagreed with the authority, so I changed it back
toward the withdrawn wording. Reverted.

📌 **A guard keyed on a superseded artifact is worse than no guard**, because it
carries the authority of a passing check while pointing at the wrong document.
The lesson is not "check less", it is `[[build-from-current-freeze]]`: **a guard
must name which artifact is the SOURCE, and that claim goes stale silently.** The
patch is a view; the ruling is the source, and there was no operation anywhere
that would have told me the view had been superseded.

The idea itself was sound and it did find three real half-applications. What it
lacked was a statement of what it was measuring conformance TO. It is not
re-pointed at the ruling doc because that doc's tables are prose in three
different shapes, and a mechanical check over them would be a guess wearing a
number.

### Where the two documents conflicted, and how it resolved

Three rows had a **patch** ruling and a later **ruling-doc** ruling that
disagreed. I applied neither and asked, having been burned once already choosing
between them. **All three resolved the same way: the patch was right and the
ruling doc was wrong**, so the tree stands as it is.

| site | resolution |
|---|---|
| `messages.js` lookup fallback | **mine stands.** `:155` composes `'we could not tell which agent that was (' + who.because + ')'`, so the ruling's sentence restated its own wrapper and flipped person. `nothing came back to explain why` is also measurably precise: it is the last fallback after `stderr` and `e.message`, so it fires exactly when nothing came back. |
| `messages.js:141` | **keep `TMUX_PANE`.** The patch had measured that the only reader ran `kosmos msg` in a shell, and the terminology sheet scopes the vocabulary rule to in-app copy. The ruling applied the rule without the audience check the patch had already done. |
| `connect.js:146,147`, `instructions.js:498`, `machine.js:550,624` | **withdrawn, do not touch.** `stderr` there is a field name with six readers across three modules, so renaming it is a refactor wearing a copy branch. The other two are developer errors that never reach a screen. |

🔑 **Her diagnosis of the common cause is worth more than the four fixes**, and it
generalises past copy:

> A list generated from a tool's output **presents itself as complete**, so she
> wrote a ruling for every row instead of asking which rows she had already
> examined and deliberately left alone. **Coverage of the checker's output is not
> coverage of the question**, and it let the instrument set the agenda.

📌 That is the same shape as the retired guard above, one level up: the guard
measured conformance to an artifact without stating that it was the artifact,
and the section titled "the rest of the 20" measured coverage of a tool's
output without stating that it was a tool's output.

## The second blind pass, run against the post-ruling tree

⚠️ **The first pass reviewed a version that no longer existed.** Mona Lisa's
rulings moved five sites afterwards, so the tree that shipped had not been
reviewed -- a different tree had. The second pass found **three blockers, all of
them inside the new copy**, which is the same shape the answer-panel loop kept
producing: the newest words are the least examined ones.

1. **`chat.js:669` made a claim about ARRIVAL on a path that must claim the
   opposite.** The `COULD_NOT` / `UNCONFIRMED` split is what makes "re-sending is
   safe" true, and `refusalReason`'s own preserved comment says the caller's
   clause is what tells the reader nothing was typed. Its three siblings all
   still carried it; only this one had dropped it.
2. **`projects.js` + `you.js` denied the existence of a thing the roster had just
   shown them.** The gate passes only a TIED name, so two worlds fall through it
   and the new sentence was false on the one the gate exists for. Split into two
   arms in `addressable`'s existing words.
   🛑 **The pin was green because the sentence was wrong.** `you.test.js`'s
   fixture is an untied `stranger` and the assertion read *"could not find an
   agent with exactly this name"*. It failed the moment the split landed.
3. **`remove.js:701` made a present-tense claim about a state the code had
   destroyed two steps earlier**, and composed onto `didToJob` as *"we stopped
   casey from starting again, but ... It is set to start on its own."*

### And a gap the fix fell into, which is the more useful half

`GROUP_BECAUSE` maps each singular verdict to its plural, and its source pin runs
**map → source**: it catches a row edited without its author site and cannot see
the opposite. The new sentence from finding 2 had no row, so **every group line
carrying it would have degraded to the reasonless form with the suite green.**
The pin now runs both directions and carries a control that the scan found
sentences at all. Proven by deleting the row: it fails naming the sentence.

📌 **Same family as `[[a-new-sibling-does-not-inherit-the-guard]]`.** A check
written in one direction is not a check.

### The composition matrix, checked, including the cell that does not exist

`didToJob` has two forms and four partial returns quote it, so I rendered all
eight compositions and read them as a person would rather than reading the
source and reasoning about them.

⚠️ **One of the eight looked like a real defect and is a state the product
cannot be in.** `remove.js:795` reads `${didToJob} could not stop it right now`,
with the subject elided. Against the job form that is *"we stopped Casey from
starting again, but could not stop it right now"* and the elided subject is
**we**. Against the jobless form it would be *"Casey was not set to start on its
own, and could not stop it right now"*, where the elided subject reads as
**Casey**, which is a dangling-subject defect.

✅ **It is unreachable.** `:795` sits inside the `if (job)` branch that opens at
`:757` and closes at `:800`, so it only ever composes with the job form. I
checked the structure before changing anything, and the change I was about to
make would have been a fix aimed at a fixture the producer refuses to produce.

📌 **That is this branch's own recurring class, arriving in my analysis rather
than in the code**, and it is the reason the check was worth doing anyway: the
other seven cells all read correctly, which is a measurement rather than an
assumption.

### 🛑 The group frame: a frame may not name an operation it cannot know

Applying the designer's frame fix and then RENDERING all nine plural pairs
through it (rather than reading the rule) found that eight of the nine were
defective, and one was not a wording problem at all.

| # | what the frame did to it |
|---|---|
| 1 | clean |
| 2, 6, 9 | said `instructions` twice, frame and tail |
| 3, 4, 5 | said the outcome twice |
| 7 | 🛑 both, **and a REMOVE reason under an ADD frame** |
| 8 | both |

**Row 7 is `projects.js:1701`, the untell path.** Its own comment says *"Taking
our block back out can push a file under the editor's minimum"*, and it returns
`TOLD.COULD_NOT`, so the screen said *"This folder was not added to their
instructions: taking this out would leave their instructions almost empty."*

🔑 **The old frame was vaguer and therefore could not contradict.** Making a
frame more specific is what turned a shared reason set into a false sentence.

⚠️ **And the singular had the same contradiction, predating all of this.** I had
called the singular fine, and it was: **for repetition, which is what I
checked.** *A check aimed at one defect is blind to the other one in the same
sentence.*

Ruled: both frames state the STATE rather than the operation, because `updated`
is true in both directions.

| | |
|---|---|
| plural | `Their instructions were not updated for this folder: ` |
| singular | `Its instructions were not updated for this folder: ` |

**Staged deliberately.** The plural VALUES touch nothing else, so all nine are
trimmed here. The singular strings are the map's KEYS and are authored at engine
call sites, so only the singular FRAME changes: that removes the contradiction
and leaves a redundant tail, which is **weight rather than a lie**. Trimming the
keys is a follow-up and does not ride this PR.

📌 **Left for that follow-up, measured here so it is not re-derived:** singular
row 1 reads *"Its instructions were not updated for this folder: this agent has
no folder..."*, shifting from pronoun to noun phrase inside one sentence; rows
6 to 9 still repeat `instructions`; and `web/index.html`'s own fallback
(`'we could not write to its instructions'`) is a page literal rather than an
engine key, so it is cheaper to trim than the rest.

### The guard that came with it, and what it does NOT hold

`server.test.js` now composes **every** pair through the frame, reading the
singular keys out of `projects.js`'s map source and asking `groupBecause` for
each value, so it cannot be a copy of the thing it checks. Three properties:
the line says `instructions` exactly once, no value re-states the outcome, and
no value names an operation.

⚠️ **The third assertion was aimed at the whole LINE first, where it could never
fail** -- the `startsWith` above it already pins the frame verbatim, so a frame
naming ADD is caught before it runs. Measured by putting the old frame back: the
`startsWith` fired and mine did not. Re-aimed at the VALUE, where it holds
something nothing else does. All three proven by breaking them one at a time.

### The advice that named an action the person may not be able to reach

The four `create.js` pointers first said **"Remove it and make it again."** The
designer had verified `remove.js` would remove all four states, which is true and
is one layer below the question.

| | |
|---|---|
| `status.js:1644` | `snapshot()` maps over `listPanes()` |
| `server.js:95` | `/api/status` serves `snapshot()` |
| nothing | supplements it from disk |

**So the board is the live panes**, an agent with no session has no card, and the
Remove control lives on the card. `?agent=<name>` does not rescue it either:
`openDetail` opens with `LAST.find(...)` and returns when the name is absent.

🔑 **And the shape is sharper than "unreachable", which is what changed the
copy.** None of the four conditions guarantees the agent is NOT running, so
removal is **conditionally** reachable and the sentence cannot know which case it
is in. A sentence that instructs removal is right sometimes and impossible the
rest of the time, **which is worse than either, because the person cannot tell
which one they got.**

Ruled: lead with the action that is always available (they are mid-create, so
picking another name always works) and offer removal as a conditional the reader
can evaluate by looking. All four now end:

> **Pick another name. If you can see it under Agents, you can remove it there
> instead.**

⚠️ **Rejected: naming the folder path.** For `:715` and `:761` it is actively
wrong, because deleting a folder does not unload a launchd job. It would send
somebody to do a thing that leaves the blocker in place.

📌 **The product gap is real and is kosmos#127**: a folder-or-job leftover with
no session is invisible and unremovable, so its **name is permanently unusable**.
The sentence a person reads is not kept as a placeholder for that roadmap.

### 🛑 The stopping rule, written down BEFORE the next pass reports

**Pre-registered 2026-08-20 19:15, at `20dbacc`, so the result cannot shape it.**

One more blind pass runs against this tree. **Whatever it returns, the PR opens
after it.** Converged means a pass with zero new BLOCKERs, WARNINGs or
CONVENTIONs; if it does not meet that, the proof file says `converged: false`
with the count, and the loop continues against the open PR under the
orchestrator's standing ruling that a PR is not a merge and that a person
reading it is a second instrument sharing no step with this loop.

🔑 **The reason it may never converge is worth more than the number.** Two
delivered passes, and each found its BLOCKER inside the previous pass's own fix:
a doc comment that went false in the commit range that made it false, then a
docblock left standing while I edited its twin thirty lines away. **Neither was
a code defect.** Both were sentences about the code, written in the last hour,
which is kosmos#120's class arriving on a branch that is nothing but sentences.
Iteration cannot exhaust a generator.

### Recorded, not fixed, from the passes on the current tree

| what | why it stays |
|---|---|
| the singular frame doubles the noun or outcome on **seven of nine** | Ruled as weight rather than a lie: the keys are authored at engine call sites, so trimming them is a wider change staged out of this branch. ⚠️ **The guard covers the group line only, and the group line is the RARER path** (it needs two or more members with identical verdicts), so the hardened arm is the uncommon one. Recorded so the guard is not read as covering both. |
| `projects.js`'s plural for the folder row says `folder` in the worker-directory sense under a frame saying `folder` in the project sense | Pre-existing in shape; the group-line guard asserts single-occurrence for `instructions` only, so the same collision on `folder` is unguarded. Not widened here because the fix is a wording choice on a row nobody has ruled. |
| `chat.js:572` "it will not read this until it finishes" implicates that it WILL read it, which `PLACED` cannot know | Ruled copy. `PLACED` knows a keystroke was typed; the `UNCONFIRMED` arm correctly stops earlier. Flagged, not changed. |
| `create.js:761` offers "you can remove it there instead" on the arm whose premise is that nothing is left | The conditional ("**If** you can see it under Agents") keeps it from being false, and it is deliberate: the four conditions do not guarantee the agent is absent, which is the whole reason removal is offered conditionally. |

### 🛑 Four copy findings raised and NOT fixed, because the words are the designer's

The third pass found four that are hers to rule. All four are recorded with the
rendered evidence rather than an argument.

**1. The frame presupposes the thing one of its reasons denies exists.**
Composed with `projects.js:132`, the singular renders:

> *"Its instructions were not updated for this folder: this agent has no
> instructions file yet, and we will not create one for it."*

The frame asserts `Its instructions` as an existing object; the reason says there
is no file. Same in the plural. ⚠️ **This is not the doubling the plan already
records as accepted weight**, and the guard cannot see it: it counts occurrences
of a word, and a presupposition failure is not a count.

**2. The frame removed the anchor that fixed what "them" meant.**
The old plural frame named the agents (*"We could not tell any of them where this
folder is"*) before any value ran, so every value inherited a referent. The new
frame's only plural noun is *instructions*, and the values now use `them` for
both: *"none of them has a folder"* (agents), *"we could not write to them"*
(instructions), and in one clause *"they keep them somewhere we cannot safely
change"* (agents, then instructions). 📌 **The trim that removed the noun is what
took the disambiguator with it**, so the guard asserting `instructions` appears
exactly once is the property that made this worse.

**3. The task-claim reasons answer a different question than the column asks.**
`claim.claimed` is null because we will not say **who holds this task**; the
ruled sentence says *"so we will not say what it is doing"*, which is about an
agent's activity. Its sibling arms kept the right subject. ⚠️ **And my own
harmonisation propagated it**: I changed the roster-unreadable arm to end alike
for consistency, so both arms now answer the wrong question, and the failure
message I wrote on `tasks.test.js:216` concedes the collision in its own words.

**4. `web/index.html:8385` still sends a person to a README**, twice, on the
create-failure screen that its own comment calls *"the screen where somebody is
most likely to want an agent gone"*. This is the exact class the sweep removed
from `create.js`, and `web/index.html` is not declared out of scope anywhere.
**The branch's own objection to the `create.js` pointers applies to it.** Its
replacement is a different situation from the four (the agent exists and its
supervisor keeps retrying), so it needs its own words.

### One flake, recorded rather than smoothed over

`cancel mid-download aborts the stream and leaves nothing behind` failed once and
passed on an immediate re-run **with no change in between**. It is timing, not
this branch (nothing here touches downloads), but a suite that is green on the
second try is not a green suite and pretending otherwise is how a real
intermittent gets attributed to the next person's diff.

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
