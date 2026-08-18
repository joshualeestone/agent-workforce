---
pre_challenge: true
method: challenge-loop
branch: room-posts
diff_hash: 1f538d145f098e6d4493bbe53e5c5387e6e10572be46fd1416fa835269a0277e
subdir_audit: passed
timestamp: 2026-08-18T16:59:02Z
iterations: 1
converged: true
---

# Challenge Loop Proof: room-posts

One blind pass (a first spawn died on an API server error mid-response
and was respawned fresh per the loop's failure rule; the failed spawn
is not counted). No blockers; every warning fixed, every nit either
fixed or recorded as a deliberate trade in the plan. Full decision
record: .claude/plans/room-posts-20260818.md.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 1 | [WARNING] | messages.js pair dedup | A room-valve row (to = project id) could satisfy the pair dedup when an agent name collides with a project id, suppressing the pair closing's row -- a refusal rendered as silence | FIXED (dedup excludes project-carrying rows) |
| 2 | 1 | [WARNING] | forgery gate | Untested on the post path and for send()'s background half; deletable with a green suite | FIXED (presence tests both markers both paths, no-marker control) |
| 3 | 1 | [WARNING] | mention tokenizer | "@mara." silently demoted an addressed mention; "admin@mara" promoted a remark to a request | FIXED (left boundary absolute, trailing-punctuation strip; envelopes pinned to their panes) |
| 4 | 1 | [WARNING] | install/kosmos verdicts | The post response embeds outcomes keyed by AGENT NAMES, so an agent named "state" or "error" could flip an unanchored substring verdict (a partial post reading "everyone received it") | FIXED (globs anchored on top-level keys) |
| 5 | 1 | [WARNING] | install/kosmos timeout | -m 30 cannot cover a serial fan-out of wedged recipients, and the could-not-reach sentence for a mid-delivery server invites the re-post unconfirmed exists to stop | FIXED (-m 120; curl exit 28 gets its own truthful exit-3 sentence) |
| 6 | 1 | [WARNING] | server.js /api/post | No server-level test for the route's own derivations | FIXED (project resolution, no-project sentence, members off the record, marking through the route) |
| 7 | 1 | [NIT] | fan-out test | Envelope selectors keyed on body text (both envelopes carry it) with a dead-no-op predicate | FIXED (selected on the marker under test) |
| 8 | 1 | [NIT] | outsider citation | Negative asserted only COULD_NOT | FIXED (because pinned to the membership rule) |
| 9 | 1 | [NIT] | archived projects | Posts into archived rooms accepted, unrecorded | RECORDED at the route (archive hides and un-counts; it does not close) |
| 10 | 1 | [NIT] | born block | Agents born before this branch never learn kosmos post | RECORDED (the screen chunk owns surfacing the room to the existing fleet) |
| 11 | 1 | [NIT] | room valve copy | The everyone-sentence is person-facing copy delivered to a refused agent | RECORDED for chunk 2, where the sentence meets its audience |

Also folded mid-loop, from Splinter's HEADS-UP: the room valve neither
counts operator posts nor refuses the operator (a decision made before
the operator path exists, committed at the valve), and the per-head
tightness of a fixed per-project cap is an accepted cost bound, flagged
with the ROOM_CAP number for Mona Lisa.

[STRENGTH] noted by the pass: the bracket grammar is defended at every
entry (sender and project validated against the bracket-safe charset,
the delimiter outside it, the marker gate on both spellings and both
paths) so background genuinely cannot arrive unmarked through the
blessed path; the valve tests carry real presence controls in both
directions; the spill lifecycle handles both failure grains with the
id-burn discipline carried over; spec section 6 holds in the engine
with the aggregate state explicitly demoted to a summary.

## Final state

Suite 861/861 plus shell checks; validation-log clean for this diff;
route wiring proven against a sandboxed server.
