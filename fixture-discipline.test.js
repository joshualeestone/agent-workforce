'use strict';

/**
 * The fixture is itself code, so it gets tested like code — and the suite gets
 * a rule that keeps the next fixture from going around it.
 *
 * ⚠️ WHAT THIS FILE IS FOR. Rounds five, six and seven of this branch's
 * challenge loop each found a blocker, and each one lived in a TEST rather than
 * in the code under test: a roster carrying fields `paneRoster()` has never
 * returned, a stub on a seam the engine does not read, a value typed into the
 * wrong tab-separated column. `test-support/fleet.js` is the mechanism that
 * makes those unwritable. This file proves the mechanism works, pins the shapes
 * it depends on, and refuses the two ways a future test could route around it.
 *
 *   node --test fixture-discipline.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// ⚠️ SANDBOX FIRST, BEFORE ANY REQUIRE. The fixture writes worker instruction
// files, which are what live agents boot from, and `engine/status` resolves
// that root ONCE at require time.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fixture-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('./test-support/fleet');
const status = require('./engine/status');

test.after(() => {
  fleet.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The shapes, pinned
// ---------------------------------------------------------------------------

/**
 * ⚠️ A TRIPWIRE, not documentation. If a producer's shape changes, this list
 * fails and somebody has to go look at every consumer of it — which is exactly
 * what did not happen when `describe()` was written against a roster that has
 * three fields as though it had six.
 */
const ROSTER_FIELDS = ['sessionName', 'session', 'isNamedOurs'];

test('paneRoster() emits exactly the fields the suite believes it emits', () => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const row = board.row('mara');
    assert.deepEqual(Object.keys(row).sort(), [...ROSTER_FIELDS].sort(),
      'paneRoster’s shape changed. Every gate and every fixture that reads a '
      + 'roster row has to be re-read before this list is updated.');
  } finally {
    board.restore();
  }
});

test('the fields the projects engine reads off a card are fields snapshot() really emits', () => {
  // The seam, stated as the list of fields `engine/projects.js#describe` reads.
  const READ_BY_PROJECTS = ['sessionName', 'name', 'state', 'because', 'isNamedOurs'];
  const board = fleet.install([fleet.agent('mara', { state: 'working' })]);
  try {
    const card = board.card('mara');
    for (const field of READ_BY_PROJECTS) {
      assert.ok(field in card, `describe reads \`${field}\`, and a real card must carry it`);
    }
  } finally {
    board.restore();
  }
});

test('a roster row does NOT carry the three fields whose absence shipped the worst defect', () => {
  const board = fleet.install([fleet.agent('mara', { state: 'working' })]);
  try {
    const row = board.row('mara');
    // ⚠️ THE CONTROL FIRST. "X is absent" proves nothing until the same test has
    // proved X could have been there — a vacuous absence assertion is its own
    // entry in this branch's list of defects.
    assert.equal(row.sessionName, 'mara', 'the control: this really is a roster row');
    const card = board.card('mara');
    assert.equal(card.name, 'mara', 'the control: a CARD does carry a name');
    assert.ok(card.state, 'the control: a CARD does carry a state');

    for (const field of ['name', 'state', 'because']) {
      assert.ok(!(field in row),
        `a roster row grew a \`${field}\`. If that is deliberate, the whole `
        + 'reason describe() was moved onto snapshot().agents needs revisiting.');
    }
  } finally {
    board.restore();
  }
});

// ---------------------------------------------------------------------------
// The mechanism: reading an unemitted field throws
// ---------------------------------------------------------------------------

test('reading a field the producer does not emit throws, naming the producer', () => {
  const board = fleet.install([fleet.agent('mara', { state: 'working' })]);
  try {
    const row = board.row('mara');
    // The control: the fields it DOES emit read normally.
    assert.equal(row.isNamedOurs, true);

    // And the defect, made unwritable. This is literally what `describe()` did
    // for the whole life of this branch, against a value that is `undefined` in
    // production and asserted-upon in tests.
    assert.throws(() => row.name, /paneRoster\(\) does not emit `name`/);
    assert.throws(() => row.state, /does not emit `state`/);
    assert.throws(() => row.because, /does not emit `because`/);
  } finally {
    board.restore();
  }
});

test('the strict wrapper leaves the things the language and the runner need alone', () => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const card = board.card('mara');
    // Spreading, stringifying and comparing must all still work, or the
    // mechanism is unusable and somebody will turn it off.
    assert.equal({ ...card }.sessionName, 'mara');
    assert.equal(JSON.parse(JSON.stringify(card)).sessionName, 'mara');
    assert.ok(String(card));
    assert.doesNotThrow(() => Object.keys(card));
  } finally {
    board.restore();
  }
});

test('a card handed to the code under test carries the strictness with it', () => {
  // ⚠️ THE POINT OF THE WHOLE FILE. It is not that a TEST cannot read a bad
  // field; it is that PRODUCTION CODE reading one off a fixture fails the test
  // on the spot instead of quietly getting `undefined`.
  const board = fleet.install([fleet.agent('mara', { state: 'working' })]);
  try {
    const readsAFieldRosterRowsDoNotHave = (rows) => rows.map((r) => r.name);
    assert.throws(() => readsAFieldRosterRowsDoNotHave(board.roster),
      /does not emit `name`/,
      'production code read an unemitted field off a fixture and nothing failed');
  } finally {
    board.restore();
  }
});

// ---------------------------------------------------------------------------
// The mechanism: the fixture checks its own arrangement
// ---------------------------------------------------------------------------

test('asking for a state the engine does not actually produce is refused', () => {
  // A fixture that means to arrange "an agent asking a question" and arranges
  // `unknown` instead is vacuous — and a permanently-zero "needs you" count
  // survived a whole feature exactly that way.
  assert.throws(
    () => fleet.install([fleet.agent('mara', { state: 'working', screen: 'Worked for 1m\n> \n' })]),
    /asked for as “working” and the engine classified it “idle”/,
  );
  // ⚠️ And it must leave the engine on real tmux afterwards, or one refused
  // fixture silently poisons every test that runs after it.
  const board = status.snapshot();
  assert.ok(Array.isArray(board.agents), 'the refusal left a stub installed');
});

test('each state this fixture offers really produces that state', () => {
  // The screens are the only invented strings in the fixture. This is what
  // stops them meaning something else after a change to `classify`.
  for (const state of ['working', 'needs_you', 'idle', 'rate_limited', 'stopped']) {
    const board = fleet.install([fleet.agent('mara', { state })]);
    try {
      assert.equal(board.card('mara').state, state);
    } finally {
      board.restore();
    }
  }
});

test('a display name is derived by the real reader, not asserted by the fixture', () => {
  const board = fleet.install([
    fleet.agent('claudebot', { displayName: 'Splinter', role: 'Project Manager', state: 'needs_you' }),
  ]);
  try {
    const card = board.card('claudebot');
    assert.equal(card.name, 'Splinter', 'the display name came back from readIdentity');
    assert.equal(card.sessionName, 'claudebot', 'and the machine name is still the machine name');
    assert.equal(card.role, 'Project Manager');
  } finally {
    board.restore();
  }
});

test('a lookup that misses throws rather than handing back undefined', () => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    assert.throws(() => board.card('nobody'), /has no a card for “nobody”/);
    assert.throws(() => board.row('nobody'), /has no a roster row for “nobody”/);
  } finally {
    board.restore();
  }
});

// ---------------------------------------------------------------------------
// The mechanism: columns are named, never counted
// ---------------------------------------------------------------------------

test('a pane title cannot land in the claim column', () => {
  // ⚠️ A REAL MISCOUNT, from `server.test.js`:
  //     'Angel\t0.0\t2.1.212\t0\tunrelated work'
  // — five columns, so "unrelated work" is the CLAIM, not the title it was
  // meant to be. It is harmless only because that string does not equal the
  // session name. Had the fixture said `'angel'` there, a stranger's pane would
  // have read as ours in a test written to prove the opposite.
  const untied = fleet.install([fleet.stranger('angel', { title: 'angel', state: 'idle' })]);
  try {
    assert.equal(untied.row('angel').isNamedOurs, false,
      'a pane title reached the claim column and tied a stranger’s session');
  } finally {
    untied.restore();
  }

  // The control: a real claim, in the claim column, DOES tie it.
  const claimed = fleet.install([fleet.agent('angel', { ours: 'claim', state: 'idle' })]);
  try {
    assert.equal(claimed.row('angel').isNamedOurs, true,
      'the control failed: `ours: "claim"` is not exercising the claim arm at all');
    assert.equal(claimed.card('angel').session, 'angel',
      'a claimed session is named plainly, without the legacy suffix');
  } finally {
    claimed.restore();
  }
});

test('the fixture refuses a pane column it has not been taught to fill', () => {
  const real = status.PANE_COLUMNS;
  try {
    // Simulating the change rather than waiting for it: a column added to the
    // engine must break the fixture loudly, not be silently left empty.
    Object.defineProperty(status, 'PANE_COLUMNS', {
      value: [...real, { key: 'somethingNew', fmt: '#{something_new}' }],
      configurable: true,
    });
    assert.throws(() => fleet.line(fleet.agent('mara')),
      /does not know how to fill the pane column `somethingNew`/);
  } finally {
    Object.defineProperty(status, 'PANE_COLUMNS', { value: real, configurable: true });
  }
  // The control: with the real columns back, it builds a line again.
  assert.match(fleet.line(fleet.agent('mara')), /^mara-discord\t0\.0\t/);
});

// ---------------------------------------------------------------------------
// The one root this fixture writes to
// ---------------------------------------------------------------------------

test('writing a worker instruction file is refused outside a sandbox', () => {
  const real = process.env.AGENT_WORKFORCE_WORKERS;
  // The control first: sandboxed, it really does write one.
  const board = fleet.install([fleet.agent('proof', { displayName: 'Proof', state: 'idle' })]);
  try {
    assert.ok(fs.existsSync(path.join(real, 'proof', 'CLAUDE.md')),
      'the control: the fixture is not writing the file at all, so the refusal below proves nothing');
  } finally {
    board.restore();
  }

  try {
    delete process.env.AGENT_WORKFORCE_WORKERS;
    assert.throws(() => fleet.install([fleet.agent('live', { displayName: 'Live', state: 'idle' })]),
      /refuses to write a worker instruction file/);
  } finally {
    process.env.AGENT_WORKFORCE_WORKERS = real;
    fleet.restore();
  }
});

test('the could-not-look fleets are the engine’s real refusals, not empty ones', () => {
  const blind = fleet.blind();
  try {
    // ⚠️ BOTH readers refuse, and a comment in `paneRoster` claimed for three
    // commits that `snapshot` stayed lenient here and that the board therefore
    // painted "0 agents, checked just now". `listPanes` was fixed to throw on
    // no-answer-at-all in the same round the comment was written, so the
    // sentence outlived the behaviour it described. This is the assertion that
    // keeps the pair honest rather than a paragraph asserting it.
    assert.throws(() => status.paneRoster(), /could not ask tmux/);
    assert.throws(() => status.snapshot(), /could not ask tmux/);
  } finally {
    blind.restore();
  }

  const garbled = fleet.unreadable();
  try {
    assert.throws(() => status.paneRoster(), /could not read/);
  } finally {
    garbled.restore();
  }

  const dead = fleet.refuses();
  try {
    assert.throws(() => status.paneRoster(), /not answering/);
  } finally {
    dead.restore();
  }
});

// ---------------------------------------------------------------------------
// The discipline: nothing may route around the fixture
// ---------------------------------------------------------------------------

const TEST_FILES = [
  'server.test.js',
  'server.projects.test.js',
  'fixture-discipline.test.js',
  ...fs.readdirSync(path.join(__dirname, 'engine'))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join('engine', f)),
];

function read(rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

test('the suite has the test files this lint believes it has', () => {
  // ⚠️ The control for the two lints below. A lint that scans an empty list
  // passes forever, and a renamed or added suite file would silently leave the
  // rule unenforced — which is the same shape as every other defect here.
  assert.ok(TEST_FILES.length >= 9, `only ${TEST_FILES.length} test files found`);
  for (const rel of TEST_FILES) {
    assert.ok(fs.existsSync(path.join(__dirname, rel)), `${rel} is listed and missing`);
  }
});

test('no test builds an agent card or a roster row by hand', () => {
  // ⚠️ THE RULE, and it is the whole class in one line: an object literal with
  // a `sessionName` is a hand-written stand-in for something `snapshot()` or
  // `paneRoster()` produces, and a hand-written stand-in is free to carry
  // fields the producer does not emit. Ten of them in one file is how the
  // display name, the needs-you count and every member’s reason shipped dead.
  //
  // Use `test-support/fleet` instead: `fleet.install([...]).agents` gives the
  // real cards, `.roster` the real rows.
  const offenders = [];
  for (const rel of TEST_FILES) {
    if (rel === 'fixture-discipline.test.js') continue;
    read(rel).split('\n').forEach((source, i) => {
      if (/\{[^}]*\bsessionName\s*:/.test(source)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    'these lines hand-build a card or roster row instead of asking '
    + 'test-support/fleet for a real one');
});

/**
 * ⚠️ AN ALLOWLIST THAT MAY ONLY SHRINK.
 *
 * `engine/status.test.js` is the parser's own suite: feeding it raw, truncated
 * and deliberately mangled lines is the job, and routing that through a fixture
 * that builds well-formed lines would delete the tests. It is exempt on
 * purpose and permanently.
 *
 * The counted entries are not exempt, they are UNCONVERTED. The number is
 * pinned so the debt cannot grow quietly, and so that converting a file forces
 * this list to be edited rather than left stale.
 */
const HAND_TYPED_PANE_LINES = {
  'engine/status.test.js': null, // exempt: it tests the parser itself
};

test('no test hand-types a tab-separated pane line', () => {
  // A pane line is recognisable by its `#{window_index}.#{pane_index}` column,
  // which is the same signature `isParseable` keys on. Hand-typing one means
  // maintaining column positions by counting tabs by eye, which has already
  // put a title in the claim column once.
  const PANE_LINE = /\\t\d+\.\d+\\t/;
  const offenders = [];
  for (const rel of TEST_FILES) {
    if (rel === 'fixture-discipline.test.js') continue;
    if (HAND_TYPED_PANE_LINES[rel] === null) continue;
    const hits = read(rel).split('\n').filter((source) => PANE_LINE.test(source)).length;
    const allowed = HAND_TYPED_PANE_LINES[rel] || 0;
    if (hits > allowed) offenders.push(`${rel}: ${hits} hand-typed pane lines, ${allowed} allowed`);
    if (hits < allowed) {
      offenders.push(
        `${rel}: ${hits} hand-typed pane lines but ${allowed} are still allowed for. `
        + 'Lower the number in HAND_TYPED_PANE_LINES — an allowance nobody uses is '
        + 'room for the next one to reappear unnoticed.',
      );
    }
  }
  assert.deepEqual(offenders, [],
    'use test-support/fleet, which builds lines from PANE_COLUMNS by name');
});
