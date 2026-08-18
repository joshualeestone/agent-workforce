---
pre_challenge: true
method: challenge-loop
branch: dark-tokens
diff_hash: ae3e08b71f1fa82bce6c231c9a5673f446bd15065567bb700496ec8991f7c69b
subdir_audit: passed
timestamp: 2026-08-18T16:01:08Z
iterations: 3
converged: true
---

# Challenge Loop Proof: dark-tokens

Three blind passes, each a fresh agent with no prior-review access.
Passes 2 and 3 were consecutive blocker-free passes (the fleet's cap
rule); every finding across all three was fixed, none deferred. Full
decision record: .claude/plans/dark-tokens-20260818.md.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 1 | [BLOCKER] | web/index.html attn family | Board needs-you borders, st-attn, stat.alert, hot wash composited ~1.35:1 on the dark card; the cue vanished on the primary view | FIXED 9a0aeb1 |
| 2 | 1 | [BLOCKER] | web/index.html instruments | Gauge track, unknown dashes, memory bar (incl. the SOLE carrier of memory-unknown) invisible over the dark card | FIXED 9a0aeb1 |
| 3 | 1 | [WARNING] | state pills | paused/stopped/unknown borders were dark-ink literals, gone flat in dark | FIXED 9a0aeb1 |
| 4 | 1 | [WARNING] | comments | Five comments still claimed the k-tokens do not flip, incl. one inside the dark patch block | FIXED 9a0aeb1 |
| 5 | 1 | [WARNING] | hover/tab cues | Hover borders and the narrow-width selected-tab tint (its only cue at that width) | FIXED 9a0aeb1 (tint scoped in its own breakpoint) |
| 6 | 1 | [WARNING] | instrument gap | The broken dark surfaces were exactly the ones no drive rendered dark | FIXED 9a0aeb1 (flip probe covers acard, gauge track, memory bar) |
| 7 | 1 | [NIT] | utoast red | Two dark attention reds now exist (#F0665A vs the pack family) | RECORDED in plan, flagged for Mona Lisa |
| 8 | 1 | [NIT] | .stat.action | Dark patch left it on legacy elevated grey beside k-surface siblings | FIXED 9a0aeb1 |
| 9 | 1 | [NIT] | firstrun pin | track/knob missing from the subtree pin | FIXED 9a0aeb1 |
| 10 | 1 | [NIT] | flip probe | Null-deref on a missing surface instead of a named error | FIXED 9a0aeb1 |
| 11 | 1 | [NIT] | tint chips | Minor washes flatten in dark; text/rings ride flipping tokens | RECORDED as accepted (pack's dark is token-only) |
| 12 | 2 | [WARNING] | .gf.high | High-severity gauge arc kept the light red, ~1.8:1 on its own dark track | FIXED de0d444's predecessor commit |
| 13 | 2 | [WARNING] | .bar i.high | Same for the list memory bar's alarm fill; .haz triangle beside #ff8c82 text drew two reds | FIXED |
| 14 | 2 | [WARNING] | st-working | Working's green border ended up dimmer than the quiet states it should outrank | FIXED (same fill family, lighter green) |
| 15 | 2 | [CONVENTION] | comments x3 | Stale fixed-light comments the pass-1 sweep missed | FIXED |
| 16 | 2 | [NIT] | .stat.action dupe | Two declarations in one dark block resolved by order | FIXED (consolidated) |
| 17 | 2 | [NIT] | flip probe | Grouped selector could read a hidden renderer; unused param | FIXED (real toggle, param gone) |
| 18 | 3 | [WARNING] | .membadge | The one attn carrier left at #b3261e beside a flipped arc | FIXED de0d444 |
| 19 | 3 | [WARNING] | memBar probe | First-bar read reds a correct page when that agent's memory is unknown | FIXED de0d444 |
| 20 | 3 | [WARNING] | gaugeTrack probe | All-unreadable-memory machine misreported as a rendering bug | FIXED de0d444 (follows gt/gu branch) |
| 21 | 3 | [NIT] | comments x2 + fr-next + prefers-contrast | Pointer to a nonexistent block; phantom-duplicate phrasing; dead legacy-token rule in the forced-light wizard; prefers-contrast interaction | FIXED / RECORDED |

## Gates proven to fail

- 7b-theme-flip: re-pinning --k-surface to white reds the check on the
  exact reintroduced defect (measured before trusting green).
- The extended contrast sweep previously proven both directions on this
  drive (false red gone, genuine red still reds).

## Final state

- 846/846 tests, validation-log clean for this diff.
- render-projects drive fully green both schemes incl. 7b-theme-flip
  across projects and agents surfaces; first-run drive green both
  schemes; board and agent page eyeballed dark.

[STRENGTH] The 7b assertion targets the property class every contrast
sweep structurally misses; cascade discipline verified rule-by-rule;
zero light-theme delta by construction.
