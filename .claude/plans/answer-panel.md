# answer-panel -- the agent page gains its composer and the answer panel

Spec: `~/work/Josh-Brain/Projects/kosmos-design/kosmos-answer-panel-agentpage-2026-08-19.html`
(Mona Lisa, five states, both themes) over pack freeze **FROZEN-2026-08-19**,
sha256 `27a18327525f13524d4fd6b1b27c34edb62d7fbefd86a4a2cc31d2e2561c5b84`, which
is what `CURRENT-FREEZE` names.

⚠️ **This line used to cite FROZEN-2026-08-18e at sha
`c69afdb2513c1ee5…`, and that sha names NOTHING.** Measured: 18e hashes to
`afc620443a7eb390…`, and `c69afdb…` appears nowhere under `~/work/Josh-Brain/`.
So the branch's one unverifiable citation was its first line, while every other
design citation in this file checks out exactly. Corrected to the freeze the
later rulings on this branch were actually taken against.

This is PR ONE of two. PR two (separate branch, after this merges) deletes the
project room's second box, picker, and in-room question panel, and repoints the
board's needs-you click at the agent page. This PR is purely additive so the
room keeps working until its replacement is live.

## Why

The pack puts the private exchange AND the question on the agent's own page,
above a composer that page already has. The build's agent page has no composer
(endpoints: window, conversation, instructions, avatar, removal, profile; no
send), and today the only place a numbered question is shown and answerable is
the room's second box. This PR builds the missing composer, the stored direct
thread, and the answer panel; only then can the room box die.

## Engine (engine/chat.js)

1. **Direct thread scope.** Reuse readThread/appendMessage whole via a special
   scope token `DIRECT = '@you'` recognized inside `threadFile`, mapping to
   filename `direct..<key>.json` (two dots). PROJECT_ID forbids `.` in ids, so
   no project thread can ever produce or collide with this filename, including
   a historical project literally named "Direct" (id `direct`, file
   `direct.<key>.json`, one dot). The token itself fails PROJECT_ID so it can
   never arrive via a project route (those 404 at projects.get first). No
   bornAt for direct threads (they outlive any project). Export DIRECT.
   Verify appendLocked/supersede use projectId only through threadFile; adjust
   with the same special-arm treatment if any other use exists.

2. **Option parser `optionsIn(questionText)`.** New. Lines matching
   `^\s*(?:❯\s*)?(\d+)[.)]\s+(\S.*)$` (strip trailing `[\s│]+`). Confident
   iff: numbers are contiguous ascending from 1, count in [2..9], every label
   non-empty. Returns `[{n, label}]` or null. Null is state 5 (today's screen,
   unchanged) -- never guess. Labels verbatim (pack: buttons carry the
   option's own words).

## Server (server.js)

`/api/agent/:name/thread`, mirroring the project thread route's shape:

- **GET**: one safeRoster read; resolve the agent card (exact sessionName +
  isNamedOurs, LOOSE TO NOTICE / EXACT TO PERMIT like siblings); 404 unknown.
  messages from chat.readThread(DIRECT, name) with the same three history
  channels (historyBecause / historyUnfilable; no historyOther -- no bornAt).
  TAIL 200 + olderCount. Capture always runs: view = chat.viewport;
  asking = tied && state === NEEDS_YOU; question = questionIn;
  questionBecause = same two sentences as the room route; NEW
  `options` = asking && question ? chat.optionsIn(question.text) : null.
  Engineering-mode gates the served viewport only. presence for the composer:
  'on' (card tied), 'off' (no session by that name), 'unsure' (roster null).
- **POST**: messageProblem gate first; body {text, chose?, asked?} (the third
  field arrived two weeks after this line was written; see the drift list). `chose` (option
  label, <= MAX_TEXT) rides only on button sends. Deliver first
  (chat.deliver(name, text, roster)), then record even a failure:
  appendMessage(DIRECT, name, {text: chose || text, wire: chose ? text : null,
  at, delivery}). The bubble records what the person chose; `wire` records
  what was typed so the record never lies about the mechanism. Response
  {delivery, recorded, recordedBecause, agentsUnreadable} like the sibling.

## Page (web/index.html)

CSS: port from freeze .qask, .dmthread, .dm, .dm-b, .dm-w, .dmbar, .dmnone,
.dmoff (both themes; .haz and .delivery already exist in the build). Add the
drawing's three new classes .qopts, .qopt, .qout verbatim (qopt deliberately
NOT btn-gold: a question with equal answers has no primary).

Markup: new `dbox` section on the agent detail page after Conversation:
"Talk to <name>" + "Just between you and <name>. Nothing here belongs to a
project." + question region + thread + off-notices + composer + the
persistence hint ("This stays here after a restart...").

Paint (new, from the GET; poll like siblings):
- State 5 default: qask with haz + "<name> is waiting on an answer." + question
  text (pre-style honesty: render the captured text in the existing question
  treatment; asking && !question renders questionBecause clause).
- State 1: options non-null -> .qopts buttons + .qout "Or write your own
  answer below." Buttons send POST {text: String(n), chose: label}.
- State 2: on delivery.state placed -> the WHOLE qask block goes (an answered
  question is an ordinary sent message in the thread); verdict rides the
  receipt with paneNote (mid-task / paused sentences from the engine).
- State 3: unconfirmed -> buttons also go (a second press could answer a
  numbered prompt twice); doubt rides the receipt dashed.
- State 4: could_not -> qask stays, buttons stay LIVE, failure sentence on
  .delivery.failed ("The buttons still work" copy from drawing). Nothing was
  answered so nothing may look answered.
- Composer: presence off -> disabled + dmoff sentence; unsure -> enabled +
  "You can still send this, and we will tell you if it did not land."
- Free-text sends from the dmbar always work regardless of question state.

## Tests

- chat.test.js: optionsIn (confident menu incl. ❯ and 2-9 bounds; refusals:
  single option, gap in numbering, starts at 2, >9, empty label, prose with a
  stray "1. "); DIRECT threadFile filename has two dots + never collides with
  a project id 'direct' file (write both, read both, distinct); PROJECT_ID
  still refuses '@you'.
- server.test.js: GET/POST route tests mirroring the project-thread suite:
  unknown agent 404, roster-null presence unsure + agentsUnreadable, message
  problem 400, deliver-then-record with failed delivery still recorded,
  chose/wire recording, TAIL bound, engineering-mode viewport gate, options
  only when asking, questionBecause split (two sentences), historyUnfilable
  for uncapitalizable names.
- Fixture discipline: producer-driven fixtures, no `sessionName:` literals.
- Screenshots: sha-named, all five states + both themes where feasible,
  attached to PR and Discord.

## Out of scope (PR two)

Room second-box removal (#pj-thread), the in-room question panel, board
needs-you click repointing, and the room's "answer somewhere else" sentence
deletion.

---

## State as of 2026-08-20 06:12 CDT, re-derived rather than inherited

The 2026-08-19 23:20 block that used to sit here said the branch was "merged
with main at 0.2.3" and "every instrument green". Both were true when written
and neither survived the night: main released seven more times, so this branch
was thirteen commits behind and its `package.json` would have REVERTED the app
to 0.2.3 on merge, and one instrument was never run against it at all. That is
the lesson worth keeping from this file: **a relational claim is a timestamp,
not a property.** "Current with main", "in sync", "green" all decay the moment
either side moves, and they read as durable attributes of the thing they
describe.

**Merged with main at 0.2.8.** One conflict, in `server.test.js`, and not a real
disagreement: HEAD held a collapsed closing line for the documents-404 test,
main held the same assertion plus the whole path-citation suite. Taking main's
side dropped nothing.

**What the challenge loop found, and how.** The blind reviewer found the two
page defects that survive in the diff as fixes: the composer sent `say.value`
raw while `clearSent` compared it trimmed (a pasted line was delivered,
recorded, and left armed in the box under "Placed into its session"), and
`paintTalk`'s failure arm hid the question region and disabled the composer
with none of the four focus rescues its success path carries.

**And re-running a SIBLING check found the one nothing on this branch could
see.** `render-thread.js` fails on this branch and passes on main: opening a
borrowed-name card now fires `GET /api/agent/rook/thread`, the route 404s by
design, and the arm that draws that refusal was painting the SERVER's sentence,
"No agent by that name", into the panel of an agent whose card the person is
looking at. The window box twenty lines above it refuses the identical 404 for
the identical reason, in a comment. Nothing on this branch could have caught it:
`render-talk.js` runs against fixtures over `file://` and never issues that
request, and the suite reads text.

## Drift from the plan above, recorded rather than silent

- **Screenshots are state-named, not sha-named** (`talk-<state>-<theme>.png`).
  The plan asked for sha-named files; the directory's own rule is stronger and
  won: a screenshot is evidence only if the next person can regenerate it, so
  the check now emits exactly the committed filenames. The first committed set
  was a hand-renamed subset of shorter names, which is the drift this replaces.
- **The GET gate is `nameRefusal`, not the 404-unknown the plan asked for.**
  (It was `borrowedName` when this bullet was written; the route calls
  `nameRefusal` directly now, precisely because the boolean loses the reason the
  page needs, and this bullet did not move with it.)
  Recorded in the route: gating on `knownAgent` would hide a STOPPED agent's own
  conversation, which is the thing the file exists for.
- **`render-talk.js` is headed by default now**, like `render-thread` and
  `render-projects`. Its whole output is the class of evidence SwiftShader
  weakens: contrast, computed backgrounds, geometry, hit tests.
- **The plan says "Capture always runs"; the code does not.** `const view =
  asking ? chat.viewport(name, roster) : null`. This route rides the 5s tick on
  the most-visited screen, `safeRoster()` is already one `list-panes` plus a
  capture PER AGENT, and an unconditional second capture here added another one
  every tick, for an idle agent, to feed a `questionIn` that has nothing to
  find. Argued at length at the code; the plan sentence was never corrected.
- **The POST response drops `agentsUnreadable`**, which the plan lists in its
  response shape. Nothing on this screen reads it, and the GET on the same
  route deleted the identical field for the identical reason. One rule, both
  halves.
- **The 409 screen-verification of `chose` is not in the plan at all**, and it
  is the largest thing on the branch the plan does not mention: the server
  re-captures the pane, drops the words entirely unless the board says the
  agent is asking, compares the label AS IT WILL BE STORED
  (`cleanMessage(row.label) !== chose`), and refuses the whole send with a 409
  rather than stripping the words, because a label that no longer matches is
  evidence the digit is stale too.
- **`presence: 'off'` is wider than the plan defines it.** The plan says `'off'`
  means "no session by that name". The route derives presence from
  `chat.addressable`, so `'off'` also covers a STOPPED agent, a pane in
  copy-mode, and a name something else is holding -- and that wider fact is the
  one the composer's sentence is built on, which is why the route takes the send
  gate's own answer rather than deriving a second one. Documented at the code
  and, until now, nowhere else.
- **The route tests live in `server.projects.test.js`, not `server.test.js`**
  as the plan says, next to the project-thread suite whose shape they mirror.
- **The POST carries a THIRD field, `asked`, which the shape above does not
  list**, and a second 409 beside the first. The page sends the identity of the
  question it was answering (`talkKey`'s `above` half); the route compares it
  against `chat.questionAbove` of a fresh capture and refuses when the screen
  has moved on. The first 409 checks WHICH WORDS; this one checks WHICH
  QUESTION, and without it the same labels on a different file passed
  verification -- which is the shape Claude's edit-permission prompt has for
  every file.
- **`engine/chat.js` exports `questionAbove`**, which the Engine section above
  does not mention. It is the engine twin of the page's identity rule, so both
  sides of that comparison read the same fact rather than two spellings of it.
  ⚠️ **And they diverge in exactly one place, deliberately.** When the rule
  yields nothing -- a menu with only blanks or frame above it -- the engine
  returns `null` and the page falls back to the whole slice. The costs are not
  symmetric: the page's key decides whether to keep HIDING buttons, so a
  collision suppresses a live question for thirty seconds; the engine's decides
  whether to TYPE A DIGIT, so a collision answers a question nobody read. The
  agreement test asserts both halves rather than pretending they match.
- **`optionsIn` is materially stricter than the "iff" written above**, and this
  is the largest drift on the branch rather than the smallest. The spec says
  confident iff the numbers are contiguous ascending from 1, the count is in
  [2..9], and every label is non-empty. The shipped parser also requires the
  option lines to be CONSECUTIVE in the capture, requires one of them to carry
  the selection marker, refuses when a newer needs-you marker appears below the
  run, refuses any label that fails `messageProblem`, and dropped the
  empty-label check as unreachable. Every one of those is a refusal the spec
  would have ACCEPTED, each closes a measured false positive rather than a
  hypothetical one, and each is documented at the code and pinned by a test
  with its own positive control. The spec above is left as written rather than
  edited, because what it records is what was believed on 2026-08-19 before the
  captures were read.

## Open, and NOT settled by this branch: the question that does not fit

`.pj-screen` is `white-space: pre`, which is the room's treatment and is
deliberate -- a captured line is what the agent's screen showed, and wrapping it
makes it something else. The consequence, measured on 2026-08-20: **most of the
question-bearing states in `render-talk.js` render a question wider than its
box**, cut at the right edge, and macOS hides the overlay scrollbar until
somebody scrolls. (This paragraph said "10 of the 12" in three places until the
commit that added two more states made all three wrong at once, which is the
lesson at the top of this file arriving on the file itself for the second time.) `talk-5-no-parse-{light,dark}.png` is the pair that matters most,
because state 5 exists precisely so a person can read the question and type the
answer, and its committed screenshot cuts its longest line mid-word. (This
sentence quoted the cut characters until the fixture was rewritten to carry a
needs-you marker, at which point the quote named a line that is no longer the
one being cut -- the same "cite the shape, not the characters" lesson this
branch learned one file over, applied here a round later.)

**RULED by Mona Lisa, 2026-08-20 07:42, then NARROWED by her at 07:44 after
reading the pack.** The first ruling was that both `#d-talk-box` and
`#d-window-box` should span the grid (`grid-column: 1 / -1`), because the box is
half-width only from the detail page happening to be a two-column `.dgrid`,
while the content is 220 columns because `connect.js` creates the session at
`-x 220`. Measured headless at 6.021px/char: a half-column box shows 100
characters, a spanning one shows 211.

The narrowing is the useful half, and it came from a question about the
CONSEQUENCE rather than about the measurement. Spanning `#d-talk-box` widens the
whole panel, not the question inside it: the bubbles, the option buttons and the
composer go with it. The pack answers this directly, and I verified it myself in
`kosmos-app-style.FROZEN-2026-08-19.html`:

    .dspan { grid-column: 1 / -1; }     declared, line 1424
    used as a class attribute           ZERO times

A rule with a name and no instances is not silence; the pack considered spanning
and did not want it for these boxes. And a conversation needs a bounded line
length: right-aligned bubbles stop reading as replies when a two-word answer
sits alone at the far end of a 211-column row.

**Corrected ruling, split by box:**

- `#d-window-box` SPANS, via `.dspan` ported from the pack. It holds a heading,
  a hint, the `pre` and a message, so widening it widens exactly what the
  measurement was about and nothing else.
- `#d-talk-box` STAYS in the column. The question pane keeps `pre` and keeps its
  scroll, and gets a VISIBLE EDGE at the cut.

Her own statement of what she got wrong is worth keeping: she measured one
element and prescribed a mechanism that moves its container, and those are the
same thing only when the container holds nothing else.

**The visible edge SHIPPED HERE, and it is not the fade it started as.** I told
her the fade needed logic -- an edge always drawn lies in the two states where
nothing is cut, and lies again once the box is scrolled to its end -- and she
came back with something that needs none: style the scrollbar. Three rules on
`#d-qask-text` opt this one box out of macOS overlay behaviour and back to a
persistent bar. The BROWSER owns the condition, so neither lie is reachable, no
per-paint measurement exists to test, and the thumb's length says how much more
there is, which a fade cannot say at all.

⚠️ **What hid it was a launch flag, and TWO wrong causes were published before
that was found.** My first probe ran headless and reported the fix did nothing,
from which I concluded that `::-webkit-scrollbar` is not honoured headless. Mona
Lisa ran the same control against system Chrome, got it honoured in both headless
modes, and concluded the cause was the BINARY. Both were correlates rather than
causes. Measured across four launches:

    bundled chromium  headless                                   not honoured
    bundled chromium  headed                                     honoured
    system chrome     headless, launched by Playwright           not honoured
    bundled           headless, ignoreDefaultArgs --hide-scrollbars   honoured
    system chrome     headless, same                                  honoured

Playwright passes `--hide-scrollbars` by default in headless mode. The check
drops it, so the assertion is live in BOTH modes rather than skipped on any
headless machine, and it is gated on a CAPABILITY PROBE -- ask this engine for a
24px scrollbar and see whether layout moves by 24 -- rather than on an inference
about the environment. An inference about the environment can be wrong; a probe
of it cannot, because it is not making a claim.

**Still to come, and it is what remains of the question-width pass:** `.dspan`
ported from the pack, `#d-window-box` spanning the grid, and the scrollbar
generalised from `#d-qask-text` to `.pj-screen`, which the room uses and which
has the same defect. Scoped narrowly here on purpose: the room's panes are not
this branch's surface.

🛑 **PR TWO therefore waits on TWO things, not one:** the room able to carry an
agent's blocking question, AND the question-width pass. Until PR two lands, the
room still shows the question, so this branch's cut is not the only path to
reading it. The moment the room's box is deleted, it is.

⚠️ The second gate was set BEFORE the scrollbar shipped on this branch, when the
cut had no affordance at all. It now has one. Whether that is enough to relax
the gate is Mona Lisa's ruling and not mine, and it stays a gate until she says
otherwise: an ordering preference gets reordered by whoever is fastest.

What this branch guarantees, and now asserts per state: the rest is REACHABLE.
The box is scrollable and carries `tabindex="0"`, so it can be reached from the
keyboard rather than by trackpad alone. Whether "reachable" is good enough for
the screen whose job is reading a question is a design decision and it is Mona
Lisa's, not mine. Flagged to her rather than resolved here, because the
alternative (`pre-wrap`) changes what the box CLAIMS to be showing.

## 🛑 The ordering constraint, unchanged

This is PR ONE of two, and PR two DELETES the only surface where a person can
see and answer an agent's blocking question. Splinter established that as a
SAFETY constraint rather than a preference: `pj-question`, its label and the
answer instruction are all nested INSIDE `#pj-thread`, so the delete takes them
as one unit. **"Talk to one of them" cannot be deleted until the room can carry
an agent's blocking question.** This branch is deliberately additive so the room
keeps working until its replacement is live.

**The evidence for that is a diff fact, not a count**, because a count is the
thing that goes stale while the sentence around it keeps reading true. An
earlier version of this paragraph said "six lines" and "36 references"; both
had moved three commits later while the conclusion they backed was as sound as
ever, which is the same failure this file opens with.

    git diff origin/main...HEAD -- web/index.html \
      | grep -E '^[+-][^+-]' | grep -c 'pj-question\|pj-thread'
    0

**Zero, and zero is the PASS here** -- stated because a number has no direction,
and a command lifted onto a board that reads zero as work-not-done would invert
this silently.

⚠️ **It is a BRANCH-lifetime guard, not a durable one**, which is the second
thing a bare command does not say. `origin/main...HEAD` goes empty the moment
this branch merges, `grep -c` then prints `0` for the wrong reason, and the
guard passes because there is nothing left to check. The durable twin, which
holds whatever has merged, is on kosmos#111:

    grep -c 'pj-question\|pj-thread' web/index.html      # guard, pass != 0

Today it is 36 on both `main` and this branch. Zero there means the room's
question box is gone from the page: either PR two landed with its prerequisites
met, or the delete happened without them, and the second is what the gate
exists to prevent.

The product lines this branch does delete are all refactor: a `pjMsg` signature
split in two so the room's row and the agent page's bubble share ONE verdict
sentence, a `PROJECT_ID` guard that moved into `threadFile` so the DIRECT token
can pass it, the `borrowedName` docblock and body that `nameRefusal` replaced,
two reflowed export lines, and one stale comment.


## Deferred, with reasoning, so it is a decision rather than an oversight

**The GET makes two roster reads, and `paintTalk` now rides the 5s tick.** The
route's own comment already says this: `nameRefusal` runs `claimantFor` ->
`paneRoster()` (an uncached `tmux list-panes`) and then `safeRoster()` takes a
full snapshot, on top of the snapshot `/api/status` took on the same tick. So
opening an agent's panel roughly doubles the per-tick tmux fan-out for as long
as it stays open (the poll is gated on `#panel-detail` being visible, so it
costs nothing when it is closed).

Collapsing the two reads is the right fix and it is NOT a late edit inside a
review loop: `nameRefusal` is the gate that stops a stranger's pane serving a
person's private thread, it fails CLOSED by construction (`paneRoster` throws;
`safeRoster` returns null), and it is shared by three routes. Re-plumbing it to
take a roster it did not read itself changes the failure semantics of all three
at once. That deserves its own branch, its own fail-closed tests, and its own
blind pass. Recorded here, dated 2026-08-20, so the cost is a known one.

## What iteration 2 changed, and one thing it did NOT

Its two BLOCKERs were about the same seam and only one of them survived
measurement.

**Claimed:** `setThread` rewrites `innerHTML` whenever the markup changes, the
relative time phrase changes once a minute for the first hour, and the
scroll-to-bottom arm is keyed on the message COUNT -- so an untouched thread
snaps the reader from the newest message to the oldest, every minute.

**Measured:** it does not. On a thread that genuinely overflows the 15rem box,
with the markup genuinely rewritten (both proven by controls in the check), the
reader's `scrollTop` is unchanged across a same-height rewrite. The reasoning
was sound and the browser does not behave the way it assumes. What was TRUE in
the finding is that no check covered the case at all: the fixtures in that
block are dated January 2026, so their repaints are byte-identical, and the
product's whole first hour with a thread was untested. (This sentence claimed
EVERY fixture in the file until a reviewer checked: `placed()` and
`3-unconfirmed` both render relative phrases. Only the scroll block's inline
fixtures are January-dated, which is all the argument needed.) That case is now a
block with two controls, and the measured behaviour is written down with its
date, so the day it stops holding is a failure rather than a discovery.

**And the finding against this branch's own fix landed.** The standing-vs-
transient split was built on "a standing 404 is only ever a borrowed name",
which is false: `borrowedName` fails closed, so a tmux hiccup on an ordinary
TIED agent answers 404 too, and the page then drew the written-for-forever
sentence with no cause anywhere on the panel. The route now sends WHY, the page
branches on the reason rather than the status, and both arms are asserted.
