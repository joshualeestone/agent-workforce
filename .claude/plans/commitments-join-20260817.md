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

## Deliberately not in this slice

The pack's richer card states ("Waiting on you", "2 of 3 assigned"),
multi-part tasks, the task detail page with its activity thread, and
any agent-detail surface for unmatched claims ("an agent reporting
something matching no task belongs on the AGENT, not here"). They
iterate against Josh's use, per the night's directive.

## Verification

node --test 797/797 (claimFor's boundary/three-answer contract; the
described project joining from the REAL commitments store, incl. the
absent-record-is-null case; the teaching block scoped to the right
agent with closed tasks excluded and the one-arg compatibility; the
tasks test file gained the DATA sandbox its new commitments writes
required, per sandbox-every-root). Committed drive extended with the
full arc measured live: no says-line before any report, the assignee
reports "task 1" through the real PUT route, the card grows exactly one
says-line, the joined note leads with the agent's own claim.
