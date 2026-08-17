# tasks-column: person-created tasks on the project page

Task #7, built 2026-08-16 night from the frozen pack (via CURRENT-FREEZE,
FROZEN-2026-08-16) plus Mona Lisa's two in-channel rulings tonight, which
ARE the v1 spec where the pack leans on the commitments join:

- THE WHO CHIP IS THE STATUS. "Nobody yet" is the only state word. No
  "Not started" on an assigned card: that is a claim about the agent v1
  cannot check (the removed "Handed off" class). States derived from
  assignment, which Kosmos owns; never from behaviour, which it can only
  be told about. The join lands with the conversation-window work and
  brings the pack's richer states with it.
- THE CLOSE-NOTE SHIPS NOW, blessed verbatim: "Marking it done closes it
  here. It does not stop <name> or change what <name> is doing." Both
  clauses are about what Kosmos does not do, verifiable tonight, and
  needed MORE before the join exists. The scene-setting sentence returns
  in front of it when the join lands.

## Shape

- engine/tasks.js: tasks live INSIDE the project record (the number is
  issued by the project and unique only there, so the project is the
  storage unit and the atomic write is the store's own mutate, newly
  exported). Whole-or-not-at-all validation; who recorded with the
  everSeen honesty shape; close/reopen are record edits that can never
  reach a session. columnTasks encodes the pack's door rule.
- Routes (guard-inherited POSTs): create task, close, reopen; the served
  project payload carries tasks via describe's spread, so the screen
  reads them where it already reads the project.
- UI: the Tasks field on the project page (New task ABOVE the list, Josh
  2026-08-15), tkcard cards (renamed from the pack's .task, which
  collides with the agent card's own task line: found by the drive
  matching 15 agent cards), the door revealing in place (no all-tasks
  screen yet; the reveal resets on project SWITCH, and deliberately not
  on same-project Back-and-return, the page's round-31 rule), the
  pack-verbatim New-task modal (Cancel / gold Create task disabled until
  the sentence exists, "You can give it to somebody later."), and the
  view dialog (Back / Mark as done|Reopen; "Back" not "Close", because
  two closings with one word beside "Mark as done" is a trap). Full
  modal machinery on both dialogs from the start, wrap-at-the-last-stop
  shape.

## Out of this slice, recorded

- Multi-part tasks (parts as the assignable things), the task detail
  page with its activity thread, and the all-tasks screen: they arrive
  with the messaging/conversation-window work (#8/#20).
- Card states from the commitments join, and the join itself.

## Verification

- node --test 792/792 (engine: validation-writes-nothing proven on the
  store, project-scoped numbering atomic with the write, everSeen shape,
  door rule with a whole-list control; wire: guard 403 by adjacency-free
  assertion, refusals write nothing, create/close/reopen round trip,
  payload carries tasks; the fixture-discipline lint caught and fixed a
  hand-built roster row).
- Committed drive (render-tasks.js): modal copy verbatim + gated create,
  trap holds with real keypresses, column/door split measured, chip-is-
  status, blessed close-note on screen, done and reopen round trip via
  a project-switch bounce, zero page errors. Screenshots committed.
