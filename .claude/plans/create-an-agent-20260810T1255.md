# Plan: create-an-agent

**Branch:** `create-an-agent`
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-10

## Why this is the first thing to build

Kosmos **cannot create anything today.** There is no create route; the product
reads, edits and (on another branch) restarts agents that someone made by hand.
Every screen in the first-run prototype is scaffolding around this one missing
capability, and it is the single blocker for the training-room test: *a
non-technical person gets from install to a working agent unaided.*

## ⚠️ The blocker found before writing a line of it

**A Kosmos-created agent would be anonymous and unwritable**, because of what
landed on `main` this morning.

Measured on this branch, for a session named `casey`:

| | |
|---|---|
| `isNamedOurs` | **false** |
| name | `casey` (not derived) |
| role, model, context ring, avatar | **none** |
| `PUT /api/agent/casey/instructions` | **404** |

`isNamedOurs` is `/-discord$/`. An agent Kosmos creates has no reason to carry
that suffix — Discord is our dev environment, not the product — so **the thing
we just built to stop a stranger borrowing an agent's identity also stops us
recognising the agents we create ourselves.**

That is not a regression to revert. The gate is right: a pane must be *tied* to
the name it is filed under before we speak for it. What is wrong is that the
**only evidence of a tie is a Discord naming convention**, which is exactly the
limitation `roster-rework`'s plan named and said "would be lifted by a way for an
agent to prove a pane is its own that does not rely on the session name."

**So the first piece of work here is that proof.** Create-an-agent cannot ship
without it, and nothing else about the product's Discord decoupling is finished
until it exists.

## The design: a claim ⚠️ AMENDED DURING IMPLEMENTATION

**A claim file was the plan. A tmux session option is what shipped**, and the
plan is amended here rather than left disagreeing with the code about the
central mechanism of the branch.

**Why it changed:** the claim's whole job is to say "this LIVE session is ours".
A file outlives the session it describes, so a stranger who later opens a
session of that name inherits the claim, and every removal has to remember to
delete it. A tmux user option (`@kosmos_agent`, set on the session) **dies with
the session**, which is the property the design actually needed. The `-discord`
suffix stays as the legacy arm so the existing fleet keeps working.

**What that cost, found later:** because it dies with the session, setting it
once at creation is not enough — it has to be re-set at every start, so it lives
in the generated startup script rather than in a one-off command. An agent
created before that fix came back anonymous after its first restart.

- [x] A tmux session option set by Kosmos, not a file. (Superseded:
      `~/.../claims/<key>.json` holding `{ sessionName, createdAt, createdBy }`.)
- [ ] `isNamedOurs` becomes `hasClaim(pane) || /-discord$/`, with the suffix kept
      as the legacy arm so the existing fleet keeps working unchanged.
- [ ] ⚠️ **The claim is written by KOSMOS, not by the agent.** An agent writing
      its own claim would let any process claim any name — the same borrowed-name
      hole, through a different door. Kosmos creates the session and the claim in
      one operation, and only it writes there.
- [ ] ⚠️ **A claim without a live session is not a tie.** The pane must still
      exist and still be ours; the claim only says *whose* it is.

## What creating an agent actually does

Each of these is a file or a command that exists on this machine today, done by
hand. None requires a human decision beyond the name and the role.

- [ ] **The working directory** — `~/work/workers/<key>/`.
- [ ] **The instruction file** — `CLAUDE.md`, from the chosen role's template.
- [ ] **The claim** — as above.
- [ ] **The tmux session**, started in that directory with the model and
      `--dangerously-skip-permissions`.
      ⚠️ That flag is the single worst step in the manual path: without it the
      agent starts, looks healthy, and freezes forever on its first permission
      prompt. **A user must never meet it.**
- [ ] **A launchd job**, so it survives a reboot and restarts if it dies.
      ⚠️ It needs `PATH` **and `LANG`** — see issue #23. Without `LANG`, tmux
      sanitises its own format output and the board reports an agent whose name
      is the entire raw line. Found the hard way this morning.
- [ ] **Verification** — the session exists, Claude is running in it, and the
      board can read it. **"Started" is a claim about us; "it answered" is a
      claim about the agent**, and only the second is worth showing.

## Roles

- [ ] A small library of role templates: instruction text, a suggested first
      action, and a default folder scope.
- [ ] **Project manager is the suggested default.**
- [ ] ⚠️ **Every role ships a suggested first action.** Without one, a role that
      lands on a working agent and a blank prompt puts the person back in front
      of the box the role library exists to remove.
- [ ] ⚠️ **Legal is NOT in the first set** pending Josh — framing and a
      disclaimer cover Copyright and Finance; Legal is where a wrong draft costs
      most.

## Out of scope, named so it does not sprawl

- The account and email. **Gone from first run entirely** — they exist only at
  the relay purchase.
- Projects, agent-to-agent messaging, fleets.
- Lighting up the open-weight models. The picker shows them as coming.
- Cloning an existing agent. The requirements make Clone the primary path for
  *adding* an agent; it needs one to exist first.

## Definition of done

1. From the board, a person creates an agent with a name and a role, and it is
   running and readable **without touching a terminal**.
2. It survives a reboot.
3. The board shows its name, role, model and context ring — i.e. the claim works.
4. Its instructions are editable from the app.
5. `node --test` green, zero dependencies, nothing written outside the sandbox.
6. `/challenge-loop` to convergence, proof committed.
7. Screenshots in the PR and posted to Discord.
