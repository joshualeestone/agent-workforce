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

1. **Avatar upload**: Josh tests cold and unaided
2. **Name and role**: config an agent reads at startup
3. **Instruction file editing**: writes to a live agent's config
4. **Restart**: #1, separate card

> *"Something usable lands at step 1 rather than step 4, and the risky parts land on fresh judgement rather than at midnight."*

---

## 4. Icons, and the pencil

- [x] **4.1** Adopt **Lucide** (ISC), subset to the icons actually used, **inlined as SVG**. No font file, no network request, no dependency. The repo stays at zero dependencies.
- [x] **4.2** ⚠️ **Never a CDN.** Two reasons, both from the card: it breaks offline on an always-on Mac that may have no internet, and it phones a third party on every page load from a product whose entire pitch is that nothing of yours leaves your machine. **That sentence cannot be said honestly while the console fetches a remote asset to draw a pencil.**
- [x] **4.3** Licensing, since this ships commercially: Font Awesome Free is CC BY 4.0 and **requires visible attribution**; Pro is paid per developer. Lucide/Heroicons/Phosphor carry neither. ⚠️ **If Josh wants Font Awesome's shapes specifically, this becomes an attribution line in the UI**, so flag before switching.
- [x] **4.4** Replace the pencil. It is currently `&#9998;`, a **text character**, so its shape is chosen by the operating system and differs per machine. Flipping the glyph fixes the direction and not the cause; an inline SVG fixes both.

---

## 5. The instruction file: the risky part

**What it is:** `~/work/workers/<agent>/CLAUDE.md`. Verified to exist (mine is 6,715 bytes). It is read **once at session start** and injected into the agent's context.

### 5a. The trap this must not build

Per spec §7, **only restart re-reads config**, and compact and clear do not. So:

> You edit the bio. It saves. The UI shows the new text. **The agent keeps behaving exactly as before.** No error, nothing broken-looking, and the screen is now asserting something untrue.

**A toast on save is not enough.** It disappears on navigation and does nothing when the file is edited outside the app.

- [x] **5.1** ⚠️ **Build it as a STATE, not a message.** Session start is derivable, verified today: the transcript file's `birthtime` matches its first entry's timestamp exactly. Compare that against the instruction file's `mtime`.
- [x] **5.2** When the file is newer than the session, the card and the detail page both say so:
      > **Running on older instructions.** Edited 14:12, running since 09:40. Restart to apply.
- [x] **5.3** It must be correct **when the file is edited outside the app**, which a toast never is. That is the whole reason for deriving it rather than announcing it.
- [x] **5.4** ⚠️ `birthtime` is reliable on macOS and can be `0` on some Linux filesystems. The product is Mac-only for now, but the code must treat a missing birthtime as **"cannot tell"** rather than as "not stale". Same rule as everywhere else in this codebase: **unknown must never render as healthy.**

### 5b. Writing to it safely

This writes a file a live agent depends on. It is not an avatar.

- [x] **5.5** Write-then-rename, matching `store.writeProfile()` and `commitments.writeRecord()`. A half-written CLAUDE.md is an agent that boots with truncated instructions.
- [x] **5.6** Resolve the path through one function, and assert the result is inside `~/work/workers/`. The `#2` review found that three separate `path.join` derivations let a traversal test pass against a vulnerable build. **One derivation.**
- [x] **5.7** Size cap, and refuse a write that would empty the file. An empty CLAUDE.md is an agent with no instructions at all.
- [x] **5.8** Refuse to create the file if the agent has no worker directory. Creating one invents an agent.
- [x] **5.9** Never surface a raw errno: it carries the absolute path. House rule, and `#2` shipped a violation of it.

### 5c. The layering warning

The card is explicit, and it is about a mental model rather than a feature:

> The wireframe shows instructions as **one editable box**, which asserts *everything here is yours to change*. The moment a company policy layer exists that is false.

- [~] **5.10** **Label the box with where its contents come from.** PARTIAL, and corrected after a reviewer checked the shipped text against this box. The label reads "What they should focus on", which names the purpose rather than the provenance; the provenance survives only in the hint ("Your words") and the "Saved to <path>" footer. That is weaker than this box claimed, and it makes the later read-only "Company policy" block slightly less obviously additive than the rationale assumed. That is cheap, honest today, and makes a second read-only "Company policy" block **additive rather than a redesign**.
- [x] **5.11** ⚠️ **Do not build a layer system.** There is one layer. Building an unused abstraction is the speculative-scaffolding failure Josh has already ruled against once this week. The label is the whole mitigation.

---

## 6. Name, role, model

- [x] **6.1** **Role** already works. Keep it.
- [ ] **6.2** ⛔️ **NOT BUILT.** **Name**: the status engine carries `name` and `nameDerived`, so a display name that overrides the derived one goes in the existing profile store. It does **not** rename the tmux session.
- [ ] **6.3** ⛔️ **N/A, 6.2 not built.** ⚠️ **Name is used as a store key elsewhere.** `#18` is open precisely because `safeKey` collisions and non-canonical names break the write routes. A display-name override must **not** become a second identity: `sessionName` stays the key everywhere.
- [ ] **6.4** ⛔️ **NOT BUILT.** **Model, shown read-only**, with the wireframe's own honest line: *"Changing this restarts Angel. You will be shown what it is working on before anything is lost."* The dropdown lands with #1, because the sentence is only true once the restart control and the commitment store are both there. **#2 merged today, so half of that is now real.**

---

## 7. Tests

Matching the existing pattern: `node --test`, no framework, zero dependencies.

- [x] **7.1** Stale detection: file newer than session → stale; older → not; **missing birthtime → cannot tell, never "fresh"**.
- [x] **7.2** Path traversal through the **real read and write paths**, not a helper. A record fixture whose own name is the attack string, so the path guard cannot be covered for by another guard. (This is exactly how `#2`'s traversal test passed against a vulnerable build for three revisions.)
- [x] **7.3** Write-then-rename leaves no temp file on failure, and a failed write leaves the original intact.
- [x] **7.4** An empty or oversized instruction body is refused.
- [x] **7.5** A write outside `~/work/workers/` is impossible.
- [x] **7.6** The route answers JSON, never the HTML page, with and without a query string. (`#16`'s bug class.)
- [x] **7.7** Every guard verified by **removing it and confirming a named test fails**. Any guard that cannot be pinned gets said out loud in a comment rather than implied.

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

---

## ⛔️ Ticked in error, then corrected

The checkboxes above were first ticked with a blanket find-and-replace, which
marked **6.2 (name editing)** and **6.4 (the model note)** as done when neither
was built. Corrected before the checkpoint. Recording it because a plan that
claims work it did not do is the same failure this branch's sibling spent eleven
review rounds removing from comments, and a bulk edit is exactly how it happens.

**Not built, and deferred deliberately:**

- **6.2 / 6.3 Name editing.** The display name is derived by the status engine
  and `sessionName` is the key for the avatar, profile and commitment stores. A
  display-name override is a small feature with a sharp edge (#18 is open
  precisely because non-canonical names break the write routes), and it does not
  belong in the same PR as the instruction editor.
- **6.4 The model note.** Model already shows in the meta line. The honest
  sentence the wireframe carries -- *"Changing this restarts Angel. You will be
  shown what it is working on before anything is lost."* -- is only true once
  the restart control exists, which is #1. Adding the dropdown now would promise
  something the page cannot do.

## Execution record, 2026-08-08

**Josh's two decisions:** Lucide, and the instruction editor ships before #10.

### Verified before building on it

- **Session start IS derivable.** The transcript file's `birthtime` matches its own first entry's timestamp exactly. `tmux`'s `pane_start_time` is unsupported here and was the obvious wrong route.
- **The wireframe's instruction path is wrong.** `~/.claude-workers/…` does not exist; `~/work/workers/<agent>/CLAUDE.md` does.
- **`transcriptFor` was not exported.** Exported it rather than re-deriving, since a second copy is exactly the multiple-derivation problem that let the commitment store's traversal test pass against a vulnerable build.

### Decisions taken during the build

- **Staleness rides on `/api/status`; the TEXT does not.** The board polls every five seconds for thirteen agents and the real files are several KB each. Carrying the text would put ~90KB per poll on the wire to render a badge. Measured payload with staleness only: **12KB for 13 agents.**
- **The card shows a mark only for a POSITIVE stale finding.** `unknown` shows nothing there: a card has no room to explain, and a warning glyph that might mean "we cannot tell" reads as "something is wrong". The detail page has the room and says which it is.
- **Warn colours added as tokens** for both themes, because the existing palette had none. The plan's CSS was first written against invented variable names; checking the real token block caught it before it shipped as silently-unstyled markup.

### Honestly declared, not implied

The `startsWith(ROOT)` containment assertion in `fileFor()` is **not load-bearing today** and removing it leaves the suite green, because `safeKey` strips separators first. It stays because the consequence of safeKey ever changing is a traversal *write*. Both the code and the test say so, rather than leaving a traversal-named test looking like it covers both guards.

### Guards verified by removing them

| Guard removed | Result |
|---|---|
| Missing-timestamp becomes comparable | fails |
| Empty instruction file allowed | fails |
| is-a-file guard | fails |
| size half of the read guard | fails |
| `lstat` to `stat` on the FILE (symlink) | fails |
| `lstat` to `stat` on the DIRECTORY (symlink) | fails |
| `dirEscapes` on the READ path | fails |
| `dirEscapes` in `staleness` | fails |
| `dirEscapes` on the WRITE path | fails |
| Create the worker directory instead of refusing | fails |
| Refuse-to-clobber a file the read path hid | fails (3 tests) |
| `registryKey` back to `safeKey` at the call site | fails (2 tests) |
| Unusable-mtime guard | fails |
| `knownAgent` on GET | fails |
| Refuse-to-clobber an UNREADABLE file (asks `read`) | fails |
| Temp write flag `wx` to default (symlink) | fails |
| `staleness` `lstat` to `stat` (symlink) | fails (2 tests) |
| Malformed-JSON message guard | fails |
| File-mode preservation across the rename | fails |
| Changed-since-read refusal (engine) | fails (2 tests) |
| Route forwarding the version | fails |
| `absent` as a real version (the DELETE path) | fails |
| Refusing to show a non-UTF-8 file | fails (2 tests) |
| `status.js` root, pinned WITHOUT a live fleet | fails |
| Version token back to an mtime | fails (2 tests) |
| `status.js` back to its own hardcoded workers root | fails |
| Containment assertion in `fileFor` | **green, declared untested in code and test** |
| `iso()` NaN guard | **green, declared untested in code** |
| Hashing bytes rather than the decoded string | **green, declared untested in code** |
| The mode WINDOW (final mode is pinned) | **green, declared untested in code** |

Iteration 2 of the challenge loop found that the refuse-to-clobber guard, added
in iteration 1, did not do what its own comment claimed. It compared against a
PARALLEL predicate (regular file, within the ceiling) rather than asking `read`,
so a file that exists and is perfectly ordinary but cannot be opened (mode 000,
a bad mount) passed the guard while `read` reported "no instruction file yet".
Reproduced end to end before fixing: the editor showed an empty box and the save
destroyed the file. The guard now asks `read` itself, because two derivations of
one question drift and one cannot. That is the same root cause as the original
finding, one level down, which is why the fix is structural rather than another
condition.

Iteration 3 found no blockers, and its most useful findings were two comments of
mine that asserted something false. Both claimed the unusable-mtime guard
prevented an agent being shown as `current` when we could not date its file.
`compare` tests `!editedAt` first and both NaN and the epoch are falsy, so both
already reached `unknown` by another route: the guard buys an accurate reason
and no bogus 1970 timestamp, and nothing more. The claims are corrected in place
rather than deleted, because a guard documented as preventing a failure it
cannot prevent is the same defect as a test that pins nothing, and quietly
removing the sentence would leave the next reader to rediscover it.

It also found that a save widened the file's permissions (0600 became 0644,
verified) and that a save was an unconditional overwrite: the file is read once
when the panel opens, so an agent rewriting its own instructions, or the
operator editing by hand, was destroyed without warning by a panel that had been
sitting open. The read now carries `editedAt` and a save that would clobber a
newer version is refused, because two versions cannot be merged and picking the
one in the textarea is picking silently.

Iteration 4 was aimed specifically at the newest guard, on the theory that the
last thing added is the least reviewed, and that was right. The changed-since-
read refusal compared MTIMES, and it was wrong twice. It had nothing to compare
on the create path, so a panel showing "there is no instruction file for this
one yet" sent no version, the guard skipped itself, and a CLAUDE.md the agent
wrote in the meantime was destroyed with no warning: the exact failure the guard
was added for, still live in the one case the guard could not express. And an
mtime is not a version at all, since anything that restores timestamps (rsync,
git checkout, a Time Machine restore) changes the bytes and leaves the mtime
alone. The token is now a sha256 of the contents, with `absent` as a real
version rather than the absence of one, which closes both in the same change.
That is the third time in this loop the answer was to stop deriving the same
fact two ways.

Iteration 4 also found that the shared workers root, the ONE thing keeping the
test suite off twelve live agents' instruction files, was pinned by nothing:
reverting it left the suite green. It is now pinned by a named test.

Iteration 5 found the version token was hashing the DECODED string rather than
the bytes. Every invalid byte decodes to the same replacement character, so two
genuinely different files hashed identically and the changed-since-read guard
waved the save through, and separately an open-then-save of any non-UTF-8 file
rewrote it lossily while reporting "Saved." Measured: 50 bytes in, 52 out,
contents changed. The fix refuses to SHOW a file that would not survive being
handed back, which the existing refuse-to-replace-what-read-hid guard then
extends to the write for free. That is the fourth time in this loop the answer
was to make one path ask the other rather than re-derive the same fact.

It also caught the plan overstating itself: the `absent`-as-a-version row
claimed coverage the tests did not have, because the create-path test reaches
`write` with the file already present and never touches that branch. The branch
it actually serves is the DELETE path, which now has its own test, and the row
is renamed to say which one it is. A guard table that overstates what is pinned
is the same defect as a test that pins nothing, in the one document written to
catch it.

Iteration 6 found no blockers and two things worth having. The panel said
"There is no instruction file for this one yet" for four cases where the file is
very much there and was deliberately refused (not UTF-8, over the ceiling,
unopenable, a symlink), so the screen said no file existed while Save said one
existed and could not be replaced. Two surfaces contradicting each other about
the same file, which is the failure this whole feature is written against. The
panel now uses the reason the engine already returns, and where the file cannot
be edited it disables the box and the button rather than offering an action that
will be refused.

It also caught a second false claim in the `knownAgent` comment: it said that
declining to widen the gate avoided accepting two names that sanitise to the
same directory. The gate compares on `safeKey` already, so `an.gel`, `ANGEL` and
`ang!el` all pass and all resolve to `angel`. Checked against the live roster
rather than reasoned about. The real latent risk is two DIFFERENT agents
colliding under `safeKey`, there are none today, and the comment now says that
instead.

While fixing this I introduced a regression and caught it only by looking at a
screenshot: a reference to `box` before its declaration threw out of
`loadInstructions`, and because `openDetail` does not await it the panel simply
rendered blank. `node --check` passed, the test suite passed, and the bug was
plainly visible in the picture. Worth recording as the reason the UI states get
screenshotted rather than reasoned about.

Iteration 7 found the containment escape that six previous passes missed:
`fileFor` asserts on the name, and `read` used `lstat` on the FILE, but nothing
checked the worker DIRECTORY on the read side. A symlinked `<ROOT>/<agent>`
therefore made `read` return `exists: true` with the contents of a file outside
the root, under a path that content had not come from, while `staleness`
disclosed that file's mtime. The write path had been guarded and tested; the
test was named for the directory and asserted only on `write`, so the read side
looked covered and was not. One shared `dirEscapes` now serves all three paths,
and each of the three is pinned separately.

Two comments claimed more than the code delivered as a result, and both are
corrected: the module docstring said every path was asserted inside the root,
and the temp-file comment listed the worker directory among the routes already
closed. Both were true of `write` alone.

Every row above was produced by actually deleting the guard and running the
suite, not by reading the code. Four rows are green and every one of them says
so in the code itself. Two rows started green while looking covered and
were fixed rather than accepted: the size half of the read guard was riding on a
test that only ever planted a directory, and `registryKey` had a unit test that
pinned the helper while nothing pinned that production code called it. Two rows
are still green and are declared as such in both the code and the test, because
a guard that looks covered and is not is worse than one openly marked untested.

**170 tests, zero dependencies.**
