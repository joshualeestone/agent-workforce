# group-reasons: the engine supplies a plural form beside each singular because

Date: 2026-08-18, ~4:40 PM. Branch `group-reasons`. Follow-up to #80,
implementing Mona Lisa's ruling on the could_not group frame (channel,
message 1539388036016504996).

## The ruling (hers, verbatim intent)

The engine's because strings are written for a single-agent context and do
not survive being quoted inside a plural frame ("any of them ... this
agent"). Of her three ways out she wants the third: **the engine supplies
a GROUP form beside each singular because** - fixes the cause, keeps
verbatim intact. Until a group form exists, the group line ships WITHOUT
the reason: "We could not tell any of them where this folder is." (an
incomplete true sentence beats a complete confusing one). The told form
is fine as written and does not change.

## Design

- `engine/projects.js`: a `GROUP_BECAUSE` table keyed on the EXACT
  singular because string, mapping to its plural sibling, plus
  `groupBecause(because)` returning the group form or `null`. Exported.
- The group form is attached AT READ TIME: `list()` emits
  `told.becauseGroup = groupBecause(stored.because)` beside the stored
  verdict. Deriving at the read boundary means old stored verdicts get
  their group forms for free (their becauses are the same verbatim
  strings) and there is no storage migration; an unmapped or null because
  yields `null`.
- `web/index.html` `pjToldGroupLine`: with `becauseGroup`, the group line
  joins the plural clause the same way the singular row joins its reason
  ("We could not tell any of them where this folder is - <group>.");
  without it, the line is Mona Lisa's interim reasonless sentence. The
  "Each for the same reason:" colon frame from #80 is retired. The told
  branch is unchanged (her pass: fine as written).
- The null-because fallback inside the group like ("we could not write to
  their instructions") is retired with the frame: a could_not with no
  because renders the reasonless sentence; the per-member row keeps its
  own singular fallback.

## The table (drafts MINE, flagged for Mona Lisa's pass)

Every singular is copied exactly from its author (tellAgent and the
strings that propagate into verdicts via instructions/workerfile),
including the curly apostrophe in "agent's". Unlisted strings (e.g. the
interpolated N-blocks sentence, workerfile's link/not-a-folder shapes)
deliberately fall back to the reasonless sentence rather than risk a
wrong splice.

| singular (verbatim) | group draft |
|---|---|
| this agent has no folder on this computer yet | none of them has a folder on this computer yet |
| this agent has no instructions file yet, and we will not create one for it | none of them has an instructions file yet, and we will not create one for them |
| we cannot tie an agent by exactly this name to a session on this computer, so we did not write to anything | we cannot tie any of them by exactly their names to sessions on this computer, so we did not write to anything |
| we could not check which agents are running, so we did not write to anything | (itself: no singular referent) |
| this agent keeps its instructions somewhere we cannot safely change | they keep their instructions somewhere we cannot safely change |
| taking this out would leave its instructions almost empty, so we left them alone | taking this out would leave their instructions almost empty, so we left them alone |
| its instructions are already at the size limit, so we left them alone | their instructions are already at the size limit, so we left them alone |
| we could not write to this agent's instructions | we could not write to their instructions |

## Honesty constraints

- `groupBecause` NEVER invents: unmapped in, `null` out, and the screen
  states no reason it does not have.
- The mapping is exact-match on the verbatim singular, so a drifted or
  edited engine string silently falls back to the reasonless sentence
  rather than pairing with a stale plural.
- Collapse eligibility is unchanged (rendered-line equality on the
  SINGULAR lines); the group form only changes what the one line says.

## Tests

- engine: every table row maps; unmapped and null yield null; the
  self-mapped neutral string returns itself; `list()` emits becauseGroup
  beside a stored could_not verdict and null for told/not_tried.
- page: pjToldGroupLine with becauseGroup joins the plural clause
  (esc'd, pinned with a markup-carrying group form); without it renders
  the reasonless sentence exactly; told branch unchanged; not_tried
  still refuses.
- The #80 pins on the retired colon frame are updated to the new shapes.

## Added scope (her ruling, 4:44 PM, message 1539389612781207755)

- "Take off" -> "Remove from project" on the member rows. The pack's own
  pattern: "Remove from <scope>", beside the existing destructive
  "Remove from Kosmos"; the scope word is what tells the person their
  agent survives. Button text and aria-label both.

## Follow-ups recorded, not in scope

- Mona Lisa's pass on the eight group drafts (bless-or-replace; the
  table is the single site to edit).
