---
pre_challenge: true
method: challenge-loop
branch: project-settings
diff_hash: 6aff8c494914e8d93b997a403e5eec31ed7eba0e19db18b9d9f187ea78ffbaac
subdir_audit: passed
timestamp: 2026-08-17T04:24:43Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No (closed after iteration 1 under the operator's ship-fast
directive and standing stop rule; the round's two BLOCKERs and every other
finding were fixed before this proof, none deferred.)
**Total findings:** 8 (2 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 7 | **Deferred:** 1 (drive's fixed port/boot-sleep, recorded)

### Per-Iteration Breakdown

#### Iteration 1 (suite 793/793 and drive green BEFORE the findings; 794/794 after)
- [BLOCKER] engine/projects.js -- execFileSync never imported: production
  reveal dead forever behind "Finder did not open", invisible to
  runner-injected tests --> FIXED (import verified-absent-then-added; the
  catch throws ReferenceError/TypeError instead of wearing the failure's
  sentence; a no-runner PRODUCTION-path test added)
- [BLOCKER] the relocated remove flow's error wrote into the other view's
  hidden element --> FIXED (settings-local message line)
- [WARNING] paintOneProject repainted the old archive copy over the
  pack's every 5s --> FIXED (painter moved with its elements)
- [WARNING] desc maxlength=200 violated the engine's recorded code-point
  decision --> FIXED (no maxlength; the engine's sentence is the cap)
- [WARNING] name maxlength 60 vs the engine's 120 --> FIXED
- [WARNING] save could repaint stale values under "Saved." --> FIXED
  (retry; no repaint from a failed read)
- [NIT] location rule leaked a second case (deep-nested under root;
  volume-root) --> FIXED (folderInKosmos = direct child; volume
  grandparent hits the fallback)
- [NIT] drive's fixed port + boot sleep --> DEFERRED, recorded

### Final Ledger (compressed)
2 BLOCKERs FIXED / 4 WARNINGs FIXED / 1 NIT FIXED / 1 NIT DEFERRED.

### Strengths (reviewer)
- The reveal route's security posture "right and actually pinned": stored
  path only, no shell, guard proven by count, refusals in the folder
  state's own vocabulary.
- The honest no-change save pinned end to end by the drive.
- The relocation itself held: archive, confirm-gated remove, poll-pause,
  and focus management all working from the new home.

### Verification at close
node --test 794/794; committed drive green after fixes (door, paint,
parent-sentence shape, save round trip on all three surfaces, honest
no-op, no path on the project page, zero page errors).
