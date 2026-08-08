# Plan: add-editable-agent-detail

**Issue:** joshualeestone/agent-workforce#9, agent detail page, editable
**Branch:** `add-editable-agent-detail`
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-08
**Wireframe:** `Josh-Brain/Projects/agent-platform-wireframes/screen3-agent-detail.png`

---

## 1. ⚠️ The binding constraint, first

From the card, and it governs everything below:

> **This card IS the first real write surface.** It is safe right now for exactly one reason: the server binds to `127.0.0.1`. There is no auth, no token, no check on who is asking.

**Nothing in this plan binds to anything but loopback.** The tempting one-line change lives in this card's code, which is why the warning is repeated at the top of the plan and not only on the issue.

This branch also adds the **most powerful write yet**: editing the file an agent reads at startup. That is a bigger deal than an avatar, and it is why §5 is the longest section here.

---

## 2. What the wireframe shows that this plan does NOT build

The wireframe is considerably broader than the card, and two parts of it are stale or unbacked. Listing them so the gap is a decision rather than an oversight.

| Wireframe element | Status | Why |
|---|---|---|
| **Printed `97%` in the ring** | ⛔️ **Stale** | Contradicts a settled decision: *avatars in the gauge, no printed percentage, coloured arc*. The wireframe predates it. **Do not build it back.** |
| **Instruction path `~/.claude-workers/angel/CLAUDE.md`** | ⛔️ **Wrong** | Verified: that path does not exist. The real one is `~/work/workers/<agent>/CLAUDE.md`, as the card says. |
| **Projects Angel can work in** | ⏭️ Deferred | **There is no project data model.** The `projects` in `engine/status.js` are Claude config roots, not agent projects. Building this means inventing the model that #4 and the Joint Projects decision will define. Assuming an answer now bakes it into storage where it is expensive to remove. |
| **Allowed without asking** (permissions) | ⏭️ Deferred | Same: no data model, and it *is* the permission-posture decision (spec §3), which is explicitly still open with Josh. |
| **Restart / Stop** | ⏭️ #1 | Next card. #2 just merged, so its confirmation can now enumerate what will be lost. |
| **Danger zone / Archive** | ⏭️ Not in card scope | Destructive, and it needs the archive semantics deciding first. |

**What that leaves is still the whole point of the card**: the page becomes editable, and the instruction file stops being invisible.

---

## 3. Ordering, taken from the card

The card sets this order deliberately, riskiest last:

1. **Avatar upload** — Josh tests cold and unaided
2. **Name and role** — config an agent reads at startup
3. **Instruction file editing** — writes to a live agent's config
4. **Restart** — #1, separate card

> *"Something usable lands at step 1 rather than step 4, and the risky parts land on fresh judgement rather than at midnight."*

---

## 4. Icons, and the pencil

- [ ] **4.1** Adopt **Lucide** (ISC), subset to the icons actually used, **inlined as SVG**. No font file, no network request, no dependency. The repo stays at zero dependencies.
- [ ] **4.2** ⚠️ **Never a CDN.** Two reasons, both from the card: it breaks offline on an always-on Mac that may have no internet, and it phones a third party on every page load from a product whose entire pitch is that nothing of yours leaves your machine. **That sentence cannot be said honestly while the console fetches a remote asset to draw a pencil.**
- [ ] **4.3** Licensing, since this ships commercially: Font Awesome Free is CC BY 4.0 and **requires visible attribution**; Pro is paid per developer. Lucide/Heroicons/Phosphor carry neither. ⚠️ **If Josh wants Font Awesome's shapes specifically, this becomes an attribution line in the UI** — flag before switching.
- [ ] **4.4** Replace the pencil. It is currently `&#9998;`, a **text character**, so its shape is chosen by the operating system and differs per machine. Flipping the glyph fixes the direction and not the cause; an inline SVG fixes both.

---

## 5. The instruction file: the risky part

**What it is:** `~/work/workers/<agent>/CLAUDE.md`. Verified to exist (mine is 6,715 bytes). It is read **once at session start** and injected into the agent's context.

### 5a. The trap this must not build

Per spec §7, **only restart re-reads config** — compact and clear do not. So:

> You edit the bio. It saves. The UI shows the new text. **The agent keeps behaving exactly as before.** No error, nothing broken-looking, and the screen is now asserting something untrue.

**A toast on save is not enough.** It disappears on navigation and does nothing when the file is edited outside the app.

- [ ] **5.1** ⚠️ **Build it as a STATE, not a message.** Session start is derivable, verified today: the transcript file's `birthtime` matches its first entry's timestamp exactly. Compare that against the instruction file's `mtime`.
- [ ] **5.2** When the file is newer than the session, the card and the detail page both say so:
      > **Running on older instructions.** Edited 14:12, running since 09:40. Restart to apply.
- [ ] **5.3** It must be correct **when the file is edited outside the app**, which a toast never is. That is the whole reason for deriving it rather than announcing it.
- [ ] **5.4** ⚠️ `birthtime` is reliable on macOS and can be `0` on some Linux filesystems. The product is Mac-only for now, but the code must treat a missing birthtime as **"cannot tell"** rather than as "not stale". Same rule as everywhere else in this codebase: **unknown must never render as healthy.**

### 5b. Writing to it safely

This writes a file a live agent depends on. It is not an avatar.

- [ ] **5.5** Write-then-rename, matching `store.writeProfile()` and `commitments.writeRecord()`. A half-written CLAUDE.md is an agent that boots with truncated instructions.
- [ ] **5.6** Resolve the path through one function, and assert the result is inside `~/work/workers/`. The `#2` review found that three separate `path.join` derivations let a traversal test pass against a vulnerable build. **One derivation.**
- [ ] **5.7** Size cap, and refuse a write that would empty the file. An empty CLAUDE.md is an agent with no instructions at all.
- [ ] **5.8** Refuse to create the file if the agent has no worker directory. Creating one invents an agent.
- [ ] **5.9** Never surface a raw errno: it carries the absolute path. House rule, and `#2` shipped a violation of it.

### 5c. The layering warning

The card is explicit, and it is about a mental model rather than a feature:

> The wireframe shows instructions as **one editable box**, which asserts *everything here is yours to change*. The moment a company policy layer exists that is false.

- [ ] **5.10** **Label the box with where its contents come from** — "Your instructions", with the real path shown beneath, as the wireframe already does. That is cheap, honest today, and makes a second read-only "Company policy" block **additive rather than a redesign**.
- [ ] **5.11** ⚠️ **Do not build a layer system.** There is one layer. Building an unused abstraction is the speculative-scaffolding failure Josh has already ruled against once this week. The label is the whole mitigation.

---

## 6. Name, role, model

- [ ] **6.1** **Role** already works. Keep it.
- [ ] **6.2** **Name** — the status engine carries `name` and `nameDerived`, so a display name that overrides the derived one goes in the existing profile store. It does **not** rename the tmux session.
- [ ] **6.3** ⚠️ **Name is used as a store key elsewhere.** `#18` is open precisely because `safeKey` collisions and non-canonical names break the write routes. A display-name override must **not** become a second identity: `sessionName` stays the key everywhere.
- [ ] **6.4** **Model, shown read-only**, with the wireframe's own honest line: *"Changing this restarts Angel. You will be shown what it is working on before anything is lost."* The dropdown lands with #1, because the sentence is only true once the restart control and the commitment store are both there. **#2 merged today, so half of that is now real.**

---

## 7. Tests

Matching the existing pattern: `node --test`, no framework, zero dependencies.

- [ ] **7.1** Stale detection: file newer than session → stale; older → not; **missing birthtime → cannot tell, never "fresh"**.
- [ ] **7.2** Path traversal through the **real read and write paths**, not a helper. A record fixture whose own name is the attack string, so the path guard cannot be covered for by another guard. (This is exactly how `#2`'s traversal test passed against a vulnerable build for three revisions.)
- [ ] **7.3** Write-then-rename leaves no temp file on failure, and a failed write leaves the original intact.
- [ ] **7.4** An empty or oversized instruction body is refused.
- [ ] **7.5** A write outside `~/work/workers/` is impossible.
- [ ] **7.6** The route answers JSON, never the HTML page, with and without a query string. (`#16`'s bug class.)
- [ ] **7.7** Every guard verified by **removing it and confirming a named test fails**. Any guard that cannot be pinned gets said out loud in a comment rather than implied.

---

## 8. Definition of done

1. `npm test` green, still zero dependencies.
2. The pencil is an inline SVG pointing the way Josh asked, and no icon is fetched from a network.
3. The instruction file is editable in the app, with its real path shown.
4. **An agent running on older instructions says so, and keeps saying so after a page reload and after an edit made outside the app.**
5. Nothing binds to anything but `127.0.0.1`.
6. `/challenge-loop` to convergence or an explicit stop, proof committed.
7. Screenshots in the PR and posted to Discord before merge.

---

## 9. Two things I want Josh to decide

Neither blocks starting; both change the finished screen.

1. **Icon set.** Lucide unless he wants Font Awesome's shapes specifically, in which case an attribution line goes in the UI.
2. **Whether the instruction editor ships behind anything.** It writes the file a live agent boots from. It is safe on loopback, and it is the single most powerful thing on this page. If he would rather it land after #10 rather than before, that is a reasonable call and the rest of the card still ships without it.
