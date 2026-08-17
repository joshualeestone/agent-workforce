---
pre_challenge: true
method: challenge-loop
branch: icon-refresh
diff_hash: 942baa2ec298c099fb07b80ea3b613371d53c8fda8b6e5ba7e2bde1b726707b3
subdir_audit: passed
timestamp: 2026-08-17T16:24:58Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs)
**Fixed:** 1 WARNING + 3 NITs | **Deferred:** 1 NIT

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] setup.sh comment stated the mechanism as measured fact when only the symptom triple was measured (and the pre-icon-read framing was wrong for this installer's atomic-mv path) --> FIXED (4235c40, MEASURED/HYPOTHESIS split, falsification asymmetry pre-declared)
- [NIT] The fix is the non-invasive subset of the manual remedy (no killall Dock) and unverified --> FIXED (stated in comment and plan)
- [NIT] touch without -c could in principle create a file --> FIXED (-c)

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged.**
- [NIT] The mv-preserves-mtime half was measurable locally --> FIXED (measured 2026-08-17: mv preserves directory mtime; comment updated to MEASURED for that half)
- [NIT] The uninstall path's failed-removal re-register lacks a companion touch --> DEFERRED: moot today (that bundle's icon was already drawn), revisit only if the mtime hypothesis proves out on the next clean install

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh | Mechanism asserted beyond measurement | FIXED | 4235c40 |
| 2 | 1 | NIT | install/setup.sh | Subset-of-remedy caveat | FIXED | 4235c40 |
| 3 | 1 | NIT | install/setup.sh | touch -c | FIXED | 4235c40 |
| 4 | 2 | NIT | install/setup.sh | Measure the measurable half | FIXED | this branch |
| 5 | 2 | NIT | install/setup.sh:1378 | Uninstall re-register touch | DEFERRED | Moot until hypothesis proves |

### Strengths (across rounds)
- Placement right on all three axes (post-mv, pre-register, inside the sandbox guard); containment airtight (absolute path, -c, quoted, || true, if-condition set -e safety).
- Comment discipline: measured facts separated from hypothesis with the falsification asymmetry pre-declared.
- Plan claims verified against the tree; sh -n and the floor gate green in both rounds.
