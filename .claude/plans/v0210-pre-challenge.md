---
pre_challenge: true
method: challenge-loop
branch: v0210
diff_hash: 69f96286206cfad2fbcecc85fd758693bc1a1d9ac350edb8ec7c15866b972b5e
subdir_audit: passed
timestamp: 2026-08-21T11:22:00-05:00
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1, and the reason is stated rather than assumed
**Findings:** 2 BLOCKERs, 2 WARNINGs, 3 STRENGTHs
**Fixed:** 4

### Why one iteration

⚠️ **Josh asked for this release by name and by speed** (*"not wait another half
a day just to get a couple small things out"*). The four largest pieces in it
were each reviewed on their own branch — `project-name`, `answer-route`,
`member-stale`, `owes-reply` — and merged together with the suite run on the
joint tree **before** any of their PRs opened. What is new here is three CLI
sentences, one prose paragraph and a version bump.

📌 **The honest form: this is a release-assembly branch, not new engineering.**
A full loop over it would re-review work that already had one.

### The findings

**[BLOCKER] `install/kosmos:187` — "Stopped." was asserted unconditionally.**
The pidfile was removed whether or not the process died, so a failed stop made
Kosmos **forget a live process** and land in the state the same file describes
elsewhere as *"something is answering that this command did not start"*.
🛑 **A hedge was explicitly refused**: *"Asked it to stop"* would have made us
honest about a bug we chose to keep. It checks now, and a failed stop **keeps
the pidfile and says so** — the record must survive exactly when the action did
not.

**[BLOCKER] the block pins could not survive a rewrap.** The first version
asserted `/reads like an ordinary question/` and **failed immediately** on
`"reads like an ordinary\nquestion"`, because the block is hard-wrapped at
source. 🔑 **A pin on a phrase in wrapped prose breaks on rewrapping, which a
copy pass does routinely and which changes nothing about the meaning.** `\s+`
for every space pins the sentence rather than the line width.

**[WARNING] the three CLI sentences are unpinned.** Nothing in the suite asserts
them, which is how `:347` survived contradicting `chat.js`'s own claim table.
**Recorded, not fixed here**: a shell-level pin is its own piece of work and this
release was asked for by speed.

**[WARNING] `#122`'s paragraph is not the fix and must not be recorded as one.**
The evidence says a rule is not the mechanism — an agent broke this exact rule
eleven minutes after explaining it to two colleagues. It ships because an agent
with **no** rule cannot even try. #145's detection half is what catches the lapse.

**[STRENGTH]** `:278` takes the web's own word (*"Placed into casey"*), so the
CLI and the screen now describe one state identically. That is the defect this
release exists to close, not a tidy-up: an agent and an operator comparing notes
must not be reading two different claims about one event.

**[STRENGTH]** The paragraph names **the feeling** rather than the category.
*"Reads like an ordinary question"* is available to the reader at the exact
moment the rule is failing, because it is what they are experiencing; a rule
keyed on a category cannot fire when the reader has filed the input under a
different one.

**[STRENGTH]** `healColleagues` rewrites the block from `blockBody()` on any
`syncAgent`, so the paragraph reaches **existing** agents at the next membership
sync, not only new ones. Verified by reading the call site rather than assumed.

### Why `converged: false`

No second blind pass ran. The stopping rule was **speed, stated by the person
asking for the release**, and the acceptance test is a live one that no loop can
substitute for: *make a brand new agent and say hello to it in a project room.*
If it answers without being taught the command, the chain works end to end.

### Verification

    yarn test         1007 pass, 0 fail
    sh -n install/kosmos

Proven by deleting the new paragraph: both block pins fail with the sentences
they carry.
