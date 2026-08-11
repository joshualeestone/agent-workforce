'use strict';

/**
 * Tests for the fresh-start actions.
 *
 * ⚠️ **No test here may restart, clear or compact a real agent.** Every action
 * runs against an injected runner that records the argv it was handed and
 * performs nothing. A suite that can restart the fleet is worse than no suite,
 * and this file exists on a machine where thirteen agents are running right
 * now.
 *
 * The one test that touches the real restart script asserts only that it is
 * there and executable. It never runs it.
 *
 *   node --test engine/lifecycle.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Point the restart script somewhere harmless BEFORE requiring the module: it
// resolves the path at load, and the default is the real one.
const FAKE_SCRIPT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-life-')), 'restart-bot.sh');
fs.writeFileSync(FAKE_SCRIPT, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_RESTART_SCRIPT = FAKE_SCRIPT;

const test = require('node:test');
const assert = require('node:assert/strict');
const lifecycle = require('./lifecycle');

test.after(() => fs.rmSync(path.dirname(FAKE_SCRIPT), { recursive: true, force: true }));

/** Records what would have been run, and runs nothing. */
function recorder({ throwOn } = {}) {
  const calls = [];
  lifecycle.setRunner((file, args) => {
    calls.push([file, ...args]);
    if (throwOn && `${file} ${args.join(' ')}`.includes(throwOn)) {
      throw new Error(`ENOENT: no such file or directory, ${file}`);
    }
    return '';
  });
  return calls;
}

/**
 * ⚠️ The runner this file falls back to REFUSES, rather than being the real one.
 *
 * `setRunner(null)` restored the module's default, which is a live
 * `execFileSync`. Combined with `afterEach`, that meant every test began with
 * the real runner installed, and the file's own header rule — no test may
 * restart, clear or compact a real agent — held only because every test
 * happened to call `recorder()` before doing anything. The next test written
 * here, or an early `return` before the recorder line, sends real keystrokes to
 * a real pane on a machine running thirteen agents.
 *
 * `AGENT_WORKFORCE_DRY_RUN` is the mechanism everywhere else, and it is the
 * wrong tool here: it makes every action return `DRY_RUN`, which is exactly the
 * outcome vocabulary these tests assert against. So the mechanism for this file
 * is a default that cannot reach the machine.
 *
 * ⚠️ **What this does and does not guarantee**, stated precisely, because the
 * first version of this comment promised something it did not deliver.
 *
 * It DOES guarantee nothing real runs: the runner is replaced, so
 * `execFileSync` is unreachable whatever a test forgets.
 *
 * It does NOT guarantee a loud failure, and claiming so was wrong. `lifecycle`
 * catches runner throws itself and turns them into ordinary outcomes: measured,
 * a forgotten recorder yields `clear` → REFUSED "we could not reach that agent
 * to ask", and `restart` → ASKED "the restart did not finish cleanly". Those are
 * values several tests in this file legitimately assert, so a test that forgot
 * `recorder()` can PASS while proving nothing. The flag below is how a reader
 * tells the two apart.
 */
let poisonFired = false;

function poison() {
  poisonFired = false;
  lifecycle.setRunner((file, args) => {
    poisonFired = true;
    throw new Error(
      'lifecycle.test.js tried to run a real command with no recorder installed: '
      + [file].concat(args || []).join(' ')
      + ' — call recorder() first',
    );
  });
}

/**
 * Assert that the test just run actually installed a recorder.
 *
 * Called from `afterEach`, so a test that forgot is caught at the end of ITS
 * OWN run and named, rather than passing quietly on a swallowed error.
 */
function assertRecorderWasUsed() {
  const fired = poisonFired;
  poisonFired = false;
  assert.equal(fired, false,
    'this test reached the poison runner: it acted without installing recorder() first, '
    + 'and lifecycle swallowed the error into an ordinary outcome, so whatever it asserted proved nothing');
}

poison();
test.afterEach(() => { assertRecorderWasUsed(); poison(); });

// ---------------------------------------------------------------------------
// Containment: these names become tmux targets and launchd services
// ---------------------------------------------------------------------------

test('a pane target is validated, never cleaned up into a usable one', () => {
  // ⚠️ Sanitising a target would mean acting on an agent the caller did not
  // name. Refusing is the only safe answer for anything unexpected.
  assert.equal(lifecycle.safeTarget('angel-discord:0.0'), 'angel-discord:0.0');
  assert.equal(lifecycle.safeTarget('claudebot-discord:1.2'), 'claudebot-discord:1.2');

  for (const bad of [
    '-X kill-server',          // leading dash: tmux would read it as an option
    'angel-discord:0.0; rm -rf /',
    'angel-discord',           // no pane
    'angel-discord:0',         // no pane index
    '$(whoami):0.0',
    '../other:0.0',
    '', null, undefined,
  ]) {
    assert.equal(lifecycle.safeTarget(bad), null, `${String(bad)} should be refused`);
  }
});

test('a service name is validated, never cleaned up', () => {
  assert.equal(lifecycle.safeServiceName('angel'), 'angel');
  for (const bad of ['../evil', 'Angel', 'an gel', 'angel;reboot', '-x', '', null]) {
    assert.equal(lifecycle.safeServiceName(bad), null, `${String(bad)} should be refused`);
  }
});

test('a refused target sends nothing at all', () => {
  const calls = recorder();
  const got = lifecycle.clear('angel', '-X kill-server');
  assert.equal(got.outcome, lifecycle.OUTCOME.REFUSED);
  assert.deepEqual(calls, [], 'a refused target still reached tmux');
});

// ---------------------------------------------------------------------------
// What each action actually does
// ---------------------------------------------------------------------------

test('clear and compact send their command and then Enter, separately', () => {
  // ⚠️ Two calls, not one. Sending "/clear\n" as a single argument types a
  // literal newline into the composer on some setups rather than submitting,
  // which leaves the command sitting there unsent while the caller believes it
  // ran.
  const calls = recorder();
  lifecycle.clear('angel', 'angel-discord:0.0');
  assert.deepEqual(calls, [
    ['tmux', 'send-keys', '-t', 'angel-discord:0.0', '/clear'],
    ['tmux', 'send-keys', '-t', 'angel-discord:0.0', 'Enter'],
  ]);

  const more = recorder();
  lifecycle.compact('angel', 'angel-discord:0.0');
  assert.equal(more[0][4], '/compact');
});

test('a send reports ASKED, never DONE', () => {
  // The keystrokes were delivered. Whether the agent acted on them is not
  // something this can see, and reporting `done` would be the product
  // asserting something it did not verify, on the screen whose whole job is
  // to be honest about consequences.
  recorder();
  const got = lifecycle.clear('angel', 'angel-discord:0.0');
  assert.equal(got.outcome, lifecycle.OUTCOME.ASKED);
  assert.notEqual(got.outcome, lifecycle.OUTCOME.DONE);
  assert.match(got.because, /does not report back/);
});

test('restart runs the blessed script with the bare agent name', () => {
  const calls = [];
  lifecycle.setRunner((file, args) => {
    calls.push([file, ...args]);
    return 'OK: angel-discord tmux session is running\nOK: bypass permissions is ON\n';
  });
  const got = lifecycle.restart('angel');
  assert.equal(got.outcome, lifecycle.OUTCOME.DONE);
  assert.deepEqual(calls, [[FAKE_SCRIPT, 'angel']]);
});

test('a restart the script could not confirm is ASKED, not DONE', () => {
  // ⚠️ The exit code is not the answer, and believing it was is the worst bug
  // this module has had.
  //
  // `restart-bot.sh` ends with `if tmux has-session; then echo OK; else echo
  // WARN; fi`, and under `set -euo pipefail` that WARN branch is still the last
  // command and still exits 0. So a bot that launchd started and that then died
  // on boot — including the missing-permissions-flag case this module exists to
  // prevent — came back as a clean exit.
  //
  // We reported `done`, "performed and verified", and the route then FORGOT the
  // agent's commitments on the strength of it: a false claim of success plus
  // irreversible data loss.
  lifecycle.setRunner(() => "WARN: tmux session 'angel-discord' not found — check launchd logs\n");
  const got = lifecycle.restart('angel');
  assert.equal(got.outcome, lifecycle.OUTCOME.ASKED, 'an unconfirmed restart reported as verified');
  assert.match(got.because, /has not come back/);

  // And silence is not confirmation either.
  lifecycle.setRunner(() => '');
  assert.equal(lifecycle.restart('angel').outcome, lifecycle.OUTCOME.ASKED);

  // ⚠️ Nor is a session that came back WITHOUT its permissions flag. That is
  // the silent-freeze failure this whole module exists to prevent, and a loose
  // `OK:` match reported it as verified success because the script's FIRST line
  // is also an OK.
  lifecycle.setRunner(() => 'OK: angel-discord tmux session is running\nWARN: bypass permissions not confirmed yet\n');
  const half = lifecycle.restart('angel');
  assert.equal(half.outcome, lifecycle.OUTCOME.ASKED, 'a bot with no permissions flag reported as verified');
  assert.match(half.because, /permission to work/);
});

test('restart refuses rather than improvising when the script is missing', () => {
  // ⚠️ The whole reason this path exists is that the obvious alternative
  // (`tmux kill-session` + `new-session`) silently produces a bot with no
  // permissions flag, which then freezes on its first prompt. A missing script
  // must STOP us, not route us around the rule it enforces.
  const missing = path.join(os.tmpdir(), 'aw-no-such-restart-script.sh');
  const real = process.env.AGENT_WORKFORCE_RESTART_SCRIPT;
  const calls = recorder();
  try {
    // The module read the path at load, so exercise the same guard by pointing
    // the module's own constant at nothing via a fresh require in a child of
    // this process is overkill; instead assert the guard's observable rule:
    // a script path that is not a file must refuse and run nothing.
    assert.ok(!fs.existsSync(missing), 'fixture is wrong: the missing path exists');
    const probe = require('node:child_process').execFileSync(process.execPath, ['-e', `
      process.env.AGENT_WORKFORCE_RESTART_SCRIPT = ${JSON.stringify(missing)};
      const l = require(${JSON.stringify(require.resolve('./lifecycle'))});
      let ran = 0;
      l.setRunner(() => { ran += 1; return ''; });
      const got = l.restart('angel');
      console.log(JSON.stringify({ outcome: got.outcome, because: got.because, ran }));
    `], { encoding: 'utf8', timeout: 10000 });
    const out = JSON.parse(probe.trim().split('\n').pop());
    assert.equal(out.outcome, lifecycle.OUTCOME.REFUSED);
    assert.equal(out.ran, 0, 'it tried to restart anyway');
    assert.match(out.because, /without its permissions/);
  } finally {
    process.env.AGENT_WORKFORCE_RESTART_SCRIPT = real;
    assert.deepEqual(calls, [], 'the parent process ran something');
  }
});

test('a failed command is refused with no errno and no path', () => {
  const calls = recorder({ throwOn: 'send-keys' });
  const got = lifecycle.clear('angel', 'angel-discord:0.0');
  assert.equal(got.outcome, lifecycle.OUTCOME.REFUSED);
  assert.ok(!/ENOENT|EACCES/.test(got.because), `leaked an errno: ${got.because}`);
  assert.ok(!got.because.includes('/'), `leaked a path: ${got.because}`);
  assert.ok(calls.length > 0, 'fixture is wrong: nothing was attempted');
});

test('an unknown action does nothing rather than guessing', () => {
  const calls = recorder();
  const got = lifecycle.perform('reboot', 'angel', 'angel-discord:0.0');
  assert.equal(got.outcome, lifecycle.OUTCOME.REFUSED);
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// The costs the screen shows
// ---------------------------------------------------------------------------

test('the cost of each action is stated by the engine, not by the screen', () => {
  // ⚠️ The editor shipped a version of this bug: the panel decided whether a
  // file was editable by regex-matching the engine's English, so rewording one
  // sentence would have silently changed behaviour. The costs live with the
  // code that performs the action.
  // ⚠️ NOT "nothing". `/compact` replaces the older conversation with a
  // summary, which is lossy by construction, and this card's premise is that
  // commitments live in the conversation. "Loses nothing" was the only cost
  // claim here that overstated safety, and it was what exempted compact from
  // the confirmation the other two require.
  assert.notEqual(lifecycle.ACTIONS.compact.loses, 'nothing',
    'the gentlest option must not claim to be free');
  assert.match(lifecycle.ACTIONS.compact.loses, /detail/);
  assert.equal(lifecycle.ACTIONS.clear.loses, 'everything it is holding');
  assert.equal(lifecycle.ACTIONS.restart.loses, 'everything it is holding');
  assert.equal(lifecycle.ACTIONS.compact.gentlest, true);
  assert.equal(lifecycle.ACTIONS.clear.gentlest, false);
  assert.equal(lifecycle.ACTIONS.restart.gentlest, false);
  // Restart is the only one that re-reads the instruction file, which is the
  // sentence that ties this card to the editor.
  assert.match(lifecycle.ACTIONS.restart.what, /re-reads its instructions/);
});

test('the real restart script exists and is executable', (t) => {
  // ⚠️ Asserts only that the blessed path is present. It is never RUN: this
  // machine has thirteen live agents and a test that restarts one is worse
  // than no test at all.
  const real = path.join(os.homedir(), '.claude', 'bin', 'restart-bot.sh');
  if (!fs.existsSync(real)) {
    // ⚠️ Say it out loud. A bare `return` here printed a green tick for a test
    // that asserted nothing, which is the failure mode this suite has already
    // been caught by: a skip that looks like a pass tells you the opposite of
    // what happened.
    t.skip('no restart script on this machine, so there is nothing to check');
    return;
  }
  const mode = fs.statSync(real).mode & 0o111;
  assert.notEqual(mode, 0, 'the restart script is not executable');
});

// ---------------------------------------------------------------------------
// Dry run: the only safe way to exercise this surface by hand
// ---------------------------------------------------------------------------

test('dry run performs nothing and says what it would have done', (t) => {
  // ⚠️ This test exists because of a real incident, not a hypothetical. While
  // probing these routes by hand I sent `/compact` to a live agent, and that
  // agent was the session doing the work: the command queued in its composer
  // and would have wiped the conversation the moment the turn ended.
  //
  // The cause is the interesting part. The two sandbox variables this codebase
  // already had redirect FILE roots, and every feature before this one touched
  // only files. tmux and launchd are global to the machine, so there was no
  // safe way to exercise these routes at all, and the plan's own rule ("no test
  // may restart, clear or compact a real agent") had no mechanism behind it.
  //
  // Run in a child so the flag is read at load, and assert the two things that
  // matter: nothing ran, and the answer says what would have.
  const probe = require('node:child_process').execFileSync(process.execPath, ['-e', `
    process.env.AGENT_WORKFORCE_DRY_RUN = '1';
    process.env.AGENT_WORKFORCE_RESTART_SCRIPT = ${JSON.stringify(FAKE_SCRIPT)};
    const l = require(${JSON.stringify(require.resolve('./lifecycle'))});
    let ran = 0;
    l.setRunner(() => { ran += 1; return ''; });
    const out = {
      clear: l.clear('angel', 'angel-discord:0.0'),
      compact: l.compact('angel', 'angel-discord:0.0'),
      restart: l.restart('angel'),
      ran,
    };
    console.log(JSON.stringify(out));
  `], { encoding: 'utf8', timeout: 10000 });
  const out = JSON.parse(probe.trim().split('\n').pop());

  assert.equal(out.ran, 0, 'dry run executed something');
  for (const action of ['clear', 'compact', 'restart']) {
    assert.equal(out[action].outcome, 'dry-run', `${action} was not a dry run`);
    assert.match(out[action].because, /nothing was (sent|done)/, action);
  }
  // And it still says which agent and which command, so a dry run is useful
  // rather than merely safe.
  assert.match(out.clear.because, /\/clear into angel-discord:0\.0/);
  assert.match(out.restart.because, /restarted angel/);
});

test('dry run is OFF by default, so it cannot mask a real action in production', () => {
  // The inverse of the test above, and the reason it matters: a flag that
  // defaulted on would make every action a no-op that reported success.
  assert.equal(lifecycle.DRY_RUN, false);
});

test('only a real destructive action invalidates the commitment record', () => {
  // ⚠️ Pins the decision that a `clear` or `restart` must forget what the agent
  // said it was holding.
  //
  // Leaving the record standing made the board go on asserting those
  // commitments at FULL confidence ("it reported these itself") for thirty
  // minutes, about work that no longer exists anywhere, and a cleared agent
  // will never correct it because it has forgotten it ever said them.
  //
  // The three exclusions each matter: compact summarises rather than empties;
  // a refusal did nothing; and a dry run did nothing either, so destroying a
  // real record while pretending to act would make the safety flag itself
  // destructive.
  const { OUTCOME, invalidatesCommitments: inv } = lifecycle;

  assert.equal(inv('clear', { outcome: OUTCOME.ASKED }), true);
  assert.equal(inv('restart', { outcome: OUTCOME.DONE }), true);

  assert.equal(inv('compact', { outcome: OUTCOME.ASKED }), false, 'compact does not empty the conversation');
  assert.equal(inv('compact', { outcome: OUTCOME.DONE }), false);

  assert.equal(inv('clear', { outcome: OUTCOME.REFUSED }), false, 'a refusal did nothing to forget');
  assert.equal(inv('restart', { outcome: OUTCOME.REFUSED }), false);

  assert.equal(inv('clear', { outcome: OUTCOME.DRY_RUN }), false, 'a dry run destroyed a real record');
  assert.equal(inv('restart', { outcome: OUTCOME.DRY_RUN }), false);
});

test('a two-part send that half-lands is not reported as harmless', () => {
  // ⚠️ `sendCommand` types the text, then Enter, as two calls. If the text
  // lands and the Enter throws, `/clear` is now SITTING IN THE COMPOSER of a
  // live agent, waiting for the next keypress or turn end to submit itself.
  //
  // That is not a hypothetical: it is the incident in this module's own header,
  // where a queued `/compact` would have wiped a conversation the moment the
  // turn ended. Reporting it as a clean refusal ("we could not reach that agent
  // to ask") is the screen saying nothing happened when something did.
  let n = 0;
  lifecycle.setRunner(() => { n += 1; if (n === 2) throw new Error('EPIPE'); return ''; });
  const got = lifecycle.clear('angel', 'angel-discord:0.0');
  assert.equal(got.outcome, lifecycle.OUTCOME.REFUSED);
  assert.match(got.because, /may be sitting in its composer/,
    'a half-sent command was reported as if nothing had happened');
});

test('only a pane that actually holds a running agent may be typed into', () => {
  // ⚠️ The roster comes from `tmux list-panes -a`, which is EVERY pane on the
  // machine. `/clear` and Enter typed into a plain shell is EXECUTED, not read
  // as a slash command, so "is this on the roster" is not the same question as
  // "may I type into this".
  //
  // Latent on this machine, where all thirteen sessions happen to be agents,
  // which is exactly why it needs a test rather than an observation.
  //
  // (The one-line refusal in the route that consumes this is pinned separately,
  // by `an agent waiting on a question is never typed into` in server.test.js.)
  const { isAgentPane } = require('./status');

  // The native install fronts as a strict three-segment version; an npm-global
  // install fronts as `node`. Both are the fleet's canonical rule, not one
  // invented here, and rejecting the legacy names silently removed this feature
  // for any agent on an npm install.
  assert.equal(isAgentPane({ session: 'angel-discord', command: '2.1.212', inMode: '0' }), true);
  assert.equal(isAgentPane({ session: 'angel-discord', command: 'node', inMode: '0' }), true);
  assert.equal(isAgentPane({ session: 'angel-discord', command: 'claude', inMode: '0' }), true);

  // ⚠️ Not while scrolled back in copy-mode: keystrokes go to copy-mode
  // bindings rather than the composer, so nothing would be cleared and the
  // route would still answer "we asked it to".
  assert.equal(isAgentPane({ session: 'angel-discord', command: '2.1.212', inMode: '1' }), false,
    'a pane scrolled back in copy-mode was treated as typeable');

  // ⚠️ And an ALLOWLIST on that field too. These earlier asserted `true` with
  // no `inMode` at all, which pinned the permissive reading of a missing value
  // — the test defending the guard was defending the hole. Anything that is not
  // an explicit "not in copy-mode" is refused.
  for (const missing of [undefined, '', null, '2', 'yes']) {
    assert.equal(isAgentPane({ session: 'angel-discord', command: '2.1.212', inMode: missing }), false,
      `an unreadable copy-mode flag (${JSON.stringify(missing)}) was treated as typeable`);
  }

  for (const [pane, why] of [
    [{ session: 'my-shell', command: '2.1.212' }, 'not a fleet session name'],
    [{ session: 'angel-discord', command: 'zsh' }, 'a shell, whatever it is called'],
    [{ session: 'angel-discord', command: 'bash' }, 'a shell'],
    [{ session: 'notes', command: 'vim' }, 'an editor in a non-fleet session'],
    // ⚠️ These are the ones that mattered. The first version merely excluded
    // six shell names, so INSIDE a fleet session every other command passed and
    // the comment claiming it stopped an editor or a REPL was false.
    [{ session: 'angel-discord', command: 'vim' }, 'an editor inside a fleet session'],
    // A two-segment number is excluded deliberately: the canonical rule is
    // strict three-segment, to avoid matching an unrelated numeric-named
    // process on the one check that decides whether we may type into a pane.
    [{ session: 'angel-discord', command: '2.1' }, 'a two-segment version'],
    [{ session: 'angel-discord', command: 'ssh' }, 'a remote shell inside a fleet session'],
    [{ session: 'angel-discord', command: 'less' }, 'a pager inside a fleet session'],
    [{ session: 'angel-discord', command: 'python3' }, 'python inside a fleet session'],
    [{ session: '', command: '2.1.212' }, 'no session'],
    [{}, 'nothing at all'],
  ]) {
    assert.equal(isAgentPane(pane), false, `${why} was treated as an agent pane`);
  }
});

test('a restart that fails after the stop is not reported as never attempted', () => {
  // ⚠️ `REFUSED` means "we did not attempt it", and `invalidatesCommitments`
  // relies on that to decide whether to tombstone the commitment record.
  //
  // `restart-bot.sh` runs `launchctl stop` unconditionally before anything can
  // fail, so a non-zero exit or a timeout almost always means the agent WAS
  // stopped and then something went wrong. Calling that "did not attempt"
  // skipped the tombstone, so the conversation was destroyed while the board
  // went on serving "it reported these itself" at full confidence.
  lifecycle.setRunner(() => { throw new Error('ETIMEDOUT'); });
  const got = lifecycle.restart('angel');
  assert.equal(got.outcome, lifecycle.OUTCOME.ASKED,
    'a failure after the stop was reported as never attempted');
  assert.match(got.because, /may have been stopped/);
  assert.equal(lifecycle.invalidatesCommitments('restart', got), true,
    'the record would have been left standing for a destroyed conversation');
});

test('a restart script that is not executable is refused, not reported as maybe-stopped', () => {
  // ⚠️ `statSync().isFile()` passes for a mode-644 script, so `execFileSync`
  // threw EACCES with NOTHING having run, and the catch reported `asked` —
  // "it may have been stopped" — which tombstones the commitment record. The
  // board then told you an agent's conversation had been cleared while it was
  // sitting there intact, and only a full fresh report would clear that.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-noexec-'));
  const script = path.join(dir, 'restart-bot.sh');
  fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  try {
    const probe = require('node:child_process').execFileSync(process.execPath, ['-e', `
      process.env.AGENT_WORKFORCE_RESTART_SCRIPT = ${JSON.stringify(script)};
      const l = require(${JSON.stringify(require.resolve('./lifecycle'))});
      let ran = 0;
      l.setRunner(() => { ran += 1; return ''; });
      const got = l.restart('angel');
      console.log(JSON.stringify({ outcome: got.outcome, ran, invalidates: l.invalidatesCommitments('restart', got) }));
    `], { encoding: 'utf8', timeout: 10000 });
    const out = JSON.parse(probe.trim().split('\n').pop());
    assert.equal(out.ran, 0, 'it tried to run a non-executable script');
    assert.equal(out.outcome, 'refused', 'a never-attempted restart reported as maybe-stopped');
    assert.equal(out.invalidates, false, 'it would have tombstoned an untouched agent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an agent showing a question is never typed into', () => {
  // ⚠️ The most dangerous thing in this feature, and the reason this decision
  // is a function rather than an inline check: it needs an agent that happens
  // to be sitting on a permission prompt, and no test can arrange that on a
  // live fleet.
  //
  // `clear` and `compact` send the command and then a bare `Enter`. On a
  // permission prompt the text is ignored by the select and the Enter CONFIRMS
  // THE HIGHLIGHTED OPTION, which is Yes. So the gentlest, visually-primary
  // button on a screen built to show you the cost of an action would instead
  // approve an arbitrary tool call nobody saw.
  const { mayTypeInto } = lifecycle;
  const ready = { isAgentPane: true, state: 'idle' };
  const asking = { isAgentPane: true, state: 'needs_you' };

  for (const action of ['clear', 'compact']) {
    assert.equal(mayTypeInto(action, ready).ok, true, `${action} refused a ready agent`);
    assert.equal(mayTypeInto(action, { isAgentPane: true, state: 'working' }).ok, true);

    const blocked = mayTypeInto(action, asking);
    assert.equal(blocked.ok, false, `${action} would have answered a permission prompt`);
    assert.match(blocked.because, /waiting on an answer/);

    // ⚠️ An ALLOWLIST, and this is the case that proves why. `classify` reports
    // ONE state from a priority-ordered list and tests the rate-limit markers
    // BEFORE the question markers, so a pane genuinely showing
    // `Do you want to proceed? ❯ 1. Yes` comes back as `rate_limited` the
    // moment the same tail also contains "rate limit" — which a Bash call
    // grepping for that phrase is enough to do. Measured, and two agents on
    // this board were `rate_limited` at the time.
    assert.equal(mayTypeInto(action, { isAgentPane: true, state: 'rate_limited' }).ok, false,
      `${action} typed into a pane whose real state a single label could not carry`);

    // And `unknown` is what `classify` returns when it could not read the pane
    // at all, which is exactly when we cannot see whether a prompt is showing.
    assert.equal(mayTypeInto(action, { isAgentPane: true, state: 'unknown' }).ok, false);
    assert.equal(mayTypeInto(action, { isAgentPane: true, state: 'stopped' }).ok, false);

    // And a pane we cannot vouch for at all.
    assert.equal(mayTypeInto(action, { isAgentPane: false, state: 'idle' }).ok, false);
    assert.equal(mayTypeInto(action, null).ok, false);
  }

  // Restart types nothing, so the waiting-on-a-question refusal does not apply
  // to it: an agent sitting on a permission prompt is restartable.
  assert.equal(mayTypeInto('restart', { isFleetSession: true, isNamedOurs: true, state: 'needs_you' }).ok, true);
  assert.equal(mayTypeInto('restart', { isFleetSession: true, isNamedOurs: true, state: 'unknown' }).ok, true);

  // ⚠️ And a CRASHED agent, which is the case restart matters most for. Gating
  // this on `isAgentSession` (which requires a live Claude process) refused a
  // dead agent in its own session with "we are not confident that card is one
  // of your agents" — untrue, and it removed the feature exactly where it is
  // needed. Switching the check back to `isAgentSession` fails here.
  assert.equal(mayTypeInto('restart',
    { isFleetSession: true, isNamedOurs: true, isAgentSession: false, isAgentPane: false, state: 'stopped' }).ok, true,
  'restart was refused for a crashed agent in its own session');

  // ⚠️ But it is NOT exempt from the is-this-really-one-of-my-agents refusal,
  // and it used to be. The roster is every tmux pane on the machine with the
  // `-discord` suffix merely STRIPPED, never required, so a plain shell in a
  // session called `mikey` appeared as an agent named `mikey`, and its Restart
  // button ran `restart-bot.sh mikey` against the REAL bot. The cost shown in
  // the dialog even looked correct, because it reads the real mikey's
  // commitments — the operator would have been acting on a card that was not
  // the thing being restarted.
  //
  // Deleting the `isFleetSession` check in `mayTypeInto` fails here. ⚠️ This
  // comment named `isAgentSession` while the code checks `isFleetSession` — the
  // stale-docstring defect this branch keeps producing, living in the very test
  // that pins the guard. A reader trusting it would "restore consistency" by
  // making restart require a live Claude process, re-breaking the crashed-agent
  // case pinned six lines above.
  assert.equal(mayTypeInto('restart', { isFleetSession: false, state: 'idle' }).ok, false,
    'restart fired at a pane that is not one of our agent sessions');
  assert.equal(mayTypeInto('restart', null).ok, false);
  assert.match(mayTypeInto('restart', { isFleetSession: false }).because, /not confident that card is one of your agents/);

  // ⚠️ And it asks `isFleetSession`, NOT `isAgentPane`. The difference is the
  // copy-mode clause, which exists because keystrokes go to copy-mode bindings
  // instead of the composer — irrelevant to an action that sends no keystrokes.
  // Swapping this check to `isAgentPane` would take restart away from any pane
  // the operator had scrolled back with a mouse wheel.
  assert.equal(mayTypeInto('restart',
    { isFleetSession: true, isNamedOurs: true, isAgentPane: false, state: 'idle' }).ok, true,
    'restart was refused for a pane that is merely scrolled back');

  // ⚠️ And the case NO tie-break can reach: the real agent is DEAD, so there is
  // no competing pane to outrank. `mikey-discord` is gone, someone has
  // `tmux new -s mikey` with Claude running, and that pane is the only candidate
  // for the name — it wins by default and `isFleetSession` passes via the
  // process arm. Restart would run `restart-bot.sh mikey` against the REAL
  // service while the card shows a stranger's pane, state and task line.
  //
  // Restart addresses the launchd SERVICE, not the pane, and only the suffixed
  // session name ties those two together. Deleting the `isNamedOurs` check in
  // `mayTypeInto` fails here.
  const inferredOnly = { isFleetSession: true, isAgentSession: true, isAgentPane: true, isNamedOurs: false, state: 'idle' };
  assert.equal(mayTypeInto('restart', inferredOnly).ok, false,
    'restart fired at the service for a name whose own session is not the pane we are showing');
  assert.match(mayTypeInto('restart', inferredOnly).because, /not the one this agent/);
});

test('a half-sent clear still invalidates the commitment record', () => {
  // ⚠️ `sendCommand` returns REFUSED when the text landed and the Enter did
  // not, saying the command "may be sitting in its composer unsent" — which
  // means the conversation may still be destroyed at the end of the turn.
  //
  // Treating that as "nothing happened" left the board asserting commitments
  // at full confidence about work that was about to stop existing. `restart`
  // already took the opposite branch for the identical we-may-have-done-it
  // case; the reasoning simply had not been carried across.
  let n = 0;
  lifecycle.setRunner(() => { n += 1; if (n === 2) throw new Error('EPIPE'); return ''; });
  const got = lifecycle.clear('angel', 'angel-discord:0.0');
  assert.equal(got.outcome, lifecycle.OUTCOME.REFUSED);
  assert.equal(lifecycle.invalidatesCommitments('clear', got), true,
    'a command left sitting in the composer would have left the record standing');

  // A refusal that genuinely sent nothing must NOT tombstone.
  const nothing = lifecycle.clear('angel', '-X kill-server');
  assert.equal(lifecycle.invalidatesCommitments('clear', nothing), false);
});

test('a missing launchd service is refused, not reported as maybe-stopped', () => {
  // ⚠️ `restart-bot.sh` exits 1 with "No launchd service found" BEFORE it
  // reaches `launchctl stop`, so that agent is genuinely untouched. Reporting
  // it as maybe-stopped tombstoned the commitment record of an agent nobody
  // had touched, and the board then said its conversation had been cleared
  // while it sat there intact.
  //
  // Reachable in ordinary use: restart is exempt from the is-this-an-agent
  // gate, and the roster is every pane on the machine, so any unrelated tmux
  // session gets a Restart button.
  lifecycle.setRunner(() => {
    const err = new Error('Command failed');
    err.stdout = "Error: No launchd service found for 'notanagent'\n";
    err.stderr = '';
    throw err;
  });
  const got = lifecycle.restart('notanagent');
  assert.equal(got.outcome, lifecycle.OUTCOME.REFUSED, 'an untouched agent reported as maybe-stopped');
  assert.match(got.because, /nothing to restart/);
  assert.equal(lifecycle.invalidatesCommitments('restart', got), false,
    'it would have tombstoned an agent it never touched');

  // Any OTHER failure is past the stop, so it must still tombstone.
  lifecycle.setRunner(() => { const e = new Error('ETIMEDOUT'); e.stdout = ''; e.stderr = ''; throw e; });
  const other = lifecycle.restart('angel');
  assert.equal(other.outcome, lifecycle.OUTCOME.ASKED);
  assert.equal(lifecycle.invalidatesCommitments('restart', other), true);
});
