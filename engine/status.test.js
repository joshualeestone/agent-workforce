'use strict';

/**
 * Tests for the status engine.
 *
 * Every case here pins a bug that actually shipped. The engine produced three
 * confidently wrong answers on its first day, and each was wrong in the same
 * direction: it reported something plausible instead of admitting it did not
 * know. These tests exist to stop that specific failure returning.
 *
 * Node's built-in runner, no dependencies:  node --test engine/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classify,
  modelDisplayName,
  readIdentity,
  isAgentPane,
  isAgentSession,
  isFleetSession,
  parsePanes,
  onePanePerSession,
  setPaneSource,
  setPaneCapture,
  snapshot,
  PANE_FORMAT,
  PANE_COLUMNS,
  STATE,
  CONFIDENCE,
  CONTEXT_LIMITS,
} = require('./status');

// A pane as the engine sees it. `command` is a version string when Claude Code
// is running and a shell name when it is not.
const pane = (over = {}) => ({ name: 'test', target: 'test:0.0', command: '2.1.222', title: '', ...over });

// ---------------------------------------------------------------------------
// The rule the whole engine exists to enforce
// ---------------------------------------------------------------------------

test('an unreadable pane is unknown, never something healthy', () => {
  const r = classify(pane(), null);
  assert.equal(r.state, STATE.UNKNOWN);
  assert.equal(r.confidence, CONFIDENCE.NONE);
});

test('a pane saying nothing recognisable is unknown, not idle', () => {
  // The dangerous default. "Nothing matched" must not fall through to a benign
  // state -- idle and unreadable look identical and mean opposite things.
  const r = classify(pane(), 'some output that matches no rule at all\n');
  assert.equal(r.state, STATE.UNKNOWN);
  assert.notEqual(r.state, STATE.IDLE);
});

test('every classification explains itself', () => {
  for (const text of [null, '', 'Worked for 1m 2s', 'Do you want to proceed?']) {
    const r = classify(pane(), text);
    assert.ok(r.because && r.because.length > 0, `no reason given for ${JSON.stringify(text)}`);
    assert.ok(Object.values(CONFIDENCE).includes(r.confidence));
  }
});

// ---------------------------------------------------------------------------
// State detection
// ---------------------------------------------------------------------------

test('a shell in the pane means stopped, and that is structurally known', () => {
  const r = classify(pane({ command: 'zsh' }), 'anything');
  assert.equal(r.state, STATE.STOPPED);
  assert.equal(r.confidence, CONFIDENCE.STRUCTURED);
});

test('a version string in the pane is not mistaken for a shell', () => {
  // pane_current_command reports "2.1.222" while Claude Code runs. Treating an
  // unrecognised command as "not running" would report the whole fleet stopped.
  const r = classify(pane({ command: '2.1.222' }), 'Worked for 1m 2s');
  assert.notEqual(r.state, STATE.STOPPED);
});

test('a waiting question outranks a finished-work line', () => {
  // Panes often contain both. "Needs you" must win: a blocked agent shown as
  // idle is the single most expensive misread in the product.
  const text = 'Worked for 2m 10s\nDo you want to proceed?\n';
  assert.equal(classify(pane(), text).state, STATE.NEEDS_YOU);
});

test('a usage limit outranks everything else', () => {
  const text = 'Do you want to proceed?\nusage limit reached, try again later\n';
  assert.equal(classify(pane(), text).state, STATE.RATE_LIMITED);
});

test('scraped states are labelled scraped, never structured', () => {
  // Terminal text can be stale, truncated or reformatted. Anything read off a
  // pane must carry the weaker confidence so the UI can decline to trust it.
  const r = classify(pane(), 'Worked for 1m 2s\n');
  assert.equal(r.confidence, CONFIDENCE.SCRAPED);
});

// ---------------------------------------------------------------------------
// Context limits -- the bug that shipped
// ---------------------------------------------------------------------------

test('no context limit is invented for a model we have not measured', () => {
  // The original code hardcoded 200,000, inferred from the largest number seen
  // at the time. The real window is 1,000,000, and a ring calibrated to the
  // wrong figure put a real agent at 406%.
  for (const model of Object.keys(CONTEXT_LIMITS)) {
    assert.equal(CONTEXT_LIMITS[model], 1000000,
      `${model} has a limit that is not the evidenced 1M figure`);
  }
});

test('limits are per-model, not a single global constant', () => {
  // A Haiku agent genuinely has a 200k window. One global number would be
  // wrong in the other direction.
  assert.equal(typeof CONTEXT_LIMITS, 'object');
  assert.ok(!Object.values(CONTEXT_LIMITS).includes(200000),
    '200000 is back as a hardcoded limit');
});

// ---------------------------------------------------------------------------
// Model names
// ---------------------------------------------------------------------------

test('version numbers are not split into words', () => {
  // A dash-to-space transform reads fine on claude-opus-5 and then ships
  // "Haiku 4 5" -- the last two segments are a decimal, not two words.
  assert.equal(modelDisplayName('claude-haiku-4-5'), 'Claude Haiku 4.5');
  assert.equal(modelDisplayName('claude-opus-4-8'), 'Claude Opus 4.8');
});

test('a dated model id resolves to the same display name', () => {
  assert.equal(modelDisplayName('claude-haiku-4-5-20251001'), 'Claude Haiku 4.5');
});

test('an unrecognised model renders raw rather than guessed', () => {
  // New models ship often. An unfamiliar accurate name beats a confident
  // wrong one -- the same rule the status board follows.
  assert.equal(modelDisplayName('claude-something-new-9'), 'claude-something-new-9');
  assert.equal(modelDisplayName(null), null);
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('an agent whose name cannot be derived is flagged, not invented', () => {
  const id = readIdentity('no-such-agent-anywhere');
  assert.equal(id.displayName, 'no-such-agent-anywhere');
  assert.equal(id.derived, false);
});

test('claudebot resolves to Splinter via explicit override', () => {
  // Five identifiers for one agent and none of them is "splinter". Deriving
  // from any single layer gives a confident wrong answer -- the config dir
  // alone would name it "discord".
  const id = readIdentity('claudebot');
  assert.equal(id.displayName, 'Splinter');
  assert.equal(id.derived, true);
});

// ---------------------------------------------------------------------------
// The roster: what tmux told us, and what we decided it meant
// ---------------------------------------------------------------------------

test('the pane format and the pane parser cannot drift apart', () => {
  // ⚠️ These were two separate literals — a format string and a positional
  // destructure — with nothing tying them together. Deleting `#{pane_in_mode}`
  // from the format, or reordering any column, left the entire suite green
  // while `inMode` silently held the pane TITLE. `inMode !== '1'` is then true
  // for every pane, so every copy-mode pane classifies as typeable: the exact
  // case the clause exists to refuse, switched off by an edit nowhere near it.
  //
  // They are one list now. This asserts the property that makes that true.
  assert.equal(PANE_FORMAT, PANE_COLUMNS.map((c) => c.fmt).join('\t'));
  assert.ok(PANE_FORMAT.includes('#{pane_in_mode}'), 'copy-mode is no longer being asked for');

  // Round-trip a line built from the format's own column order.
  const line = ['zeta-discord', '0.0', '2.1.212', '0', 'Idle'].join('\t');
  const [got] = parsePanes(line);
  assert.equal(got.session, 'zeta-discord');
  assert.equal(got.name, 'zeta');
  assert.equal(got.target, 'zeta-discord:0.0');
  assert.equal(got.command, '2.1.212');
  assert.equal(got.inMode, '0');
  assert.equal(got.title, 'Idle');
});

test('a pane title containing a tab does not shift every other column', () => {
  // `pane_title` is the one field that can carry a tab, which is why it is last
  // and absorbs the remainder. If it were not, a title with a tab would push
  // real values into the wrong fields — and the field it would corrupt first is
  // whichever came after it.
  const line = ['yara-discord', '1.2', 'node', '1', 'Working\ton\tthe thing'].join('\t');
  const [got] = parsePanes(line);
  assert.equal(got.command, 'node');
  assert.equal(got.inMode, '1');
  assert.equal(got.title, 'Working\ton\tthe thing');
});

test('a truncated pane line is treated as in copy-mode, not as safe to type into', () => {
  // ⚠️ The default for a missing `inMode` is '1' (in copy-mode), not '0'.
  // Defaulting to '0' reads as "not in copy mode, safe to type" — asserting the
  // SAFE answer from an absence of information, which is the one move this
  // engine exists to refuse. Flipping the default to '0' fails this test.
  const [got] = parsePanes('zeta-discord\t0.0\t2.1.212');
  assert.equal(got.inMode, '1');
  assert.equal(isAgentPane(got), false, 'a truncated line was ruled typeable');

  // It is still recognisably one of our agent sessions, so restart — which
  // sends no keystrokes — is not taken away by a short line.
  assert.equal(isAgentSession(got), true);
});

test('no output and empty output both yield an empty roster, not a crash', () => {
  // `sh` returns null when tmux is missing or times out. A roster that throws
  // here takes down every route, including the ones that only read.
  assert.deepEqual(parsePanes(null), []);
  assert.deepEqual(parsePanes(''), []);
  assert.deepEqual(parsePanes('\n\n'), []);
});

test('a session that merely shares an agent name is not one of our agents', () => {
  // ⚠️ The roster STRIPS the `-discord` suffix but never requires it, so a
  // person running `tmux new -s kappa` for unrelated work appears on the board
  // as an agent named `kappa`. Restart was exempt from every roster check, so
  // that card's Restart button would run `restart-bot.sh kappa` against the
  // real agent of that name. THIS is the accident the suffix test closes, and
  // it is the reason restart is gated on `isFleetSession` rather than nothing.
  const [impostor] = parsePanes('kappa\t0.0\tzsh\t0\t');
  assert.equal(impostor.name, 'kappa', 'the card really does claim to be kappa');
  assert.equal(isFleetSession(impostor), false, 'a session with no suffix passed the restart gate');
  assert.equal(isAgentSession(impostor), false, 'a shell was accepted as an agent session');
  assert.equal(isAgentPane(impostor), false);

  // ⚠️ A shell inside a REAL agent's session is a different case, and the three
  // tiers deliberately answer it differently. It is our session (restart may
  // act: this is what a crashed agent looks like), it is not a running agent,
  // and it must never be typed into.
  const [crashed] = parsePanes('kappa-discord\t0.0\tzsh\t0\t');
  assert.equal(isFleetSession(crashed), true, 'a crashed agent lost its Restart button');
  assert.equal(isAgentSession(crashed), false);
  assert.equal(isAgentPane(crashed), false, 'a shell would have been typed into');
});

test('a split window does not put the same agent on the board twice', () => {
  // ⚠️ `list-panes -a` returns one line per PANE and the roster mapped straight
  // over it, so a `*-discord` session with a split window produced two cards
  // with the same name, the same commitment record and the same `data-fresh`
  // value. Both the card click and the action route resolve an agent with
  // `.find()`, which takes whichever sorted first — so the operator could click
  // the card for one pane and have the keystrokes go to the other.
  const panes = parsePanes([
    'zeta-discord\t0.0\t2.1.212\t0\tWorking',
    'zeta-discord\t0.1\tzsh\t0\t',            // the split, running a shell
    'yara-discord\t0.0\tnode\t0\tIdle',
  ].join('\n'));
  assert.equal(panes.length, 3, 'the parser should still report every pane');

  const roster = onePanePerSession(panes);
  assert.equal(roster.length, 2);
  const names = roster.map((p) => p.name).sort();
  assert.deepEqual(names, ['yara', 'zeta']);

  // ⚠️ And the survivor is the pane actually running Claude, not merely the
  // first one listed. Picking by order would hand the agent's card a shell's
  // target, which `isAgentPane` then refuses — taking the feature away from a
  // perfectly healthy agent because somebody split its window.
  const zeta = roster.find((p) => p.name === 'zeta');
  assert.equal(zeta.target, 'zeta-discord:0.0');
  assert.equal(isAgentPane(zeta), true);
});

test('the agent pane wins even when the shell is listed first', () => {
  // Order-independence, stated separately because the previous test would pass
  // for the wrong reason if the choice were "first wins" and the agent happened
  // to be first.
  const roster = onePanePerSession(parsePanes([
    'zeta-discord\t0.0\tzsh\t0\t',
    'zeta-discord\t0.1\t2.1.212\t0\tWorking',
  ].join('\n')));
  assert.equal(roster.length, 1);
  assert.equal(roster[0].target, 'zeta-discord:0.1', 'the shell was chosen over the agent');
});

test('a session with no agent pane still appears, refused rather than hidden', () => {
  // The board must show a session it cannot vouch for rather than dropping it:
  // an agent that has crashed to a shell is exactly what someone needs to see.
  const roster = onePanePerSession(parsePanes('ghost-discord\t0.0\tzsh\t0\t'));
  assert.equal(roster.length, 1);
  assert.equal(isAgentPane(roster[0]), false);
});

test('snapshot itself never returns the same agent twice', () => {
  // ⚠️ Pins the WIRING, not the helper. `onePanePerSession` had three passing
  // tests and deleting its call from `snapshot()` left every one of them green:
  // each pane on this machine is already its own session, so the duplicate case
  // cannot be arranged against the real board and a test reading it can never
  // fail. That is the defect this whole branch keeps re-finding — the guard
  // covered, its one call site not — so the pane source is injectable and this
  // drives the real `snapshot()`.
  try {
    // ⚠️ Invented names, and the pane capture stubbed too. Driving this against
    // `angel-discord` meant shelling `tmux capture-pane` at a LIVE agent and
    // reading its real instruction file and transcript, in a file that
    // sandboxes neither root. Read-only, so nothing broke; still the wrong
    // shape, and the same "we believed we were sandboxed" assumption this
    // codebase has already been caught by once.
    setPaneSource(() => [
      'zeta-discord\t0.0\t2.1.212\t0\tWorking on something',
      'zeta-discord\t0.1\tzsh\t0\t',
      'zeta-discord\t0.2\tzsh\t0\t',
      'yara-discord\t0.0\tnode\t0\tIdle',
    ].join('\n'));
    setPaneCapture(() => 'Worked for 1m 02s\n> \n');

    const board = snapshot();
    const names = board.agents.map((a) => a.sessionName);
    assert.deepEqual(names.slice().sort(), ['yara', 'zeta']);
    assert.equal(new Set(names).size, names.length, 'the same agent appeared on the board twice');

    // The surviving card points at the pane running Claude, so the action it
    // offers goes where the card says it does.
    const zeta = board.agents.find((a) => a.sessionName === 'zeta');
    assert.equal(zeta.target, 'zeta-discord:0.0');
    assert.equal(zeta.isAgentPane, true);
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('an empty roster is a board with no agents, not a crash', () => {
  try {
    setPaneSource(() => '');
    setPaneCapture(() => '');
    const board = snapshot();
    assert.deepEqual(board.agents, []);
    assert.equal(board.counts.total, 0);
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});
