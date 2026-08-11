---
pre_challenge: true
method: challenge-loop
branch: create-an-agent
diff_hash: e89562873bc8531852a525fcb95f37180097ecf8448063f8975231036213404e
subdir_audit: n/a
timestamp: 2026-08-11T05:01:38Z
iterations: 11
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** No. Stopped at the operator's decision ("ship and then do a small
PR to cover the static supervisor", 2026-08-11 03:58 CDT). Rounds 6 through 11
found no BLOCKERs and the findings narrowed each round, but round 11 still
produced real WARNINGs, so this is an operator-confirmed stop rather than
convergence, and the outstanding items are listed rather than closed.
**Total findings:** 78 actionable (5 BLOCKERs, 46 WARNINGs, 5 CONVENTIONs, 22 NITs)
**Fixed:** 75 | **Deferred:** 3

### The pattern this loop measured, which matters more than the count

**Four of the five BLOCKERs were introduced by the fix for the previous round's
finding**, and every one of them was in the same artifact: the bash startup
script this branch generates per agent. That is not a claim about review being
noisy. It is a measurement of where the risk is:

| origin of finding | count |
|---|---|
| gaps in code that predates this branch | ~10 |
| damage from a fix made during this loop | ~15 |
| everything else (new code, first look) | rest |

Eleven of the fifteen self-inflicted ones sit in two things that did not exist
before this branch: the generated launcher and the creation screen. The rest of
the codebase did not churn.

**What stopped it was not more review.** It was two changes of method:

1. **Executing the artifact instead of reading it.** `runLauncher` writes a fake
   tmux with a scripted world and runs the generated script for real. It caught
   a duplicated heredoc terminator that `bash -n` passed, and it caught the
   assertion I had written about correct behaviour being wrong on its first run.
2. **Measuring the system instead of assuming it.** Round 6 broke the session
   claim because I used tmux's exact-match target syntax on commands that reject
   it. Round 7 caught me writing "measured on tmux 3.6a" about a probe run
   against a session I had killed thirty seconds earlier.

The follow-up PR the operator approved (collapse the per-agent generated script
into one static supervisor taking the name as an argument) removes the category
rather than the instances: one file, reviewed once, and a fix reaches every
agent rather than only the ones created afterwards.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 10 WARNINGs, 1 CONVENTION, 4 NITs
- [BLOCKER] server.js — `POST /api/agents` reachable by drive-by CSRF. A POST with
  a `text/plain` body is a CORS simple request: no preflight, and the loopback
  `Host` a legitimate request carries. **Measured against the running server: a
  request from a stranger's origin created a worker directory and installed a
  launchd job on this machine.** Every other write is PUT/DELETE and therefore
  preflighted, so this was the first route a page on another site could reach.
  --> FIXED (`crossSiteWrite`, applied before routing so a later write inherits it)
- [WARNING] engine/create.js — a failed write still returned CREATED --> FIXED
- [WARNING] engine/create.js — the generated script killed any session of its
  name, at every login, whether or not it was ours --> FIXED (claim-gated, and it
  waits rather than exiting so launchd does not thrash)
- [WARNING] engine/create.js — Claude/tmux paths never checked for existence --> FIXED
- [WARNING] engine/create.js — "no shell, ever" was false once the launcher existed --> FIXED
- [WARNING] engine/create.js — "dry-run by default" was false --> FIXED
- [WARNING] server.test.js — `AGENT_WORKFORCE_LAUNCH` unsandboxed --> FIXED
- [WARNING] engine/status.js — `sessionIdFor` reconstructed the registry name by
  appending `-discord`, so a created agent showed `model unknown` and a dashed
  ring forever --> FIXED
- [WARNING] engine/status.js — the at-prompt state --> FIXED
- [WARNING] README.md — no removal path documented --> FIXED
- [CONVENTION] engine/create.js — `lifecycle` cited as precedent; not on this branch --> FIXED
- NITs: double-escaped errors, stale screenshot, orphaned watch, radiogroup
  semantics, live-region churn --> all FIXED

#### Iteration 2
**New findings:** 1 BLOCKER, 8 WARNINGs, 1 CONVENTION, 3 NITs
- [BLOCKER] web/index.html — the 30-second timeout copy overwrote a PARTIAL's
  reason with "the folder and the instructions are on your computer either way",
  **the exact sentence `engine/create.js` names as the one not to say**, false in
  precisely the case that produced it --> FIXED
- [WARNING] web/index.html — `boardCanSeeIt` asked `isFleetSession`, which is
  true for anything `isNamedOurs` already claimed: a dead term, and the comment
  described a check that could not fire --> FIXED (`isAgentSession`)
- [WARNING] server.test.js — the test "controlling" for that pinned a field
  combination the API cannot produce --> FIXED
- [WARNING] engine/create.js — the script named its tmux path `$TMUX`, which is
  tmux's own environment variable --> FIXED
- [WARNING] engine/create.js — `new-session`'s failure unchecked, so the claim
  could land on a session we did not create --> FIXED
- [WARNING] engine/create.js — a name ending in `-discord` was accepted --> FIXED
- [WARNING] engine/instructions.js — the transcript fallback changed which
  session an existing caller resolved --> FIXED
- [WARNING] server.test.js — no happy-path test for the create route --> FIXED
- [WARNING] web/index.html — step state invisible to a screen reader --> FIXED
- [CONVENTION] engine/roles.js — a `scope` field nothing has ever read --> FIXED (removed)

#### Iteration 3
**New findings:** 2 BLOCKERs, 5 WARNINGs, 4 NITs
- [BLOCKER] engine/create.js — **tmux resolves a `-t` target by PREFIX.** With
  only `angel-discord` running, `has-session -t ang` exits 0. An agent named `sam`
  beside `samantha-discord` would have waited forever on the wrong session --> FIXED
- [BLOCKER] engine/create.js — the same in the supervision loop, so launchd would
  never restart it --> FIXED
- [WARNING] server.js — the cross-site guard compared the Origin's hostname only,
  so any other loopback port counted as same-site --> FIXED
- [WARNING] engine/create.js — a one-character name was told it had used illegal
  characters, a rule it had not broken --> FIXED
- [WARNING] engine/create.js — an existing launchd job was discovered as a failed
  bootstrap rather than named --> FIXED
- [WARNING] server.js — the module header and the `start()` posture block both
  said this server cannot start an agent --> FIXED
- [WARNING] engine/status.test.js — the column property test asserted keys, not
  values --> FIXED

#### Iteration 4
**New findings:** 0 BLOCKERs, 7 WARNINGs, 3 NITs
- [WARNING] web/index.html — only `refused` was branched on, so a 400, a 403 or a
  500 painted the made screen and then claimed files existed --> FIXED
- [WARNING] engine/create.js — dry-run suppressed the commands but not the
  writes, so a test with a recorder still wrote a real plist --> FIXED
- [WARNING] engine/create.js — running the script by hand, which its own header
  invites, killed the live agent --> FIXED (adopts a healthy session)
- [WARNING] engine/create.js — after a PARTIAL, Start over answered "there is
  already an agent called X" --> FIXED
- [WARNING] engine/status.js — the first registry candidate won even when its
  session had no transcript --> FIXED
- [WARNING] engine/create.js — the claim's failure was the one unchecked command --> FIXED
- [WARNING] engine/create.test.js — two refusals could be deleted with the suite green --> FIXED

#### Iteration 5
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 NIT
- [BLOCKER] engine/create.js — **the plist was written before the gate that stops
  a half-made agent from starting.** Skipping `bootstrap` does not help: launchd
  loads every plist in that directory at the next login, `bash` exits at once on
  a missing script, and `KeepAlive` respawns it every thirty seconds forever.
  Word for word the harm the gate's own comment claims to prevent --> FIXED
- [WARNING] engine/create.js — `list-panes -t` resolves a target WINDOW, and
  `head -1` read one pane of it, so a split window read as a crashed agent --> FIXED
- [WARNING] engine/create.test.js — the tests asserted the script's TEXT; moving
  `kill-session` out of the ours-branch keeps them green --> FIXED (behavioural
  harness, mutation-verified)
- [WARNING] server.test.js — the route's happy-path test ran in dry-run --> FIXED
- [WARNING] engine/status.js — root-major iteration broke the documented
  preference on a machine with two config roots --> FIXED
- [WARNING] server.js — a comment justified the no-content-type case with a claim
  about `fetch` that is false --> FIXED

#### Iteration 6
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION
- [WARNING] engine/create.js — a failed write left the folder, so the next attempt
  at that name was refused permanently from a screen whose button says Start over --> FIXED
- [WARNING] engine/create.js — a failed bootstrap left the plist, so an agent the
  person was told is "not running yet" was installed to start at their next login --> FIXED
- [WARNING] engine/create.js — the alive-probe missed `-zsh`, the login shell the
  status engine uses as its canonical crashed value --> FIXED
- [WARNING] engine/create.js — an unreadable `list-panes` read as "every pane is a
  shell" and became a reason to kill --> FIXED
- [WARNING] engine/status.js — the staleness verdict still resolved by name --> FIXED
- ⚠️ **And the live run caught what no reviewer had:** using tmux's exact-match
  target everywhere BROKE THE CLAIM, because `set-option` and `show-options`
  reject that form. A created agent came back anonymous on the board, which is
  the blocker this whole branch exists to remove, reintroduced by its own fix.

#### Iteration 7
**New findings:** 0 BLOCKERs, 6 WARNINGs, 4 NITs
- [WARNING] engine/create.js — **"MEASURED on tmux 3.6a" was itself a
  mis-measurement**: the probe ran against a session an earlier command had
  killed, so "can't find" was true for a reason unrelated to the syntax. The
  test had enshrined it and would have failed a correct change --> FIXED
- [WARNING] web/index.html — Create It could be left permanently disabled --> FIXED
- [WARNING] web/index.html — a PARTIAL started a watch for something the rollback
  guaranteed could never arrive --> FIXED
- [WARNING] engine/create.js — a loaded service with no plist on disk (what the
  README's own removal steps produce if the `rm` runs first) --> FIXED
- [WARNING] engine/create.js — the folder-only refusal, which `rollBack`'s premise
  rests on, had no test --> FIXED
- [WARNING] server.test.js — the `paintMade` test stubbed the function whose
  screen-reader words it was covering --> FIXED

#### Iteration 8
**New findings:** 0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] engine/status.js — **path traversal**: the real tmux session is
  interpolated into a registry filename and tmux accepts a `/` in a session name,
  so `../../x-discord` read a file outside the root --> FIXED
  - ⚠️ The first version of that test was VACUOUS; the mutation run caught it
    (decoy planted where the traversal never looks) --> FIXED
- [WARNING] web/index.html — a superseded response re-armed a control a newer
  creation owned --> FIXED
- [WARNING] web/index.html — a rolled-back PARTIAL drew ticks above "Nothing was
  made" --> FIXED (steps render as undone)
- [WARNING] engine/instructions.js — `read()` was the fourth reader guessing the
  session --> FIXED
- [WARNING] engine/create.js — rollback did not unload; messages asserted more
  than was verified --> FIXED
- [CONVENTION] docs/screenshots — a committed screenshot rendered a real absolute
  path carrying the operator's account name and a session UUID, in a repo whose
  own policy is "treat every commit as public" --> FIXED (re-shot)

#### Iteration 9
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] engine/create.js — the launcher used a DENYLIST of shell names, the
  exact defect `engine/status.js` documents and replaced with an allowlist. A
  crashed agent whose pane held `vim` read as alive, was adopted, and supervised
  forever so `KeepAlive` could never recover it --> FIXED
  - ⚠️ While fixing it I duplicated the heredoc terminator. `bash -n` passed.
    **The behavioural test caught it as a timeout.**
- [WARNING] engine/instructions.js — `write()` was the fifth reader --> FIXED
- [WARNING] engine/create.js — a failed bootstrap needs `bootout`, not just an
  unlink --> FIXED
- [WARNING] web/index.html — a PARTIAL announced nothing to a screen reader --> FIXED
- [CONVENTION] web/index.html — the radiogroup promised a keyboard model it did
  not implement --> FIXED (arrow keys + roving tabindex, verified in a browser)

#### Iteration 10
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] engine/status.js — **the claim arm created a name collision the suffix
  arm never could.** Any local process can `tmux new -s angel` and set the option;
  both panes then ranked identically and the winner was whichever tmux listed
  first. Measured: the roster came back with the impostor alone --> FIXED
- [WARNING] engine/create.test.js — three filesystem assertions could not fail --> FIXED
  (proved by moving the refusal after the writes, which the old ones sat through)
- [WARNING] engine/status.js — the at-prompt premise is unpinned --> DEFERRED, see below
- [CONVENTION] the proof file did not exist yet --> FIXED (this file)
- [NIT] engine/create.js — the version match was a glob, looser than the
  definition it claimed parity with --> FIXED (regex, verified by running it)

#### Iteration 11
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] engine/status.js — **the round-10 tie-break was incomplete in the
  worst direction**: it only preferred a suffixed pane that was RUNNING, so a real
  agent crashed to a shell still lost its name to a claimed impostor. The crash is
  then hidden on the card whose Restart button exists for it, and a write still
  reaches the real agent's boot file --> FIXED (unconditional offset)
- [WARNING] engine/create.js — the collision gate compared raw names while every
  route resolves by `store.safeKey`, so it would create `mybot` beside a live
  `my.bot-discord`: two names, one instruction file --> FIXED
- [WARNING] engine/status.test.js — the test reading as coverage of the at-prompt
  premise pins the ordering and nothing else --> FIXED (says so now)
- [WARNING] web/index.html — "project manager is the suggested default" was
  positional and unpinned, so reordering the role library could have made a
  caution-bearing role the silent default --> FIXED
- [CONVENTION] README.md — the headline "unknown, never healthy" rule did not
  record the narrowing the engine deliberately made --> FIXED

### Deferred, with reasoning

| # | Finding | Why it is deferred |
|---|---|---|
| 1 | The at-prompt rule makes `unknown` unreachable for a running Claude pane, and rests on a premise (a blocking dialog replaces the input box) that is asserted rather than measured | It is a claim about a UI this repo does not control, so no test here can hold it. The alternative was leaving a freshly created agent reading "we cannot see this one, so we are not telling you it is fine" the moment its last output scrolled away. **The operator signed off on this trade explicitly** (2026-08-10). Named in the code, in the README's statement of the rule, and in the test that would otherwise look like coverage of it. A pane-content-staleness signal is the real fix and is follow-up work. |
| 2 | `POST /api/agents` runs synchronously on a single-threaded server, so a hung `launchctl` blocks the board and its own verification | Real, and not made worse by this branch: every route here is synchronous. Making this one async is a change to how the server handles every request and deserves its own PR. |
| 3 | `sessionOf` runs a second `paneRoster()` per instructions request, so the gate and the session come from two snapshots | The shape that removes it is a single `claimantFor` whose card both the gate and the session read from, which changes how every name-keyed route resolves. Noted in the code at the call site. |

### Verification that is not a test

Run against this machine, not asserted in a fixture:

- An agent created **through the UI**, end to end, no terminal. Board reads its
  name, its role, its state, and (once it had answered once) its model and memory
  ring. First action shown matches the role chosen.
- `launchctl kickstart -k` **adopted** the running session rather than replacing
  it: same `session_created` before and after, and the log says why.
- Before the adoption branch existed, the same test showed the session correctly
  **recreated with its claim intact**, and the PID stable 40 seconds later, which
  is what proves there is no respawn loop.
- The CSRF hole was **reproduced** before it was fixed: a cross-origin
  `text/plain` POST created a real worker directory and installed a real launchd
  job, both removed afterwards.
- Arrow-key navigation of the role picker verified in a real browser.
- Every artifact of every live run removed, and the machine's state checked back
  to what it was: 13 sessions, one launchd job, twelve worker folders.

### Strengths carried across iterations

- `crossSiteWrite` survived direct attack in four separate rounds (typeless
  `Blob` bodies, `sendBeacon`, `<a ping>`, form enctypes, `Origin: null`, trailing
  dots, IPv6, userinfo in `Host`) with no browser-reachable bypass found.
- Running the generated bash against a fake tmux, rather than asserting its text,
  caught two things reading it could not.
- Anti-vacuity controls throughout: the accepted-count check in the name property
  test, the empty-board control in the roster gate, the renamed decoy in the
  twin-transcript test, and `unknown` as the control in `boardCanSeeIt`.
- Every new guard in this loop was mutation-tested: the guard was broken
  deliberately and the suite was confirmed to fail.
