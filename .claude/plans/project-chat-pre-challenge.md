---
pre_challenge: true
method: challenge-loop
branch: project-chat
diff_hash: 19b80186f9c5efd888f4c50d6f7968a1a980c6abedfb4151e28c376fa9b5bdbf
subdir_audit: passed
timestamp: 2026-08-14T23:03:05Z
iterations: 40
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 40
**Converged:** No (stopped at the 40-iteration safety valve; surfaced to Josh
in the Kosmos channel 2026-08-14 ~17:45 CT with a stop-and-ship
recommendation per his standing no-endless-iterations directive; every
round-40 finding was fixed and perturb-verified before this file was written)
**Total findings:** 150+ across 40 blind rounds (every round's BLOCKERs and
WARNINGs fixed or deferred-with-reasoning in that same round; each fix
committed as `project-chat -- address challenge-loop iteration N findings`
and mutation-verified by re-planting the reviewer's exact defect)
**Fixed:** all but the recorded deferrals | **Deferred:** 2 standing
(the ~15s worst-case synchronous send, documented in `pauseMs`'s docblock
as a deliberate cost of the codebase's synchronous design; and the
unreadable-vs-absent profile read, recorded as a known limit at
`engine/status.js` readIdentity with the reasoning in place)

### Process note (honest scope of this document)

A context compaction occurred between iterations 36 and 37 of this loop.
Iterations 37-40 below are recorded from the live ledger; iterations 1-36
are summarized from the durable records they left behind: one
`address challenge-loop iteration N findings` commit per round (git log),
the per-round design rationale written into code comments (`round N`
markers throughout `engine/chat.js`, `server.js`, `web/index.html`,
`docs/browser-checks/*`), and the plan file
`.claude/plans/project-chat-20260814T0612Z.md`, which cites the defining
finding of most rounds in place. No pre-compaction finding text is
reconstructed from memory here; the pointers are the record.

### Per-Iteration Breakdown

#### Iterations 1-36 (summarized; one commit each, see git log)
Defining findings, as recorded in the code's own round-marked comments:
- [BLOCKER] engine/chat.js — a dry-run seam that could type into live
  agents' sessions from tests --> FIXED (DRY_RUN getter + fixture asserts,
  rounds 2-4)
- [BLOCKER] engine/chat.js wireText — a message of exactly `;` typed
  nothing while Enter still fired into a live composer --> FIXED (measured
  eight-row tmux round-trip table)
- [BLOCKER] web/index.html — programmatic box clears deleted the person's
  only copy of unsent words --> FIXED (never-delete rules, rounds 29/33/34)
- [WARNING] classes: cross-project misattribution on the painted path
  (openProject switching-clear, round 22), recipient-picker drift (round
  32), sent-line restatement by the poll (PJ_SENT_LINE render functions),
  three-state delivery vocabulary enforcement, thread lock
  steal-by-rename + owner token, TAIL bound on the GET (round 36)
- Full list: `git log --reverse main..HEAD` and the `round N` comments at
  each site.

#### Iteration 37 (commit e91a2f2)
**New findings:** 0 BLOCKERs, 8 WARNINGs, 3 CONVENTIONs, 2 NITs
- [WARNING] web/index.html:4875 — send verdict could land on a DIFFERENT
  project's thread after mid-flight navigation --> FIXED (PJ_NAV_GEN flight
  gate; perturb red via source pin)
- [WARNING] server.js:1310 — unrelated instructions save reverted a
  profile-route rename --> FIXED (line-changed keying; new route test red
  on the mutant)
- [WARNING] engine/chat.test.js:313 — dry-run re-arm test could not fail
  from its named hazard --> FIXED (asserts chat.DRY_RUN + refusal wording;
  perturb red)
- [WARNING] engine/create.test.js:175 — load-bearing name-split assertion
  was a tautology --> FIXED (candidate-pinned; safeKey-style mutant red)
- [WARNING] server.test.js:36 — AGENT_WORKFORCE_PROJECTS and HOME
  unsandboxed --> FIXED
- [WARNING] server.js:1430/1648/1828 — blocked arm and thread-verb decode
  arms had no route-level tests --> FIXED (tests added, mutants red)
- [WARNING] server.js:1307/1163 — 80-char display-name caps and no-record
  precondition untested --> FIXED (both writers, both perturbs red)
- [WARNING] engine/chat.js:202 — a send can hold the single-threaded board
  ~15s worst-case --> DEFERRED: deliberate synchronous design, documented
  in pauseMs docblock; surfaced in the PR body
- [CONVENTION] strict assert + hardened null assertions + corrupt-store
  status pinned to exactly 500 --> FIXED
- Also self-found this round: `.pj-member small` AA contrast failure
  (3.04:1) caught by re-running render-projects --> FIXED to --label-2

#### Iteration 38 (commit 21eadff)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs
- [WARNING] web/index.html:4885 — box clear over-gated: leave-and-return
  left delivered words armed for a duplicate send --> FIXED (project-only
  term; pin red on the revert)
- [WARNING] server.js:1909 — POST thread response carried the whole ~2MB
  thread in a field nothing read --> FIXED (dropped; shape test red on
  reintroduction)
- [NIT] picker-disable comment described a term the code lacks --> FIXED
- [NIT] VERIFY_FORMAT was a require-time constant --> FIXED (live getter,
  DRY_RUN's contract)

#### Iteration 39 (commit de5a23c)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 NIT
- [WARNING] web/index.html:2407/5434 — in-place aria-checked flip fought
  setLive's stored string; next poll destroyed the focused control -->
  FIXED (addAgentsHtml builder + __lastLive refresh; pin red)
- [WARNING] web/index.html:4289/4903 — page branched on bare delivery
  literals with no pact to chat.DELIVERY --> FIXED (two-sided literal
  pact; mutant red)
- [WARNING] web/index.html:4776 — transport branch returned before the
  finally, stranding keyboard focus --> FIXED (own rescue; pin red)
- [WARNING] server.js:1302 — rename-follow could fire from an unreadable
  pre-state (double-read race) --> FIXED (hadIdentityText from write's own
  single read; mutant red)
- [NIT] could_not paneNote asymmetry --> documented as deliberate

#### Iteration 40 (commits e1fa111, 407e77e) — the cap round
**New findings:** 1 BLOCKER, 8 WARNINGs, 1 CONVENTION, 8 NITs
- [BLOCKER] server.js:1337 — unguarded writeProfile after a committed save
  could answer 400 with a raw errno for a save that landed --> FIXED
  (guarded; new broken-store route test proves 200 + no errno, red with
  the guard removed)
- [WARNING] fixture-discipline.test.js — card-shape tripwires missing
  `role`/`profile` and the chat engine entirely --> FIXED (both pins)
- [WARNING] engine/projects.test.js — chat loaded transitively without
  dry-run armed --> FIXED (belt-and-braces env + strict assert)
- [WARNING] engine/chat.test.js:1745 — frozen Date.now made a lock hang
  unexpirable --> FIXED (10s watchdog mock)
- [WARNING] engine/status.js:1485 — unreadable profile indistinguishable
  from absent --> DEFERRED with recorded reasoning at the site
- [WARNING] render-thread.js — no pageerror capture; unreadable-history
  arm undriven; single viewport; silent 5e skip --> ALL FIXED (new
  sections 5g/5h, two new committed screenshots, else-arm)
- [CONVENTION]/[NITs] — sentence punctuation via pjSentence, symlink-aware
  sandbox guard, failures printed on throw, README verdict spelling,
  expectation un-echoed, inter-test dependency made loud, plutil platform
  guard --> ALL FIXED
- Final state: 733 tests, 0 fail; render-thread and render-projects green
  end-to-end against the sandboxed fixture.

### Final Ledger (rounds 37-40; rounds 1-36 per the process note)

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 37 | WARNING | web/index.html:4875 | cross-project verdict landing | FIXED | e91a2f2 |
| 2 | 37 | WARNING | server.js:1310 | rename-follow reverts profile rename | FIXED | e91a2f2 |
| 3 | 37 | WARNING | engine/chat.test.js:313 | re-arm test unfailable | FIXED | e91a2f2 |
| 4 | 37 | WARNING | engine/create.test.js:175 | tautological name-split pin | FIXED | e91a2f2 |
| 5 | 37 | WARNING | server.test.js:36 | PROJECTS/HOME unsandboxed | FIXED | e91a2f2 |
| 6 | 37 | WARNING | server.js:1430+ | blocked/decode arms untested | FIXED | e91a2f2 |
| 7 | 37 | WARNING | server.js:1307 | 80-char caps unheld | FIXED | e91a2f2 |
| 8 | 37 | WARNING | engine/chat.js:202 | ~15s synchronous send | DEFERRED | documented design cost |
| 9 | 37 | CONVENTION | tests | loose asserts, 500-status | FIXED | e91a2f2 |
| 10 | 38 | WARNING | web/index.html:4885 | over-gated box clear | FIXED | 21eadff |
| 11 | 38 | WARNING | server.js:1909 | unread 2MB POST payload | FIXED | 21eadff |
| 12 | 39 | WARNING | web/index.html:2407 | setLive vs in-place toggle | FIXED | de5a23c |
| 13 | 39 | WARNING | web/index.html:4289 | unpinned delivery literals | FIXED | de5a23c |
| 14 | 39 | WARNING | web/index.html:4776 | stranded focus on transport fail | FIXED | de5a23c |
| 15 | 39 | WARNING | server.js:1302 | rename-follow double-read race | FIXED | de5a23c |
| 16 | 40 | BLOCKER | server.js:1337 | landed save reported failed w/ errno | FIXED | e1fa111+407e77e |
| 17 | 40 | WARNING | fixture-discipline | stale/missing card tripwires | FIXED | e1fa111 |
| 18 | 40 | WARNING | engine/projects.test.js | chat unarmed transitively | FIXED | e1fa111 |
| 19 | 40 | WARNING | engine/chat.test.js:1745 | unexpirable frozen clock | FIXED | e1fa111 |
| 20 | 40 | WARNING | engine/status.js:1485 | unreadable-vs-absent profile | DEFERRED | recorded at site |
| 21 | 40 | WARNING | render-thread.js | 4 harness coverage gaps | FIXED | e1fa111 |
| 22 | 40 | CONVENTION | engine/projects.test.js:28 | loose assert default | FIXED | e1fa111 |

### NITs (non-blocking, rounds 37-40)
- [NIT] plan round-count stale (37) --> fixed; folder-preview spelling
  restated as act-agreement (37) --> fixed; picker comment (38) --> fixed;
  VERIFY_FORMAT constant (38) --> fixed; paneNote asymmetry (39) -->
  documented; pjSentence on could_not rows, symlink guard, failure
  printing, README spelling, expectation echo, inter-test dependency,
  plutil guard (40) --> all fixed.

### Strengths (recurring across reviewers 37-40, each cited independently)
- The three-state delivery model, carried end to end without narrowing,
  with the one checkable fact ("could the words already be in that
  composer?") as the boundary and fixtures that photograph all three.
- verifyAtSend re-asking the pane immediately before the keystroke through
  status's own shape rather than a re-derivation.
- withThreadLock's steal-by-rename with owner token, backed by two real
  child processes and a forced losing interleave.
- The render-thread refusal chain: log-to-port tie, roster comparison,
  sandbox-resolution proof, all before anything destructive.
- CSRF coverage by default on every route including the new thread POST.
