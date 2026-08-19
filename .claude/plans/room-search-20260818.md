# room-search: Search this conversation

Date: 2026-08-18 ~10:07 PM. Branch `room-search`. Slate item 2: the
map's one confirmed gap, drawn in the pack (18e:380-386 styles,
18e:2994-3007 markup: the Conversation header becomes a row so the
search locks right without moving the title; sha c69afdb2... verified
against CURRENT-FREEZE).

## What the pack specifies vs what is mine

- THEIRS (verbatim): .tsearch styles, the header-row structure, the
  icon, placeholder and aria-label "Search this conversation".
- MINE (the pack draws no behavior; flagged for Mona Lisa's pass):
  - The filter: case-insensitive substring over each row's sender
    display name and text, applied at paint to the record rows the room
    already renders (valve bands match on their sentence). It searches
    what the room HOLDS -- no server round trip, no new claims.
  - The empty state when a filter matches nothing:
    "No posts match." (draft MINE).
  - Scroll: a filtered paint never auto-scrolls (the person is reading,
    not following the live tail); clearing the filter restores the
    normal newest-post scroll.
  - The filter resets on project switch (a query is a reading posture,
    not project state; carrying it across projects would hide another
    room's posts silently).

## Added scope: her removal announcement (ruled 10:07 PM)

"Taken off." was the struck phrase wearing a new hat. The success
announcement in the settings removal handler becomes her sentence
verbatim: "<Name> is off this project and still on your computer."
The could_not verdict recomposes to the same opening plus the existing
instruction-write warning (mine following her pattern, flagged for her
pass): "<Name> is off this project and still on your computer. We could
not update its instructions, so it may still mention this project when
it next starts. <because>"

## Tests

- The filter as a pure extracted function: match on name and text, case
  folding, valve sentences, empty-query passthrough.
- Markup/CSS pins: the .tsearch rule verbatim, the header row, the
  placeholder/aria pair, the wiring (input handler present, reset on
  project switch, no-scroll-when-filtering).
- The announcement: success writes her sentence with the agent's name;
  could_not keeps the verdict; both through the guarded handler.
- Render evidence, sha-named, both themes: a filtered room with a match
  and the no-match state.

## Added scope 2: the members hint is cut (Josh, 10:07 PM)

The section keeps its "Project members" label; the sentence beneath it
goes. The survival reassurance lives at the moment of the act instead
(her announcement carries "...still on your computer" exactly when the
person needs it). The whole-sentence copy pin retires with it.

## Review notes (iterations 1-3)

- The reset pin's first form matched the variable's own declaration and
  could never fail; all lifecycle pins now live inside their owning
  functions. The filter fixtures gained discriminating probes (display
  name diverging from key; operator from not 'you').
- The no-match sentence is ONE function feeding shown (escaped) and
  spoken (plain) copies; the announcer respects a partially unreadable
  record and resets its transition flag on project switch.
- ACCEPTED with reasoning: a poll that flips the match state does not
  update the transition flag (under-announcement only, one edge
  keystroke; per-keystroke noise is the worse trade). The search scope
  is name+text, not timestamps/receipts (recorded product call). The
  1px focus-within border is pack-verbatim and AA-passing; any
  strengthening belongs upstream (flagged to Mona Lisa).
