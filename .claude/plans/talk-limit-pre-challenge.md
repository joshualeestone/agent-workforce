---
pre_challenge: true
method: challenge-loop
branch: talk-limit
diff_hash: 8732030fed0cacee088203b552c2c1ccb628f225e252921f84e1c376f553167e
subdir_audit: passed
timestamp: 2026-08-18T18:39:45Z
iterations: 2
converged: true
---

# Challenge Loop Proof: talk-limit

Two blind passes; pass 2 blocker-free with every finding fixed. Full
decision record: .claude/plans/talk-limit-20260818.md (the verbatim
channel rulings ride in talk-limit-spec-record.md).

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 1 | [BLOCKER] | messages.js valve dedup | A mid-window dial flip left the record lying for up to an hour (refusals as silence, or a standing stop claim over a flowing conversation) | FIXED (the dedup keys on the LATEST row's stopped-ness; the full Off-On-Off sequence tested as [false, true, false] with a within-state control) |
| 2 | 1 | [WARNING] | feed route | The pre-field stop default untested at the route (only the renderer's own default was pinned) | FIXED (a stopped-less row appended to the real log, read back through the conversation route) |
| 3 | 1 | [WARNING] | pair told-only because | Written but read by nowhere while the room's IS rendered | RECORDED at the log site (the record's sentence vs the composed rendering, agreeing in stopped-ness by the dedup) |
| 4 | 1 | [NIT] x3 | tier handler, refused-window ride-along, old-copy pin | Hardcoded On; the widened dedup window; no stale-copy sentinel | FIXED / RECORDED |
| 5 | 2 | [WARNING] | lim-toggle pre-paint | A click before the first paint saved a fallback tier over a stored 40 or 100 | FIXED (both handlers refuse while unpainted; the click re-requests the read; tier row ships hidden) |
| 6 | 2 | [WARNING] | DOM handlers untested | The pass-1 fix rested on unexercised closures | FIXED (named handlers driven against the DOM stub: pre-paint refusal, aria negation, toggle-read) |
| 7 | 2 | [NIT] x4 | double-click race, GET epoch, tmp path, dedup comment | All | FIXED (single-flight + epoch; scope comment; softened to the delivered semantics) |

[STRENGTH] carried from both passes: the tell has no off-switch on any
path (the log sits before the on-gated return on both valves, traced);
delivered-while-Off traffic counts across a re-enable, the bounded
direction; the fail-toward-ON read surfaces its own honesty on the
card; copy fidelity verbatim to the spec record with the drafted
additions attributed; the default provably equals the old hard-coded
rate (its own test row).

## Final state

Suite 877/877 plus shell checks; validation-log clean; the card driven
in a real browser (toggle, tiers, notes; zero page errors) and its
states pinned through a DOM stub.
