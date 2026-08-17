---
pre_challenge: true
method: challenge-loop
branch: sleep-settings
diff_hash: dcf2988d46914d2b970973bfbc74ead3251eadeaf268060167bef43e3bbda078
subdir_audit: passed
timestamp: 2026-08-17T01:46:17Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No (closed after iteration 1 under the operator's standing
stop rule: the round found zero BLOCKERs, and every finding it raised was
fixed before this proof.)
**Total findings:** 5 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 5 | **Deferred:** 0

### Per-Iteration Breakdown

#### Iteration 1 (0 BLOCKERs, 2 WARNINGs, 3 NITs; suites 786/786 + shell gate green)
- [WARNING] the settings-flag test depended on the host's real /System
  dir, and the readdir-throws branch was unreachable by any mock -->
  FIXED 7c883f9 (injectable lister; empty-dir and unreadable-dir worlds
  tested as the no-button safe failure)
- [WARNING] the process-lifetime cache accepted per-call runners, so the
  first caller's injected world silently decided `settings` for every
  later caller (test order load-bearing) --> FIXED (injected worlds
  bypass the cache in both directions, with a test proving an injected
  probe cannot write what the real world then reads)
- [NIT] a successful open left a prior failure sentence standing -->
  FIXED (success clears the message line)
- [NIT] the route test's cross-site case ran with the real opener
  installed (a guard regression would launch Settings on whoever runs
  the suite) --> FIXED (stub installed first; guard proven by count)
- [NIT] the drive script's kills-only-what-it-started claim had gaps
  --> FIXED (precondition refuses an existing Settings window; killall
  only if this run clicked; pane match on the appex binary path)

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/machine.test.js | host-dir coupling | FIXED | 7c883f9 |
| 2 | 1 | WARNING | engine/machine.js | cache vs injected runner | FIXED | 7c883f9 |
| 3 | 1 | NIT | web/index.html | stale failure sentence | FIXED | 7c883f9 |
| 4 | 1 | NIT | server.test.js | stub after cross-site req | FIXED | 7c883f9 |
| 5 | 1 | NIT | render-sleep-button.js | cleanup ownership | FIXED | 7c883f9 |

### Strengths (reviewer)
- "The security posture is genuinely closed": URL always derived
  server-side from a two-id allowlist read out of the appex's own
  Info.plist; tests pin that open receives exactly the derived string,
  an unrecognized id yields null, the no-pane path runs nothing, and
  the guard/409/200 all assert mechanism over copy.
- The client wiring anticipates its own failure modes (delegated click
  surviving wholesale repaints; disable/finally correct even when the
  awaited repaint detaches the node; errors into the aria-live line).

### Verification at close
node --test 786/786; yarn test:shell green; committed drive-through
green on this machine (button rendered because the pane exists, click
launched the real pane process with a 10s pgrep window, no error
message, Settings owned and quit by the run).
