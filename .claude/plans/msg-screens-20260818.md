# msg-screens — the messaging screens, built against the spec

Mona Lisa's spec: Josh-Brain/Projects/kosmos-messaging-screens-2026-08-18.md
(b430051), written against merged engine code. Her four decisions taken
whole: conversations live on the agent's page interleaved; a colleague's
row reads differently from yours; every delivery state renders, none as
silence, because-sentences verbatim; replies indent one level, never a
tree. The valve row is reassurance, not error.

## Built

- GET /api/agent/:name/conversation: read-only merge of the agent's
  project threads (via the engine's own projectsFor reverse edge) and
  the a2a record; time-sorted tail of 200 with the total said;
  could-not-look rows (a failed projects read, an unreadable thread, an
  unreadable message record via messages.record(), ENOENT kept as the
  true empty) ride AHEAD of the cap, never dropped by it.
- The Conversation dbox on the agent page: convoRow renders operator
  rows (You · on <project>), attributed peer rows (gold mark), the
  unconfirmed line, Not-sent with the verbatim because, the valve
  sentence under Kosmos's own name, one-level indents.
- §5 gap sentence (her ruled cause-free wording; the spec records the
  supersession and all three causes of block-absence as of 9da8cda):
  gated on the structured instructions fields so it never speaks about
  a file nobody could read.
- ATTRIBUTED REFUSALS ARE EVENTS (the settled three-way ruling with
  Splinter's fork check): eleven post-resolution exits log kind
  'refused' with the because verbatim, once per sender-recipient-because
  per window; the one unattributed exit logs nothing; the screen draws
  her copy ("<from> tried to message <to>. Not sent: <because>").

## Recorded deferrals

- The conversation is a one-shot snapshot (no poll); refresh rides the
  clean-chat wiring chunk.
- Colleague rows print session names (what the log holds);
  display-name resolution is the clean-chat naming pass.
- No knownAgent gate on the route (the page is the only caller; history
  for removed agents is legitimate); revisit if the API grows callers.
- The send path's valve fails open on an unreadable log (recorded trade
  in-module; revisit with retention).

## Second pass (both passes blocker-free; converged per the standing
## shape)

- refuse()'s append is best-effort with the verdict returned regardless
  (chat.appendMessage's never-throws contract is the house standard;
  the spill exit's refusal fires BECAUSE the store could not be written
  and must not then throw writing to it); the logged to is capped at
  120 (unvalidated caller input, each distinct value a dedup key); the
  dedup's fail-open noted as the read-side trade.
- loadInstructions' post-await guard now checks the OPEN AGENT as well
  as the load token (opening an untied agent never bumps the token, so
  a late answer painted agent A's file and gap sentence on B's panel);
  paintConversation gains the INSTR_LOAD-pattern monotonic token for
  same-agent fetch races.
- Recorded, untested by choice: the unreadable-projects and
  unreadable-thread arms mirror the pinned unreadable-record arm
  structurally; planting a directory at a thread file to drive them is
  the next test-touch's cheap addition.
