---
pre_challenge: true
method: challenge-loop
branch: add-editable-agent-detail
diff_hash: e1cb24168608f1c87a200a57d9c236a8bd0909772ab5f1dc5456b564bb4e80b2
subdir_audit: passed
timestamp: 2026-08-09T01:49:37Z
iterations: 24
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 24
**Converged:** Yes, at iteration 24 (no BLOCKERs, no WARNINGs, no CONVENTIONs)
**Total findings:** 118 (9 BLOCKERs, 52 WARNINGs, 12 CONVENTIONs, 45 NITs)
**Fixed:** 112 | **Deferred:** 6

**Tests: 142 at entry, 194 at exit. Zero dependencies. Zero skipped.**

Every guard in the plan's table was verified by deleting it and confirming a
**named** test fails. Ten guards are genuinely unpinned and every one of them
says so at the guard itself, not only in the plan.

### The finding that matters most

Nine BLOCKERs were found across 24 passes. **Five of them were in code added
during this loop to make the feature safer**, and each one broke a case the
previous fix had not considered:

| Iteration | Fix added | What it broke |
|---|---|---|
| 15 | `CLAUDE.md.previous` backup | 16: default write flag followed a symlink, an arbitrary-file write |
| 16 | `O_NOFOLLOW` on that write | 17: no `O_NONBLOCK`, so a fifo there wedged every route on the server |
| 17 | fifo + hard-link guards | 18: `O_NOFOLLOW` does not see a hard link |
| 18 | poll disables uneditable files | 19: killed the create flow for any agent with no file yet |
| 19 | poll generation guard | 20: token captured after the awaits, so it compared a value to itself |

Plus, in iteration 22, a test I wrote to pin a guard that **failed on harmless
refactors and passed on the regression it was named for.**

The lesson is not any individual bug. New defensive code is not a safe change:
it is new code on the most dangerous path in the product, written with the
confidence that comes from believing you are making things safer. It earns more
scrutiny than what it protects, not less.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 2 BLOCKERs, 9 WARNINGs, 1 CONVENTION, 4 NITs
- [BLOCKER] engine/instructions.js — a save destroyed a file `read()` had refused to show --> FIXED
- [BLOCKER] server.test.js — the suite sent PUTs at 12 real agents' boot files --> FIXED
- [WARNING] `staleness` could throw, 500ing the whole board --> FIXED
- [WARNING] `safeKey` mangled a registry lookup key --> FIXED
- [WARNING] cross-agent race wrote A's instructions into B's file --> FIXED
- [WARNING] card's stale mark invisible to screen readers --> FIXED

#### Iterations 2 to 8
**New:** 4 BLOCKERs, 26 WARNINGs, 5 CONVENTIONs, 20 NITs
- [BLOCKER] the clobber guard used a parallel predicate, so an unopenable file was still destroyed --> FIXED
- [BLOCKER] the version token hashed the DECODED string, so two different files hashed alike and non-UTF-8 files were corrupted --> FIXED
- [BLOCKER] `staleness` re-derived showability, so an unreadable file rendered as **`current`** --> FIXED
- [BLOCKER] `readIdentity` followed a symlinked file and blocked forever on a fifo --> FIXED
- Six instances of one defect (one reader guarded, a second not) --> FIXED structurally by `engine/workerfile.js`

#### Iterations 9 to 14
**New:** 0 BLOCKERs, 14 WARNINGs, 4 CONVENTIONs, 12 NITs
- [WARNING] read-side containment escape via a symlinked worker directory --> FIXED
- [WARNING] a save was an unconditional overwrite, destroying external edits --> FIXED
- [WARNING] a save widened file permissions 0600 to 0644 --> FIXED
- [WARNING] string-prefix containment believed a symlinked intermediate component --> FIXED
- [CONVENTION] four guard-table rows are green without a live tmux fleet --> FIXED (declared)

#### Iterations 15 to 21
**New:** 3 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 7 NITs
- [BLOCKER] the new backup write was an arbitrary-file write via symlink --> FIXED
- [BLOCKER] then via fifo, wedging every route --> FIXED
- [BLOCKER] the "file changed" notice fired on 100% of successful saves --> FIXED
- [WARNING] DNS rebinding: no `Host` check, on a server that now edits boot files --> FIXED
- [WARNING] a no-op save rotated the backup and burned the only undo --> FIXED

#### Iteration 22
**New:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
- [CONVENTION] the newest guards were unpinned and, unlike every other unpinned guard, undeclared --> FIXED

#### Iteration 23
**New:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] my allowlist test asserted on source text: it failed on harmless refactors and passed on the real regression --> FIXED (rewritten to drive a real child server; polarity verified both ways)

#### Iteration 24
**New:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged.** "I would ship this. I found nothing that is wrong, and nothing I
would block or gate on." The single NIT (one unexercised axis of the allowlist
fixture) was fixed anyway and mutation-verified.

### Deferred

| Finding | Reasoning |
|---|---|
| `knownAgent` cannot tell two agents whose names collide under `safeKey` | Widening the gate would let a write land on the wrong agent's file. A 404 is visible and harmless; a cross-agent write is neither. The real fix is one identity per agent, which reaches the avatar and profile stores. Documented at the code, and no collisions exist on this machine (checked). |
| `readIdentity` joins the verbatim name, `fileFor` joins the sanitised one | Same root cause, same scope. Both directions fail visibly. Stated accurately after an earlier comment of mine claimed it "fails safe in both directions", which was false. |
| `transcriptFor` resolved twice per agent per poll | Real duplication, no correctness impact. Passing the resolved path through is a separate change. |
| The file-mode window, the TOCTOU race window, the `fileFor` containment assertion, `iso()`, byte-hashing, `editable`-as-structure, the `isFile` check masked by `ftruncate`, and all of `web/index.html` | Genuinely unpinnable by a deterministic test, or masked by another guard. Each is declared untested **in the code itself**, not only in the plan. |
| "Restart to apply" names an action the app cannot perform | Restart is card #1. The copy now says restarting is what applies the change and that this app cannot do it yet, rather than instructing an impossible action. |
| No version history beyond one level | One-deep `CLAUDE.md.previous` is the scope here. It turns a permanent loss into a recoverable mistake, which was the actual gap. |

### NITs (non-blocking)
- The status poll resolves each agent's transcript twice (iterations 12, 17, 21)
- `MAX_UPLOAD` is 24x the ceiling the instructions route enforces (iteration 12)
- Plan item 5.10 shipped a purpose label rather than a provenance label; marked PARTIAL rather than ticked (iterations 9, 15)
- `web/index.html:609` renders an em dash, pre-existing on `main` and outside this diff (iteration 1)

### Strengths (across all iterations)
- `engine/workerfile.js` is a structural fix for a defect that shipped six times, not a seventh patch of it. Verified by mutation: reverting it reddens named tests across two modules.
- The version token is a sha256 of raw **bytes**, with `absent` and `unreadable` as real versions. That closes the create path, the delete path, and `touch` / `rsync --times` / `git checkout`, none of which an mtime could express.
- Open-then-`fstat`-then-read-from-the-descriptor closes a real check-then-use window rather than narrowing it.
- The fifo probes run in a child process with a timeout, so a regression reports as a **failure with a sentence** instead of a hung suite.
- Comments that declare what is NOT covered, and that correct earlier comments of mine which overstated a guard. Reviewers in iterations 19, 21, 22 and 24 each called this out unprompted as the rarest thing in the diff.
- Every UI state was verified by screenshot against a sandboxed server, which is how a blank-panel regression was caught that `node --check` and 175 passing tests both missed.
