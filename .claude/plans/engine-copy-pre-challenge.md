---
pre_challenge: true
method: challenge-loop
branch: engine-copy
diff_hash: b25345b0c0a6e95e2b637bcfab92c73dba8627fb89787b1796a9b051dfbebdb2
subdir_audit: passed
timestamp: 2026-08-20T19:25:00-05:00
iterations: 5
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 delivered, plus 2 that produced nothing (see below)
**Findings:** 8 BLOCKERs, 25 WARNINGs, 4 CONVENTIONs, 12 NITs, 12 STRENGTHs
**Fixed:** all BLOCKERs and most WARNINGs | **Deferred with reasoning:** 8 | **Raised to the designer, not fixed:** 4

### The shape of it, which matters more than the count

🛑 **Every BLOCKER after the first pass was in code or copy written since the
previous pass, and the last three were COMMENTS rather than code.** This branch
is nothing but sentences, so kosmos#120's class (a loop generating its own
findings) arrives here in its purest form.

**Iteration 1** -- against the pre-ruling tree. Found a reverted step label whose
list read *"there was nothing running to stop"* directly above *"stopped it"*, a
lower-case sentence start on the removal dialog, a doubled clause, and an
apostrophe inside a single-quoted string. ⚠️ **Its findings were about a tree
that no longer exists**: five sites moved when the rulings landed.

**Iteration 2** -- 3 BLOCKERs, 14 WARNINGs, 3 CONVENTIONs, 4 NITs.

- `chat.js:669` claimed **arrival** on the one path whose job is to say nothing
  was typed. The `COULD_NOT`/`UNCONFIRMED` split is what makes "re-sending is
  safe" true, and `refusalReason`'s own preserved comment states the rule.
- `projects.js` + `you.js` **denied the existence of a thing the roster had just
  shown them.** The gate passes only a TIED name, so two worlds fell through it
  and the sentence was false on the one the gate exists for. 🛑 **The pin was
  green because the sentence was wrong**: the fixture is an untied `stranger`
  and the assertion read `/could not find an agent with exactly this name/`. It
  failed the moment the split landed.
- `remove.js:701` made a **present-tense claim about a state the code destroyed
  two steps earlier**.
- Plus four user-facing sentences the checker **structurally cannot see** (its
  literal patterns excluded the backslash, and a curly apostrophe is one).

**Iteration 3** -- 3 BLOCKERs. A doc comment of mine that **went false in the
commit range that made it false**; a comment describing a defect I had already
fixed, quoting a string that exists nowhere and contradicting the assertion two
lines below it; and `messages.js:141` naming `kosmos msg` when `resolveSender`
serves both `send` and `sendPost`, so a `kosmos post` caller was told about a
command they did not run.

**Iteration 4** -- 1 BLOCKER: the `GROUP_BECAUSE` docblock still described a row
this branch deleted, **while I updated the test's comment about it thirty lines
away in the same commit**. Plus a relative clause left dangling by a rewrite,
and one condition throwing two different sentences.

**Iteration 5** -- 1 BLOCKER: a comment asserting outstanding work the same
commit finished, whose "from" quote had been made current while its "still needs
a decision" framing was not. 🔑 **Editing half a comment is worse than not
editing it**: the fresher half is the one that looks checked.

### Two iterations that produced nothing, recorded because the cause is reusable

Two review agents spawned **with a name** went idle five times between them and
never delivered, including after three direct requests for the findings as the
literal reply body. Every agent spawned **without** a name delivered in full.
Naming makes an agent an addressable mailbox teammate whose final output goes to
its transcript rather than back as a result. **An idle notice is not a result.**

### Why this says `converged: false`

The stopping rule was **written down at `20dbacc`, before iteration 5 reported**,
so the result could not shape it: converged means a pass with zero new BLOCKERs,
WARNINGs or CONVENTIONs, and iteration 5 did not meet it. The PR opens anyway,
per the orchestrator's standing ruling that a PR is not a merge and that a
person reading it is a second instrument sharing no step with this loop.

### Raised to the designer and deliberately NOT fixed

| # | what | why it is not mine |
|---|---|---|
| 1 | the frame **presupposes** the thing one of its reasons denies exists: *"Its instructions were not updated for this folder: this agent has no instructions file yet"* | her ruled frame; and the guard counts occurrences of a word, so it cannot see a presupposition |
| 2 | the frame removed the anchor that fixed what `them` meant, so values now use it for agents and for instructions in one clause | second-order effect of the same ruling |
| 3 | the task-claim reasons answer *what is it doing* when the column asks *who holds this task* | ruled copy, and **my own harmonisation propagated it** |
| 4 | `web/index.html:8385` still sends a person to a README, twice, on the create-failure screen | the branch's own objection applies to it; its replacement is a different situation from the four `create.js` pointers |

### Deferred, with reasoning

| what | why |
|---|---|
| the five remaining jargon hits | three `${x.stderr}` interpolations and one `${found.session}` are IDENTIFIERS; `messages.js:141` is reachable only from a shell, by measurement. Enumerated in the plan with the guard's pass value. |
| `jargon.py`'s `engine/*.js` glob | `server.js` authors screen sentences too. Widening it changes what the guard's number MEANS, so it is the designer's call and is written down rather than done quietly. |
| the singular frame doubling on seven of nine | ruled as **weight rather than a lie**; the keys are authored at engine call sites, so trimming them is a wider change staged out of this branch. ⚠️ The guard covers the GROUP line, which is the rarer path. |
| `chat.js:575` "it will not read this until it finishes" | `PLACED` knows a keystroke was typed, not that it will be read. Flagged, not changed. |
| the download-cancel flake | failed once, passed on an immediate re-run with no change. Timing, and nothing here touches downloads. |

### The finding that was not about this code

🔑 **Nothing checked that what landed matched what was ruled.** Reading the
designer's 30 rows and grepping for each ruled replacement found **8 absent,
three of them silent half-applications** in the applier's own paraphrase. One
**caused a reviewer finding three rounds later**: the ruled sentence was
direction-neutral because one string serves both a send gate (`{ok:false}`) and
a read gate (`{text:null}`), and the substitution spoke only of delivery.

⚠️ **And the guard built to catch that class then caused a defect of its own.**
It keyed on the PATCH file; the RULING doc supersedes it and withdraws one
wording by name. A green check pointed at the wrong document and drove correct
copy back toward the withdrawn version. **A guard keyed on a superseded artifact
is worse than no guard.** Retired, with the reason recorded in the plan.

### Verification

    KOSMOS_REPO=<worktree> python3 Projects/kosmos-design/jargon.py --engine

**kind:** guard · **pass:** `== 5` · **main (same tool):** 62 · **this branch:** 5

⚠️ **That number moved three times today and every move was the TOOL.** The last
move was **downward**, because a pattern requiring 15+ characters inside the
quotes had been pairing the closing quote of a short literal with the opening
quote of the next one, manufacturing false positives out of the junk between
them while hiding real hits. **A falling number when the checker gets stricter
is not progress.**

`yarn test`: **956 pass, 0 fail.** `node --check` on all changed files.
