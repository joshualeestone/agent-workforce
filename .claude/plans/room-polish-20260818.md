# room-polish: receipt pill dark borders + one verdict for an identical roster

Date: 2026-08-18. Branch `room-polish`. Follow-up to #75 (pjone-room) and #71
(dark-tokens), triggered by Mona Lisa's rgba sweep and the pack-comparison
screenshot (channel, 2026-08-18 ~3:54 PM).

## Why

1. Mona Lisa counted the light attention red `rgba(179,38,30,…)`: 7 uses in
   the app, of which 6 have dark twins. The seventh is the receipt pill:
   `.delivery.failed` carries the light red border into dark, and its sibling
   `.delivery.placed` carries the light green `rgba(47,125,90,.5)` too. The
   trio (web/index.html:838-840) predates the dark work in a sense that
   matters: it landed in #75 AFTER #71's dark pass, so it never met that
   review. This is the recorded a-new-sibling-does-not-inherit-the-guard
   class. `.delivery.unsure` is dashed and color-neutral, no change.

2. The pack-comparison screenshot showed three IDENTICAL "We could not tell
   it where this folder is …" sentences stacked in one members column. The
   verdict is honest per member, but when every member of a 2+ roster
   carries the exact same line, repeating it is weight without information.
   Collapse to ONE group sentence below the roster, still stated, never
   dropped.

## What

- Dark block (after the attn family, ~web/index.html:1378): add
  `.delivery.placed { border-color: rgba(121,197,157,.5); }` (the dark green
  family `.astate.st-working` already uses) and
  `.delivery.failed { border-color: rgba(255,140,130,.5); }` (the one dark
  red family).
- Factor the told-line derivation out of `pjMember` into `pjToldLine(told)`.
- New `pjToldGroupLine(told)` (group grammar for the two states) and
  `pjSharedTold(roster)` (returns the group sentence iff roster length >= 2
  and every member's rendered told line is identical and non-empty; the
  string-equality key means same state AND same because, so the group claim
  is exactly as true as each per-member claim it replaces).
- `pjMember(m, projectId, suppressTold)`: third arg suppresses the
  per-member told span when the group line will carry it.
- `paintOneProject` renders the group line as `<p class="pj-told-group">`
  appended inside `#pj-one-agents` (a `.pj-members` flex column, so it sits
  below the member cards with the column gap).
- CSS `.pj-members .pj-told-group` styled like `.pj-member .pj-told`
  (caption, `--label-2`, margin 0).

## Honesty constraints

- The group line keeps both halves of the 'told' sentence including the
  "unless its instructions have been changed since" hedge (plural form).
- Mixed rosters (any member differing in state OR because) keep the full
  per-member lines. Singleton rosters unchanged.
- Group could_not keeps the because verbatim, esc'd, same as the per-member
  form.

## Tests

- `pageFunction` tests for `pjToldLine`, `pjToldGroupLine`, `pjSharedTold`:
  identical could_not collapses; identical told collapses; mixed states do
  not; same state different because does not; singleton does not; empty
  tolds do not.
- `pjMember` suppressTold arg: told span present without it, absent with it.
- Dark CSS presence pinned the way 7b-theme-flip cannot see: assert the dark
  block contains `.delivery.failed` with the 255,140,130 family and
  `.delivery.placed` with 121,197,157 (guards the trio from losing its dark
  twins again).

## Added in review (2026-08-18 ~4:10 PM)

- Mona Lisa's drawing pass found the valve band concatenating sentence and
  timestamp with no separator ("…bring you in.2 minutes ago"): in a .msg
  row the flex header supplies the gap, the band is a plain block. Fix is
  the pack's measured value verbatim: `.msg-valve .msg-t { margin-left: .5em; }`
  (FROZEN-2026-08-18c).
- Iteration-1 review fixes: the group-line test now pins the because
  verbatim AND its escaping (the line lands as raw HTML); TOLD_PRELUDE
  uses the page's real esc via pageFnSource instead of a hand copy; the
  dark-block pin brace-matches the enclosing block (with a light-rule
  negative control) instead of inferring from marker order; STATE_COPY
  stand-in commented as deliberately partial.

## Out of scope

- The pack's own rgba widening (Mona Lisa owns the pack and the
  unflipped-literal guard).
- The members-column resting shape (name + state vs role): awaiting the
  pack redraw; this chunk only dedupes the verdict weight.
