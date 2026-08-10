# Plan: roster-rework

**Branch:** `roster-rework`
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-10

## Why this is its own branch

Split out of `add-restart-with-consequences`, which reached 6,878 lines across
23 files. Ten blind review rounds on that branch found 43 issues, and **roughly
half were defects introduced by the fix for a previous finding** — which is what
a diff too large to hold looks like from the inside.

This half ships **no destructive route and no new UI**. It changes what the board
*reports* about agents that already exist, so it is independently valuable and
independently reviewable.

## What it contains

`engine/status.js` and `engine/status.test.js` only.

- [x] **Three tiers, named and separated** — `isFleetSession` (ours, whatever is
      running), `isAgentSession` (and Claude is running), `isAgentPane` (and not
      scrolled back in copy-mode). Conflating them was a hole at both ends.
- [x] **Discord decoupled.** An agent is a Claude process; the `-discord` suffix
      survives as evidence of *whose* a pane is, not as the definition of one.
- [x] **`rank()` / `onePanePerSession()`** — five tiers deciding which pane
      represents an agent name, on the principle that **the session name is the
      only evidence of whose a pane is** while a running Claude only says
      *someone's* Claude is there.
- [x] **One definition per fact** — `isNativeClaude`, `isClaudeCommand`,
      `isUnambiguousClaude`, `isNamedOurs`, `PANE_COLUMNS`. Every one of these
      replaced two copies that had drifted or could.
- [x] **`setPaneSource` / `setPaneCapture`** — test seams. Without them 19 safety
      tests silently skipped on any machine without a live fleet.
- [x] **`isNamedOurs` on the snapshot**, which the restart branch consumes.

## The defects this fixes, all measured rather than theorised

1. A name-colliding session **running Claude** could take over the real agent's
   card, so the board showed one agent's state under another's name.
2. A bare `node` pane (a build watcher) could win the name inside a real agent's
   session.
3. With the real agent dead, a stranger's session won the name by default.
4. A `node` watcher outranked an agent's own crashed shell, **hiding the crash**.
5. **Two definitions of "a Claude process is running here"** — an allowlist and a
   six-name shell denylist — so a crashed agent whose remaining pane was `vim`
   got classified from the editor's screen text and reported healthy.

## ⚠️ Deliberate scope addition: `server.js` `knownAgent`

This branch was meant to be one file plus tests. It touches `server.js` too, in
one function, and the reason is worth stating rather than hiding in the diff.

`knownAgent` gates every **write** route on `sessionName`, and the roster
publishes an untied pane's raw session name. So with the real `angel-discord`
down, a stranger's `tmux new -s angel` made `knownAgent('angel')` true and
unlocked `PUT /api/agent/angel/instructions` — **rewriting the CLAUDE.md the real
agent boots from** — plus the avatar and profile routes against the real agent's
stored data.

**It is pre-existing and reachable on `main` today.** It is fixed here because
the argument this branch makes about `status.js` applies verbatim to its
consumers: publishing `isNamedOurs` and expecting someone downstream to honour it
is not a fix. This is the only consumer in this tree and the change is one
clause.

## ⚠️ Second known cost: non-Discord agents are read-only

Gating the write routes on `isNamedOurs` closes the borrowed-name hole and, in
the same stroke, **removes the instruction/profile/avatar editing feature from
any agent whose session name does not carry the suffix** — on the branch whose
stated purpose is decoupling from that suffix.

**Why it is not simply reverted:** the two cases are indistinguishable from tmux
alone. "A legitimate agent named `research`" and "a stranger squatting on
`angel`'s name while `angel` is down" are both *a session with no `-discord`
suffix and no competing claimant*. There is no evidence available here that
separates them, and the action in question rewrites the file an agent boots from.

**What was done instead of pretending otherwise:** the board no longer advertises
the edit. `instructions.editable` is `false` for an untied card, so the
affordance is absent rather than present-and-404ing. Refusing plainly beats
offering an action that cannot work.

**What would lift it:** a way to tie a pane to a name that does not rely on the
session-name convention — a marker file the agent writes at startup, or a
registry entry keyed on the pane. That is its own piece of work and it is what
"decouple from Discord" ultimately requires; the suffix is currently the only
evidence of *whose* a pane is.

## Verification

- [x] `node --test` — 217 passing, 0 skipped, on this branch off `main`.
- [x] Server smoke-tested: 13 agents, `isNamedOurs` present, board serves 200.
- [x] Every guard mutation-tested: deleted, suite run, a **named** test confirmed
      to fail.
- [ ] `/challenge-loop` to convergence, proof file committed.
- [ ] PR opened with `joshualeestone` as reviewer.

## Known cost, stated rather than discovered

An npm-global agent that shares its session with any shell pane reads as
`stopped` and is restart-only. `node` cannot be told from a build watcher, and
the tie is settled on which wrongness is recoverable: a false `stopped` is
recoverable by restarting, a false `running` may mean typing an executable string
into an unrelated process.
