---
pre_challenge: true
method: challenge-loop
subdir_audit: passed
timestamp: 2026-08-10T14:31:39Z
iterations: 9
converged: false
branch: roster-rework
diff_hash: 15c04348fbdc1a19eb4748633a4d3c06bfda305ac83df381ffd51c774b8d31be
rounds: 9
tests: 226 passing, 0 skipped
generated: 2026-08-10
---

# Challenge loop proof — roster-rework

Nine independent blind review rounds. Each spawned a fresh reviewer with no
knowledge of prior findings, reading the full diff and the plan.

⚠️ **This branch was split out of `add-restart-with-consequences` after ten
rounds on that branch, and the split immediately earned itself**: reviewing this
engine alone surfaced defects that ten rounds on the combined diff never had.

## Ledger — findings against the engine

| # | Round | Category | Finding | Status |
|---|---|---|---|---|
| 1 | 1 | BLOCKER | `snapshot()` derived identity, model, context, avatar and profile from `pane.name` with no tie check. Measured: a stranger's `tmux new -s claudebot` produced a card named **Splinter**, role **Project Manager**, with the real agent's model and a **24% context ring at STRUCTURED confidence**, while the state and target were the stranger's. | FIXED `26a4da0` |
| 2 | 1 | BLOCKER | `classify()` consulted only `pane.command`, so a session the engine had **already rejected** got a scraped state — a `node` dev server showing a confirmation prompt read as `needs_you` and took a slot in the board's headline count. | FIXED `26a4da0` |
| 3 | 1 | WARNING | `RANK_INFERRED` unpinned: replacing it with `RANK_NONE` left the suite green while a non-Discord agent with a split window silently read as stopped. | FIXED `26a4da0` |
| 4 | 1 | WARNING | `isAgentPane`'s `inMode === '0'` allowlist unpinned — the guard that stops a hand-built pane object getting a permissive answer. | FIXED `26a4da0` |
| 5 | 1 | WARNING | `paneOrder` entirely unpinned: replacing its body with `return 0` left the suite green, so a same-rank tie silently reverted to tmux's listing order. | FIXED `26a4da0` |
| 6 | 1 | WARNING | `isNamedOurs` neither exported nor pinned on the snapshot — a consumer reading `=== false` would silently permit everything if the field vanished. | FIXED `26a4da0` |
| 7 | 2 | BLOCKER | **The identity fix was incomplete on its own terms**: `hasAvatar` and `profile` were still name-keyed, so the stranger's card rendered the real agent's **photograph**, and the detail panel showed the real operator-set role (it reads `profile.role \|\| role`, so `role: null` was only the fallback). | FIXED `3c7140e` |
| 8 | 2 | WARNING | The test written for finding #1 was **machine-dependent**: it named a real agent, so it only failed where that agent's registry entry and transcript happened to exist. On a clean checkout it was vacuously true. | FIXED `3c7140e` |
| 9 | 3 | WARNING | The rewritten test was **vacuous in three assertions**: `model`, `context` and `hasAvatar` read from places the fixture never seeded, so every `null` it asserted was `null` with the gate deleted too. | FIXED `09d02d8` |
| 10 | 3 | WARNING | Fixing that took three attempts — seeding the registry left `model` null because it resolves a session id and then reads the **transcript** that id names; and the avatar could not be seeded at all because `store.js` hardcoded its root **while a comment claimed the sandbox covered it**. | FIXED `09d02d8` |
| 11 | 4 | BLOCKER | **The suite wrote into the operator's live `~/.claude`** — a phantom `ghostly-discord_0.0.json` beside fifteen real registry entries, and a phantom `projects/seeded/`. Removed neither. Fleet tooling scanning the registry would have picked it up. | FIXED `8670d39` |
| 12 | 4 | BLOCKER | Worse: because those files **persisted between runs**, the test's own anti-vacuity check passed off the previous run's leftovers. Deleting the seeding would have left the suite green forever on any machine that had run it once. | FIXED `8670d39` |
| 13 | 5 | WARNING | `rank()` demoted `claude`/`claude.exe` along with `node`, so a pane running literally `claude` **lost to a shell** — a healthy agent on a legacy install read as dead while `classify` reported the same command as running. | FIXED `a3f3223` (carried) |
| 14 | 5 | WARNING | `parsePanes` gave a missing `command` the value `''`, which `classify` turned into `stopped` at STRUCTURED confidence — a confident structural claim from a field that carried no information. Empty and absent now both mean absent. | FIXED `09d02d8` |
| 15 | 6 | WARNING | `classify`'s gate was pinned only in the loosening direction: tightening it to `isNamedOurs` left every test green while making every non-Discord agent report "not one of your agent sessions". | FIXED `09d02d8` |
| 16 | 7 | WARNING | Two comments in the file disagreed about what restart gates on, and one described a defect the **same commit had closed** — inviting a reader to "fix" it by re-loosening `classify`, which is the actual bug. | FIXED `05d00ca` |
| 17 | 8-9 | — | Remaining findings in these rounds were in the **consumer layer**, which is now branch `gate-consumers`. Five consecutive rounds found nothing in the engine. | SPLIT OUT |

**Deferred:** none.

## Verification method

Every guard was **mutation-tested**: deleted or inverted, the suite run, and a
**named** test confirmed to fail. Guards whose first mutation did *not* fail
(#3, #4, #5, #6, #9, #15) were treated as unpinned and given real tests before
being accepted.

The suite is now **hermetic**: `AGENT_WORKFORCE_WORKERS`, `AGENT_WORKFORCE_DATA`
and `AGENT_WORKFORCE_CONFIG_ROOT` are all sandboxed before the engine loads, the
sandbox is removed on exit, and a full run was verified to leave nothing behind
in `~/.claude`, `~/work/workers` or the avatar and profile store.

## What this branch's failure pattern was

**Every blocker after the first round was a defect in the previous round's fix**,
and three of them were in a *verification step* rather than in code:

- A test that named a real agent, so it only failed on the machine that had one.
- A rewrite of that test that was vacuous in three of its assertions, because the
  fixture had no data for the gate to be stopping.
- A fixture that wrote into the real config, so its own anti-vacuity check passed
  off the previous run's leftovers.

The mitigations now in the tests: a **tied control card** asserted alongside every
untied assertion, an existence check on the seed itself, and hermetic roots so no
assertion can be true by accident of the machine.
