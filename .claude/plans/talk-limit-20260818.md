# talk-limit: the conversation limit becomes the person's control

Spec settled in-channel 2026-08-18 ~1:00-1:06 PM (Josh's shape, Mona
Lisa's copy and the notify/stop split, Splinter's convergence catch);
the raw channel record rides in talk-limit-spec-record.md.

The model, hers verbatim: the counter ALWAYS tells the person; the
switch decides only whether Kosmos also STOPS them. On (default) =
tells you and stops them. Off = tells you and lets them continue.
Telling is not configurable, same rule as "we could not look".

Decisions:

- engine/limits.js: { on: true, perHour: 20 } in limits.json (the
  you.json layout convention), tiers [10, 20, 40, 100]. An unreadable
  or malformed file fails toward ON at the default: the safe direction
  is the bounded one.
- The dial is PER CONVERSATION, not global: each pair gets perHour
  exchanges an hour; each room gets 4x perHour arrivals an hour (the
  4x allowance recorded in #75 carries over). Default 20/hour equals
  the shipped 10-per-half-hour pair rate exactly, so shipping On with
  the default changes nothing for existing fleets (Josh's ship-on
  ruling). Windows move from 30 to 60 minutes so the number on screen
  is the number they get (Mona Lisa's unit warning: a person picking
  40 an hour must not silently get 40 per half hour).
- The valve rows gain stopped: true|false. Crossing a budget always
  logs the tell (once per window); the refusal happens only when on.
  Screens render the stopped and told-only variants distinctly: a row
  claiming "Kosmos stopped them" when it let them continue would be
  the product lying about itself.
- Settings gains the card with her copy verbatim (heading, hint,
  On/Off, "Stop them after [tiers] exchanges an hour", her Off-state
  sentence). Engine-copy for the told-only rows and the high-tier cost
  line are Angel drafts attributed for her pass, per the fleet
  precedent.
- GET/PUT /api/limits; the card paints from the engine's read.
