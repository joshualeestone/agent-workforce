'use strict';

/**
 * An agent answering the person, in the box on its own page.
 *
 * 🛑 WHAT DID NOT EXIST. Two calls in `server.js` wrote into a conversation and
 * both were operator-only; deeper than that, the stored record had no field for
 * a sender, so every row was the person's by definition. An agent answered in
 * its own session, which reaches nobody, and Josh watched an empty box for an
 * afternoon (#175).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'answers-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const chat = require('./engine/chat');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

const readBack = (agent) => chat.readThread(chat.DIRECT, agent).messages;

test('a reply is kept with its sender, and the person’s messages are unchanged', () => {
  chat.appendMessage(chat.DIRECT, 'dana', { text: 'hello', at: '2026-08-21T20:00:00.000Z', delivery: { state: 'placed' } });
  chat.appendMessage(chat.DIRECT, 'dana', { text: 'hello back', at: '2026-08-21T20:01:00.000Z', from: 'dana' });

  const rows = readBack('dana');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].from, null, 'the person’s row grew a sender');
  assert.equal(rows[1].from, 'dana', 'the reply does not say who wrote it, which is the whole defect');
  assert.equal(rows[1].text, 'hello back');
});

test('a reply carries NO delivery, because there was no crossing to fail', () => {
  /**
   * 🛑 FOUND BY RUNNING AN APPEND AND READING THE RECORD BACK, not by looking
   * at the page. `state` falls back to COULD_NOT — right for the person's
   * messages, where it means "no evidence it arrived" — and an agent's reply is
   * written straight into the record the screen reads. COULD_NOT there is a
   * claim about a mechanism that never ran.
   *
   * ⚠️ The box looked FINE: `dmRow` skips the verdict for these rows. The
   * CONVERSATION view does not, and would have printed "Not sent." under a
   * reply that had arrived.
   */
  chat.appendMessage(chat.DIRECT, 'rho', { text: 'on it', at: '2026-08-21T20:02:00.000Z', from: 'rho' });
  const [row] = readBack('rho');
  assert.equal(row.delivery, null, 'the reply claims a delivery state for a crossing that never happened');

  // ⚠️ THE CONTROL: the person's own row must still carry one, or this has
  // removed the thing that tells them a message did not land.
  chat.appendMessage(chat.DIRECT, 'rho', { text: 'ok', at: '2026-08-21T20:03:00.000Z', delivery: { state: 'unconfirmed' } });
  assert.equal(readBack('rho')[1].delivery.state, 'unconfirmed');
});

test('a thread written before this field existed still reads', () => {
  /**
   * ⚠️ ABSENT MEANS THE OPERATOR, and it is load-bearing rather than tidy:
   * every thread file already on somebody's disk was written without this
   * field. A required one would have made the change a migration.
   */
  const file = nodePath.join(SANDBOX, 'AgentWorkforce', 'chats', 'direct..old.json');
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    project: '@you', agent: 'old',
    messages: [{ at: '2026-08-01T00:00:00.000Z', text: 'from before', delivery: { state: 'placed' } }],
  }), 'utf8');

  const rows = readBack('old');
  assert.equal(rows.length, 1, 'an old thread stopped being readable');
  assert.equal(rows[0].from, undefined, 'the old row was rewritten rather than read as it is');
  assert.equal(rows[0].text, 'from before');
});

test('a sender that is not a string is refused, because it reaches the renderer', () => {
  const file = nodePath.join(SANDBOX, 'AgentWorkforce', 'chats', 'direct..bad.json');
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    project: '@you', agent: 'bad',
    messages: [{ at: '2026-08-01T00:00:00.000Z', text: 'x', from: 42 }],
  }), 'utf8');
  assert.throws(() => readBack('bad'), (e) => e.code === 'UNPARSEABLE',
    'a non-string sender is passed to the page, where it becomes a TypeError in the renderer');
});

test('the page renders a reply as theirs, without a delivery verdict', () => {
  /**
   * ⚠️ NO VERDICT ON THIS SIDE is not an omission: the person's rows carry one
   * because a message has to cross into a terminal. Printing "Sent" beside a
   * reply would invent a mechanism that did not happen.
   */
  const at = PAGE.indexOf('function dmRow(');
  assert.notEqual(at, -1);
  const src = PAGE.slice(at, at + 1600);
  assert.match(src, /if \(m && m\.from\)/, 'the renderer has no branch for a row the agent wrote');
  const branch = src.slice(src.indexOf('if (m && m.from)'), src.indexOf('const v = pjVerdict'));
  assert.match(branch, /dm theirs/, 'a reply is rendered as the person’s own words');
  assert.doesNotMatch(branch, /pjVerdict|delivery/, 'a reply is given a delivery verdict it cannot have');
});

test('the sender comes from the pane, never from the request body', () => {
  /**
   * 🛑 A NAME IN A REQUEST IS A CLAIM BY THE CALLER, and any local process can
   * make it. `resolveSender` ties the pane to a card on the roster, so an agent
   * can only ever write as itself.
   */
  const server = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const at = server.indexOf("pathname === '/api/reply'");
  assert.notEqual(at, -1, 'the reply route is gone');
  const src = server.slice(at, at + 2200);
  assert.match(src, /resolveSender\(body\.from_pane, roster\)/, 'the route no longer identifies the sender by pane');
  assert.match(src, /from: who/, 'the row is written without a sender');
  assert.doesNotMatch(src, /from: body\./, 'the route takes the sender from the request, which any process can claim');
});

test('agents are told the command exists, and told it names both surfaces', () => {
  const msgs = fs.readFileSync(nodePath.join(__dirname, 'engine', 'messages.js'), 'utf8');
  assert.match(msgs, /reply "your message"/, 'the instruction block does not teach the reply command');
  assert.match(msgs, /from a room or from a person/,
    'the closing rule names only one surface, which is how the room rule was learned and the person rule was not');
});
