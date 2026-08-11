---
pre_challenge: true
method: challenge-loop
branch: remove-an-agent
diff_hash: 265395d3c541070e6664d62ca3a43d860763fe899045314476cf94d61058746f
subdir_audit: n/a
timestamp: 2026-08-11T17:48:19Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes. Rounds 9 and 10 independently recommended merge, and round
10 reached that verdict by reverting nine guards in a sandbox and watching a
test fail for each rather than by reading the code.
**Total findings:** 74 actionable (7 BLOCKERs, 30 WARNINGs, 9 CONVENTIONs, 28 NITs)
**Fixed:** 71 | **Deferred:** 3

⚠️ **The finding rate did not decline the way this skill's premise predicts.**
Rounds 2 through 8 each produced at least one BLOCKER, and **six consecutive
rounds found the defect inside the previous round's fix.** That is the single
most useful thing this loop produced, and it is recorded per-round below rather
than smoothed into a total.

⚠️ **Rounds 6 onward changed technique, and that is why they kept finding
things.** Instead of reading the code, they copied the repo to `~/.cache/` and
reverted individual guards to see which ones the tests would notice. Round 6
reverted 49 and **15 survived** — a third of the safety code on the branch was
deletable with the suite green. Reading found the first five rounds' defects;
mutation found the rest.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 5 WARNINGs, 4 CONVENTIONs, 6 NITs
- [WARNING] `engine/remove.js` — `recordRemoval` on the four partial paths was the only call outside `step()`; a throw left an agent stopped, disabled and unrecoverable --> FIXED (a5da103)
- [WARNING] `server.js` — the four removal routes were handed straight to the socket, contradicting a convention stated in that same file --> FIXED
- [WARNING] `engine/remove.js` — every outcome message spoke the SESSION name while the confirmation spoke the DISPLAY name --> FIXED
- [WARNING] `web/index.html` — the removed list rendered the session name, so the undo path was unrecognisable for exactly the agents it was rebuilt for --> FIXED
- [WARNING] restore's uncovered branches (missing plist, failed enable, "already loaded", no job) --> FIXED
- [CONVENTION] screenshots carried the design Josh had reversed --> FIXED
- [CONVENTION] a comment claiming the screen "reads identically in greyscale", **measured false** (~204 vs ~199) --> FIXED
- [CONVENTION] an inert `eslint-disable` in a repo with no eslint --> FIXED
- [CONVENTION] a comment separated from the code it documents --> FIXED

#### Iteration 2
**New:** 1 BLOCKER, 6 WARNINGs, 2 CONVENTIONs, 3 NITs
- **[BLOCKER]** `engine/remove.js` — three partials opened "we stopped X from starting again" for agents that had no startup job. The message reported an action nobody performed --> FIXED (78d3bba)
- [WARNING] `readRemoved` fails open by design; using that as the base of a read-modify-write **destroys every other removed agent's `label`, `plist` and `shownAs`** on one transient EACCES --> FIXED
- [WARNING] restore reported "we started X again" having watched the enable fail --> FIXED
- [WARNING] the browser composed its own description of what removal does, and it was false for a jobless agent --> FIXED
- [WARNING] a 500 or unparseable body rendered as "we cannot remove this agent" — a claim about the agent from a server failure --> FIXED
- [WARNING] the README's by-hand recipe omitted `launchctl enable`, leaving a disabled override nothing records --> FIXED
- [WARNING] `assert.match(raw, /Escape/)` **could not fail** — the word appears in an HTML comment --> FIXED
- [CONVENTION] three style values that do not exist (`--warn`, `--radius-sm`, a literal 12px) --> FIXED

#### Iteration 3
**New:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 3 NITs
- **[BLOCKER]** `server.js` — **the removal routes were never brought under the borrowed-name gate.** Every other name-keyed route checks the card answering to a name really is that agent; this branch's history shows that gate corrected three times, and the removal routes joined neither it nor its "every write route" test. With the real `claudebot-discord` down and a bystander's `tmux new -s claudebot` up, Remove would have disabled the operator's actual PM --> FIXED (86b9ee8), gate moved into `plan` **before the first launchctl call**
- [WARNING] the CREATION name rule was refusing agents nobody named (`Notes`, `orch.main`, anything capitalised) --> FIXED, replaced with a path-safety check
- [WARNING] restore claimed "set to start again" with no plist left to load --> FIXED
- [WARNING] `paintRemoved` rewrote its DOM every 5s, wiping "Restore failed", replacing mid-flight buttons and dropping focus --> FIXED
- [CONVENTION] the data root re-derived instead of taken from the store --> FIXED

#### Iteration 4
**New:** 2 BLOCKERs, 3 WARNINGs, 3 NITs
- **[BLOCKER]** the last no-way-back branch said the agent "will still appear on the board" — **false**, the board is built from live panes and the session was killed --> FIXED (8598a5c)
- **[BLOCKER]** the change-detection cache I added in round 3 was never cleared on the empty branch, so a stale disabled "Restoring…" row could return and kill the undo path --> FIXED
- [WARNING] my throw-containment test never reached the write (the fixture made the READ throw) — **the fix was revertible with the suite green** --> FIXED
- [WARNING] a 500 from `/api/removed` rendered as "nothing has been removed" --> FIXED
- [WARNING] the payload carried `stopped` and the screen ignored it --> FIXED

#### Iteration 5
**New:** 2 BLOCKERs, 3 WARNINGs, 4 NITs
- **[BLOCKER]** `engine/remove.js` — **macOS volumes are case-insensitive**, so `remove('CASEY')` resolved the real agent's files, reported "casey has been removed", ran `disable`/`bootout` on a label that never existed, and left the real agent running. Reproduced in a sandbox --> FIXED (c8cbc59) via `existsExactly`
- **[BLOCKER]** a partial restore was treated as success, which could leave the undo button permanently dead --> FIXED
- [WARNING] the board's `stopped !== false` filter — the only thing keeping a possibly-running agent visible — **held by nothing** --> FIXED
- [WARNING] restore's `!forgotten` branch dead to the suite --> FIXED
- [WARNING] "it works on every agent on the board" was false for untied cards --> FIXED

#### Iteration 6
**New:** 2 BLOCKERs, 4 WARNINGs, 3 NITs — **49 mutations run, 15 survived**
- **[BLOCKER]** the partial-restore note I added in round 5 was erased by its own handler two lines later --> FIXED (2317514)
- **[BLOCKER]** the `UNREADABLE` refusal — **the invariant with the longest comment in the module** — held by nothing --> FIXED
- [WARNING] the post-kill look-again untested, and `world()` **could not express the case it was written for** (a kill reporting success over a live session) --> FIXED, fixture given a second knob
- [WARNING] three engine sentences added in late rounds, none tested --> FIXED
- [WARNING] **every browser-layer fix was invisible to the suite** --> FIXED with source-shape pins that state plainly they are a weaker instrument

#### Iteration 7
**New:** 1 BLOCKER, 3 WARNINGs, 2 CONVENTIONs, 3 NITs
- **[BLOCKER]** the same defect as round 6 **on the sibling path**, with a five-second fuse: restore fails in two directions and I reasoned about one --> FIXED (e43cd37) by moving the message out of the list so the distinction stops mattering
- [WARNING] two of four partial paths' record calls unheld — the two the module's own comment calls "the ones a person actually hits" --> FIXED
- [WARNING] `disable`-before-`bootout` — load-bearing, documented, **unheld** --> FIXED
- [CONVENTION] **the plan file claimed "every fix is mutation-verified" and it was not true** --> FIXED, corrected to what holds with the unreachable guards named

#### Iteration 8
**New:** 1 BLOCKER, 5 WARNINGs, 3 NITs
- **[BLOCKER]** round 7's fix put the message outside the *list* but inside the *container that gets hidden*. **And I had verified it** — asserted the list did not contain it and forced a repaint, both true and both irrelevant. The control was aimed at the mechanism I had in mind rather than at the way the thing breaks --> FIXED (cf6798e)
- [WARNING] the "no longer on the board" branch was one-way, leaving live write controls under a sentence saying nothing here can change it --> FIXED
- [WARNING] **none of the four route try/catch guards was held** --> FIXED, driven through the real server with a throwing engine
- [WARNING] the deliberate "a PARTIAL answers 200" decision unheld --> FIXED
- [WARNING] `paintRemoved` was the only async path with no generation token --> FIXED
- [WARNING] the case-insensitivity hazard, a third site --> FIXED

#### Iteration 9
**New:** 1 WARNING, 6 NITs. **Recommended merge.**
- [WARNING] a live region inside a hidden panel announces nothing — the same class as round 8 --> FIXED (6a1e87f)
- [NIT] two comments in one handler asserting opposite things about the cache --> FIXED
- [NIT] three pieces of tab state (`paintRemoved` re-showing under Settings; `#removed-msg` never hidden; the removal offer never re-asked) --> FIXED
- [NIT] the success sentence's `existsExactly` unheld --> FIXED

#### Iteration 10
**New:** 2 WARNINGs, 3 NITs. **Recommended merge**, after reverting nine guards and confirming a test fails for each.
- [WARNING] **my round-9 fix introduced a regression**: the poll reset the section every five seconds, wiping the one message a person must not miss and stealing keyboard focus --> FIXED (5c42297)
- [WARNING] "you can put it back" and "is back on the board" are claims Restore cannot keep for an agent with no startup job --> FIXED
- [NIT] over-fitting: the comment density has a real cost, including a twelve-line comment justifying why a symbol is *not* exported --> **DEFERRED**, recorded as a known cost rather than swept in a tenth pass

### Deferred

| Finding | Reasoning |
|---|---|
| Comment density / first-person narration of prior rounds | Real cost, acknowledged. Rewriting ~60 comments to tidy them is its own risk on a branch this reviewed; the reasoning is load-bearing more often than not. |
| `restoreInner`'s `UNREADABLE` check untested | Unreachable: the `readRemoved` call above it fails open and refuses first. Named in the plan's unreachable-guard list rather than tested against a state nothing can produce. |
| No rendering test in the suite | The repo has taken no dependencies and adding one is Josh's decision, not something to slip into this branch. Stated plainly in the test that pins the browser fixes. |

### Verification, at every round

- `node --test` — **65 tests on main → 353 on this branch.**
- **A live remove/restore round trip against real launchd and real tmux**, on a throwaway `zz-kosmos-<pid>` agent, sandboxed at all three write roots. **20/20 checks, re-run after every round**, machine confirmed unchanged each time (13 sessions, 55 plists).
- **Rendered in a browser** — new for this repo, and what found the transparent modal, the dead-looking tabs, and every message-lifetime defect.
- Every fix that can be reached is **mutation-verified**: reverted, watched the test fail, restored.

### Strengths (across all iterations)

- The `isRemoved` / `isHidden` split, held at three layers, and the reason a half-removal is simultaneously recorded, visible and retryable.
- `existsExactly` over `existsSync`, with the measured harm written down: a persistent launchd override under a label that never existed, recorded nowhere on disk.
- The ownership gate in `plan`, before the first `launchctl` call rather than after, with both it and the later session check pinned by a roster that changes between them.
- The undefined-custom-property test: self-testing, stated as "one more than the real file has" so the control cannot blame the instrument, and it found a pre-existing defect on `main`.
- Tests that assert the wrong sentence does **not** appear, which is the half most suites skip.
