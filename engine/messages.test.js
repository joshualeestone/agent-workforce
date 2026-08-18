'use strict';

/**
 * Agent-to-agent messages: the mechanism's own suite.
 *
 * Same seams as chat.test.js, and deliberately the same harness idiom: the
 * fleet fixture arranges REAL roster rows through the real producers, the
 * tmux runner is scripted, and every "nothing was typed" assertion reads
 * the recorded sends rather than trusting a verdict.
 */

const os = require('node:os');

// ⚠️ Sandboxed BEFORE any engine require, like every sibling suite: this
// module writes a message log under store.ROOT, and an unsandboxed run
// would append test traffic to the operator's real record.
const SANDBOX = require('node:path').join(os.tmpdir(), 'kosmos-messages-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try {
    return fn(board);
  } finally {
    board.restore();
  }
}

/** A healthy just-before-sending probe, field order per VERIFY_FORMAT. */
function okProbe() {
  return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
}

function fakeTmux(answers, opts) {
  const calls = [];
  const probe = opts && Object.prototype.hasOwnProperty.call(opts, 'probe') ? opts.probe : okProbe();
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return probe;
    return answers.length ? answers.shift() : { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  };
  fn.calls = calls;
  fn.sends = () => calls.filter((args) => args[0] === 'send-keys');
  return fn;
}

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }

function arm(answers, opts) {
  const tmux = fakeTmux(answers, opts);
  chat.setRunner(tmux);
  chat.setDryRun(false);
  return tmux;
}

/** The sender seam: this pane belongs to that session. */
function armSender(session) {
  const calls = [];
  messages.setRunner((pane) => { calls.push(pane); return { ok: true, session }; });
  return calls;
}

function wipeLog() {
  try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ }
}

test.beforeEach(() => { chat.resetForTests(); messages.resetForTests(); wipeLog(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* ── who is sending ──────────────────────────────────────────────────────── */

test('the sender is derived from the pane, and the delivered envelope names them with the id', () => {
  withFleet([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })], (board) => {
    armSender('leo-discord');
    const tmux = arm([ok(), ok()]);
    const sent = messages.send({ fromPane: '%7', to: 'mara', text: 'have a look at the lease' }, board.agents);
    assert.equal(sent.state, chat.DELIVERY.PLACED);
    assert.equal(sent.id, 'm1');
    const sends = tmux.sends();
    // ⚠️ The envelope IS the attribution: WHO before WHAT, on one line,
    // typed to the exact-match-pinned target.
    assert.equal(sends[0][5], '[message from your colleague leo · m1] have a look at the lease');
    assert.ok(sends[0][2].startsWith('=mara-discord:'), 'the message left for somewhere other than the addressed pane');
    // The log carries the five ruled fields (the screens draw from this).
    const logged = messages.list('leo');
    assert.equal(logged.length, 1);
    const m = logged[0];
    assert.equal(m.from, 'leo');
    assert.equal(m.to, 'mara');
    assert.equal(m.text, 'have a look at the lease');
    assert.equal(m.in_reply_to, null);
    assert.ok(m.at, 'a message without a timestamp cannot be drawn as a conversation');
  });
});

test('a pane we cannot tie to an agent is refused as anonymous, and nothing is typed', () => {
  withFleet([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })], (board) => {
    armSender('somebody-elses-session');
    const tmux = arm([ok(), ok()]);
    const sent = messages.send({ fromPane: '%7', to: 'mara', text: 'hello' }, board.agents);
    assert.equal(sent.state, chat.DELIVERY.COULD_NOT);
    assert.match(sent.because, /anonymous/, 'the refusal does not say why the sender was rejected');
    assert.equal(tmux.sends().length, 0, 'a refused sender still reached a pane');
    assert.equal(messages.list().length, 0, 'a refused send was written into the record');
  });
});

test('an option-shaped pane string is refused before tmux is ever asked', () => {
  withFleet([fleet.agent('mara', { state: 'idle' })], (board) => {
    const asked = [];
    messages.setRunner((pane) => { asked.push(pane); return { ok: true, session: 'mara-discord' }; });
    const sent = messages.send({ fromPane: '-p; rm -rf /', to: 'mara', text: 'x' }, board.agents);
    assert.equal(sent.state, chat.DELIVERY.COULD_NOT);
    assert.equal(asked.length, 0, 'a hostile pane string was handed to tmux as arguments');
  });
});

test('a note to yourself is refused, in words', () => {
  withFleet([fleet.agent('leo', { state: 'idle' })], (board) => {
    armSender('leo-discord');
    arm([ok(), ok()]);
    const sent = messages.send({ fromPane: '%7', to: 'leo', text: 'remember the milk' }, board.agents);
    assert.equal(sent.state, chat.DELIVERY.COULD_NOT);
    assert.match(sent.because, /your own name/);
  });
});

/* ── what it answers ─────────────────────────────────────────────────────── */

test('in_reply_to must be one of our ids: a real one rides the envelope and the log, an invented shape is refused', () => {
  withFleet([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })], (board) => {
    armSender('leo-discord');
    let tmux = arm([ok(), ok()]);
    messages.send({ fromPane: '%7', to: 'mara', text: 'first' }, board.agents);
    chat.resetForTests();
    armSender('mara-discord');
    tmux = arm([ok(), ok()]);
    const reply = messages.send({ fromPane: '%9', to: 'leo', text: 'second', inReplyTo: 'm1' }, board.agents);
    assert.equal(reply.state, chat.DELIVERY.PLACED);
    assert.match(tmux.sends()[0][5], /· answers m1\] second$/,
      'the recipient cannot see what this message responds to');
    assert.equal(messages.list('mara')[1].in_reply_to, 'm1');

    const bogus = messages.send({ fromPane: '%9', to: 'leo', text: 'third', inReplyTo: 'DROP TABLE' }, board.agents);
    assert.equal(bogus.state, chat.DELIVERY.COULD_NOT);
    assert.match(bogus.because, /message id like/);
  });
});

/* ── the valve ───────────────────────────────────────────────────────────── */

test('the pair valve: the send past the cap is refused with the surface-to-your-operator sentence, logged, and not typed', () => {
  withFleet([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })], (board) => {
    // Seed the record at the cap, inside the window: this is this module's
    // OWN artifact (the jsonl it writes), not a hand-built producer object.
    const now = Date.now();
    fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
    for (let i = 0; i < messages.PAIR_CAP; i += 1) {
      fs.appendFileSync(messages.LOG, JSON.stringify({
        kind: 'message', id: 'm' + (i + 1), from: i % 2 ? 'leo' : 'mara', to: i % 2 ? 'mara' : 'leo',
        text: 'round ' + i, in_reply_to: null, at: new Date(now - 60000).toISOString(), state: 'placed',
      }) + '\n');
    }
    armSender('leo-discord');
    const tmux = arm([ok(), ok()]);
    const sent = messages.send({ fromPane: '%7', to: 'mara', text: 'one more round' }, board.agents);
    assert.equal(sent.state, chat.DELIVERY.COULD_NOT);
    assert.match(sent.because, /surface where you are to your operator/,
      'the valve closed without telling the agent what to do instead');
    assert.equal(tmux.sends().length, 0, 'the valve refused and the message was typed anyway');
    const valve = messages.readLog().filter((m) => m.kind === 'valve');
    assert.equal(valve.length, 1, 'the valve closing was not logged, so a screen would render it as silence');

    // ⚠️ THE CONTROL: the same ten messages OUTSIDE the window do not close
    // the valve -- without this, a valve that always refuses would pass the
    // refusal assertions above.
    wipeLog();
    for (let i = 0; i < messages.PAIR_CAP; i += 1) {
      fs.appendFileSync(messages.LOG, JSON.stringify({
        kind: 'message', id: 'm' + (i + 1), from: 'leo', to: 'mara',
        text: 'old round', in_reply_to: null,
        at: new Date(now - messages.PAIR_WINDOW_MS - 60000).toISOString(), state: 'placed',
      }) + '\n');
    }
    chat.resetForTests();
    armSender('leo-discord');
    arm([ok(), ok()]);
    const fresh = messages.send({ fromPane: '%7', to: 'mara', text: 'a new conversation' }, board.agents);
    assert.equal(fresh.state, chat.DELIVERY.PLACED, 'an old conversation still counts against the valve');
  });
});

/* ── long bodies ─────────────────────────────────────────────────────────── */

test('a long body spills to a file and the pane gets the head and the path; the log keeps the whole text', () => {
  withFleet([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })], (board) => {
    armSender('leo-discord');
    const tmux = arm([ok(), ok()]);
    const long = 'brief: ' + 'the lease detail '.repeat(80);
    const sent = messages.send({ fromPane: '%7', to: 'mara', text: long }, board.agents);
    assert.equal(sent.state, chat.DELIVERY.PLACED);
    const typed = tmux.sends()[0][5];
    assert.ok(typed.length < 400, 'the pane got the wall this feature exists to avoid');
    assert.match(typed, /long message; the full text is at /,
      'the pointer does not say where the rest is');
    const spilled = typed.match(/full text is at ([^)]+)\)/)[1];
    assert.equal(fs.readFileSync(spilled, 'utf8').trim(), chat.cleanMessage(long),
      'the spill file does not hold the text the pane points at');
    assert.equal(messages.list('mara')[0].text, chat.cleanMessage(long),
      'the log kept the pointer instead of the conversation');
    // CONTROL: a short body writes no file.
    chat.resetForTests();
    armSender('leo-discord');
    arm([ok(), ok()]);
    messages.send({ fromPane: '%7', to: 'mara', text: 'short' }, board.agents);
    const spills = fs.readdirSync(path.dirname(spilled));
    assert.equal(spills.length, 1, 'a short message spilled to a file it did not need');
  });
});

/* ── delivery refusals ───────────────────────────────────────────────────── */

test('a recipient the operator chat would refuse is refused here too, and the record shows no message', () => {
  withFleet([fleet.agent('leo', { state: 'idle' }), fleet.agent('rook', { state: 'stopped' })], (board) => {
    armSender('leo-discord');
    const tmux = arm([ok(), ok()]);
    const sent = messages.send({ fromPane: '%7', to: 'rook', text: 'are you there' }, board.agents);
    assert.equal(sent.state, chat.DELIVERY.COULD_NOT, 'a colleague reached a pane the operator could not');
    assert.equal(tmux.sends().length, 0);
    assert.equal(messages.list().filter((m) => m.kind === 'message').length, 0);
  });
});

/* ── what new agents are born knowing ────────────────────────────────────── */

test('the colleagues block teaches the command and the colleague-vs-operator distinction, inside its own markers', () => {
  const projects = require('./projects');
  const body = messages.blockBody();
  assert.match(body, /kosmos msg <their-name>/, 'the block does not teach the command');
  assert.match(body, /not your operator/, 'the block does not draw the colleague-vs-operator line');
  assert.match(body, /surface\s+where you are to your operator/, 'the block does not carry the valve posture');
  // The same splice create.js runs at birth: the block lands between its
  // markers and a re-splice replaces rather than duplicates.
  const once = projects.spliceBlock('# leo\n\ntheir words\n', body, messages.START, messages.END);
  assert.match(once, /kosmos msg/);
  const twice = projects.spliceBlock(once, body, messages.START, messages.END);
  assert.equal((twice.match(/kosmos msg/g) || []).length, 1, 'a re-splice duplicated the block');
});
