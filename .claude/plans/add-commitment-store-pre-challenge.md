---
pre_challenge: true
method: challenge-loop
branch: add-commitment-store
diff_hash: 562862c2825f1e6d2118a53cebeeeeb3fa68f57cc3361d7fbffa8ae73a2ea131
subdir_audit: passed
timestamp: 2026-08-08T18:37:43Z
iterations: 11
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** **No.** Stopped at the operator's explicit direction after round 11, with the state below put in front of him first. Rounds 9 and 11 found no BLOCKER; round 10 found one. No round produced zero findings.
**Total findings:** 58 actionable (5 BLOCKERs, 34 WARNINGs, 19 CONVENTIONs/NITs)
**Fixed:** 55 | **Deferred / carded:** 3

### Why it ran to 11 rounds

**Four separate times, a fix in one round caused the bug found in the next.** That is the single strongest justification for iterating, and it is why "two quiet rounds" was not treated as done:

| Round | Fix | What it caused, caught in the next round |
|---|---|---|
| 2 | Stored-name guard against key collisions | An aliased `PUT …/ANGEL/…` **overwrote the real record and returned 200**; the guard only detected the collision on a later read, after the data was gone |
| 3 | Sanitise on the read path | A whitespace-only description **crashed the process** on GET and 500'd the whole board on `/api/status` |
| 6 | Cap fields on the way out | The read path began **fabricating** ids and timestamps, so `resolve()` with an id the caller had just read removed nothing |
| 10 | Byte-ceiling justification | I dismissed a valid finding on a weaker reproduction and recorded the dismissal as fact (see below) |

### The five BLOCKERs

1. **A record containing `null` crashed the process** through the HTTP route. Same shape as a stray `%` in a name, and a direct violation of the plan's own "must not throw".
2. **A future-dated timestamp read as `clear` forever.** One-sided staleness check; an ordinary NTP correction produces one.
3. **`add()` destroyed real commitments** on a merely-stale record, turning a holding agent into "safe to restart" in two calls. The docstring above it claimed the opposite.
4. **An aliased spelling destroyed the record and reported success** (caused by round 2's fix).
5. **`resolve()` removed every commitment sharing an id.** Report two things under one id, resolve the one that finished, and the record reads `clear` **with real work outstanding**. Two ordinary API calls, no error anywhere, reachable through the PUT endpoint with a normal payload.

### ⚠️ The finding that is about the author, not the code

Round 10 reported the byte ceiling was too low. I tried to reproduce it, **maxed only the `what` field**, measured 406,708 bytes against a 512KB ceiling, concluded the reviewer was wrong, and **wrote that dismissal into both a code comment and a commit message as established fact**.

Round 11 showed the reproduction was incomplete. With every field maxed the true figure is **525,708 bytes**, which the old ceiling did not clear: `report()` wrote a record `read()` then refused as too large, leaving `add()` and `resolve()` throwing permanently.

**The finding was valid. I waved it off on a weaker reproduction and then recorded my own error as the record.**

That is the eleventh comment in this branch to claim something untrue, and the only one produced by confidence rather than carelessness. It is the one most likely to have misled the next reader, because it read as a considered correction.

### The recurring failure mode: tests that pass for the wrong reason

Eight tests in this branch pinned nothing while looking like they did. The pattern is always the same: **a second guard catches the input before the guard under test sees it.**

- The **traversal test** took four attempts. Version one asserted on a helper no production path called. Version three went through `read()` but its attack strings resolved to nothing. Version four passed against a deliberately vulnerable build because the **stored-name guard** rejected the planted record first. Only version five, with the fixture's `name` set to the attack string, could tell the two guards apart.
- The **concurrency test** took three. A sequential loop with no concurrency; then child processes that still passed against a bare `writeFileSync`; finally a **live reader sampling while four processes race**, which is the only shape that can observe a torn write.
- The **empty-id test** used two commitments, so the uniqueness check refused the record and the clause under test never decided anything.
- The **`what` cap** was unpinned at both sites because each masked the other.

### Deferred, carded rather than folded in

- **#18** — an agent whose tmux session name is not already its own `safeKey` can never report, and reads `unknown` forever. Fails safe, latent today (all 13 live sessions are canonical), shared with the avatar and profile routes so it wants fixing once.
- **`AGENT_WORKFORCE_DATA` moves only the commitment store.** Avatars and profiles still resolve through `store.ROOT`, which is a trap in a variable named for the whole data directory. Documented at both the definition and the test that relies on it.
- **The `capForDisplay` catch is not load-bearing** and says so in the code. Kept as deliberate defence-in-depth for a function that must never throw; declared rather than implied.

### Test discipline

**122 tests, zero dependencies.** Every guard verified by removing it and confirming a named test fails:

| Guard removed | Result |
|---|---|
| `unknown()` returns `clear` | 29 tests fail |
| Staleness / future-tolerance halves | each fails independently |
| Stored-name guard, alias refusal | fail |
| `lstat` vs `stat` (symlink) | fails |
| `isFile` (FIFO) | **suite hangs** — which is exactly what a named pipe does to the board |
| Byte ceiling, entry caps (read and write) | fail |
| Atomic rename | fails the reader-during-race test |
| `absent` field in `add()` | fails |
| Timestamp preservation in `add()` / `resolve()` | fail |
| `idsAreUnique()` at both sites | fail |
| Hardcoding `clear` into `/api/status` | fails |

The FIFO test runs in a **child process with a wall-clock kill**, because in-process it could only hang, never report, and a test whose failure mode is "the run never ends" is worse than no test.

### Why stopping here rather than continuing

The last three rounds went nothing, one bug, nothing. Findings have moved from the guarantee itself to test precision and comment accuracy. `read()`'s never-throw invariant survived **5,924 fuzzed record shapes and agent arguments with zero throws and zero false `clear`**.

**The counter-argument was put to the operator and is worth recording:** on this branch a quiet round has not reliably meant done, since round 10 found a genuine false-`clear` after round 9 found nothing. He chose to ship with that stated.

### Strengths carried forward

- The **`ok` / `absent` / stale trichotomy** in `parseRecord` is the decomposition most implementations collapse, and branching `add()` on a **field rather than message prose** is the correct lesson from the data-loss bug.
- **Separating `writeRecord()` from `report()`** so a derived change preserves the original assertion time is the sharpest idea in the branch: it is what stops `add()`/`resolve()` laundering "we cannot tell" into a confident answer.
- Comments that **decline to imply coverage they do not have** (the `capForDisplay` catch declaring itself untested) are the opposite of this branch's recurring failure, and worth keeping as a habit.
