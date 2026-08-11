# Plan: static-supervisor

**Branch:** `static-supervisor`
**Base:** `create-an-agent` (stacked; rebases onto `main` once #24 merges)
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-11

## Why

`create-an-agent` generates a 151-line bash startup script **per agent**. Across
eleven review rounds on that branch, **eleven of the fifteen self-inflicted
defects were in that script**, and four of the five blockers.

Two properties of the per-agent shape caused it:

1. **A fix reaches only the agents created afterwards.** Every agent already on
   the machine keeps its own copy of the bug, forever, and nothing in the
   product would ever update it.
2. **It cannot be reviewed once.** It is reviewed per generation, which is how
   six separate defects got into it in a single afternoon.

Josh approved this as a small follow-up PR (2026-08-11 03:58 CDT).

## What changes

- [x] `bin/agent-supervisor.sh` — the same logic, **checked in**, taking the
      agent as arguments: `<session> <workdir> <claude> <tmux> [log]`.
- [x] `createAgent` **installs** it (to the product's own support directory)
      rather than writing a copy into each agent's folder, and **refreshes it on
      every creation**, so a change reaches agents that already exist.
- [x] The launchd job runs the shared script with that agent's arguments.
- [x] A supervisor that cannot be installed **refuses the creation** rather than
      leaving a job pointing at a script that is not there, which is the
      respawn-loop state.

## ⚠️ Installed, not referenced in place

The job could point at `bin/agent-supervisor.sh` inside the checkout, which is
one fewer moving part. It does not, because moving or deleting the repository
would then break every agent on the machine at their next login, silently, long
after whoever moved it had forgotten. It is copied to a stable location outside
the checkout instead.

## What this also removes

**The name stops being shell text at all.** It used to be interpolated into the
generated script, with the name validator as the only thing making that safe. It
is now an argument, so nothing about it is ever read by a shell. The validator
stays (the name is still a directory, a service label and a tmux session), and a
test pins that the surface stayed closed.

## Definition of done

1. Two agents created in a row share one supervisor, and neither has a copy.
2. An older installed supervisor is replaced, not left in place.
3. A supervisor that cannot be installed stops the creation and leaves nothing.
4. The behavioural harness runs the **shipped** file, not a generated string.
5. `node --test` green, zero dependencies.
6. `/challenge-loop`, proof committed.
7. Verified live: an agent created through this path comes up, is claimed, and
   is adopted rather than restarted on a job restart.
