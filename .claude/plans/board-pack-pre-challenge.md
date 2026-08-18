---
pre_challenge: true
method: challenge-loop
branch: board-pack
diff_hash: d0ed4c9f1cf6d9ca4114349f8875d517d9b15b478955594f987ec55cad1ce367
subdir_audit: passed
timestamp: 2026-08-18T03:14:07Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (rounds 1-6 before the 2026-08-17 account-move restart, rounds 7-13 after; the round in flight at the restart was discarded and respawned blind)
**Converged:** Yes (round 13: zero blockers, zero warnings, zero conventions)
**Total findings:** 40 actionable (2 BLOCKER-class in round 1, 13 WARNINGs, 4 CONVENTIONs, ~21 NITs) plus strengths
**Fixed:** 28 | **Deferred with recorded reasons:** 12 (every deferral matches a plan ruling or carries its reason below)

Every fix since the restart was mutation-proven: the fix was reverted, its
test failed, the tree was restored (commits 0afc7d1, 38a4d9c, 6812d12,
d13660c, b1ec4bf, b623645). Suite grew 815 -> 821, all green at HEAD; the
canonical validation helper passed for this exact diff hash and the
subdir-CLAUDE.md audit is clean.

### Per-Iteration Breakdown

#### Iterations 1-6 (pre-restart; full detail in the plan's round records)
- [BLOCKER] web/index.html — burger dead below tablet width (CSS owned visibility) --> FIXED (round 1)
- [BLOCKER] web/index.html — summary leaked onto other tabs on the poll --> FIXED (round 1, two-sided tab-gate test)
- [WARNING] keyboard path into agent detail missing; the name became the button --> FIXED (round 1)
- [WARNING] dark-mode regressions on body-ground furniture --> FIXED (rounds 1, 5: the dark block moved BELOW the rules it overrides, cascade order was defeating it)
- [WARNING] focus fallback could land on an invisible element --> FIXED (rounds 2, 4: renderability checks + the burger middle rung)
- [WARNING] 8d drive re-anchor false-failing --> FIXED (round 3, probe-verified)
- [WARNING] .removed-row second consumer emitted the old grammar --> FIXED (round 6)
- [CONVENTION] renderer-grammar pins moved onto real fleet cards --> FIXED (round 3)
- 1320px stage cap, drive cleanup ordering, .linkish 24px floor duplication, burger open-state X --> FIXED (rounds 4-6)

#### Iteration 7 (the respawned confirmation round)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] web/index.html:3271 — choosing a tab from the open burger menu display:none'd the element under focus, dropping the keyboard to body (the Escape path guarded, the common path did not) --> FIXED (0afc7d1)
- [WARNING] web/index.html:1396 — menu precedes its trigger in the DOM; no forward keyboard path --> FIXED for the cost (focus into the first tab on open), DOM order itself DEFERRED per plan round-3 ruling (surfaced to the pack owner)
- [WARNING] web/index.html:3190 — failed poll left the four stat tiles asserting last-success counts beside "we cannot see them" --> FIXED (blank to "?", alert tile hides; red reserved for known alarms)
- [WARNING] server.test.js — tick-level wiring (tile writes, burger behavior) computed in code nothing drove --> FIXED (three slice-and-drive tests, all mutation-proven)
- [NIT] LAYOUTS.swap dead map, 80/60 threshold duplication, unused data-count hooks — recorded (all later actioned in rounds 9/12)

#### Iteration 8
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] web/index.html:3204 — the tile blanking stopped short of #summary: last-tick residual claims survived beside the failure card (the fix is the least proven code) --> FIXED (38a4d9c, seeded-then-blanked test)
- [WARNING] web/index.html:531 — gold tab underline ~2.1:1 vs the 3:1 non-text floor --> DEFERRED: pack-verbatim, recorded in the plan as surfaced to Mona Lisa for a pack ruling
- [CONVENTION] engine/roles.js rider on a UI branch --> DEFERRED: plan's "Rider of record" section records the choice
- [NIT] clip id unescaped for hostile session names --> FIXED anyway (slug; esc() decodes in the attribute but not the url() reference; driven through the real producer with a seeded collision avatar after the fixture lint correctly rejected a hand-built card)
- [NIT] dead --k-track/--k-knob tokens with an overselling comment --> FIXED; [NIT] styleless stamp class uncommented --> FIXED; [NIT] Escape-over-modal edge --> DEFERRED (marginal reachability, outside-click covers the pointer case)

#### Iteration 9
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] web/index.html — THE CATCH OF THE LOOP: plan decision #4 promised the because sentence to the detail panel when the why-line left the cards, and it had landed NOWHERE (server still shipped the field) --> FIXED (6812d12: d-why on the panel, empty hides, both sides driven)
- [WARNING] engine/roles.js — pm intro contradicted its own ruled bullet ("brief the other agents" vs "you do not brief other agents yourself") --> FIXED (intro reconciled; ruled bullet and caution untouched, their pin unmodified)
- [CONVENTION] server.test.js — two inserted pins orphaned the tie-gate comment from its pin --> FIXED (reordered, retired label named)
- [NIT] four hand-written 80/60 thresholds --> FIXED (one memBand; list-side boundaries pinned 79/80/59)
- [NIT] dark dashed add-border near-invisible --> FIXED; [NIT] tokens figure gone with decision #4 --> DEFERRED (plan-recorded, pair-flagged); [NIT] toast-drive #new-agent pin --> DEFERRED (plan round-4 record)

#### Iteration 10
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION (duplicate of the recorded rider), 5 NITs
- [NIT] modelLine comment claimed the opposite of what the prefix does on a second provider --> FIXED (must-change marker)
- [NIT] card label raw vs lrow esc() inconsistency --> FIXED (same esc both sides)
- [NIT] .boardbar class "dead" --> REFUTED: docs/browser-checks/render-projects.js selects it (lines 822-823); kept, recorded
- [NIT] working/idle client-side derivation --> DEFERRED (agrees today, both read the same array, filters pinned)
- Plus, from Mona Lisa's channel check (the removal pattern, second instance): the machine-name disclosure was KEPT in code but unpinned — a quiet revert would have passed the whole suite --> FIXED (d13660c: both-sides pin on the d-meta line). A removal is two changes, and only one of them is visible where you made it.

#### Iteration 11
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (gold underline, independent re-confirmation of the recorded deferral), 4 NITs
- [WARNING] web/index.html:479 — .ansgo Answer control lost the 24px SC 2.5.8 floor its predecessor carried; it is the ONE card control whose function nothing else duplicates, so the undersized-target exceptions do not apply --> FIXED (b1ec4bf: floor restored, underline moved to an inner span, source-pinned beside the gold pin, pin mutation-proven both directions)
- [NIT] detail meta line raw modelName vs the shared derivation --> FIXED (routes through modelLine; divergence and Unknown-Model cases pinned with the REAL extracted modelLine, not a stub)
- [NIT] hot on stopped cards --> DEFERRED AS A DECISION with its comment: a tied stopped pane still reads its own transcript, the figure is real (the memory the session would resume into); heat rides the figure, not the process
- [NIT] toast-drive pin, rider visibility --> carried (recorded deferrals)

#### Iteration 12
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 8 NITs
- [WARNING] web/index.html — context.percent interpolated raw into markup (membadge text, bar width style, ring aria-label); numeric today, but the branch's own for-the-day-upstream-changes posture applies --> FIXED (b623645: one pctOf coercion, Number.isFinite else the honest unknown, feeding boardMods/card/lrow/ring; spoofed string percent pinned to render as unknown)
- [CONVENTION] plan's decision record stopped at round 6 --> FIXED (rounds 7-11 appended; the plan is the decision record)
- [NIT] unknown note gated on the state spelling, not the treatment --> FIXED (m.st gate; perturbed 'martian' state pinned to carry the note)
- [NIT] swap posing as a map, ?lim comment, uncommented data-count hooks --> FIXED
- [NIT] tiles mixed count sources; d-why staleness while the panel sits open; burger focusout-close --> DEFERRED with reasons in the plan's round-12 record

#### Iteration 13 (confirmation)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 7 NITs (all either matching recorded deferrals, pack-ruling items, or recorded below)
**Converged** — no new actionable findings.

### Final Ledger (tonight's rounds; pre-restart ledger in the plan's round records)

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 7 | WARNING | web/index.html:3271 | choose-path focus drop to body | FIXED | 0afc7d1 |
| 2 | 7 | WARNING | web/index.html:1396 | no forward path into menu (DOM order) | FIXED/DEFERRED | 0afc7d1; DOM order to pack |
| 3 | 7 | WARNING | web/index.html:3190 | stale tiles on failed poll | FIXED | 0afc7d1 |
| 4 | 7 | WARNING | server.test.js | tile/burger wiring undriven | FIXED | 0afc7d1 |
| 5 | 8 | WARNING | web/index.html:3204 | residual summary survives failure | FIXED | 38a4d9c |
| 6 | 8 | WARNING | web/index.html:531 | gold underline 2.1:1 | DEFERRED | pack ruling w/ Mona Lisa |
| 7 | 8 | CONVENTION | engine/roles.js | rider on UI branch | DEFERRED | plan rider-of-record |
| 8 | 8 | NIT | web/index.html:2586 | clip id vs hostile session name | FIXED | 38a4d9c (slug) |
| 9 | 9 | WARNING | web/index.html | because sentence landed nowhere | FIXED | 6812d12 |
| 10 | 9 | WARNING | engine/roles.js | pm intro contradicts ruled bullet | FIXED | 6812d12 |
| 11 | 9 | CONVENTION | server.test.js | orphaned tie-gate comment | FIXED | 6812d12 |
| 12 | 9 | NIT | web/index.html | 80/60 encoded four times | FIXED | 6812d12 (memBand) |
| 13 | 10 | NIT | web/index.html | machine-name disclosure unpinned | FIXED | d13660c |
| 14 | 11 | WARNING | web/index.html:479 | .ansgo lost the 24px floor | FIXED | b1ec4bf |
| 15 | 11 | NIT | web/index.html | d-meta raw modelName | FIXED | b1ec4bf |
| 16 | 11 | NIT | web/index.html | hot on stopped cards | DEFERRED | decision recorded in-source |
| 17 | 12 | WARNING | web/index.html | percent raw in markup | FIXED | b623645 (pctOf) |
| 18 | 12 | CONVENTION | plan file | record stopped at round 6 | FIXED | b623645 |
| 19 | 12 | NIT | web/index.html | unknown note gated on spelling | FIXED | b623645 |
| 20 | 12 | NIT | web/index.html | tiles mix count sources | DEFERRED | plan round-12 reasons |
| 21 | 12 | NIT | web/index.html | d-why staleness, panel open | DEFERRED | matches d-state model |
| 22 | 12 | NIT | web/index.html | burger focusout-close | DEFERRED | plan round-12 reasons |

### NITs recorded at convergence (round 13, non-blocking)
- pctOf rejects non-numbers but does not clamp finite out-of-range values (105 renders "105%"); server-computed today, a clamp belongs in the same coercion on a future touch
- Stale aria-expanded on the burger if the viewport widens while open (self-consistent on re-narrow; a matchMedia listener would tidy it)
- membadge double-announcement beside the ring's aria-label (aria-hidden on the badge would single-source it)
- Light-mode .stat.action dashed border ~1.9:1 — pack-verbatim; belongs on the same pack-ruling list as the gold underline
- render-projects.js key still named aslist for the hidden-flip mechanism it now witnesses
- render-update-toast.js pins still measure #new-agent (plan round-4 deferral, carried so it survives to the next drive touch)

### The removal pattern (recorded at Mona Lisa's request)
Twice on this one branch, "remove it from the card, the fact reappears
elsewhere" half-failed silently: the because sentence (promise unkept in
code, caught round 9) and the machine-name disclosure (promise kept in
code, unprotected by tests, caught by her channel check after round 10).
A removal is two changes and only one of them is visible where you made
it — the landing site needs its own pin, in the same commit as the
removal.

### Strengths (across iterations, as reported by the blind reviewers)
- One shared derivation set (cardStOf/taskLine/modelLine/roleLine/answerBtn/memBand/pctOf) feeds card, list row, and detail panel; thresholds pinned at their boundaries on both views
- Failure honesty end to end: failure card in both containers, tiles blank to "?", alert tile hides, residual summary clears — each driven by a seeded presence-before-absence test
- Extraction-harness tests guard their own extraction (slice-anchor assertions), controls aim at real failure modes, hostile fixtures go through the real producer
- Keyboard continuity through a full visual rebuild: name-as-button, three-rung visible focus fallback, driven burger focus paths with a wide-screen control
- Deviations from the pack are decisions of record, never silent drift
