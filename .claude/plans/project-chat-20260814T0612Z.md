# Project chat — implementation plan

**Branch:** `project-chat` (off `main` at `76cf0e5`) · **Author:** Angel · **2026-08-14 1:12am CT**
**Closes:** the gap Josh hit on the clean-Mac run — an agent card reading
"Needs you / the pane is showing a question" with nowhere to see the question
or answer it.
**Reads against:** `[[my-projects-scope]]` §3 (conversation, deliberately deferred
there and picked up here), `engine/projects.js`'s honest-claims table, and Josh's
"even if it's only talking to one agent" directive.

⚠️ **Written at the END of the build, not the start, and dated honestly.** This
branch was worked overnight from a briefed spec rather than from a plan file, and
challenge-loop rounds shaped it — seven when this document was first written,
dozens by the time the loop closed (the numbered iteration commits in `git log`
are the count that cannot go stale, and round 37 caught this sentence
undercounting by a factor of five). Writing it as though it preceded the code
would be the one thing this codebase most consistently refuses — a document
claiming a process that did not happen. What follows is the design **as built**,
with the reasoning that survived review, so the gate and the next reader get the
intent rather than a reconstruction.

---

## 1. Scope: one agent, on purpose

`[[my-projects-scope]]` §3 deferred conversation with a specific blocker: *a project
room with five agents has no addressing rule, and silence and stampede are the same
bug.* That blocker is real and it is not solved here. It is **sidestepped**, which
Josh authorised directly: every message is addressed to exactly **one** agent.

- A picker chooses the recipient, defaulting to the project's manager-type agent, or
  the first agent when there is no manager.
- The other agents on the project are **visible and silent**. There is no room.
- The rule lives in `chat.defaultAgentFor`, published by `projects.describe` as
  `defaultAgent`, and rendered by the page. **One derivation** — a picker that worked
  out its own default would be a second answer to the exact question the placeholder
  screen said it was waiting on.

Cross-agent rooms, threading, and bubbles are **not** in this build.

## 2. What the screen may claim

The module header of `engine/chat.js` carries the table; the short version, because it
governs every sentence on the screen:

| Claim | | |
|---|---|---|
| we put this text into that pane | ✅ | tmux took it and said so |
| this is what that pane shows right now | ✅ | we captured it a moment ago |
| we could not deliver, and why | ✅ | the failure is ours to report |
| we typed it and cannot tell whether it landed | ✅ | our own blind spot, stated |
| what the pane was doing when we typed | ✅ | the board's own verdict, at that moment |
| the agent **read** it, received it, or will act on it | ❌ | never |

`send-keys` reaches a terminal, not a program's understanding. Every sentence is about
the **keystroke**.

## 3. Delivery: three states, separated by one checkable fact

- `placed` — tmux took the text and the Enter, and said so.
- `unconfirmed` — something may have reached the pane; re-sending may duplicate it.
- `could_not` — **nothing** of the person's text reached the pane; re-sending is safe.

The line is not severity. It is: *could the words already be in that agent's composer?*
With only two states, an ambiguous send renders as failure, the person re-sends, and on
a permission prompt the second copy answers a question the first one already answered.

Underneath: a tmux that never **started** (ENOENT/EACCES) and one **killed at the
timeout** both arrive as `ran: false`. Measured on this machine — ENOENT and EACCES
carry a null status and no signal; a timeout carries a null status and SIGTERM;
`killed` is `undefined` in all three. `spawnFailure` reads the **signal**.

Each verdict also carries what the pane was doing at send time, from the board's own
`classify` verdict on the card the send was authorised against — so the thread and the
agent's card cannot disagree.

**The compose box keeps your text exactly when re-sending is safe, or when it is the
only copy left.** Cleared on `placed`; kept on `could_not`; cleared on `unconfirmed`
*only if* the message was recorded, because otherwise the box is the last copy.

## 4. The pane is a viewport, never a transcript

The agent's side is the live tail of `capture-pane`, labelled in words: *"What Mara's
screen shows right now… It is not a transcript, and it is not what the agent said to
you."* There is no bubble-maker. A parser that guesses which lines of a TUI are the
agent talking puts words in its mouth the first time it guesses wrong, and Claude Code
redraws, wraps, animates, and prints tool output that reads exactly like prose.

The question region is a **slice** of that same screen, located with the board's own
`NEEDS_YOU_MARKERS` (exported, not copied). The two reads still differ in **moment**,
**flags** (`-J` vs none) and **depth**, which is why the route carries
`questionBecause` for the case where they disagree.

## 5. Storage: what is ours to keep

Per project **and** agent, under `AgentWorkforce/chats/`. The person's outgoing
messages and the delivery verdicts — never the pane, which is live-only.

- **Nothing of the person's is ever deleted.** A full thread refuses to record rather
  than rotating; a thread belonging to an earlier project of the same name is **renamed
  aside**, not overwritten; a genuinely damaged file is renamed aside too, with a
  distinct suffix.
- A **damaged** file (`UNPARSEABLE`: parse, shape, or agent mismatch) is set aside so
  recording is not locked out forever. A file we merely **could not read right now**
  (`UNREADABLE`: EACCES, EMFILE, EIO on an intact file) is **not** — that repair is
  destructive and a transient problem is not damage. This split was measured: `chmod
  000` on a healthy thread plus one send used to set the good conversation aside.
- Writes hold an **mkdir lock** (the fleet's own transport-lock pattern), because
  `appendMessage` is a read-modify-write and two windows lost a message. Stale locks are
  **stolen by rename** (which can only succeed once) rather than removed, and released
  only if still ours.

**A name we cannot file under is a third state.** `threadFile` refuses an agent whose
session name is not already its own store key — a capital or a dot, which is exactly
what adopting the pre-existing `-discord` fleet produces. Relaxing that guard would
fold `MyBot` and `mybot` onto one file. So the screen says only what it knows: *Kosmos
cannot keep a conversation for an agent named MyBot; nothing sent here is kept.* It
promises nothing about delivery — that is the per-send verdict's job.

## 6. Riding along (Josh's triage, same branch)

- **Project creation defaults to no picker.** Name it, and Kosmos makes
  `~/Kosmos/Projects/<name>`. This kills the macOS Desktop/Documents TCC prompt from
  the default path. Pointing at an existing folder stays, one link away. Path-hostile
  names are **refused**, not sanitised; separators fold to dashes and the exact path is
  shown before anything is made.
- **Capitalised display names.** `slugFor` is `toLowerCase` and nothing else —
  deliberately not `safeKey`, which strips and would turn `Ca.sey` into another agent's
  name. Existing agents are not renamed and nothing on disk changes shape.
- **`AssociatedBundleIdentifiers`** on new launchd jobs, so macOS's background-item
  notice says Kosmos rather than `bash`; and the creation screen says the notice is
  coming before macOS says it.

## 7. Honesty rules every screen sentence is held to

1. "We could not look" is never rendered as "there is nothing." An unreadable record is
   an error; an empty one is a fact; a **withheld** one is a third sentence.
2. No sentence claims an act we did not perform, or a state we did not observe.
3. Engine `because` clauses state facts; the **page** gives the one instruction.
4. Errnos and internal paths never reach the screen.
5. A time phrase is only used where it is true — the live verdict ages with the rows,
   and `could_not` carries none, because "could not deliver just now" would suggest
   retrying in a second might work.

## 8. Deliberate deferrals

- **Tick fan-out.** With a project open, three `snapshot()` fan-outs per 5s tick
  (~39 captures on a thirteen-agent fleet). Coalescing means one roster shared *across
  requests*, which is the two-derivations hazard pointed the other way. Self-healing,
  small-fleet-cheap; recorded at the tick site.
- **Verdict-line duplication.** The live line and the history row state nearly the same
  sentence at the moment of sending. They serve different moments, and the pre-existing
  `could_not` path has the same shape.
- **The question/viewport duplication** on a short pane, and the `--label-3` caption on
  `.pj-member small` (pre-existing, likely fails AA in light mode). Both flagged from
  round 2, both design-pass work.
- **`supersede`'s `existsSync` arm** is untested. The aside is
  `<file>.<stamp>.<pid>.<ms>.<kind>`, with the collision counter inserted BEFORE the
  kind (`<file>.<stamp>.<pid>.<ms>.<n>.<kind>`) while anything is in the way, up to
  fifty — so reaching that arm needs fifty asides for one project+agent, in one
  process, inside one millisecond. **The counter is the mechanism that makes the
  refusal unreachable**; the millisecond stamp only spreads names across time and
  is redundant with it (measured in round 11: removing `Date.now()` leaves every
  chat test green, because a same-ms collision falls through to `.2`). An earlier
  wording credited the stamp, which was the wrong half. (Round 9: the counter
  originally appended AFTER the kind, so a same-millisecond second aside ended
  `.damaged.2` and stopped being recognisable by its suffix — the intermittent
  1-in-8 test failure was exactly the kind-last property breaking.) Kept because overwriting the file it is
  rescuing is the one way that function could fail at its whole job.

  ⚠️ **This paragraph was false when first written**, and the falsehood cost a blocker:
  it claimed a millisecond stamp the aside name did not carry (that stamp is on the
  LOCK name, a different string in a different function). The name was therefore a
  constant for one project+agent per process, and the second damaged file was refused
  forever — the fix for the corrupt-file lockout had a lockout in it. Recorded because a
  justification that describes code that does not exist is worse than no justification:
  it stops the next reader checking.
- **Four hand-captured screenshots** are reproduced by nothing; named and dated in
  `docs/browser-checks/README.md` rather than silently violating the regenerable rule.

## 9. How it is verified

- `node --test` for every engine function and route, both legs.
- `docs/browser-checks/render-thread.js` against `thread-server.js`, whose send seam is
  stubbed and which **refuses** to run against a server it cannot tie to the port being
  driven. It caught what the suite could not: a failure sentence that vanished in
  milliseconds, a 3.04:1 verdict line, clause-after-full-stop prose, a keyboard check
  that passed with `tabindex` deleted, and a fixture that had stopped modelling the
  thing it fixtures.
- Every new guard is **perturb-verified**: the fix is removed, the test is confirmed
  red, the fix is restored.
