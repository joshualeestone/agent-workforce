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

test.afterEach(() => lifecycle.setRunner(null));

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

test('the real restart script exists and is executable', () => {
  // ⚠️ Asserts only that the blessed path is present. It is never RUN: this
  // machine has thirteen live agents and a test that restarts one is worse
  // than no test at all.
  const real = path.join(os.homedir(), '.claude', 'bin', 'restart-bot.sh');
  if (!fs.existsSync(real)) return; // not a fleet machine
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

  assert.equal(inv('clear', OUTCOME.ASKED), true);
  assert.equal(inv('restart', OUTCOME.DONE), true);

  assert.equal(inv('compact', OUTCOME.ASKED), false, 'compact does not empty the conversation');
  assert.equal(inv('compact', OUTCOME.DONE), false);

  assert.equal(inv('clear', OUTCOME.REFUSED), false, 'a refusal did nothing to forget');
  assert.equal(inv('restart', OUTCOME.REFUSED), false);

  assert.equal(inv('clear', OUTCOME.DRY_RUN), false, 'a dry run destroyed a real record');
  assert.equal(inv('restart', OUTCOME.DRY_RUN), false);
});
