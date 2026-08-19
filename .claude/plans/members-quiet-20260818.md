# members-quiet: the members column says less, Project settings says who

Date: 2026-08-18 ~9:16 PM. Branch `members-quiet`. Slate item 1 of the
0.2.1 run Josh authorized (message 1539456717803360326), built entirely
from settled rulings and the 18e drawing (sha c69afdb2..., verified
against CURRENT-FREEZE).

## Rulings this implements (all from tonight's channel)

- Josh: member removal moves to Project settings (accident-worry +
  space). Mona Lisa's 18e draws the section: rows with name + state +
  "Remove from project" linkbutton, aria "Remove from project: <name>",
  under her ruled copy sentence, placed BEFORE Archive (the escalation
  gradient she named: member < archive < remove-from-Kosmos).
- Mona Lisa (Josh: "Bingo"): SUCCESS SAYS NOTHING in the members column;
  a receipt for the expected thing earns no space. Failure still speaks
  in-column (interim until the project notice is drawn; Splinter tracks
  the exit dependency on his board).
- The confirm stays LIGHT: removal is recoverable in two clicks, so the
  direct DELETE the column had moves as-is; no modal grown.
- .btn-quiet gains justify-content: center (her class-level fix from the
  pack, 18e line 173: labels centred, was left-packed at full width).

## What

1. pjToldLine: the told (success) arm returns '' -- the sentence
   retires. could_not unchanged (rows or plural-reason group line).
2. pjToldGroupLine: the told arm returns '' (no group success sentence).
3. pjMember: the removal button leaves the rows entirely.
4. pj-settings-view gains the Project members field (flabel + her copy
   verbatim + rows + its own fmsg), painted from the same project the
   facts painter already receives, repaint-on-change so focus survives
   polls. The existing [data-drop] handler moves its home: same DELETE,
   same verdict-read, message lands beside the rows it acted on.
5. .btn-quiet centred per the pack.

## Tests

- pjToldLine told -> ''; could_not unchanged (existing pins keep it).
- pjSharedTold: an all-told roster no longer collapses to a sentence
  (nothing to say); could_not collapse tests unchanged but re-fixtured
  where they relied on told states.
- pjMember renders no button; the settings markup carries the rows,
  her copy verbatim, and the data-drop wiring (source-level pin like
  the group-line wiring pin).
- btn-quiet centring pinned text-level (justify-content in the rule).
- Render evidence both themes, sha-named files per tonight's convention.

## Interim state (tracked)

could_not verdict lines remain in-column until the project notice is
drawn (morning); their exit dependency is on Splinter's board.
