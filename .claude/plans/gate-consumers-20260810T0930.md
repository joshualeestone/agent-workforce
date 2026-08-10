# Plan: gate-consumers

**Branch:** `gate-consumers` (stacked on `roster-rework`)
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-10

## What this is

`roster-rework` taught the engine to say **whether a pane can be tied to the
agent name it would be filed under** (`isNamedOurs`). It publishes that and
nothing consumes it.

This branch is the consuming half: every read and write keyed on an agent name,
and the detail panel's write affordances.

## ⚠️ The hole it closes, which is live on `main` today

With a real agent's session **down** — or even **up**, before the fix below —
anyone opening `tmux new -s angel` gets a board card from which:

| request | on `main` |
|---|---|
| `PUT /api/agent/angel/instructions` | **rewrites the file the real agent boots from** |
| `GET /api/agent/angel/instructions` | returns its full text and absolute path |
| `PUT /api/agent/angel/profile` | overwrites its stored role |
| `DELETE /api/agent/angel/avatar` | deletes its picture |
| `GET /api/agent/angel/avatar` | serves its photograph |
| `GET /api/agent/angel/commitments` | serves its commitment text |

There is **no authentication on this server**, so "anyone" means any process on
the machine. All six were measured against the running server, not inferred.

## The shape of the fix

**One predicate, two wrappers.** `claimantFor(name)` answers *which card answers
for the spelling requested*; `borrowedName` and `knownAgent` are thin wrappers.

⚠️ They are wrappers rather than two implementations because **two gates
diverged and the divergence was the worst defect on this work**: the read gate
was corrected three times until it asked the right question, and the write gate
was left on the old per-key form — so the reads refused correctly while the
writes accepted. A lesson learned by one gate has to be structurally impossible
for the other to miss.

**The rule, re-derived:** if a card's OWN session name is exactly what was asked
for, that card answers — nobody else's spelling is relevant. Only when no card
spells it that way do we fall back to the sanitised key, which is what keeps a
healthy agent reachable under its normalised name.

That predicate has been wrong in three directions and each is now pinned:

| version | failure |
|---|---|
| sanitised vs raw | alias spellings leaked |
| first claimant wins | a **healthy agent went offline** because a stranger's alias sorted first |
| per-key | leak reopened for the untied card's **own** spelling |

## What it changes

- [x] **`claimantFor`**, and `borrowedName` / `knownAgent` derived from it.
- [x] **Six name-keyed consumers gated**, found one at a time over four rounds:
      the write routes, `GET /commitments`, `GET /avatar`, and the two
      `/api/status` enrichments (commitments and instruction staleness).
- [x] **Fails closed.** `paneRoster()` throws when tmux cannot be asked, so a
      dead tmux refuses rather than answering "nobody is claiming this name".
- [x] **Off the hot path.** The gates use `paneRoster()` (one tmux call, no
      captures) rather than `snapshot()`. Measured 59ms → 3ms; on a 13-agent
      fleet that is 767ms → 39ms of blocked event loop per 5-second board tick.
- [x] **The detail panel stops offering what the routes refuse** — picture, role
      and instructions are withdrawn on an untied card, the editor is **cleared**
      rather than merely disabled, and one sentence says why.
- [x] **Re-applied on every poll**, not only at open: an agent whose session dies
      while its panel is open must not keep showing its boot file on a card that
      has become a stranger's.

## ⚠️ Known cost: non-Discord agents become read-only

Gating the write routes closes the borrowed-name hole and, in the same stroke,
removes instruction/profile/avatar editing from any agent whose session name does
not carry the suffix — on work whose purpose is decoupling from that suffix.

**Why it is not simply reverted:** the two cases are indistinguishable from tmux
alone. "A legitimate agent named `research`" and "a stranger squatting on
`angel`'s name while `angel` is down" are both *a session with no suffix and no
competing claimant*. The action rewrites the file an agent boots from.

**What was done instead of pretending otherwise:** the board no longer advertises
the edit. Refusing plainly beats offering an action that cannot work.

## Verification

- [x] `node --test` — **238 passing, 0 skipped**.
- [x] Every gate mutation-tested; the several whose first mutation did *not* fail
      were treated as unpinned and given real tests first.
- [x] Both directions pinned — the leak *and* the availability case where a gate
      takes a healthy agent offline.
- [ ] `/challenge-loop` proof file committed.
- [ ] PR opened with `joshualeestone` as reviewer, stacked on `roster-rework`.

## Why this is a separate PR

Five consecutive review rounds found **nothing** in the engine and **something**
in these consumers each time — including one blocker inside the fix for the
round before it. The engine had converged; this had not, and it was holding the
engine up.
