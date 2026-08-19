---
pre_challenge: true
method: challenge-loop
branch: update-control
diff_hash: 65908c020a8d2fa666e7a186852dc50d06468fc3d4c91df5e20865b9c3eb608f
subdir_audit: passed
timestamp: 2026-08-19T02:02:00Z
iterations: 6
converged: true
---

# Challenge-Loop Proof: update-control

Six fresh blind passes; iterations 5 and 6 consecutively free of
blockers/warnings (5's CONVENTION entry was an explicit non-finding, 6's
was the PR-time screenshot reminder). Validation green every round.

## Iteration 1 (4 WARNING, 2 CONVENTION, 3 NIT -- fixed or recorded)

[WARNING] confirm focus return broke for the card path. FIXED:
opener-aware close with staleness fallback.
[WARNING] the check result was invisible to assistive tech and focus
dropped mid-check. FIXED: role=status line, focus restored.
[WARNING] plan-promised coverage missing (later-key clear, POST-only,
lastLook shape). FIXED: named handler + tests for all three.
[WARNING] the checkNow TTL control could not fail (unsettled async).
FIXED: settled first.
[CONVENTION] route doc-block ordering; render evidence. FIXED/CAPTURED.
[NIT x3] fixed (null-look neutrality, comment, exports format).

## Iteration 2 (1 WARNING, 4 NIT -- fixed or recorded)

[WARNING] captive portal: reached-with-unusable-answer rendered "Up to
date". FIXED: readable joins reached; new honest sentence for the
unreadable arm (copy flagged for Mona Lisa).
[NIT] board-side failure blamed the update server and cleared the toast.
FIXED: "Could not check just now." arm, toast untouched.

## Iteration 3 (3 WARNING, 3 NIT -- fixed)

[WARNING] stale six-hour comments. FIXED (worded TTL-proof).
[WARNING] identical-write re-announcement on the live region. FIXED:
guard, with a control-carrying test.
[WARNING] the client-failure arm untested. FIXED: rejecting-fetch case
asserting the sentence AND that the toast is never touched.

## Iteration 4 (1 WARNING, 4 NIT -- fixed or recorded)

[WARNING] a CDN 404 rendered "could not reach" (wrong leg). FIXED: any
response object is reached; silence alone is unreached; non-ok pinned.
[NIT] offer withdrawal on the miss stamp recorded in code as deliberate.

## Iteration 5 (0 B/W, 4 NIT) -- first clean pass

Header claim scoped; ten-second timeout on the check fetch; the Update
arm tested; two edge lifetimes accepted.

## Iteration 6 (0 B/W, 4 NIT) -- CONVERGED

Button text joins the identical-write guard; stub try/finally; two
recorded lifetimes (one-poll failure sentence; static Checking against
a fully down board).

### Final Ledger (condensed)

| Iter | B/W found | Disposition |
|------|-----------|-------------|
| 1 | 4 W | fixed |
| 2 | 1 W | fixed |
| 3 | 3 W | fixed |
| 4 | 1 W | fixed |
| 5 | 0 | nits fixed/accepted |
| 6 | 0 | nits fixed/accepted |
