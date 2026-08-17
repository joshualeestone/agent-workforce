# commitments-join: one list, told honestly (task #20, slice 1)

The 0.1.2 release note promised it in public: "What an agent says it is
holding and what you wrote down are still two lists, and joining them is
next." This branch is the join, built to the pack's rule (assignment is
the join) and Mona Lisa's honesty rulings, under Josh's ship-iterate bar.

## The mechanism, one derivation end to end

- MATCH (engine/tasks.claimFor): deterministic, never fuzzy. A
  commitment joins a task only when its text names "task <number>",
  word-bounded (task 1 never matches task 12). Three answers, never
  two: claimed true (a fresh report names it), claimed false (a fresh
  report does not, which is NOT "not started"), claimed null with the
  reason (absent/stale/unreadable record, never rendered as either).
- TEACH (projects.blockBody): the managed block in each agent's own
  instruction file now lists its open tasks in exactly the matching
  spelling ("- Task 3: <sentence>") plus one convention line. The join
  is not a convention nobody was told about; the teaching surface is
  the file agents boot from. One-arg blockBody calls stay compatible
  (no session name, no task lines).
- FOLLOW (task routes): create-with-who, close, and reopen re-tell the
  assignee (syncAgent, non-gating, verdict carried in the response), so
  the block follows the record.
- JOIN AT READ (projects.describe): assigned open tasks carry `claim`,
  computed engine-side from commitments.read (lazy requires resolve the
  tasks<->projects load cycle; one read per assignee per project,
  memoized per call). No screen re-derives the rule.
- RENDER: the card gains the pack's own phrase, "says it is on this",
  ONLY when claimed is true; false and null render nothing (the
  chip-is-the-status ruling stands). The dialog's close-note regains
  its scene-setting sentence exactly as ruled when the correction
  shipped without it: "<Name> says it is on this." in says-vocabulary,
  never as an observation Kosmos cannot make.

## The blind round's two findings, both fixed

- Cross-project collision: every project counts tasks from 1, so one
  agent on two projects can hold an open "task 1" on both, and a report
  saying "task 1" cannot say which. The join now carries an AMBIGUITY
  guard (joinTaskClaims, computed from the full store): a colliding
  (who, number) pair joins as claimed null with the reason on every card
  it touches, because rendering "says it is on this" on either would be
  a definite claim the system cannot check. Teaching an unambiguous
  spelling (and matching it) is the next slice; refusing to guess is
  this one.
- told-when-not: the API accepted a task assigned to a non-member while
  syncAgent derives the block strictly from membership, so the route
  answered told about a block that never listed the task. Assignment now
  requires membership, refused inside the same atomic mutate that stores
  the task ("that agent is not on this project..."), matching the
  member-only dropdown the screen already enforces.

Round 2's two findings, both fixed: (a) member REMOVAL re-created the
told-when-not shape through the other door, since removal does not
unassign while the block derives from membership; the join now answers
could-not-tell with the reason for a non-member assignee's task, so a
departed agent's still-fresh report never renders as definite. (b) the
matcher's trailing \b sat happily between "1" and ".", so "task 1.5"
in a report joined task 1; the boundary is now two lookaheads (not a
digit, not dot-then-digit), still matching a sentence ending "task 1."
Round 2's smaller catches: claimFor's definite branch is allowlisted on
the producer's own STATE vocabulary (an unrecognized state falls to
could-not-tell, never to a definite answer); the cross-store ambiguity
counts are memoized per snapshot (WeakMap) so list() builds them once;
non-integer stored numbers route to the whole-number reason instead of
an ambiguity sentence interpolating NaN.

Round 3's two findings, both fixed: (a) the ambiguity count now mirrors
the taught convention exactly, counting member tasks only, so a
departed project's leftover assignment neither suppresses the live
project's join nor produces a because-sentence claiming the departed
project is "one of this agent's projects"; (b) the told verdict on the
task create/close/reopen responses is now wire-tested (present in the
TOLD vocabulary when assigned, absent when not), so a regression
dropping it cannot stay green. Round 3's smaller catches: the
non-integer guards use safe integers (1.5e21 passes isInteger and
still interpolates a dot), applied in the matcher, the ambiguity
count, and the teaching lines; describe's inner readAll binding no
longer shadows the join's `all` parameter.

Plus round 1's hand-edited-store nit: a non-integer stored number is
regex when interpolated (1.5 matches "task 175"), so claimFor now
refuses non-integers as could-not-tell instead of matching by accident.

## Deliberately not in this slice

The pack's richer card states ("Waiting on you", "2 of 3 assigned"),
multi-part tasks, the task detail page with its activity thread, and
any agent-detail surface for unmatched claims ("an agent reporting
something matching no task belongs on the AGENT, not here"). They
iterate against Josh's use, per the night's directive.

## Verification

node --test 799/799 (claimFor's boundary/three-answer contract; the
described project joining from the REAL commitments store, incl. the
absent-record-is-null case; the teaching block scoped to the right
agent with closed tasks excluded and the one-arg compatibility; the
tasks test file gained the DATA sandbox its new commitments writes
required, per sandbox-every-root). Committed drive extended with the
full arc measured live: no says-line before any report, the assignee
reports "task 1" through the real PUT route, the card grows exactly one
says-line, the joined note leads with the agent's own claim.
