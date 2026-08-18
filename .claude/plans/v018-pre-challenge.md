---
pre_challenge: true
method: challenge-loop
branch: v018
diff_hash: 49db2c7e3582a16997968e91a0c93a6d36543a8371d96cd2e7f50b6f730dae81
subdir_audit: passed
timestamp: 2026-08-18T17:59:17Z
iterations: 1
converged: true
---

# Challenge Loop Proof: v018

A version-bump release branch; one blind pass, no blockers.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 1 | [WARNING] | plan scope | The since-#65 list omitted #66 and #67, and #67 changed the release artifacts themselves (dist/setup + setup.sha256 the site step must copy) | FIXED (everything since #65 named, the artifact called out) |
| 2 | 1 | [NIT] | runbook pointer | "the release runbook" was referenced but not located | FIXED (site repo + the overnight handoff named) |

[STRENGTH] verified by the pass: the version is single-sourced (every
consumer derives from package.json: engine/update.js, the installed
CLI at runtime, the bundle build; install/setup.sh pins no version),
the remaining 0.1.7 strings are historical milestones that must not
move, the floor-consistency check keys on tokens the bump cannot
desync, and "0.1.8" is a well-formed triple for the update comparison.
Suite 127/127 on the branch; the diff is exactly the one line plus the
plan.
