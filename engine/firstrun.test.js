'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ Sandbox both roots BEFORE requiring: this module reads the data dir at
// load, and the subscription check reads the operator's real Claude account.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'firstrun-test-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const firstrun = require('./firstrun');
const status = require('./status');
const fleet = require('../test-support/fleet');

// ⚠️ Columns NAMED, not counted. This was a hand-typed tab-separated line, which
// is the shape that already put a pane TITLE in the CLAIM column elsewhere in
// this suite -- one string away from tying a session the test meant to be
// untied. `fleet.line` builds it from `PANE_COLUMNS` by key, so a reordered or
// added column moves every fixture at once and none can address a column by
// accident. `fixture-discipline.test.js` enforces it.
const pane = (name) => fleet.line({ session: name, claim: name, title: '✳ Claude Code' });

test.afterEach(() => {
  status.setPaneSource(null);
  try { fs.rmSync(firstrun.FLAG, { force: true }); } catch { /* fine */ }
});

test('a machine that already has agents is offered the adopt path, not "create your first"', () => {
  status.setPaneSource(() => [pane('alpha'), pane('beta')].join('\n'));
  const s = firstrun.state();
  assert.equal(s.path, 'adopt', 'somebody with a running fleet was told to create their first agent');
  assert.equal(s.fleetCount, 2);
  assert.equal(s.done, false);
});

test('an empty machine is offered create', () => {
  status.setPaneSource(() => '');
  const s = firstrun.state();
  assert.equal(s.path, 'create');
  assert.equal(s.fleetCount, 0);
});

test('a tmux we cannot ask is NOT an empty machine', () => {
  /**
   * ⚠️ The confusion this whole codebase is built against, at the one moment it
   * decides which product somebody sees. An unreachable tmux routed to "create
   * your first agent" would tell a person with thirteen running agents that
   * they have none — and the screen would look completely normal.
   */
  status.setPaneSource(() => { throw new Error('tmux is not answering'); });
  const s = firstrun.state();
  assert.equal(s.path, 'unknown', 'an unreachable tmux was read as an empty machine');
  assert.equal(s.fleetKnown, false, 'the screen has no way to say why it is not offering the fork');
  assert.equal(s.fleetCount, null, 'it invented a count it could not measure');
});

test('completing first run is remembered, and is what stops it showing again', () => {
  status.setPaneSource(() => '');
  assert.equal(firstrun.state().done, false);
  assert.equal(firstrun.complete(), true, 'completing first run did not stick');
  assert.equal(firstrun.state().done, true);
});

test('a flag we cannot read counts as DONE, deliberately', () => {
  /**
   * ⚠️ Asymmetric on purpose, and the opposite of how this module treats the
   * fleet. Not knowing whether somebody has been here before is a coin flip;
   * the two wrong answers are not. Failing to show onboarding once is a small
   * loss. Showing onboarding OVER somebody's working board, every launch, is
   * the product looking broken.
   */
  status.setPaneSource(() => '');
  fs.mkdirSync(nodePath.dirname(firstrun.FLAG), { recursive: true });
  fs.rmSync(firstrun.FLAG, { force: true });
  fs.mkdirSync(firstrun.FLAG);          // a directory where the file goes
  try {
    // ⚠️ CONTROL: it really is unreadable, or this asserts nothing.
    assert.throws(() => fs.readFileSync(firstrun.FLAG, 'utf8'),
      'the flag is still readable, so the branch under test never runs');
    const s = firstrun.seen();
    assert.equal(s.known, false, 'it claimed to know something it could not read');
    assert.equal(s.done, true, 'an unreadable flag would re-run onboarding over a working board');
  } finally {
    fs.rmSync(firstrun.FLAG, { recursive: true, force: true });
  }
});

test('the subscription answer is carried through, not re-derived by the screen', () => {
  // One place decides, so the screen cannot disagree with the engine about
  // whether somebody is connected -- the defect the instruction editor shipped.
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG,
    JSON.stringify({ hasAvailableSubscription: false, oauthAccount: { organizationType: 'claude_max' } }), 'utf8');
  status.setPaneSource(() => '');
  const s = firstrun.state();
  assert.equal(s.subscription.state, 'connected');
  assert.equal(s.subscription.plan, 'Claude Max');
});

test('the agents it found are named the way the board names them', () => {
  /**
   * ⚠️ This came back as `[null, null, null, null]` on first run of the route:
   * `paneRoster` cards carry `sessionName`, not a display name. The screen
   * would have said "We found 4 agents" over four blank rows, and the route
   * answered 200 throughout.
   *
   * The whole point of that screen is somebody recognising their own fleet.
   * A count with no names is the version of it that proves nothing.
   */
  const fs2 = require('node:fs');
  const create = require('./create');
  fs2.mkdirSync(create.workerDir('namedagent'), { recursive: true });
  fs2.writeFileSync(nodePath.join(create.workerDir('namedagent'), 'CLAUDE.md'),
    'You are **Marcie**, a bookkeeper.\n', 'utf8');
  status.setPaneSource(() => [pane('namedagent'), pane('unnamedagent')].join('\n'));

  const s = firstrun.state();
  assert.equal(s.fleetCount, 2);
  // ⚠️ Names are NOT on the wire (the fleet screen shows the count only,
  // Josh's ruling for the 600-agent case) -- a field nothing reads must not
  // quietly return.
  assert.equal('fleetNames' in s, false, 'the pruned names field came back');
  // The name derivation itself still holds its hygiene: fleet() keeps
  // serving names for callers that need them, no blanks, real names read
  // from the instruction file, a nameless agent falls back to its slug.
  const here = firstrun.fleet();
  assert.ok(here.names.every((n) => typeof n === 'string' && n.length),
    `a caller would get blanks: ${JSON.stringify(here.names)}`);
  assert.ok(here.names.includes('Marcie'),
    'an agent with a real name is not derivable, so no caller can show it');
  assert.ok(here.names.includes('unnamedagent'));
});
