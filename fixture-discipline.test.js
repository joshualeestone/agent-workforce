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
// ⚠️ AND THE CONFIG ROOT. `createAgent` now answers Claude Code's trust
// question for the folder it makes, which is a write into ~/.claude.json. A
// blind review measured the cost of leaving this out: 93 entries for temp
// directories, in the operator's own live config, from this suite alone.
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
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

test('the fields chat reads off a card are fields snapshot() really emits', () => {
  /* The chat engine became a card consumer on this branch, and it is the
     ONLY module that types into a live agent's session -- a renamed card
     field here does not mis-render a label, it refuses (or worse,
     mis-verifies) a send. Same tripwire discipline as the projects list
     below (round 40). */
  const READ_BY_CHAT = ['sessionName', 'session', 'isNamedOurs', 'target', 'isAgentPane', 'isAgentSession', 'state'];
  const board = fleet.install([fleet.agent('mara', { state: 'working' })]);
  try {
    const card = board.card('mara');
    for (const field of READ_BY_CHAT) {
      assert.ok(field in card, `chat reads \`${field}\`, and a real card must carry it`);
    }
  } finally {
    board.restore();
  }
});

test('the fields the projects engine reads off a card are fields snapshot() really emits', () => {
  // The seam, stated as the list of fields `engine/projects.js#describe` reads.
  // `role` and `profile` joined when describe() grew profileRole (round 40:
  // the branch widened the seam and the tripwire was not widened with it,
  // which is the one failure this file exists to make loud).
  const READ_BY_PROJECTS = ['sessionName', 'name', 'state', 'because', 'isNamedOurs', 'role', 'profile'];
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
  const PROBE = 'zz-leak-probe';
  assert.throws(
    () => fleet.install([fleet.agent(PROBE, { state: 'working', screen: 'Worked for 1m\n> \n' })]),
    /asked for as “working” and the engine classified it “idle”/,
  );

  // ⚠️ AND IT MUST LEAVE NO STUB BEHIND, or one refused fixture silently
  // poisons every test that runs after it — including the ones that fall
  // through to the real fleet on purpose.
  //
  // ⚠️ TWO EARLIER VERSIONS OF THIS ASSERTION COULD NOT FAIL, which is worth
  // recording because both looked like tests.
  //   1. `Array.isArray(snapshot().agents)` — true in BOTH worlds. A leaked
  //      stub also returns an array, of the leaked fleet.
  //   2. Installing a SECOND fleet and checking the first one's agent is gone —
  //      the second install overwrites the seam, so it reports the same thing
  //      whether or not the first leaked. MEASURED: deleting `restore()` from
  //      `install`'s catch left the suite green.
  // The question is what the engine answers with NOTHING installed, so that is
  // what is asked, and the control below proves the probe name is findable when
  // a stub really is present.
  let leaked;
  try {
    leaked = status.snapshot().agents.some((a) => a.sessionName === PROBE);
  } catch {
    // The real `sh('tmux', …)` path refusing is itself proof no stub answered:
    // a stub would have returned its text and snapshot would not have thrown.
    leaked = false;
  }
  assert.equal(leaked, false,
    'the refused fixture left its panes installed, so every later test is '
    + 'reading a fleet nobody arranged');

  // THE CONTROL: with a stub genuinely installed, that same look DOES find the
  // probe — so the `false` above is the seam being clear, not the look being
  // blind.
  const board = fleet.install([fleet.agent(PROBE, { state: 'idle' })]);
  try {
    assert.equal(status.snapshot().agents.some((a) => a.sessionName === PROBE), true,
      'the control failed: this look cannot see a stub even when one is installed, '
      + 'so the absence asserted above proves nothing');
  } finally {
    board.restore();
  }
});

test('each state this fixture offers really produces that state', () => {
  // The screens are the only invented strings in the fixture. This is what
  // stops them meaning something else after a change to `classify`.
  // ⚠️ Every state `agent()` advertises, including `unknown` — which is not a
  // screen but the absence of one, and is the single most important to pin
  // because it is this product's honest answer and the one a bug turns into
  // something healthy-looking.
  for (const state of ['working', 'needs_you', 'idle', 'rate_limited', 'stopped', 'unknown']) {
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
    assert.throws(() => board.card('nobody'), /has no card for “nobody”/);
    assert.throws(() => board.row('nobody'), /has no roster row for “nobody”/);
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
    /* ⚠️ ONE CONDITION, ONE SENTENCE AGAIN. These briefly said "see" and
       "check" for the same failure, and a reader who hit both routes got two
       sentences for one thing. The adjacent unreadable-answer arms
       (engine/status.js:619 and :1632) were harmonised to a single sentence in the same sweep, which is
       the shape this pair should have had. Still asserted separately, because
       the call is what discriminates them, not the words.

       📌 An earlier version of this comment quoted `snapshot` as saying "what
       IT IS DOING on this computer" and argued at length that its "it" had no
       referent. That sentence had already been fixed in the same branch and
       exists nowhere in the tree; the comment outlived it by two commits and
       contradicted the assertion two lines below it. Same failure as the one
       the comment above this block describes, which is why both are kept. */
    assert.throws(() => status.paneRoster(), /could not see what is running on this computer/);
    assert.throws(() => status.snapshot(), /could not see what is running on this computer/);
  } finally {
    blind.restore();
  }

  const garbled = fleet.unreadable();
  try {
    /* The copy sweep replaced "tmux answered with something we could not read"
       with "we could not make sense of what came back". Same refusal, same
       property: an unreadable answer is not an empty fleet. */
    assert.throws(() => status.paneRoster(), /could not make sense of what came back/);
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

/**
 * ⚠️ DISCOVERED, never listed. The first version hardcoded the three root files
 * and only globbed `engine/`, so a NEW root-level suite would have been outside
 * both lints while the control below still passed — a rule that reads as
 * covering the suite and silently does not cover its newest file. That is the
 * same shape as every defect this file exists for, built into the guard itself.
 *
 * This mirrors `package.json`'s own test glob (`engine/*.test.js *.test.js`), so
 * a file the suite runs is a file the lints scan, by construction.
 */
const TEST_FILES = [
  ...fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.js')),
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
  // And the two the lints most need to be looking at, named, so a discovery
  // change that quietly stopped finding them fails here rather than passing on
  // a shorter list.
  for (const rel of ['server.test.js', 'server.projects.test.js', 'engine/projects.test.js']) {
    assert.ok(TEST_FILES.includes(rel), `${rel} is not being scanned by the lints`);
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
  // ⚠️ THE KEY ALONE, not the key inside a brace on the same line. The first
  // version of this regex required the `{` and the `sessionName` to share a
  // line, so the identical card written across four lines — which is how anyone
  // writes a five-field object — sailed straight through. MEASURED: a planted
  // multi-line card produced zero offenders and the lint reported green. A rule
  // that only catches the formatting nobody uses reads as coverage and is not.
  //
  // `sessionName` with a colon is an object KEY. Reading one is `a.sessionName`
  // and shorthand is `{ sessionName }` — neither has the colon, so neither is a
  // false positive. A leading `.` is excluded for the same reason.
  const KEY = /(^|[^.\w])sessionName\s*:/;

  // ⚠️ THE POSITIVE CONTROL, and without it this whole test is unfalsifiable.
  // The only assertion below is `offenders === []`, which is what a regex that
  // matches NOTHING produces — so anyone "tidying" this pattern into something
  // narrower gets a green suite and no rule. Assert presence before absence:
  // prove the rule fires on a known-bad line, and does not fire on the two
  // shapes that are legitimate.
  assert.ok(KEY.test("  sessionName: 'mara',"), 'the rule stopped matching a hand-built card');
  assert.ok(KEY.test("const c = { sessionName: 'mara', name: 'Mara' };"), 'the rule stopped matching a one-line card');
  assert.ok(!KEY.test('assert.equal(member.sessionName, \'mara\');'), 'the rule now fires on reading a field');
  assert.ok(!KEY.test('const { sessionName } = card;'), 'the rule now fires on shorthand');

  const offenders = [];
  for (const rel of TEST_FILES) {
    if (rel === 'fixture-discipline.test.js') continue;
    read(rel).split('\n').forEach((source, i) => {
      if (KEY.test(source)) offenders.push(`${rel}:${i + 1}`);
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
  //
  // ⚠️ BOTH SPELLINGS OF A TAB, and the first version only caught one. It read
  // `/\\t\d+\.\d+\\t/`, which matches the two SOURCE CHARACTERS `\t` — so a line
  // built with real tab characters, or assembled positionally with
  // `[session, '0.0', cmd, …].join('\t')`, was outside the rule while the
  // comment claimed to enforce "no hand-ordered pane line". That is the same
  // defect the rule exists for, in the rule.
  const PANE_LINE = /(\\t|\t)\d+\.\d+(\\t|\t)/;
  // A positional join is a hand-ordered line whether or not the digits appear
  // on the same source line, so it is refused by construction.
  const POSITIONAL_JOIN = /\.join\((['"])(\\t|\t)\1\)/;

  // The positive controls, for the same reason as the rule above.
  assert.ok(PANE_LINE.test("'zz-discord\\t0.0\\t2.1.212\\t0\\t\\tt'"), 'the escaped-tab rule stopped matching');
  assert.ok(PANE_LINE.test("'zz-discord\t0.0\t2.1.212'"), 'the real-tab rule stopped matching');
  assert.ok(POSITIONAL_JOIN.test("[s, '0.0', cmd].join('\\t')"), 'the positional-join rule stopped matching');
  assert.ok(!PANE_LINE.test("fleet.line({ session: 'zz-discord' })"), 'the rule now fires on the fixture itself');

  const offenders = [];
  for (const rel of TEST_FILES) {
    if (rel === 'fixture-discipline.test.js') continue;
    if (HAND_TYPED_PANE_LINES[rel] === null) continue;
    const hits = read(rel).split('\n')
      .filter((source) => PANE_LINE.test(source) || POSITIONAL_JOIN.test(source)).length;
    const allowed = HAND_TYPED_PANE_LINES[rel] || 0;
    if (hits > allowed) offenders.push(`${rel}: ${hits} hand-typed pane lines, ${allowed} allowed`);
    // ⚠️ The ratchet, and it is currently UNARMED: every entry in
    // `HAND_TYPED_PANE_LINES` is `null` (fully exempt) and `continue`s above, so
    // `allowed` is always 0 and this arm cannot run. Kept rather than deleted
    // because the moment anyone records a numeric allowance — the expected way
    // to land a partial conversion — it becomes the thing that stops the debt
    // being quietly left at a stale number. Said out loud so nobody reads it as
    // an active guard.
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

// ---------------------------------------------------------------------------
// The fourth root
// ---------------------------------------------------------------------------

test('every suite that creates an agent sandboxes CLAUDE CODE’s config too', () => {
  /**
   * 🛑 THIS RULE EXISTS BECAUSE THE SUITE ALREADY DID THE DAMAGE ONCE. When
   * `createAgent` started answering Claude Code's trust question for the folder
   * it makes, one test file was sandboxed and five were not. A blind reviewer
   * measured the result in the operator's own live config: 93 entries keyed to
   * temp directories under /var/folders that had not existed for hours, in a
   * 114KB file holding their account and their MCP servers.
   *
   * 🔑 THE POINT IS NOT THE FIVE FILES, IT IS THE SIXTH. Adding the line to
   * each one by hand fixes today and leaves the trap armed for whoever writes
   * the next suite — which is exactly how three roots came to be sandboxed and
   * a fourth not. So the rule is enforced here rather than remembered.
   *
   * ⚠️ It reads the files as text, and text cannot tell a call from a mention
   * in a comment. That trade is deliberate: a comment naming `createAgent(`
   * makes this test fail LOUDLY and somebody re-words the comment, where the
   * clever version would let a real caller slip through a filter. This file's
   * neighbour tried the filter and it did not work — block comments here have
   * unmarked continuation lines.
   */
  const root = path.join(__dirname);
  const files = [
    ...fs.readdirSync(root).filter((f) => f.endsWith('.test.js')).map((f) => path.join(root, f)),
    ...fs.readdirSync(path.join(root, 'engine')).filter((f) => f.endsWith('.test.js')).map((f) => path.join(root, 'engine', f)),
  ];

  const creators = [];
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/\bcreateAgent\(/.test(src)) continue;
    creators.push(path.relative(root, f));
    if (!src.includes('AGENT_WORKFORCE_CLAUDE_CONFIG')) missing.push(path.relative(root, f));
  }

  /* ⚠️ THE POSITIVE CONTROL, and it is the half that stops this from being a
     check that cannot fail. A rename of `createAgent`, a moved directory or a
     bad glob would leave `creators` empty, `missing` empty, and this test
     green while enforcing nothing at all. */
  assert.ok(creators.length >= 4,
    `only ${creators.length} suites look like they create agents, so this rule is aimed at nothing`);

  assert.deepEqual(missing, [],
    'these suites create agents without sandboxing ~/.claude.json, so running them writes into the operator’s real Claude config');
});
