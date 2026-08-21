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

- `yarn test`: **1031 pass, 0 fail**.
- 24 tests in `web.post-receipt.test.js`, which **executes** the functions
  rather than grepping the page for their output.
- The filtered-vs-whole-room test carries its own control: the same call against
  a filtered list really does answer differently, so the call site is what has
  to be right, and a structural assertion pins that call site.

## What the blind pass found

**Three blockers, and all three were about coverage rather than behaviour.**

1. **Nothing executed `pjRoomRow`** — the one hop that makes the sentence
   visible. Dropping the `silent` argument at that call left every test green
   while the sentence never rendered. That is the "ships dead" failure the test
   file's own header claimed to prevent.
2. **The threshold test was checking its own copy of the threshold.** The file
   declared `2 * 60 * 1000` and injected it into the harness, so the page could
   have said twenty minutes or zero and every assertion would still pass. It is
   now read out of the page and asserted.
3. **The two-minute gate at the point it is applied had no coverage at all**,
   because it lived inline in `paintRoom`. It is now `pjSilences`, a function,
   for exactly that reason.

And two real behaviours, both of which would have reached a person:

- **The sentence rendered under an AGENT's post.** Agent rows carry outcomes
  too, so the room could say "Nothing back from Johnson" underneath something
  Rick said — a receipt about somebody else's message.
- **"Any of them" swept in an agent we had just said could not be reached.**
  The two clauses then contradict each other about what we know.
- **Two agents showing the same display name merged into one verdict**, because
  the match happened in display-name space. Display names are not unique;
  creation collides only on the slug.

🔑 **The harness changed shape as a result.** Slicing individual functions out
by brace-matching is why the renderer had no test: it reaches nine helpers and
two module-level values, and each one discovered by a `ReferenceError` was
another guess about the page. The whole script is now evaluated with a DOM stub,
which cannot drift because there is no dependency list to keep in step.

## Deliberately not here

- Anything about whether an agent *chose* not to answer.
- Any sentence under an agent's own posts. This is the person's receipt.
