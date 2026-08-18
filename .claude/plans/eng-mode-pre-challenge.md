---
pre_challenge: true
method: challenge-loop
branch: eng-mode
diff_hash: c471e6ef7314f92690fb682c4797c20999452cc542e8f1116be6904c9bf4a1a7
subdir_audit: passed
timestamp: 2026-08-18T20:48:00Z
iterations: 8
converged: true
---

# Challenge Loop Proof: eng-mode

Eight blind passes; 7 and 8 were the consecutive blocker-free pair.
Every finding fixed or recorded; the full pass-by-pass trail is in
.claude/plans/eng-mode-20260818.md. The condensed ledger:

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | [BLOCKER] | Two send-verdict pointers read the stale inner half of a visibility fact that had split ("Its screen is below" over no screen) | FIXED (one derivation, pjScreenOnScreen) |
| 2 | 1 | [WARNING] x3 + [NIT] x3 | render-thread redding on the new default; agent-B-shows-A's-window; the static affirmative hint; teach line in the no-capture state; weak 3c assertions; missing second-surface proof; ENG epoch | FIXED |
| 3 | 2 | [BLOCKER] | Narrated coverage that did not exist (the teaching-line assertions) | FIXED (driven in render-thread, both modes) |
| 4 | 2 | [WARNING] x2 | The learned flag not applied by every refresher; the tick/open interleave | FIXED (refreshEngMode applies; open-in-flight counter) |
| 5 | 3 | [BLOCKER] x2 | The catch branch that forgot the hint; a second narrated-but-absent assertion (the Off verdict arm) | FIXED (catch mirrors whole; the Off arm driven via the ambiguous-send fixture) |
| 6 | 3 | [WARNING] | The capture gated as chrome would have blinded the needs-you question | FIXED (capture always runs; only the SERVING gates, pinned by the question-still-flows control) |
| 7 | 4 | [WARNING] | The window route's Off arm deletable-green | FIXED (pinned before the test's own flip) |
| 8 | 5 | [BLOCKER] | The window box ran before the tied gate (the recorded new-sibling lesson recurring) | FIXED (the paint sits behind the same gate as loadInstructions) |
| 9 | 6 | [BLOCKER] | The tie frozen at open time; the pass-5 sentence rebuilt through the tick | FIXED (fresh-card re-check every poll; untied arm driven via rook) |
| 10 | 7 | [WARNING] | In-flight paints surviving the hide; 404 rendered as a sentence | FIXED (hide arms bump the epoch; 404 is a hide) |
| 11 | 8 | [CONVENTION] + [NIT] x2 | Second find() for one card; the inverse hint assertion; the lost-contact composer (inherited) | FIXED / FIXED / RECORDED |

## Final state

Suite 881/881 plus shell checks; validation-log clean; render-projects
(including 3c on both surfaces) and render-thread (both modes, the
driven Off verdict arm, the rook untied panel) fully green; the
capture/serving split pinned from both sides.
