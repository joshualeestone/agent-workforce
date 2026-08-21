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

test('the line is written wherever the agent’s name is written, not on a fetch', () => {
  /**
   * ⚠️ The neighbouring comment in the page makes this rule explicit for the
   * other four lines: whether a line names the right agent does not depend on
   * the fetch, so it is set with the label. A line set on the success path is
   * absent exactly when a refusal leaves the box open.
   */
  const at = PAGE.indexOf("document.getElementById('d-talk-hint').textContent");
  assert.notEqual(at, -1, 'the hint the box heads itself with has moved');
  const near = PAGE.slice(at, at + 700);
  assert.match(near, /d-reply-where'\)\.textContent/,
    'the reply-location line is no longer written beside the label');
});

test('it names the agent, says where the answer goes, and does not promise a fix', () => {
  const at = PAGE.indexOf("document.getElementById('d-reply-where').textContent");
  assert.notEqual(at, -1);
  const src = PAGE.slice(at, at + 320);

  assert.match(src, /name \+/, 'the line does not name the agent, so it reads as a general notice');
  assert.match(src, /their own window/, 'the line no longer says where the reply is');
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
  assert.ok(composer < reply, 'the line sits above the composer, where nobody has formed an expectation yet');
  assert.ok(reply < persist, 'the line was moved to the foot, which is where notes go to be unread');
});

test('the box still says the two things it said before', () => {
  /**
   * ⚠️ A CONTROL ON THE EDIT, not decoration. Both sentences are ruled copy and
   * neither is what was wrong: "just between you and <name>" is true, and the
   * thread really does outlive the agent's recollection. The defect was
   * something MISSING, so nothing should have been removed.
   */
  assert.match(PAGE, /Just between you and ' \+ name \+ '\. Nothing here belongs to a project\./);
  assert.match(PAGE, /id="d-persist"/);
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
