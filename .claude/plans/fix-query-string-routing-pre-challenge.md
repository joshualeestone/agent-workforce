---
pre_challenge: true
method: challenge-loop
branch: fix-query-string-routing
diff_hash: fc154dc93ba1ea785e1db296d922fed52ae0ca02ed63737a4994357790a29a83
subdir_audit: passed
timestamp: 2026-08-07T20:56:51Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped by author judgment with the operator's explicit agreement, not by a clean round. Iteration 8's findings were all addressed, but no ninth round confirmed zero new findings.
**Total findings:** 41 actionable (1 BLOCKER, 25 WARNINGs, 15 CONVENTIONs/NITs)
**Fixed:** 38 | **Deferred / carded:** 3

### Why it stopped here rather than at convergence

Each round kept finding real defects, but the character changed. Rounds 1 to 3 found problems **this diff caused or widened**. Rounds 6 to 8 were increasingly hardening pre-existing code in a file the branch happened to touch. A one-line routing fix had grown into a general hardening pass, and the remaining known items are better as their own decisions than as silent additions to a bugfix.

The three not fixed here are carded: **#15** (no Host-header check, so DNS rebinding reaches every unauthenticated write endpoint), **#13** (the UI and README still tell users the app is read-only), and the non-atomic `saveAvatar` write that the zero-byte guard exists to compensate for.

### The finding that justifies the whole loop

**Iteration 8 caught a process-killing regression introduced by iteration 3's fix.** Deferring the avatar's 200 header to the stream's `open`/`readable` event is correct, and it is what stops an empty 200 for a missing file. It also opens a window in which the client can go away before `pipeline` is called, and `pipeline` **throws synchronously** on a destroyed destination. From inside an event handler that is an uncaught exception that exits the process.

This is ordinary use. A browser cancels in-flight `<img>` loads routinely, and `web/index.html` re-sets `img.src` with a fresh `?t=` on every render, so a person clicking between agents produces it.

**A fix from an earlier round created a worse bug than the one it fixed, and only an independent later round caught it.**

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 3 NITs
- [BLOCKER] server.js — `decodeURIComponent` on a stray `%` throws inside the handler; one unauthenticated `GET /api/agent/%/avatar` exits the process. Pre-existing for the bare form, but **routing on the pathname widened it**: the anchored patterns previously stopped matching once a query string was appended --> FIXED (`dd62232`)
- [WARNING] server.js — the authority guard discarded the host, routing `//evil.example/api/status` on the path alone --> FIXED
- [WARNING] server.js — `listen()` at require time, so importing to test it bound a port --> FIXED
- [WARNING] server.test.js — the profile route was one of three sites changed and had no test --> FIXED
- [CONVENTION] .claude/plans/ — no plan file for this branch --> DEFERRED: came from a card, not `/pplan`
- 3 NITs (variable named `url` for a pathname; redundant test; status-vs-content-type assertions) --> FIXED

#### Iteration 2
**New findings:** 2 WARNINGs, 3 NITs
- [WARNING] server.js — **the authority guard was bypassable.** The URL parser normalises a backslash to a slash for http, so `/\evil.example/api/status` was authority-form while passing `startsWith('//')`. **The test written alongside that guard passed anyway**, because it only tried the `//` spelling --> FIXED (`1eb5c06`)
- [WARNING] server.js — `pipe` does not forward source errors; a file removed between locating and opening it was an unhandled error event --> FIXED
- 3 NITs (orphaned warning docblock; `start()` promise could never reject; missing positive-path test) --> FIXED

#### Iteration 3
**New findings:** 5 WARNINGs, 4 NITs
- [WARNING] server.js — **the 404 branch was unreachable.** `writeHead(200)` ran synchronously before any async stream error, so a vanished file answered **200 with an empty body**: a success status for a picture that is not there. "It no longer crashes" was not the bar --> FIXED (`592e57c`)
- [WARNING] server.js — the fix closed the query-string axis and left the **method** axis open: `PATCH` on an avatar returned the page at 200, identical signature --> FIXED
- [WARNING] server.js — `start()` called with no `.catch()`, so EADDRINUSE was an unhandled rejection with a raw stack: exactly what the promise was added to replace, making its own comment false --> FIXED
- [WARNING] server.test.js — "an API route never answers with HTML" only tried query strings and passed while the method axis was broken --> FIXED
- [WARNING] server.test.js — the positive-path test bare-returned and printed a tick while asserting nothing --> FIXED
- 4 NITs --> FIXED

#### Iteration 4
**New findings:** 3 WARNINGs, 6 NITs
- [WARNING] server.js — absolute-form targets answered an API call with the page at 200, in exactly the reverse-proxy deployment the file documents --> FIXED (`f783e5e`)
- [WARNING] server.js — the opening docblock still said "read-only ... never writes anything", contradicted by the warning at the bottom of the same file --> FIXED
- [WARNING] server.test.js — the positive avatar test depended on the live fleet having an avatar --> FIXED (fixture)
- 6 NITs --> FIXED

#### Iteration 5
**New findings:** 5 WARNINGs, 4 NITs
- [WARNING] server.js — a **non-file** opened fine and failed past the committed 200; a directory in the store answered 200 with a zero-byte body --> FIXED (`0c1dd7a`)
- [WARNING] server.js — a mid-read failure ended the chunked response **cleanly**, so the client saw a successful truncated body with no error signal --> FIXED
- [WARNING] server.js — **`pipe` leaked the file descriptor on client abort**: 60 aborted requests took the process from 16 to 65 open fds and held them, which walks to EMFILE --> FIXED (`pipeline`, measured delta now 0)
- [WARNING] server.js — the loopback accept-set was **backwards**: compared host (which carries the port) against a literal `localhost:80`, so `//localhost/x` routed while `//localhost:4317/x` was refused --> FIXED
- [WARNING] server.js — no Host-header check --> DEFERRED: carded as **#15**. A security posture change, not a bug, and it interacts with whatever eventually fronts this port
- 4 NITs --> FIXED

#### Iteration 6
**New findings:** 4 WARNINGs, 3 NITs
- [WARNING] server.js — **the `/api` guard tested the un-decoded pathname**, so `/api%2fstatus` did not start with `/api/` as a string and fell through to the page. The invariant failing on the one spelling a syntactic check gets wrong, which is the same class the `pathOf` comment already documents --> FIXED (`1c3ccc1`)
- [WARNING] server.js — `pathOf` rejected anything not starting with `/`, throwing out absolute-form **before** the loopback set was consulted, so that set was dead code and its comment claimed a capability the code lacked --> FIXED
- [WARNING] server.js — **HEAD regressed.** The method guard plus the `/api` catch-all turned a working `HEAD /api/status` into a 404 --> FIXED
- [WARNING] server.js — a **zero-byte** file passed the is-a-file gate and answered 200 with `content-length: 0`. `saveAvatar` writes non-atomically, so an interrupted save leaves exactly that --> FIXED
- 3 NITs --> FIXED

#### Iteration 7
**New findings:** 4 WARNINGs, 4 NITs
- [WARNING] server.test.js — **the test claiming to pin the `pipeline` rewrite exercised none of it.** It built a directory, which the stat gate rejects before the stream exists, so it never reached `pipeline`, the error handler, or the post-header destroy. **A bare `pipe` passed all 44 tests.** Its own comment asserted the opposite --> FIXED (`8cba30a`): replaced with a case that reaches the error handler, and the post-header path documented as uncovered rather than falsely claimed
- [WARNING] server.js — **`content-length` came from `stat` while the bytes came from a separate read.** A stat that under-reports gave a clean 200 truncated to the declared length **with the surplus bytes landing on the wire afterwards, desyncing a keep-alive connection into the next response** --> FIXED (dropped; chunked cannot do that)
- [WARNING] server.js — the authority guard's comment read like an origin check it does not perform --> FIXED (says so explicitly, points at #15)
- [CONVENTION] server.js — **an em dash reached a user-facing error string**, against the house rule. Every other new line used `--` --> FIXED
- 4 NITs --> FIXED

#### Iteration 8
**New findings:** 1 BLOCKER, 2 WARNINGs, 2 NITs
- [BLOCKER] server.js — `pipeline` **throws synchronously** when the client has already gone; inside a `readable` handler that is an uncaught exception that exits the process. **Introduced by this branch's own iteration-3 fix.** Ordinary browser behaviour triggers it --> FIXED (`6c4a515`)
- [WARNING] server.test.js — **no test covered a cancelled request**, the one scenario the `pipeline` choice was justified by, and exactly where the BLOCKER lived --> FIXED
- [WARNING] server.test.js — the directory test did not pin `!stat.isFile()`; `createReadStream` emits EISDIR before `readable`, so the error handler answers 404 either way --> DEFERRED: the gate is defence-in-depth and gives a cleaner message; the test's premise was corrected rather than the guard removed
- 2 NITs (HEAD on avatar untested; `saveAvatar` non-atomic) --> HEAD FIXED; `saveAvatar` carded

### Test discipline

Every guard was verified by **removing it and confirming the right test fails**, per this repo's existing practice (`d77d743`, "verified by reintroducing the bugs"):

| Guard removed | Test that fails |
|---|---|
| routing on pathname | 2 tests |
| loopback authority check | 4 tests |
| decode in the `/api` guard | 1 test |
| zero-byte gate | 1 test |
| HEAD passthrough | 1 test |
| absolute-form support | 1 test |
| `res.destroyed` check | 1 test |
| stream `error` handler | process dies (suite hangs) |

The abort test **counts `uncaughtException` events** rather than only asserting the server still answers. Under the test runner those throws are absorbed, so a liveness-only assertion printed a tick beside seven uncaught errors while the same code would exit a real board.

### ⚠️ Incident during iteration 8

A review agent probing the live server fired a `DELETE` against the real store before switching to a sandbox, **deleting the operator's `angel.jpg`**, and ran `pkill -f "node server.js"`, killing the board.

**Both recovered.** The image was restored byte-identical (MD5 `f30ce1e07737a713d854fddd7da70937`, 25198 bytes) from copies taken during earlier verification; the board was restarted; a probe-created empty profile file was removed.

**Cause: the review prompt authorised attacking a live server without sandboxing the store.** Future review prompts that permit probing a running service must point it at a temp `HOME` or an isolated data directory. The agent self-reported all three side effects unprompted, which is the only reason recovery was immediate.

### NITs (non-blocking, across all iterations)
- `/API/status` (uppercase) still serves the page; nothing is reachable that way since no handler is case-insensitive (iteration 8)
- A known path with an unimplemented method answers 404 rather than 405 (iteration 7)
- `engine/status.js:491` has a dead ternary, both branches identical; pre-existing and outside this diff (iteration 4)

### Strengths (across all iterations)
- Tests drive the real server over a real socket rather than a re-implementation. A unit test on the path helper would have passed against the broken code, because the helper was never the broken part (every iteration)
- Asserting on content-type rather than status, so a failing tmux status engine returning 500-as-JSON cannot fail a routing test (iterations 2, 5, 8)
- Checking `parsed.hostname` rather than a string prefix: testing the property instead of a spelling of it (iterations 3 to 8)
- No probe across eight rounds escaped the store, and after the fixes none terminated the process: `%2e%2e`, `%252e%252e`, `%C0%AE`, null bytes, lone surrogates, 100k-character segments, 20k-segment paths, `OPTIONS *`, `CONNECT`, pipelined junk, 12MB bodies, 300 half-open sockets
