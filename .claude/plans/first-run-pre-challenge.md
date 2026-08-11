---
pre_challenge: true
method: challenge-loop
branch: first-run
diff_hash: fb7dd454ef79ed09446e741430df9ce4569c8b3531bff2d90704d777e315a317
subdir_audit: passed
timestamp: 2026-08-11T22:04:55Z
iterations: 6
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** No. Stopped at iteration 6 on a deliberate call (see below).
**Total findings:** 47 actionable (2 BLOCKERs, 32 WARNINGs, 4 CONVENTIONs, 9 NITs carried)
**Fixed:** 46 | **Deferred:** 1

### Why this stopped at 6 without converging, said plainly

Every iteration found real defects, so this did not go quiet. The stop is a
judgment call, not a convergence claim, and recording it as convergence would be
the same species of untruth the whole branch is written against.

What the curve actually looked like: iterations 1-4 found substantial defects in
the product. Iterations 5 and 6 shifted markedly toward **findings about the
tests** rather than the code — iteration 6's two headline items were both
assertions that could not fail, each proven vacuous by the reviewer actually
running the mutation. That shift is the honest signal available: the product
surface is holding up, and what is still being found is the scaffolding.

Against that: first run is functionally complete, browser-verified in both
colour schemes, 406 tests green, and the next two items on the launch list
(install, then Projects) are launch-blocking with a room of thirty people at the
other end. Splinter (PM) called it — "six blind passes on a functionally-complete,
browser-verified feature is past convergence; the marginal find isn't worth the
delay." I agree with the trade and it is recorded here rather than dressed up.

### The one thing that did not get fixed

`pmset -g custom` also prints a `UPS Power:` section on a machine with a UPS
attached, and `parsePmset` ignores it. **DEFERRED**, with reasoning: that section
governs only while the machine is running off UPS battery during a power cut, at
which point it is minutes from shutdown regardless; and there is no fixture for
it on this hardware, so building the branch would mean guessing at the shape —
which the laptop fixture's own header says is how a test ends up pinning the
author's idea of a machine instead of a machine.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 0 BLOCKERs, 9 WARNINGs, 1 CONVENTION, 5 NITs
- [CONVENTION] `.claude/plans/` — no plan file for this branch --> FIXED (03677f9)
- [WARNING] `engine/machine.js` — the `unknown` arm of the install check was **unreachable code**: `fs.existsSync` never throws, so an unreadable parent directory rendered as the flat claim "Claude Code is not where we expected it". Cannot-see as a checked negative, in the module whose header forbids exactly that --> FIXED (d3cb89b)
- [WARNING] `engine/machine.js` — the battery-unreadable branch said "It does not go to sleep while it is plugged in" without having read the AC value --> FIXED
- [WARNING] `engine/machine.js` — `launchctl` failing counted as `attention` rather than `unknown`, putting a cannot-see into the count of things-needing-action, which `check()` separates the counters to prevent --> FIXED
- [WARNING] `engine/machine.js` — the restart pass over-claimed against its own comment --> FIXED
- [WARNING] `web/index.html` — `?fr-step=3.7` hid **every** pane and rendered a titled, buttoned, empty dialog --> FIXED
- [WARNING] `web/index.html` — `frFinish` re-entrancy guarded the primary button only; Skip and Escape both call it, so Escape mid-flight ran two completions and both callbacks --> FIXED
- [WARNING] `web/index.html` — the completion POST had no timeout, so a hang left the documented "way out on every step" unreachable behind an inert page --> FIXED
- [WARNING] `web/index.html` — steps 3 and 4 were announced to nobody (no live region, no focus move). WCAG 4.1.3, AA --> FIXED
- [WARNING] `docs/browser-checks/README.md` — the documented run recipe could not work (`require` resolves from the script's directory) --> FIXED, and the corrected recipe was then run
- NITs: orphaned JSDoc; prototype-chain lookup; stubbed `esc`; uncleared message; no `inert` fallback --> all FIXED

#### Iteration 2
**New:** 1 BLOCKER, 7 WARNINGs, 1 CONVENTION, 5 NITs
- [BLOCKER] `engine/machine.js` — "Your agents are set to start themselves" was **false on the adopt path**: the fleet is counted from `tmux list-panes`, and an agent another program started may have no launchd job at all. Nothing opened a plist or looked at one of them --> FIXED (afb51e4)
- [WARNING] `docs/browser-checks/render-first-run.js` — the all-clear fixture carried copy the engine no longer emits, so the **committed screenshot showed a screen the product cannot produce**. The PR's own visual evidence --> FIXED by deleting the fixture and capturing against the live route
- [WARNING] `web/index.html` — `frPaintSubscription` fell through to the NEGATIVE for any unrecognised state --> FIXED
- [WARNING] `engine/machine.js` — `statSync` succeeds for a directory and for a non-executable file, both reported as "Everything it needs to run is installed" --> FIXED
- [WARNING] `engine/machine.js` — the check and creation still disagreed about which paths are usable at all --> FIXED (`create.unusablePath` shared)
- [WARNING] `engine/machine.js` — the half-read laptop answer dropped the half it had read --> FIXED
- [WARNING] `web/index.html` — `AbortSignal.timeout` unguarded: on Safari < 16 it throws, so the flag is never written and first run reappears **forever** --> FIXED
- [WARNING] `web/index.html` — step 4 promised a working agent over a check screen that may have just contradicted it --> FIXED
- [CONVENTION] `#fr-machine-msg` not announced --> FIXED
- NITs: `FR_FORGOT` outliving its message; asymmetric button reset; heading focus ring reading as a text field --> FIXED

#### Iteration 3
**New:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 6 NITs
- [WARNING] `web/index.html` — `FR_MACHINE === null` collapsed to "checked and fine", and `unknown` rows dropped from the snag list --> FIXED (34b67c1)
- [WARNING] `engine/machine.js` — a definite finding discarded when the *other* probe was unreadable. **The same defect `sleepCheck` documents fixing, in its sibling function** --> FIXED
- [WARNING] `web/index.html` — a late `frRecheck` repainted step 3's buttons onto step 4 --> FIXED
- [WARNING] `web/index.html` — the comment claiming step 2's button was the only one costing a subprocess was false; step 3's ran `tmux list-panes` with no guard --> FIXED
- [WARNING] `server.test.js` — assertion matched against the whole script, so deleting the write from `frFinish` left it green --> FIXED
- NITs: stale-request re-enable; negative sleep values as a pass; `state.done` outside the guard; self-satisfying regex alternation; Shift+Tab dead end; orphaned temp file --> all FIXED

#### Iteration 4
**New:** 0 BLOCKERs, 7 WARNINGs, 4 NITs
- [WARNING] `engine/subscription.js` — an unrecognised plan with no `billingType` rendered as the flat negative, **through the one field the module decided not to depend on** --> FIXED (5229d43)
- [WARNING] `engine/machine.js` — the "report the known half" fix existed for an unreadable battery section and not for an unreadable AC one. Same defect, mirrored, same function --> FIXED
- [WARNING] `web/index.html` — `got` guarded on one line and dereferenced bare five lines later --> FIXED
- [WARNING] `web/index.html` — the `FR_CHECKING` token covered one of the two callers that share `#fr-alt`, while its comment claimed both --> FIXED
- [WARNING] `web/index.html` — **the Tab-wrap trap and the `focusin` backstop, the two newest guards in the diff, had zero coverage of any kind** --> FIXED (browser checks added; see below)
- [WARNING] `engine/machine.js` — a path refused on sight was described as a path we looked at --> FIXED
- [WARNING] `web/index.html` — "so you can always go back and read it" claimed a capability the product does not have --> FIXED
- NITs: shorter sleep interval unsaid; `maxBuffer`; focus dropped to `<body>` on disable --> FIXED

#### Iteration 5
**New:** 1 BLOCKER, 4 WARNINGs, 2 CONVENTIONs, 5 NITs
- [BLOCKER] `web/index.html` — "nothing of it is sent anywhere" is **false**: agents think with Claude, which is the entire reason step 3 exists. A privacy claim, on the first screen, to a non-technical audience. ⚠️ **It arrived as the fix for a milder over-claim in iteration 4** --> FIXED (407da64)
- [WARNING] `engine/machine.js` — `unusable` returned ahead of `missing`, so an absent Claude went unmentioned whenever the tmux path carried a quote. **The third time this function dropped a finding by returning early** --> FIXED structurally: the sentence is now assembled from all three buckets
- [WARNING] `web/index.html` — step 4's first clause was still flat, sitting directly above a note retracting it --> FIXED
- [WARNING] `server.test.js` — the loop's comment claimed every malformed shape lands on "we could not see"; `{path:'adopt'}` rendered "You already have **undefined** agents here" and satisfied every assertion --> FIXED
- [WARNING] `web/index.html` — `fleetCount` interpolated unguarded --> FIXED
- [WARNING] `server.test.js` — no regression pin for the `p.fr-next` fix or the `AbortSignal` guard; neither is catchable by any other layer --> FIXED, both pins mutation-verified
- [CONVENTION] `server.js` — the only new route that **writes** had no server test --> FIXED
- NITs: comment above the wrong block; readable half unsaid; `complete()` over-claiming its read-back; no control on the "clear" screenshot; dead variable --> FIXED

#### Iteration 6 (confirmation pass)
**New:** 0 BLOCKERs, 4 WARNINGs, 3 NITs — and the two headline items are about **tests, not product code**
- [WARNING] `server.test.js` — the "a GET must not write the flag" assertion was vacuous: it never established `done` started false, so if a GET wrote the flag the first GET had already flipped it. ⚠️ **Proven by the reviewer running the mutation** (route changed to write on read: whole file stayed green) --> FIXED, control added, mutation re-run and it now fails
- [WARNING] `engine/subscription.test.js` — the unrecognised-plan test's fixture carried `billingType`, the field the fix stopped depending on, so it reached `unknown` through the older path and the guard was dead weight --> FIXED, second fixture without it
- [WARNING] `engine/subscription.js` — an account naming **no plan at all** asserted the negative from two absent fields. Reachable: an `oauthAccount` with `accountUuid`/`emailAddress`/`organizationUuid` and no profile fields. A signed-in person was shown "Get a subscription at claude.ai, then sign in to Claude on this computer." ⚠️ The no-account-block branch already answered `unknown` for **strictly weaker evidence**, so having an account was treated as more damning than having none --> FIXED
- [WARNING] `web/index.html` — the fetch-failure path did not clear `FR_MACHINE` while its sibling did, so a failed re-check left a stale all-clear for step 4 --> FIXED
- NITs: sentence join; unqualified power source; stale test count --> FIXED

### Verification that is not in `node --test`

`node --test` cannot see the page, and on this branch that is not theoretical.
Two defects were found only by rendering: a CSS rule written `.fr-next` lost to
`.fr-body p` on specificity and **did nothing at all**, and fixing it exposed a
3.04:1 contrast failure that had been invisible for as long as the rule was
inert. Both are now pinned in `server.test.js`, because neither layer that found
them can catch them coming back.

Committed as `docs/browser-checks/` (outside the suite — it needs a browser and
this repo has no dependencies):

- **9 first-run states rendered in light and dark**, each measured for opacity,
  actual coverage (`elementFromPoint`, not CSS), composited-alpha AA contrast,
  horizontal overflow, and focusability. The contrast checker **plants a
  deliberately failing element and refuses to let a clean run count unless it
  catches it** — added after the checker's first version reported nine false
  failures by reading `rgba(0,0,0,0.035)` as opaque black.
- **12 click-through sections**: every step, Back, Skip, Escape, the hand-off
  into creating an agent, a returning visit, a failing `/api/first-run`, a
  failing `/api/machine`, seven malformed deep links, an Escape racing an
  in-flight completion, a POST that never answers, keyboard containment in both
  directions, and four empty-body shapes.

⚠️ **The keyboard-containment section was itself caught being vacuous.** It
passed with both focus mechanisms deliberately disabled, because Chromium
implements `inert` and `inert` alone keeps Tab inside — it was measuring the
browser, not the fallback the code exists to be. It now clears `inert` first,
and the same mutation fails it.

⚠️ **And one mutation run was mis-aimed and reported as a pass.** `String.replace`
hit the first of two identical strings — the removal modal's Tab handler, not the
first-run one — so the trap under test was never disabled. Caught by checking the
patch had created the defect, not just that it applied.

### Final Ledger (the shape of it; per-iteration detail above)

| Category | Found | Fixed | Deferred |
|---|---|---|---|
| BLOCKER | 2 | 2 | 0 |
| WARNING | 32 | 32 | 0 |
| CONVENTION | 4 | 4 | 0 |
| NIT | 9 carried | 8 | 1 (UPS section) |

### Strengths recorded across iterations

- `create.binPaths` / `create.unusablePath` extracted and shared, so the check
  screen asks exactly the questions creation will ask, pinned by a test that
  reads `machine.js` for a re-forked lookup.
- `attention` and `unknown` counted apart end to end — separate filters,
  separate wire fields, two separate clauses on screen. The one place they could
  have been summed is the one place the code refuses to.
- Fixtures assert their own premise before asserting behaviour, and the
  reconstructed laptop `pmset` output is labelled as reconstructed rather than
  passed off as captured.
- The mixed screenshot fixture is generated by calling the real engine and
  throws if it stops carrying one `attention` and one `unknown`.
- Iteration 6 probed `sleepCheck` across all nine reachable input shapes and
  `installedCheck` across all seven bucket combinations and could not produce a
  sentence asserting something unchecked.
