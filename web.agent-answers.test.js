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

test('the instruction block TEACHES the command, asked of the block itself', () => {
  /**
   * 🛑 THE VERSION THIS REPLACES READ `engine/messages.js` AS TEXT. A reviewer
   * commented out the bullet that teaches the command — so no agent is ever
   * told it exists — and the test passed, because the characters survived on
   * the commented line.
   *
   * ⚠️ `blockBody` is exported, pure and takes no arguments. There was never a
   * reason to grep the file that produces it.
   */
  const messages = require('./engine/messages');
  const block = messages.blockBody();

  assert.match(block, /reply "your message"/, 'the block does not teach the reply command');
  assert.match(block, /from a room or from a person/,
    'the closing rule names one surface, which is how the room rule was learned and the person rule was not');
  assert.match(block, /post <project-id>/, 'the block stopped teaching the room command');
});

test('a reply is escaped on its way to the screen', () => {
  /**
   * 🛑 THE ONE ROW IN THIS THREAD WRITTEN BY SOMETHING OTHER THAN THE OPERATOR,
   * so it is the row where the escape is load-bearing — and the source-grep
   * version passed with `esc()` deleted from it.
   *
   * ⚠️ The renderer is executed here rather than read. `dmRow` needs `esc`,
   * `pjWhenPart`, `pjWhen` and `dmWho`, so they are sliced with it; `CURRENT`
   * is a module-level the function reads, so it is supplied.
   */
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const slice = (name) => {
    const at = page.indexOf(`function ${name}(`);
    assert.notEqual(at, -1, `${name} is not in the page`);
    let d = 0; let i = page.indexOf('{', at);
    for (; i < page.length; i++) { if (page[i] === '{') d++; else if (page[i] === '}') { d--; if (!d) break; } }
    return page.slice(at, i + 1);
  };
  // eslint-disable-next-line no-new-func
  const dmRow = new Function(
    'let CURRENT = { sessionName: "dana", name: "Dana" };\n'
    + ['esc', 'pjWhen', 'pjWhenPart', 'pjSentence', 'pjVerdict', 'dmWho', 'dmRow'].map(slice).join('\n')
    + '; return dmRow;',
  )();

  const html = dmRow({ from: 'dana', text: '<img src=x onerror=alert(1)>', at: new Date().toISOString() }, 'Dana');
  assert.doesNotMatch(html, /<img/, 'an agent’s reply reaches the page unescaped');
  assert.match(html, /&lt;img/, 'the text was dropped rather than escaped');
  assert.match(html, /dm theirs/, 'the reply is rendered as the person’s own words');
  assert.doesNotMatch(html, /Sent|Placed|Could not/, 'a reply was given a delivery verdict it cannot have');

  // ⚠️ THE CONTROL: the person's own row still renders, and still as theirs.
  const mine = dmRow({ text: 'hi', at: new Date().toISOString(), delivery: { state: 'placed' } }, 'Dana');
  assert.match(mine, /dm mine/, 'the person’s rows stopped rendering as theirs');
});
