---
pre_challenge: true
method: challenge-loop
branch: click-to-connect
diff_hash: 7ccb663f71de1598140a523cef8b096b5fd21065f6b3f5215f2be5e9dc4014e7
subdir_audit: passed
timestamp: 2026-08-13T03:32:09Z
iterations: 29
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 29 (every one a fresh, blind agent; one spawn window lost to API 529s, retried, not counted)
**Converged:** Yes — iteration 29's two WARNINGs deduplicated to DEFERRED ledger entries already
recorded by name in the plan's pass-1 checklist, and its remaining findings were NITs (three fixed
same-iteration, one standing deferral).
**Total findings:** 60 actionable (1 BLOCKER, 40 WARNINGs, 2 CONVENTIONs, 17 counted NITs) plus
standing NIT-family repeats.
**Fixed:** 52 | **Deferred:** 8 (each with reasoning; the deferrals that matter are exported to the
plan's pass-1 walkthrough checklist so they cannot silently vanish)

**Validation at convergence:** 581/581 `node --test`; 39/39 rendered browser checks (light+dark,
AA, geometry-measured); sandboxed live check green (real 281MB download checksum-verified, real
`claude install`, real CLI driven to the paste prompt, cancel clean, zero credentials created).
This repo has no org yarn/TS validation stack (zero-dependency by design; deviation recorded in
the plan); the subdir-CLAUDE.md audit passed (exit 0).

### Per-Iteration Breakdown (what each fresh pass caught)

#### Iteration 1 — 1 BLOCKER, 4 WARNINGs, 2 NITs
- [BLOCKER] engine/connect.js — rejected sign-in code was a dead end: phase stuck at completing
  forever, corrected code refused, acted-guard never reset --> FIXED (rejection arm + reason
  carried + test)
- [WARNING] send-keys lacked `--` terminator; dash-leading code read as tmux flags; result
  unchecked --> FIXED (+ test)
- [WARNING] cancel/stuck write races on three async paths --> FIXED (becomeStuck no-ops post-cancel)
- [WARNING] REPL-with-unreadable-subscription looped forever --> FIXED (bounded honest exit + test)
- [WARNING] stale stuck record painted over a connected verdict --> FIXED (+ browser check)
- [NIT] per-chunk state writes --> FIXED (throttle); [NIT] 281MB binaries accumulate --> FIXED

#### Iteration 2 — 3 WARNINGs, 3 NITs
- [WARNING] cancel could not abort metadata fetches or the install child; binary survived late
  cancel --> FIXED (request tracking, cancellable child, unlink windows)
- [WARNING] any-phase login-evidence arm unpinned --> FIXED (test that fails on revert)
- [WARNING] idle-from-elsewhere froze a second tab's watcher --> FIXED
- [NIT] tautological keyboard check --> FIXED (focus-arrives + Tab-leaves); [NIT] classifier order
  vs comment --> FIXED; [NIT] https→http redirect downgrade --> FIXED (pure rule + wiring control)

#### Iteration 3 — 1 BLOCKER-class WARNING set
- [WARNING] tmux prefix-resolution hazard: unpinned `-t` targets could land on an agent named
  kosmos-connect2 --> FIXED (`=` pins + name reserved in create.js + seam audit test)
- [WARNING] driver-existence guards could not distinguish cancelled from replaced --> FIXED
  (owner-identity model everywhere + gated-race tests)
- [WARNING] permanently blank pane never escalated --> FIXED (bounded; the fix itself had a
  reset-on-every-tick defect caught by the test timing out, then fixed)
- [WARNING] version string prefix-anchored (path steering) --> FIXED (full anchor + hostile test)
- [NITs] settle/wait counter split; connected announced; transient card documented --> FIXED

#### Iterations 4-8 — 8 WARNINGs, 12 NITs (all FIXED except noted)
- interrupted copy claimed "nothing is running" for phases nobody checked --> FIXED (per-phase truth)
- stuck install stranded the 281MB binary --> FIXED (+ end-to-end test)
- phase-list hand-copy drift --> FIXED (page/engine parity test)
- rejected-code copy when no code was ever typed --> FIXED (two true sentences)
- 400 vs 409 refusals distinguished --> FIXED
- start() lacked the foreign-flow refusal state/cancel carried --> FIXED (+ test)
- **iteration 8's live check caught what no fake could:** the `=` pin broke every real capture
  (tmux needs `=name:` for pane commands) and a review-suggested quoting change measured FALSE
  (multi-arg is argv, not shell) --> FIXED with both measurements recorded at the site
- walk-forward Enter keyed on the wrong classification and never fired --> FIXED (+ test)

#### Iterations 9-14 — 9 WARNINGs, 15 NITs (all FIXED except standing deferrals)
- submitCode foreign-flow refusal said a false sentence --> FIXED (true sentence + test)
- startedOnce short-circuit hid foreign flows --> FIXED
- overlapping ticks unbounded --> FIXED (in-flight guard)
- heartbeat added so parked sign-ins stay fresh (then tested); freshness fails closed on missing
  timestamps (tested); pid 0/negative refused; bound tightened to 15 min
- one unguarded post-await write in the code arm --> FIXED (the module's own invariant, one miss)
- stale-flow sweep guard (a fix that introduced a race, caught next pass) --> FIXED
- watcher idle/connected exits, cancel re-adopt on failure, seq guards both paths --> FIXED
- already-connected start now kills an orphaned session --> FIXED
- tick-error escape valve added; README ALLOWED_HOSTS blast radius widened --> FIXED

#### Iterations 15-22 — 10 WARNINGs, 14 NITs (all FIXED except standing deferrals)
- press-enter added to the wedge bound; login-evidence restricted to login-done/repl
- cancel-mid-download finally driven end-to-end against a dripping fixture server (test)
- paint key carries `because`; late-arriving URL gets a targeted in-place updater (+ tests)
- watcher failure bound ("we cannot see the connection attempt"); off-step poll stops itself
- decimal MB labels; single-vs-persistent capture failure distinguished (+ test)
- **iteration 22's race:** browser-open arm could walk the phase BACKWARDS off a partial redraw,
  ending in an accepted-but-never-typed code livelock --> FIXED (directional transitions + test)

#### Iterations 23-28 — 7 WARNINGs, 2 CONVENTIONs, 8 NITs
- half-installed binary passed X_OK forever --> FIXED (--version probe + broken-binary test)
- engine-crash route fallback answered `stuck` (a settled sentence) --> FIXED (`unsure`)
- start's probe await opened a double-claim window --> FIXED (re-check before claim)
- finishConnected wrote after an await unguarded --> FIXED (identity + record-identity guard)
- production single-arg tmux launch went through a shell while only multi-arg was live-verified
  --> FIXED (unconditional `env` prefix; form probed live)
- watcher had no failure bound for the `unsure` phase --> FIXED (settle handoff)
- animated ask-for-Enter screens had no keypress bound --> FIXED (per-kind action cap)
- interrupted copy for `installing` overclaimed (child may outlive server) --> FIXED
- cancel-refusal now says why the button did nothing --> FIXED
- stale committed screenshot --> FIXED (re-captured; all shots committed)

#### Iteration 29 — CONVERGED
- Both WARNINGs deduplicated to DEFERRED entries recorded by name in the plan's pass-1 checklist
  (rejection-timing measurement; SCREEN_LOGIN_DONE re-capture). Three NITs fixed same-iteration
  (classifier press-enter ordering, double-Enter guard, indentation); one cosmetic NIT joined the
  standing deferrals. Zero new actionable findings.

### Deferred (with reasoning, all recorded at decision sites or in the plan)

| # | Finding | Reasoning |
|---|---------|-----------|
| D1 | SCREEN_LOGIN_DONE is synthesized | Fixture discipline forbids inventing captures; completion never depends on its text; pass-1 checklist orders the re-capture |
| D2 | Code-rejection ~6s timing unmeasured vs real CLI | Only measurable in a real login; pass-1 checklist orders the measurement |
| D3 | cancel-kills-install (activeChild) untestable | The dry-run interlock deliberately forbids tests executing real children; manual pass-1 exercise specified |
| D4 | 1GB download bound untested | A >1GB fixture is not a test; same pass-1 note |
| D5 | URL continuation heuristic tuned to the measured screen | Tightening breaks reassembly of the REAL capture (its continuation line is one character) |
| D6 | own-pid recycled record renders idle not interrupted | Requires exact pid collision across reboots; benign direction; next click self-heals |
| D7 | write-side two-server locking | Deployment shape is one server per user (launchd); failure mode is an honest named stuck, never corruption; residuals documented at sites |
| D8 | outage-row action buttons cosmetics | Buttons remain honest via cancel's failure path |

### NITs (non-blocking, fixed unless noted)
Progress-write throttle, binary cleanup, decimal MB, aria progressbar semantics, paired test
seams (warn silenced by fixing the cause), owner-spelling normalization, dead catch removed,
publicView on every exit, single-read foreign checks, everSaw-honest blank sentence.

### Strengths (recurring across independent reviewers)
- Checksum-before-execute with anchored version, downgrade-refused redirects (wiring-controlled),
  size caps, arg-array exec everywhere.
- Owner-identity teardown across every await, with gated-race tests that fail on revert.
- Two-spelling exact-match tmux pins, seam-audited; name reservation with near-name control.
- Captured-fixture discipline; hostile-input tests through the real page painter; geometry-measured
  rendered checks; the said-it-twice check born from a screenshot.
- Three-answers rule carried to every dead end, with the unproven final OAuth hop stated in the
  README, the plan, and the docs rather than left to look covered.
