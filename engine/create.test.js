'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING, because the module resolves its roots at load.
// This one matters more than usual: the thing under test MAKES DIRECTORIES,
// WRITES INSTRUCTION FILES and WRITES LAUNCHD JOBS. An unsandboxed run would
// litter the operator's real worker tree and `~/Library/LaunchAgents` with
// agents that then start on the next reboot.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-test-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./create');
const roles = require('./roles');

/**
 * A runner that records instead of executing.
 *
 * ⚠️ The DEFAULT is a poison runner that fails loudly, so a test which forgets
 * to install a recorder cannot quietly reach `execFileSync`. `lifecycle` learned
 * this the hard way: a forgotten recorder passed while proving nothing.
 */
function recorder() {
  const calls = [];
  create.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  return calls;
}
test.afterEach(() => { create.setRunner(null); });

// ─────────────────────────────────────────────────────────────────────────────
// Names
// ─────────────────────────────────────────────────────────────────────────────

test('a name that cannot address an agent is refused before anything is made', () => {
  // ⚠️ These are not style rules. Each one corresponds to a way the rest of the
  // system has already broken:
  //   - a name that sanitises to something else lets two names become one, and
  //     a request naming one reached the other.
  //   - a leading `_` survives safeKey and is refused by safeServiceName and
  //     safeTarget, so the agent is created and then unreachable.
  for (const bad of ['', '  ', 'My.Bot', 'MyBot', '_bot', '-bot', 'a', 'has space', 'emoji🙂']) {
    assert.ok(create.nameProblem(bad), `'${bad}' was accepted as a name`);
  }
  for (const good of ['casey', 'casey-2', 'my_bot', 'a1']) {
    assert.equal(create.nameProblem(good), null, `'${good}' was refused`);
  }
});

test('a refused name creates nothing at all', () => {
  const calls = recorder();
  const r = create.createAgent({ name: '_bot', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.equal(calls.length, 0, 'a refused name still ran a command');
  assert.ok(!fs.existsSync(create.workerDir('_bot')), 'a refused name still made a folder');
});

// ─────────────────────────────────────────────────────────────────────────────
// The safety interlock
// ─────────────────────────────────────────────────────────────────────────────

test('dry-run cannot be left without a runner in place', () => {
  create.setRunner(null);
  assert.throws(() => create.setDryRun(false), /refusing to leave dry-run/,
    'the escape hatch opened with nothing to catch the commands');

  // And installing a runner first makes it safe, in that order only.
  recorder();
  create.setDryRun(false);
  assert.equal(create.DRY_RUN, false);

  // ⚠️ Removing the runner RE-ARMS dry-run. Without this the reverse ordering
  // leaves the module able to reach execFileSync with nothing injected.
  create.setRunner(null);
  assert.equal(create.DRY_RUN, true, 'clearing the runner left the real one armed');
});

// ─────────────────────────────────────────────────────────────────────────────
// Creating
// ─────────────────────────────────────────────────────────────────────────────

test('creating an agent writes its folder, its instructions and its startup job', () => {
  const calls = recorder();
  create.setDryRun(false);

  const r = create.createAgent({ name: 'casey', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  assert.ok(fs.existsSync(create.instructionFile('casey')), 'no instruction file');
  const text = fs.readFileSync(create.instructionFile('casey'), 'utf8');
  assert.match(text, /You are casey, a project manager/,
    'the instructions were not written for this agent by name');

  assert.ok(fs.existsSync(create.plistPath('casey')), 'no launchd job');
});

test('the launchd job carries PATH and LANG, or the board reports nothing or nonsense', () => {
  // ⚠️ Both were found the hard way on this machine, hours apart:
  //   - without PATH, launchd cannot find tmux, every call fails silently, and
  //     the board serves 200 with ZERO agents.
  //   - without LANG, tmux sanitises its own format output and replaces the tab
  //     separators with underscores, so every agent parses as one garbage field
  //     named `angel-discord_0.0_2.1.223_0__ …`.
  // See issue #23. A generated job that omits either recreates a bug we have
  // already paid for.
  const plist = create.plistFor('casey', '/bin/claude', '/opt/homebrew/bin/tmux');
  assert.match(plist, /<key>PATH<\/key>/, 'the job has no PATH, so tmux will not be found');
  assert.match(plist, /opt\/homebrew\/bin/, 'the PATH omits Homebrew, where tmux actually is');
  assert.match(plist, /<key>LANG<\/key>/, 'the job has no LANG, so tmux will mangle its own output');
  assert.match(plist, /UTF-8/);
  assert.match(plist, /<key>KeepAlive<\/key>/, 'the agent will not come back if it dies');
  assert.match(plist, /<key>RunAtLoad<\/key>/, 'the agent will not survive a reboot');
});

test('the session is claimed for Kosmos, and claimed as ITSELF', () => {
  // ⚠️ A NAME OF ITS OWN. These tests share one sandbox, so reusing `casey`
  // meant the second creation was refused as a duplicate -- and the assertion
  // then failed for a reason that has nothing to do with claims. A test whose
  // fixture collides with another test's is testing the collision.
  // ⚠️ The claim is what makes an agent Kosmos creates recognisable without a
  // Discord naming convention. `status.isNamedOurs` requires the claim to match
  // the pane's own name -- a claim naming something else is somebody else's.
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ name: 'claimed-one', role: 'pm' });

  const claim = calls.find((c) => c[1] && c[1][0] === 'set-option');
  assert.ok(claim, 'the session was never claimed, so the board will not recognise it');
  assert.deepEqual(claim[1], ['set-option', '-t', 'claimed-one', '@kosmos_agent', 'claimed-one'],
    'the claim does not name this agent as itself');

  // And the board agrees.
  const status = require('./status');
  assert.equal(status.isNamedOurs({ session: 'claimed-one', name: 'claimed-one', claim: 'claimed-one' }), true,
    'the claim this writes is not the claim the board reads');
});

test('nothing reaches a shell', () => {
  // ⚠️ Every command is execFile with an argument array, so a name is ONE
  // argument and never text a shell could reinterpret. The name is validated
  // hard as well, which makes this belt and braces -- deliberately, because
  // this function makes launchd jobs.
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ name: 'shell-probe', role: 'pm' });

  assert.ok(calls.length > 0, 'nothing ran at all, so this proves nothing');
  for (const [file, args] of calls) {
    assert.ok(Array.isArray(args), `${file} was called without an argument array`);
    assert.doesNotMatch(file, /sh$|bash$|zsh$/, 'a shell was invoked');
    for (const a of args) {
      assert.equal(typeof a, 'string', 'a non-string argument reached a command');
    }
  }
});

test('an agent that will not start is reported as PARTIAL, not as created', () => {
  // ⚠️ "Created" is a claim about us; "it is running" is a claim about the
  // agent. A setup that wrote three files and could not start the session has
  // not given the person an agent, and saying so is the whole difference
  // between this product and a wizard that always says Done.
  create.setRunner((file, args) => {
    if (args && args[0] === 'new-session') return { ok: false, stderr: 'no server running' };
    return { ok: true };
  });
  create.setDryRun(false);

  const r = create.createAgent({ name: 'dud', role: 'writer' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a failed start was reported as success');
  assert.match(r.because, /could not start/);
  assert.ok(r.steps.some((s) => s.label === 'started it' && !s.ok),
    'the failing step is not visible in the record');
});

test('a session that starts but cannot be claimed is PARTIAL too', () => {
  // Because an unclaimed session is one the board will not recognise as ours --
  // it will render anonymous and refuse its own write routes. Reporting that as
  // success would hand someone an agent the product cannot manage.
  create.setRunner((file, args) => {
    if (args && args[0] === 'set-option') return { ok: false };
    return { ok: true };
  });
  create.setDryRun(false);

  const r = create.createAgent({ name: 'unclaimed', role: 'writer' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL);
  assert.match(r.because, /mark the session as ours/);
});

test('an existing agent is never quietly overwritten', () => {
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ name: 'twice', role: 'pm' });
  const before = fs.readFileSync(create.instructionFile('twice'), 'utf8');

  const second = create.createAgent({ name: 'twice', role: 'writer' });
  assert.equal(second.outcome, create.OUTCOME.REFUSED);
  assert.match(second.because, /already an agent/);
  assert.equal(fs.readFileSync(create.instructionFile('twice'), 'utf8'), before,
    'creating a second agent with the same name rewrote the first one’s instructions');
});

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

test('every role ships a suggested first action', () => {
  // ⚠️ Not a nicety. Without one, a role lands the person on a working agent and
  // a blank prompt -- the exact blank box the role library exists to remove. A
  // role without a first action is not finished.
  for (const r of roles.ROLES) {
    assert.ok(r.firstAction && r.firstAction.length > 10,
      `role '${r.key}' has no suggested first action`);
    assert.ok(r.instructions.includes('{{NAME}}'),
      `role '${r.key}' never names the agent, so every one of them is anonymous`);
    assert.ok(r.blurb, `role '${r.key}' has nothing to show on the picker`);
  }
});

test('Legal is deliberately absent, and the advice-shaped roles say so themselves', () => {
  // ⚠️ Pinned so its absence is a DECISION rather than an oversight someone
  // helpfully corrects. Framing covers Copyright and Finance; Legal is where a
  // wrong draft costs most, and it wants somebody with a real opinion on
  // liability before it ships. Josh has the call and has not made it.
  assert.equal(roles.byKey('legal'), null,
    'Legal was added without the liability wording being settled');

  const finance = roles.byKey('finance');
  assert.match(finance.instructions, /do not give financial advice/i,
    'the finance role does not state its own boundary, so the only thing holding '
    + 'it is a disclaimer the operator saw once during setup');
});

test('the instructions name the agent, and carry no template language', () => {
  const text = roles.instructionsFor('pm', 'casey');
  assert.match(text, /You are casey/);
  assert.doesNotMatch(text, /\{\{/, 'an unsubstituted placeholder shipped into an agent’s boot file');
  assert.equal(roles.instructionsFor('nosuch', 'casey'), null);
});
