---
pre_challenge: true
method: challenge-loop
branch: projects
diff_hash: 2f514f0fec7c2bcf2edd95333241c4de9c978e05f448df5c12228ca0c7f4e0ee
subdir_audit: passed
timestamp: 2026-08-12T02:21:41Z
iterations: 11
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** No. Stopped at iteration 11 on the orchestrator's (Splinter's)
explicit direction and a context ceiling, not because findings stopped. Iteration
11 found a BLOCKER. The honest reason is recorded in full below, in the same
shape as PR #28.
**Total findings:** 61 across 11 iterations (6 BLOCKERs, 27 WARNINGs, 12
CONVENTIONs, 16 NITs)
**Fixed:** 59 | **Deferred:** 2

Iterations 1-7 ran in earlier sessions; their findings and fixes are recorded in
the commits named below. Iterations 8-11 ran in this session and are detailed in
full.

### Why this branch took eleven rounds

Rounds 5, 6 and 7 each found a blocker of ONE class, and none of them were in the
code under test. They were in the FIXTURES: a roster carrying fields
`paneRoster()` has never returned, a stub on a seam the engine does not read, a
value typed into the wrong tab-separated column. That is why iteration 8 stopped
patching instances and built the mechanism (`test-support/fleet.js`).

**The mechanism held.** From iteration 9 onward, not one finding was a
fixture-shape defect at that seam. What rounds 9-11 found instead were product
defects the fixture made *findable*, plus a pattern worth naming: **three of the
last four rounds found their worst defect inside the fix from the round before.**
That is a real property of this work, not a run of bad luck, and it is the reason
the loop is being stopped by judgment rather than by convergence.

### Per-Iteration Breakdown

#### Iterations 1-7 (earlier sessions)
Commits `04076c5`, `8373eb5`, `a69be93`, `c9aa2e1`, `842a794`, `e0a8208`.
Headline findings: the managed-block writer wrong three rounds running (retired
by a 25-shape matrix test asserting invariants rather than expected output); a
corrupt `projects.json` killing the board process; `An.gel` normalising to
`angel` and rewriting the real agent's boot file (gate is now loose to notice,
exact to permit); `listPanes` refusing a mangled tmux answer but not no answer at
all; and the worst one — every projects route describing member rows against
`paneRoster()`, which returns exactly `{sessionName, session, isNamedOurs}` while
the code read `name`, `state` and `because`. It survived six rounds because the
test fixture invented those fields.

#### Iteration 8 — the mechanism
**New findings:** 0 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 4 NITs
Commit `6fbe913` (the fixture) and `aa26bb4` (the findings against it).
- [WARNING] fixture-discipline.test.js — the card-literal lint required `{` and
  `sessionName` on one source line, so the same card across four lines walked
  through --> FIXED (`aa26bb4`), measured before and after
- [WARNING] fixture-discipline.test.js — the pane-line lint matched the two
  source characters `\t`, so real tabs and `[a,b].join('\t')` evaded it --> FIXED
- [WARNING] fixture-discipline.test.js — "the refusal left no stub installed"
  asserted `Array.isArray(agents)`, true in both worlds. The first replacement
  was ALSO vacuous. Third version fails on the mutation --> FIXED
- [WARNING] fixture-discipline.test.js — neither lint had a positive control, so
  both were unfalsifiable --> FIXED
- [WARNING] test-support/fleet.js — `strict()` wrapped one level deep while
  claiming "every object reachable"; `card.context.pct` read `undefined` --> FIXED
- [CONVENTION] test-support/fleet.js — claimed to be "the only sanctioned way to
  obtain a fleet"; ~19 places still install the seam themselves --> FIXED (stated
  as two tiers, second named as a real gap)
- [CONVENTION] engine/status.js — a load-bearing comment claimed `snapshot()`
  stays lenient when tmux cannot be asked; `listPanes` was made to throw one
  round earlier --> FIXED
- [NIT] the lints scanned a hardcoded root-file list; `paneRoster()` called
  outside the restore guard; `unknown` advertised but never exercised; grammar in
  the lookup failure --> ALL FIXED

#### Iteration 9 — the product
**New findings:** 1 BLOCKER, 8 WARNINGs, 2 CONVENTIONs, 4 NITs
Commits `8577943` and `5d508e8`.
- [BLOCKER] engine/projects.js — the row summary hid its own blind spot, under a
  comment saying it cannot. `unseen` counted only members with no card, so a
  member whose pane could not be captured, and a member whose pane is not TIED to
  the name, fell through every bucket. "mara · nils — 1 working" for a project
  holding one unreadable agent, while the same agent's card reads "Can't tell"
  --> FIXED, mutation-verified
- [WARNING] engine/status.js — a first-run machine was told its fleet was
  unreadable. `tmux list-panes -a` exits 1 when no server runs, `sh()` flattened
  that to null, and the board 500'd about a machine it had successfully looked at
  --> FIXED (`shDetail`/`tmuxSaidNoServer`/`tmuxPanes`), wiring pinned against the
  real tmux binary
- [WARNING] web/index.html — an unreadable project list rendered identically to
  "on no projects", under its own docstring forbidding exactly that --> FIXED
- [WARNING] web/index.html — "We cannot see any agents" printed before any look
  had happened, on the first screen a new person reaches --> FIXED (`BOARD_LOOKED`)
- [WARNING] web/index.html — every step of the folder browser dropped keyboard
  focus to `<body>` --> FIXED, and see below
- [WARNING] engine/projects.js — `describe()` documented PURE while it persists
  the `everSeen` upgrade on a read --> FIXED (the word was the defect)
- [WARNING] engine/projects.js — `folderState`'s docstring described `lstat` and
  a resolved-path-on-screen behaviour that is not built --> FIXED
- [WARNING] test-support/fleet.js — `blind()` still claimed `snapshot` stays
  lenient --> FIXED
- [WARNING] server.projects.test.js — the corrupt-store liveness assertion was
  true for every response the route can emit --> FIXED
- [CONVENTION] the removal note spoke the machine name ("claudebot") for the
  agent every other surface calls Splinter --> FIXED
- [CONVENTION] the agent picker had no group semantics, unlike its sibling --> FIXED
- [NIT] the removal confirmation was unannounced; the folder listing reported a
  total it never counted; the `told` prediction outran its evidence; macOS
  realpath case --> FIXED (the last one recorded as a known false refusal rather
  than "fixed" by loosening a containment check)

⚠️ **The focus fix did not work when first written.** It guarded on an element id
that does not exist, so the guard was always false and `focus()` never ran. No
unit test could have seen it. The browser check caught it on the first run,
failing with the exact message the fix exists to prevent, because the assertion
was added BEFORE the fix was trusted.

#### Iteration 10
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
Commit `e28152f`. **Two were regressions from iteration 9.**
- [WARNING] engine/projects.js — the `everSeen` upgrade was the one name-keyed
  read that did not check `isNamedOurs`, and it is the one that WRITES. Any
  ordinary `tmux new -s notes` flipped a mistyped member's "never seen" flag and
  PERSISTED it, unrecoverably --> FIXED, mutation-verified with the tied control
- [WARNING] web/index.html — the picker could hang on "Looking for the agents…"
  for the rest of the session, because the flag was set only on the poll's
  success path (regression from 9) --> FIXED
- [WARNING] web/index.html — the crumb's `aria-label` REPLACED its text as the
  accessible name, so the keyboard user I moved focus there for heard the label
  instead of the folder (regression from 9) --> FIXED
- [WARNING] docs/browser-checks — the contrast pass's comment claimed
  `.pj-folder-state.bad` was in its selector list. It was not, and the pass runs
  on a project whose folder is readable --> FIXED, measured for the first time
- [CONVENTION] `findBlock`'s docblock sat after `findBlock` --> FIXED
- [NIT] two tmux tests returned silently when tmux is absent; the pane-line
  ratchet described as active when it cannot run; a CSS comment claiming a
  consistency `pjMember` does not have --> ALL FIXED

#### Iteration 11 — final round
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 2 NITs
Commit `6183a24`. **The BLOCKER is a regression from iteration 10.**
- [BLOCKER] web/index.html — repainting the picker on the five-second poll (added
  in 10 so it would stop lying about having no agents) put an unconditional
  `innerHTML` write on a timer, destroying the focused control every five seconds
  in the primary onboarding flow --> FIXED (every write through `setLive`)
- [WARNING] web/index.html — "every agent we can see is already on it" was shown
  when we can see NONE; the discriminator was `on.size`, not `LAST.length` --> FIXED
- [WARNING] web/index.html — "There are more" claimed folders nobody examined,
  re-making in words the claim `total: null` had just removed from the API --> FIXED
- [WARNING] web/index.html — the folder browser's ERROR path still dropped focus
  and announced nothing --> FIXED
- [CONVENTION] the crumb was both `aria-live` and the focus target (announced
  twice), and a comment called a heading a landmark --> FIXED
- [NIT] `pjBrowse` had no generation guard while both siblings do; the
  socket-scope caveat on `tmuxSaidNoServer` --> FIXED

### Deferred

| # | Finding | Reasoning |
|---|---------|-----------|
| 1 | macOS `realpath` does not canonicalise case, so a valid in-home path can 403 | Fails CLOSED (a false refusal, never an escape), unreachable from the UI, and case-folding a path comparison is exactly the loosening that turns a containment check into a hole. Recorded in the code as a known false refusal. |
| 2 | `folderState().real` is not what is shown on screen or written into instruction files | The stored path is what the person typed or picked and will recognise. Swapping to the resolved path is a product decision about what a project IS, not a passing correction. The docstring claiming otherwise was the defect, and it is fixed. |

### Verification

- **469 tests green** (`node --test engine/*.test.js *.test.js`), up from 444.
- **Every fix in iterations 8-11 that could be mutation-tested was**: the fix was
  reverted, the new test confirmed failing, and the fix restored. Three of them
  failed that check on the first attempt and were rewritten — recorded above
  rather than quietly corrected.
- **Browser check**: 8 states, light and dark, WCAG AA contrast (now including
  the bad-folder rule, which was never actually measured before iteration 10), a
  keyboard-focus assertion, and no console errors on any state.

### Why it is being stopped un-converged

Three reasons, in order of weight:

1. **The class it was re-run for is closed.** Rounds 5-7 kept finding one class:
   fixtures measuring a world the producers do not produce. Since the shared
   fixture landed in iteration 8, that class has not recurred once at the seam.
   That was the orchestrator's stop-condition and it is answered.
2. **The remaining findings are a different, self-limiting shape** — each round's
   worst defect lives inside the previous round's fix. That is worth naming
   loudly (it is in the commits, and it is why the browser check now asserts
   focus), but it converges by review of the fixes, which a PR gives.
3. **Context ceiling.** Continuing would mean a degraded pass, and the standing
   instruction on this branch is that a still-finding loop deserves fresh-context
   rigour rather than a tired push.

**What that means for the reviewer:** treat the newest code as the least proven,
and look hardest at the fixes from the last two rounds, because that is where
every recent defect has been.

### Strengths (across all iterations)

- `test-support/fleet.js` turns a whole class of fixture defect into a throw
  rather than a convention: production code reading a field off a fixture that
  the producer does not emit now fails the test on the spot, naming the producer.
  Reverting the iteration-6 fix fails 7 tests instantly; that defect had survived
  six rounds of independent review.
- The 25-shape matrix over the managed-block writer asserts invariants (no user
  word lost, no growth, replaced-or-refused) rather than expected output, which
  is why it retired a bug that had been fixed wrong three times.
- `/api/folders` asserts containment only on the `realpath`-resolved path, and
  the tests attack it rather than describe it: symlink-out-of-home, null byte,
  `..archive`, absolute-outside, and home itself behind a symlink.
- Every projects route survives a corrupt store with an honest 500 rather than
  `{projects: []}`, proven with a round trip showing the server still serving.
- Controls lead the assertions throughout: presence before absence, the tied case
  before the untied one, "the fixture really produced this" before "and it says
  the right thing".
