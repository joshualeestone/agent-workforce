# The direct box stops implying a reply it cannot carry

## What happened

Josh made a new agent on 0.2.11, opened its page, said hello, and waited.

> I see the response in the TMUX window but there's nothing getting pushed into
> her dialog window box.

🛑 **She was not refusing to answer. There is no way for her to.** Traced rather
than inferred: across the whole product exactly **two** calls write into any
conversation — `server.js:2095` and `server.js:3220` — and both are on routes
only the operator can reach. Deeper than that, the stored record has no field
for a sender: an entry is `{at, text, wire, delivery}`, because until now every
message in a direct thread was the person's. **The format cannot represent an
agent speaking.** (#175)

## What this change is, and is not

**It is a label.** The box heads itself *"Just between you and Dan"*, which
describes a two-way place, and nothing on the screen said a reply could not come
back. So the product invited a conversation it cannot hold, and he sat waiting.

> Dan will see this in their own window. Replies come back there rather than
> here, for now.

**It fixes nothing.** It stops the screen implying the conversation, and it says
where the answer actually is — which is the difference between an admission and
a useful one.

## Three decisions, each with its reason

- **By the composer, not at the foot** (Mona Lisa): by the time somebody reaches
  the bottom of a box they have already decided what it does. The restart note
  has been at the foot all along and he never mentioned it.
- **"For now"** is the house form, checked rather than invented — Settings
  already says *"One account for now. Connecting another is not built yet."* It
  says the limit is known, not that they are holding it wrong.
- **Nothing was removed.** Both existing sentences are ruled copy and neither was
  wrong; the defect was something missing.

## ⚠️ The fix that was stopped

A copy fix was drafted for the agent-facing instructions: *"to answer a person,
run `kosmos msg <name>`"*. **That command reports a delivery and appends nothing
the operator can see.** The agent would have claimed to have answered while the
box stayed empty — the CLI-overclaim failure with an extra step, on the one
surface the person is already suspicious of. It was stopped before it shipped.

## Evidence

- `yarn test`: **1102 pass, 0 fail**.
- Four tests, each proven able to fail: deleting the line, moving it below the
  persistence note, softening "for now" into a promise about a schedule, and a
  control that both original sentences survive.

## Not in this change

- The reply path itself (#175). It needs a record that can say who spoke, plus
  the read, the render, a command, a route, and the instructions — with a design
  decision in the middle that belongs with Mona Lisa.
- The "working…" indicator (#176), which is worth more after #175 than before:
  today it would promise an arrival that never comes.
