# Plan: add-commitment-store

**Issue:** joshualeestone/agent-workforce#2, durable commitment store
**Branch:** `add-commitment-store`
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-07
**Spec:** `Josh-Brain/Projects/agent-platform-requirements.md` §7 Recovery

---

## 1. The finding that shapes the whole design

The issue asks for durable commitments. The spec asks for something stricter, and it is
easy to miss:

> *"The costly case is the agent **between** things: it accepted a commitment, is not
> executing at this instant, and after the wipe has no memory of it. A process-liveness
> check reports 'nothing running, safe to proceed,' the user clicks through, and the
> commitment dies silently."*

So the store's job is not "hold a list." **Its job is to make the restart dialog incapable
of lying.** And there is one way a naive store still lies:

**An empty list is not evidence of nothing pending.** A file that does not exist, an agent
that has never reported, and an agent that genuinely has nothing outstanding all produce
the same empty array. Rendering that as "nothing to lose" is precisely the §1 failure the
whole codebase is built to avoid: *a check that cannot tell "fine" from "I can't see it,"
rendering green.*

**Therefore an empty list is only trustworthy when it is an assertion, not an absence.**
The agent must actively say "I am holding nothing," and that statement must be recent.
This is the single design decision everything below follows from.

### The resulting state model

Three states, never two:

| State | Meaning | Restart dialog says |
|---|---|---|
| `holding` | Agent reported N open commitments | Enumerates all N. This is the real decision |
| `clear` | Agent **asserted** nothing pending, recently | "Nothing in flight" — the only case safe to say it |
| `unknown` | Never reported, unreadable, corrupt, or **stale** | "I can't tell what this agent is holding" |

`unknown` is the default for everything we have not positively verified. **It must never
render as safe**, and the dialog must make proceeding from `unknown` feel like the
judgement call it is.

---

## 2. Scope

### In scope

The store, its state model, its read/write API, and its tests. Enough that #1's
confirmation dialog can be built against something honest.

### Out of scope, deliberately

- **The restart control itself (#1).** This unblocks it; it does not build it.
- **Inferring commitments from transcripts.** ⚠️ **This is the one thing that must not be
  built.** Guessed commitments produce false `clear` and false `holding`, and a store that
  guesses is worse than no store, because the dialog then lies with confidence. **The store
  records what it is told and reports `unknown` otherwise.**
- Compact and clear (the other two operations in §7's table).
- Any UI beyond exposing state on the existing status payload.

---

## 3. Storage

Follows `engine/store.js` exactly: same app-data root, same `safeKey` sanitising, same
write-then-rename discipline. **No new dependencies** — the repo is at zero and stays there.

- [x] **3.1** New `engine/commitments.js`. Data at
      `~/Library/Application Support/AgentWorkforce/commitments/<agent>.json`.
- [x] **3.2** Reuse `store.safeKey()` for the filename. Agent names come from tmux session
      names and are untrusted; this is already solved and must not be re-solved.
- [x] **3.3** Atomic write-then-rename, matching `store.writeProfile()`. **Up to 13 agents
      on this machine write concurrently**, and a half-written file that parses as an empty
      array is exactly the silent-loss bug this issue exists to fix.
- [x] **3.4** Record shape:
      ```json
      {
        "agent": "raph",
        "reportedAt": "2026-08-07T18:40:00.000Z",
        "commitments": [
          { "id": "…", "what": "verify the 14:00 sweep settled",
            "createdAt": "…", "source": "agent" }
        ]
      }
      ```
      `reportedAt` is the load-bearing field: it is what separates *asserted empty* from
      *absent*.
- [x] **3.5** A corrupt or unparseable file returns `unknown`. **It must not throw and must
      not fall back to empty.** Both failure modes end with the dialog saying "safe."

---

## 4. Freshness, and why `clear` expires

A "nothing pending" from three hours ago is not evidence about now. The agent has been
working since.

- [x] **4.1** `clear` decays to `unknown` past a staleness threshold, as one named
      constant, not scattered literals.
- [x] **4.2** Default **30 minutes**, chosen to be short enough that a stale assertion
      cannot survive a work session and long enough not to make `unknown` the normal
      state. ⚠️ **This value is a judgement call, flagged for Josh** — it is the one number
      here I would expect to tune once real usage exists.
- [x] **4.3** Always surface `reportedAt` alongside the state, so the UI can show *when*
      rather than implying freshness it does not have. Same discipline as the existing
      `confidence` field in `engine/status.js`.

---

## 5. API

- [x] **5.1** `read(agent)` → `{ state, commitments, reportedAt, because }`.
      **`because` carries why**, matching the existing `because` field on the status engine
      so the UI can explain itself rather than asserting.
- [x] **5.2** `report(agent, commitments)` — the full-state assertion. Replaces rather than
      appends, because an agent saying "here is what I hold" is the only way to express
      *nothing*. **An append-only API cannot represent `clear`**, which is the whole point.
- [x] **5.3** `add(agent, what)` and `resolve(agent, id)` as conveniences over 5.2 for the
      common single-commitment cases.
- [x] **5.4** `readAll()` for the board.

---

## 6. Server surface

- [x] **6.1** Enrich `/api/status` so each agent carries its commitment state. This is what
      #1 will read, and it means the board can show holdings with no second request.
- [x] **6.2** `PUT /api/agent/:name/commitments` for programmatic reporting, following the
      existing profile-endpoint shape (`knownAgent` guard, capped body, field allowlist,
      verbatim-safe error text).
- [x] **6.3** ⚠️ **This adds another unauthenticated write endpoint.** The app still has no
      login and #10 is deferred, so this is contained only by the loopback bind. It is the
      same risk class as the existing profile and avatar writes, not a new one, but it is
      noted rather than discovered. **It must be covered by the default-deny gate when auth
      lands** (recorded in the superseded `add-authentication` plan's §2 and on issue #10).

---

## 7. Tests

Match the existing pattern: `node --test engine/*.test.js`, no framework.

- [x] **7.1** Round trip: report, read back, states match.
- [x] **7.2** **Absent file returns `unknown`, NOT `clear`.** The single most important test
      in this branch. If this one regresses, the restart dialog starts lying.
- [x] **7.3** **Asserted-empty returns `clear`**, and is distinguishable from 7.2.
- [x] **7.4** **Corrupt/truncated JSON returns `unknown`**, does not throw, does not return
      empty.
- [x] **7.5** `clear` past the staleness threshold returns `unknown`.
- [x] **7.6** Concurrent writes leave a valid file (write-then-rename holds).
- [x] **7.7** Path traversal in an agent name cannot escape the store.
- [x] **7.8** `npm test` green, still zero dependencies.

**Verify the tests by breaking the code**, per the repo's existing practice
(`d77d743 Add tests for the status engine, verified by reintroducing the bugs`). A test for
7.2 that passes against a store that returns empty is worthless.

---

## 8. Repo hygiene — ⛔️ DESCOPED from this PR

- [ ] **8.1** Run `/repo-setup`. This repo still has **no `CLAUDE.md`**, no
      `.claude/settings.json`, and no PR template. It was folded into the superseded auth
      branch and never landed, so it moves here.

---

## 9. Definition of done

1. `npm test` green, zero dependencies.
2. **An agent that has never reported reads as `unknown`, and no code path turns absence
   into `clear`.**
3. A corrupt file reads as `unknown` without throwing.
4. `/api/status` carries commitment state for every agent.
5. `/challenge-loop` to convergence, proof file committed.
6. PR with `joshualeestone` as reviewer, `Addresses #2` (non-closing until #1 consumes it).

---

## 10. Assumption stated explicitly

**Commitments are recorded by whoever holds them, never inferred.** For this fleet that
means agents write their own, formalising the hand-maintained obligations file the issue
describes. For the product it means the platform records what it is told.

**If nothing ever reports, every agent reads `unknown` forever** — and that is the correct
behaviour, not a gap. An honest "I don't know what Raph is holding" is the thing that makes
the restart dialog a real decision. A confident empty list is what loses the work.
