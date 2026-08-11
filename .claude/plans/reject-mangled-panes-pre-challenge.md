---
pre_challenge: true
method: challenge-loop
branch: reject-mangled-panes
diff_hash: 9d5b0e1d30b7ce0cfa4e33c5deb7eba007d1c85ce7ad5a831bc25b522c6b064c
subdir_audit: n/a
timestamp: 2026-08-11T06:16:41Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No. One round, which found no production BLOCKER and three real
WARNINGs, all fixed. A small, contained change on clean `main`; stopped after
one round rather than looping to convergence, and the state is recorded here
rather than claimed.
⚠️ **The hash in this file was stale on its first write.** It was computed
before the fixes it certifies were committed, so it covered the previous commit
and would have been rejected at PR time. Caught by comparing it against the
real diff rather than assuming the command that produced it ran at the right
moment. Recomputed against the final tree.

**Total findings:** 9 actionable (0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs)
**Fixed:** 9 | **Deferred:** 0

### Iteration 1

- **[WARNING] `isParseable` trusted every field once ANY tab survived.** `title`
  is the one field that can itself contain a tab, so a mangled line whose title
  held one re-admitted the exact garbage agent this change exists to reject,
  with `rejected: 0` so nothing refused and nothing was counted. **Reproduced**
  before and after: `angel-discord_0.0_…_ Working<tab>on<tab>the thing` parsed
  as an agent named `angel-discord_0.0_…_ Working`. --> FIXED (the second field
  is shape-checked against `#{window_index}.#{pane_index}`, which tmux always
  satisfies and a mangled line cannot fake; a truncated `session<tab>0.0` still
  passes, so the deliberate keep-truncated-lines policy is intact)
- **[WARNING] The board's notice was pinned by a source scrape** that could not
  tell "the operator sees it" from "the identifier appears in the file".
  Mutation-proved twice. --> FIXED (behavioural: the summary block is executed
  against a fake element, using the same harness this file already has for
  exactly this lesson)
  - ⚠️ And the first behavioural version **still** missed one of the two
    mutations, because the harness re-implemented the join instead of running
    the real line — a harness reconstructing the behaviour it tests is a
    source-shape assertion one level in. Then it missed it again because the
    fixture's other counts were zero, so the notice fitted inside the trimmed
    part. Both fixed; both mutations now fail the suite.
- **[WARNING] The gate's PARTIAL-answer behaviour was unpinned.** Changing it to
  refuse on any unreadable line — a machine-wide outage from one cosmetic fault
  — left the suite green. --> FIXED (pinned as a decision, in both directions,
  with the cost of the trade written down rather than implied)
- [WARNING] The partial gap reaches the board's summary and nothing else, so the
  type/restart paths proceed on a roster known to be incomplete --> FIXED
  (stated as display-only, with the reasoning)
- [CONVENTION] `UNREADABLE_LINES` was mutable module state in constant casing,
  justified by a claim that threading it would be a second derivation — which
  was not true --> FIXED (removed; `listPanes` returns the count)
- [NITs] `parsePanes`' own doc did not mention that it now drops lines; the
  count was derived from a second filter pass rather than from what parsed; the
  claim about what the round-trip test catches was overstated, and the format
  mistake it described is not constructible --> all FIXED

### Verification that is not a test

- The **exact string the board displayed** during the outage produces no agent.
- The live board still reads all **13 real agents**, with `unreadableLines: 0`.
- Six guards mutation-tested, each confirmed to turn the suite red: the
  `isParseable` filter, the shape check, the board's refusal, the gate's
  refusal, the count, and the notice.
- ⚠️ **One earlier mutation run reported two guards as unpinned when the
  mutations had not applied at all** — the patterns did not match. Re-run with
  an assertion that each mutation lands, one turned out to be a real hole: the
  board's refusal was unasserted. A mutation not verified to apply is a check
  that measured nothing.

### Known limits

- The mangling itself (tmux sanitising its own output without a UTF-8 locale)
  was bisected during the outage and is **not reproducible from a client shell
  now** — the tmux server's locale decides, not the client's. The evidence here
  is the exact output string it produced, not a fresh reproduction.
- Nothing appends a column to `PANE_COLUMNS` today, and no test would catch it
  if something did.
