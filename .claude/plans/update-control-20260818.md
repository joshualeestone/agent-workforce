# update-control: asking for an update becomes possible

Date: 2026-08-18 ~8:05 PM. Branch `update-control`. Mona Lisa's spec:
~/work/Josh-Brain/Projects/kosmos-update-control-2026-08-18.md (7
falsifiable claims), born from Josh's 0.1.9 test hour.

## What

1. engine/update.js:
   - TTL 6h -> 15min (my channel commitment to Josh: a release reaches
     every running app within the quarter hour; latest.json is ~25 bytes
     behind a CDN, cost negligible).
   - The cache learns REACHABILITY: {at, latest, reached}. "Could not
     reach the update server" must never render as "up to date".
   - checkNow(): awaits a fresh fetch (bypasses TTL), returns
     { running, latest, reached }.
   - lastLook(): { reached, at } for the status payload.
2. server.js:
   - POST /api/update/check -> checkNow() result (POST: it triggers
     network on the person's behalf; inherits the cross-site guard).
   - /api/status update payload carries reached alongside the offer.
3. web/index.html Settings card:
   - The version line, her four states verbatim:
       Current    "Kosmos 0.1.9. Up to date."            [ Check now ]
       Newer      "Kosmos 0.1.8. Version 0.1.9 is ready." [ Update ]
       No look    "Kosmos 0.1.9. Could not reach the update server." [ Try again ]
       Checking   "Kosmos 0.1.9. Checking."              (disabled)
   - Check now does three things (her spec, the order matters): clears
     the kosmos-update-later note, asks the host immediately, updates
     the line. Clearing the note is what ends the Later trap.
   - [Update] in the newer state opens the existing Update Kosmos?
     confirm (one install path, not a second).
   - The background sentence beside it: "Kosmos runs in the background.
     Closing this window does not stop your agents."
4. The completion message (her toast-label rule): the toast keeps saying
   what the poll saw; after the update completes and the page reloads,
   a message says what actually landed: "Updated. You are on Kosmos
   <served version>." Implemented as a sessionStorage note written
   before the reload carrying the before-version; the fresh page shows
   the message only when the served version actually CHANGED (an
   installer no-op must not claim "Updated").

## Stop Kosmos: sentence ships, button deferred (my call, her spec
delegates it)

`kosmos stop` kills the BOARD process only. Agents live in tmux sessions
under launchd, independent of the helper, and keep working. A [Stop
Kosmos] button beside "closing this window does not stop your agents"
would read as "stop the spending" while doing no such thing: the exact
deception the sentence exists to prevent, in button form. The honest
button stops the board AND the agents, which is fleet-stop machinery
(per-agent launchd + tmux teardown, ownership-gated) and its own chunk.
The sentence is true and ships now.

## Tests

- engine/update.test.js: TTL value; reached true/false transitions;
  checkNow bypasses TTL and returns the fresh answer; lastLook shape.
- server.test.js: the check route (fresh fetch, POST-only), status
  carrying reached; Settings card states from a DOM stub (all four,
  mutually exclusive, line never blank: her claim 4); Check now clears
  the later key (her claim 3); completion note only on version change.
- Render evidence both themes: the card in current/newer/could-not-look
  states. CAPTURED (scratchpad upd-newer/uptodate/unreachable.png +
  upd-card-{light,dark}.png, against a local release-host fixture);
  attached to the PR and the channel per house rule. The boot render
  also caught a real state the spec missed: the first look in flight
  rendered "could not reach" before any look had failed -- lastLook now
  carries `looked` and the card says Checking until the first answer.
- The card joined the pack's existing Updates card rather than becoming
  a second update-ish card (flagged for Mona Lisa's pass; the spec
  placed the line "in Settings" without naming a card).

## Out of scope

- Stop-the-fleet button (above).
- The answer panel (own chunk, approved, specced).
