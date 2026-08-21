# member-stale -- the row where you add an agent says whether it has been told

## Why

Josh, 2026-08-21, testing 0.2.9. He created a project, added an agent, deleted
the project, made another, added the agent again, posted to the room, and the
agent replied out of the project he had **deleted**:

> *"this one's in a different project ("testproject") than the **Office Lease**
> work I'm set up for. I'm not sure I'm actually on that project."*

🔑 **The messaging worked.** Delivery worked, the room worked, the agent
answered. An agent reads its instructions when it starts and **nothing makes it
read them again** (#143), so adding it to a project edits a document it already
finished reading.

⚠️ **And it is silent from both ends.** The room prints *"Placed with Johnson
and Rick"*, which is true about **delivery** and says nothing about whether
either agent knows what the project is. The only reason anyone found this is
that the agent volunteered it.

## What this branch does, and what it deliberately does not

**Does:** puts the verdict Kosmos already computes on the row where a person
adds an agent to a project.

**Does not:** fix the mechanism. That is #143 and the ruling there is to tell the
agent in-band, carrying the change itself rather than instructing it to re-read.
This branch is the floor that ships regardless: even with a mechanism there is a
window between the write and the agent knowing, and a screen that asserts nothing
on a path where something can silently not happen is wrong on its own terms.

## Not a new computation

`engine/instructions.js:329` has returned this all along:

| state | sentence |
|---|---|
| `stale` | the file has been edited since this agent started, and only a restart re-reads it |
| `current` | this agent started after the file was last edited |
| `unknown` | we cannot tell when this agent last started |

And its own comment already refuses the trap: a missing timestamp on either side
must be `unknown`, never `current`, *"or an agent we cannot assess renders as
fine"*.

🛑 **It was drawn on the agent card and the agent list row, and nowhere else.**
So it appeared on the screen where a **person** edits the file by hand, which is
the one place they already know something changed, and was absent from the screen
where **Kosmos** edits it on their behalf.

## The copy, and the one thing it must not say

| state | row |
|---|---|
| stale | **Has not picked this up yet** |
| unknown | **We cannot tell whether it has this yet** |
| current | *nothing* |

⚠️ **The row must not say "restart it."** That is true today and stops being
true the moment #143 lands, and **a sentence naming a workaround outlives the
workaround.** The detail panel already carries the full sentence with the
restart in it, which is the right split: the row says what is **true**, the panel
says what to **do**. Mona Lisa's ruling.

✅ **`current` says nothing.** A row that announces the expected case trains
people to stop reading the exceptional one, and this column already carries a
state, a role and sometimes a verdict.

## 🛑 The class split is load-bearing, and a test found it rather than a plan

The mark started as `class="pj-told pj-notyet"` and **broke an existing test**:
`suppressTold` removes every `pj-told` span, because when the whole roster shares
one verdict the group line carries it.

**Staleness has no group form.** One member can be running on old instructions
while another is not, so it is per agent and must survive that suppression.
Sharing the class would have hidden it **exactly when several members were in the
same state**, which is the most likely case. Its own class now.

📌 The suppression test was not written for this and caught it anyway, which is
the argument for a property test over an example one.

## Verification

    yarn test          1003 pass, 0 fail

Proven by breaking both halves:

- stale renders nothing → *"a member running on instructions from before it was
  added says nothing about it"*
- the row names the workaround → *"the stale row names a workaround, which
  outlives the workaround"*
