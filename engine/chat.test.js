'use strict';

/**
 * ⚠️ THE SANDBOX IS SET BEFORE ANY MODULE IS REQUIRED, and all three roots
 * matter. `AGENT_WORKFORCE_DATA` moves the record store off the operator's real
 * app data, `AGENT_WORKFORCE_WORKERS` moves the instruction files the fixture
 * writes off the real fleet's (an unsandboxed write there changes what a live
 * agent boots from), and `chat.resetForTests()` re-arms dry-run so nothing here
 * can reach a real tmux. This is the one module in the product that types into
 * a running agent's session: a test that escaped the seam would put fixture
 * text into somebody's live conversation.
 *
 * ⚠️ AND EVERY CARD COMES FROM `test-support/fleet`, never from an object
 * literal. The first version of this file hand-built its roster and the
 * fixture-discipline lint refused it, correctly: a hand-built card is free to
 * carry fields `snapshot()` does not emit, which is exactly how this feature's
 * neighbour shipped dead for a whole branch. Everything below is what the real
 * producers say about a fleet described to the fixture.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-chat-test-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
// This file requires ./projects, whose default folder path writes real
// directories under ~/Kosmos/Projects. Nothing here reaches that today
// (only the pure describe() is called), but the first projects.create()
// added to this suite would build folders in the operator's home -- so the
// root is sandboxed like its siblings, before the require (round 21).
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
// ⚠️ DRY RUN FROM THE FIRST REQUIRE, before any beforeEach exists. Between
// the require below and the first hook the module used to sit armed
// (DRY_RUN false, runner null) against the real machine's tmux -- latent
// rather than live, but the header's "no ordering of teardowns leaves a
// suite able to send" rested entirely on beforeEach. The spawned writer.js
// children inherit this env and boot the same way.
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
// `strict`, like 13 of this repo's 16 test files (round 37): loose
// `assert.equal(x, null)` passes when the field is undefined, i.e. when the
// producer stops emitting it at all -- the exact class the blocked/exists
// assertions in the projects suite were hardened against.
const assert = require('node:assert/strict');

const chat = require('./chat');
const status = require('./status');
const projects = require('./projects');
const fleet = require('../test-support/fleet');

/**
 * Install a fleet, run the test against the REAL cards, and always put the
 * seams back. The `finally` is not tidiness: a leaked pane source makes every
 * later test in this process read a fleet it never asked for.
 */
function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try {
    return fn(board);
  } finally {
    board.restore();
  }
}

/**
 * A healthy answer to the just-before-sending probe: a Claude version string,
 * no claim (the fixture's sessions carry the `-discord` suffix instead), not in
 * copy-mode. The field ORDER is the engine's own `VERIFY_FORMAT`.
 */
function okProbe() {
  return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
}

/**
 * Records every tmux call and answers however the test says.
 *
 * ⚠️ THE PROBE IS ANSWERED SEPARATELY FROM THE SCRIPT, and by default it is
 * answered as healthy. `deliver` asks the pane again immediately before typing
 * (see `verifyAtSend`), so without this every test that scripts two answers
 * would have its first one eaten by the probe and would be measuring a refusal
 * rather than the send it was written for. Tests that care about the probe pass
 * `{probe: …}` and say so.
 */
function fakeTmux(answers, opts) {
  const calls = [];
  const probe = opts && Object.prototype.hasOwnProperty.call(opts, 'probe') ? opts.probe : okProbe();
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return probe;
    return answers.length ? answers.shift() : { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  };
  fn.calls = calls;
  // The sends only, so a test asserting "nothing was typed" is not confused by
  // the read-only probe that precedes them.
  fn.sends = () => calls.filter((args) => args[0] === 'send-keys');
  return fn;
}

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
function refused(err) { return { ran: true, spawnFailed: false, status: 1, out: '', err: err || 'no' }; }
/** tmux was executed and did not answer in time: it may have delivered. */
function timedOut() { return { ran: false, spawnFailed: false, status: null, out: '', err: 'timed out' }; }
/** tmux never started, so no keystroke exists. */
function neverRan() { return { ran: false, spawnFailed: true, status: null, out: '', err: 'ENOENT' }; }

/** Arm the seam with a scripted tmux, the only way this suite may "send". */
function arm(answers, opts) {
  const tmux = fakeTmux(answers, opts);
  chat.setRunner(tmux);
  chat.setDryRun(false);
  return tmux;
}

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* ── what may be sent ────────────────────────────────────────────────────── */

test('a message is one line: every run of whitespace collapses, because a newline in the pane is a submit', () => {
  assert.equal(chat.cleanMessage('do the\nsecond thing\n\nplease'), 'do the second thing please');
  assert.equal(chat.cleanMessage('  padded  '), 'padded');
  assert.equal(chat.cleanMessage(null), '');
});

test('an empty message is refused, and so is one that is only whitespace', () => {
  assert.equal(chat.messageProblem(''), 'write something to send');
  assert.equal(chat.messageProblem('   \n  '), 'write something to send');
});

test('a non-string is refused, not coerced into "[object Object]"', () => {
  // What was CHECKED must be what gets TYPED: String({}) would pass every
  // later check and type a coerced artifact nobody wrote into a session.
  assert.equal(chat.messageProblem({}), 'that message is not text');
  assert.equal(chat.messageProblem(['ship it']), 'that message is not text');
  assert.equal(chat.messageProblem(42), 'that message is not text');
  // null/undefined stay on the empty-message path: "write something to send"
  // is the right sentence for an absent field, and cleanMessage(null) is ''.
  assert.equal(chat.messageProblem(null), 'write something to send');
  assert.equal(chat.messageProblem(undefined), 'write something to send');
});

test('a message longer than the cap is refused rather than truncated', () => {
  assert.match(chat.messageProblem('x'.repeat(chat.MAX_TEXT + 1)), /2000 characters or fewer/);
  assert.equal(chat.messageProblem('x'.repeat(chat.MAX_TEXT)), null);
});

test('control characters are REFUSED, not stripped: an ESC would cancel what is on the agent’s screen', () => {
  // The whitespace collapse has already dealt with tab, newline and return, so
  // what is left in this range arrived on purpose or by paste accident. ESC is
  // the one that costs something: in a TUI it is the Escape KEY, so a message
  // carrying one would dismiss the very question it was written to answer.
  assert.match(chat.messageProblem('cancel this \u001b[A and type'), /characters we will not type/);
  assert.match(chat.messageProblem('bell \u0007 here'), /characters we will not type/);
  assert.match(chat.messageProblem('delete \u007f here'), /characters we will not type/);
  // Ordinary text with punctuation, dashes and non-ASCII is fine.
  assert.equal(chat.messageProblem('ship it — the café one, not the other'), null);
});

/* ── who may be sent to ──────────────────────────────────────────────────── */

test('a roster we could not read is NOT permission: nothing is typed anywhere', () => {
  const tmux = arm([]);
  const verdict = chat.deliver('casey', 'hello', null);
  assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
  assert.match(verdict.because, /could not check which agents are running/);
  assert.equal(tmux.sends().length, 0, 'nothing may be typed on the strength of a look that failed');
});

test('a session that is not marked ours is refused: a stranger’s `tmux new -s casey` is not this agent', () => {
  withFleet([fleet.stranger('casey', { state: 'needs_you' })], (board) => {
    const tmux = arm([]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /cannot tell that it is this agent/);
    assert.equal(tmux.sends().length, 0);
  });
});

test('the name must match EXACTLY: a spelling that merely sanitises to a live agent is refused', () => {
  // `store.safeKey` STRIPS, so `Ca.sey` resolves to `casey` on every path that
  // goes through it. This repo has fixed that exact hole three times — the
  // profile route, `projects.tellAgent`, `remove` — and here it would type into
  // a conversation rather than edit a file.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([]);
    const verdict = chat.deliver('Ca.sey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /cannot see an agent by exactly this name/);
    assert.equal(tmux.sends().length, 0);
  });
});

test('a pane with no Claude in it is refused, because text sent to a shell is RUN', () => {
  withFleet([fleet.agent('casey', { state: 'stopped' })], (board) => {
    const tmux = arm([]);
    const verdict = chat.deliver('casey', 'rm the old build', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /run as a command instead of read/);
    assert.equal(tmux.sends().length, 0);
  });
});

test('a pane scrolled back in copy-mode is refused, and says which of the two it is', () => {
  // Copy-mode is the quiet one: the keystrokes go to copy-mode bindings and
  // never reach the composer, while tmux answers success — so without this gate
  // the screen would report a delivery that did not happen.
  withFleet([fleet.agent('casey', { state: 'needs_you', inMode: '1' })], (board) => {
    const tmux = arm([]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /scrolled back/);
    assert.equal(tmux.sends().length, 0);
  });
});

/* ── the send itself ─────────────────────────────────────────────────────── */

test('a good send is two calls in order: the literal text, then Enter, both pinned to the exact pane', () => {
  withFleet([fleet.agent('casey', { state: 'needs_you' })], (board) => {
    const tmux = arm([ok(), ok()]);
    const verdict = chat.deliver('casey', 'have a look at the lease', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.PLACED);
    assert.equal(verdict.because, null);
    const target = '=' + board.card('casey').target;
    const sends = tmux.sends();
    assert.deepEqual(sends[0], ['send-keys', '-t', target, '-l', '--', 'have a look at the lease']);
    assert.deepEqual(sends[1], ['send-keys', '-t', target, 'Enter']);
    // And the pane was asked about itself FIRST, read-only, before any keystroke.
    assert.equal(tmux.calls[0][0], 'display-message');
  });
});

test('the target carries the `=` exact-match pin, which is what stops a send landing on a lookalike session', () => {
  // Measured on tmux 3.6a: with the session killed and a `kchatprobe2` still
  // alive, the pinned form answers "can't find session" instead of typing into
  // the neighbour. Asserted on the ARGUMENT, because that is the half this
  // module controls — and asserted against the REAL card's target, so a change
  // to how the engine addresses panes moves this test rather than passing.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const card = board.card('casey');
    assert.equal(chat.paneTarget(card), '=' + card.target);
    assert.ok(chat.paneTarget(card).startsWith('=casey-discord:'));
  });
});

test('the text is delivered CLEANED, so what was checked is what is typed', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', '  two\nlines  ', board.agents);
    assert.equal(tmux.sends()[0][5], 'two lines');
  });
});

test('`--` ends option parsing, so a message starting with a dash is typed rather than read as flags', () => {
  // Measured with `-echo dashy-probe-text`, which landed verbatim in a real
  // pane's composer.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()]);
    const verdict = chat.deliver('casey', '-n is what broke it', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.PLACED);
    assert.equal(tmux.sends()[0][4], '--');
    assert.equal(tmux.sends()[0][5], '-n is what broke it');
  });
});

test('tmux refusing the text is a could_not that carries what tmux said', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([refused("can't find pane: =casey-discord:0.0")]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /could not type it into its window/);
    assert.match(verdict.because, /can't find pane/);
    assert.equal(tmux.sends().length, 1, 'Enter is not pressed after the text failed to land');
  });
});

test('text that landed but could not be SUBMITTED is UNCONFIRMED, not a failure', () => {
  /**
   * ⚠️ THIS TEST USED TO ASSERT THE OPPOSITE, and it was wrong in the way the
   * third state exists to fix. It expected `could_not` with "it is sitting
   * there unsent" — so the screen told somebody their message had not gone,
   * about a send whose text had demonstrably reached the composer. The obvious
   * next thing a person does is send it again, and now a live agent has it
   * twice; on a permission prompt, the second copy answers a question the first
   * one already answered.
   */
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    arm([ok(), refused('no current session')]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.UNCONFIRMED);
    assert.match(verdict.because, /may be sitting in its composer unsent/);
  });
});

test('dry run NEVER reports a delivery it did not perform', () => {
  // With no runner installed the module is in dry-run, and a dry-run send has
  // to answer could_not. Reporting "placed" for a keystroke nobody sent is the
  // one lie this whole module is written against.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    chat.resetForTests();
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /without permission to touch/);
  });
});

test('leaving dry-run with no runner installed is refused outright, and dropping the runner re-arms it', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    chat.resetForTests();
    assert.throws(() => chat.setDryRun(false), /refusing to leave dry-run/);
    // Bidirectional: dropping the runner puts dry-run back, so no ordering of
    // teardowns leaves a suite able to send.
    arm([ok(), ok()]);
    chat.setRunner(null);
    /* ⚠️ The FLAG is asserted, then the refusal's own sentence (round 37).
       COULD_NOT alone could not fail from the hazard this test names: with
       the re-arm gone, deliver falls through to the real execFileSync, the
       probe of a pane that does not exist on the host answers non-zero, and
       the verdict is still COULD_NOT -- green in exactly the state where
       the suite can type into live agents. DRY_RUN is exported as a getter
       for precisely this assertion, and the /without permission/ clause is
       the dry-run refusal's wording, which no real tmux failure produces. */
    assert.equal(chat.DRY_RUN, true, 'dropping the runner must re-arm dry-run');
    const rearmed = chat.deliver('casey', 'hello', board.agents);
    assert.equal(rearmed.state, chat.DELIVERY.COULD_NOT);
    assert.match(rearmed.because, /without permission to touch/);
  });
});

/* ── the agent's side ────────────────────────────────────────────────────── */

test('the viewport is the pane text, captured with -J and bounded, and trimmed only at the ends', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok('  first line\nsecond line\n\n\n')]);
    const view = chat.viewport('casey', board.agents);
    assert.equal(view.text, '  first line\nsecond line');
    assert.equal(view.because, null);
    assert.deepEqual(tmux.calls[0],
      ['capture-pane', '-p', '-J', '-t', '=' + board.card('casey').target, '-S', '-60']);
  });
});

test('a viewport we could not capture says so, and never comes back as an empty screen', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    arm([refused('no server running')]);
    const view = chat.viewport('casey', board.agents);
    assert.equal(view.text, null, 'null is "we could not look"; an empty string would be a claim about the screen');
    assert.match(view.because, /could not read its window/);
  });
});

test('an untied pane’s screen is not shown under this agent’s name', () => {
  withFleet([fleet.stranger('casey', { state: 'working' })], (board) => {
    const tmux = arm([ok('somebody else’s work')]);
    const view = chat.viewport('casey', board.agents);
    assert.equal(view.text, null);
    assert.match(view.because, /cannot tell that it is this agent/);
    assert.equal(tmux.sends().length, 0, 'we do not even capture a pane we cannot tie to the name');
  });
});

/* ── the question ────────────────────────────────────────────────────────── */

test('the question region is a SLICE of the same screen, taken from the marker the board itself matched', () => {
  const pane = [
    'Reading engine/projects.js',
    'Reading engine/status.js',
    'I want to delete the old build folder.',
    '',
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. No',
  ].join('\n');
  const found = chat.questionIn(pane);
  assert.ok(found, 'a pane the board calls needs_you must yield a region');
  assert.match(found.text, /Do you want to proceed\?/);
  assert.match(found.text, /1\. Yes/);
  // The run-up is included, because a permission prompt says what it is asking
  // about above the line that matches.
  assert.match(found.text, /delete the old build folder/);
});

test('the LAST match wins, because a pane accumulates and an answered question can still be on screen', () => {
  const pane = [
    'Do you want to proceed?',
    'Yes, go ahead',
    'ok, done that',
    'reading things', 'more things', 'still going', 'nearly there', 'one more line',
    'Would you like to run the tests?',
  ].join('\n');
  const found = chat.questionIn(pane);
  assert.match(found.text, /Would you like to run the tests\?/);
  assert.ok(!/Do you want to proceed/.test(found.text), 'the stale question above is not the live one');
});

test('a screen with no question yields null rather than a guess', () => {
  assert.equal(chat.questionIn('Worked for 3m\n⏵⏵ accept edits on'), null);
  assert.equal(chat.questionIn(''), null);
  assert.equal(chat.questionIn(null), null);
});

test('the question the thread shows comes off the SAME screen the board called needs_you', () => {
  /**
   * ⚠️ THE CONTRADICTION THIS PREVENTS: a card saying "Needs you" over a thread
   * showing no question. It is prevented by sharing one marker list rather than
   * by a comment, so this asserts the two agree on a fleet the real classifier
   * classified — not on a string this test invented and then matched itself.
   */
  assert.ok(Array.isArray(status.NEEDS_YOU_MARKERS) && status.NEEDS_YOU_MARKERS.length);
  withFleet([fleet.agent('casey', { state: 'needs_you' })], (board) => {
    const card = board.card('casey');
    assert.equal(card.state, status.STATE.NEEDS_YOU);
    // The fixture's screen is what the engine classified; the same text is what
    // a capture would hand the viewport.
    const tmux = arm([ok('Do you want to proceed?\n❯ 1. Yes\n  2. No\n')]);
    const view = chat.viewport('casey', board.agents);
    assert.ok(tmux.calls.length === 1);
    const found = chat.questionIn(view.text);
    assert.ok(found, 'the board says it is asking; the thread has to be able to show what');
    assert.match(found.text, /Do you want to proceed\?/);
  });
});

/* ── what is ours to keep ────────────────────────────────────────────────── */

test('an absent thread is an empty conversation; there is nothing to report about it', () => {
  assert.deepEqual(chat.readThread('lease', 'casey').messages, []);
});

test('a path-hostile project id is REFUSED, not sanitised into a different thread’s file', () => {
  for (const bad of ['../../etc', 'a/b', 'Lease', 'has space', '', 'x'.repeat(129), '.']) {
    assert.throws(() => chat.threadFile(bad, 'casey'), /not a project we can read/,
      `expected refusal for ${JSON.stringify(bad)}`);
  }
  assert.ok(chat.threadFile('lease-2', 'casey').endsWith('lease-2.casey.json'));
});

test('an agent name that is not already its own key is refused, so two agents cannot share one thread file', () => {
  // `store.safeKey` collapses `worker.2` and `worker2` to one key.
  // `engine/commitments.js` guards this hazard the same way and for the same
  // reason: here a collision would show one person's messages under another
  // agent's name.
  assert.throws(() => chat.threadFile('lease', 'Casey'), /not an agent name we can keep a thread under/);
  assert.throws(() => chat.threadFile('lease', 'worker.2'), /not an agent name we can keep a thread under/);
  assert.throws(() => chat.threadFile('lease', '../casey'), /not an agent name we can keep a thread under/);
});

test('a message is recorded WITH its delivery verdict, and a failed delivery is recorded too', () => {
  const kept = chat.appendMessage('lease', 'casey', {
    text: 'have a look at the lease',
    delivery: { state: chat.DELIVERY.COULD_NOT, because: 'its window is scrolled back right now' },
  });
  assert.equal(kept.recorded, true);
  const back = chat.readThread('lease', 'casey');
  assert.equal(back.messages.length, 1);
  assert.equal(back.messages[0].text, 'have a look at the lease');
  assert.equal(back.messages[0].delivery.state, chat.DELIVERY.COULD_NOT);
  assert.match(back.messages[0].delivery.because, /scrolled back/);
  assert.ok(back.messages[0].at, 'every message carries when it was sent');
});

test('messages append rather than replace, and each thread is its own file per agent AND per project', () => {
  chat.appendMessage('lease-b', 'casey', { text: 'one', delivery: { state: chat.DELIVERY.PLACED } });
  chat.appendMessage('lease-b', 'casey', { text: 'two', delivery: { state: chat.DELIVERY.PLACED } });
  chat.appendMessage('lease-b', 'mara', { text: 'for mara', delivery: { state: chat.DELIVERY.PLACED } });
  chat.appendMessage('other', 'casey', { text: 'other project', delivery: { state: chat.DELIVERY.PLACED } });
  assert.deepEqual(chat.readThread('lease-b', 'casey').messages.map((m) => m.text), ['one', 'two']);
  assert.deepEqual(chat.readThread('lease-b', 'mara').messages.map((m) => m.text), ['for mara']);
  assert.deepEqual(chat.readThread('other', 'casey').messages.map((m) => m.text), ['other project']);
});

test('an unreadable thread file is an ERROR, never an empty conversation', () => {
  const file = chat.threadFile('damaged', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json at all');
  assert.throws(() => chat.readThread('damaged', 'casey'), (err) => err.code === 'UNPARSEABLE');
  // And the shape is checked too: a file that parses but is not a thread must
  // not read as "you have said nothing to this agent".
  fs.writeFileSync(file, JSON.stringify({ agent: 'casey' }));
  assert.throws(() => chat.readThread('damaged', 'casey'), (err) => err.code === 'UNPARSEABLE');
  // ⚠️ And per ELEMENT (round 27): `messages: [null]` passed every gate
  // and threw a TypeError in the page's renderer, outside its try,
  // unawaited -- a blank thread area with the poll re-throwing forever,
  // the exact stranded state this taxonomy exists to remove. A control
  // pins the boundary: an entry with a string text and junk extras must
  // still read (extras are not the page's problem).
  const born = new Date().toISOString();
  for (const badRow of [null, 'a string', 7, { delivery: {} }, { text: 42 }]) {
    fs.writeFileSync(file, JSON.stringify({ project: 'damaged', agent: 'casey', projectBornAt: born, messages: [badRow] }));
    assert.throws(() => chat.readThread('damaged', 'casey', born), (err) => err.code === 'UNPARSEABLE',
      `a ${JSON.stringify(badRow)} element must be damage, not a render crash`);
  }
  fs.writeFileSync(file, JSON.stringify({ project: 'damaged', agent: 'casey', projectBornAt: born, messages: [{ text: 'fine', junk: true }] }));
  assert.equal(chat.readThread('damaged', 'casey', born).messages[0].text, 'fine',
    'the control: a well-shaped entry with extras still reads');
});

test('a thread filed under a different agent is refused rather than rendered as this one’s', () => {
  const file = chat.threadFile('mixed', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ project: 'mixed', agent: 'mara', messages: [{ text: 'not casey’s' }] }));
  assert.throws(() => chat.readThread('mixed', 'casey'), (err) => err.code === 'UNPARSEABLE');
});

test('a full thread REFUSES to record rather than dropping the oldest thing the person wrote', () => {
  const file = chat.threadFile('full', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const many = Array.from({ length: chat.MAX_MESSAGES }, (_, i) => ({
    at: new Date().toISOString(), text: 'm' + i, delivery: { state: chat.DELIVERY.PLACED, because: null },
  }));
  fs.writeFileSync(file, JSON.stringify({ project: 'full', agent: 'casey', messages: many }));
  const kept = chat.appendMessage('full', 'casey', { text: 'one more', delivery: { state: chat.DELIVERY.PLACED } });
  assert.equal(kept.recorded, false);
  assert.match(kept.because, /1000 messages/);
  // Nothing of the person's was deleted to make room.
  assert.equal(chat.readThread('full', 'casey').messages.length, chat.MAX_MESSAGES);
  assert.equal(chat.readThread('full', 'casey').messages[0].text, 'm0');
});

test('a recording failure NEVER throws, so a delivered message cannot come back looking undelivered', () => {
  const kept = chat.appendMessage('../hostile', 'casey', { text: 'hi', delivery: { state: chat.DELIVERY.PLACED } });
  assert.equal(kept.recorded, false);
  assert.match(kept.because, /not a project we can read/);
});

/* ── who answers ─────────────────────────────────────────────────────────── */

/**
 * The members a project row really produces, for a fleet the real engine
 * classified. `defaultAgentFor` reads `role`, which `describe` only started
 * carrying for this feature — so building these by hand would be exactly the
 * "measuring a world the producer does not produce" failure that cost this
 * codebase a whole branch.
 */
function membersOf(board, names) {
  return projects.describe({
    id: 'p', name: 'P', folder: SANDBOX, agents: names,
    everSeen: Object.fromEntries(names.map((n) => [n, true])), told: {},
  }, board.agents).agents;
}

test('the thread opens on the project’s manager, read off the real card', () => {
  withFleet([
    fleet.agent('nils', { displayName: 'Nils', role: 'researcher', state: 'idle' }),
    fleet.agent('mara', { displayName: 'Mara', role: 'project manager', state: 'idle' }),
    fleet.agent('casey', { displayName: 'Casey', role: 'writer', state: 'idle' }),
  ], (board) => {
    const members = membersOf(board, ['nils', 'mara', 'casey']);
    // The control: the roles really did come through, so a green result cannot
    // be "nobody had a role and the first one won by default".
    assert.equal(members.find((m) => m.sessionName === 'mara').role, 'project manager');
    assert.equal(chat.defaultAgentFor(members), 'mara');
  });
});

test('with no manager on the project, the first agent answers', () => {
  withFleet([
    fleet.agent('nils', { displayName: 'Nils', role: 'researcher', state: 'idle' }),
    fleet.agent('casey', { displayName: 'Casey', role: 'writer', state: 'idle' }),
  ], (board) => {
    assert.equal(chat.defaultAgentFor(membersOf(board, ['nils', 'casey'])), 'nils');
  });
});

test('a stranger holding a manager’s name does not inherit the manager’s role, or the message', () => {
  /**
   * ⚠️ THE BORROWED-NAME SHAPE, pointed at who a message is addressed to. The
   * real `mara`'s instruction file stays on disk; a stranger's `tmux new -s
   * mara` then holds the name. `describe` withholds the role for an untied
   * card, so the stranger cannot be preselected as "the manager", and
   * `addressable` refuses the send outright.
   *
   * ⚠️ THE CONTROL COMES FIRST, and without it this proves nothing: `role:
   * null` is also what an agent with no instruction file at all produces. So
   * the tied card is asserted to read the role BEFORE the untied one is
   * asserted not to. Assert presence before absence.
   */
  withFleet([
    fleet.agent('mara', { displayName: 'Mara', role: 'project manager', state: 'idle' }),
  ], (board) => {
    assert.equal(membersOf(board, ['mara']).find((m) => m.sessionName === 'mara').role, 'project manager');
  });
  // Same name, same file on disk, a session that is not ours.
  withFleet([fleet.stranger('mara', { state: 'working' })], (board) => {
    assert.equal(membersOf(board, ['mara']).find((m) => m.sessionName === 'mara').role, null);
    const tmux = arm([]);
    assert.equal(chat.deliver('mara', 'hello', board.agents).state, chat.DELIVERY.COULD_NOT);
    assert.equal(tmux.sends().length, 0);
  });
});

test('describe’s OWN role gate bites: an untied card CARRYING a role still reads null', () => {
  /**
   * ⚠️ A PRODUCED CARD WITH ONE FIELD FLIPPED, and the flip is the point.
   * status.js nulls `role` and `profile` on every untied card before
   * describe runs, so the borrowed-name test above stays green with
   * describe's own gate deleted (measured: ungating `role` fails nothing in
   * the whole suite) -- the shape only the gate can refuse, untied AND
   * role-bearing, is one today's producer never emits. So it is made from a
   * REAL card: the fleet produces mara tied with her role populated, and
   * only `isNamedOurs` is flipped. That is what defence-in-depth means, and
   * a guard nothing can fail is not one: the day status.js stops nulling
   * upstream, this is the test that notices describe was leaning on it.
   */
  withFleet([
    fleet.agent('mara', { displayName: 'Mara', role: 'project manager', state: 'working' }),
  ], (board) => {
    const real = board.agents.find((a) => a.sessionName === 'mara');
    // Presence controls: the produced card really is tied, role-bearing, and
    // read through -- so the nulls below are the gate refusing, not dead
    // fields or an upstream null arriving pre-stripped.
    assert.equal(real.isNamedOurs, true, 'control: the produced card is ours');
    assert.equal(membersOf(board, ['mara']).find((m) => m.sessionName === 'mara').role,
      'project manager', 'control: tied, the role is read');
    const flipped = [{ ...real, isNamedOurs: false }];
    const row = projects.describe({
      id: 'p', name: 'P', folder: SANDBOX, agents: ['mara'],
      everSeen: { mara: true }, told: {},
    }, flipped).agents.find((m) => m.sessionName === 'mara');
    assert.equal(row.role, null, 'an untied card’s role must not decide who a message goes to');
    assert.equal(row.state, 'unknown');
    assert.equal(row.tied, false);
  });
});

test('a project with nobody on it has nobody to address', () => {
  assert.equal(chat.defaultAgentFor([]), null);
  assert.equal(chat.defaultAgentFor(null), null);
});

test('the manager match is loose on purpose: a role is a sentence somebody typed, not an enum', () => {
  // Being wrong here costs a preselected dropdown entry, changeable in one
  // click. Being strict costs the person the default the screen exists for.
  assert.ok(chat.looksLikeManager('Project manager'));
  assert.ok(chat.looksLikeManager('PM'));
  assert.ok(chat.looksLikeManager('ops manager'));
  assert.ok(chat.looksLikeManager('project lead'));
  assert.ok(!chat.looksLikeManager('researcher'));
  assert.ok(!chat.looksLikeManager(''));
  assert.ok(!chat.looksLikeManager(null));
});

/* ── three states, and the fact that separates them ──────────────────────── */

/**
 * ⚠️ THE INVARIANT, ASSERTED AS AN INVARIANT rather than as a list of cases.
 *
 * `could_not` means NOTHING of the person's text reached the pane, so
 * re-sending is safe and is what they should do. Anything else that went wrong
 * is `unconfirmed`. An enumeration of today's failure paths would go on passing
 * the day somebody adds a fourth one on the wrong side of that line; this
 * asserts the line itself, over every outcome the seam can produce.
 */
test('could_not NEVER means "we typed it and cannot tell": that is what unconfirmed is for', () => {
  const outcomes = [
    ['tmux refused the text', [refused("can't find pane")], chat.DELIVERY.COULD_NOT, 0],
    ['tmux could not be run at all', [neverRan()], chat.DELIVERY.COULD_NOT, 0],
    ['tmux took the text and did not answer', [timedOut()], chat.DELIVERY.UNCONFIRMED, 1],
    ['the text landed and Enter was refused', [ok(), refused('no current session')], chat.DELIVERY.UNCONFIRMED, 1],
    ['the text landed and Enter did not answer', [ok(), timedOut()], chat.DELIVERY.UNCONFIRMED, 1],
    ['the text landed and Enter could not be run', [ok(), neverRan()], chat.DELIVERY.UNCONFIRMED, 1],
    ['both went through', [ok(), ok()], chat.DELIVERY.PLACED, 1],
  ];
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    for (const [what, answers, expected, mayHaveLanded] of outcomes) {
      chat.resetForTests();
      arm(answers.slice());
      const verdict = chat.deliver('casey', 'hello', board.agents);
      assert.equal(verdict.state, expected, `${what}: expected ${expected}, got ${verdict.state}`);
      // The invariant, stated the other way round: a could_not is only allowed
      // where nothing could possibly be on that screen.
      if (verdict.state === chat.DELIVERY.COULD_NOT) {
        assert.equal(mayHaveLanded, 0,
          `${what}: answered could_not for a send whose text may have reached the pane`);
      }
    }
  });
});

test('every refusal BEFORE the first keystroke is could_not, because re-sending is the right thing to do', () => {
  // Nothing was typed on any of these paths, so the person should send again —
  // and the verdict has to be the one that says so.
  withFleet([
    fleet.agent('casey', { state: 'stopped' }),
    fleet.agent('mara', { state: 'needs_you', inMode: '1' }),
  ], (board) => {
    const before = [
      ['an empty message', () => chat.deliver('casey', '   ', board.agents)],
      ['a roster we could not read', () => chat.deliver('casey', 'hi', null)],
      ['a name we cannot see', () => chat.deliver('nobody', 'hi', board.agents)],
      ['a pane with no Claude in it', () => chat.deliver('casey', 'hi', board.agents)],
      ['a pane in copy-mode', () => chat.deliver('mara', 'hi', board.agents)],
    ];
    for (const [what, send] of before) {
      chat.resetForTests();
      const tmux = arm([]);
      assert.equal(send().state, chat.DELIVERY.COULD_NOT, what);
      assert.equal(tmux.sends().length, 0, `${what}: something was typed on a path that refuses`);
    }
  });
});

test('an unconfirmed send states the FACT and hedges it, and leaves the instruction to the screen', () => {
  /**
   * ⚠️ TWO THINGS, and the second is a division of labour worth keeping.
   *
   * The sentence this replaced was "it is sitting there unsent" — a settled
   * claim about where somebody's words are, made in the exact case where we
   * could not read the pane to find out. It hedges now.
   *
   * And it stops there. A first version also appended "Its screen is below;
   * look there before sending it again", which is an instruction from a module
   * that does not know what is on the screen — and the page adds its own, so
   * the person got three clauses pointing at three different places. The engine
   * says what happened; the page says what to do about it, once. That split is
   * asserted from both ends: here, and in `docs/browser-checks/render-thread.js`.
   */
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    arm([ok(), refused("can't find pane: =casey-discord:0.0")]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.UNCONFIRMED);
    assert.match(verdict.because, /may be sitting in its composer unsent/);
    assert.match(verdict.because, /can't find pane/, 'and it still carries what tmux said');
    assert.ok(!/\bis sitting there\b/.test(verdict.because),
      'it states where the words are as a certainty');
    assert.ok(!/screen is below|look there|conversation above/i.test(verdict.because),
      'the engine is telling the person where to look, which is the page’s job and the page also does it');
  });
});

test('a timeout is not a spawn failure, and only one of them may say nothing was typed', () => {
  // ⚠️ Both arrive as `ran: false` from execFileSync, and collapsing them is
  // what turns "tmux was slow" into "your message did not arrive". The engine
  // reads `spawnFailed`, which is set from the SIGNAL rather than inferred from
  // a null exit status.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    chat.resetForTests(); arm([timedOut()]);
    assert.equal(chat.deliver('casey', 'hi', board.agents).state, chat.DELIVERY.UNCONFIRMED);
    chat.resetForTests(); arm([neverRan()]);
    const failed = chat.deliver('casey', 'hi', board.agents);
    assert.equal(failed.state, chat.DELIVERY.COULD_NOT);
    // The spawn-fail arm's paneNote, the third of the three (round 24).
    assert.equal(failed.paneNote, 'it was sitting at its prompt');
    // ⚠️ The spawn-fail sentence keeps the caller's clause (round 20): the
    // clause is what says nothing was typed, and the raw error alone
    // ("ENOENT") sent the reader hunting with no verdict attached.
    assert.ok(failed.because.includes('we could not'), failed.because);
    assert.ok(failed.because.includes('ENOENT'), failed.because);
  });
});

/* ── what the pane was doing when we typed ───────────────────────────────── */

test('the verdict carries what the agent was doing, taken from the board’s own verdict', () => {
  /**
   * ⚠️ WHY THIS LINE EXISTS. "Placed into casey's session just now" is exactly
   * true and invites the wrong inference — that casey is reading it. A Claude
   * that is mid-task does not consume its composer until it finishes, so the
   * message sits there, and without this the person waits, sees nothing, and
   * concludes the feature is broken.
   */
  withFleet([fleet.agent('casey', { state: 'working' })], (board) => {
    arm([ok(), ok()]);
    const verdict = chat.deliver('casey', 'have a look at the lease', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.PLACED);
    // ⚠️ Against the card the fixture really produced, so the thread and the
    // agent's own card cannot disagree about what it was doing.
    assert.equal(verdict.paneState, board.card('casey').state);
    assert.equal(verdict.paneState, 'working');
    assert.match(verdict.paneNote, /mid-task/);
    assert.match(verdict.paneNote, /will not read this until it finishes/);
  });
});

test('an idle agent says so, so the two cases are told apart rather than both going unsaid', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    arm([ok(), ok()]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.paneState, 'idle');
    assert.match(verdict.paneNote, /sitting at its prompt/);
    assert.ok(!/mid-task/.test(verdict.paneNote));
  });
});

test('answering a question says what was OBSERVED, not what the keystroke did to it', () => {
  // "It was waiting on an answer when this was sent" is a claim about a screen
  // we read. "This answered its question" would be a claim about what a TUI did
  // with a keystroke, which nobody watched.
  withFleet([fleet.agent('mara', { state: 'needs_you' })], (board) => {
    arm([ok(), ok()]);
    const verdict = chat.deliver('mara', '1', board.agents);
    assert.equal(verdict.paneState, 'needs_you');
    assert.match(verdict.paneNote, /waiting on an answer when this was sent/);
    assert.ok(!/answered/.test(verdict.paneNote), 'it claims the keystroke answered the question');
  });
});

test('a state we could not read gets a sentence too, and never renders as an idle one', () => {
  // `unknown` is the state that must never read as fine, and silence here would
  // render identically to an agent sitting quietly at its prompt.
  const said = chat.waitingNote('unknown');
  assert.match(said, /could not tell what it was doing/);
  assert.notEqual(said, chat.waitingNote('idle'));
  // And an unrecognised value from a future detector falls to the same honest
  // answer rather than to nothing at all.
  assert.equal(chat.waitingNote('some_future_state'), said);
  assert.equal(chat.waitingNote(null), said);
});

test('a rate-limited agent is told apart from a busy one, because the wait has a different cause', () => {
  assert.match(chat.waitingNote('rate_limited'), /usage limit/);
  assert.notEqual(chat.waitingNote('rate_limited'), chat.waitingNote('working'));
});

test('the note is kept WITH the message, so "why did nothing happen" is answerable later', () => {
  const kept = chat.appendMessage('notes', 'casey', {
    text: 'have a look at the lease',
    delivery: {
      state: chat.DELIVERY.PLACED,
      because: null,
      paneState: 'working',
      paneNote: chat.waitingNote('working'),
    },
  });
  assert.equal(kept.recorded, true);
  const back = chat.readThread('notes', 'casey').messages[0];
  assert.equal(back.delivery.paneState, 'working');
  assert.match(back.delivery.paneNote, /mid-task/);
});

test('a slow tmux and a missing tmux are told apart from what execFileSync REALLY throws', () => {
  /**
   * ⚠️ AGAINST REAL ERRORS, not a fixture of what I remember Node throwing.
   * The whole three-state distinction rests on this one boolean, and both of
   * the cases it separates arrive with `status: null` — so a check written from
   * memory, on the exit status or on `killed`, would have called a slow tmux a
   * missing one and reported a delivered message as undelivered.
   *
   * These throw for real, here, so the day Node changes shape this fails
   * instead of quietly reclassifying every timeout.
   */
  const { execFileSync } = require('node:child_process');
  const caught = (fn) => { try { fn(); return null; } catch (err) { return err; } };

  const missing = caught(() => execFileSync('/definitely/not/tmux', ['x'], { encoding: 'utf8', timeout: 5000 }));
  assert.ok(missing, 'the control: running a binary that is not there has to throw');
  assert.equal(chat.spawnFailure(missing), true, 'a binary that does not exist did start something');

  const notExecutable = caught(() => execFileSync('/etc/hosts', [], { encoding: 'utf8', timeout: 5000 }));
  assert.ok(notExecutable, 'the control: running a non-executable has to throw');
  assert.equal(chat.spawnFailure(notExecutable), true);

  // ⚠️ THE ONE THAT MATTERS. A process killed at the timeout WAS RUNNING, and
  // may have done its work before we gave up on it.
  const slow = caught(() => execFileSync('/bin/sleep', ['5'], { encoding: 'utf8', timeout: 200 }));
  assert.ok(slow, 'the control: a command that outlives its timeout has to throw');
  assert.equal(chat.spawnFailure(slow), false,
    'a tmux that was merely slow is being reported as one that never ran');
});

/* ── the window between authorising a send and making it ─────────────────── */

/**
 * ⚠️ WHAT THESE ARE ABOUT. `addressable` reads a roster SNAPSHOT taken at the
 * top of the request, and `snapshot()` fans out one capture-pane per agent on
 * the machine before this function is reached — so the authorisation is already
 * hundreds of milliseconds old. Both things it checked can stop being true in
 * that window, and a person scrolling their own terminal is enough to do it.
 */
test('deliver REFUSES a bad message itself, before any tmux call, whoever the caller is', () => {
  // Round 16: nulling deliver's own messageProblem gate left the suite
  // green -- the empty-message refusal was only ever asserted against the
  // ROUTE's separate pre-check, and deliver is exported, so a future second
  // caller would not inherit it. This gate is the last thing between an
  // empty or control-character message and send-keys '' plus a separate
  // Enter: a bare submit into a live composer, taking the highlighted
  // default on the exact permission prompt this feature exists for.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    // Presence control first: a valid message on this same fixture DOES send.
    let tmux = arm([ok(), ok()]);
    assert.equal(chat.deliver('casey', 'hello', board.agents).state, chat.DELIVERY.PLACED);
    assert.ok(tmux.sends().length > 0, 'control: the fixture can deliver at all');
    for (const bad of ['', '   \n  ', 'cancel \u001b[A this', 'x'.repeat(chat.MAX_TEXT + 1)]) {
      chat.resetForTests();
      tmux = arm([ok(), ok()]);
      const verdict = chat.deliver('casey', bad, board.agents);
      assert.equal(verdict.state, chat.DELIVERY.COULD_NOT, JSON.stringify(bad.slice(0, 20)));
      assert.ok(verdict.because, 'and it says why');
      assert.equal(tmux.sends().length, 0, 'nothing may reach the pane for ' + JSON.stringify(bad.slice(0, 20)));
    }
  });
});

test('the pane is asked again immediately before typing, and the probe is read-only', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()]);
    assert.equal(chat.deliver('casey', 'hello', board.agents).state, chat.DELIVERY.PLACED);
    const first = tmux.calls[0];
    assert.equal(first[0], 'display-message');
    assert.equal(first[1], '-p');
    assert.equal(first[3], '=' + board.card('casey').target, 'the probe is pinned to the same exact pane');
    // ⚠️ Built from the engine's own column list, so a renamed column moves this
    // rather than leaving it asking tmux for a field that no longer exists.
    assert.equal(first[4], chat.VERIFY_FORMAT);
    assert.match(chat.VERIFY_FORMAT, /pane_current_command/);
    assert.match(chat.VERIFY_FORMAT, /pane_in_mode/);
    assert.match(chat.VERIFY_FORMAT, /kosmos_agent/);
    // ⚠️ THE SEPARATOR, as a literal. The equality above compares the argv
    // against the module's own constant, so it passes whatever the constant
    // contains -- round 14 changed the join to spaces and the suite stayed
    // green while every real probe on the machine would have come back as
    // one field and refused every send. TAB is what okProbe()'s fixture
    // answers with, so the two are pinned to each other here.
    assert.equal((chat.VERIFY_FORMAT.match(/\t/g) || []).length, 2,
      'the probe format must be tab-separated, one tab between each of the three fields');
    assert.ok(!/ /.test(chat.VERIFY_FORMAT), 'no space separator can sneak in beside the tabs');
  });
});

test('Claude exiting in the window is caught, so the message is never RUN as a shell command', () => {
  /**
   * ⚠️ THE WORST OUTCOME THIS FEATURE HAS. The roster said "agent"; by the time
   * we type, the pane is a shell — and a shell EXECUTES what it is sent. The
   * message somebody writes about deleting an old build is a sentence in a
   * composer and a command in a shell.
   */
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()], {
      probe: { ran: true, spawnFailed: false, status: 0, out: '-zsh\t\t0\n', err: '' },
    });
    const verdict = chat.deliver('casey', 'rm the old build', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT, 'a refusal here must read as safe to re-send');
    assert.match(verdict.because, /run as a command instead of read/);
    assert.equal(tmux.sends().length, 0, 'the message was typed into a shell');
  });
});

test('the person scrolling their own terminal in the window is caught, and told apart from the above', () => {
  // Copy-mode is the quiet one: tmux answers success and the keystrokes go to
  // copy-mode bindings, so without this the screen would report `placed` for a
  // message that reached nothing.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()], {
      probe: { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t1\n', err: '' },
    });
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /scrolled back/);
    assert.ok(!/run as a command/.test(verdict.because), 'the two causes are collapsed into one sentence');
    assert.equal(tmux.sends().length, 0);
  });
});

test('a session that stops being ours in the window is caught by the claim, not just by the name', () => {
  // ⚠️ A CLAIM NAMING SOMEBODY ELSE is somebody else's claim. This fleet's
  // sessions are tied by the `-discord` suffix, so to exercise the claim arm the
  // fixture uses a session tied by claim alone — and the probe answers with a
  // claim for a different agent, which is what a stranger's session looks like.
  withFleet([fleet.agent('casey', { state: 'idle', ours: 'claim' })], (board) => {
    // The control: with its own claim back, the same fleet sends fine.
    const good = arm([ok(), ok()], {
      probe: { ran: true, spawnFailed: false, status: 0, out: '2.1.212\tcasey\t0\n', err: '' },
    });
    assert.equal(chat.deliver('casey', 'hello', board.agents).state, chat.DELIVERY.PLACED);
    assert.equal(good.sends().length, 2);

    chat.resetForTests();
    const tmux = arm([ok(), ok()], {
      probe: { ran: true, spawnFailed: false, status: 0, out: '2.1.212\tsomebody-else\t0\n', err: '' },
    });
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /could not still tie its window to this agent/);
    assert.equal(tmux.sends().length, 0);
  });
});

test('a probe we could not run refuses the send rather than waving it through', () => {
  // Fails CLOSED, and it can afford to: nothing has been typed, so `could_not`
  // is both true and the verdict that tells the person to send again.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    for (const answer of [refused('no server running'), timedOut(), neverRan(),
      { ran: true, spawnFailed: false, status: 0, out: 'nonsense\n', err: '' },
      // ⚠️ TOO MANY fields, not just too few: an extra one shifts every value
      // by a column, so a claim would be read as a command.
      { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\textra\n', err: '' },
      // ⚠️ And TOO FEW as its own probe, refused by THIS guard with THIS
      // sentence. The 1-field 'nonsense' probe above is refused downstream by
      // isAgentPane, so relaxing the exact-length check to too-many-only
      // stayed green (round 14) while a short answer earned "its window was
      // scrolled back" -- a claim about a scroll state nothing observed. The
      // sentence is asserted below, not just the refusal.
      { ran: true, spawnFailed: false, status: 0, out: '2.1.212\tcasey\n', err: '' }]) {
      chat.resetForTests();
      const tmux = arm([ok(), ok()], { probe: answer });
      const verdict = chat.deliver('casey', 'hello', board.agents);
      assert.equal(verdict.state, chat.DELIVERY.COULD_NOT, JSON.stringify(answer));
      assert.equal(tmux.sends().length, 0, 'a send went out over a check that did not answer');
    }
    // The too-few sentence, pinned: it must be the shape refusal, never a
    // borrowed claim about scroll state (see the loop comment above).
    chat.resetForTests();
    arm([ok(), ok()], { probe: { ran: true, spawnFailed: false, status: 0, out: '2.1.212\tcasey\n', err: '' } });
    const short = chat.deliver('casey', 'hello', board.agents);
    assert.match(short.because, /shape we do not recognise/,
      'a short probe answer must be refused as a shape, not explained as a scroll state');
  });
});

test('the re-check uses the ENGINE’s rule, so it cannot drift from the one that authorised the send', () => {
  // A second copy of "is this pane typeable" is exactly the two-derivations
  // habit this codebase keeps paying for. `verifyAtSend` hands its fresh fields
  // to `status.isAgentPane`, and this pins that they agree about the same pane.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const card = board.card('casey');
    arm([], { probe: { ran: true, spawnFailed: false, status: 0, out: '-zsh\t\t0\n', err: '' } });
    assert.equal(chat.verifyAtSend(card).ok, false);
    chat.resetForTests();
    arm([], { probe: okProbe() });
    assert.equal(chat.verifyAtSend(card).ok, true);
    // And the engine agrees about the same two panes, read directly.
    assert.equal(status.isAgentPane({ name: 'casey', session: 'casey-discord', claim: '', command: '-zsh', inMode: '0' }), false);
    assert.equal(status.isAgentPane({ name: 'casey', session: 'casey-discord', claim: '', command: '2.1.212', inMode: '0' }), true);
  });
});

/* ── the same name is not the same project ───────────────────────────────── */

test('a NEW project that reuses a removed one’s name does not inherit its conversation', () => {
  /**
   * ⚠️ THE DEFECT: a project id is derived from its NAME, and removing a
   * project frees the id. Make "Henderson lease", say six things to Mara about
   * the lease, remove it, and make a new "Henderson lease" months later for a
   * different building — and the thread opened holding the old conversation,
   * under the new project's heading, as though it had been said about this
   * work. Nothing on screen would have suggested otherwise.
   */
  const born = '2026-01-01T00:00:00.000Z';
  chat.appendMessage('lease-reused', 'casey', {
    text: 'the north building lease',
    delivery: { state: chat.DELIVERY.PLACED },
  }, born);
  // The control: the SAME project reads its own messages back.
  assert.equal(chat.readThread('lease-reused', 'casey', born).messages.length, 1);

  // A different project that happens to have taken the same name.
  const reborn = '2026-08-01T00:00:00.000Z';
  assert.throws(() => chat.readThread('lease-reused', 'casey', reborn),
    (err) => err.code === 'OTHER_PROJECT');
});

test('and the earlier project’s words are KEPT, not deleted, when the new one starts writing', () => {
  const born = '2026-01-01T00:00:00.000Z';
  const reborn = '2026-08-01T00:00:00.000Z';
  chat.appendMessage('lease-kept', 'casey', {
    text: 'said to the FIRST project',
    delivery: { state: chat.DELIVERY.PLACED },
  }, born);
  const file = chat.threadFile('lease-kept', 'casey');

  const kept = chat.appendMessage('lease-kept', 'casey', {
    text: 'said to the SECOND project',
    delivery: { state: chat.DELIVERY.PLACED },
  }, reborn);
  assert.equal(kept.recorded, true, 'a refusal alone would leave the new project unable to keep anything');
  assert.match(kept.supersededBecause, /kept aside/);

  // The new project's thread holds only its own message.
  const now = chat.readThread('lease-kept', 'casey', reborn);
  assert.deepEqual(now.messages.map((m) => m.text), ['said to the SECOND project']);

  // ⚠️ AND NOTHING WAS DELETED. The earlier record is still on disk, beside the
  // new one, with every word in it.
  const aside = fs.readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(path.basename(file)) && f.endsWith('.superseded'));
  assert.equal(aside.length, 1, 'the earlier project’s messages were deleted rather than kept');
  // ⚠️ The stamp sanitiser is pinned here (round 24): projectBornAt is an
  // ISO string, and unsanitised it puts colons into a filename -- the
  // exact Finder-renders-colon-as-slash hazard foldSeparators was extended
  // for one file over. Deleting the replace() was green until this line.
  assert.doesNotMatch(aside[0], /[:*?"<>|\\]/,
    `the aside filename carries filesystem-hostile characters: ${aside[0]}`);
  const was = JSON.parse(fs.readFileSync(path.join(path.dirname(file), aside[0]), 'utf8'));
  assert.deepEqual(was.messages.map((m) => m.text), ['said to the FIRST project']);
});

test('a record written before any of this existed is NOT refused, because we cannot tell', () => {
  // Every thread on disk today has no stamp. Inventing a mismatch for one would
  // refuse a conversation that is very probably this project's own.
  const file = chat.threadFile('legacy-thread', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    project: 'legacy-thread', agent: 'casey',
    messages: [{ at: new Date().toISOString(), text: 'from before', delivery: { state: 'placed' } }],
  }));
  const got = chat.readThread('legacy-thread', 'casey', '2026-08-01T00:00:00.000Z');
  assert.equal(got.messages.length, 1);
  assert.equal(got.projectBornAt, null);
});

test('an existing conversation is not re-stamped by a read that happened to know the date', () => {
  // Carrying the stored stamp forward keeps the record's own history true;
  // overwriting it would quietly re-attach it to whatever asked last.
  const file = chat.threadFile('stamp-keep', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    project: 'stamp-keep', agent: 'casey', projectBornAt: '2026-01-01T00:00:00.000Z',
    messages: [],
  }));
  chat.appendMessage('stamp-keep', 'casey', {
    text: 'another', delivery: { state: chat.DELIVERY.PLACED },
  }, '2026-01-01T00:00:00.000Z');
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(back.projectBornAt, '2026-01-01T00:00:00.000Z');
});

test('a message ending in a semicolon arrives WITH it, because tmux eats a trailing one', () => {
  /**
   * ⚠️ MEASURED against a real tmux 3.6a, in a scratch session created and
   * killed for the probe — not read off the parser. What the pane really showed
   * for a single argv element:
   *
   *   `const total = 0;`         → `const total = 0`   (the semicolon eaten)
   *   `;`                        → ``                  (NOTHING arrives)
   *   `wait;;`                   → `wait;`             (exactly one eaten)
   *   `const a = 1; const b = 2` → unchanged           (a middle one is safe)
   *   `const total = 0; `        → unchanged           (a trailing space saves it)
   *
   * tmux splits argv into a command LIST first, and a `;` at the very end of the
   * last element is that split's separator rather than a character.
   *
   * ⚠️ ASSERTED ON THE ARGV HANDED TO tmux, like the leading-dash test above,
   * because that is the half this module controls. The round-trip itself was
   * measured live; a test cannot re-measure it without typing into a real pane.
   */
  const BACKSLASH = String.fromCharCode(92);
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()]);
    const verdict = chat.deliver('casey', 'const total = 0;', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.PLACED);
    assert.equal(tmux.sends()[0][5], 'const total = 0' + BACKSLASH + ';',
      'a trailing semicolon went to tmux unescaped, so the agent receives the message without it');
  });
});

test('a message of exactly ";" is not a bare Enter into a live composer', () => {
  /**
   * ⚠️ THE DANGEROUS HALF, and it is why this is a blocker rather than a
   * cosmetic loss. Unescaped, `;` types NOTHING — and the separate Enter still
   * fires, so a bare submit lands in the pane. On the permission prompt this
   * whole feature exists for, a bare submit takes the HIGHLIGHTED DEFAULT: the
   * person sends a semicolon and answers a question they never read. And the
   * verdict said `placed`.
   */
  const BACKSLASH = String.fromCharCode(92);
  withFleet([fleet.agent('casey', { state: 'needs_you' })], (board) => {
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', ';', board.agents);
    const sends = tmux.sends();
    assert.equal(sends[0][5], BACKSLASH + ';', 'nothing would be typed, and the Enter below would answer for them');
    assert.deepEqual(sends[1].slice(-1), ['Enter'], 'the control: the Enter really does still fire');
  });
});

test('the escape is applied at the SEND only: the record and the screen keep the person’s own text', () => {
  // An escape that leaked into `cleanMessage` would put a backslash in their
  // history, in the thread on screen, and in what the length check measures.
  assert.equal(chat.cleanMessage('const total = 0;'), 'const total = 0;');
  assert.equal(chat.messageProblem(';'), null, 'a semicolon is a message somebody may legitimately send');
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    arm([ok(), ok()]);
    const verdict = chat.deliver('casey', 'const total = 0;', board.agents);
    chat.appendMessage('wire', 'casey', { text: 'const total = 0;', at: verdict.at, delivery: verdict });
    assert.equal(chat.readThread('wire', 'casey').messages[0].text, 'const total = 0;',
      'the escape leaked into what we keep and show');
  });
});

test('wireText touches a TRAILING semicolon and nothing else', () => {
  const BACKSLASH = String.fromCharCode(92);
  // Changed, because tmux would otherwise alter or swallow them.
  assert.equal(chat.wireText('const total = 0;'), 'const total = 0' + BACKSLASH + ';');
  assert.equal(chat.wireText(';'), BACKSLASH + ';');
  assert.equal(chat.wireText('wait;;'), 'wait;' + BACKSLASH + ';');
  // Left exactly alone — measured as arriving intact, so escaping them would be
  // this function inventing a backslash the person never typed.
  assert.equal(chat.wireText('const a = 1; const b = 2'), 'const a = 1; const b = 2');
  assert.equal(chat.wireText('const total = 0; '), 'const total = 0; ');
  assert.equal(chat.wireText('const total = 0'), 'const total = 0');
  assert.equal(chat.wireText('a path' + BACKSLASH), 'a path' + BACKSLASH);
  // A message ENDING in backslash-semicolon: the one input where the escape
  // could in principle defeat itself (if tmux treated backslash as a general
  // escape, `foo` + \\ + ; would leave a bare separator and deliver `foo` +
  // backslash). Measured 2026-08-14 against a scratch session: it does not.
  // `foo\;` wires to `foo\\;` and the pane receives `foo\;` exactly, and
  // `\;` wires to `\\;` arriving `\;` -- the splitter consumes one backslash
  // to escape the final semicolon and nothing else. See the table above.
  assert.equal(chat.wireText('foo' + BACKSLASH + ';'), 'foo' + BACKSLASH + BACKSLASH + ';');
  assert.equal(chat.wireText(BACKSLASH + ';'), BACKSLASH + BACKSLASH + ';');
  assert.equal(chat.wireText(''), '');
  assert.equal(chat.wireText(null), '');
});

test('two windows sending at once do not lose a message', () => {
  /**
   * ⚠️ THE INTERLEAVE, DRIVEN RATHER THAN DESCRIBED. `appendMessage` is a
   * read-modify-write: both windows read a thread of N, both append their own
   * N+1, both rename their file into place, and the second one wins. The first
   * person's message was delivered to the agent and then vanished from the
   * record of it — silent, and unrecoverable from the screen.
   *
   * Two REAL processes, because the lock is a filesystem lock and a same-process
   * test would prove nothing about it: this module is synchronous, so nothing in
   * one process can interleave with itself.
   */
  const { execFileSync } = require('node:child_process');
  const writer = path.join(SANDBOX, 'writer.js');
  fs.writeFileSync(writer, [
    "process.env.AGENT_WORKFORCE_DATA = process.argv[2];",
    "const chat = require(" + JSON.stringify(require.resolve('./chat')) + ");",
    "const kept = chat.appendMessage(process.argv[4] || 'race', 'casey', {",
    "  text: process.argv[3], delivery: { state: chat.DELIVERY.PLACED },",
    "});",
    "process.stdout.write(JSON.stringify(kept.recorded));",
  ].join('\n'));

  // Seed the thread, so both writers read a non-empty record and each must add
  // to what the other wrote.
  chat.appendMessage('race', 'casey', { text: 'first', delivery: { state: chat.DELIVERY.PLACED } });

  const both = ['from window A', 'from window B'].map((text) =>
    new Promise((resolve) => {
      const { execFile } = require('node:child_process');
      execFile(process.execPath, [writer, SANDBOX, text], { encoding: 'utf8' }, (err, out) => resolve(out));
    }));

  return Promise.all(both).then((answers) => {
    assert.deepEqual(answers, ['true', 'true'], 'the control: both writers believed they recorded');
    const said = chat.readThread('race', 'casey').messages.map((m) => m.text);
    assert.equal(said.length, 3, `a message was lost: the thread holds ${JSON.stringify(said)}`);
    assert.ok(said.includes('from window A'), 'window A’s message is not in the record');
    assert.ok(said.includes('from window B'), 'window B’s message is not in the record');
  });
});

test('a lock nobody is holding is broken rather than waited on forever', () => {
  // A process killed between mkdir and rmdir would otherwise wedge one
  // conversation permanently. The window the lock protects is two file
  // operations, so anything older than the bound is debris.
  const file = chat.threadFile('stalelock', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(file + '.lock', { recursive: true });
  const old = Date.now() - (60 * 1000);
  fs.utimesSync(file + '.lock', new Date(old), new Date(old));
  const kept = chat.appendMessage('stalelock', 'casey', {
    text: 'after the stale lock', delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(kept.recorded, true, 'a dead writer’s lock wedged the conversation for good');
  assert.equal(chat.readThread('stalelock', 'casey').messages.length, 1);
});

test('a lock somebody IS holding refuses rather than corrupting, and says so', () => {
  // The other side of the same rule: a FRESH lock is a live writer, and the
  // honest answer is that we did not record — never a half-merged file.
  const file = chat.threadFile('heldlock', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(file + '.lock', { recursive: true });
  try {
    const kept = chat.appendMessage('heldlock', 'casey', {
      text: 'while held', delivery: { state: chat.DELIVERY.PLACED },
    });
    assert.equal(kept.recorded, false);
    assert.match(kept.because, /locked by another window, or by one that stopped/);
  } finally {
    fs.rmdirSync(file + '.lock');
  }
});

test('a leftover lock that cannot be REMOVED does not spin forever', () => {
  /**
   * ⚠️ MEASURED AS A HANG BEFORE IT WAS FIXED: >15 seconds of spin, killed by
   * hand. A crash-leftover lock directory with anything inside it — a
   * `.DS_Store` is enough — made `rmdirSync` throw ENOTEMPTY, the catch
   * swallowed it, `continue` re-entered `mkdirSync`, the age was still stale,
   * forever. Inside the synchronous POST handler on a single-threaded server,
   * so it was not one conversation that wedged: it was every request on the
   * machine, behind "Sending…".
   *
   * The deadline now covers the stale branch, and the steal is a rename, which
   * does not care what is inside the directory.
   */
  const file = chat.threadFile('wedged', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(file + '.lock', { recursive: true });
  fs.writeFileSync(path.join(file + '.lock', '.DS_Store'), 'debris');
  const old = Date.now() - (60 * 1000);
  fs.utimesSync(file + '.lock', new Date(old), new Date(old));

  const started = Date.now();
  const kept = chat.appendMessage('wedged', 'casey', {
    text: 'after the un-removable lock', delivery: { state: chat.DELIVERY.PLACED },
  });
  const took = Date.now() - started;

  assert.ok(took < 5000, `it spun for ${took}ms rather than answering`);
  assert.equal(kept.recorded, true, 'a lock with a file in it wedged the conversation for good');
  assert.equal(chat.readThread('wedged', 'casey').messages.length, 1);
});

test('two writers that both see a stale lock do not both get inside', () => {
  /**
   * ⚠️ THE INTERSECTION THE EARLIER TESTS MISSED — they covered a single break
   * and fresh contention, never both at once. Two writers can measure the same
   * lock as stale in the same instant; when the break was an `rmdir`, both
   * removed it and both proceeded, the second one demolishing the FIRST one's
   * brand-new lock and walking into the critical section beside it. The
   * interleave the lock exists to prevent, reachable only through the path that
   * repairs it.
   *
   * Two REAL processes again, racing a lock that is already stale before either
   * starts, so both take the steal path.
   */
  const file = chat.threadFile('stalerace', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ project: 'stalerace', agent: 'casey', messages: [] }));
  fs.mkdirSync(file + '.lock', { recursive: true });
  const old = Date.now() - (60 * 1000);
  fs.utimesSync(file + '.lock', new Date(old), new Date(old));

  const writer = path.join(SANDBOX, 'writer.js');
  // Inter-test dependency made loud (round 40): run alone, the child died
  // with a bare ENOENT instead of naming the missing prerequisite.
  assert.ok(fs.existsSync(writer),
    'writer.js is written by the two-real-processes test above; this test cannot run without it');
  const both = ['stale A', 'stale B'].map((text) =>
    new Promise((resolve) => {
      const { execFile } = require('node:child_process');
      execFile(process.execPath, [writer, SANDBOX, text, 'stalerace'], { encoding: 'utf8' },
        (err, out) => resolve(out));
    }));

  return Promise.all(both).then(() => {
    const said = chat.readThread('stalerace', 'casey').messages.map((m) => m.text);
    assert.equal(said.length, 2, `a message was lost breaking a stale lock: ${JSON.stringify(said)}`);
    assert.ok(said.includes('stale A') && said.includes('stale B'));
  });
});

test('the breaker that LOSES the steal stays outside, forced deterministically', () => {
  /**
   * ⚠️ THE RACE TEST ABOVE CANNOT RELIABLY SEE A REGRESSION. Two real
   * processes only collide inside the steal window sometimes: measured in
   * round 13, reverting the rename-steal to an rmdir-steal failed that test
   * once in five runs -- a coin-flip guard for the exact interleave the lock
   * exists to prevent, in the codebase that already paid for a 1-in-8
   * intermittent once. So the losing interleave is FORCED here: the other
   * breaker wins at the precise moment ours reaches for the stale lock (the
   * rename throws ENOENT and a FRESH lock stands in the stale one's place),
   * and the property asserted is that the loser NEVER enters -- it waits out
   * the fresh lock like any contender and answers the honest refusal, and
   * the winner's lock and the thread file are untouched.
   */
  const file = chat.threadFile('stealloser', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  fs.mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(lock, old, old);
  const realRename = fs.renameSync;
  let steals = 0;
  fs.renameSync = (from, to) => {
    if (from === lock) {
      steals += 1;
      // The other breaker wins EXACTLY here: stale lock replaced by a fresh
      // one before our rename lands. Freshening the mtime is that state.
      const now = new Date();
      fs.utimesSync(lock, now, now);
      const err = new Error('no such file');
      err.code = 'ENOENT';
      throw err;
    }
    return realRename(from, to);
  };
  try {
    const got = chat.appendMessage('stealloser', 'casey', {
      text: 'must not be written', delivery: { state: chat.DELIVERY.PLACED },
    });
    assert.equal(got.recorded, false, 'the LOSER of the steal got inside the critical section');
    assert.match(got.because, /locked by another window/);
    assert.equal(steals, 1, 'control: the steal path really ran, exactly once');
    assert.ok(fs.existsSync(lock), 'the winner’s fresh lock did not survive the loser');
    assert.ok(!fs.existsSync(file), 'the loser wrote the thread file from outside the lock');
  } finally {
    fs.renameSync = realRename;
    fs.rmSync(lock, { recursive: true, force: true });
  }
});

test('an earlier project’s messages being moved aside is reported EVEN when the write then fails', () => {
  /**
   * ⚠️ A RENAME ON SOMEBODY'S DISK WITH NO SENTENCE ANYWHERE. `supersede` moves
   * an earlier project's conversation out of the way BEFORE the new record is
   * written — so a write that then fails left the move done and unreported,
   * because only the success return carried word of it. The person is told the
   * message was not recorded and never told their older conversation moved.
   *
   * Forced through the real path: a DIRECTORY planted at the per-pid temp name
   * makes `writeFileSync` fail after the rename has already happened.
   */
  const born = '2026-01-01T00:00:00.000Z';
  const reborn = '2026-08-01T00:00:00.000Z';
  chat.appendMessage('asidefail', 'casey', {
    text: 'said to the FIRST project', delivery: { state: chat.DELIVERY.PLACED },
  }, born);

  const file = chat.threadFile('asidefail', 'casey');
  const blocker = `${file}.${process.pid}.new`;
  fs.mkdirSync(blocker, { recursive: true });
  try {
    const kept = chat.appendMessage('asidefail', 'casey', {
      text: 'said to the SECOND project', delivery: { state: chat.DELIVERY.PLACED },
    }, reborn);
    assert.equal(kept.recorded, false, 'the control: the write really did fail');
    assert.match(kept.supersededBecause, /kept aside/,
      'an earlier conversation was moved and nothing said so');
    // ⚠️ And the sentence is ours, not an errno. "EISDIR: illegal operation on
    // a directory, open '/var/folders/…new'" is not a thing a person can act on.
    assert.match(kept.because, /could not write this conversation down/);
    assert.ok(!/EISDIR|\/var\/folders|\.new/.test(kept.because),
      `an error code and an internal path reached the person: ${kept.because}`);
  } finally {
    fs.rmSync(blocker, { recursive: true, force: true });
  }
  // And nothing of the person's was lost: the earlier conversation is beside it.
  const aside = fs.readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(path.basename(file)) && f.endsWith('.superseded'));
  assert.equal(aside.length, 1);
});

test('a holder whose lock was stolen does not delete the successor’s lock on the way out', () => {
  /**
   * ⚠️ THE CLEANUP PUTTING TWO WRITERS INSIDE. If one critical section ever
   * outlives the stale bound, a second writer steals the lock — and the first
   * one's `finally` then removes the SUCCESSOR's brand-new lock, which is the
   * interleave the lock exists to prevent, arriving through the release path.
   *
   * Simulated exactly: the lock is stolen (renamed away and replaced) from
   * INSIDE the critical section, so the original holder's `finally` runs
   * against a lock that is no longer its own.
   */
  const file = chat.threadFile('stolenrelease', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';

  chat.withThreadLock(file, () => {
    // A successor steals it: the stale path renames the old one away and makes
    // its own. The marker inside is the successor's, not ours.
    fs.renameSync(lock, lock + '.taken');
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner'), 'the-successor');
  });

  assert.ok(fs.existsSync(lock), 'the original holder deleted the successor’s lock on its way out');
  assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8'), 'the-successor',
    'the successor’s lock was replaced rather than left alone');
  fs.rmSync(lock, { recursive: true, force: true });
  fs.rmSync(lock + '.taken', { recursive: true, force: true });
});

test('the ordinary case still releases its own lock, or the next write would block', () => {
  // The control for the test above: without this, "we did not delete it" would
  // also be satisfied by a release that never deletes anything.
  const file = chat.threadFile('normalrelease', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  chat.withThreadLock(file, () => 'done');
  assert.ok(!fs.existsSync(file + '.lock'), 'the lock was left behind after an ordinary release');
});

test('a DAMAGED thread file does not lock recording out forever', () => {
  /**
   * ⚠️ THE SAME ARGUMENT `supersede` ALREADY MAKES, applied to the case it did
   * not cover: refusing forever is a worse bug than the one being fixed. A
   * thread file that will not parse is not a thread we can add to — and it is
   * also not a reason for this conversation to stop being kept for the rest of
   * time. Every send after the damage was delivered and silently unrecorded.
   */
  const file = chat.threadFile('damagedlockout', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ this will not parse');

  const kept = chat.appendMessage('damagedlockout', 'casey', {
    text: 'after the damage', delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(kept.recorded, true, 'a damaged file locked this conversation out for good');
  assert.match(kept.supersededBecause, /damaged file was set aside/);
  assert.deepEqual(chat.readThread('damagedlockout', 'casey').messages.map((m) => m.text),
    ['after the damage']);

  // ⚠️ NOTHING DELETED, and the aside says WHY it was set aside — a distinct
  // suffix from the projectBornAt one, so the two kinds cannot be confused on
  // disk or collide.
  const aside = fs.readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(path.basename(file)) && f.endsWith('.damaged'));
  assert.equal(aside.length, 1, 'the damaged file was deleted rather than kept');
  assert.equal(fs.readFileSync(path.join(path.dirname(file), aside[0]), 'utf8'), '{ this will not parse');
});

test('a supersede that cannot RENAME reports it, and records nothing', () => {
  /**
   * ⚠️ THE FAILURE ARM OF THE ASIDE, driven rather than reasoned about. If the
   * earlier conversation cannot be moved out of the way, appending would mix
   * two projects' words into one record — so nothing is recorded, and the
   * person is told which of the two things failed.
   *
   * ⚠️ The `existsSync` arm above it is deliberately left untested, and the
   * justification here USED TO BE FALSE — it claimed a millisecond stamp the
   * aside name did not carry (that stamp is on the LOCK name, a different
   * string in a different function), which is how the name was a constant and
   * the second damage was refused for good.
   *
   * The name is `<file>.<stamp>.<pid>.<ms>.<kind>`, with `.2`, `.3` … appended
   * while anything is in the way, up to fifty. So reaching that arm needs fifty
   * asides for one project+agent, in one process, inside one millisecond —
   * which is now genuinely unreachable rather than the second time through. It
   * is kept because overwriting the file it is rescuing is the one way this
   * function could fail at its whole job.
   */
  const born = '2026-01-01T00:00:00.000Z';
  const reborn = '2026-08-01T00:00:00.000Z';
  chat.appendMessage('renamefail', 'casey', {
    text: 'the earlier project’s words', delivery: { state: chat.DELIVERY.PLACED },
  }, born);

  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith('.superseded')) throw new Error('EPERM: operation not permitted');
    return realRename(from, to);
  };
  try {
    const kept = chat.appendMessage('renamefail', 'casey', {
      text: 'the new project’s words', delivery: { state: chat.DELIVERY.PLACED },
    }, reborn);
    assert.equal(kept.recorded, false);
    assert.match(kept.because, /could not move an earlier project’s messages aside/);
    assert.ok(!/EPERM|renameSync/.test(kept.because), `an errno reached the person: ${kept.because}`);
  } finally {
    fs.renameSync = realRename;
  }
  // And the earlier conversation is untouched, exactly as it was.
  assert.deepEqual(chat.readThread('renamefail', 'casey', born).messages.map((m) => m.text),
    ['the earlier project’s words']);
});

test('an unconfirmed send does not also assert WHERE the message is sitting', () => {
  // ⚠️ "It was mid-task, so this sits in its composer until it finishes" is a
  // statement about where the message IS — and the one verdict that cannot make
  // it is the one that exists because we do not know whether it arrived. The
  // two were printed side by side in a single sentence.
  assert.match(chat.waitingNote('working', chat.DELIVERY.PLACED), /will not read this until it finishes/);
  assert.equal(chat.waitingNote('working', chat.DELIVERY.UNCONFIRMED), 'it was mid-task');
  assert.match(chat.waitingNote('rate_limited', chat.DELIVERY.PLACED), /may not act on this/);
  assert.equal(chat.waitingNote('rate_limited', chat.DELIVERY.UNCONFIRMED), 'it was paused on a usage limit');
  // What it was DOING is still true and still useful, so that half stays.
  withFleet([fleet.agent('casey', { state: 'working' })], (board) => {
    arm([ok(), refused('no current session')]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.UNCONFIRMED);
    assert.equal(verdict.paneNote, 'it was mid-task');
    /**
     * ⚠️ THIS ASSERTION COULD NOT FAIL, and the reason is one letter of tense.
     * It searched for "sits in its composer" across the note AND the reason —
     * but the reason says "may be SITTING in its composer unsent", which never
     * matched, and the note it was really about no longer contains the clause
     * at all. A negative assertion aimed at text that cannot appear is a green
     * tick for nothing.
     *
     * What it means is: the NOTE stops asserting where the message ended up,
     * while the REASON is still allowed to say "may be sitting" — because that
     * one is hedged, and hedged is the whole difference.
     */
    assert.equal(verdict.paneNote, 'it was mid-task');
    // A REGRESSION GUARD, deliberately redundant with the equality above:
    // it re-fires with its own sentence if the note ever grows the retired
    // "composer" wording back, whatever else the note becomes.
    assert.ok(!/composer/.test(verdict.paneNote),
      'the note still says where the message ended up');
    assert.match(verdict.because, /may be sitting in its composer unsent/,
      'the hedged reason is allowed to say it, and is the control that this text exists at all');
  });
});

test('a file we cannot READ right now is not treated as a file that is DAMAGED', () => {
  /**
   * ⚠️ THE DESTRUCTIVE CONFLATION, and it was measured before it was fixed:
   * `chmod 000` on a healthy six-message thread plus one send renamed the good
   * conversation aside as `.damaged` and replaced it with an empty one, while
   * the screen asserted damage that nothing had established.
   *
   * `readThread` throws for four reasons and only three of them mean the file
   * is bad. A `readFileSync` that failed — EACCES here, EMFILE or EIO on a
   * loaded machine — says nothing at all about the CONTENTS. The repair for
   * genuine damage is destructive, so it must never fire for a transient
   * problem that the next send will simply not have.
   */
  const file = chat.threadFile('unreadablenow', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const text of ['one', 'two', 'three']) {
    chat.appendMessage('unreadablenow', 'casey', { text, delivery: { state: chat.DELIVERY.PLACED } });
  }
  const before = fs.readFileSync(file, 'utf8');

  fs.chmodSync(file, 0o000);
  let refused;
  try {
    // The control: the read really is failing for this reason, not another.
    assert.throws(() => chat.readThread('unreadablenow', 'casey'), (err) => err.code === 'UNREADABLE');
    refused = chat.appendMessage('unreadablenow', 'casey', {
      text: 'while unreadable', delivery: { state: chat.DELIVERY.PLACED },
    });
  } finally {
    fs.chmodSync(file, 0o644);
  }

  assert.equal(refused.recorded, false, 'a message was recorded over a file we could not read');
  assert.match(refused.because, /cannot read this conversation/);
  // ⚠️ `strictEqual` against `?? null`: `assert.equal(undefined, null)` PASSES,
  // so the loose form could not tell a field that is absent from one that is
  // deliberately null — and 'absent' is exactly what a future refactor dropping
  // the field would produce.
  assert.strictEqual(refused.supersededBecause ?? null, null,
    'a file we merely could not read was reported as an earlier one set aside');
  // ⚠️ NOTHING MOVED. The whole defect was the good file being renamed away.
  const asides = fs.readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(path.basename(file)) && f.endsWith('.damaged'));
  assert.deepEqual(asides, [], 'an intact conversation was set aside as damaged');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the conversation was rewritten');

  // And the next send, once the transient problem is gone, just works.
  const after = chat.appendMessage('unreadablenow', 'casey', {
    text: 'after it cleared', delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(after.recorded, true);
  assert.deepEqual(chat.readThread('unreadablenow', 'casey').messages.map((m) => m.text),
    ['one', 'two', 'three', 'after it cleared'], 'the history did not survive the transient failure');
});

test('the RECORD is the cleaned text, so the thread shows what was typed, not what was posted', () => {
  // Round 14: replacing cleanMessage with raw String() in appendLocked left
  // the suite green. The module's contract is that what was CHECKED is what
  // gets TYPED -- and the record has to carry the same text, or the thread
  // on screen shows something different from what reached the agent.
  const got = chat.appendMessage('cleanrecord', 'casey', {
    text: '  spaced\n\nand   broken  ', delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(got.recorded, true);
  const back = chat.readThread('cleanrecord', 'casey').messages[0].text;
  assert.equal(back, chat.cleanMessage('  spaced\n\nand   broken  '),
    'the recorded text must be the cleaned form the send path checked');
  assert.ok(!/\n|  /.test(back), 'control: cleaning really changed this input');
});

test('appendMessage NEVER throws, even when the entry itself throws mid-write', () => {
  // The never-throws contract is the whole reason the try/catch around
  // withThreadLock exists: a throw escaping to the route's 400 handler
  // reports a DELIVERED message as a failed send. Round 14 removed the
  // wrapper and the suite stayed green, because nothing ever made the locked
  // section throw. A poisoned entry does, deterministically.
  const poisoned = {
    get text() { throw new Error('boom from inside the lock'); },
    delivery: { state: chat.DELIVERY.PLACED },
  };
  let got;
  assert.doesNotThrow(() => { got = chat.appendMessage('poisoned', 'casey', poisoned); });
  assert.equal(got.recorded, false, 'a failed write is reported, never raised');
  assert.ok(got.because, 'and it says so in a sentence');
});

test('a project id up to 128 characters records, because ids that long are already on disks', () => {
  // Round 14: tightening PROJECT_ID to {1,64} left the suite green, while
  // the plan records the raised bound as one of the two halves of the
  // silent-no-record fix (projects.js MAX_ID is the other). Pinned at the
  // boundary, with the control just past it.
  const long = 'p'.repeat(128);
  assert.equal(chat.appendMessage(long, 'casey', {
    text: 'long id', delivery: { state: chat.DELIVERY.PLACED },
  }).recorded, true, 'a 128-char id must file');
  const over = chat.appendMessage('p'.repeat(129), 'casey', {
    text: 'too long', delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(over.recorded, false, 'control: the bound itself still exists');
});

test('a SECOND damaged file in one process is set aside too, not refused forever', () => {
  /**
   * ⚠️ THE LOCKOUT REOPENED ONE OCCURRENCE LATER. A damaged file has no
   * `projectBornAt` to read (it will not parse), so the aside name fell back to
   * the literal `earlier` — making `<file>.earlier.<pid>.damaged` a CONSTANT for
   * one project+agent inside one server process. The first damage moved aside
   * fine; the second computed the identical path, hit the existsSync guard, and
   * answered recorded:false for good. The fix for W-corrupt-lockout had a
   * lockout in it.
   */
  const file = chat.threadFile('twicedamaged', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const asides = () => fs.readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(path.basename(file)) && f.endsWith('.damaged'));

  fs.writeFileSync(file, '{ damaged the first time');
  const first = chat.appendMessage('twicedamaged', 'casey', {
    text: 'after the first damage', delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(first.recorded, true, 'the control: the first damage is handled');
  assert.equal(asides().length, 1);

  fs.writeFileSync(file, '{ damaged the second time');
  const second = chat.appendMessage('twicedamaged', 'casey', {
    text: 'after the second damage', delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal(second.recorded, true, 'a second damage locked the conversation out for good');
  assert.match(second.supersededBecause, /damaged file was set aside/);

  // ⚠️ TWO DISTINCT ASIDES on disk: neither damaged file was overwritten by the
  // other, which is the whole reason the name has to be unique.
  const kept = asides();
  assert.equal(kept.length, 2, `expected two asides, saw ${JSON.stringify(kept)}`);
  const contents = kept.map((f) => fs.readFileSync(path.join(path.dirname(file), f), 'utf8')).sort();
  assert.deepEqual(contents, ['{ damaged the first time', '{ damaged the second time']);
  assert.deepEqual(chat.readThread('twicedamaged', 'casey').messages.map((m) => m.text),
    ['after the second damage']);
});

test('two asides in the SAME millisecond both keep the kind as the last segment', () => {
  /**
   * ⚠️ The test above only meets this case when its two damages land inside one
   * millisecond, which real runs did about one time in eight — an intermittent
   * red is how the defect was found. Pinning Date.now makes the collision
   * happen every run: with the counter appended AFTER the kind the second
   * aside was named `….damaged.2`, the kind stopped being readable off the end
   * of the name, and the suffix filter above counted one aside instead of two.
   */
  const file = chat.threadFile('samemillisecond', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const asides = () => fs.readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(path.basename(file)) && f.endsWith('.damaged'));

  const realNow = Date.now;
  /* ⚠️ Frozen WITH A WATCHDOG (round 40). withThreadLock derives both its
     2s give-up deadline and its stale-lock age from this same clock, so a
     plain constant made the deadline unexpirable: if a lock directory ever
     leaked into this path, the suite would HANG here rather than fail.
     After 10 real seconds the mock hands back the real clock, so the
     deadline expires and this test fails with a lock error instead of
     wedging the run. The normal path completes in milliseconds and never
     sees the switch, so the same-millisecond aside collision this test
     exists to force is unaffected. */
  const frozeAt = realNow();
  Date.now = () => (realNow() - frozeAt > 10000 ? realNow() : 1755178800000);
  try {
    fs.writeFileSync(file, '{ damaged the first time');
    assert.equal(chat.appendMessage('samemillisecond', 'casey', {
      text: 'one', delivery: { state: chat.DELIVERY.PLACED },
    }).recorded, true, 'the control: the first damage is handled');
    fs.writeFileSync(file, '{ damaged the second time');
    assert.equal(chat.appendMessage('samemillisecond', 'casey', {
      text: 'two', delivery: { state: chat.DELIVERY.PLACED },
    }).recorded, true, 'the same-millisecond second damage was refused');
  } finally {
    Date.now = realNow;
  }

  const kept = asides();
  assert.equal(kept.length, 2, `expected two same-millisecond asides ending in .damaged, saw ${JSON.stringify(kept)}`);
  assert.ok(kept.some((f) => /\.2\.damaged$/.test(f)),
    `the collided aside must carry its counter BEFORE the kind, saw ${JSON.stringify(kept)}`);
});

test('a supersede that cannot move a DAMAGED file says so, rather than blaming a project name', () => {
  // Both failure returns used to say "an earlier project's messages" whatever
  // they had been asked to move — sending somebody to look for a project they
  // never made.
  const file = chat.threadFile('damagedmovefail', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ damaged');

  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith('.damaged')) throw new Error('EPERM: operation not permitted');
    return realRename(from, to);
  };
  try {
    const kept = chat.appendMessage('damagedmovefail', 'casey', {
      text: 'while it cannot be moved', delivery: { state: chat.DELIVERY.PLACED },
    });
    assert.equal(kept.recorded, false);
    assert.match(kept.because, /could not move the damaged file aside/);
    assert.ok(!/earlier project/.test(kept.because),
      `a damaged file was reported as a project-name clash: ${kept.because}`);
  } finally {
    fs.renameSync = realRename;
  }
});

/* ── round-24 coverage: branches that mutation-testing found unheld ──────── */

test('a renamed pane column refuses the send with its own sentence, before tmux is asked anything', () => {
  // ⚠️ This guard fails CLOSED for every send on the machine, which is why
  // it says so instead of silently asking tmux for an empty format string
  // that reads as "no Claude running". Deleting the guard was green
  // (round 24): nothing had ever renamed a column at it.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    chat.resetForTests(); arm([]);
    // The renamed column must be one the verify format actually uses
    // ('claim'), not whatever sits at index 0 -- renaming a bystander
    // column fires nothing, which the first version of this test proved
    // by passing with 'placed'.
    const at = status.PANE_COLUMNS.findIndex((c) => c.key === 'claim');
    assert.ok(at >= 0, 'the claim column must exist for this test to rename it');
    const real = status.PANE_COLUMNS[at];
    status.PANE_COLUMNS[at] = { ...real, key: 'renamed_out_from_under_us' };
    try {
      const out = chat.deliver('casey', 'hi', board.agents);
      assert.equal(out.state, chat.DELIVERY.COULD_NOT);
      assert.match(out.because, /cannot work out how to check its window/);
      // This exit is the verifyAtSend arm, the one paneNote of the three
      // that no other test reaches (round 24: nulling it alone was green
      // until this line).
      assert.equal(out.paneNote, 'it was sitting at its prompt');
    } finally {
      status.PANE_COLUMNS[at] = real;
    }
  });
});

test('an agent whose pane we do not know is refused on BOTH paths, send and screen, with the same sentence', () => {
  // Both "do not know which pane" arms were deletable at green (round 24).
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    chat.resetForTests(); arm([]);
    const blind = board.agents.map((a) => (a.sessionName === 'casey' ? { ...a, target: null } : a));
    const sent = chat.deliver('casey', 'hi', blind);
    assert.equal(sent.state, chat.DELIVERY.COULD_NOT);
    assert.match(sent.because, /cannot tell where this agent is running/);
    // paneNote is null HERE by design: this refusal happens at the
    // addressable gate, before the send was authorised against any card,
    // and a pane claim on an unauthorised refusal would be a note about a
    // pane nobody vetted. The authorised arms' notes are pinned in the
    // column-rename and refused-send tests.
    assert.equal(sent.paneNote, null);
    const seen = chat.viewport('casey', blind);
    assert.equal(seen.text, null);
    assert.match(seen.because, /cannot tell where this agent is running/);
  });
});

test('a send that could NOT be delivered still carries what the agent was doing', () => {
  // All three could_not paneNote fields were nullable at green (round 24),
  // so a failed send could silently stop saying the one thing that tells
  // the person whether re-sending will meet the same wall.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    chat.resetForTests(); arm([refused('no such window')]);
    const out = chat.deliver('casey', 'hi', board.agents);
    assert.equal(out.state, chat.DELIVERY.COULD_NOT);
    assert.equal(out.paneNote, 'it was sitting at its prompt');
  });
});

test('an unwritable chats directory is a reported keeping-failure, never a throw at a delivered message', () => {
  // withThreadLock's non-EEXIST arm holds appendMessage's never-throws
  // contract; replacing it with `throw err` was green (round 24). The
  // contract exists because a throw here reports a DELIVERED message as a
  // failed send.
  // The CHATS directory itself (threadFile's parent -- the store is flat),
  // not a level above it: the first version chmodded the data root while
  // chats/ already existed inside it, so every write still succeeded.
  const root = path.dirname(chat.threadFile('lockdenied', 'casey'));
  fs.mkdirSync(root, { recursive: true });
  fs.chmodSync(root, 0o555);
  try {
    const kept = chat.appendMessage('lockdenied', 'casey', {
      text: 'delivered but unkeepable', delivery: { state: chat.DELIVERY.PLACED },
    });
    assert.equal(kept.recorded, false, 'an unwritable store is a keeping failure, not a crash');
    assert.ok(kept.because, 'and it says why');
  } finally {
    fs.chmodSync(root, 0o755);
  }
});
