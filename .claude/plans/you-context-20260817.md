# you-context: the person, answered once, taught to every agent (task #14)

The pack's About-you step, built to Josh's own ruling: NO skip ("if they
don't want to tell what they wanna be called and who they are then they
have no purpose in using this"), with the honest version of no-skip,
Continue that WAITS on the two required answers while the third stays
genuinely optional. "Answer once and every agent you make will know it.
Nothing here leaves this computer."

## The mechanism, one derivation end to end

- RECORD (engine/you.js): one local file (you.json in the DATA root),
  three answers (name required <=80, what-you-do required <=200,
  always-know optional <=2000), validated whole-or-not-at-all before an
  atomic write. The read is three-state: saved / absent (the wizard's
  normal start, not an error) / unknown-with-reason (a hand-edited
  record that fails its own validation is never half-served).
- BLOCK: a second managed block in the agent's boot file, its own
  markers beside (never inside) the projects block, because the
  projects block is removed when an agent leaves its last project and
  who the person is does not stop being true. The block machinery is
  projects.findBlock/spliceBlock/removeBlock PARAMETERIZED by marker,
  one derivation of the tight-pair matching and refuse-on-ambiguity
  rules that keep the most powerful write in the product from eating
  somebody's words. Answers are cleaned (markers neutralized, one-line
  answers collapsed) before they enter the block.
- TELL (you.tellAgent / syncEveryone): mirrors projects.tellAgent's
  guard sequence exactly, exact-match-to-permit on a TIED session, the
  reader's own editable verdict, never inventing a boot file, refusing
  two well-formed blocks, never throwing. An absent record REMOVES the
  block (no residue). syncEveryone addresses tied sessions only and
  carries a per-agent verdict.
- BIRTH (engine/create.js): a new agent's boot file carries the block
  from the same write that creates the file, because at create time the
  session does not exist yet and the tell path's tied-session gate
  would refuse the very agent being made. Non-gating: an unreadable
  record must not cost the person their agent.
- ROUTES: GET /api/you answers the read shape at 200 (absent included);
  PUT /api/you validates (400 with the field's own sentence), saves,
  and re-tells every tied agent, carrying the verdicts (never gating).
- WIZARD: new step 4 of 6, between Claude and the fork. Pack copy
  verbatim; the two required fields gate Continue (aria-disabled kept
  in step); Continue saves through the real route before advancing and
  surfaces the route's own sentence on refusal; re-entering the step
  prefills from the saved record and saves over it, which is the
  "You can change these later" path today (a dedicated settings surface
  is a later slice). The wizard's quiet exit stays: that is the
  trap-escape for a wrong detection, not a skip of this question.

## Deliberately not in this slice

A dedicated edit surface outside the wizard (the deep-linkable step is
the edit path for now); teaching existing UNTIED or fileless agents
(the tell refuses honestly and says why); any use of the answers beyond
the boot-file block.

## Also in this branch (pre-existing drive staleness, caught by running them)

The first-run drives had drifted from main: `body > header` went stale
when the sticky .apphead wrapper landed (the overlay marks the wrapper
inert now), and the create picker grew a third radio (own) after the
drive's two-radio comment. Both fixed in the drives, plus the six-step
renumbering and an About-you leg (gate measured disabled, one answer
not enough, both arm it, the save lands before the step advances).

## Verification

node --test 809/809 (engine/you.test.js: validation, round trip,
unknown-with-reason, marker neutralization, tell/remove/refusals,
syncEveryone skipping strangers; create.test.js: born-knowing splice
and its absence costing nothing; server.test.js: /api/you wire shapes).
Both first-run drives run against a live sandboxed server:
click-first-run all clear (the whole flow including the gated step),
render-first-run "no rendering problems found" across light and dark
including the new firstrun-4-about-you shots.
