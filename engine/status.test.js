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
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING `./status`, because it reads these at module load.
//
// Without this, every `snapshot()`, `readIdentity()` and `readProfile()` in this
// file runs against the operator's live `~/work/workers` and the real profile
// store. It was read-only only because every fixture name happened to be
// invented — nothing enforced that, and the last fix for a machine-dependent
// test was to RENAME the fixture rather than to sandbox, which leaves the trap
// armed for the next author who reaches for a real name.
//
// It also makes the gate tests mean something: a fixture can now have real
// seeded data, so an untied pane returning `null` is evidence the gate fired
// rather than evidence the file was never there.
//
// ⚠️ `AGENT_WORKFORCE_DATA` was INERT when this comment first claimed it covered
// the profile and avatar store: `engine/store.js` hardcoded its root and read no
// environment at all, so `readProfile` and `avatarPath` went on reaching the
// operator's real store and three gates stayed unpinned behind assertions that
// looked like they covered them. `store.js` now honours the same variable
// `commitments.js` already did, which is what makes the claim above true.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'status-test-'));
// Remove it when the run ends, so repeated runs cannot pass off a previous
// run's leftovers as this run's fixture — which is how the anti-vacuity check
// below became self-defeating.
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
// ⚠️ And the CLAUDE CONFIG ROOT, which had no seam at all — so seeding a
// registry entry and a transcript meant writing into the operator's real
// `~/.claude`. The suite did exactly that and cleaned up nothing.
process.env.AGENT_WORKFORCE_CONFIG_ROOT = nodePath.join(SANDBOX, 'claude');
/**
 * 🛑 A ROOT THIS FILE DID NOT SANDBOX UNTIL STATUS REACHED IT. `create.js` reads
 * `AGENT_WORKFORCE_LAUNCH` for the LaunchAgents directory, defaulting to the
 * operator's real `~/Library/LaunchAgents`. Nothing in status.js touched it
 * before, so the gap was harmless and invisible — and then `notYetStarted`
 * started asking whether an agent's plist exists, and a fixture writing one
 * would have written it into the real fleet's launchd directory.
 *
 * ⚠️ THE SIBLING ROOTS ABOVE WERE SANDBOXED AFTER A TEST SUITE WROTE INTO A
 * REAL `~/.claude`. This is the same lesson arriving through a door nobody had
 * opened yet: sandbox every root the code CAN reach, not the ones it reaches
 * today.
 */
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launchagents');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

/** Give a name a worker file, so `readIdentity` has something real to find. */
function seedWorker(name, body) {
  const dir = nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), body, 'utf8');
}

/**
 * Give a name a registry entry and an avatar, so the `model`, `context` and
 * `hasAvatar` gates have something to be stopping.
 *
 * ⚠️ Without this, three of the six gates this branch adds could be DELETED with
 * the whole suite green — the fixture had no registry entry and no avatar
 * anywhere, so every `null` the untied card asserted was `null` with the gate
 * gone too. The test carried a comment saying it had been fixed for exactly
 * that reason, which made it worse than an obviously thin test.
 */
function seedRegistryAndAvatar(name) {
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const dir = nodePath.join(root, 'agent-registry');
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, `${name}-discord_0.0.json`);
  fs.writeFileSync(file, JSON.stringify({ session_id: `sess-${name}`, model: 'claude-opus-5' }), 'utf8');

  // ⚠️ The TRANSCRIPT too, because `readModel` and `readContext` read the
  // registry only to resolve a session id and then read the transcript that id
  // names. Seeding the registry alone left both returning null, so the gate
  // still had nothing to stop — the first attempt at fixing this test's vacuity
  // was itself vacuous, for one layer further down.
  const projects = nodePath.join(root, 'projects', 'seeded');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(
    nodePath.join(projects, `sess-${name}.jsonl`),
    JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 1000, output_tokens: 10 } } }) + '\n',
    'utf8',
  );

  const avatars = nodePath.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce', 'avatars');
  fs.mkdirSync(avatars, { recursive: true });
  fs.writeFileSync(nodePath.join(avatars, `${name}.png`), 'not-a-real-png', 'utf8');
  return file;
}
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
  isNamedOurs,
  rank,
  paneOrder,
} = require('./status');

// A pane as the engine sees it. `command` is a version string when Claude Code
// is running and a shell name when it is not.
//
// ⚠️ `session` is REQUIRED and was missing. Every test using this helper means
// "a pane in an agent's own session", and the helper produced an object with no
// session at all — so when `classify` started refusing to scrape a pane it
// cannot tie to an agent, two tests about CRASHED agents began asserting
// `stopped` against a correct `unknown`. The bug was in the fixture's shape,
// not in either.
//
// This is the same failure as a hand-written roster drifting from the engine:
// a helper that omits a field the engine reads silently changes what every test
// built on it is actually testing.
const pane = (over = {}) => ({
  name: 'test',
  session: 'test-discord',
  target: 'test-discord:0.0',
  command: '2.1.222',
  title: '',
  ...over,
});

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

  // ⚠️ Built FROM the column list rather than hardcoded, so adding a column
  // cannot make this test wrong while the product is right. The hardcoded
  // version failed the moment the claim column landed — correctly, but for the
  // wrong reason: it was asserting the column COUNT, not the round-trip.
  const values = { session: 'zeta-discord', pane: '0.0', command: '2.1.212', inMode: '0', claim: '', title: 'Idle' };
  const line = PANE_COLUMNS.map((c) => values[c.key]).join('\t');
  const [got] = parsePanes(line);
  assert.equal(got.session, 'zeta-discord');
  assert.equal(got.name, 'zeta');
  assert.equal(got.target, 'zeta-discord:0.0');
  assert.equal(got.command, '2.1.212');
  assert.equal(got.inMode, '0');
  assert.equal(got.title, 'Idle');

  // ⚠️ And the claim column must come BEFORE the title, or `rest: true`
  // swallows it. Asserting the ORDER, because that is the property that breaks.
  const keys = PANE_COLUMNS.map((c) => c.key);
  assert.ok(keys.indexOf('claim') < keys.indexOf('title'),
    'the claim column sits after the title, which absorbs the remainder, so it '
    + 'will always parse empty and every agent will read as unclaimed');
  assert.equal(keys[keys.length - 1], 'title', 'the rest-column is no longer last');
});

test('a pane title containing a tab does not shift every other column', () => {
  // `pane_title` is the one field that can carry a tab, which is why it is last
  // and absorbs the remainder. If it were not, a title with a tab would push
  // real values into the wrong fields — and the field it would corrupt first is
  // whichever came after it.
  const vals = { session: 'yara-discord', pane: '1.2', command: 'node', inMode: '1', claim: '', title: 'Working\ton\tthe thing' };
  const line = PANE_COLUMNS.map((c) => vals[c.key]).join('\t');
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

test('two sessions that resolve to one agent name collapse to the real agent', () => {
  // ⚠️ The roster strips `-discord` but does not require it, so `kappa` and
  // `kappa-discord` are TWO sessions and ONE name. Deduping by session left
  // both on the board under the same name, and every consumer resolves an agent
  // by `.find()` on that name — so whichever tmux listed first won.
  //
  // The damaging order is the impostor first: the REAL agent's dialog then
  // renders all three options refused with "we are not confident that card is
  // one of your agents", which is both untrue and the exact refusal the
  // three-tier split was introduced to eliminate. The two cards also shared a
  // `data-fresh` value and an SVG element id.
  //
  // Keying the dedupe on `session` instead of `name` fails this.
  const roster = onePanePerSession(parsePanes([
    'kappa\t0.0\tzsh\t0\t',                        // the impostor, listed first
    'kappa-discord\t0.0\t2.1.212\t0\tIdle',        // the real agent
  ].join('\n')));

  assert.equal(roster.length, 1, 'one name produced two cards');
  assert.equal(roster[0].target, 'kappa-discord:0.0', 'the shell won the collision');
  assert.equal(isFleetSession(roster[0]), true,
    'the surviving card would refuse restart for the real agent');
});

test('a CRASHED agent still wins its name against an unrelated session', () => {
  // ⚠️ The regression the name-keyed dedupe introduced, and the case that
  // matters most.
  //
  // Keying on `name` is right (`kappa` and `kappa-discord` are one agent name),
  // but it lets two UNRELATED sessions compete. The ladder then ranked only
  // "is a running agent" — so when a crashed agent (`kappa-discord` fallen back
  // to a shell) met an unrelated `kappa`, neither was running and the winner
  // fell through to pane index, comparing indexes across two sessions that have
  // nothing to do with each other.
  //
  // Measured with the impostor first: the real agent vanished from the board
  // entirely, and the surviving card refused all three actions with "we are not
  // confident that card is one of your agents" — in the crashed-agent case the
  // module calls the single most valuable thing Restart can act on.
  //
  // Removing the `isFleetSession` tier from `rank` fails this.
  for (const order of [
    ['kappa\t0.0\tzsh\t0\t', 'kappa-discord\t0.0\tzsh\t0\t'],
    ['kappa-discord\t0.0\tzsh\t0\t', 'kappa\t0.0\tzsh\t0\t'],
  ]) {
    const roster = onePanePerSession(parsePanes(order.join('\n')));
    assert.equal(roster.length, 1);
    assert.equal(roster[0].target, 'kappa-discord:0.0',
      'an unrelated session took the real agent\'s card, so the agent vanished');
    assert.equal(isFleetSession(roster[0]), true,
      'the surviving card would refuse to restart a crashed agent');
    // It is still not typeable, which is the honest answer for a shell.
    assert.equal(isAgentPane(roster[0]), false);
  }
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

test('an agent that is not a Discord bot is still an agent', () => {
  // ⚠️ The roster used to require `/-discord$/` and nothing else, so a Claude
  // agent in a session called anything else was invisible to every check here:
  // not restartable, not typeable, effectively unmanaged.
  //
  // That is not an inconvenience, it is a contradiction of the product's own
  // second paragraph ("Not Discord as the surface"), and it is why the install
  // instructions grew a Discord developer-portal step. Reinstating the suffix
  // requirement fails this test.
  const [plain] = parsePanes('research\t0.0\t2.1.212\t0\tSummarising');
  assert.equal(isFleetSession(plain), true, 'a Claude agent was rejected for its session name');
  assert.equal(isAgentSession(plain), true);
  assert.equal(isAgentPane(plain), true, 'a real agent could not be typed into');
});

test('a bare node pane is NOT claimed without the session convention', () => {
  // ⚠️ The one command that cannot be trusted on its own. An npm-global Claude
  // install fronts as `node`, and so does every dev server, REPL and build
  // watcher on the machine. Adding `node` to the process arm would make
  // `/clear` typeable into a webpack watcher — the exact hazard these checks
  // exist for — so it is claimed only via the session name.
  const [dev] = parsePanes('devserver\t0.0\tnode\t0\tvite');
  assert.equal(isFleetSession(dev), false, 'a dev server was claimed as an agent');
  assert.equal(isAgentPane(dev), false);

  // With the convention, it is ours: this is what an npm-global install looks
  // like on this fleet.
  const [npmAgent] = parsePanes('writer-discord\t0.0\tnode\t0\tWriting');
  assert.equal(isAgentSession(npmAgent), true);
  assert.equal(isAgentPane(npmAgent), true);
});

test('both arms are load-bearing: neither alone covers the cases', () => {
  // ⚠️ Pins WHY there are two arms rather than one, because each looks
  // redundant next to the other and deleting either passes a casual read.
  //
  // Drop the NAME arm and a crashed agent stops being ours — its pane is a
  // shell, there is no Claude process to see, and restart is the entire reason
  // to care about it.
  const [crashed] = parsePanes('kappa-discord\t0.0\tzsh\t0\t');
  assert.equal(isFleetSession(crashed), true, 'a crashed agent lost its Restart button');
  assert.equal(isAgentSession(crashed), false, 'a shell was reported as a running agent');

  // Drop the PROCESS arm and the Discord coupling comes straight back.
  const [native] = parsePanes('research\t0.0\t2.1.212\t0\tx');
  assert.equal(isFleetSession(native), true);

  // And neither arm claims something that is plainly not ours.
  const [stranger] = parsePanes('kappa\t0.0\tzsh\t0\t');
  assert.equal(isFleetSession(stranger), false);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Two wrong-agent ties introduced by removing the Discord coupling.
 *
 * ⚠️ Both are name collisions where BOTH panes reached the same rank, so the
 * winner fell through to pane index. Every pre-existing collision test used
 * `zsh` for the impostor, which never reaches the tiers that tied — so the
 * suite was green while the dangerous case was untested. The impostor is listed
 * FIRST in each, because that is the order tmux produces and the order in which
 * a tie picks the wrong pane.
 * ────────────────────────────────────────────────────────────────────────── */

test('a name-colliding session that is ITSELF running Claude does not take over the real agent', () => {
  // `tmux new -s mikey` + a Claude session in it. The process arm of
  // `isFleetSession` makes this pane look like an agent, and the real agent is
  // `mikey-discord`. Both strip to the name `mikey`.
  const panes = parsePanes([
    'mikey\t0.0\t2.1.212\t0\t',           // impostor, listed first
    'mikey-discord\t0.0\t2.1.212\t0\t',   // the real agent
  ].join('\n'));
  const kept = onePanePerSession(panes);

  assert.equal(kept.length, 1, 'the two sessions collapse to one agent name');
  assert.equal(
    kept[0].target, 'mikey-discord:0.0',
    'the impostor won the tie, so keystrokes go to a stranger while the '
    + "commitments and the tombstone are the REAL agent's",
  );
});

test('a crashed agent still beats a stranger that is running Claude', () => {
  // The strongest form of the same rule, and the one that says WHY the name
  // outranks the process: `omega-discord` has fallen back to a shell, so there
  // is no Claude in it at all. It is still ours, and restart is the entire
  // reason to care about it. The stranger's Claude is somebody else's.
  const panes = parsePanes([
    'omega\t0.0\t2.1.212\t0\t',   // stranger running Claude, listed first
    'omega-discord\t0.0\t-zsh\t0\t', // ours, crashed
  ].join('\n'));
  const kept = onePanePerSession(panes);

  assert.equal(kept.length, 1);
  assert.equal(
    kept[0].target, 'omega-discord:0.0',
    'a stranger running Claude outranked our own crashed agent — restart would '
    + 'then act on the stranger, and the crashed agent is the case restart exists for',
  );
});

test('inside our own session, a bare `node` pane does not outrank the real Claude pane', () => {
  // `isAgentSession` accepts `node` because an npm-global Claude install fronts
  // as it — but so does a build watcher in a split. Ranking them equal let pane
  // 0.0 win, and `/clear` plus a bare Enter typed into `node` is EXECUTED
  // rather than read as a slash command.
  const panes = parsePanes([
    'zeta-discord\t0.0\tnode\t0\t',      // build watcher in a split, listed first
    'zeta-discord\t0.1\t2.1.212\t0\t',   // the actual agent
  ].join('\n'));
  const kept = onePanePerSession(panes);

  assert.equal(kept.length, 1);
  assert.equal(
    kept[0].target, 'zeta-discord:0.1',
    'a node process outranked the unambiguous Claude pane in the same session',
  );
});

test('an agent that is not a Discord bot is still ranked and still wins its own name', () => {
  // ⚠️ Guards the fix against over-correcting. The point of the process arm was
  // to stop requiring `-discord`; if the rank change quietly re-coupled to it,
  // this fails. A non-Discord agent alone under its name must still be the card.
  const panes = parsePanes('solo\t0.0\t2.1.212\t0\t');
  const kept = onePanePerSession(panes);

  assert.equal(kept.length, 1);
  assert.equal(kept[0].target, 'solo:0.0');
  assert.equal(isFleetSession(kept[0]), true, 'the Discord coupling came back');
  assert.equal(isAgentSession(kept[0]), true);
});

test('a crashed agent is not hidden by an unrelated node pane in its own session', () => {
  // ⚠️ The failure: an agent crashes back to a shell in a session that also
  // runs a build watcher. `node` used to outrank the crashed shell, so the
  // watcher became the card — the board reported "we cannot tell" instead of
  // "not running", hiding the crash on the one card whose Restart button exists
  // for it. And `classify` on a watcher can match an idle marker, at which
  // point `/clear` plus a bare Enter go into a `node` process, which EXECUTES
  // the text rather than reading it as a slash command.
  //
  // The watcher is listed FIRST because that is the order tmux produces and the
  // order in which the old ranking picked wrong.
  const panes = parsePanes([
    'zeta-discord\t0.0\tnode\t0\tbuild finished in 1.2s',
    'zeta-discord\t0.1\t-zsh\t0\t',
  ].join('\n'));
  const kept = onePanePerSession(panes);

  assert.equal(kept.length, 1);
  assert.equal(kept[0].target, 'zeta-discord:0.1',
    'a node pane won the name over the agent’s own crashed shell, so the board '
    + 'shows the watcher’s state instead of the crash');
  assert.equal(isAgentPane(kept[0]), false,
    'the crashed pane classified as typeable, so /clear could be sent into it');
});

test('a live Claude pane still beats both a shell and a node pane', () => {
  // ⚠️ Guards the swap against over-correcting. Reordering the two lower tiers
  // must not let a crashed shell outrank the agent that is actually running.
  const panes = parsePanes([
    'zeta-discord\t0.0\t-zsh\t0\t',
    'zeta-discord\t0.1\tnode\t0\t',
    'zeta-discord\t0.2\t2.1.212\t0\tSummarising',
  ].join('\n'));
  const kept = onePanePerSession(panes);

  assert.equal(kept.length, 1);
  assert.equal(kept[0].target, 'zeta-discord:0.2',
    'the real Claude pane lost to a shell or a watcher in its own session');
  assert.equal(isAgentPane(kept[0]), true);
});

test('a crashed agent is reported stopped, not scraped off whatever replaced it', () => {
  // ⚠️ TWO definitions of "a Claude process is running here" lived here, and the
  // looser one decided what the board asserted. `classify` asked a DENYLIST of
  // six shell names while `isAgentSession` asked an ALLOWLIST — so an editor, a
  // REPL, an ssh session, and `-zsh` (a LOGIN shell, absent from the denylist
  // despite this file using it as the crashed case two tests up) all counted as
  // Claude running.
  //
  // The consequence: a crashed agent whose remaining pane is `vim` won its name
  // in `rank`, and `classify` then read that editor's SCREEN. A buffer holding
  // the word "Worked for" made the card `idle`. "Do you want to proceed" made
  // it `needs_you`. The board reported a healthy state for a dead agent, on the
  // one card whose Restart button exists for that case.
  //
  // The text below is exactly what would have produced a false healthy reading.
  const healthyLooking = 'Worked for 2m 14s\n> \n';

  for (const command of ['vim', '-zsh', 'ssh', 'python3', 'less', 'man']) {
    const r = classify({ ...pane(), command }, healthyLooking);
    assert.equal(r.state, STATE.STOPPED,
      `a pane running ${command} was classified from its screen text instead of `
      + 'being reported as having no Claude in it');
    assert.equal(r.confidence, CONFIDENCE.STRUCTURED);
  }

  // ⚠️ And the npm-global case still reads as running, or this fix would take
  // the feature away from every agent on an npm install.
  for (const command of ['2.1.212', 'node', 'claude']) {
    const r = classify({ ...pane(), command }, healthyLooking);
    assert.notEqual(r.state, STATE.STOPPED,
      `a pane running ${command} was reported stopped, but that is Claude`);
  }
});

test('a pane running literally `claude` is not out-ranked by a shell', () => {
  // ⚠️ The over-correction. Demoting `node` below a crashed shell was right —
  // a build watcher must not hide a crash — but the first version demoted the
  // whole legacy set with it, and `claude` is not ambiguous the way `node` is.
  // Measured then: this exact pair picked the SHELL, so a healthy agent on a
  // legacy install was reported dead and Clear and Compact were refused for it,
  // while `classify` reported the same command as running. One fact, two
  // answers, in the two functions this file had just unified.
  for (const command of ['claude', 'claude.exe']) {
    const panes = parsePanes([
      `zeta-discord\t0.0\t-zsh\t0\t`,
      `zeta-discord\t0.1\t${command}\t0\tSummarising`,
    ].join('\n'));
    const kept = onePanePerSession(panes);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].target, 'zeta-discord:0.1',
      `a shell out-ranked a pane running ${command}, so a live agent reads as dead`);
    assert.equal(isAgentPane(kept[0]), true);
  }

  // ⚠️ And `node` stays demoted, or this fix undoes the one it is correcting.
  const withNode = parsePanes([
    'zeta-discord\t0.0\tnode\t0\tbuild finished',
    'zeta-discord\t0.1\t-zsh\t0\t',
  ].join('\n'));
  assert.equal(onePanePerSession(withNode)[0].target, 'zeta-discord:0.1',
    'node stopped being treated as ambiguous, so a watcher can hide a crash again');
});

// ─────────────────────────────────────────────────────────────────────────────
// The two failures found by splitting this branch out, and four guards that
// were shipping with no test behind them.
// ─────────────────────────────────────────────────────────────────────────────

test('a pane we cannot tie to a name does not borrow that agent’s identity', () => {
  // ⚠️ Measured with the real `claudebot-discord` absent and a stranger's
  // `tmux new -s claudebot` running Claude: the card came back named
  // "Splinter", role "Project Manager", with the REAL agent's model and a 24%
  // context ring at STRUCTURED confidence — all read out of that name's
  // registry file — while the state and target were the stranger's.
  //
  // Publishing `isNamedOurs` and leaving another branch to honour it is not
  // enough: this module is what asserts the identity, so this module has to
  // stop asserting it.
  // ⚠️ The first version of this test named a REAL agent on this machine
  // (`claudebot`), so it only failed where that agent's registry entry and
  // transcript happen to exist. On a clean checkout or in CI the assertions
  // were VACUOUSLY TRUE — the gate they exist to pin was unpinned everywhere it
  // mattered, and the mutation test passed only because this laptop is the
  // machine the fleet runs on. That is the same live-agent-read trap this file
  // condemns twice elsewhere.
  //
  // So: compare an UNTIED pane against a TIED one with the same name shape, in
  // one snapshot. The tied card is the control — if identity reads stop working
  // altogether the control fails, and if the gate is removed the untied card
  // starts matching it. Neither depends on which agents exist here.
  // ⚠️ SEEDED, and this is what makes the assertions below mean anything. The
  // previous version used a name with no worker file anywhere, so `role: null`
  // and `nameDerived: false` were what you got with the gate DELETED too —
  // seven of its eight assertions were vacuous, and it survived mutation only
  // because `readProfile` happens to return `{}` rather than `null`. A test for
  // a gate has to be run against data the gate is stopping it from reading.
  seedWorker('ghostly', 'You are **Ghostly** (Ghostly Bridge), the archive worker.\n');
  const registryFile = seedRegistryAndAvatar('ghostly');

  setPaneSource(() => [
    'ghostly-discord\t0.0\t2.1.212\t0\tthe real one',
    'ghostly\t0.0\t2.1.212\t0\tstranger doing something else',
  ].join('\n'));
  setPaneCapture(() => 'Worked for 2m 14s\n> \n');
  try {
    const agents = snapshot().agents;
    // Both strip to the same NAME, so the roster collapses them and the tied
    // pane must win — that is `rank`, and it is pinned separately.
    const [card] = agents;
    assert.equal(agents.length, 1, 'the two sessions did not collapse to one name');
    assert.equal(card.isNamedOurs, true, 'the tied pane lost its own name to the stranger');
    assert.equal(card.target, 'ghostly-discord:0.0');
    // ⚠️ The CONTROL, and the previous version described one without
    // implementing it. If identity reads stop working altogether, this fails
    // and the untied assertions below stop proving anything on their own.
    assert.equal(card.name, 'Ghostly', 'the tied pane did not read its own worker file');
    assert.equal(card.nameDerived, true);
    assert.equal(card.role, 'archive worker', 'the tied pane read no role');
    // ⚠️ The control has to prove the SEEDED data is reachable, or the untied
    // nulls below still mean nothing. Three gates were unpinned for exactly
    // this reason: their fixture had no registry entry and no avatar, so their
    // nulls were null either way.
    assert.equal(card.hasAvatar, true, 'the seeded avatar was not found, so the hasAvatar gate proves nothing');
    assert.ok(card.model, 'the seeded registry entry was not read, so the model gate proves nothing');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }

  // Now the stranger ALONE, which is the case the gate exists for: the real
  // agent is gone and only the impostor is left to win the name.
  setPaneSource(() => 'ghostly\t0.0\t2.1.212\t0\tstranger doing something else');
  setPaneCapture(() => 'Worked for 2m 14s\n> \n');
  try {
    const [card] = snapshot().agents;
    assert.ok(card, 'the stranger produced no card at all, which is a different bug');
    assert.equal(card.isNamedOurs, false, 'the fixture is not exercising the untied case');
    assert.equal(card.nameDerived, false,
      'an untied pane was given a display name derived from another agent’s files');
    assert.equal(card.role, null, 'an untied pane borrowed the real agent’s role');
    assert.equal(card.model, null, 'an untied pane borrowed the real agent’s model');
    assert.equal(card.modelName, null, 'an untied pane borrowed the real agent’s model name');
    assert.equal(card.context.percent, null,
      'an untied pane borrowed the real agent’s context ring');
    assert.equal(card.context.confidence, CONFIDENCE.NONE,
      'a borrowed context reading was published at real confidence');
    assert.equal(card.hasAvatar, false,
      'an untied pane rendered the real agent’s photograph');
    // ⚠️ `registryFile` exists on disk for this name — that is the point. The
    // gate is what stops it being read, not its absence.
    assert.ok(fs.existsSync(registryFile), 'the fixture stopped seeding, so these nulls are vacuous again');
    assert.equal(card.profile, null,
      'an untied pane carried the real agent’s operator-set profile, which the '
      + 'detail panel prefers over the role field');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a session we know is not ours is never given a healthy state', () => {
  // ⚠️ `classify` consulted only `pane.command`, so a session this engine has
  // explicitly rejected still got a scraped state. Measured: a lone `devserver`
  // running `node` with a confirmation prompt on screen produced
  // `{state:'needs_you'}` and occupied the board's headline needs-you count — a
  // vite dev server rendered as an agent asking for help.
  //
  // This module's one rule, inverted: something we KNOW is not ours, reported
  // as something healthy.
  const notOurs = { name: 'devserver', session: 'devserver', target: 'devserver:0.0', command: 'node', title: 'vite' };

  for (const screen of ['Do you want to proceed? (y/N)\n', 'Worked for 3m 1s\n> \n', 'rate limit reached\n']) {
    const r = classify(notOurs, screen);
    assert.equal(r.state, STATE.UNKNOWN,
      `a pane we do not recognise was classified as ${r.state} from its screen text`);
    assert.equal(r.confidence, CONFIDENCE.NONE);
  }

  // ⚠️ And a pane that IS ours still gets read, or this guard has eaten the
  // feature rather than fixed it.
  const ours = { ...notOurs, session: 'devserver-discord', command: '2.1.212' };
  assert.notEqual(classify(ours, 'Do you want to proceed? (y/N)\n').state, STATE.UNKNOWN);
});

test('an inferred agent with a split window still wins its own name', () => {
  // ⚠️ RANK_INFERRED had no test: replacing it with RANK_NONE left the suite
  // green, while a non-Discord agent with a second pane silently flipped to the
  // shell — reading as stopped and losing Clear and Compact. Every non-suffixed
  // fixture in this file was a single pane or paired against a `-discord`
  // session, so the tier the plan calls tier 3 was unpinned.
  const panes = parsePanes([
    'research\t0.0\t-zsh\t0\t',
    'research\t0.1\t2.1.212\t0\tSummarising',
  ].join('\n'));
  const kept = onePanePerSession(panes);

  assert.equal(kept.length, 1);
  assert.equal(kept[0].target, 'research:0.1',
    'a shell outranked the Claude pane in a non-Discord agent’s own session');
  assert.equal(isAgentPane(kept[0]), true);
});

test('a pane object that never went through the parser is not typeable', () => {
  // ⚠️ `isAgentPane` reads `inMode === '0'` as an ALLOWLIST precisely so a caller
  // holding a hand-built pane cannot get a permissive answer from a missing
  // field. The comment said so and nothing tested it: changing it to
  // `!== '1'` left the suite green.
  assert.equal(isAgentPane({ session: 'x-discord', command: '2.1.212' }), false,
    'a pane with no inMode was treated as safe to type into');
  assert.equal(isAgentPane({ session: 'x-discord', command: '2.1.212', inMode: '0' }), true);
});

test('a same-rank tie is broken by pane order, not by tmux’s listing order', () => {
  // ⚠️ `paneOrder` was entirely unpinned — replacing its body with `return 0`
  // left the suite green, because every collision fixture was decided by `rank`
  // before reaching the tie-break. A tie would then revert to "whatever tmux
  // listed first", which is the arbitrary pick the ladder exists to eliminate.
  assert.equal(paneOrder('0.1') > paneOrder('0.0'), true);
  assert.equal(paneOrder('1.0') > paneOrder('0.9'), true, 'window is not weighted above pane');
  assert.equal(paneOrder('10.0') > paneOrder('9.0'), true, 'window order is lexical, not numeric');

  // Two panes of the SAME rank in one session: both crashed shells.
  const panes = parsePanes([
    'zeta-discord\t0.2\t-zsh\t0\t',
    'zeta-discord\t0.1\t-zsh\t0\t',
  ].join('\n'));
  assert.equal(onePanePerSession(panes)[0].target, 'zeta-discord:0.1',
    'the later pane won a same-rank tie, so the winner depends on tmux’s order');
});

test('isNamedOurs is on the snapshot and means what the consumers think', () => {
  // ⚠️ Deleting the field from the snapshot left the suite green, and it is the
  // field a consumer written as `if (agent.isNamedOurs === false) refuse` reads
  // — so its absence would silently permit everything.
  setPaneSource(() => [
    'zeta-discord\t0.0\t2.1.212\t0\tworking',
    'solo\t0.0\t2.1.212\t0\tworking',
  ].join('\n'));
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const agents = snapshot().agents;
    const tied = agents.find((a) => a.sessionName === 'zeta');
    const inferred = agents.find((a) => a.sessionName === 'solo');
    assert.ok(tied && inferred, 'the fixture did not produce both shapes');
    assert.equal(tied.isNamedOurs, true);
    assert.equal(inferred.isNamedOurs, false);
    assert.equal(isNamedOurs({ session: 'x-discord' }), true, 'the function is not exported or not correct');
    assert.equal(isNamedOurs({ session: 'x' }), false);
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('an untied pane does not unlock the write routes for the name it borrowed', () => {
  // ⚠️ PRE-EXISTING and reachable on main today. `knownAgent` gates every write
  // route on `sessionName`, and the roster publishes an untied pane's raw
  // session name — so with the real `angel-discord` down, a stranger's
  // `tmux new -s angel` made `knownAgent('angel')` true and unlocked
  // `PUT /api/agent/angel/instructions`, which rewrites the CLAUDE.md the real
  // agent boots from. Also the avatar and profile routes, against the real
  // agent's stored data.
  //
  // Pinned here rather than in the server tests because the fact it depends on
  // is this module's: `isNamedOurs` must be on the snapshot and must be false
  // for a pane whose session name does not carry the suffix. Deleting the
  // `isNamedOurs === true` clause in `knownAgent` fails the server-side test;
  // deleting the field here fails this one.
  setPaneSource(() => 'angel\t0.0\t2.1.212\t0\tstranger');
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const [card] = snapshot().agents;
    assert.equal(card.sessionName, 'angel',
      'the untied pane no longer publishes the borrowed name, which changes what '
      + 'knownAgent has to defend against');
    assert.equal(card.isNamedOurs, false,
      'the field knownAgent depends on is missing or wrong, so every write route '
      + 'is open to a session that merely shares an agent’s name');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a truncated tmux line is unknown, not a confident "stopped"', () => {
  // ⚠️ `command` defaulted to '', which reached `classify` as "not a Claude
  // command" and answered `stopped` at STRUCTURED confidence — a confident
  // structural claim about an agent, built from a field that was MISSING. The
  // `inMode` default three lines away explicitly refuses exactly this move, in
  // the same function, which is this codebase's most repeated defect: one fact
  // defended in one of the two places that decide it.
  const [truncated] = parsePanes('zeta-discord\t0.0');
  assert.equal(truncated.command, null, 'a missing command was given a value it did not have');

  const r = classify(truncated, 'Worked for 2m\n> \n');
  assert.equal(r.state, STATE.UNKNOWN,
    'a pane whose command tmux never reported was classified with confidence');
  assert.equal(r.confidence, CONFIDENCE.NONE);
});

test('a non-Discord agent still classifies to a real state', () => {
  // ⚠️ The `classify` gate is pinned in the loosening direction only: tightening
  // it from `isFleetSession` to `isNamedOurs` left every test green while making
  // every non-Discord agent report "this is not one of your agent sessions".
  // That is the coupling this branch exists to remove, reintroduced by a guard
  // added to fix a different problem.
  const research = { name: 'research', session: 'research', target: 'research:0.0', command: '2.1.212', inMode: '0', title: '' };
  const r = classify(research, 'Worked for 2m 14s\n> \n');
  assert.notEqual(r.state, STATE.UNKNOWN,
    'a non-Discord agent running Claude was refused a state, which re-couples '
    + 'the engine to the session-name convention this branch decoupled');
  assert.equal(r.confidence, CONFIDENCE.SCRAPED);
});

// ─────────────────────────────────────────────────────────────────────────────
// The claim: how Kosmos recognises an agent it created itself.
// ─────────────────────────────────────────────────────────────────────────────

test('a session Kosmos claimed is ours, without carrying a Discord name', () => {
  // ⚠️ The whole point. Before the claim, the ONLY evidence a pane belonged to
  // the name it is filed under was a `-discord` suffix — so an agent Kosmos
  // created came back anonymous and unwritable, because it has no reason to
  // carry a naming convention from our dev environment. The gate was right and
  // its only evidence was wrong.
  const claimed = { session: 'casey', name: 'casey', claim: 'casey' };
  assert.equal(isNamedOurs(claimed), true,
    'an agent Kosmos created is still not recognised as its own');

  // And it gets everything a suffixed agent gets.
  setPaneSource(() => 'casey\t0.0\t2.1.212\t0\tcasey\tworking');
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const [card] = snapshot().agents;
    assert.equal(card.isNamedOurs, true, 'the claim did not survive into the snapshot');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a claim naming a DIFFERENT agent does not make a pane ours', () => {
  // ⚠️ Reading "has a claim" as "is ours" would rebuild the borrowed-name hole
  // out of new parts: a session carrying somebody else's claim would speak for
  // a name it has no relationship to. The claim must match the pane's own name.
  assert.equal(isNamedOurs({ session: 'casey', name: 'casey', claim: 'angel' }), false,
    'a pane claiming to be a different agent was treated as that agent');
  assert.equal(isNamedOurs({ session: 'casey', name: 'casey', claim: '' }), false);
  assert.equal(isNamedOurs({ session: 'casey', name: 'casey' }), false,
    'a pane with no claim at all was treated as claimed');
});

test('a stranger opening a session with the same name inherits no claim', () => {
  // ⚠️ The property that makes a tmux session option beat a file on disk: it
  // DIES WITH THE SESSION. Kosmos creates `casey` and claims it; that session
  // ends; someone else runs `tmux new -s casey`. A claims FILE would still be
  // sitting there naming `casey` as ours, and the stranger would inherit it.
  // The option does not survive, so the stranger's pane reports no claim.
  const kosmosMade = { session: 'casey', name: 'casey', claim: 'casey' };
  const strangerLater = { session: 'casey', name: 'casey', claim: '' };

  assert.equal(isNamedOurs(kosmosMade), true);
  assert.equal(isNamedOurs(strangerLater), false,
    'a session that merely reuses the name was treated as the agent Kosmos made');
});

test('the existing Discord fleet keeps working with no claim at all', () => {
  // ⚠️ The legacy arm is not decoration: thirteen agents on this machine carry
  // the suffix and no claim, and none of them may stop being recognised because
  // a new mechanism arrived.
  assert.equal(isNamedOurs({ session: 'angel-discord', name: 'angel', claim: '' }), true,
    'the existing fleet stopped being recognised');
  assert.equal(isNamedOurs({ session: 'angel-discord', name: 'angel' }), true);
});

test('every declared column reaches the parsed pane, not just the ones we remember', () => {
  // ⚠️ `PANE_COLUMNS` was introduced so the tmux format and the parser could not
  // drift apart. The drift moved one step downstream instead: the claim column
  // was declared, parsed into the intermediate object, and then **silently
  // dropped**, because the return statement builds its result by hand.
  //
  // The round-trip test did not catch it — it asserted the fields it already
  // knew about, which is precisely the shape of test that cannot notice a
  // missing one. This asserts the PROPERTY: whatever the column list says,
  // comes out.
  const values = {};
  PANE_COLUMNS.forEach(function (c, i) { values[c.key] = 'v' + i; });
  values.session = 'zeta-discord';
  values.pane = '0.0';

  const line = PANE_COLUMNS.map((c) => values[c.key]).join('\t');
  const [got] = parsePanes(line);

  PANE_COLUMNS.forEach(function (c) {
    assert.ok(c.key in got,
      `the column '${c.key}' is declared in PANE_COLUMNS and never reaches the `
      + 'parsed pane, so everything downstream sees it as absent');
    // ⚠️ And the VALUE, not just the key. Asserting presence alone let a column
    // hardcoded to a constant (`claim: ''` rather than `raw.claim`) pass while
    // dropping what tmux actually said — a narrower version of the very defect
    // this test was written for. `session` and `pane` are excluded because the
    // parser deliberately transforms them (the suffix is stripped, the target
    // is composed), and `command`/`inMode` are normalised.
    if (['session', 'pane', 'command', 'inMode'].includes(c.key)) return;
    assert.equal(got[c.key], values[c.key],
      `the column '${c.key}' reaches the parsed pane as a constant rather than `
      + 'as what tmux reported, so its value is silently dropped');
  });
});

test('an agent with no -discord session gets its model and its memory ring', () => {
  // ⚠️ THE LAST PIECE OF DISCORD COUPLING A USER COULD SEE. The registry entry
  // Claude writes is keyed on the SESSION name; this module reconstructed that
  // name by appending `-discord`, which is right for the existing fleet and
  // wrong for every agent Kosmos creates. Measured on a real agent created
  // through the product: name and role read correctly, then `model unknown` and
  // a dashed memory ring, permanently, with `kosmos-demo_0.0.json` sitting in
  // the registry directory being asked for under a name it does not have.
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const dir = nodePath.join(root, 'agent-registry');
  fs.mkdirSync(dir, { recursive: true });
  const entry = nodePath.join(dir, 'made-here_0.0.json');
  fs.writeFileSync(entry, JSON.stringify({
    session_name: 'made-here',
    session_id: 'sess-made-here',
    cwd: '/somewhere',
  }), 'utf8');

  const projects = nodePath.join(root, 'projects', 'made-here');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(nodePath.join(projects, 'sess-made-here.jsonl'),
    JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 42000 } } }) + '\n', 'utf8');

  // A session with no suffix, carrying Kosmos's claim: exactly what the product
  // creates.
  setPaneSource(() => 'made-here\t0.0\t2.1.227\t0\tmade-here\t✳ Claude Code');
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === 'made-here');
    assert.ok(card, 'the fixture did not produce a card at all');
    assert.equal(card.isNamedOurs, true, 'the claim is not being read, so this tests the wrong thing');
    assert.equal(card.model, 'claude-opus-5',
      'a created agent still shows no model, so its card reads "model unknown" forever');
    assert.ok(card.context.percent !== null,
      'a created agent still has an unknowable memory ring');

    // ⚠️ THE CONTROL. Without the entry those two must go back to null —
    // otherwise they are being satisfied by something other than the fix and
    // the assertions above prove nothing.
    fs.rmSync(entry);
    const blind = snapshot().agents.find((a) => a.sessionName === 'made-here');
    assert.equal(blind.model, null, 'a model appeared with no registry entry to read it from');
    assert.equal(blind.context.percent, null, 'a memory reading appeared from nowhere');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a registry entry naming a different agent is not read for this one', () => {
  // ⚠️ Trying a second filename widened what this resolver will open, so it now
  // checks the entry rather than trusting its name. A file called `borrowed`
  // holding somebody else's session id would otherwise produce confident
  // numbers about the wrong conversation — the precise failure the resolution
  // path was built to avoid, reintroduced by the fix for the previous one.
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const dir = nodePath.join(root, 'agent-registry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'borrowed_0.0.json'), JSON.stringify({
    session_name: 'somebody-else',
    session_id: 'sess-made-here',
  }), 'utf8');

  const projects = nodePath.join(root, 'projects', 'made-here');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(nodePath.join(projects, 'sess-made-here.jsonl'),
    JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 42000 } } }) + '\n', 'utf8');

  setPaneSource(() => 'borrowed\t0.0\t2.1.227\t0\tborrowed\t✳ Claude Code');
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === 'borrowed');
    assert.equal(card.isNamedOurs, true, 'the fixture is not exercising a tied card');
    assert.equal(card.model, null,
      "another agent's transcript was read because the file was named for this one");
    assert.equal(card.context.percent, null, "another agent's memory was reported as this one's");
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('an agent sitting at its prompt is idle, not unreadable', () => {
  // ⚠️ Every other idle marker is a TRACE of something the agent did, and traces
  // scroll away. An agent left at its prompt long enough fell through to
  // `unknown`, so the board said "we cannot see this one, so we are not telling
  // you it is fine" about an agent that was visibly waiting — and that is the
  // card a person lands on straight after creating their first agent.
  const at_prompt = ['', '────────────────', '❯ ', '────────────────', '  kosmos-demo',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'].join('\n');
  const pane = { session: 'made-here', name: 'made-here', claim: 'made-here', command: '2.1.227', title: 'Acknowledge readiness' };

  const idle = classify(pane, at_prompt);
  assert.equal(idle.state, 'idle', 'an agent at its own prompt is reported as unreadable');
  assert.match(idle.because, /sitting at its prompt/);

  // ⚠️ AND IT MUST NOT OUTRANK THE WORKING CHECKS. The footer is on screen while
  // the agent is working too, so a marker placed above them would report every
  // busy agent as idle — a far worse error than the one it fixes, and the exact
  // shape of "the fix for a finding introduces a worse finding".
  const working = classify(pane, at_prompt + '\n  esc to interrupt');
  assert.equal(working.state, 'working', 'a working agent was reported as idle by its own footer');

  // ⚠️ This pins the ORDERING and nothing else, and saying so matters. It
  // passes because `NEEDS_YOU_MARKERS` is checked before the footer rule, and
  // it would pass identically whether or not a real blocking dialog keeps the
  // footer on screen. The premise the footer rule actually rests on -- that a
  // dialog REPLACES the input box -- is asserted in `classify`'s comment and is
  // not measured anywhere, because it is a claim about a UI this repo does not
  // control. A prompt worded outside those five patterns, with the footer still
  // drawn, would classify as idle. That is the known limit of this rule.
  const asking = classify(pane, at_prompt + '\n  Do you want to proceed? (y/N)');
  assert.equal(asking.state, 'needs_you',
    'a question is not caught before the footer rule, so any blocking prompt would read as idle');

  // And a pane with no footer at all is still honestly unknown.
  const silent = classify(pane, 'some unrelated output\n');
  assert.equal(silent.state, 'unknown', 'unknown stopped being reachable, so nothing is honest any more');
});

test('a card reads the transcript of ITS OWN session, not of the name it shares', () => {
  // ⚠️ The board's name is the session with `-discord` stripped, so `foo` and
  // `foo-discord` are one name and two sessions — the collision this module
  // already says it exists to survive. Trying both registry spellings for a
  // NAME reopened it one level down: the surviving card could show the other
  // agent's model and memory at structured confidence, which is the "confident
  // numbers about the wrong conversation" this whole resolution path was built
  // to prevent. The caller holds the pane, so it passes the real session.
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const dir = nodePath.join(root, 'agent-registry');
  fs.mkdirSync(dir, { recursive: true });
  // The DECOY: a registry entry for the un-suffixed session `twin`, which is a
  // different agent that happens to share the board name.
  fs.writeFileSync(nodePath.join(dir, 'twin_0.0.json'),
    JSON.stringify({ session_name: 'twin', session_id: 'sess-twin' }), 'utf8');
  const projects = nodePath.join(root, 'projects', 'twin');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(nodePath.join(projects, 'sess-twin.jsonl'),
    JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 90000 } } }) + '\n', 'utf8');

  setPaneSource(() => 'twin-discord\t0.0\t2.1.227\t0\t\t✳ Claude Code');
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === 'twin');
    assert.ok(card, 'the fixture did not produce a card');
    assert.equal(card.isNamedOurs, true, 'the fixture is not a tied card, so this tests the wrong thing');
    assert.equal(card.model, null,
      "the card read the OTHER twin's transcript because they share a board name");
    assert.equal(card.context.percent, null, "the card reported the other twin's memory as its own");

    // ⚠️ THE CONTROL. Rename the decoy to this session's own spelling and the
    // same numbers must appear — otherwise the nulls above are nulls for some
    // unrelated reason and this test would pass with the fix reverted.
    fs.writeFileSync(nodePath.join(dir, 'twin-discord_0.0.json'),
      JSON.stringify({ session_name: 'twin-discord', session_id: 'sess-twin' }), 'utf8');
    const own = snapshot().agents.find((a) => a.sessionName === 'twin');
    assert.equal(own.model, 'claude-opus-5',
      'the card cannot read its own session either, so the nulls above prove nothing');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a session name that could walk out of the registry directory reads nothing', () => {
  // ⚠️ tmux accepts a `/` in a session name -- measured: `tmux new -s 'a/b'`
  // succeeds. So a local session called `../../whatever-discord` is tied by the
  // legacy suffix arm, and both the board name and the real session are joined
  // into a registry FILENAME. `instructions.registryKey` exists to refuse
  // exactly this shape, and threading the real session through this resolver
  // routed around it.
  //
  // Planted where the traversal would land, so this fails loudly if the guard
  // goes rather than passing because the file happens not to exist.
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  // ⚠️ Planted at EXACTLY the path the traversal would resolve to:
  // join(root, 'agent-registry', '../outside-the-root-discord_0.0.json') lands
  // in the root itself. The first version of this fixture planted a differently
  // named file, so the nulls it asserted were nulls because nothing was there —
  // a vacuous gate test, which the mutation run caught by staying green with
  // the guard removed.
  const outside = nodePath.join(root, 'outside-the-root-discord_0.0.json');
  fs.writeFileSync(outside, JSON.stringify({ session_id: 'sess-outside' }), 'utf8');
  const projects = nodePath.join(root, 'projects', 'elsewhere');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(nodePath.join(projects, 'sess-outside.jsonl'),
    JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 50000 } } }) + '\n', 'utf8');

  setPaneSource(() => '../outside-the-root-discord\t0.0\t2.1.227\t0\t\t✳ Claude Code');
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.session === '../outside-the-root-discord');
    assert.ok(card, 'the fixture did not produce a card');
    assert.equal(card.model, null,
      'a session name walked out of the registry directory and read a file outside it');
    assert.equal(card.context.percent, null, 'the same, for the memory ring');

    // ⚠️ THE CONTROL. The planted file IS readable and DOES produce numbers when
    // asked for under a name that cannot traverse -- otherwise the nulls above
    // are nulls because nothing was there, and this test proves nothing.
    const inside = nodePath.join(root, 'agent-registry', 'plain-name_0.0.json');
    fs.mkdirSync(nodePath.dirname(inside), { recursive: true });
    fs.writeFileSync(inside, JSON.stringify({ session_name: 'plain-name', session_id: 'sess-outside' }), 'utf8');
    setPaneSource(() => 'plain-name\t0.0\t2.1.227\t0\tplain-name\t✳ Claude Code');
    const ok = snapshot().agents.find((a) => a.sessionName === 'plain-name');
    assert.equal(ok.model, 'claude-opus-5',
      'the planted transcript is unreadable anyway, so the assertions above are vacuous');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a claimed session cannot displace the real agent that shares its name', () => {
  // ⚠️ THE COLLISION THE CLAIM ARM CREATED. `onePanePerSession` keys on the
  // board NAME, and `angel` and `angel-discord` are one name. Before the claim
  // existed only the suffixed session could be "ours", so this tie could not
  // arise. Now any local process can run
  //
  //     tmux new -s angel && tmux set-option -t angel @kosmos_agent angel
  //
  // and both panes rank identically -- so the winner was whichever tmux listed
  // first. Measured before the fix: the roster came back with ONE entry, the
  // impostor's, and the real agent was not on the board at all. Everything
  // keyed on the name followed it: instruction reads and writes, and the
  // name-keyed gates.
  setPaneSource(() => [
    'angel\t0.0\t2.1.212\t0\tangel\t✳ Claude Code',
    'angel-discord\t0.0\t2.1.212\t0\t\t✳ Claude Code',
  ].join('\n'));
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const roster = require('./status').paneRoster();
    const angels = roster.filter((a) => a.sessionName === 'angel');
    assert.equal(angels.length, 1, 'the collision produced two entries under one name');
    assert.equal(angels[0].session, 'angel-discord',
      'a session that merely claims the name displaced the real agent, and every '
      + 'name-keyed read and write follows it');

    // ⚠️ THE CONTROL. With no impostor, the same fixture must still resolve --
    // otherwise this passes because nothing resolves at all.
    setPaneSource(() => 'angel-discord\t0.0\t2.1.212\t0\t\t✳ Claude Code');
    assert.equal(require('./status').paneRoster().filter((a) => a.sessionName === 'angel').length, 1,
      'the real agent does not resolve on its own, so the assertion above is vacuous');

    // ⚠️ AND WHATEVER EACH IS RUNNING. The first version of this tie-break only
    // preferred a suffixed pane that was running unambiguous Claude, so a real
    // agent CRASHED to a shell still lost its name to a claimed impostor that
    // was running -- the worst available case, because the crash is then hidden
    // on the very card whose Restart button exists for it, while a write still
    // reaches the real agent's boot file.
    setPaneSource(() => [
      'angel\t0.0\t2.1.212\t0\tangel\t✳ Claude Code',
      'angel-discord\t0.0\t-zsh\t0\t\tzsh',
    ].join('\n'));
    const crashed = require('./status').paneRoster().filter((a) => a.sessionName === 'angel');
    assert.equal(crashed.length, 1);
    assert.equal(crashed[0].session, 'angel-discord',
      'a claimed impostor took the name of a real agent that had crashed to a shell');

    // ⚠️ AND THE OTHER CONTROL: a claimed session with NO suffixed twin is
    // still ours. That is the whole point of the claim, and a tie-break that
    // took it away would break every agent this product creates.
    setPaneSource(() => 'made-by-kosmos\t0.0\t2.1.212\t0\tmade-by-kosmos\t✳ Claude Code');
    const mine = require('./status').paneRoster().find((a) => a.sessionName === 'made-by-kosmos');
    assert.ok(mine && mine.isNamedOurs, 'a created agent stopped being recognised as ours');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a line with no separator is not an agent, and losing the whole answer is not an empty machine', () => {
  // ⚠️ BOTH HALVES, because the second one is what actually cost fourteen hours.
  //
  // Measured on this machine: without a UTF-8 locale, tmux SANITISES its own
  // format output and replaces the tab separators with underscores. The board
  // then showed thirteen agents named `angel-discord_0.0_2.1.223_0__ …` --
  // populated, confident, and wrong, with each garbage entry carrying a name, a
  // rank and a target into everything downstream.
  const mangled = 'angel-discord_0.0_2.1.223_0__ add-editable-agent-detail';
  assert.deepEqual(parsePanes(mangled), [],
    'a line with no separator became an agent whose name is the entire line');

  // ⚠️ And it must not become "no agents". Before the LANG fix the board served
  // 200 with an empty fleet for fourteen hours while thirteen agents ran,
  // because a mangled answer and no answer are indistinguishable once the bad
  // lines are dropped. Dropping them silently would rebuild that exact state.
  setPaneSource(() => mangled);
  setPaneCapture(() => '');
  try {
    // The GATE, which decides whether a write reaches an agent.
    assert.throws(() => require('./status').paneRoster(), /could not make sense of what came back/,
      'the gate read an unreadable answer as "nobody is claiming this name"');

    // ⚠️ AND THE BOARD. This one was missing, and a mutation run found it:
    // removing the refusal from `listPanes` left the whole suite green while
    // the board went back to showing an empty machine -- the exact fourteen-hour
    // state this test is named after. A guarantee claimed in a comment and
    // pinned nowhere is the shape this codebase keeps paying for.
    assert.throws(() => snapshot(), /could not make sense of what came back/,
      'the board was handed an empty fleet for an answer nothing in it could be read from');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }

  // ⚠️ THE CONTROL, in two parts. A TRUNCATED line is still an agent -- it
  // names a session we can identify, and its missing fields default to the
  // unsafe answer -- so this must not have become "drop anything imperfect",
  // which would hide a running agent instead of showing a garbage one.
  assert.equal(parsePanes('zeta-discord\t0.0\t2.1.212').length, 1,
    'a truncated line was dropped, which hides a real agent rather than showing it carefully');
  assert.equal(parsePanes('zeta-discord\t0.0\t2.1.212\t0\ttitle').length, 1,
    'a well-formed line was dropped, so the rule refuses everything');
});

test('a fleet that is partly unreadable is shown with the gap counted, not quietly trimmed', () => {
  // ⚠️ One readable line and one mangled one is the state where silence is most
  // tempting and most wrong: the board can show SOMETHING, so it does, and the
  // missing agent simply is not there. The count is what lets the screen say
  // that part of the fleet could not be read rather than presenting what is
  // left as all of it.
  setPaneSource(() => ['angel-discord\t0.0\t2.1.212\t0\t✳ Claude Code',
    'mikey-discord_0.0_2.1.223_0__ mangled'].join('\n'));
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const snap = snapshot();
    assert.equal(snap.agents.length, 1, 'the readable agent was lost along with the garbage one');
    assert.equal(snap.counts.unreadableLines, 1,
      'the board was handed a partial fleet with nothing saying part of it is missing');

    // THE CONTROL: a wholly readable answer reports no gap, so the count is not
    // just always one.
    setPaneSource(() => 'angel-discord\t0.0\t2.1.212\t0\t✳ Claude Code');
    assert.equal(snapshot().counts.unreadableLines, 0,
      'a clean answer still reports unreadable lines, so the count means nothing');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('one unreadable line does not take the gate away from the whole fleet', () => {
  // ⚠️ THE PARTIAL CASE, pinned as a DECISION. Refusing here on any unreadable
  // line would take every name-keyed read and write away from every agent on
  // the machine because one pane's line was mangled: a machine-wide outage from
  // a cosmetic fault. So the gate keeps working for the agents it could read,
  // and the agents it could not are simply absent -- which `knownAgent` answers
  // false for, failing closed.
  //
  // Unpinned, this was free to flip in either direction: a mutation making the
  // gate refuse on ANY rejected line left the whole suite green.
  setPaneSource(() => ['angel-discord\t0.0\t2.1.212\t0\t✳ Claude Code',
    'mikey-discord_0.0_2.1.223_0__ mangled'].join('\n'));
  try {
    const roster = require('./status').paneRoster();
    assert.equal(roster.length, 1, 'the readable agent was lost with the garbage one');
    assert.equal(roster[0].sessionName, 'angel',
      'the surviving entry is not the agent whose line was readable');

    // ⚠️ AND THE OTHER DIRECTION. An answer with NOTHING readable still refuses,
    // so this leniency is scoped to the partial case rather than having quietly
    // removed the refusal altogether.
    setPaneSource(() => 'mikey-discord_0.0_2.1.223_0__ mangled');
    assert.throws(() => require('./status').paneRoster(), /could not make sense of what came back/,
      'the gate now accepts an answer it could read nothing from');
  } finally {
    setPaneSource(null);
  }
});

// ---------------------------------------------------------------------------
// "there are no sessions" is not "we could not ask"
// ---------------------------------------------------------------------------

test('tmux answering that no server is running is an EMPTY fleet, not a blind one', () => {
  // ⚠️ AGAINST A REAL FAILING TMUX, not an invented error object. The whole
  // defect being closed here is a shape mismatch between what a producer really
  // returns and what a test believed it returns, so the input is produced by
  // running the real program against a socket that does not exist.
  const socket = `kosmos-no-server-probe-${process.pid}`;
  const got = require('./status').shDetail('tmux', ['-L', socket, 'list-panes', '-a']);

  if (!got.ran) {
    // tmux is not installed on this machine. Say so rather than passing: a
    // silent skip here would be a test that reports success for never running.
    assert.equal(require('./status').tmuxSaidNoServer(got), false,
      'a program that never started must never read as "there are no sessions"');
    return;
  }

  assert.notEqual(got.status, 0, 'the control: this call really did fail');
  assert.ok(got.err, 'the control: tmux really did say something on stderr');
  assert.equal(require('./status').tmuxSaidNoServer(got), true,
    'a machine with tmux installed and nothing running reads as unreachable, so '
    + 'a first-run board says "we cannot read the agents" about a machine it just looked at');
});

test('a program that cannot be run at all is still "we could not ask"', () => {
  // The other half, and the one that must NOT be softened into an empty fleet:
  // tmux missing entirely is exactly the case the refusal exists for.
  const got = require('./status').shDetail('kosmos-no-such-program-anywhere', ['--version']);
  assert.equal(got.ran, false, 'the control: this program really is absent');
  assert.equal(require('./status').tmuxSaidNoServer(got), false);
});

test('a tmux failure we do not recognise still refuses, rather than reading as empty', () => {
  // ⚠️ FAILS CLOSED, against a REAL tmux error that is not "no server".
  //
  // MEASURED on this machine: a plain file sitting where the socket should be
  // answers `error connecting to <path> (Socket operation on non-socket)`. That
  // matches "error connecting to" and NOT "no such file or directory" — so it
  // is exactly the input that separates the tight rule from the loose one. The
  // first version of the rule accepted any "error connecting to" and would have
  // reported this machine as having no agents; a socket we lack permission to
  // reach reads the same way.
  const os = require('node:os');
  const fsx = require('node:fs');
  const nodePathx = require('node:path');
  const dir = fsx.mkdtempSync(nodePathx.join(os.tmpdir(), 'kosmos-tmux-'));
  const sockDir = nodePathx.join(dir, `tmux-${process.getuid ? process.getuid() : 0}`);
  fsx.mkdirSync(sockDir, { recursive: true });
  fsx.chmodSync(sockDir, 0o700);
  fsx.writeFileSync(nodePathx.join(sockDir, 'notasocket'), '');
  const had = process.env.TMUX_TMPDIR;
  try {
    process.env.TMUX_TMPDIR = dir;
    const got = require('./status').shDetail('tmux', ['-L', 'notasocket', 'list-panes', '-a']);
    // ⚠️ NOT a silent return. A skip that asserts nothing reports green for
    // never having run, which the first test in this block refuses by name —
    // and then two of its siblings did exactly that. On a machine without tmux
    // the fact still worth pinning is that a program which never started can
    // never read as "there are no sessions".
    if (!got.ran) {
      assert.equal(require('./status').tmuxSaidNoServer(got), false,
        'tmux is absent here, and a program that never started read as an empty fleet');
      return;
    }
    // The control: this really is a connect error, so a rule keyed on that
    // phrase would fire — which is what makes the `false` below meaningful.
    assert.match(got.err, /error connecting to/,
      `the probe did not reproduce a connect error (tmux said: ${got.err.trim()})`);
    assert.doesNotMatch(got.err, /no such file or directory/i,
      'the probe produced the ordinary missing-socket error, so it is not exercising '
      + 'the case that separates the tight rule from the loose one');
    assert.equal(require('./status').tmuxSaidNoServer(got), false,
      'a tmux error that is not "no server" was read as a machine with no agents');
  } finally {
    if (had === undefined) delete process.env.TMUX_TMPDIR; else process.env.TMUX_TMPDIR = had;
    fsx.rmSync(dir, { recursive: true, force: true });
  }
});

test('a machine with tmux and no sessions shows an EMPTY board, not an unreadable one', () => {
  // ⚠️ THE WIRING, not the predicate. `tmuxSaidNoServer` had three tests and
  // deleting its call from `tmuxPanes` left every one of them green — the same
  // unpinnable-wiring shape that `setPaneSource` was introduced for. This one
  // goes through the real `tmux` binary with `TMUX_TMPDIR` pointed at an empty
  // directory, so the default socket genuinely does not exist: the state of
  // every machine that has tmux installed and has not started an agent yet,
  // which is the first-run machine this product is for.
  const os = require('node:os');
  const fsx = require('node:fs');
  const nodePathx = require('node:path');
  const status = require('./status');
  const dir = fsx.mkdtempSync(nodePathx.join(os.tmpdir(), 'kosmos-empty-'));
  const had = process.env.TMUX_TMPDIR;
  // ⚠️ `TMUX` TOO. This suite runs INSIDE a tmux pane, and tmux prefers the
  // socket named by `$TMUX` over `TMUX_TMPDIR` — so without this the probe
  // reached the operator's REAL server and the test measured the live fleet
  // while claiming to measure an empty machine. Exactly the wrong-world
  // failure this branch keeps finding, in the test written to prevent it.
  const hadTmux = process.env.TMUX;
  status.setPaneSource(null);   // the REAL tmux path, not the seam
  try {
    process.env.TMUX_TMPDIR = dir;
    delete process.env.TMUX;
    if (!status.shDetail('tmux', ['-V']).ran) {
      // Same rule as above: say what is still true rather than passing silently.
      /* ⚠️ THE COPY SWEEP MOVED THIS SENTENCE AND THIS PIN WAS MISSED, because
         the arm only runs where tmux is NOT installed. On a machine with tmux
         it never executes, so the suite stayed green here while the assertion
         was dead -- and it would have failed on a runner without tmux, which is
         the machine the test is named for. A pin inside a
         host-capability branch is invisible to every run on the wrong host. */
      assert.throws(() => status.snapshot(), /could not see what is running on this computer/,
        'tmux is absent here, and the board did not refuse to speak about a machine it cannot see');
      return;
    }
    // The control: this really is the no-server state, and not a live server we
    // happened to reach.
    const probe = status.shDetail('tmux', ['list-panes', '-a']);
    assert.equal(probe.ran, true);
    assert.notEqual(probe.status, 0,
      'the probe reached a RUNNING tmux server, so this test is measuring the '
      + 'real fleet rather than an empty machine');

    const board = status.snapshot();
    assert.deepEqual(board.agents, [], 'a machine with no sessions is an empty board');
    assert.equal(board.counts.total, 0);
    assert.equal(board.counts.unreadableLines, 0, 'nothing was unreadable -- there was nothing');
    assert.deepEqual(status.paneRoster(), [],
      'the gate refused a machine it had successfully looked at, so every '
      + 'name-keyed route 404s on a first-run computer');
  } finally {
    if (had === undefined) delete process.env.TMUX_TMPDIR; else process.env.TMUX_TMPDIR = had;
    if (hadTmux === undefined) delete process.env.TMUX; else process.env.TMUX = hadTmux;
    fsx.rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// "Nothing yet" is not "we could not look"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drive one agent through `snapshot()` and hand back its context reading.
 * The pane fixture is the same shape the created-agent test above uses.
 */
function contextFor(name, seed, running = true) {
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const regDir = nodePath.join(root, 'agent-registry');
  fs.mkdirSync(regDir, { recursive: true });
  const entry = nodePath.join(regDir, `${name}_0.0.json`);
  const projects = nodePath.join(root, 'projects', name);
  fs.mkdirSync(projects, { recursive: true });
  const transcript = nodePath.join(projects, `sess-${name}.jsonl`);

  seed({ entry, transcript, write: () => fs.writeFileSync(entry, JSON.stringify({
    session_name: name, session_id: `sess-${name}`, cwd: '/somewhere',
  }), 'utf8') });

  /* ⚠️ THE COMMAND STILL VARIES, but nothing in `readContext` reads it any
     more. It is here so these fixtures cover both a live Claude pane and a
     crashed agent's shell — and so that a future version which starts keying on
     the command again has both cases in front of it. PANE_COLUMNS in order:
     session, pane, command, inMode, claim, title. */
  setPaneSource(() => `${name}\t0.0\t${running ? '2.1.227' : 'zsh'}\t0\t${name}\t✳ Claude Code`);
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === name);
    assert.ok(card, `the fixture for ${name} produced no card at all`);
    return card.context;
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
}

test('a RUNNING agent with no registry entry is not told it has never started', () => {
  /**
   * ⚠️ THE STATE JOSH SCREENSHOTTED. He made an agent, and its card said
   * "Unknown" with a ring whose label read "Memory could not be read" — a
   * CLAIM that something exists and we failed at it, made about an agent
   * thirty seconds old with nothing to read.
   *
   * 🔑 The rule this pins (Mona Lisa, 2026-08-21): "not yet" is a claim about
   * where an agent is in its life and "unknown" is an admission about what we
   * can see. A wrong claim is worse than a vague admission, so every case that
   * cannot be told apart WITHOUT A THRESHOLD goes to the admission — and the
   * threshold we specifically refused is the agent's age.
   */
  /**
   * 🛑 THE BLOCKER THIS REPLACES WAS A FALSE CLAIM ON A WORKING AGENT. "No
   * registry entry" reads like a clean absence and is not one: the key is
   * `<session>_<window>.<pane>` and we only ever build `_0.0`, so an agent in
   * pane 0.1 has an entry we never look for; a config root with no
   * `agent-registry` directory has none to find; entries get rotated away.
   * In every one of those the agent is UP and may be at 95%, and the card said
   * "nothing has been recorded, that is normal for a new agent".
   *
   * ⚠️ THE MOTIVATING CASE IS NOT THIS BRANCH. A genuinely new agent has a
   * registry entry and a transcript within moments; what it does not have yet
   * is a usage row, which is the branch below. So sending this one to the
   * admission costs the feature nothing.
   */
  const ctx = contextFor('brandnew', () => { /* no registry entry at all */ });
  assert.equal(ctx.percent, null, 'the fixture produced a reading, so this tests nothing');
  assert.equal(ctx.notYet, false, 'a running agent was reported as one that has never started');
});

test('a registry entry whose transcript is GONE is unknown, not "not yet"', () => {
  /**
   * ⚠️ THE SECOND HALF OF THE SAME COLLAPSE, and it resolves the other way.
   * Both states returned a bare `null` from `transcriptFor`. Something existed
   * here and is not there now, so "not yet" would be false in a SPECIFIC way
   * rather than merely vague — it was read, once.
   */
  const ctx = contextFor('vanished', ({ write }) => { write(); /* and no transcript file */ });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, false, 'a transcript that disappeared was reported as one never written');
});

test('an EMPTY transcript is UNKNOWN, because an empty file says nothing about the agent', () => {
  /**
   * ⚠️ THE WORSE OF THE TWO COLLAPSES. `tailBytes` returns '' for a file that
   * is there and empty, and null when the read threw; the caller tested
   * `if (!text)` and put both in the same arm. An empty transcript is exactly
   * the state Claude Code leaves one in the instant it opens the file — so the
   * NEWEST agent on the machine was the one reported as unreadable.
   */
  /**
   * ⚠️ THE COLLAPSE IS STILL THE FINDING: `tailBytes` returns '' for an empty
   * file and null for a failed read, and `if (!text)` put both in one arm.
   * But the arm it belongs in depends on whether the agent is RUNNING —
   * Claude Code opens a FRESH transcript when it compacts, so an agent that
   * just filled its context is indistinguishable from one that never ran.
   * Separating those needs the agent's age, which is the threshold this change
   * refused, so a running one goes to the admission.
   */
  const ctx = contextFor('justopened', ({ transcript, write }) => {
    write();
    fs.writeFileSync(transcript, '', 'utf8');
  });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, false, 'an empty file was read as evidence the agent is new');
  /* ⚠️ THE ASSERTION USED TO PIN A FALSE EXPLANATION — /compacts/ — which made
     a wrong premise a suite invariant: correcting the sentence would have
     broken a green test. It pins the SHAPE of the answer instead. */
  assert.match(ctx.because, /empty/);

  // ⚠️ AND WITH THE PANE AT A SHELL TOO. An earlier version made this arm
  // depend on whether the pane looked like Claude, which only moved the guess
  // somewhere harder to see.
  const idle = contextFor('justopened-idle', ({ transcript, write }) => {
    write();
    fs.writeFileSync(transcript, '', 'utf8');
  }, false);
  assert.equal(idle.notYet, false, 'a crashed agent that had compacted was told it had never run');
});

test('usage that is present but sums to zero is UNKNOWN, because telling those apart needs an age', () => {
  /**
   * 🛑 THE TIE-BREAKER DOING ITS WORK, and the case that shows it is a rule
   * rather than a preference. A usage record summing to zero could be a
   * session that has genuinely done nothing, or data that is wrong. The only
   * separator available is how old the agent is, and a threshold is the thing
   * this whole split refused — so it resolves to the admission.
   */
  const ctx = contextFor('zerousage', ({ transcript, write }) => {
    write();
    fs.writeFileSync(transcript,
      JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 0 } } }) + '\n', 'utf8');
  });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, false, 'we claimed an agent was new when we only could not tell');
});

test('a real reading is neither, and the control proves the fixtures above are not all just null', () => {
  /**
   * ⚠️ THE POSITIVE CONTROL. Every assertion above is about a `null` percent,
   * and a harness that silently produced no reading for ANY fixture would pass
   * all five. This one has to come back measured.
   */
  const ctx = contextFor('measured', ({ transcript, write }) => {
    write();
    fs.writeFileSync(transcript,
      JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 42000 } } }) + '\n', 'utf8');
  });
  assert.ok(ctx.percent !== null, 'the harness cannot produce a reading at all, so the nulls above prove nothing');
  assert.equal(ctx.notYet, false);
});

test('a huge transcript whose tail holds no usage row is UNKNOWN, never "not yet"', () => {
  /**
   * 🛑 THE SAME BUG WITH THE SIGN FLIPPED, and it was in the fix. The reading
   * comes from the LAST 256KB of a transcript that can reach 8MB, so "no usage
   * rows here" is a statement about a window, not a file. One oversized tool
   * result at the end pushes every usage row out of view — and the card would
   * then say "Not yet read" with the note "that is normal for an agent this
   * new. There is nothing wrong with it" for an agent that may be at 95%.
   *
   * ⚠️ Separable WITHOUT A THRESHOLD, which is the only reason it is separated:
   * whether the read covered the whole file is a fact the read already has.
   */
  const ctx = contextFor('bigtail', ({ transcript, write }) => {
    write();
    // A real usage row, then far more than the window of padding after it.
    const usage = JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 90000 } } }) + '\n';
    const pad = JSON.stringify({ type: 'tool_result', content: 'x'.repeat(400000) }) + '\n';
    fs.writeFileSync(transcript, usage + pad, 'utf8');
  });
  assert.equal(ctx.percent, null, 'the usage row was inside the window, so this tests nothing');
  assert.equal(ctx.notYet, false, 'an agent with a huge transcript was reported as one that has never run');
});

test('a SMALL transcript with no usage row really is "not yet"', () => {
  /**
   * ⚠️ THE CONTROL ON THE FIX ABOVE. Without it, answering `notYet: false` for
   * every missing-usage case would pass the truncation test and quietly undo
   * the thing this whole change is for.
   */
  const ctx = contextFor('smalltail', ({ transcript, write }) => {
    write();
    fs.writeFileSync(transcript, JSON.stringify({ type: 'summary', message: {} }) + '\n', 'utf8');
  });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, true, 'a genuinely new agent lost its honest wording');
});

test('a registry entry we cannot READ is not reported as an agent that never started', () => {
  /**
   * ⚠️ AN EMPTY LIST HAS FIVE CAUSES. Only one of them — no entry anywhere — is
   * a genuine absence. A corrupt entry is a failure of ours, and turning it into
   * "it has not started a session yet" makes a claim about the agent's life out
   * of our own unreadable file. That is the exact direction this whole change
   * was written to stop.
   */
  const ctx = contextFor('corrupt-entry', ({ entry }) => {
    fs.writeFileSync(entry, '{ this is not json', 'utf8');
  });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, false, 'our unreadable file was reported as the agent never having run');
});

test('a registry entry belonging to ANOTHER agent is a refusal, not an absence', () => {
  /**
   * ⚠️ We can see the entry and are declining to read across a name collision —
   * the same shape as the identity refusal elsewhere in this file, and the
   * opposite of "nothing has ever been registered here".
   */
  const ctx = contextFor('collided', ({ entry }) => {
    fs.writeFileSync(entry, JSON.stringify({ session_name: 'somebody-else', session_id: 'sess-somebody-else' }), 'utf8');
  });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, false, 'a collision we refused to read was reported as a new agent');
});

test('an entry with no session id in it is a look we could not finish', () => {
  const ctx = contextFor('no-id', ({ entry }) => {
    fs.writeFileSync(entry, JSON.stringify({ session_name: 'no-id' }), 'utf8');
  });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, false);
});

test('no transcript is the admission whether the agent is up or not', () => {
  /**
   * 🛑 THREE ATTEMPTS AT BEING CLEVERER THAN THIS WERE ALL WRONG THE SAME WAY.
   * The causes of "no transcript" cannot be separated here: some mean the agent
   * never started, some mean it has been running for hours under a registry key
   * we do not look for. I tried to separate them with "is the pane running
   * Claude" and it was wrong three ways — `node` is a real Claude install, a
   * truncated tmux line has no command at all, and a crashed agent's pane is a
   * shell.
   *
   * ⚠️ SO BOTH FIXTURES ANSWER THE SAME, and the value of this test is that it
   * asserts the SAMENESS. A version that resolves one of them to "not yet" is
   * the version that put "nothing has been recorded, that is normal for a new
   * agent" on an agent at 95%.
   */
  for (const running of [true, false]) {
    const ctx = contextFor(`absent-${running}`, () => { /* nothing anywhere */ }, running);
    assert.equal(ctx.percent, null);
    assert.equal(ctx.notYet, false, `no transcript with running=${running} produced a claim about the agent's life`);
  }
});

test('THE CONTROL: a transcript that IS there, fully read, with no usage rows, is "not yet"', () => {
  /**
   * ⚠️ WITHOUT THIS, ANSWERING `notYet: false` EVERYWHERE PASSES EVERY TEST
   * ABOVE and silently deletes the feature. This is the branch the whole change
   * exists for and the only one that reaches it: the file is there, we read all
   * of it, and nothing has been recorded. That is Josh's brand-new agent.
   */
  const ctx = contextFor('really-new', ({ transcript, write }) => {
    write();
    fs.writeFileSync(transcript, JSON.stringify({ type: 'summary', message: {} }) + '\n', 'utf8');
  });
  assert.equal(ctx.percent, null);
  assert.equal(ctx.notYet, true, 'the one honest "not yet" case lost its wording');
});

test('a measured agent whose model size we do not know says so, and carries the flag that says it', () => {
  /**
   * 🛑 THE LINK NOTHING TESTED. The engine takes a real reading and cannot turn
   * it into a percentage, and every surface then said "memory could not be
   * read" about a reading it had. Removing the engine's own flag broke nothing
   * in the suite, which is how the wrong sentence stayed live.
   *
   * ⚠️ `noCeiling` is a FLAG rather than "tokens present and no percent",
   * because that shape is also produced by a percent we could not read, and
   * those are two different things to tell somebody.
   */
  const ctx = contextFor('nolimit', ({ transcript, entry }) => {
    fs.writeFileSync(entry, JSON.stringify({
      session_name: 'nolimit', session_id: 'sess-nolimit', cwd: '/somewhere',
    }), 'utf8');
    fs.writeFileSync(transcript, JSON.stringify({
      message: { model: 'some-model-nobody-has-measured', usage: { input_tokens: 42000 } },
    }) + '\n', 'utf8');
  });

  assert.ok(ctx.tokens > 0, 'no reading was taken, so this tests the wrong branch');
  assert.equal(ctx.percent, null, 'a percentage appeared for a model with no known size');
  assert.equal(ctx.noCeiling, true, 'the flag the surfaces read is not set, so they say we failed to read it');
  assert.equal(ctx.notYet, false);

  // ⚠️ THE CONTROL: a model we HAVE measured must not carry the flag, or it is
  // set unconditionally and says nothing.
  const known = contextFor('haslimit', ({ transcript, entry }) => {
    fs.writeFileSync(entry, JSON.stringify({
      session_name: 'haslimit', session_id: 'sess-haslimit', cwd: '/somewhere',
    }), 'utf8');
    fs.writeFileSync(transcript, JSON.stringify({
      message: { model: 'claude-opus-5', usage: { input_tokens: 42000 } },
    }) + '\n', 'utf8');
  });
  assert.ok(known.percent !== null, 'the control produced no percentage either');
  assert.equal(known.noCeiling, undefined);
});

test('an agent with no registry entry is read from the folder it was launched in', () => {
  /**
   * 🛑 THE REGISTRY THIS FILE READS IS NOT WRITTEN BY CLAUDE CODE OR BY KOSMOS.
   * On the machine where all of this was built it is written by
   * `~/.claude/scripts/lib/session-recovery.sh`, local fleet tooling; nothing in
   * this repo creates it. So on a clean install the folder does not exist and
   * EVERY agent reads "memory could not be read", permanently.
   *
   * Josh, 2026-08-21, on a fresh mini:
   *   ls: /Users/cabal/.claude/agent-registry/: No such file or directory
   *
   * ⚠️ EVERY EXISTING TEST HERE SEEDS THE REGISTRY, which is why a product-wide
   * gap survived all of them: the fixture supplied the very file the product
   * was wrong to depend on. This one deliberately seeds NO registry entry.
   */
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const name = 'foldersonly';
  const dir = nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });

  // Claude Code flattens the launch directory: every character that is not a
  // letter or a digit becomes a dash. Measured against a real transcript tree.
  const flat = dir.replace(/[^A-Za-z0-9]/g, '-');
  const projects = nodePath.join(root, 'projects', flat);
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(nodePath.join(projects, 'sess-folders.jsonl'),
    JSON.stringify({ type: 'summary', sessionId: 'sess-folders' }) + '\n'
    + JSON.stringify({ cwd: dir, message: { model: 'claude-opus-5', usage: { input_tokens: 42000 } } }) + '\n',
    'utf8');

  setPaneSource(() => `${name}\t0.0\t2.1.227\t0\t${name}\t✳ Claude Code`);
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === name);
    assert.ok(card, 'the fixture did not produce a card at all');
    assert.ok(card.context.percent !== null,
      'an agent with no registry entry still has an unknowable memory ring, which is every agent on a clean install');
    assert.equal(card.model, 'claude-opus-5');

    /**
     * 🛑 THE CONTROL, AND IT IS THE WHOLE POINT OF THE DESIGN. The folder is a
     * GUESS — two paths can flatten to one directory — so the transcript is
     * opened and its own `cwd` checked against the folder we meant. Point it
     * somewhere else and the reading must go back to nothing rather than
     * reporting confident numbers about another conversation.
     */
    fs.writeFileSync(nodePath.join(projects, 'sess-folders.jsonl'),
      JSON.stringify({ type: 'summary', sessionId: 'sess-folders' }) + '\n'
      + JSON.stringify({ cwd: '/somewhere/else', message: { model: 'claude-opus-5', usage: { input_tokens: 42000 } } }) + '\n',
      'utf8');
    const wrong = snapshot().agents.find((a) => a.sessionName === name);
    assert.equal(wrong.context.percent, null,
      'a transcript belonging to another directory was used, which is the one outcome worse than no reading');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a Haiku agent gets a ceiling of its own, and it is not the 1M the others assume', () => {
  /**
   * 🛑 JOSH, 2026-08-21: two of eight agents read "Unknown" after the memory fix
   * landed, and they were the only two Haiku agents on his board.
   * `ASSUMED_LIMIT_MODELS` is `/^claude-(opus|sonnet|fable)-/` — no haiku — so
   * `limitFor` returned null, `noCeiling` was set, and the badge fell back to
   * Unknown while their memory was being read perfectly well.
   *
   * ⚠️ AND THE OBVIOUS FIX WAS THE DANGEROUS ONE. Adding haiku to that regex
   * gives it 1M. Haiku 4.5 holds 200K (Anthropic's published figure), so an
   * agent at 80% would have drawn at 16% and nobody would have known it was
   * nearly full. This asserts the SIZE, not merely that a number appeared,
   * because "a percentage renders" is exactly what a 5x-wrong denominator does.
   */
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const name = 'haikuagent';
  const dir = nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const projects = nodePath.join(root, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(projects, { recursive: true });
  // 20,000 tokens: 10% of 200K, and 2% of the 1M the other models assume.
  fs.writeFileSync(nodePath.join(projects, 'sess-haiku.jsonl'),
    JSON.stringify({ type: 'summary', sessionId: 'sess-haiku' }) + '\n'
    + JSON.stringify({ cwd: dir,
        message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 20000 } } }) + '\n',
    'utf8');

  setPaneSource(() => `${name}\t0.0\t2.1.227\t0\t${name}\t✳ Claude Code`);
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === name);
    assert.ok(card, 'the fixture did not produce a card at all');
    assert.equal(card.context.ceiling, 200000,
      'a Haiku agent is being measured against the wrong ceiling');
    assert.equal(card.context.percent, 10,
      'the percentage does not match Haiku’s own limit; at 1M this would read 2');
    assert.equal(card.context.ceilingAssumed, true,
      'a published figure is still not a watched one, and the screen has to be able to say so');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('an agent Kosmos launched but that has never spoken says so, and one we did not launch does not', () => {
  /**
   * 🛑 JOSH'S AVA, 2026-08-21: created minutes earlier, sitting at her prompt,
   * never spoken to — and the panel read *"Ava's memory could not be read. We
   * cannot find a transcript for it."* The second clause was true; the first was
   * a claim about a failure that had not happened. A brand-new agent is the most
   * common thing a new user sees and it greeted them with a fault.
   *
   * ⚠️ THE PLIST GATE IS WHAT THIS TEST IS REALLY FOR. Rick ran for hours,
   * launched outside our supervisor, so his expected folder is empty too. The
   * folder check ALONE would tell a working agent it had never started.
   */
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const agentsDir = process.env.AGENT_WORKFORCE_LAUNCH;
  const mk = (name) => {
    const dir = nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name);
    fs.mkdirSync(dir, { recursive: true });   // create.js makes this AT CREATION
    return dir;
  };
  const show = (name) => {
    setPaneSource(() => `${name}\t0.0\t2.1.227\t0\t${name}\t✳ Claude Code`);
    setPaneCapture(() => 'Worked for 1m\n> \n');
    return snapshot().agents.find((a) => a.sessionName === name);
  };

  try {
    // --- ours, launched, nothing written yet: Ava ---------------------------
    mk('avafresh');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(nodePath.join(agentsDir, 'com.kosmos.agent.avafresh.plist'), '<plist/>', 'utf8');
    const ava = show('avafresh');
    assert.ok(ava, 'the fixture did not produce a card at all');
    assert.equal(ava.context.notYet, true,
      'an agent that has never spoken is still being told its memory could not be read');

    /**
     * 🛑 THE CONTROL, AND IT IS THE HALF THAT KEEPS THIS HONEST. Same empty
     * folder, no plist: an agent we did not launch could have run anywhere, so
     * we must NOT claim it has not started. Delete the plist check and this is
     * the assertion that goes red.
     */
    mk('rickish');
    const rick = show('rickish');
    assert.equal(rick.context.notYet, false,
      'an agent we never launched was told it had not started, which we cannot know');
    assert.match(rick.context.because, /cannot find a transcript/);

    /* And ours WITH transcripts that do not match is a fault, not a fresh
       agent: something was written and we cannot use it. */
    const dir = mk('brokenish');
    fs.writeFileSync(nodePath.join(agentsDir, 'com.kosmos.agent.brokenish.plist'), '<plist/>', 'utf8');
    const projects = nodePath.join(root, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(projects, { recursive: true });
    fs.writeFileSync(nodePath.join(projects, 'sess-broken.jsonl'),
      JSON.stringify({ cwd: '/somewhere/else', message: { usage: { input_tokens: 10 } } }) + '\n', 'utf8');
    const broken = show('brokenish');
    assert.equal(broken.context.notYet, false,
      'a transcript exists and cannot be used, which is a fault rather than a new agent');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('the wording Claude Code actually uses for a spent limit reads as paused, not idle', () => {
  /**
   * 🛑 VERBATIM FROM JOSH'S SCREENSHOT, 2026-08-21, of an agent that could not
   * answer him. This exact text was on screen while her card said **Idle**:
   *
   *   You've reached your Fable 5 limit. Run /usage-credits to continue or
   *   switch models with /model.
   *
   * The four patterns in place were `rate limit`, `usage limit`, `429` and
   * `try again later`. None of them appears in that sentence — it says
   * usage-CREDITS — so the agent classified as idle while it was blocked.
   *
   * 🔑 AND THE COST WAS NOT THE WRONG WORD ON A BADGE. Blocked meant she never
   * completed a turn, so no transcript was ever written, so her memory read as
   * unreadable, so a memory fix that worked looked broken for Fable. One
   * unmatched string, four symptoms.
   *
   * ⚠️ PINNED AS THE WHOLE SENTENCE rather than as a pattern. A test that
   * asserted the regex would be a copy of the thing under test; what has to hold
   * is that THIS text, which a person really saw, is classified correctly.
   */
  const REAL = '> [message from your operator · to answer, run: kosmos reply] hello\n'
    + "  └ You've reached your Fable 5 limit. Run /usage-credits to continue or\n"
    + '    switch models with /model.\n\n* Churned for 0s\n';

  setPaneSource(() => 'spent\t0.0\t2.1.239\t0\tspent\t✳ Claude Code');
  setPaneCapture(() => REAL);
  try {
    const card = snapshot().agents.find((a) => a.sessionName === 'spent');
    assert.ok(card, 'the fixture did not produce a card at all');
    assert.equal(card.state, 'rate_limited',
      'an agent that cannot work because its limit is spent still reads as idle');
    assert.equal(card.stateConfidence, 'scraped',
      'the state is read off a screen and must keep saying so');

    /**
     * 🔑 AND THE LINE ITSELF COMES BACK, which is what lets a screen show
     * evidence instead of asserting a conclusion. Josh asked to be told his
     * usage was full; Kosmos cannot know that, and can show him the sentence
     * that made it say "paused". It names the model and carries the vendor's
     * own two remedies.
     *
     * ⚠️ ADDED BECAUSE THE MUTATION HARNESS CAUGHT IT UNCOVERED: deleting
     * `evidence` from the classifier changed the product and no test noticed.
     */
    assert.equal(card.stateEvidence,
      "You've reached your Fable 5 limit. Run /usage-credits to continue or",
      'the matched line is not coming back, so the screen can only assert rather than show');

    /* Trimmed of the tree glyph Claude Code prefixes its notices with, and
       nothing from the healthy pane. */
    assert.doesNotMatch(card.stateEvidence, /^[\s>│├└─*]/,
      'the terminal drawing characters reached a product surface');

    /* 🔑 THE CONTROL: an ordinary working pane must not trip it, or the fix is
       just a board that calls everything paused. */
    setPaneCapture(() => 'Worked for 1m\n> ready\n');
    const fine = snapshot().agents.find((a) => a.sessionName === 'spent');
    assert.notEqual(fine.state, 'rate_limited',
      'a healthy pane is being reported as blocked');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a synthetic placeholder is not reported as the model an agent runs on', () => {
  /**
   * 🛑 JOSH, 2026-08-21, SECONDS AFTER SWITCHING AN AGENT FROM FABLE TO OPUS:
   * **"Right now: Claude <synthetic>"**. The switch had worked — her window read
   * `Opus 5 · Claude Max` — and the panel named a model that does not exist, at
   * the one moment a person is checking whether the change took.
   *
   * Claude Code stamps `"model":"<synthetic>"` on rows it generates itself, and
   * a usage-limit notice is exactly such a row. `readModel` takes the LAST match
   * in the tail, so the placeholder won.
   *
   * ⚠️ THE ORDER IS THE TEST. A fixture with the placeholder anywhere but LAST
   * would pass against the old code too, which is the whole defect.
   */
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const name = 'synth';
  const dir = nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const projects = nodePath.join(root, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(nodePath.join(projects, 'sess-synth.jsonl'),
    JSON.stringify({ cwd: dir, message: { model: 'claude-opus-5', usage: { input_tokens: 1000 } } }) + '\n'
    // The system-generated row lands AFTER the real one, which is what made the
    // placeholder the last match.
    + JSON.stringify({ cwd: dir, message: { model: '<synthetic>' } }) + '\n',
    'utf8');

  setPaneSource(() => `${name}\t0.0\t2.1.239\t0\t${name}\t✳ Claude Code`);
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === name);
    assert.ok(card, 'the fixture did not produce a card at all');
    assert.equal(card.model, 'claude-opus-5',
      'a placeholder Claude Code writes on its own rows is being shown as the agent’s model');
    assert.doesNotMatch(String(card.modelName || ''), /synthetic/,
      'the placeholder reached the name a person reads');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});

test('a restarted agent that has taken no turns says so, because a synthetic row is not its usage', () => {
  /**
   * 🛑 JOSH, 2026-08-21, ON AVA SECONDS AFTER SWITCHING HER MODEL: *"Ava's
   * memory could not be read. Usage data was empty."* Nothing had failed. She
   * had restarted and taken no turns — and Claude Code had written one row of
   * its own, carrying a `usage` object, which the flat scan counted as hers.
   *
   * 🔑 HIS POINT IS WHY THIS IS NOT COSMETIC: *"for whitecollar people they
   * will do just like me and think, this didnt work."* He read a working
   * feature as broken twice in ten minutes, and he built it.
   *
   * ⚠️ AND A JUST-RESTARTED AGENT IS A COMMON STATE NOW, not an edge one:
   * restart shipped today and every use of it passes through here.
   *
   * 📌 THE FIX IS AN EXCLUSION, NOT A NEW MEANING. An earlier attempt made a
   * zero-sum usage mean "nothing yet"; that was wrong and its own test says so
   * by name — a zero sum is either a fresh agent or bad data, and the only
   * separator is age. This changes what COUNTS as a reading.
   */
  const root = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  const name = 'freshrestart';
  const dir = nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const projects = nodePath.join(root, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(projects, { recursive: true });
  // Exactly her shape: a transcript whose ONLY usage belongs to a row Claude
  // Code wrote itself.
  fs.writeFileSync(nodePath.join(projects, 'sess-fresh.jsonl'),
    JSON.stringify({ cwd: dir, type: 'summary' }) + '\n'
    + JSON.stringify({ cwd: dir, message: { model: '<synthetic>', usage: { input_tokens: 12 } } }) + '\n',
    'utf8');

  setPaneSource(() => `${name}\t0.0\t2.1.239\t0\t${name}\t✳ Claude Code`);
  setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const card = snapshot().agents.find((a) => a.sessionName === name);
    assert.ok(card, 'the fixture did not produce a card at all');
    assert.equal(card.context.notYet, true,
      'a restarted agent that has taken no turns is still being told its memory could not be read');
    assert.match(card.context.because, /has not used any memory yet/);

    /* 🛑 THE CONTROL. A REAL row's usage must still be read, or this "fix" is
       just a board that reports every agent as fresh. */
    fs.appendFileSync(nodePath.join(projects, 'sess-fresh.jsonl'),
      JSON.stringify({ cwd: dir, message: { model: 'claude-opus-5', usage: { input_tokens: 40000 } } }) + '\n',
      'utf8');
    const spoken = snapshot().agents.find((a) => a.sessionName === name);
    assert.equal(spoken.context.notYet, false, 'a real reading was thrown away with the synthetic one');
    assert.ok(spoken.context.tokens >= 40000,
      'the agent has used memory and we are not reporting it');
  } finally {
    setPaneSource(null);
    setPaneCapture(null);
  }
});
