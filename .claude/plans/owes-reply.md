# owes-reply -- the engine can see the silence, off two timestamps

## Why

kosmos#145. An agent's reply lives in its own session; **only an explicit
`kosmos post` or `kosmos msg` reaches the shared log.** Nothing bridges them, so
an agent that answers thoughtfully and never runs the command has produced, from
every other vantage point, a silence. Josh, 2026-08-21, three times: *"I didn't
get your responses."*

⚠️ **Every party held a true belief while it happened.** The person saw nothing
arrive. The agent believed it answered, and had. Kosmos recorded a successful
delivery, and was right, because the **operator's** message was delivered.

> Nothing was in an error state, so nothing could alert. **The only instrument
> that sees a gap like that is one comparing two sides.**

## What this is, and what it is not

`messages.owesReply(agent)` → `{ owes, lastHeardAt, lastSentAt }`.

🔑 **No pane scraping, deliberately.** *"Did the agent reply?"* read off its
screen is a guess about text. *"Has anything arrived from it since we delivered
to it?"* is a fact already in the log. **The cheaper question is also the
sounder one.**

📌 **It does not decide when to say so.** A grace period and the sentence are a
design call, and an engine that hard-codes "four minutes" has made it silently.
The caller gets both timestamps and chooses.

## Two refusals built in

**Only rows that carry text count as being spoken to.** `valve` and `refused`
rows name the agent in `to` and are Kosmos's own bookkeeping *about a message
that did not go*. Counting one would put an agent in debt for a message it never
received: **a false accusation assembled out of our own record-keeping.**

**A project-typed `to` is never matched against an agent name**, the same rule
`list` follows, so an agent named like a project does not inherit that room's
bookkeeping.

## 🛑 The test that could not fail, and how it surfaced

The first version drove two real sends and asserted the ordering. **Inverting the
comparison in the engine left the whole suite green.**

Both sends land in the **same millisecond**, so the two timestamps are equal and
neither direction wins. **The property was asserted against data that could not
express it.** A real agent cannot reply in the same millisecond; the fixture
could.

Pinned now on hand-written timestamps five minutes apart, where "after" and
"before" are unambiguous, plus the tie case: **equal times must not read as
owing**, because the ordering is unknowable at that resolution and an accusation
is the wrong default for a state we cannot determine.

## Verification

    yarn test    1004 pass, 0 fail

Proven by breaking both halves:

- counting bookkeeping rows → *"a refused or throttled row counted as being
  spoken to, so the agent owes a reply to a message it never got"*
- inverting the comparison → *"it spoke five minutes AFTER being spoken to and is
  still shown as owing a reply"* (and this one **only** fires because of the
  direction test above)

## Not in this branch

The surface. Where this is said, in what words, and after how long is a design
call. #144's member row is the obvious home and already exists.
