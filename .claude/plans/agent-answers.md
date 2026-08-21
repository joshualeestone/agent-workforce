# An agent can answer the person (#175)

## What did not exist

Josh, on 0.2.11, with a brand-new agent:

> I said hello and got no response. I see the response in the TMUX window but
> there's nothing getting pushed into her dialog window box.

🛑 **She was not refusing to answer. There was no way for her to.** Two calls in
`server.js` wrote into a conversation and both were operator-only — and deeper
than that, **the stored record had no field for a sender.** An entry was
`{at, text, wire, delivery}`, and the readers stamped `kind: 'operator'` on the
way out, because until now every message in a direct thread was the person's.

So this is not a command hooked to an existing store. It is the record learning
to say who spoke.

## The five pieces

| | |
|---|---|
| **the record** | `from` on a thread entry. **Absent means the operator**, so every file already on a person's disk keeps working. A required field would have made this a migration. |
| **the readers** | `kind` now comes from the record rather than from where the row was found. The conversation view stamped `'operator'` unconditionally, so a reply would have rendered as the person's own words. |
| **the renderer** | `dmRow` gained a branch for a row the agent wrote. |
| **the route** | `POST /api/reply`. The sender is the **pane**, never a name in the body. |
| **the command** | `kosmos reply "…"`, and the instruction block now names both surfaces. |

## The two decisions worth arguing with

🔑 **The sender is taken from `TMUX_PANE`, never from the request.** A name in a
request is a claim by the caller, and any local process can make it.
`resolveSender` ties the pane to a card on the roster, so an agent can only ever
write as itself. Same rule `/api/msg` already follows.

🔑 **A reply carries no delivery state.** The person's messages carry one because
they must cross into a terminal and may not arrive. A reply is written straight
into the record the screen reads: **the append IS the arrival.** Reporting
`placed` would invent a mechanism that never ran.

⚠️ **And the default was claiming one.** `state` falls back to `COULD_NOT` —
correct for the person's messages, where it means "no evidence it arrived" —
so a reply was being stored as undelivered. **The box looked fine**, because
`dmRow` skips the verdict for these rows; the CONVERSATION view does not, and
would have printed "Not sent." under a reply that had arrived. **Found by
running an append and reading the record back, not by looking at the page.**

## Evidence

- `yarn test`: **1115 pass, 0 fail**.
- Seven tests, five proven to fail against a deliberate break: dropping the
  sender field, inventing a delivery, letting the request name its own sender,
  rendering a reply as the person's words, and making the sender required (which
  breaks every existing file).
- **The breaks were run through `tools/prove-it-fails.sh`**, which refuses on a
  dirty tree — because the same loop destroyed uncommitted work seven times
  earlier today.
- The fixture path is taken from the producer (`direct..<name>.json` under
  `chats/`), not guessed; the first version guessed and both old-file tests
  failed against a directory that does not exist.

## Not in this change

- **The room's equivalent.** An agent posting to a room already works; this is
  the direct box only.
- **Any indicator that a reply arrived while the page is elsewhere.** The thread
  is polled; nothing pings.
