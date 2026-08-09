# Restart, clear and compact, with the cost shown first

Card [#1](https://github.com/joshualeestone/agent-workforce/issues/1). Wireframe:
`Josh-Brain/Projects/agent-platform-wireframes/screen9-restart-confirm.png`.

## Why this is not a button

Restart is the most-used operation in the fleet and it is absent from every
screen. But the issue is explicit that the button is the easy part:

> **The dangerous case is the agent that is *between* things.** Process state
> says "nothing running, safe to proceed", the user clicks through, and the
> commitments die silently.

So the deliverable is not a button, it is **a dialog that can tell you what you
are about to destroy**, backed by the commitment store shipped in #19. Without
that store the confirmation is theatre: it cannot see the thing it protects.

The wireframe makes the same point in its own words, and it is the sentence the
whole card turns on:

> The second and third are the dangerous ones. Angel is not visibly working on
> them, so a dialog that only checked whether it was busy would have told you
> this was safe.

## Branch point: STACKED on `add-editable-agent-detail`, not off main

⚠️ **Deliberate deviation from the house rule.** Recorded here rather than left
for someone to notice in the graph.

`#1` touches `web/index.html` and `server.js`, which `#9` rewrote heavily.
Branching off main means writing a restart button against a detail page that
does not have the instruction editor in it, and a conflict I can predict now.

They are also one user story: #9's staleness note currently reads *"Restarting
the agent is what applies them, and this app cannot do that yet."* #1 is what
makes that sentence false, so building them apart means building #1 against a
screen it invalidates.

Pressure-tested with Splinter (2026-08-09 ~04:20 UTC). His addition, adopted:

- **Merge sequencing.** Land #9 first, then rebase this onto main and merge.
- **The PR must say it is stacked**, so a reviewer is not reading it against a
  main that lacks the editor.
- Risk if #9 comes back change-requested: a stacked #1 handles that *better*
  than off-main, because the changes flow through a rebase rather than into a
  conflict-merge.

## What the three actions actually are

Verified on this machine, not assumed:

| Action | Mechanism | Loses |
|---|---|---|
| **Compact** | `/compact` into the agent's tmux pane | nothing |
| **Clear** | `/clear` into the pane | the conversation, so every commitment |
| **Restart** | `~/.claude/bin/restart-bot.sh <agent>` | the conversation, so every commitment |

- All 13 agents have a launchd service (`com.<agent>.discord.plist`), so restart
  is available for every one of them. Checked, not assumed.
- ⚠️ **`restart-bot.sh` is the only correct way to restart.** It goes through
  launchd so the launch script's `--dangerously-skip-permissions` is applied. A
  hand-rolled `tmux kill-session` + `new-session` drops that flag and the bot
  comes back and freezes on the first permission prompt. This is a documented
  fleet rule and the reason this code shells out to a script rather than doing
  the obvious thing itself.
- Restart is the **only** action that re-reads the instruction file, which is
  what ties this card to #9.

## Checklist

### 1. `engine/lifecycle.js` — the actions

- [ ] **1.1** One module, three actions, each returning a structured result
      rather than throwing for an expected outcome.
- [ ] **1.2** `restart` shells out to `~/.claude/bin/restart-bot.sh`. Refuse if
      the script is missing rather than falling back to anything clever.
- [ ] **1.3** `clear` / `compact` send the slash command to the agent's pane.
      The pane target is derived once, and validated, never interpolated raw.
- [ ] **1.4** ⚠️ **Refuse any agent not on the live roster.** The name reaching
      this module becomes a launchd service name and a tmux target. Same
      discipline as `engine/workerfile.js`: one derivation, validated, and the
      containment is the thing that decides.
- [ ] **1.5** Never throw a raw errno or an absolute path at the person.

### 2. What is about to be lost

- [ ] **2.1** The dialog's list comes from `commitments.read()`, which already
      answers in the three-state vocabulary this codebase runs on.
- [ ] **2.2** ⚠️ `unknown` renders as **"we cannot tell what this agent is
      holding"**, never as an empty list. An empty list reads as "nothing to
      lose", which is the exact lie the card exists to prevent. The store
      already decays a stale report to `unknown` while still returning the
      items, so the dialog can say "these three were pending 40 minutes ago,
      and we cannot vouch for that now".
- [ ] **2.3** The wireframe's callout about the dangerous ones is **derived**,
      not hardcoded copy: it appears when the agent is holding commitments it is
      not visibly working on.

### 3. The routes

- [ ] **3.1** `POST /api/agent/:name/restart|clear|compact`, matched on the
      pathname, ordered before the `/api/` fallthrough.
- [ ] **3.2** `knownAgent` guard, as every write route has.
- [ ] **3.3** ⚠️ The request must carry the commitment state the dialog showed,
      and the route refuses if it no longer matches. Same shape as #9's
      changed-since-read guard, and for the same reason: a dialog listing three
      commitments that the operator approves twenty minutes later should not
      quietly destroy a fourth that arrived since.
- [ ] **3.4** Answers must distinguish "we did it" from "we asked and cannot
      confirm". Restart takes seconds and the script verifies; a send-keys
      returns immediately and confirms nothing.

### 4. The dialog

- [ ] **4.1** Follows the wireframe: what it is holding, then the three options
      in gentlest-first order with the cost of each stated in full.
- [ ] **4.2** Compact is marked GENTLEST and is the visually primary action.
      Restart is the least prominent. The wireframe is deliberate about this and
      it is the opposite of where a "restart button" would naturally put it.
- [ ] **4.3** Cancel is always available and is the default focus.
- [ ] **4.4** WCAG AA: focus trapped in the dialog, `Escape` cancels, the
      trigger regains focus on close, and the list is a real list.

### 5. Verification

- [ ] **5.1** `node --test`, extending the suite. Sandbox both stores.
- [ ] **5.2** ⚠️ **No test may restart, clear or compact a real agent.** The
      action layer is exercised against an injected runner, and the one test
      that touches the real script asserts only that it exists and is
      executable. A test suite that can restart the fleet is worse than no test.
- [ ] **5.3** Every guard verified by deleting it and confirming a **named**
      test fails. Anything unpinnable is declared at the code.
- [ ] **5.4** Screenshot every dialog state, including `unknown`.
- [ ] **5.5** Challenge loop to convergence.

## Deliberately NOT in scope

- **Auth.** Card #10. This ships behind loopback plus the `Host` check added in
  #9, and the README will say what that does and does not protect.
- **Restarting anything that is not a fleet agent with a launchd service.**
- **Undo.** There is none for a clear. That is the reason the dialog exists.

## The thing to watch, carried from #9

Five of the nine blockers in #9's challenge loop were in code added *during* the
loop to make the feature safer, each breaking a case the previous fix had not
considered. This card is almost entirely a safety mechanism, so that failure
mode is not a footnote here, it is the main risk. Every guard added in response
to a review finding gets attacked as new code on the most dangerous path, not
credited as a fix.
