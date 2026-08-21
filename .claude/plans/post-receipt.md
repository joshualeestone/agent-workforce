# "Nothing back from Rick." (#145)

## The sentence that was true and useless

Josh posted into a room three times and got the same receipt each time:

> Placed with Johnson, Rick and Bob.

Nothing came back, and the receipt was **true every time** — the keystrokes were
placed. It simply read identically whether the agents had answered or not, so
the screen could not tell him the difference between a working room and a broken
one. **A true sentence that cannot distinguish working from broken is the same
failure as the CLI's "everyone received it"**, and it cost him most of a morning.

## What it adds

A second sentence under a post, when there is something to say:

| | |
|---|---|
| base | `Placed with Johnson, Rick and Bob.` |
| one silent | `… Nothing back from Rick.` |
| some silent | `… Nothing back from Rick or Bob.` |
| all silent | `… Nothing back from any of them.` |
| none silent | no second sentence at all |

**"Or", not "and"**, because it is a different list from the one above: the base
receipt is an "and" list (all of them got it), and "nothing back from Rick and
Bob" reads as one joint absence rather than two.

**"Any of them" when it is all of them**, because repeating the whole list reads
as a *different* set of people; "any of them" points at the list already in front
of the person. Named in the order they appear in the first sentence, so the two
can be matched by eye.

## The three rules that decide every case

🔑 **"Back" means ANY message from that agent in this room after this one, NOT a
reply to this specific message.** We cannot see intent and must not pretend to,
and the wording is chosen to match exactly that: "nothing back from Rick" is true
of "Rick has said nothing since", which is what we can actually observe.
⚠️ **If this is ever tightened to reply-threading, the sentence has to change
with it**, or it becomes a claim about whether somebody chose to answer.

⚠️ **A render condition, not a timer.** Nothing is scheduled and nothing is
stored: the sentence appears on the first paint after two minutes and disappears
on the next paint once the agent speaks. A stored verdict would keep telling
somebody nobody answered five minutes after somebody did.

⚠️ **Computed from the whole room, never the filtered rows**, and from position
rather than timestamps. Typing in the search box must not be able to change what
a receipt claims, and two messages can land in the same millisecond.

## Evidence

- `yarn test`: **1022 pass, 0 fail**.
- 14 new tests in `web.post-receipt.test.js`, which **executes** the functions
  rather than grepping the page for their output.
- The filtered-vs-whole-room test carries its own control: the same call against
  a filtered list really does answer differently, so the call site is what has
  to be right, and a structural assertion pins that call site.

## Deliberately not here

- Anything about whether an agent *chose* not to answer.
- Any sentence under an agent's own posts. This is the person's receipt.
