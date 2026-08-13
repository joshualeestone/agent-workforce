---
pre_challenge: true
method: challenge-loop
branch: tmux-floor
diff_hash: 54d9f58c9c3c9fcf84f59f7c60d5b532c26b922bf241f097a30a4a9e23f5fc08
subdir_audit: passed
timestamp: 2026-08-13T18:56:27Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviews, each with its fixes applied and
re-verified against a full source rebuild plus both test suites.
**Converged:** Yes: zero BLOCKERs in both rounds; round 2's four WARNINGs
fixed and verified in-iteration (severity 0B+9W -> 0B+4W -> fixed).
**Total findings:** 0 BLOCKERs, 13 WARNINGs, 6 CONVENTIONs, ~9 NITs.
**Fixed:** all WARNINGs and CONVENTIONs; NITs fixed or deferred with
reasons.

### Round 1 (what a blind reviewer found in the new builder)

- The floor sweep could pass vacuously (glob over a never-installed
  library skips silently) -> counted, later per-library (round 2).
- Only the ncurses linkage was asserted -> all three dependencies
  asserted (the build machine has Homebrew copies of each).
- No runtime exercise beyond tmux -V, which the ABI-mismatched build had
  passed -> a real session smoke on an isolated socket.
- The hand-typed notices missed libevent's arc4random ISC block and
  utf8proc's Unicode data licence -> licences harvested verbatim from the
  pinned sources and shipped in the bundle's licenses/.
- VERSION lacked the dependency versions a CVE response needs ->
  BUILD-INFO written by the source build, carried into VERSION.
- KOSMOS_ALLOW_MINOS left no trace in the artifact -> TEST BUILD stamped
  into VERSION on the override path.
- README's release steps were stale (still said tmux needed re-sourcing;
  omitted the mandatory first step) -> rewritten with prerequisites, the
  version-bump flow, and the named debt.
- The terminfo comment stated a collision mechanism that was not
  established -> restated as the measured fact only.
- https-only fetches with downgrade-proof redirects; TOFU limit of the
  recorded hashes stated plainly; shell gate extended to all seven
  scripts; make --quiet dropped so error-path log tails carry commands.

### Round 2 (the residual)

- The session smoke's comment claimed terminfo coverage the check did not
  have: a DETACHED new-session never attaches a client, so terminfo was
  never consulted (measured: bogus TERM passed detached, failed only
  under a pty). -> the smoke now attaches through a pty (expect, base
  macOS; script -q needs a parent tty and fails headless, measured) AND
  carries its own control: a bogus TERM must be refused, or the
  instrument has gone blind again.
- The aggregate artifact count still passed with a whole library missing
  -> per-library counts, each glob required non-empty.
- A release bundle was not required to carry the harvested licences it
  exists to fix -> release builds fail without them; only marked test
  builds may skip.
- "A minos stamp is a promise, not a run": nothing verifies the artifacts
  load on a real 13.x boot. Recorded as NAMED DEBT in the README's
  release steps and the plan rather than claimed away; the pty smoke, the
  floor stamps, and the pinned system terminfo path are what this machine
  can verify.
- The bundler header's "no compiler" framing corrected for the release
  path; toolchain preflight refuses in a sentence; VERSION's duplicate
  tmux key deduplicated.

### Deferred, with reasons

Upstream hash cross-check (TOFU stated honestly; on the security list
beside artifact signing). The prefix landing under dist/ by default
(gitignored; tidiness). floor-gate.sh parse reuse for the equality check
(differing semantics; fails loudly on mismatch).

### Validation

Each round: full source rebuild (downloads verified against pinned
SHA-256s, per-library floor sweep, three linkage assertions, pty session
smoke + bogus-TERM control), release bundle packed with zero overrides
(harvested licences, BUILD-INFO in VERSION), 529 app tests + shell gate
over all seven scripts + floor/identity consistency, and the 22-assertion
install lifecycle harness run against the floor-built artifacts.
