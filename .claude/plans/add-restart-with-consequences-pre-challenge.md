---
branch: add-restart-with-consequences
diff_hash: 89d1fe5c6cb66233bddeeec6caf02d11b368e964d8ce2c088fdf0e20b50b2330
rounds: 10
tests: 280 passing, 0 skipped
generated: 2026-08-10
---

# Challenge loop proof — add-restart-with-consequences

Ten independent blind review rounds. Each round spawned a fresh reviewer with no
knowledge of prior findings, reading the full diff and the plan.

## Ledger

| # | Round | Category | Location | Finding | Status |
|---|---|---|---|---|---|
| 1 | 1 | BLOCKER | `engine/status.js` `rank()` | A name-colliding session **running Claude** tied with the real agent; tmux lists the impostor first, so it won. Real agent vanished from the board; the surviving card read the real agent's commitments, typed `/clear` into the impostor's pane, and tombstoned the real agent's record. | FIXED `0765869` |
| 2 | 1 | BLOCKER | `engine/status.js` `rank()` | Inside a real session, a bare `node` pane tied with the Claude pane and won on index. `/clear` + Enter into `node` is **executed**. | FIXED `0765869` |
| 3 | 1 | WARNING | `engine/status.js:133` | Docstring claimed the `-discord` suffix test "alone closes" the collision hazard. Untrue once the process arm landed. | FIXED `0765869` |
| 4 | 1 | WARNING | `engine/lifecycle.js:431` | Docstring named `isAgentSession` where the code checks `isFleetSession` — same fact, two statements, the stricter one wrong. | FIXED `0765869` |
| 5 | 1 | WARNING | `docs/install.md:144,290` | Claimed every safety check keys on the `-discord` suffix. Made false by the decoupling commit. | FIXED `0765869` |
| 6 | 2 | BLOCKER | `engine/lifecycle.js` `mayTypeInto` | The **lone impostor**: when the real agent is dead there is no competing pane to outrank, so a stranger's session wins the name by default. Restart addresses the launchd **service**, not the pane. | FIXED `b96f284` |
| 7 | 2 | WARNING | `server.js` tombstone | Marking a record from an untied pane asserts destruction of work that still exists. | FIXED `b96f284` |
| 8 | 2 | WARNING | `server.js` `because` | The deliberate refusal reused "we could not update our record" — a considered decision reported as a failed write. | FIXED `fad09c6` |
| 9 | 2 | WARNING | `server.test.js` | The test written for the tombstone gate asserted `state !== 'destroyed'`, which is true either way (a successful tombstone leaves `unknown`). Pinned nothing. | FIXED `fad09c6` |
| 10 | 3 | WARNING | `docs/install.md` | The round-1 correction **overshot**: restart *is* refused without the suffix, and an npm-global agent is not recognised at all. Wrong in both directions within an hour. | FIXED `fad09c6` |
| 11 | 3 | WARNING | `server.js` `untied` | Ignored `hadRecord`, so a name that never reported was told we had carefully left its record alone. | FIXED `fad09c6` |
| 12 | 3 | WARNING | `server.js` | The untied sentence interpolated the raw URL segment instead of the safe key. | FIXED `fad09c6` |
| 13 | 3 | WARNING | `engine/status.js` `rank()` | A private copy of the native-Claude regex, making three. `rank` decides which pane a destructive action reaches. | FIXED `fad09c6` |
| 14 | 3 | WARNING | `web/index.html` | Double-submit reachable by clicking Restart, pressing Escape, and reopening. Two overlapping `launchctl` cycles at one service. | FIXED `fad09c6` |
| 15 | 4 | WARNING | `server.js` `findAgent` | `safeKey` **strips** rather than rejects, so `my.bot` and `mybot` collapse to one key. The confirmation token does not fail closed: when neither has reported, both produce the identical token. | FIXED `026d3a3` |
| 16 | 4 | WARNING | `server.js` `start()` | The blast-radius paragraph said "Restart is next" in the diff that shipped restart, and README points readers at it. | FIXED `026d3a3` |
| 17 | 4 | WARNING | `server.js` | `untied` existed only inside an English sentence, so the only way to pin it was matching prose. | FIXED `026d3a3` |
| 18 | 4 | WARNING | `web/index.html` | The UI discarded the per-item `destroyed` flag the store works to produce. | FIXED `026d3a3` |
| 19 | 4 | WARNING | `server.js` | **A guard I built that could not fire.** `perform` is `execFileSync`, so the event loop is blocked and a second request cannot begin. Dead code wearing the costume of a protection. | REMOVED `026d3a3` |
| 20 | 5 | BLOCKER | `web/index.html` `holdingBlock` | The dialog never read `isNamedOurs`, so an untied pane showed the **real agent's** commitments as the cost. The server refuses the tombstone but only says so *after* the clear is sent. | FIXED `ff87a42` |
| 21 | 5 | BLOCKER | `web/index.html` `.badge.gone` | The DESTROYED badge inherited an ink failing AA: 2.65:1 light, 3.16:1 dark, against 4.5:1. The one badge whose job is saying an item is gone. | FIXED `ff87a42` |
| 22 | 5 | WARNING | `server.js` | The protection list claimed "a single-flight guard per agent" — written, then the guard deleted in the same session. | FIXED `ff87a42` |
| 23 | 5 | WARNING | `server.js` `may` | Published `ok: true` for an agent whose POST answered 404. | FIXED `ff87a42` |
| 24 | 6 | BLOCKER | `engine/status.js` `rank()` | **Deferred as a warning in round 5 and that was wrong.** A bare `node` pane outranked the agent's own crashed shell, so a watcher won the name when the agent died — hiding the crash on the one card whose Restart button exists for it. | FIXED `1b2ca02` |
| 25 | 6 | WARNING | `server.js` `addressable` | Allowed case folding while the resolver matched a lower-cased key, so `Mikey-discord` was advertised as actionable and 404'd. The generous clause reintroduced the disagreement it sat beside. | FIXED `1b2ca02` |
| 26 | 6 | WARNING | `web/index.html` | Clip-path id interpolated `sessionName` raw into `id=""` and `url(#)`. | FIXED `1b2ca02` |
| 27 | 6 | WARNING | `web/index.html` | "The rest are the last thing it told us" when every item was destroyed and there was no rest. | FIXED `1b2ca02` |
| 28 | 6 | WARNING | `engine/lifecycle.js` | The `REFUSED + mayHaveLanded` **call site** was pinned only as a unit. | FIXED `1b2ca02` |
| 29 | 7 | WARNING | `server.test.js` | **The route test written in round 6 never entered its own branch.** `REFUSED` is only reachable from `sendCommand`'s catch; the runner *returned* a failure value. `[200, 409]` hid it. | FIXED `3050533` |
| 30 | 7 | WARNING | `web/index.html` `renderFresh` | Round 5's blocker half-fixed: the warning landed, the cost line beneath still promised "all 3 items above". Two contradictory costs, and the primary decision text was the wrong one. | FIXED `3050533` |
| 31 | 7 | WARNING | `web/index.html` | Two **absent-means-safe** defaults on the destructive screen. | FIXED `3050533` |
| 32 | 7 | WARNING | `web/index.html` `losesAll` | Pointed at "the list above" when there is no list — the state of every agent that has never reported. | FIXED `3050533` |
| 33 | 7 | WARNING | `server.js` | Three more stale alias claims describing spellings that no longer reach any route. | FIXED `3050533` |
| 34 | 8 | WARNING | `engine/status.js` | **Two definitions of "a Claude process is running here"**, and the looser decided what the board asserts. `classify` used a six-name denylist; `-zsh` is absent from it despite the suite using it as the crashed case. A crashed agent whose pane was an editor got classified from the editor's screen text. | FIXED `fd9c486` |
| 35 | 8 | WARNING | `web/index.html` `optionBlock` | Round 7's absent-`may` fix then read `may.because` — a TypeError on the exact case its comment claims to handle, before the dialog is unhidden. | FIXED `fd9c486` |
| 36 | 8 | WARNING | `server.js` `may` | Did not consult `perform`'s containment rules: `_bot-discord` published three enabled buttons and every POST answered 409. | FIXED `fd9c486` |
| 37 | 9 | WARNING | `engine/status.js` | A comment declaring an **open** defect the same commit had closed — the inverse stale claim, which invites re-loosening `classify`. | FIXED `05d00ca` |
| 38 | 9 | WARNING | `web/index.html` | The untied warning rendered as a broken sentence in the items-absent shape. | FIXED `05d00ca` |
| 39 | 9 | WARNING | `tools/screenshot-fixture.js` | Applied one of three gates under a comment claiming it used the real rule. | FIXED `05d00ca` |
| 40 | 9 | WARNING | `web/index.html` | `ACTIONS` fallback validated one key of three before replacing the whole object. | FIXED `05d00ca` |
| 41 | 10 | WARNING | `engine/status.js` `rank()` | Round 6's swap **over-corrected**: `claude`/`claude.exe` are not ambiguous the way `node` is, so a live legacy-install agent lost to a shell and read as dead. | FIXED `a3f3223` |
| 42 | 10 | WARNING | `engine/lifecycle.js` `verdictFor` | Docstring claimed three gates ran "in the order the route applies them". The route applied two. | FIXED `a3f3223` |
| 43 | 10 | WARNING | `server.test.js` | An assertion hardcoded that every fixture agent must be restartable, **structurally forbidding** an untied agent — so the most consequential warning on the screen was unphotographable. | FIXED `a3f3223` |

**Deferred:** none. **Unresolved and carried to the PR:** live fleet data in
`main`'s history (cannot be fixed from a feature branch — see plan §5.6).

## Verification method

Every guard was **mutation-tested**: deleted or inverted, the suite run, and a
**named** test confirmed to fail. Guards where the first mutation attempt did
*not* fail (#9, #19, #23, #29, #36, #42) were treated as unpinned and given real
tests before being accepted.

Colour values were **computed**, not estimated: WCAG relative luminance, AA 4.5:1
for normal text and 3:1 for large text and non-text boundaries.

## What this branch's failure pattern was

Roughly **half of all findings were defects introduced by the fix for a previous
finding**, across all ten rounds. The sharper form, seen six times: a fix for a
*coverage* problem that created a new coverage problem while the suite went
green. And three times a **verification step was itself wrong** — a mutation that
tested the branch a test covered rather than the branch it claimed to cover, a
constant applied to an input it does not space, and a concurrency guard that
could not execute.

The mitigations now in the code: one derivation per fact (`isClaudeCommand`,
`isNativeClaude`, `verdictFor`, `PANE_COLUMNS`), absent-means-refused defaults on
every destructive path, and tests that select fixtures by name or by the engine's
own answer rather than by a re-derived predicate.
