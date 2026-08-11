# Plan: remove-an-agent

**Branch:** `remove-an-agent`
**Base:** `main` (carries #24, #25, #26, all merged 2026-08-11 morning)
**Closes:** nothing — no issue was filed; this came from Josh directly
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-11 (started 2026-08-10 evening; rebuilt twice to Josh's spec)

## Why

The README currently tells a person to remove an agent with four terminal
commands, and **the launchd job keeps retrying until they run them.** Josh, on
what is not real yet: *"In a training room, the first thing a nervous person
does is make a mistake and want to undo it. Right now they cannot."*

It is also the natural completion of the create flow that merged this morning:
Kosmos can make an agent and cannot unmake one.

## What it is, after two reversals

Both reversals were Josh's, both made the feature smaller and better, and both
are recorded here so the earlier shapes are not re-derived from the branch's
own history.

**Reversal 1 — Remove is not Delete, and only Remove exists.**
The first build deleted the launchd job and offered a "also delete its folder"
checkbox, with "this cannot be undone" language throughout. Josh: *"We will
only remove right now, not delete files completely."* So:

- **Nothing on disk is ever deleted.** Not the folder, not the instructions
  somebody wrote, not the log, not the startup file.
- The startup job is **disabled**, not removed — launchd's own mechanism,
  persisted across logins, reversed by `enable`, touching no files.
- Removal is therefore **reversible**, which is what makes a single light
  confirmation honest rather than a trapdoor.
- The consequence recital ("this will stop it running, end its session, …")
  came out. Josh, correctly: it describes our implementation, not their
  decision.

**Reversal 2 — it works on EVERY agent, including ones another tool made.**
The first build refused those, reasoning that whatever set an agent up should
be what takes it away, and I argued for that refusal on the grounds that a
delete button able to reach Angel or Splinter is worse than no button. Josh:
*"Kind of the whole point of Kosmos is that this allows you to manage your
fleet of agents, so in that regard even if I had created it as a discord bot I
should be able to remove it."* He is right, and the earlier argument was
answering a question about Delete that no longer applies: a **reversible**
remove on a foreign agent disables a job and can re-enable it.

## The design, as built

| | |
|---|---|
| Where | Bottom of the agent's own detail screen, under a rule, marked by weight rather than hue |
| The question | "Are you sure you want to remove `<name>` from Kosmos?" |
| Small print | "The agent's folder and the contents you wrote for it will not be deleted." |
| Buttons | Both name the agent: "Keep `<name>`" / "Remove `<name>`" |
| Default answer | Keeping it. Escape, the backdrop and initial focus all land there |
| Undo | "Show removed agents" at the bottom of the Agents tab, Restore per row |

Josh: *"we want to make it a bit obnoxious so they really understand what they
are doing."* That is why the heading is 22px semibold in a padded, opaque box
over a 72%-dark backdrop, and why both buttons carry the name rather than
"Yes"/"No" — **not** why it says anything alarming. Removal is reversible and
the copy must not imply otherwise. Loud about *which agent*, quiet about danger.

## The three decisions worth not re-litigating

**1. `isRemoved` and `isHidden` are different questions.** `isRemoved` = Kosmos
was asked to remove this, and it is what puts a Restore button on screen.
`isHidden` = it actually stopped, and it is what takes a card off the board. A
half-completed removal answers yes to the first and no to the second:
recorded (so recoverable), still visible (because it may still be running), and
retryable. Collapsing them back into one flag reintroduces a state with no way
out — which it did, once.

**2. Act on the session name, speak the display name.** Cards carry two names:
the display name parsed from "You are \*\*X\*\*", and the tmux/launchd name.
They are identical for every agent Kosmos creates — the only kind the tests
used — and differ for exactly the pre-existing agents this was rebuilt to
support. `claudebot` displays as `Splinter`. This split has now caused a bug
pointing **each way**: the board filtered on the display name while a removal
recorded the session name (a blocker, found in review), and then the
confirmation asked about the session name on a screen showing the display name
(found by rendering it).

**3. The default is not dry-run.** Starting the engine in dry-run felt careful
and made the product **silently do nothing while reporting success**: every
filesystem step short-circuits, so the one code path written to catch "it will
come back when you next log in" could never fire. The safety belongs in the
tests, which arm it at file load. Pinned by a test that checks the default in a
fresh process, because the test file has already armed dry-run by the time any
test in it runs.

## How it is verified

- **Unit and route tests** — `node --test`, the whole validation story for this repo (no build step, no linter). The count has moved with each review round; the branch does not claim a number that goes stale, only that the suite is green and that every fix on it is mutation-verified.
- **A live round trip against real launchd and real tmux**, on a throwaway
  `zz-*` agent, sandboxed at every root the engine writes to (`WORKERS`,
  `LAUNCH`, `DATA`). 20/20 checks: created and running → removed → session
  gone, job `=> disabled`, folder/instructions/plist all still present, off the
  board, record written carrying the exact label → restored → same job
  `=> enabled`, back on the board. Machine confirmed unchanged afterwards.
- **Rendered in a browser**, which is new for this repo and is what found the
  transparent modal.

⚠️ **The launchd domain cannot be sandboxed** — `disable` writes to the real
per-user override database, which is exactly what Restore has to reverse. So
the harness uses a unique `zz-kosmos-<pid>` label and re-enables it in teardown
unconditionally. Nothing else on the machine is reachable by it.

## What this does NOT do

- **No Delete.** Removing everything an agent owns is a separate feature and is
  not built. The manual recipe stays in the README for it.
- **No prune of the removed list.** Nothing ages entries out. `create` refuses a
  name that is on the list and points at Restore, so the failure mode it would
  otherwise cause (an agent created under a removed name, filtered off the board
  forever with nothing on screen to explain it) is closed at the other end.
- **No bulk remove.** One agent at a time, from its own screen.

## Risks accepted

- **The list includes Angel and Splinter.** On this machine, removing `angel`
  stops the agent Josh is talking to, and removing `claudebot` stops the PM.
  That is the fleet management Josh asked for, not a defect, and the named
  confirmation is the guard. Flagged to him before it was built; he confirmed.
- **Restore does not restart a foreign agent's session**, it re-enables the job.
  For a `KeepAlive`/`RunAtLoad` job that is the same thing; for one that is not,
  the agent comes back at next login rather than immediately. Not papered over
  in the copy: Restore says it is set to start again.
