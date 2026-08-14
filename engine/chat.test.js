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

const test = require('node:test');
const assert = require('node:assert');

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

/** Records every tmux call and answers however the test says. */
function fakeTmux(answers) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    return answers.length ? answers.shift() : { ran: true, status: 0, out: '', err: '' };
  };
  fn.calls = calls;
  return fn;
}

function ok(out) { return { ran: true, status: 0, out: out || '', err: '' }; }
function refused(err) { return { ran: true, status: 1, out: '', err: err || 'no' }; }

/** Arm the seam with a scripted tmux, the only way this suite may "send". */
function arm(answers) {
  const tmux = fakeTmux(answers);
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
  assert.equal(tmux.calls.length, 0, 'nothing may be typed on the strength of a look that failed');
});

test('a session that is not marked ours is refused: a stranger’s `tmux new -s casey` is not this agent', () => {
  withFleet([fleet.stranger('casey', { state: 'needs_you' })], (board) => {
    const tmux = arm([]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /cannot tell that it is this agent/);
    assert.equal(tmux.calls.length, 0);
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
    assert.equal(tmux.calls.length, 0);
  });
});

test('a pane with no Claude in it is refused, because text sent to a shell is RUN', () => {
  withFleet([fleet.agent('casey', { state: 'stopped' })], (board) => {
    const tmux = arm([]);
    const verdict = chat.deliver('casey', 'rm the old build', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /run as a command instead of read/);
    assert.equal(tmux.calls.length, 0);
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
    assert.equal(tmux.calls.length, 0);
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
    assert.deepEqual(tmux.calls[0], ['send-keys', '-t', target, '-l', '--', 'have a look at the lease']);
    assert.deepEqual(tmux.calls[1], ['send-keys', '-t', target, 'Enter']);
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
    assert.equal(tmux.calls[0][5], 'two lines');
  });
});

test('`--` ends option parsing, so a message starting with a dash is typed rather than read as flags', () => {
  // Measured with `-echo dashy-probe-text`, which landed verbatim in a real
  // pane's composer.
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()]);
    const verdict = chat.deliver('casey', '-n is what broke it', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.PLACED);
    assert.equal(tmux.calls[0][4], '--');
    assert.equal(tmux.calls[0][5], '-n is what broke it');
  });
});

test('tmux refusing the text is a could_not that carries what tmux said', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([refused("can't find pane: =casey-discord:0.0")]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /could not type it into its window/);
    assert.match(verdict.because, /can't find pane/);
    assert.equal(tmux.calls.length, 1, 'Enter is not pressed after the text failed to land');
  });
});

test('text that landed but could not be SUBMITTED gets its own sentence, because something of theirs is on that screen', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    arm([ok(), refused('no current session')]);
    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /sitting there unsent/);
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
    assert.match(verdict.because, /without permission to type/);
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
    assert.equal(chat.deliver('casey', 'hello', board.agents).state, chat.DELIVERY.COULD_NOT);
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
    assert.equal(tmux.calls.length, 0, 'we do not even capture a pane we cannot tie to the name');
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
  for (const bad of ['../../etc', 'a/b', 'Lease', 'has space', '', 'x'.repeat(81), '.']) {
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
  assert.throws(() => chat.readThread('damaged', 'casey'), (err) => err.code === 'UNREADABLE');
  // And the shape is checked too: a file that parses but is not a thread must
  // not read as "you have said nothing to this agent".
  fs.writeFileSync(file, JSON.stringify({ agent: 'casey' }));
  assert.throws(() => chat.readThread('damaged', 'casey'), (err) => err.code === 'UNREADABLE');
});

test('a thread filed under a different agent is refused rather than rendered as this one’s', () => {
  const file = chat.threadFile('mixed', 'casey');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ project: 'mixed', agent: 'mara', messages: [{ text: 'not casey’s' }] }));
  assert.throws(() => chat.readThread('mixed', 'casey'), (err) => err.code === 'UNREADABLE');
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
    assert.equal(tmux.calls.length, 0);
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
