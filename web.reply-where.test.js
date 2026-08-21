'use strict';

/**
 * The line that stops the direct box implying a reply it cannot carry.
 *
 * 🛑 WHY IT EXISTS. An agent cannot write into a direct thread: the stored
 * record has no field for a sender, so every entry is the person's message to
 * the agent (#175). Meanwhile the box heads itself "Just between you and
 * <name>", which describes a two-way place. Josh said hello to a new agent,
 * saw the answer in her terminal, saw nothing here, and waited.
 *
 * ⚠️ IT FIXES NOTHING, and the test is written to that: it pins that the screen
 * stops implying the conversation, and that it says where the answer actually
 * is. An admission that leaves somebody with nowhere to go is half a fix.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('the line is written before the fetch, like the other lines that name the agent', () => {
  /**
   * ⚠️ The neighbouring comment in the page makes this rule explicit: whether a
   * line names the right agent does not depend on the fetch, and one set on the
   * success path carries the PREVIOUS agent's name on a borrowed-name pane,
   * because that arm returns early.
   *
   * 🛑 THIS USED TO MEASURE SOURCE PROXIMITY — 700 characters from the label's
   * assignment — and a longer COMMENT broke it while the code was unchanged. A
   * check a documentation edit can fail is measuring the wrong thing. It pins
   * the ORDER against the fetch instead, which is the actual property.
   */
  const label = PAGE.indexOf("document.getElementById('d-talk-hint').textContent");
  const line = PAGE.indexOf("document.getElementById('d-reply-where').textContent");
  assert.notEqual(label, -1, 'the hint the box heads itself with has moved');
  assert.notEqual(line, -1, 'the reply-location line is no longer written anywhere');

  /* The first `await` after the label is where the fetch begins; both lines
     must be written above it. */
  const gate = PAGE.indexOf('await', label);
  assert.notEqual(gate, -1, 'no fetch follows the label, so this test is aimed at nothing');
  assert.ok(line > label && line < gate,
    'the reply-location line is written after the fetch, so a refusal leaves it carrying the previous agent’s name');
});

test('it names the agent, says where the answer goes, and does not promise a fix', () => {
  const at = PAGE.indexOf("document.getElementById('d-reply-where').textContent");
  assert.notEqual(at, -1);
  const src = PAGE.slice(at, at + 320);

  assert.match(src, /name \+/, 'the line does not name the agent, so it reads as a general notice');
  assert.match(src, /their own window/, 'the line no longer says where the reply is');
  /* 🛑 THE NEGATIVE, which nothing pinned. MEASURED: replacing the copy with
     "Replies come back HERE, for now" — the exact inversion this change exists
     to prevent — passed every other assertion in this file. Both
     /their own window/ and /for now/ survive it. The sentence's whole job is
     the word "rather", and nothing was watching it. */
  assert.match(src, /rather\s*'?\s*\+?\s*'?than here/,
    'the line no longer says the reply does NOT come back here, which is its only job');
  assert.match(src, /for now/,
    'the "for now" is gone: without it the sentence reads as a design decision rather than a known limit');
  assert.doesNotMatch(src, /soon|shortly|will be able|coming/,
    'the line promises a fix, which is a claim about a schedule nobody has made');
});

test('the element sits above the persistence note, not below it', () => {
  /**
   * ⚠️ PLACEMENT IS THE POINT (Mona Lisa): by the time somebody reaches the
   * bottom of a box they have already decided what it does. The restart note
   * has been at the foot all along and Josh never mentioned it.
   */
  const reply = PAGE.indexOf('id="d-reply-where"');
  const persist = PAGE.indexOf('id="d-persist"');
  const composer = PAGE.indexOf('id="d-send"');
  assert.notEqual(reply, -1);
  /* ⚠️ MEASURED AND THE COMMENT WAS WRONG ABOUT ITS OWN PLACEMENT. DOM order is
     composer → send-result alert → this line → the restart note. It is BELOW
     the composer, second to last. The claim that it "sits by the composer,
     above the foot" was not true of where it landed.
     🔑 What it IS adjacent to is the send button and the result of sending,
     which is where a person looks after pressing it — so the position is
     defensible and the sentence describing it was not. Pinning what is true. */
  assert.ok(composer < reply, 'the line moved above the composer; the comment describes it as following the send controls');
  assert.ok(reply < persist, 'the line was moved below the restart note, which is where notes go to be unread');
});

test('the box still says the two things it said before', () => {
  /**
   * ⚠️ A CONTROL ON THE EDIT, not decoration. Both sentences are ruled copy and
   * neither is what was wrong: "just between you and <name>" is true, and the
   * thread really does outlive the agent's recollection. The defect was
   * something MISSING, so nothing should have been removed.
   */
  assert.match(PAGE, /Just between you and ' \+ name \+ '\. Nothing here belongs to a project\./);
  /* 🛑 THE SENTENCE, NOT THE ELEMENT. This read /id="d-persist"/, which is the
     markup's id attribute — MEASURED: deleting the whole
     `d-persist.textContent = 'This stays here after a restart. '…` assignment
     left an empty <p> and passed. A control that an empty element satisfies is
     not a control on the words.
     ⚠️ And it must be pinned at the ASSIGNMENT, because the phrase occurs twice
     in the file and the second is inside a comment about it, which survives the
     deletion on its own. */
  const persistAt = PAGE.indexOf("document.getElementById('d-persist').textContent");
  assert.notEqual(persistAt, -1, 'the persistence sentence is no longer written anywhere');
  assert.match(PAGE.slice(persistAt, persistAt + 200), /stays here after a restart/,
    'the persistence sentence was removed or changed');
});

// ─────────────────────────────────────────────────────────────────────────────
// "<name> is working…" (#176)
// ─────────────────────────────────────────────────────────────────────────────

function fn(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page`);
  let d = 0; let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') d++;
    else if (PAGE[i] === '}') { d--; if (d === 0) break; }
  }
  // eslint-disable-next-line no-new-func
  return PAGE.slice(at, i + 1);
}

test('it says WORKING, and never that the agent is replying to you', () => {
  /**
   * 🔑 THE ONE CONSTRAINT ON THIS FEATURE. We can see that Claude is producing
   * output. We cannot see WHAT it is working on, and "<name> is typing" claims
   * it is composing a reply to YOU — the same row of `engine/chat.js`'s claim
   * table as "the agent received it", which that table marks never.
   *
   * ⚠️ It matters MORE here than in a chat app, not less: this box is the one
   * surface where nothing comes back at all (#175), so a person reads the line
   * as evidence rather than as decoration.
   */
  const src = fn('paintBusy');
  assert.match(src, /is working/, 'the line no longer says what it can see');
  assert.doesNotMatch(src, /typing|replying|composing|answering/i,
    'the line claims to know what the agent is working ON, which the reading does not support');
});

test('only a card that positively says working produces the line', () => {
  /**
   * ⚠️ UNKNOWN SHOWS NOTHING — not working, not idle. An agent we cannot read
   * must not be rendered as either, which is the same rule as the stale badge
   * and the memory caption. So the test is on the COMPARISON, not on the
   * absence of an else-branch.
   */
  const src = fn('paintBusy');
  assert.match(src, /fresh\.state === 'working'/,
    'the line is derived from something other than a positive working state');
  assert.match(src, /!!\(fresh && /, 'a missing card no longer resolves to not-busy');
});

test('it is painted on open AND on the poll, off the poll’s existing lookup', () => {
  /**
   * ⚠️ ON OPEN, because painted only by the poll it is absent for up to five
   * seconds after somebody opens the page — the exact moment they are looking.
   * ⚠️ AND OFF THE POLL'S EXISTING `fresh`, because a second `find()` for the
   * same card is the one-fact-two-derivations habit this file keeps paying for.
   */
  assert.equal(PAGE.split('paintBusy(').length - 1, 3,
    'expected exactly one definition and two callers (open, poll)');
  const at = PAGE.indexOf("const fresh = data.agents.find");
  assert.notEqual(at, -1);
  assert.match(PAGE.slice(at, at + 3400), /paintBusy\(fresh,/,
    'the poll no longer paints it, or paints it from its own lookup');
  /* ⚠️ The window is 3400 chars because the block between the lookup and this
     call is largely comment; it is a bound on "same block", not a measurement
     of anything. A tighter number would fail on a comment edit. */
  const open = PAGE.indexOf('function openDetail(');
  assert.match(PAGE.slice(open, open + 900), /paintBusy\(a, a\.name\)/,
    'opening the page no longer paints it');
});

test('the element sits under the thread and above the composer', () => {
  const thread = PAGE.indexOf('id="d-dmthread"');
  const busy = PAGE.indexOf('id="d-busy"');
  const send = PAGE.indexOf('id="d-send"');
  assert.ok(thread > 0 && busy > thread, 'the line is not under the conversation');
  assert.ok(busy < send, 'the line is below the composer, where it is not next to what it describes');
});

test('the line is hidden in the two states where it would be false', () => {
  /**
   * 🛑 THE TWO BLOCKERS THIS PINS, both found by a blind pass and neither
   * caught by anything here before:
   *
   *   a name the box cannot resolve — the panel says "we cannot show a
   *   conversation for this name" while this line said "<name> will see this
   *   in their own window", eight pixels apart
   *
   *   presence 'off' — every reason that arm prints is about the WINDOW ("its
   *   window is scrolled back", "we cannot reach its window") and this line
   *   says the answer arrives in that window
   *
   * ⚠️ AND A HIDE NEEDS AN UN-HIDE. The element is reused across agents, so a
   * branch that hides without a matching reset silences the line for the rest
   * of the session — and absent is indistinguishable from "we decided not to
   * say it".
   *
   * ⚠️ THIS IS A SOURCE ASSERTION AND CANNOT SEE A RENDER, said plainly: it
   * pins that the decision exists and what it keys on. Whether the element is
   * actually invisible in those states is a browser question, and the check in
   * docs/browser-checks/ is where that belongs.
   */
  assert.match(PAGE, /d-reply-where'\)\.hidden = body\.presence === 'off'/,
    'nothing decides whether the line shows, or it no longer keys on the unreachable window');
  assert.match(PAGE, /d-reply-where'\)\.hidden = false/,
    'the hide has no matching reset, so one unresolvable name silences the line for every agent after it');

  const refusal = PAGE.indexOf("document.getElementById('d-persist').hidden = true;");
  assert.notEqual(refusal, -1, 'the refusal arm no longer hides the persistence line, so this is aimed at nothing');
  assert.match(PAGE.slice(refusal, refusal + 700), /d-reply-where'\)\.hidden = true/,
    'the refusal arm hides the persistence promise and leaves this one standing, which is the defect the comment beside it records fixing');
});

test('Settings no longer claims the chat carries what an agent says', () => {
  /**
   * 🛑 THE FALSE CLAIM STATED OUTRIGHT. The Engineering-mode row read "Off by
   * default. Your chat shows what an agent says to you." — while an agent
   * cannot write into a direct thread at all (#175). A person read it, believed
   * the chat would carry the answer, and waited.
   *
   * ⚠️ IT SURVIVED BECAUSE IT IS HALF TRUE: agents do post into a project room,
   * and this screen is global, so it generalised from the case that works.
   *
   * ⚠️ AND THE ASSERTION IS SCOPED TO THE RENDERED ROW, not to the file: the
   * sentence still appears once, inside the comment that records removing it,
   * and a count of zero would force deleting the record of why.
   */
  const row = PAGE.indexOf('id="eng-row"');
  assert.notEqual(row, -1, 'the Engineering-mode row has moved');
  const end = PAGE.indexOf('</div>', PAGE.indexOf('<p class="dhint"', row));
  const rendered = PAGE.slice(row, end).replace(/<!--[\s\S]*?-->/g, ' ');

  assert.doesNotMatch(rendered, /chat shows what an agent says/,
    'the row claims the chat carries what an agent says, which is false of the direct box');
  assert.match(rendered, /Off by default/, 'the row no longer says the toggle is off by default');
  assert.match(rendered, /raw session/, 'the row no longer says what the toggle actually shows');
});
