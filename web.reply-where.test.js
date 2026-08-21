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
