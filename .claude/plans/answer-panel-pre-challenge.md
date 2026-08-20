---
pre_challenge: true
method: challenge-loop
branch: answer-panel
diff_hash: 2faf3a48a6afa8b49dba05fb709cda4db3f3a9b05b404c72800b3a9725b8601a
diff_hash_certifies: the diff at 99f3e19, the iteration-10 fix, which is the tree the gate verified when PR #119 was created
head_now: eeee5f4
code_diff_hash_now: b930406b7b650e81cf0ca768e613b8e90b0515bf4707dc364351d8c3d5e1cb83
code_diff_hash_at_round_10: 35bd501e0e3d4e676376903f47551812eeaee27cf7f5d391de4e2187499313bd
subdir_audit: passed
timestamp: 2026-08-20T14:00:57Z
iterations: 16
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16 -- ten before PR #119 opened, six against the open PR
**Findings through iteration 10:** 72 across nine reporting rounds (3 BLOCKERs, 30 WARNINGs, 3 CONVENTIONs, the rest NITs and orchestrator-found defects)
**Fixed:** 68 | **Deferred with reasoning:** 2 | **Open and recorded:** 2
**Iterations 11 to 16:** 8 further BLOCKERs, recorded below. **Seven of the eight were inside the previous round's own fix.**

### 🛑 The two hashes above are the point of this block, not bookkeeping

`diff_hash` is what the gate verified at PR creation, and it is **not** the diff that exists now. Six rounds landed after it, so the certified tree and the current tree are different trees. Recomputing that field would make this file claim a converged loop covered code no blind pass has seen. It is left alone and the current tree is recorded beside it, code-only (excluding `.claude/plans/`, so that editing this very file cannot move its own hash).

> 🔑 **A proof file is a timestamp, not a property.** The value of the pair is that anyone can see at a glance that the two differ and by how much.

### The shape of it, which matters more than the count

**Three BLOCKERs, and two of them were guards failing on their own terms.**

1. Round 2 reported that a clock-only repaint drops a reader to the oldest message. **Measured false** and deferred: on a box that genuinely overflows, with the markup genuinely rewritten (both proven by controls), `scrollTop` does not move. What was real in it: nothing covered the case, because every fixture was dated January 2026 and repainted byte-identically. That case is now a block with two controls.
2. Round 8: the `QUESTION` fixture carried no `NEEDS_YOU` marker, so `questionIn` returns null and the route could never serve it. **Ten of twenty-two committed screenshots were drawn from a payload the server cannot produce.**
3. Round 9: the reachability check written to close that class asked whether a marker EXISTS. The producer's constraint is where the LAST one is. **The fixture that failed it shipped in the same commit as the check.**

**Six consecutive rounds found a comment documenting behaviour the code does not have, and every one was inside the previous round's own fix.** Round 7's was a "second line of defence" that does not exist. Round 8's was a headed-only claim the very next commit disproved. That is the single strongest pattern in this loop and it is the reason the last three briefs named it explicitly.

**Reading the screenshots out-earned reading the code from round 5 on.** Two sentences contradicting each other on one screen (`talk-9-unfilable`), a CSS rule that had its element and lost on specificity, a receipt sitting on the opposite side of the panel from its message, three fixtures describing states the product cannot be in, and "sent as 1" on a message that was never typed: all found by looking.

### Every new guard was proven by breaking it

Fourteen deliberate breaks, each reverted after the check was watched to fail with the symptom named: the borrowed-name sentence, the composer's disable, the trim-at-source, the focus rescue, the two-armed 404, the `--k-sunk` theme scoping, the persistence hide AND its restore, the receipt alignment, the scrollbar rule, the `talkKey` decoys, the line-0 fallback, the marker position, and the wire suffix.

**Two of those breaks failed to fail, and both changed the outcome:** the scroll-hold check passed with the fix removed (Chromium already preserves the offset, so the fix was deleted rather than shipped), and a geometry assertion fired on three states that were correct (so it was replaced with a computed-style one).

### Per-iteration breakdown

**Iteration 1** -- 4 WARNINGs, 1 CONVENTION, 3 NITs. A panel that said "No agent by that name" beside a card carrying that name; a pasted message that could be sent into a live agent twice; a failure arm with no focus rescue; a documented route asymmetry no test held.

**Iteration 2** -- 2 BLOCKERs, 4 WARNINGs, 2 NITs. One BLOCKER measured false and deferred; the other was that no fixture could see the case at all. `borrowedName` fails closed, so the standing-vs-transient split written one round earlier rested on a false premise.

**Iteration 3** -- 3 WARNINGs, 4 NITs. A promise that a conversation is kept, printed under the sentence saying there is none. `talkKey`'s comment claimed "character for character" with two divergences live.

**Iteration 4** -- 3 WARNINGs, 3 NITs. Iteration 3's own fix re-showed the promise for the whole of every poll. A guard that counted buttons `page.click` could not click.

**Iteration 5** -- 4 WARNINGs, 2 NITs, 1 CONVENTION. A CSS rule that had its element and lost on specificity. The app's own 5s tick racing every hand-driven paint.

**Iteration 6** -- 5 WARNINGs, 2 NITs. A fixture pairing `asking` with "there is no Claude running", which the producers cannot make. The receipt still stranded; only the separator had moved.

**Iteration 7** -- 4 WARNINGs, 4 NITs. A "second line of defence" that does not exist. The previous round's fix applied to the state that had a screenshot rather than to the class.

**Iteration 8** -- 1 BLOCKER, 6 WARNINGs, 2 NITs. Ten of twenty-two screenshots drawn from a payload the route cannot produce. Three comments falsified by the very next commit.

**Iteration 9** -- 2 BLOCKERs, 5 WARNINGs, 3 NITs. The reachability guard from iteration 8 asked the wrong question and shipped with its own counter-example. "sent as 1" on a message that was never typed.

**Iteration 10** -- 2 BLOCKERs, 6 WARNINGs, 3 NITs. A menu of ten returning nine buttons, found by RUNNING the parser. A third derivation of "did it reach the pane" that disagreed with the other two.

**Iteration 11** -- 1 BLOCKER. `talkKey` returns null whenever options is null, and the hold guard read a null key as "no question to compare", the arm written for a question that is ABSENT. Answer a menu, and within the thirty-second hold the agent asks anything the parser will not vouch for, and the whole question block hid, question text included, while the board card said Needs you. Verbatim the harm this file names two hundred lines up, arriving through the other door. **Unkeyable is not absent.**

**Iteration 12** -- 2 BLOCKERs, both in iteration 11's fix, and the first traded the harm it removed for the harm it was removing. The unkeyable release un-hid the panel (right) and also DELETED the hold (wrong), re-opening the defect the hold exists for. My commit message had defended the deletion with "no double-answer risk, a payload with no options renders no buttons to press twice" -- true of the tick where options is null, and the deletion is about every tick after it. The check could not have caught it either: the previous round's reachability fix had made the assertion vacuous. ✅ **Its proof arrived by accident and is better for it** -- the new assertion fired against the unfixed code because an unrelated edit failed silently, so it was not shaped by knowing what I wanted it to say.

**Iteration 13** -- no BLOCKERs. The finding worth the work: the 409 guard that exists to stop "answering a question they never saw" could not tell two questions apart. It compared the LABEL for the pressed digit and nothing about the question it belonged to, and Claude's edit-permission menu draws identical labels for every file. Measured through the producers: a redraw from `src/a.js` to `src/b.js` passed every check. The page had held the discriminating half since the hold was written and simply never sent it, while the route never asked.

**Iteration 14** -- 2 BLOCKERs, both in iteration 13's mechanism, and one of them is the guard turning itself off. `first > 0` says there are lines above the run; it does not say they contain anything. An ordinary pane after `/clear` returned an empty identity, which is falsy, and the route skips its check on a falsy value with **no error and no log** -- so the guard disabled itself on exactly the screens carrying the least identifying text. Also: nothing anywhere asserted the page puts `asked` on the wire at all. Delete the field and the node suite stays green (999 pass, measured) while the guard is dead.

**Iteration 15** -- 2 BLOCKERs, and both were my round-14 fixes, both failing in the direction that matters most. Equality was replaced with containment to stop a false refusal; a pane ACCUMULATES, so a genuinely new question is drawn above the answered one and legitimately CONTAINS it. Simulated end to end: buttons drawn for "Do you want to proceed?", the pane redrew to `rm -rf /Users/josh/build` above the same Yes/No menu, both gates passed, and the digit went through. The empty-identity fallback returned the whole slice, which IS the options, so two different questions gave byte-identical identities.

**Iteration 16** -- 1 BLOCKER: the identity rule failed open again, on the shape its own docblock cites as the reason it exists. Last-three-meaningful-lines drops the discriminating text whenever it sits higher than three lines above the menu, and the edit-permission prompt puts the PATH above a diff hunk. The path line WAS in the slice; `slice(-3)` threw it away.

#### 🛑 One rule, four shapes, three of them mine

| shape | what it did | direction |
|---|---|---|
| equality on the whole window | refuses when the cursor moves | **fails closed** |
| containment | accepted an accumulated question | fails open |
| last three meaningful lines | dropped a high discriminator | fails open |
| equality on the whole window | back to the first, deliberately | **fails closed** |

**A false refusal costs one more press. A false accept types a digit into somebody's terminal answering a question they never read.** Those are not comparable, and an earlier comment of mine calling a false refusal "worse than the hole it closes" had the emphasis backwards: it is worse than a guard that is RIGHT, not worse than a guard that is wrong the other way.

✅ **And the cost of the closed shape is narrower than the round that found it implied**, measured rather than argued: `questionIn` slices from `max(0, at - 6)`, so a prompt with six or fewer lines above its menu clamps to the same window at either cursor position and the identity does not move at all. That is the ordinary permission prompt. A false refusal needs a capture deeper than the run-up window. Both cases are tests.

**Where iteration 16 leaves the branch:** the guard is in its fails-closed shape, which is the safe one, and the loop has not been run against that shape. Iteration 17 has not started.

### Why this says `converged: false`

The pre-registered rule: converged means a blind pass with zero new BLOCKERs, WARNINGs or CONVENTIONs. It was written down **before** iteration 10 reported, so the result could not shape it. Iteration 10 did not meet it.

🔑 **The reason it may never meet it is worth more than the number.** Seven consecutive rounds found a comment describing behaviour the code does not have, and **every one was inside the previous round's own fix**. That is not a loop failing to converge; it is a loop generating its own findings, because each fix writes a narrative comment, the comment is wrong or goes wrong, the next round finds it. Round twelve would find round eleven's comment. The class needs a mechanism, not another iteration, and it has been taken out of the loop and made a card.

### One correction to a severity claim made during this loop

The menu-of-ten defect was described to the orchestrator as a live safety exposure: "pressing one of those nine buttons types a digit into a live agent's terminal." **That is true of code that has never run for anybody.** `origin/main` contains no `optionsIn` and no nine-option guard; the whole mechanism is the +295 lines this branch adds. It is a defect written on this branch and caught on this branch, which is the loop working. It was overstated while arguing for a decision, and the orchestrator corrected it before ruling.

### Deferred, with reasoning

| # | What | Why |
|---|---|---|
| 10 | "a clock-only repaint drops the reader to the oldest message" | **Measured false.** On a box that genuinely overflows with the markup genuinely rewritten, `scrollTop` does not move. The uncovered case it revealed is now a block with two controls. |
| 15 | the GET's two roster reads on a 5s poll | Collapsing them re-plumbs a fail-closed gate shared by three routes. Its own branch, its own tests, its own blind pass. Dated in the plan. |

### Open and recorded, not fixed

| # | What | Where it lives |
|---|---|---|
| 68 | the verdict pill spans the box when a long verdict wraps | kosmos#116, Mona Lisa's call |
| 45 | the question is cut at the right edge in most states | plan § "Open, and NOT settled by this branch"; kosmos#113; gates PR two |

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html paintTalk standing arm | painted the route's own "no agent by that name" into the open panel of an agent whose card carries that name | FIXED | 4bff17e |
| 2 | 1 | WARNING | docs/browser-checks/render-thread.js | the branch broke a SIBLING check: the borrowed-name panel fires a by-design 404 with no exemption and, worse, no assertion on what it draws | FIXED | 4bff17e |
| 3 | 1 | WARNING | web/index.html send handlers | raw `say.value` sent while `clearSent` compared `say.value.trim()`: a pasted line was delivered, recorded, and left armed in the box | FIXED | 4bff17e |
| 4 | 1 | WARNING | web/index.html paintTalk failure arm | no focus rescue; a failed poll stranded a keyboard user, every five seconds | FIXED | 4bff17e |
| 5 | 1 | WARNING | server.js GET route | the read/write asymmetry the route documents was held by no test | FIXED | 42bc5eb |
| 6 | 1 | CONVENTION | docs/browser-checks/render-talk.js launch | headless, while the directory's stated rule is headed and its whole output is paint evidence | FIXED | 4bff17e |
| 7 | 1 | NIT | web/index.html talkKey | an ASCII `\|` counted as frame where `optionsIn` refuses it | FIXED | 42bc5eb |
| 8 | 1 | NIT | server.test.js --k-sunk | compared declaration text, indentation included | FIXED | 42bc5eb |
| 9 | 1 | NIT | .claude/plans/answer-panel.md | the screenshot-naming drift from the plan was silent | FIXED | 42bc5eb |
| 10 | 2 | BLOCKER | web/index.html setThread | claimed a clock-only repaint drops the reader to the oldest message | DEFERRED | measured false; the uncovered case is now instrumented (bd41dc5) |
| 11 | 2 | BLOCKER | docs/browser-checks/render-talk.js fixtures | every fixture dated January 2026, so repaints are byte-identical and the product's first hour with a thread was uncovered | FIXED | bd41dc5 |
| 12 | 2 | WARNING | docs/browser-checks/render-talk.js:440 | `LAST = [window.__card]` unguarded: on a machine running no agent of ours the run DIED instead of reporting | FIXED | bd41dc5 |
| 13 | 2 | WARNING | web/index.html talkKey | the digit-class divergence from `optionsIn` remained after the pipe was fixed | FIXED | bd41dc5 |
| 14 | 2 | WARNING | web/index.html standing-404 premise | `borrowedName` fails closed, so a tmux blip read as a permanent refusal with no cause on screen | FIXED | bd41dc5 |
| 15 | 2 | WARNING | server.js GET route | two roster reads per GET, on a 5s poll while a panel is open | DEFERRED | re-plumbs a fail-closed gate shared by three routes; reasoning dated in the plan |
| 16 | 2 | WARNING | server.test.js --k-sunk | named "in both themes" and asserted nothing about themes | FIXED | bd41dc5 |
| 17 | 2 | NIT | web/index.html:52 | two contrast decimals presented as pinned when nothing pins them | FIXED | bd41dc5 |
| 18 | 2 | NIT | docs/browser-checks/README.md | a suite size quoted as fact, one moving number written in four places | FIXED | bd41dc5 |
| 19 | 3 | WARNING | web/index.html refusal arm | `#d-persist` left standing: "This stays here after a restart" under "we cannot show a conversation for this name" | FIXED | 33d4e34 |
| 20 | 3 | WARNING | web/index.html talkKey comment | claimed "character for character" with two more divergences live | FIXED | 33d4e34 |
| 21 | 3 | WARNING | .claude/plans/answer-panel.md | the ordering-constraint section's counts had gone stale while the sentence around them still read true | FIXED | 33d4e34 |
| 22 | 3 | NIT | server.js:1751, 1856 | comments naming `borrowedName` where the route now calls `nameRefusal` | FIXED | 33d4e34 |
| 23 | 3 | NIT | web/index.html inThread docblock | stated its rule unconditionally while the `placed` arm deliberately ignores it | FIXED | 33d4e34 |
| 24 | 3 | NIT | web/index.html setThread comment | recorded a blind spot `openDetail`'s clear makes unreachable, while the reachable one went unnamed | FIXED | 33d4e34 |
| 25 | 3 | NIT | docs/browser-checks/render-talk.js hold block | a bare click that would time out and kill the run instead of reporting | FIXED | 33d4e34 |
| 26 | 4 | WARNING | web/index.html:6239 | iteration 3's own fix: `persist.hidden = false` ran BEFORE the fetch, so a standing refusal re-showed the promise for every poll's round trip | FIXED | 06596a0 |
| 27 | 4 | WARNING | docs/browser-checks/render-talk.js preHold/preFail | counted buttons that may sit under a HIDDEN row, while `page.click` needs an actionable one: the guard would report healthy and the run would still die | FIXED | 06596a0 |
| 28 | 4 | WARNING | engine/chat.js appendLocked | `wire` stored raw while `text` goes through `cleanMessage`; the guarantee lived in the single caller, not the engine that claims it | FIXED | 06596a0 |
| 29 | 4 | NIT | docs/browser-checks/render-talk.js:657 | the guard's comment named a four-second timeout the code does not have | FIXED | 06596a0 |
| 30 | 4 | NIT | docs/browser-checks/render-talk.js else block | a 38-line guarded body at the `if`'s own indentation | FIXED | 06596a0 (closing marker; scope was already correct) |
| 31 | 4 | NIT | docs/screenshots/talk-11 vs talk-2 | byte-identical files under two state names, with nothing recording that they MUST be | FIXED | 06596a0 (asserted on measurements, not bytes) |
| 32 | 5 | WARNING | web/index.html:6455 | the persistence promise stood over `historyUnfilable`, whose thread arm says "Nothing said here is kept for April." -- visible in the committed screenshot, in both themes | FIXED | 194675d |
| 33 | 5 | WARNING | web/index.html:1246 | `.qask p` (0,1,1) silently outranked `.qout` (0,1,0): every declaration but `color` was dead, measured 15px/4px against an intended 13px/10px | FIXED | 194675d |
| 34 | 5 | WARNING | docs/browser-checks/render-talk.js:552, 698 | both click guards counted buttons that may be DISABLED, and `page.click` waits for actionability | FIXED | 194675d |
| 35 | 5 | WARNING | docs/browser-checks/render-talk.js:180 | the app's own 5s tick ran for the whole check, racing every hand-driven paint and owning the mid-flight window the newest block depends on | FIXED | 194675d |
| 36 | 5 | NIT | docs/browser-checks/render-talk.js:136 | the long-labels fixture borrowed another state's question, so its screenshot shows buttons contradicting the question above them | FIXED | 194675d |
| 37 | 5 | NIT | web/index.html:6201 | a wrapped verdict pill stranded the separator at the end of the line above | FIXED | 194675d |
| 38 | 5 | CONVENTION | .claude/plans/answer-panel.md:33 | the plan states `optionsIn` as an iff; the shipped parser is stricter in five ways, and the drift section listed three smaller ones | FIXED | 194675d |
| 39 | 6 | WARNING | docs/browser-checks/render-talk.js state 6 | the fixture paired `asking` with the no-Claude sentence, a world the producers cannot make; the screenshot showed both stacked | FIXED | 96e910d |
| 40 | 6 | WARNING | web/index.html .dm-w | the receipt was still stranded: flex-end right-aligns the SPAN, and a wrapped span left-aligns its text | FIXED | 96e910d |
| 41 | 6 | WARNING | web/index.html tick gate | the thread poll gated on the panel, not the TAB; the most expensive poll in the app ran forever in a background tab | FIXED | 96e910d |
| 42 | 6 | WARNING | docs/browser-checks/render-talk.js interval control | matched on delay alone, and the page installs two 5s intervals | FIXED | 96e910d |
| 43 | 6 | WARNING | .claude/plans/answer-panel.md | four more drifts unrecorded, including the 409 screen-check the plan never mentions | FIXED | 96e910d |
| 44 | 6 | NIT | web/index.html talkKey | the identity collapsed to options-only when the run starts at line 0 | FIXED | 96e910d |
| 45 | 6 | NIT | docs/screenshots/talk-5 | the question is cut mid-word with no visible affordance | OPEN, RECORDED | design decision flagged to Mona Lisa; reachability now asserted per state |
| 46 | 7 | WARNING | web/index.html talkKey comment | the fallback's stated second line of defence (the 409 screen-check) does not exist: the 409 fires on a menu that DISAGREES, not on the same menu with text below it | FIXED | 55de6aa |
| 47 | 7 | WARNING | docs/browser-checks/render-talk.js:778 | the focus-rescue fixture carried the same impossible pairing corrected in state 6 one round earlier: the fix went to the state with a SCREENSHOT, not to the class | FIXED | 55de6aa |
| 48 | 7 | WARNING | docs/browser-checks/render-talk.js qtext | the question-reachability assertion had no positive control and would go silent the moment the text stopped overflowing | FIXED | 55de6aa |
| 49 | 7 | WARNING | .claude/plans/answer-panel.md:205 | the citation the whole open-question section rests on named a screenshot not in the repo | FIXED | 55de6aa |
| 50 | 7 | CONVENTION | .claude/plans/answer-panel.md | `presence: 'off'` is wider than the plan defines it (stopped agent, copy-mode pane, borrowed name) and was unrecorded | FIXED | 55de6aa |
| 51 | 7 | NIT | web/index.html:4982 | the tab gate went on one poll and not its neighbour three lines down | FIXED | 55de6aa |
| 52 | 7 | NIT | docs/browser-checks/render-talk.js:132 | `7-unsure` draws a state the route says its producers almost cannot serve | FIXED (recorded on the fixture; nothing on it contradicts) | 55de6aa |
| 53 | 7 | NIT | web/index.html:2570 | state 4's reassurance wears the failure pill | FIXED | 6ab68af, ruled by Mona Lisa |
| 54 | - | WARNING | docs/browser-checks/render-talk.js scrollbar gate | orchestrator-found: the headed-only gate rested on a false cause. Playwright passes `--hide-scrollbars` in headless; neither the mode nor the binary decided it | FIXED | 6ab68af |
| 55 | - | WARNING | web/index.html #d-qask-fail | orchestrator-found: the class swap was pinned by nothing in 994 tests | FIXED | 6ab68af |
| 56 | 8 | BLOCKER | docs/browser-checks/render-talk.js QUESTION, 5-no-parse | the question fixtures carried no NEEDS_YOU marker, so `questionIn` returns null and the route can never serve them: ten of twenty-two screenshots drawn from an unproducible payload | FIXED | d9be567 (and the CLASS closed with a producer-checked assertion) |
| 57 | 8 | WARNING | docs/browser-checks/render-talk.js:601 | the scrollbar gate's comment still asserted the behaviour the very next commit disproved | FIXED | d9be567 |
| 58 | 8 | WARNING | .claude/plans/answer-panel.md | the plan repeated the same falsified headed-only claim | FIXED | d9be567 |
| 59 | 8 | WARNING | docs/browser-checks/render-talk.js:285 | "tick has no document.hidden guard" stopped being true when I added one two commits earlier | FIXED | d9be567 |
| 60 | 8 | WARNING | .claude/plans/answer-panel.md:4 | the branch's FIRST LINE cited a freeze sha that names no file | FIXED | d9be567 |
| 61 | 8 | WARNING | web/index.html:1287 | the scrollbar rule sized only the horizontal bar, while the box scrolls both ways and a 60-line capture is the ordinary case | FIXED | d9be567 |
| 62 | 8 | WARNING | docs/browser-checks/render-talk.js qtext | gated on `.hidden` where siblings use `vis()`, so the only state reaching the negative arm was a 0x0 element inside display:none | FIXED | d9be567 |
| 63 | 8 | NIT | server.test.js:6699 | "all eight states" where there are now thirteen | OPEN |
| 64 | 8 | NIT | docs/screenshots/talk-6-off | "cannot be handed a message right now: Its window is scrolled back right now" | OPEN, flagged to Mona Lisa (product copy, her lane) |
| 65 | 9 | BLOCKER | docs/browser-checks/render-talk.js | the reachability check asked whether a marker EXISTS; the producer's constraint is where the LAST one is, and the fixture that failed it shipped in the same commit | FIXED | a3399be (now compares questionIn/optionsIn round-trips) |
| 66 | 9 | BLOCKER | web/index.html dmRow | "sent as 1" on a `could_not` row, beside "Could not deliver": the record's own docs say NOTHING reached the pane | FIXED | a3399be |
| 67 | 9 | WARNING | three files | "10 of the 12 question-bearing states" invalidated by the commit that added two more | FIXED | a3399be |
| 68 | 9 | WARNING | web/index.html .dm-w comment | claimed a defect fixed that was half-fixed: the pill still spans the box | RECORDED | comment corrected; filed as kosmos#116 for Mona Lisa |
| 69 | 9 | WARNING | web/index.html pjSetScreen | no scroll-hold on the question box across a repaint | MEASURED, NO FIX NEEDED | Chromium preserves the offset; the save/restore I wrote changed nothing and was removed. The assertion stays (a3399be) |
| 70 | 9 | NIT | web/index.html:1208 | the CSS header still cited FROZEN-2026-08-18e after the plan moved to 08-19 | FIXED | a3399be |
| 71 | 9 | NIT | web/index.html sendTalk | "any send while a QUESTION was up" where the code keys on a MENU | FIXED | a3399be |
| 72 | 9 | NIT | docs/browser-checks/render-talk.js hold block | an inline fixture paired a question with options the route could not derive, below where the new check looks | FIXED | a3399be |

### Strengths, across all iterations

- `optionsIn` refuses far more than it accepts, and every refusal closes a **measured** false positive rather than a hypothetical one. The sharp case: `Would you like to review the plan? / 1. Delete the old build folder` is itself a needs-you marker, so the page would have drawn a button that types `1` into a live pane and recorded a choice nobody made.
- Every refusal test carries a positive control, including the two that would otherwise pass vacuously.
- The new write route inherits the CSRF guard by construction (`crossSiteWrite` runs before route dispatch) rather than by the author remembering.
- The 409 screen-verification of `chose` re-captures the pane, drops the words unless the board says the agent is asking, and compares the label **as it will be stored**, refusing rather than stripping.
- `threadFile`'s two-dot `direct..<key>.json` makes a collision with a real project named "Direct" impossible rather than unlikely, and the test writes and reads back **both** files rather than comparing two ENOENTs.
- The check gets **louder** when the thing it watches breaks: five coverage controls report UNCHECKED rather than passing silently, and all five were proven able to fire.
- Every plan citation is a re-runnable command rather than a number, after three counts in it went stale in one morning.
