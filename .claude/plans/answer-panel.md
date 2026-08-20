# answer-panel -- the agent page gains its composer and the answer panel

Spec: `~/work/Josh-Brain/Projects/kosmos-design/kosmos-answer-panel-agentpage-2026-08-19.html`
(Mona Lisa, five states, both themes) over pack freeze FROZEN-2026-08-18e
(sha c69afdb2513c1ee557176f2242e4c4f1fa9f0ba32f1d10cda6b8a643803c9006).

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
- **POST**: messageProblem gate first; body {text, chose?}. `chose` (option
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
- **The GET gate is `borrowedName`, not the 404-unknown the plan asked for.**
  Recorded in the route: gating on `knownAgent` would hide a STOPPED agent's own
  conversation, which is the thing the file exists for.
- **`render-talk.js` is headed by default now**, like `render-thread` and
  `render-projects`. Its whole output is the class of evidence SwiftShader
  weakens: contrast, computed backgrounds, geometry, hit tests.

## 🛑 The ordering constraint, unchanged

This is PR ONE of two, and PR two DELETES the only surface where a person can
see and answer an agent's blocking question. Splinter established that as a
SAFETY constraint rather than a preference: `pj-question`, its label and the
answer instruction are all nested INSIDE `#pj-thread`, so the delete takes them
as one unit. **"Talk to one of them" cannot be deleted until the room can carry
an agent's blocking question.** This branch is deliberately additive so the room
keeps working until its replacement is live. The diff removes six lines in the
product and not one of them is a room control: one `pjMsg` signature, split in
two so the room's row and the agent page's bubble share ONE verdict sentence;
one `PROJECT_ID` guard that moved into `threadFile` so the DIRECT token can pass
it; one stale comment; and two export lines that were reflowed. `#pj-thread` and
`pj-question` are untouched, and 36 references to them survive in the page.
