# project-description: the one-line description field

Date: 2026-08-15 (overnight run). Owner: Angel. Directive: Josh, twice on
2026-08-14 (placement under the title, editing home in project settings),
with Mona Lisa's pack rendering it on every card; PIN-2026-08-14-1913CDT
covers "Project card and detail description rendering". Cap for this
branch's challenge loop: 6 rounds, set before starting, sized to blast
radius (one optional string in the PROJECTS record; the worst it can
break is a card's text).

## What this adds

- `engine/projects.js`: `cleanDescription` (one-line fold like the name's,
  trim, 200-char cap), `create({ description })` storing it (empty string
  when absent), and `setDescription(id, text)` where explicit empty
  CLEARS, deliberately unlike the profile displayName's blank-drop: a
  description is optional by design and the settings screen offers
  clearing. Legacy records without the field gain it on first write and
  read as '' everywhere.
- `server.js`: POST /api/projects passes it through; PUT /api/project/:id
  now moves each field only when the request carries it (the route used
  to run rename unconditionally), and re-tells members only on a rename,
  since the managed block carries the name and nothing else.
- `web/index.html`: the card row gains an escaped one-line description
  between name and path; the detail renders it directly under the title.
  Both absent entirely when there is none (no empty grey line). The CSS
  uses --label-2 per the twice-measured AA rule on this screen.
- Tests: engine (trim/fold/cap/optional; update/clear/legacy-heal), route
  (create carries, GET lists, description-only PUT leaves the name alone,
  rename-only PUT leaves the description alone, explicit empty clears),
  source pins for both rendering arms, and a rendered-page pass in
  render-projects.js asserting the row, the absence arm, and the detail.

## Out of scope tonight

The editing UI (the pencil lives in project settings, an unpinned
screen); the pack's three-column detail. The route is the write path
until settings lands.

## Verification

node --test (742 after round 1), render-projects.js and render-thread.js
against the sandboxed fixture, then the challenge loop (rounds recorded
below).

## Review round 1 (2026-08-14 evening)

Seven warnings, all fixed:
- The PUT applied rename and setDescription as two independent writes, so a
  failure in the second reported failure for a rename that had persisted.
  Engine gains `edit(id, fields)`: every carried field validated BEFORE one
  mutate, so a save applies whole or not at all (tested engine and route).
- A PUT carrying no recognised field answered 200; now refused ("nothing
  here we can change"), because a typo'd key reporting saved is a save the
  person believes happened.
- One rule for what a description IS on both routes: strings only
  (cleanDescription throws on non-strings; POST's String() coercion that
  stored "[object Object]" is gone; null is refused too, since the blessed
  clear is the explicit empty string).
- The harness now drives the DETAIL's absence arm (undescribed project,
  hidden === true), measures both description tokens in the contrast sweep,
  and renders a description at the 200-char cap asserting one-line
  truncation on the row.
- The textContent render of the detail is pinned in server.test.js beside
  the row's esc() pin, so an innerHTML swap goes red.
- `.pj-desc` lost font/line-height to `.panel p` on specificity; both
  selectors now carry the element and the comment tells the truth.
- The cap cuts characters (an emoji survives whole or not at all) and trims
  the cut; describe() normalizes description to '' for legacy records so
  the API reads as '' everywhere, not only the two web renderers.
