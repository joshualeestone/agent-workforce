# Plan: roster-rework

**Branch:** `roster-rework`
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-10

## What this is

The **status engine only** — how the board decides which tmux pane represents
which agent, and what it is willing to say about each one.

It ships **no destructive route, no new UI, and no change to any consumer.** It
changes what the board *reports* about agents that already exist, so it is
independently valuable and independently reviewable.

**Files:** `engine/status.js`, `engine/status.test.js`, and one sandbox seam in
`engine/store.js` that the engine's own tests need.

## Why it is its own branch

Split out of `add-restart-with-consequences`, which reached 6,878 lines across 23
files. Ten blind review rounds on that branch found 43 issues, and **roughly half
were defects introduced by the fix for a previous finding** — which is what a
diff too large to hold looks like from the inside.

⚠️ **And then the split immediately earned itself**: reviewing this engine alone
found **five defects that ten rounds on the combined branch never surfaced**,
including a stranger's session borrowing a real agent's identity, and a crashed
agent being reported healthy from an editor's screen text.

## What it contains

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
      `isUnambiguousClaude`, `isNamedOurs`, `PANE_COLUMNS`. Every one replaced
      two copies that had drifted or could.
- [x] **`isNamedOurs` gates what the engine will assert.** Identity, role, model,
      context and avatar are all filed under the NAME; a pane we cannot tie to
      that name gets none of them.
- [x] **`setPaneSource` / `setPaneCapture` / `AGENT_WORKFORCE_CONFIG_ROOT`** —
      test seams. Without them 19 safety tests silently skipped on any machine
      without a live fleet, and the fixtures could not be sandboxed.
- [x] **`paneRoster()`** — names and tie only, one tmux call and no captures, for
      callers that need the roster on a hot path.

## The defects this fixes, all measured rather than theorised

1. A name-colliding session **running Claude** could take over the real agent's
   card, so the board showed one agent's state under another's name.
2. A bare `node` pane (a build watcher) could win the name inside a real agent's
   session — and `/clear` into `node` is *executed*.
3. With the real agent dead, a stranger's session won the name by default.
4. A `node` watcher outranked an agent's own crashed shell, **hiding the crash**
   on the one card whose Restart button exists for it.
5. **Two definitions of "a Claude process is running here"** — an allowlist and a
   six-name shell denylist — so a crashed agent whose remaining pane was `vim`
   got classified from the editor's screen text and reported healthy.
6. **A stranger's session borrowed the real agent's identity**: name, role,
   model, a 24% context ring at full confidence, and its photograph.
7. A session the engine had **already rejected** still got a scraped state — a
   `node` dev server with a confirmation prompt on screen read as `needs_you`.
8. A truncated or empty `pane_current_command` produced a confident `stopped`
   from a field that carried no information.

## ⚠️ Known cost: non-Discord agents are anonymous

Measured on a session `research` with a real `workers/research/CLAUDE.md`:

| | on `main` | on this branch |
|---|---|---|
| name | **Rex** | `research` |
| role | research worker | *(none)* |
| `nameDerived` | true | false |
| model / model name | read | *(none)* |
| context ring | read | *(none)* |
| avatar | shown | *(none)* |

**Why it is nevertheless right:** every one of those readings is filed under the
NAME, and the finding of this branch is that an untied pane has not been shown to
be the agent that name belongs to. Reading them means showing one agent's data on
another's card. Showing less is an honest failure; showing the wrong agent's is
not.

**What would lift it:** a way for an agent to prove a pane is its own that does
not rely on the session-name convention — a marker file written at startup, or a
registry entry keyed on the pane. That is its own piece of work, and it is what
"decouple from Discord" ultimately requires.

## ⚠️ Deliberately NOT in this PR

`isNamedOurs` is **published and not yet consumed**. The routes and the board
still behave as they do on `main`.

That is on purpose. The consumer half — gating the read and write routes, the
`/api/status` enrichments and the detail panel's write affordances — is a
**separate branch and a separate PR**, because it kept finding defects in its own
previous fixes long after the engine had settled. Five consecutive review rounds
found nothing in the engine and something in the consumers each time.

⚠️ **One consequence a reviewer should know:** a pre-existing hole stays open
until that PR lands — with a real agent's session down, a session that merely
shares its name can still reach its write routes. It is documented in the
consumer PR and it is **not a regression from this branch**; it is reachable on
`main` today.

## Verification

- [x] `node --test` — **226 passing, 0 skipped**, on this branch off `main`.
- [x] Server smoke-tested against the live 13-agent fleet: board serves 200,
      identities intact, counts sane.
- [x] Every guard mutation-tested: deleted or inverted, suite run, a **named**
      test confirmed to fail. Guards whose first mutation did *not* fail were
      treated as unpinned and given real tests before being accepted.
- [x] Suite verified to leave nothing behind outside its sandbox — no phantom
      registry entries, no writes to the operator's avatar or profile store.
- [ ] `/challenge-loop` proof file committed.
- [ ] PR opened with `joshualeestone` as reviewer.
