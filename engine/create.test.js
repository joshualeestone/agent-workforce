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
// ⚠️ Fixture names are deliberately ones no real agent could have. The first
// version used `casey` -- which is a LIVE agent on this machine, with its own
// worker directory and running session. The sandbox held, so nothing happened;
// but a fixture that names a real agent means the day the sandbox slips, the
// test overwrites that agent's boot file instead of failing. Checking for
// leakage afterwards was also useless with that name, because the directory it
// would have created already existed for real reasons.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-test-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./create');

/**
 * ⚠️ The programs an agent is made of, pinned to something that exists
 * everywhere.
 *
 * `createAgent` now refuses when Claude or tmux is not where it expects — which
 * is right, and which made this suite depend on the machine running it having
 * Claude at `~/.local/bin/claude`. A test that passes because of what happens
 * to be installed is not testing the thing it names. Every creation here passes
 * its own, and the refusal has a test of its own below.
 */
const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };

/**
 * ⚠️ ARM DRY-RUN AT LOAD, before any test can run.
 *
 * The module header used to claim it was "dry-run by default". It is not:
 * `DRY_RUN` starts from an environment variable nothing sets, so a fresh
 * process with no runner installed executes for real — which is exactly what
 * the SERVER needs and exactly what a test must never have. The guarantee this
 * file depends on was only ever written down, and it happened to hold because
 * the first test installs a recorder.
 *
 * `setRunner(null)` re-arms dry-run, so this one line makes it true by
 * construction: any creation reaching `execFileSync` before a recorder is
 * installed is now impossible rather than merely unlikely.
 */
create.setRunner(null);
const roles = require('./roles');
const status = require('./status');

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
/**
 * ⚠️ And the ROSTER is sandboxed too, for the same reason the directories are.
 *
 * `createAgent` now asks the board which names are already running, and the
 * real answer on this machine is thirteen live agents. Left unsandboxed, every
 * test here would depend on which agents happen to be up while somebody runs
 * the suite — and a fixture name that collided with a real one would be refused
 * for a reason no assertion mentions. An EMPTY board is the default; the tests
 * that are about the roster set their own.
 */
test.beforeEach(() => { status.setPaneSource(() => ''); });
test.afterEach(() => { create.setRunner(null); status.setPaneSource(null); });

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
  for (const good of ['fixture-agent', 'casey-2', 'my_bot', 'a1']) {
    assert.equal(create.nameProblem(good), null, `'${good}' was refused`);
  }
});

test('a refused name creates nothing at all', () => {
  const calls = recorder();
  const r = create.createAgent({ ...BINS, name: '_bot', role: 'pm' });
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

  const r = create.createAgent({ ...BINS, name: 'fixture-agent', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  assert.ok(fs.existsSync(create.instructionFile('fixture-agent')), 'no instruction file');
  const text = fs.readFileSync(create.instructionFile('fixture-agent'), 'utf8');
  assert.match(text, /You are \*\*fixture-agent\*\*, a project manager/,
    'the instructions were not written for this agent by name');

  assert.ok(fs.existsSync(create.plistPath('fixture-agent')), 'no launchd job');
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
  const plist = create.plistFor('fixture-agent', '/bin/claude', '/opt/homebrew/bin/tmux');
  assert.match(plist, /<key>PATH<\/key>/, 'the job has no PATH, so tmux will not be found');
  assert.match(plist, /opt\/homebrew\/bin/, 'the PATH omits Homebrew, where tmux actually is');
  assert.match(plist, /<key>LANG<\/key>/, 'the job has no LANG, so tmux will mangle its own output');
  assert.match(plist, /UTF-8/);
  assert.match(plist, /<key>KeepAlive<\/key>/, 'the agent will not come back if it dies');
  assert.match(plist, /<key>RunAtLoad<\/key>/, 'the agent will not survive a reboot');
});

test('the session is claimed for Kosmos, and claimed as ITSELF, at every start', () => {
  // ⚠️ A NAME OF ITS OWN. These tests share one sandbox, so reusing `casey`
  // meant the second creation was refused as a duplicate -- and the assertion
  // then failed for a reason that has nothing to do with claims. A test whose
  // fixture collides with another test's is testing the collision.
  // ⚠️ The claim is what makes an agent Kosmos creates recognisable without a
  // Discord naming convention. `status.isNamedOurs` requires the claim to match
  // the pane's own name -- a claim naming something else is somebody else's.
  //
  // ⚠️ This used to assert a `set-option` COMMAND, run once at creation. That
  // was not enough and the test's own subject was the reason: the claim is a
  // tmux user option, so it dies with the session. Set once, it survived until
  // the first reboot and then the agent came back anonymous -- no role, no
  // model, no editable instructions -- which is precisely the blocker this
  // branch exists to remove, returning on its own after one restart. So the
  // claim now lives in the startup SCRIPT, which is what runs at every start,
  // and that is what this asserts.
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'claimed-one', role: 'pm' });

  const script = fs.readFileSync(create.launcherFile('claimed-one'), 'utf8');
  assert.match(script, /set-option -t "\$TARGET" @kosmos_agent "\$SESSION"/,
    'the startup script does not claim the session, so the board will stop '
    + 'recognising this agent the first time it restarts');
  assert.match(script, /SESSION='claimed-one'/, 'the script does not name this agent as itself');

  // And the board agrees that this is a claim.
  assert.equal(status.isNamedOurs({ session: 'claimed-one', name: 'claimed-one', claim: 'claimed-one' }), true,
    'the claim this writes is not the claim the board reads');

  // ⚠️ And the script must OUTLIVE the command that starts the session.
  // `tmux new-session -d` exits in a tenth of a second; with KeepAlive that
  // makes launchd restart the job forever, each restart failing on the session
  // the last one made, while the agent looks fine because the first attempt
  // worked. Measured against the thirteen agents already running on this
  // machine, whose own launcher carries this loop and says why.
  assert.match(script, /while .*has-session/,
    'nothing keeps the job alive, so launchd will respawn it in a loop forever');
  assert.match(script, /kill-session/,
    'a restart will collide with the session the previous run made');
  assert.match(script, /--dangerously-skip-permissions/,
    'the agent will start, look healthy, and freeze on its first permission prompt');

  // The job has to RUN that script, not the thing it replaced.
  const plist = fs.readFileSync(create.plistPath('claimed-one'), 'utf8');
  assert.match(plist, /start\.sh/, 'the job does not run the startup script');
  assert.doesNotMatch(plist, /new-session/,
    'the job still starts tmux itself, which is the respawn loop this replaced');

  // Executable, or "a real file you can run" is true only for us.
  assert.ok(fs.statSync(create.launcherFile('claimed-one')).mode & 0o100,
    'the startup script is not executable');
});

test('the agent is started the same way it will be started every time after', () => {
  // ⚠️ ONE PATH. The previous version ran tmux itself and left the launchd job
  // on disk unloaded: the agent ran now and was gone after a reboot, and the
  // session a person got at creation was set up by different code from the one
  // they would have for the rest of the agent's life. Starting it any other way
  // means the first run is the only one anybody ever tested.
  const calls = recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'one-path', role: 'pm' });

  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(calls.length, 1, 'creation ran more than the one command that starts the agent');
  const [file, args] = calls[0];
  assert.match(file, /launchctl$/, 'the agent was started by something other than its own job');
  assert.equal(args[0], 'bootstrap', 'the job was not loaded, so the agent will not survive a reboot');
  assert.match(args[2], /com\.kosmos\.agent\.one-path\.plist$/, 'a different job was loaded');
});

test('nothing reaches a shell', () => {
  // ⚠️ Every command is execFile with an argument array, so a name is ONE
  // argument and never text a shell could reinterpret. The name is validated
  // hard as well, which makes this belt and braces -- deliberately, because
  // this function makes launchd jobs.
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'shell-probe', role: 'pm' });

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
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'Load failed: 5: Input/output error' };
    return { ok: true };
  });
  create.setDryRun(false);

  const r = create.createAgent({ ...BINS, name: 'dud', role: 'writer' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a failed start was reported as success');
  assert.match(r.because, /could not start/);
  assert.ok(r.steps.some((s) => s.label === 'started it' && !s.ok),
    'the failing step is not visible in the record');

  // ⚠️ And the files it DID write are still reported as written. A person whose
  // agent did not start needs to know what is on their computer -- "it all
  // failed" would be as untrue as "it all worked".
  assert.ok(r.steps.some((s) => s.label === 'wrote its instructions' && s.ok),
    'the steps that succeeded were erased by the one that failed');
});

// ⚠️ REMOVED: 'a session that starts but cannot be claimed is PARTIAL too'.
// It pinned an outcome that no longer exists rather than one that stopped being
// checked. The claim used to be a command Kosmos ran after starting the session,
// so it could fail on its own; it is now a line in the startup script, run by
// the job, after this function has returned. There is no moment at which we
// have a started session and a failed claim to report. What replaces it is
// stronger and lives in the claim test above: the line must be IN the script,
// so it runs at every start rather than once. The board seeing the agent as
// ours is what confirms it worked, and the creation screen watches for exactly
// that before it says the agent is up.

test('an existing agent is never quietly overwritten', () => {
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'twice', role: 'pm' });
  const before = fs.readFileSync(create.instructionFile('twice'), 'utf8');

  const second = create.createAgent({ ...BINS, name: 'twice', role: 'writer' });
  assert.equal(second.outcome, create.OUTCOME.REFUSED);
  assert.match(second.because, /already an agent called twice/);
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

test('the roles where being wrong is expensive carry their limit in BOTH places', () => {
  // ⚠️ Legal was held out of the first set until the liability wording was
  // settled. Josh settled it on 2026-08-10: ship it, "but when they pick it out
  // say that it's not legal advice from a lawyer, same with the other roles we
  // greyed out". So the condition of shipping is the sentence being visible AT
  // THE MOMENT OF CHOICE.
  //
  // Both places, and each covers what the other cannot. The `caution` is what
  // the PERSON reads while choosing, before any work exists to be wrong about.
  // The instruction line is what the AGENT reads, every time it starts, long
  // after any setup screen has been clicked through. A role with only one of
  // them has a limit that either nobody sees or nobody follows.
  for (const [key, mustSay] of [
    ['legal', /not a lawyer|not legal advice/i],
    ['finance', /not financial advice/i],
  ]) {
    const role = roles.byKey(key);
    assert.ok(role, `${key} is missing entirely`);
    assert.ok(role.caution, `${key} has no caution, so its limit is invisible while choosing it`);
    assert.match(role.caution, mustSay, `${key}'s caution does not say what it is not`);
    assert.match(role.instructions, /not a lawyer|do not give (financial|legal) advice/i,
      `${key} does not state its own boundary, so the only thing holding it is a `
      + 'sentence the operator read once');
  }

  // ⚠️ And the roles that DO NOT need one must not have it. A caution on every
  // role is a caution nobody reads -- the same reason the provenance marker was
  // taken off every card.
  for (const key of ['pm', 'ea', 'writer', 'researcher']) {
    assert.ok(!roles.byKey(key).caution,
      `${key} carries a caution, and a warning on everything warns about nothing`);
  }
});

test('the instructions name the agent, and carry no template language', () => {
  const text = roles.instructionsFor('pm', 'fixture-agent');
  assert.match(text, /You are \*\*fixture-agent\*\*/,
    'the agent is not named the way the board reads names — see the identity '
    + 'test below, which is what this emphasis is for');
  assert.doesNotMatch(text, /\{\{/, 'an unsubstituted placeholder shipped into an agent’s boot file');
  assert.equal(roles.instructionsFor('nosuch', 'fixture-agent'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// The name has to be free on the BOARD, not only on disk
// ─────────────────────────────────────────────────────────────────────────────

test('a name a live session already answers to is refused, even with no folder', () => {
  const calls = recorder();

  // ⚠️ The session is `casey-discord`; the board calls that agent `casey`,
  // because the roster STRIPS the suffix without requiring it. So creating
  // `casey` here makes two sessions with one name — the collision
  // `onePanePerSession` exists to survive, manufactured by us.
  //
  // Measured before this gate existed: the creation screen watched for a
  // session called `casey`, found the fleet's existing one, and reported
  // "casey is running" over a creation that had done nothing whatsoever.
  status.setPaneSource(() => 'casey-discord\t0.0\t2.1.212\t0\t\tidle');
  const taken = create.createAgent({ ...BINS, name: 'casey', role: 'pm' });

  assert.equal(taken.outcome, create.OUTCOME.REFUSED, 'a name already on the board was accepted');
  assert.match(taken.because, /already an agent called casey/);
  assert.equal(calls.length, 0, 'a refused name still started a session');
  assert.ok(!fs.existsSync(create.workerDir('casey')), 'a refused name still made a folder');

  // ⚠️ THE CONTROL. Same name, same runner, same everything except an empty
  // board. Without it, a `createAgent` that refused `casey` for some unrelated
  // reason — or refused everything — would pass every assertion above.
  status.setPaneSource(() => '');
  const free = create.createAgent({ ...BINS, name: 'casey', role: 'pm' });
  assert.equal(free.outcome, create.OUTCOME.CREATED,
    'the refusal above was not caused by the roster, so this test proves nothing about it');
});

test('a machine we cannot ask about running agents is refused, not risked', () => {
  // ⚠️ FAIL CLOSED. "We could not check" is not "the name is free", and this is
  // the one place where guessing wrong makes a second agent under a live name.
  //
  // Both real shapes of the failure are exercised: `sh()` swallows a dead or
  // missing tmux and returns NULL, which `paneRoster` turns into a throw, and a
  // source that throws outright. The null one is the shape production actually
  // takes — a guard whose closed path only an injected throw can reach is not a
  // guard, which is exactly how the board's own tmux gate was found wrong.
  for (const [label, source] of [
    ['tmux answered nothing', () => null],
    ['tmux could not be run at all', () => { throw new Error('spawn ENOENT'); }],
  ]) {
    const calls = recorder();
    status.setPaneSource(source);
    const r = create.createAgent({ ...BINS, name: 'fixture-blind', role: 'pm' });

    assert.equal(r.outcome, create.OUTCOME.REFUSED, `${label}: created an agent anyway`);
    assert.match(r.because, /could not check which agents are already running/);
    assert.equal(calls.length, 0, `${label}: ran a command despite refusing`);
    assert.ok(!fs.existsSync(create.workerDir('fixture-blind')),
      `${label}: made a folder despite refusing`);
    create.setRunner(null);
  }

  // The control again: the same name goes through the moment the board answers.
  const calls = recorder();
  status.setPaneSource(() => '');
  assert.equal(create.createAgent({ ...BINS, name: 'fixture-blind', role: 'pm' }).outcome,
    create.OUTCOME.CREATED,
    'this name is refused whatever tmux says, so the assertions above are about nothing');
  assert.ok(calls.length > 0, 'a creation that reported success ran no commands');
});

test('the one place a name becomes shell text cannot carry anything a shell would read', () => {
  // ⚠️ NEW SURFACE, and it is worth being explicit about. Every command this
  // module runs is still `execFile` with an argument array, but it now GENERATES
  // a bash script with the agent's name in it, and a generated script is text a
  // shell will read. There is no supervising the agent without one: launchd
  // must run something that outlives `tmux new-session -d`.
  //
  // So the safety is the validator, and this pins it as a PROPERTY rather than
  // as a list of attacks I happened to think of: anything `nameProblem` accepts
  // is made only of lower-case letters, digits, hyphen and underscore — a set
  // with no quote, no space, no metacharacter, no newline.
  const alphabet = ' \t\n\'"`$();|&<>*?![]{}\\/#~^%+=:,.@abzAZ09_-';
  let accepted = 0;
  for (const ch of alphabet) {
    for (const candidate of [`a${ch}b`, `${ch}ab`, `ab${ch}`]) {
      if (create.nameProblem(candidate) === null) {
        accepted += 1;
        // ⚠️ The property is about the name that gets USED, not the one that was
        // typed. The first version compared the raw candidate and failed on
        // ' ab' — which was a real finding, not a bad assertion: `nameProblem`
        // trimmed privately and `createAgent` trimmed again, so the validator
        // was answering about a string nobody would use and safety rested on
        // every caller happening to trim the same way. `cleanName` is now the
        // one trim, and this asserts the thing that actually matters.
        assert.match(create.cleanName(candidate), /^[a-z0-9][a-z0-9_-]*$/,
          `'${candidate}' was accepted as a name and would reach the startup script as shell text`);
      }
    }
  }
  // ⚠️ The anti-vacuity check. If the loop above accepted NOTHING the assertions
  // inside it never ran, and a `nameProblem` that refused everything would pass
  // this test while breaking the product.
  assert.ok(accepted > 0, 'no candidate was accepted, so the assertions above never ran');

  // And it is quoted anyway, on top of a validator that has already made the
  // quoting unnecessary.
  assert.match(create.launcherFor('safe-name', '/bin/claude', '/opt/homebrew/bin/tmux'),
    /SESSION='safe-name'/, 'the name is not quoted in the generated script');
});

test('the board can read the identity the creation writes, for every role', () => {
  // ⚠️ THE COUPLING, tested from both ends and for every role rather than for
  // the one I happened to try. `roles` writes the instruction file; `status`
  // parses it to answer "who is this agent". Nothing but this test connects
  // them, and when they disagreed every created agent arrived on the board as
  // an anonymous machine name with no role — the product's own first-run
  // outcome, broken by a missing pair of asterisks in a template.
  //
  // Asserting the PROPERTY (the board derives a name and a role) rather than
  // the format: a template may be reworded freely, and a rewording that makes
  // the agent unreadable has to fail here.
  const calls = recorder();
  create.setDryRun(false);

  for (const role of roles.ROLES) {
    const name = `ident-${role.key}`;
    const made = create.createAgent({ ...BINS, name, role: role.key });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);

    const identity = status.readIdentity(name);
    assert.equal(identity.derived, true,
      `${role.key}: the board cannot work out who this agent is, so its card will `
      + 'show a raw session name flagged as a machine name');
    assert.equal(identity.displayName, name, `${role.key}: the board reads a different name`);
    assert.ok(identity.role && identity.role.length > 2,
      `${role.key}: the board reads no role from the file this role wrote`);
  }
  assert.ok(calls.length >= roles.ROLES.length, 'no agent was actually created, so this proves nothing');
});

test('an agent is refused when the programs it is made of are not on this machine', () => {
  // ⚠️ Without this, creation reported CREATED, the screen waited thirty
  // seconds and then said it did not know why, and launchd was left respawning
  // an instantly-failing job every thirty seconds for as long as the machine
  // was on. The defaults are THIS machine's paths -- an npm-global Claude or an
  // Intel Mac's Homebrew is enough to hit it.
  const calls = recorder();
  create.setDryRun(false);

  for (const [what, bins] of [
    ['Claude', { claudeBin: '/nope/claude', tmuxBin: '/bin/echo' }],
    ['tmux', { claudeBin: '/bin/echo', tmuxBin: '/nope/tmux' }],
  ]) {
    const r = create.createAgent({ ...bins, name: 'no-binary', role: 'pm' });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, `${what} missing: created anyway`);
    assert.match(r.because, /could not find/);
    assert.ok(!fs.existsSync(create.workerDir('no-binary')), `${what} missing: made a folder anyway`);
    assert.equal(calls.length, 0, `${what} missing: ran a command anyway`);
  }

  // A path that could break out of the shell text it is written into is refused
  // on its shape rather than on whether it happens to exist.
  const nasty = create.createAgent({
    claudeBin: "/bin/echo';id;'", tmuxBin: '/bin/echo', name: 'no-binary', role: 'pm',
  });
  assert.equal(nasty.outcome, create.OUTCOME.REFUSED, 'a path carrying shell syntax was accepted');

  // THE CONTROL: the same name goes through with both programs present.
  assert.equal(create.createAgent({ ...BINS, name: 'no-binary', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever the paths, so the above proves nothing');
});

test('a write that fails stops the creation instead of loading a job that cannot work', () => {
  // ⚠️ Only the folder and the start gated the outcome, so a failed write still
  // returned CREATED -- "set up and starting" over an agent whose startup
  // script was never written. That is worse than untrue: bash exits at once on
  // a missing script and KeepAlive restarts it, so the machine gets a job that
  // fails every thirty seconds forever. And the screen built on this told the
  // person "the folder and the instructions are on your computer either way",
  // which is false in exactly the case that produced it.
  const calls = recorder();
  create.setDryRun(false);

  const realWrite = fs.writeFileSync;
  try {
    fs.writeFileSync = (file, ...rest) => {
      if (String(file).endsWith('start.sh')) throw new Error('disk full');
      return realWrite(file, ...rest);
    };
    const r = create.createAgent({ ...BINS, name: 'half-made', role: 'pm' });

    assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a half-written agent was reported as created');
    assert.match(r.because, /could not write everything/);
    assert.ok(r.steps.some((s) => s.label === 'wrote its startup script' && !s.ok),
      'the failing step is not visible in the record');
    assert.equal(calls.length, 0,
      'the job was loaded anyway, so launchd now retries a missing script every thirty seconds');
  } finally {
    fs.writeFileSync = realWrite;
  }

  // THE CONTROL: with writing working, the same name is created and the job IS
  // loaded -- otherwise this test would pass against a createAgent that refused
  // everything.
  const calls2 = recorder();
  const ok = create.createAgent({ ...BINS, name: 'half-made-2', role: 'pm' });
  assert.equal(ok.outcome, create.OUTCOME.CREATED, ok.because);
  assert.equal(calls2.length, 1, 'the control did not actually load a job');
});

test('the startup script will not kill a session it cannot prove is ours', () => {
  // ⚠️ The kill was unconditional, and it runs at every login and after every
  // crash -- so a person who happened to have a tmux session of this name would
  // have had it destroyed with no warning by a job installed weeks earlier. The
  // board refuses to act on any pane it cannot tie to a name; a script that
  // kills one is that rule broken from the outside.
  const script = create.launcherFor('careful', '/bin/echo', '/bin/echo');

  const kill = script.split('\n').findIndex((l) => l.includes('kill-session'));
  const check = script.split('\n').findIndex((l) => l.includes('@kosmos_agent') && l.includes('show-options'));
  assert.ok(check > -1, 'the script never checks whose session it is about to kill');
  assert.ok(check < kill, 'the kill happens before the check, so the check cannot stop it');

  // And it WAITS rather than exiting: exiting would have launchd restart it
  // every thirty seconds against a session it must not touch. The poll is short
  // because the screen only waits thirty seconds in total, so a name that frees
  // up must not cost more than that before the agent starts.
  assert.match(script, /sleep 5\n/, 'nothing waits for the other session to end');
  assert.match(script, /waiting rather than killing it/, 'nothing says why the agent has not started');
});

test('the startup script names its session exactly, not by prefix', () => {
  // ⚠️ tmux's default target resolution falls back to a PREFIX MATCH. Measured
  // on this machine: with only `angel-discord` running, `tmux has-session -t
  // ang` exits 0 and `-t "=ang"` correctly fails. So an agent named `sam`
  // created beside a `samantha-discord` session would find the WRONG session in
  // its wait loop, read a claim that can never equal its own name, and sleep
  // forever -- and once its own session ended, the supervision loop would never
  // exit, so launchd would never bring it back. Two silent hangs, both invisible
  // to the screen, which can only say "it has not come up".
  //
  // The creation-time roster check cannot catch this: it compares exact names in
  // JavaScript, and the prefix match happens later, inside tmux.
  const script = create.launcherFor('sam', '/bin/echo', '/bin/echo');
  assert.match(script, /TARGET="=sam"/, 'the script does not build an exact-match target');

  for (const line of script.split('\n')) {
    // Commands only. A comment mentioning the hazard is not one.
    if (line.trim().startsWith('#') || !/-t /.test(line)) continue;
    assert.match(line, /-t "\$TARGET"/,
      `a tmux target is resolved by prefix rather than exactly: ${line.trim()}`);
  }

  // The session is CREATED with the plain name -- `new-session -s` takes a
  // literal, and an `=` there would become part of the name.
  assert.match(script, /new-session -d -s "\$SESSION"/,
    'the session is created with the match syntax in its name');
});

test('the refusals that protect a name are each reachable and each tested', () => {
  // ⚠️ Two of these could have been DELETED with the whole suite green, which
  // is the same as not having them. A guard nothing exercises is a comment.
  const calls = recorder();
  create.setDryRun(false);

  // A name ending in -discord. The board files that agent under the stripped
  // name, so it collides with a real agent AND its own card is anonymous.
  assert.match(create.nameProblem('angel-discord') || '', /-discord/,
    'a name the board would file under somebody else was accepted');
  assert.equal(create.createAgent({ ...BINS, name: 'angel-discord', role: 'pm' }).outcome,
    create.OUTCOME.REFUSED);

  // A leftover launchd job with no folder: the exact state the README tells
  // people to expect, because removing an agent is still manual.
  const orphan = 'orphan-job';
  fs.mkdirSync(nodePath.dirname(create.plistPath(orphan)), { recursive: true });
  fs.writeFileSync(create.plistPath(orphan), '<plist/>', 'utf8');
  const refused = create.createAgent({ ...BINS, name: orphan, role: 'pm' });
  assert.equal(refused.outcome, create.OUTCOME.REFUSED,
    'a name whose launchd job is still installed was accepted, so the plist gets '
    + 'overwritten and bootstrap then fails with the wrong reason');
  assert.match(refused.because, /still set to start/);
  assert.equal(calls.length, 0, 'a refused name still ran a command');

  // THE CONTROL: with the job gone, the same name goes through.
  fs.rmSync(create.plistPath(orphan));
  assert.equal(create.createAgent({ ...BINS, name: orphan, role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever is on disk, so the above proves nothing');
});

test('a length problem says it is a length problem', () => {
  // A person who typed one character was told to use letters, numbers, hyphens
  // and underscores -- a rule they had not broken, with nothing pointing at the
  // one they had.
  assert.match(create.nameProblem('a'), /two characters/);
  assert.match(create.nameProblem('x'.repeat(33)), /32 characters/);
  // And the character rule still answers for a character problem.
  assert.match(create.nameProblem('has space'), /letters, numbers/);
});

/**
 * Run the generated startup script for real, against a fake tmux.
 *
 * ⚠️ The tests above assert the script's TEXT — that a check appears before a
 * kill, that a `sleep 5` exists somewhere. That is not the same as asserting
 * behaviour, and the gap is exactly wide enough to hide the bug: move
 * `kill-session` out of the ours-branch and into the loop body and the
 * destroy-a-stranger's-session defect is fully restored with those assertions
 * green. This is the one generated artifact on this branch that can end a live
 * agent, so it gets exercised rather than read.
 *
 * The fake records every call and answers from a scripted world. `has-session`
 * answers yes once and no afterwards, so every loop in the script terminates.
 */
function runLauncher({ claim, paneCommands }) {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'launcher-'));
  const log = nodePath.join(dir, 'calls.log');
  const fake = nodePath.join(dir, 'tmux');
  fs.writeFileSync(fake, `#!/bin/bash
echo "$@" >> ${JSON.stringify(log)}
case "$1" in
  has-session)
    # Present the first time only, so both loops terminate.
    if [ -f ${JSON.stringify(nodePath.join(dir, 'seen'))} ]; then exit 1; fi
    touch ${JSON.stringify(nodePath.join(dir, 'seen'))}
    exit 0
    ;;
  show-options) echo ${JSON.stringify(claim)}; exit 0 ;;
  list-panes) printf '%s\\n' ${paneCommands.map((c) => JSON.stringify(c)).join(' ')}; exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });

  const script = nodePath.join(dir, 'start.sh');
  fs.writeFileSync(script, create.launcherFor('probe', '/bin/echo', fake), { mode: 0o755 });
  require('node:child_process').execFileSync('/bin/bash', [script], { timeout: 20000, stdio: 'pipe' });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  fs.rmSync(dir, { recursive: true, force: true });
  return calls;
}

test('the startup script, actually run, never kills a session that is not ours', () => {
  // Somebody else's session is sitting on the name.
  const calls = runLauncher({ claim: 'somebody-else', paneCommands: ['zsh'] });
  assert.ok(!calls.some((c) => c.startsWith('kill-session')),
    "the script killed a session it could not prove was ours, which is somebody's "
    + 'work destroyed by a job installed weeks earlier');
  // ⚠️ The claim must never land on a session we did not create. It is fine for
  // it to happen AFTER a new-session -- the stranger's session ended, we waited
  // it out, and the one we then made is ours. What must never happen is a claim
  // with no creation before it.
  //
  // The first version of this assertion said the claim must not appear at all,
  // which was simply false about correct behaviour: the fake reports the
  // session gone on the second look, so the script rightly proceeds. A
  // behavioural test can assert the wrong thing as easily as a textual one, and
  // this one found that out on its first run.
  const claimAt = calls.findIndex((c) => c.includes('@kosmos_agent probe'));
  const createdAt = calls.findIndex((c) => c.startsWith('new-session'));
  if (claimAt > -1) {
    assert.ok(createdAt > -1 && createdAt < claimAt,
      "the script stamped our claim on a session it did not create, which the next "
      + 'run would then recognise as ours and kill');
  }
});

test('the startup script, actually run, adopts a healthy agent instead of restarting it', () => {
  // Ours, and Claude is running in it. Killing it here throws away the
  // conversation -- and this file tells people they can run it by hand.
  const calls = runLauncher({ claim: 'probe', paneCommands: ['2.1.227'] });
  assert.ok(!calls.some((c) => c.startsWith('kill-session')),
    'a healthy running agent was killed and restarted, losing everything it remembered');
  assert.ok(!calls.some((c) => c.startsWith('new-session')),
    'a second session was started over a healthy one');
  assert.ok(calls.some((c) => c.includes('@kosmos_agent probe')),
    'the adopted session was left unclaimed, so the board will not recognise it');

  // ⚠️ And a session where every pane is a shell IS restarted -- otherwise
  // "adopt" would mean "never recover a crashed agent", which is worse than the
  // bug it fixes.
  const crashed = runLauncher({ claim: 'probe', paneCommands: ['zsh', 'bash'] });
  assert.ok(crashed.some((c) => c.startsWith('kill-session')),
    'an agent that crashed back to a shell was adopted rather than restarted');
  assert.ok(crashed.some((c) => c.startsWith('new-session')), 'nothing was restarted');

  // ⚠️ A session with a shell in ONE pane and Claude in another is ALIVE. The
  // probe read only the current window's first pane, so splitting a window or
  // opening a second one -- which this script's own header invites -- made a
  // live agent look crashed.
  const split = runLauncher({ claim: 'probe', paneCommands: ['zsh', '2.1.227'] });
  assert.ok(!split.some((c) => c.startsWith('kill-session')),
    'an agent with a shell open beside it was killed as though it had crashed');
});

test('every name this module accepts is one the rest of the system can address', () => {
  // ⚠️ `NAME_RE` is a SECOND encoding of a rule that lives in `store.safeKey`,
  // and the header of this module cites that rule as the reason it exists. It
  // is currently strictly stricter, so it holds -- but nothing asserted the
  // relationship, so a future tightening of `safeKey` would break the invariant
  // with the whole suite green. Two definitions of one fact, unpinned, is the
  // defect this codebase keeps paying for.
  const store = require('./store');
  const candidates = ['ab', 'a1', 'my_bot', 'casey-2', 'x'.repeat(32),
    'agent-one', '9lives', 'a-b_c-1'];
  let accepted = 0;
  for (const name of candidates) {
    if (create.nameProblem(name) !== null) continue;
    accepted += 1;
    assert.equal(store.safeKey(name), name,
      `'${name}' is accepted here but is not its own key, so a route naming it `
      + 'would resolve somewhere else');
  }
  assert.ok(accepted > 0, 'nothing was accepted, so the assertions above never ran');
});
