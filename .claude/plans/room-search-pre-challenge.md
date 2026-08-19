---
pre_challenge: true
method: challenge-loop
branch: room-search
diff_hash: 35a6e87278d812c89e35e256bf6843b01b6f751cfe1cddba862bef2935fcb41c
subdir_audit: passed
timestamp: 2026-08-19T03:50:00Z
iterations: 5
converged: true
---

# Challenge-Loop Proof: room-search

Five fresh blind passes; iterations 4 and 5 free of blockers/warnings
(post-convergence changes were nit-level and a fixture-discipline
rework, all verified green). Validation green each round.

## Iteration 1 (1 BLOCKER, 3 WARNING, 1 CONVENTION, 2 NIT)

[BLOCKER] the reset-on-switch pin matched the variable's own declaration
and could never fail. FIXED: all lifecycle pins live inside their owning
functions.
[WARNING] a duplicate .pjmidhead rule shadowed the existing one into a
hybrid neither described. FIXED: one rule.
[WARNING] the valve fallback sentence displayed but was unsearchable.
FIXED: one shared constant for renderer and filter.
[WARNING] the input listener pinned by attachment only. FIXED: body
pins + cache lifecycle pins.
[NIT] announce-on-transition added for screen readers (her helper).

## Iteration 2 (2 WARNING, 2 NIT)

[WARNING] the announcer claimed nothing-matches over a partially
unreadable record (the shown path withholds it). FIXED: ok guard.
[WARNING] the transition flag survived project switches, swallowing
B's first announce. FIXED: reset with its siblings.
[NIT] shown and spoken no-match copies unified into one function;
presence control added to the hint-cut pin.

## Iteration 3 (1 WARNING, 1 CONVENTION, 3 NIT)

[WARNING] the filter fixtures could not fail (Leo/leo case-fold; 'you'
literal). FIXED: discriminating probes + raw-key negative.
[CONVENTION] render evidence: shot at the final sha, attached.
[NITs] comment narrowed to the real scope; two accepts recorded.

## Iteration 4 (0 B/W, 3 NIT) -- first clean pass

Identity assert on the fast path; the stub reshaped to the page's real
data model (then reworked to ride the REAL producer when the fixture
discipline flagged the literal); fallback-name note accepted.

## Iteration 5 (0 B/W, 4 NIT) -- CONVERGED

The valve who-guard made local (never trusting the route's row shape);
closest hoisted; strictEqual; a stray-from valve negative pinned.

### Final Ledger (condensed)

| Iter | B/W/C found | Disposition |
|------|-------------|-------------|
| 1 | 1 B, 3 W, 1 C | fixed |
| 2 | 2 W | fixed |
| 3 | 1 W, 1 C | fixed |
| 4 | 0 | nits fixed |
| 5 | 0 | nits fixed |
