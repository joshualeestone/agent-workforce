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
  from a template literal was invisible**, and `remove.js` composes several
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
| 2 | `connect.js:146,147`, `stderr` in an object literal | a FIELD NAME, not copy. It was briefly renamed here and reverted: four call sites read `.stderr`, so renaming it is a behaviour change wearing a copy branch. |
| 4 | `create.js:708,715,722,761`, the README pointer | ruled ("say what to do in the sentence, never name a document") but the words are **not written yet**. Mona Lisa's. |
| 1 | `messages.js:141` | reachable only from a shell, by measurement. Expected, not unfixed. |
| 1 | `remove.js:857`, `${found.session}` | the checker matches the word inside an **identifier**; the sentence itself says "something called X is still running". |

**Eight is the pass and fewer is a failure**, for the same reason six was: four of
these are waiting on words, and the other four are things the checker cannot
distinguish from copy.

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

### The second verification: every ruled row is actually IN the tree

```
KOSMOS_REPO=<worktree> PATCH=~/work/Josh-Brain/Projects/kosmos-engine-copy-PATCH-2026-08-20.md \
python3 - <<'PY'
import io, os, re, glob
patch, repo = os.environ['PATCH'], os.environ['KOSMOS_REPO']
src = "\n".join(io.open(f, encoding="utf-8").read()
                for f in sorted(glob.glob(repo + "/engine/*.js")) + [repo + "/server.js"])
unq = lambda x: (re.match(r"^``(.+)``$", x) or re.match(r"^`(.+)`$", x)
                 or re.match(r"^(.*)$", x)).group(1)
missing = 0
for line in io.open(os.path.expanduser(patch), encoding="utf-8"):
    if not line.startswith("|"): continue
    c = [x.strip() for x in line.strip().strip("|").split("|")]
    if len(c) != 2 or c[0] == "find" or set(c[0]) <= set("-"): continue
    ruled = unq(c[1])
    if ruled not in src:
        missing += 1
        print("not as ruled:", ruled[:90])
print("=>", missing)
PY
```

- **kind:** guard · **pass:** `== 5` · **source:** `Josh-Brain/Projects/kosmos-engine-copy-PATCH-2026-08-20.md`

⚠️ **This was 8 and three of them were silent half-applications.** Mona Lisa's
patch warns that *a find matching nothing is silent*. The mirror is louder and
nobody was watching it: **a replacement can be applied in words the applier chose
rather than the words that were ruled**, and nothing anywhere compares the two.

The three that were wrong: the usage-limit sentence had only its banned noun
swapped rather than taking the ruled wording; `we do not know which pane this
agent is in` became *"we do not know where to reach this agent"* instead of the
ruled *"we cannot tell where this agent is running"* -- **and that substitution
is what caused a reviewer finding**, because the ruled wording is direction-
neutral and one string serves both a send gate and a read gate; and
`messages.js:141` kept the closing clause of the ruled sentence and **dropped the
half that tells the caller what to set**. All three now carry the ruled words.

| the five that remain | why |
|---|---|
| `Kosmos did not set this one up...` | superseded by the later "set to start on its own" ruling, which rewrote the same sentence |
| `we could not check what it is doing on this computer` | changed deliberately: the failure is fleet-wide and the "it" referred to nothing |
| `we could not get the message to it` | changed deliberately: it made a claim about ARRIVAL, which is the neighbouring state's claim |
| `we could not check whether it arrived` | superseded by a richer sentence at `chat.js:686` carrying the same meaning |
| `we could not find any of them...` | the live plural is the longer "by exactly these names" form the group map holds |

📌 **Three of these five are wordings I chose over hers.** They are hers to
overrule, and each is recorded above with the measurement that prompted it.

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
   separately now.
   ✅ **FIXED after the second blind pass, which found the sharper half:** the
   sentence did not merely lack a referent, it was **near-identical to
   `classify`'s single-agent sentence** (`status.js:976`, "we could not tell what
   it is doing"), so a whole-machine failure read as a statement about one agent.
   It says "we could not check what is running on this computer" now. Two pins
   moved with it. Still Mona Lisa's to overrule.

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
