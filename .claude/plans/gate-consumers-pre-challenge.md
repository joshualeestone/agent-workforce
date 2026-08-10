---
pre_challenge: true
method: challenge-loop
subdir_audit: passed
timestamp: 2026-08-10T14:35:00Z
iterations: 9
converged: false
branch: gate-consumers
diff_hash: de39b143e4a181949c3db86071d91fed5d19d3fcc08572af58b02e2cfe987a9e
tests: 238 passing, 0 skipped
generated: 2026-08-10
---

# Challenge loop proof — gate-consumers

## ⚠️ Converged: NO, and that is why this is a separate PR

Nine blind review rounds ran across this work while it shared a branch with the
status engine. **Five consecutive rounds found nothing in the engine and
something here every time**, including one blocker inside the fix for the round
before it. The engine was split out and merged separately (`roster-rework`)
rather than be held up by a layer that was still moving.

**This layer should be reviewed as work in progress that closes a live hole**,
not as settled code. Every finding below is fixed and pinned; the honest signal
is the *rate*, not the backlog.

## Ledger — findings against the consumers

| # | Round | Category | Finding | Status |
|---|---|---|---|---|
| 1 | 1 | BLOCKER | `knownAgent` gated every **write** route on the session name, so with a real agent's session down, `tmux new -s angel` unlocked `PUT /instructions` — rewriting the file that agent boots from — plus the avatar and profile routes. **Reachable on `main` today.** | FIXED |
| 2 | 2 | BLOCKER | `/api/status` attached `commitments.read` and `instructions.staleness` ungated, so the leak the engine closed was reopened one layer up: an untied card carried the real agent's **commitment text**, its **boot-file hash**, and a `startedAt` read from its transcript. | FIXED |
| 3 | 2 | WARNING | The comment on fix #1 asserted "this is the only consumer in this tree". **The two leaking consumers were 200 lines below it in the same file.** | FIXED |
| 4 | 2 | BLOCKER | Fix #1 silently removed instruction/profile/avatar editing from every **legitimate non-Discord agent** — re-coupling the write surface to the suffix on work whose purpose is decoupling it — and the board went on advertising the edit, so every click 404'd. | FIXED (cost documented) |
| 5 | 3 | WARNING | `GET /commitments` was the **third** name-keyed consumer, missed by the comment written to correct an earlier completeness claim. | FIXED |
| 6 | 3 | WARNING | The first gate for it used `knownAgent` and was too strict: a record's purpose is to outlive the conversation, so a **stopped** agent must stay readable. | FIXED |
| 7 | 4 | WARNING | `GET /avatar` was the **fourth**. The comment introducing the third calls itself "the THIRD". Three corrections, each missing one. | FIXED |
| 8 | 4 | WARNING | `borrowedName` compared a **sanitised** key against a **raw** session name, so every alias spelling slipped past — and the only thing stopping the leak was an unrelated guard elsewhere, so the gate's own comment claimed a protection it was not providing. | FIXED |
| 9 | 4 | WARNING | Its catch **failed open**: a roster read that threw served the record. | FIXED |
| 10 | 5 | WARNING | The predicate then broke the **opposite** direction: it took the first matching card, so a **healthy agent went offline** because a stranger's alias sorted before it. | FIXED |
| 11 | 5 | WARNING | Gating on the avatar route put a full `snapshot()` — one `capture-pane` **per agent** — on the board's 5-second polling path. Measured **59ms** per call; on 13 agents that is **767ms** of blocked event loop and ~170 extra subprocess spawns per tick. Replaced with a captures-free roster: **3ms**, so 767ms → 39ms. | FIXED |
| 12 | 6 | BLOCKER | The predicate, third direction: asking **per-key** restored availability and **reopened the leak** for the untied card's *own* spelling — the exact URL a consumer would build from that card. | FIXED |
| 13 | 6 | BLOCKER | `knownAgent` was never taught the lesson `borrowedName` learned three times, so the **reads refused correctly while the writes accepted**. Both now derive from one `claimantFor()`. | FIXED |
| 14 | 7 | BLOCKER | The detail panel skipped the instruction *load* for an untied card but never **cleared** it, so opening a tied agent then an untied one left the real agent's **boot file on screen with Save live**. | FIXED |
| 15 | 7 | WARNING | The test written to prove the panel withdraws what it cannot do asserted **source shape** — all four assertions held while the editor sat live holding another agent's file. | FIXED |
| 16 | 8 | BLOCKER | Replacing it with a behavioural test removed the only assertions pinning the **call site**: deleting the panel's three gate lines reverted the whole UI half with the suite green. | FIXED |
| 17 | 8 | WARNING | The gate ran at panel-open only; the **poll never re-applied it**, so an agent whose session died while its panel was open kept showing its boot file on a card that had become a stranger's. | FIXED |
| 18 | 8 | WARNING | The explanation shown in place of the withdrawn controls was a **tautology in every case it could fire**, and styled by a CSS class that did not exist. | FIXED |

**Deferred:** none.

## Findings, in review format

```
[BLOCKER] server.js — knownAgent gated every WRITE route on the session name, so with a real agent's session down, `tmux new -s angel` unlocked PUT /instructions and rewrote the file that agent boots from. Reachable on main today.
[BLOCKER] server.js — /api/status attached commitments.read and instructions.staleness ungated, reopening the leak one layer up: an untied card carried the real agent's commitment text, boot-file hash, and a startedAt read from its transcript.
[BLOCKER] server.js — Gating knownAgent silently removed editing from every legitimate non-Discord agent, and the board went on advertising the edit, so every click 404'd.
[BLOCKER] server.js — Asking the gate per-KEY restored availability and reopened the leak for the untied card's OWN spelling, the exact URL a consumer builds from that card.
[BLOCKER] server.js — knownAgent was never taught the lesson borrowedName learned three times, so the reads refused correctly while the writes accepted. Both now derive from one claimantFor().
[BLOCKER] web/index.html — The detail panel skipped the instruction load for an untied card but never cleared it, leaving the real agent's boot file on screen with Save live.
[BLOCKER] server.test.js — Replacing a source-shape test with a behavioural one removed the only assertions pinning the call site: deleting the panel's three gate lines reverted the whole UI half with the suite green.
[WARNING] server.js — The comment on the first fix asserted "this is the only consumer in this tree". The two leaking consumers were 200 lines below it in the same file.
[WARNING] server.js — GET /commitments was the third name-keyed consumer, missed by the comment written to correct an earlier completeness claim.
[WARNING] server.js — The first gate for it used knownAgent and was too strict: a record's purpose is to outlive the conversation, so a stopped agent must stay readable.
[WARNING] server.js — GET /avatar was the fourth. Three corrections, each missing one.
[WARNING] server.js — borrowedName compared a sanitised key against a raw session name, so every alias spelling slipped past; the only thing stopping the leak was an unrelated guard elsewhere.
[WARNING] server.js — Its catch failed OPEN: a roster read that threw served the record.
[WARNING] server.js — The predicate then broke the opposite direction: it took the first matching card, so a healthy agent went offline because a stranger's alias sorted before it.
[WARNING] server.js — Gating on the avatar route put a full snapshot() (one capture-pane per agent) on the board's 5-second polling path: 59ms per call, 767ms of blocked event loop per tick on 13 agents. Now 3ms / 39ms.
[WARNING] web/index.html — The gate ran at panel-open only; the poll never re-applied it, so an agent whose session died while its panel was open kept showing its boot file on a card that had become a stranger's.
[WARNING] web/index.html — The explanation shown in place of the withdrawn controls was a tautology in every case it could fire, and styled by a CSS class that did not exist.
[WARNING] server.test.js — The test written to prove the panel withdraws what it cannot do asserted source shape; all four assertions held while the editor sat live holding another agent's file.
[STRENGTH] — Both gates derive from ONE claimantFor(), so a lesson learned by one is structurally impossible for the other to miss. Both directions are pinned: the leak, and the case where a gate takes a healthy agent offline.
[STRENGTH] — Every gate mutation-tested. The five whose first mutation did not fail were treated as unpinned and given real tests before being accepted.
[STRENGTH] — The gates run off a captures-free roster rather than a full snapshot, keeping a 5-second polling path at 39ms rather than 767ms of blocked event loop.
```

## Verification method

Every gate was **mutation-tested** — deleted or inverted, suite run, a **named**
test confirmed to fail. Gates whose first mutation did *not* fail (#2, #7, #11,
#13, #16) were treated as unpinned and given real tests before being accepted.

**Both directions are pinned deliberately**: the leak *and* the case where a gate
takes a healthy agent offline. Findings #10 and #12 are what that is for.

## What this layer's failure pattern was

**One predicate was wrong in three different directions** — leaking, then taking
a healthy agent offline, then leaking again under a different spelling. Each fix
was a correct response to the failure in front of it and wrong about the shape of
the question.

**And a gate learned a lesson its twin did not**, four times running: six
name-keyed consumers were found one at a time, each by a comment that claimed to
enumerate them. That is why the two gates are now thin wrappers over one
predicate rather than two implementations.
