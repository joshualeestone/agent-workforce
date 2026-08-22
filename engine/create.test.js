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
/* ⚠️ AND A SANDBOXED HOME, because `setAccount` asks `accounts.js` which
   accounts exist, and `accounts.js` resolves its home at REQUIRE time. Without
   this the account tests would read the operator's real `~/.claude*` -- so they
   would pass or fail depending on whose machine ran them, which is not a test.
   (`create.js` keeps using `os.homedir()` for the plist's own HOME variable;
   that is the agent's real home and is deliberately not sandboxed here.) */
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
// ⚠️ AND THE SUPPORT ROOT, which is where the SHARED supervisor is installed.
// Without it these tests wrote into the operator's real
// `~/Library/Application Support/AgentWorkforce`, and the refresh test
// deliberately overwrote the live supervisor with a one-line comment before
// putting it back. An interrupted run would have left every created agent's
// launchd job pointing at a file that is a comment: bash exits at once,
// KeepAlive respawns it every thirty seconds forever. That is word for word the
// harm this branch exists to prevent, manufactured by its own test, and nothing
// cleaned that path up because it was outside the sandbox.
//
// It also made two assertions vacuous: `existsSync(supervisorPath())` passed off
// a PREVIOUS run's leftovers whatever this creation did.
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
// ⚠️ AND THE FOURTH ROOT, added the day creation started answering Claude
// Code's trust question. Without it every successful creation in this suite
// READ AND REWROTE THE OPERATOR'S OWN ~/.claude.json — a 100KB file holding
// their account, their MCP servers and 22 projects' settings — adding a
// trusted entry for a fixture directory in /var/folders that will not exist an
// hour later. Three roots sandboxed and one live is the exact shape of the
// last time this went wrong.
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
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
 * The supervisor as SHIPPED, read from disk.
 *
 * ⚠️ These tests used to assert against a string this module generated per
 * agent. There is no such string any more: there is one file, checked in, that
 * every agent's job runs with its own arguments. So the tests read the artifact
 * that actually runs — which is also the only version that can be reviewed
 * once.
 */
function supervisorText() {
  return fs.readFileSync(create.supervisorSource(), 'utf8');
}

/**
 * The argument vector the launchd job actually passes, read out of the plist.
 *
 * ⚠️ Read rather than restated. The order in which `plistFor` writes those
 * strings and the order `agent-supervisor.sh` reads them are one contract with
 * two ends, and nothing else in the suite pins it: swapping two of them starts
 * every real agent with its working directory as its session name, and every
 * assertion here would still pass.
 */
function jobArguments(name) {
  const plist = create.plistFor(name, '/bin/echo', '/opt/homebrew/bin/tmux');
  const block = plist.slice(plist.indexOf('<array>'), plist.indexOf('</array>'));
  return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]).slice(1);
}

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
const fleet = require('../test-support/fleet');
// The profile store, which is where a created agent's DISPLAY name is recorded.
const store = require('./store');

/**
 * A runner that records instead of executing.
 *
 * ⚠️ The DEFAULT is a poison runner that fails loudly, so a test which forgets
 * to install a recorder cannot quietly reach `execFileSync`. A forgotten
 * recorder passes while proving nothing, which is how this was learned.
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
  for (const bad of ['', '  ', 'My.Bot', '_bot', '-bot', 'a', 'has space', 'emoji🙂']) {
    assert.ok(create.nameProblem(bad), `'${bad}' was accepted as a name`);
  }
  // ⚠️ A CAPITAL IS NO LONGER A REFUSAL, and `MyBot` moved from the list above
  // to this one on purpose. It used to be answered with "use lower case, so the
  // name is the same everywhere it appears" — a true sentence about the
  // machinery, and the wrong thing to say to somebody naming a colleague. The
  // capital is now the DISPLAY name and `slugFor` supplies the machine one, so
  // `Casey` is a name you can type and `My.Bot` is still refused because its
  // slug is not a name we can build an agent out of.
  for (const good of ['fixture-agent', 'casey-2', 'my_bot', 'a1', 'MyBot', 'Casey']) {
    assert.equal(create.nameProblem(good), null, `'${good}' was refused`);
  }
});

test('the display name and the machine name differ ONLY in case, which is what makes the split safe', () => {
  /**
   * ⚠️ THE LOAD-BEARING PROPERTY OF 6b. The display name is written into the
   * instruction file an agent boots from — the most powerful write in the
   * product — so if it could differ from the slug by anything other than case,
   * this feature would have opened an injection surface into that file.
   *
   * It cannot, and the reason is that `nameProblem` validates the SLUG against
   * `NAME_RE`, which admits only `[a-z0-9_-]`. Lower-casing is the only
   * transform between the two, so an accepted display name is made of exactly
   * those characters with some upper-cased. Asserted as a property over the
   * same alphabet the shell-safety test uses, rather than trusted.
   */
  const alphabet = ' \t\n\'"`$();|&<>*?![]{}\\/#~^%+=:,.@abzAZ09_-*';
  let accepted = 0;
  for (const ch of alphabet) {
    for (const candidate of [`a${ch}b`, `${ch}ab`, `ab${ch}`, `A${ch}B`]) {
      if (create.nameProblem(candidate) !== null) continue;
      accepted += 1;
      const shown = create.cleanName(candidate);
      /* ⚠️ Pinned to the CANDIDATE, not to each other (round 37). The old
         assertion here was `shown.toLowerCase() === slugFor(candidate)`,
         and since `slugFor` is defined as `cleanName(x).toLowerCase()` that
         reduces to an identity no implementation of `cleanName` can fail --
         the load-bearing property was held by nothing. The raw candidate is
         the independent reference: the display name must be the typed name
         (trimmed, nothing stripped), and the machine name must be exactly
         that lower-cased. A `cleanName` that started STRIPPING (the safeKey
         hole: `My.Bot` silently becoming the agent `mybot`) now fails both
         lines instead of passing both. */
      assert.equal(shown, candidate.trim(),
        `'${candidate}' is shown as something other than what was typed`);
      assert.equal(create.slugFor(candidate), candidate.trim().toLowerCase(),
        `'${candidate}' is shown as something that is not just the machine name in another case`);
      assert.match(shown, /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
        `'${candidate}' would put something other than a name into the file an agent boots from`);
    }
  }
  assert.ok(accepted > 0, 'no candidate was accepted, so the assertions above never ran');
});

test('a refused name creates nothing at all', () => {
  const calls = recorder();
  // ⚠️ LEAVE DRY-RUN, or the filesystem half of this test cannot fail.
  // `afterEach` calls `setRunner(null)`, which re-arms dry-run, and `recorder()`
  // does not clear it -- so `createAgent` writes nothing even on a fully
  // successful path, and "a refused name still made a folder" passes whether or
  // not the refusal fired. It would still pass with the refusal moved to AFTER
  // the writes. That is the exact self-satisfying shape this file's own
  // comments condemn elsewhere.
  create.setDryRun(false);
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
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'claimed-one', role: 'pm' });

  const script = supervisorText();
  assert.match(script, /set-option -t "\$SESSION" @kosmos_agent "\$SESSION"/,
    'the startup script does not claim the session, so the board will stop '
    + 'recognising this agent the first time it restarts');
  // The AGENT is now an argument rather than baked in, so what pins "as itself"
  // is the job passing this agent's name and the script claiming "$SESSION".
  const plist = fs.readFileSync(create.plistPath('claimed-one'), 'utf8');
  assert.match(plist, /<string>claimed-one<\/string>/,
    'the job does not tell the supervisor which agent it is for');

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

  // The job has to RUN the shared supervisor, not a per-agent copy.
  assert.match(plist, /agent-supervisor\.sh/, 'the job does not run the supervisor');
  assert.doesNotMatch(plist, /new-session/,
    'the job still starts tmux itself, which is the respawn loop this replaced');
  assert.ok(!fs.existsSync(nodePath.join(create.workerDir('claimed-one'), 'start.sh')),
    'a per-agent copy of the supervisor is still being written, so a fix here '
    + 'would reach only the agents created afterwards');

  // Installed, in one place, executable.
  assert.ok(fs.existsSync(create.supervisorPath()), 'the supervisor was never installed');
  assert.ok(fs.statSync(create.supervisorPath()).mode & 0o100, 'the supervisor is not executable');
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
  // ⚠️ Exactly ONE command STARTS anything. The other call is the read-only
  // `launchctl print` probe that asks whether this name already has a service
  // loaded, so it is excluded by name rather than by count -- counting alone
  // would have to be edited every time a read is added, which is how a count
  // assertion stops meaning what it says.
  const starting = calls.filter(([, a]) => a && a[0] !== 'print');
  assert.equal(starting.length, 1, 'creation ran more than the one command that starts the agent');
  const [file, args] = starting[0];
  assert.match(file, /launchctl$/, 'the agent was started by something other than its own job');
  assert.equal(args[0], 'bootstrap', 'the job was not loaded, so the agent will not survive a reboot');
  assert.match(args[2], /com\.kosmos\.agent\.one-path\.plist$/, 'a different job was loaded');
});

test('no COMMAND is handed to a shell to reinterpret', () => {
  // ⚠️ Renamed from "nothing reaches a shell", which stopped being true when
  // this module started generating one. What holds here is narrower and still
  // worth pinning: every command it RUNS goes through execFile with an argument
  // array. The generated script is covered by the behavioural tests below.
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

  const r = create.createAgent({ ...BINS, name: 'dud', role: 'writer', displayName: 'Dudley' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a failed start was reported as success');
  assert.match(r.because, /could not start/);
  assert.ok(r.steps.some((s) => s.label === 'started it' && !s.ok),
    'the failing step is not visible in the record');
  // ⚠️ And NO display-name record survives the rollback (round 25): the
  // profile write used to happen mid-flow, and rollBack removes the plist
  // and worker dir but deliberately not profiles -- so a rolled-back
  // creation left "Dudley" waiting to dress any future agent under the
  // same slug. The write now happens only at CREATED.
  assert.equal(store.readProfile('dud').displayName, undefined,
    'a rolled-back creation left a display name for an agent that never existed');

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
  // ⚠️ EVERY cautioned role, DERIVED, each with the boundary its own
  // instructions must state -- and a cautioned role with no entry here FAILS
  // rather than slipping through, so the next caution added to the catalogue
  // arrives with its instruction half or arrives red. (Review round 1: the
  // literal three-key list left five cautions unpinned, and one of them --
  // support -- really did promise "never replies" while its instructions
  // never said so.)
  const BOUNDARY = {
    legal: /not a lawyer/i,
    finance: /do not give financial advice/i,
    // books is deliberately parallel to finance and not identical: recording
    // where analysis models, each caution saying the true thing about each
    // (catalogue build, 2026-08-16).
    books: /do not give financial or tax advice/i,
    ea: /draft, never send/i,
    social: /draft, never post/i,
    sales: /they send it, always/i,
    support: /draft, never send/i,
    recruiting: /every hiring decision is theirs/i,
    // Josh ruled autonomous briefing (2026-08-18). The pinned invariant
    // survives every wording of it: the PM does not attempt work outside
    // its skill -- it briefs the agent who has it.
    pm: /brief the agent who has\s+it rather than attempting it badly/i,
  };
  for (const role of roles.ROLES.filter((r) => r.caution)) {
    const mustSay = BOUNDARY[role.key];
    assert.ok(mustSay,
      `${role.key} carries a caution with no boundary expectation registered `
      + 'here; add one, because an unpinned caution is how a role ships '
      + 'promising what its agent was never told');
    assert.match(role.instructions, mustSay,
      `${role.key} does not state its own boundary, so the only thing holding `
      + 'it is a sentence the operator read once');
    // ⚠️ POSITIVE CONTROL, per the catalogue audit that produced two false
    // readings in one pass: a boundary check that cannot fail is the next
    // thing to quietly stop working. Removing the matched boundary from a
    // COPY must un-match it -- if the pattern still matches the stripped
    // text, it was matching something other than the boundary.
    assert.ok(!mustSay.test(role.instructions.replace(mustSay, '')),
      `${role.key}'s boundary pattern matches more than the boundary, so `
      + 'deleting the boundary would leave this check green');
  }
  // The choice-time halves for the two roles whose wording is a shipping
  // condition (Josh, 2026-08-10) stay pinned exactly:
  assert.match(roles.byKey('legal').caution, /not a lawyer|not legal advice/i);
  assert.match(roles.byKey('finance').caution, /not financial advice/i);

  // ⚠️ And the roles that DO NOT need one must not have it. A caution on every
  // role is a caution nobody reads -- the same reason the provenance marker was
  // taken off every card.
  // ea moved OUT of this list with the 2026-08-16 catalogue: it gained the
  // draft-never-send caution (the send-on-your-behalf roles all carry one).
  // pm moved OUT 2026-08-17 (Mona Lisa's ruling, 493b79d): its blurb is
  // the one in the catalogue claiming it acts on other agents, and until
  // agent-to-agent messaging (#51) exists that claim needs the same
  // caution the other overstating blurbs carry.
  // The rule this loop holds is unchanged: most roles carry none, so the
  // ones that do still mean something. 9 of 26 have one.
  for (const key of ['writer', 'researcher', 'engineer', 'data', 'design']) {
    assert.ok(!roles.byKey(key).caution,
      `${key} carries a caution, and a warning on everything warns about nothing`);
  }
  assert.ok(roles.ROLES.filter((r) => r.caution).length < roles.ROLES.length / 2,
    'more than half the catalogue carries a caution, and a warning on most things warns about nothing');
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
  create.setDryRun(false);   // or the folder assertion below cannot fail
  status.setPaneSource(() => fleet.line({ session: 'casey-discord', title: 'idle' }));
  const taken = create.createAgent({ ...BINS, name: 'casey', role: 'pm' });

  assert.equal(taken.outcome, create.OUTCOME.REFUSED, 'a name already on the board was accepted');
  assert.match(taken.because, /something called casey is already running/);
  assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
    'a refused name still started a session');
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
    create.setDryRun(false);   // or the folder assertion below cannot fail
    status.setPaneSource(source);
    const r = create.createAgent({ ...BINS, name: 'fixture-blind', role: 'pm' });

    assert.equal(r.outcome, create.OUTCOME.REFUSED, `${label}: created an agent anyway`);
    assert.match(r.because, /could not check which agents are already running/);
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
      `${label}: ran a command despite refusing`);
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

test('a name never becomes shell text, and the validator still holds if it ever does', () => {
  // ⚠️ THE SURFACE IS GONE, which is the main thing the shared supervisor buys
  // beyond reviewability. The name used to be interpolated into a generated
  // bash script; it is now an ARGUMENT, so nothing about it is ever read by a
  // shell. The assertions at the bottom pin that it stayed gone.
  //
  // The property below is kept anyway. It is what the safety rested on before,
  // it costs nothing, and the name still becomes a directory, a service label
  // and a tmux session: anything `nameProblem` accepts is made only of
  // lower-case letters, digits, hyphen and underscore — a set with no quote, no
  // space, no metacharacter, no newline.
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
        // ⚠️ `slugFor`, NOT `cleanName`, and the change is the whole of 6b in
        // one line. The name that becomes a directory, a service label and a
        // tmux session is the SLUG; `cleanName` now answers with the display
        // name, capitals and all. Asserting the display name here would be this
        // test measuring a string the machine never uses — which is the failure
        // shape `test-support/fleet` exists to make impossible one file over.
        assert.match(create.slugFor(candidate), /^[a-z0-9][a-z0-9_-]*$/,
          `'${candidate}' was accepted as a name, and it still becomes a directory, `
          + 'a service label and a tmux session');
      }
    }
  }
  // ⚠️ The anti-vacuity check. If the loop above accepted NOTHING the assertions
  // inside it never ran, and a `nameProblem` that refused everything would pass
  // this test while breaking the product.
  assert.ok(accepted > 0, 'no candidate was accepted, so the assertions above never ran');

  // ⚠️ AND THE SURFACE STAYED CLOSED. The supervisor takes its agent as an
  // argument, so there is nothing to quote and nothing to escape. A future
  // version that goes back to writing the name into the script would put the
  // whole class back, and this is what would notice.
  const script = supervisorText();
  assert.match(script, /SESSION="\$\{1/, 'the supervisor does not take its agent as an argument');
  assert.doesNotMatch(script, /SESSION='/,
    'the supervisor interpolates a name into shell text again, which is the surface '
    + 'removing the per-agent script was meant to close');
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
    // own refuses without a label by design (its own test); the identity
    // property still has to hold for its example text.
    const made = create.createAgent({ ...BINS, name, role: role.key,
      ...(role.key === 'own' ? { label: 'Own Thing' } : {}) });
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
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
      `${what} missing: ran a command anyway`);
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
      if (String(file).endsWith('CLAUDE.md')) throw new Error('disk full');
      return realWrite(file, ...rest);
    };
    const r = create.createAgent({ ...BINS, name: 'half-made', role: 'pm' });

    assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a half-written agent was reported as created');
    assert.match(r.because, /could not write everything/);
    assert.ok(r.steps.some((s) => s.label === 'wrote its instructions' && !s.ok),
      'the failing step is not visible in the record');
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
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
  assert.equal(calls2.filter(([, a]) => a && a[0] !== 'print').length, 1,
    'the control did not actually load a job');
});

test('the startup script will not kill a session it cannot prove is ours', () => {
  // ⚠️ The kill was unconditional, and it runs at every login and after every
  // crash -- so a person who happened to have a tmux session of this name would
  // have had it destroyed with no warning by a job installed weeks earlier. The
  // board refuses to act on any pane it cannot tie to a name; a script that
  // kills one is that rule broken from the outside.
  const script = supervisorText();

  // ⚠️ The ORDER of these two lines is no longer asserted here, and that is a
  // correction rather than a loss. Comparing line indexes matched the words
  // inside a comment the moment one mentioned `kill-session`, and it could
  // never have caught the thing it was written for anyway: moving the kill out
  // of the ours-branch keeps the order and restores the bug. The behavioural
  // test below RUNS this script against a fake tmux and asserts no kill
  // reaches a session that is not ours, which is the real guarantee. What is
  // left here is the presence of the parts, which is worth pinning cheaply.
  assert.ok(script.includes('@kosmos_agent'), 'the script never checks whose session it is');
  assert.ok(script.includes('kill-session'), 'the script can never replace a crashed agent');

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
  const script = supervisorText();
  assert.match(script, /TARGET="=\$SESSION"/,
    'the supervisor does not build an exact-match target from the agent it was given');

  // ⚠️ MEASURED, not assumed, on tmux 3.6a: `has-session` and `kill-session`
  // accept the exact-match "=name" form, and `set-option`, `show-options` and
  // `list-panes` REJECT it ("no such session: =name"). Using it everywhere
  // looked more careful and broke the claim on a real agent -- the board then
  // showed a created agent as anonymous, which is the blocker this branch
  // exists to remove, reintroduced by its own fix.
  //
  // So the property is per-command, and it is asserted per-command rather than
  // as one blanket rule that would be wrong half the time.
  // ⚠️ Re-measured after the first version of this list put `list-panes` in the
  // wrong column. It accepts the exact form; the probe that said otherwise had
  // been run against an already-dead session, so it failed for a reason
  // unrelated to the syntax. A test that encodes a wrong measurement fails a
  // CORRECT change, which is worse than not testing the line at all.
  const EXACT = ['has-session', 'kill-session', 'list-panes'];
  const PLAIN = ['set-option', 'show-options'];
  let checked = 0;
  for (const line of script.split('\n')) {
    if (line.trim().startsWith('#') || !/-t /.test(line)) continue;
    const cmd = (line.match(/"\$TMUX_BIN" ([a-z-]+)/) || [])[1];
    if (EXACT.includes(cmd)) {
      checked += 1;
      assert.match(line, /-t "\$TARGET"/,
        `${cmd} resolves its target by PREFIX, so it can act on another session: ${line.trim()}`);
    } else if (PLAIN.includes(cmd)) {
      checked += 1;
      assert.match(line, /-t "\$SESSION"/,
        `${cmd} rejects the "=name" form outright ("no such session: =name"), so `
        + `this line would fail at runtime: ${line.trim()}`);
    }
  }
  assert.ok(checked >= 5, 'no tmux target lines were checked, so this proves nothing');

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
  // people to expect. (Remove exists now and deletes nothing, so the halves can
  // still come apart; what is still manual is DELETE.)
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

  // ⚠️ The SHIPPED script, run with the argument vector DERIVED FROM THE JOB.
  //
  // Hardcoding the order here would have been two definitions of one fact:
  // swap `name` and `workerDir` in `plistFor` and every test stays green while
  // every real agent is started with its working directory as its session name.
  // So the harness reads the plist the product actually writes, and substitutes
  // only the two paths it needs to redirect (the fake tmux, and this run's
  // directory). If the order ever changes, this changes with it or fails.
  // ⚠️ Install first, so the harness does not depend on an earlier test in this
  // file having created an agent. It ran the INSTALLED copy while every textual
  // assertion read the repo file, which worked only by order.
  create.installSupervisor();
  const argv = jobArguments('probe').map((a) => {
    if (a === create.workerDir('probe')) return nodePath.join(dir, 'work');
    if (a === '/opt/homebrew/bin/tmux') return fake;
    return a;
  });
  require('node:child_process').execFileSync('/bin/bash', argv, { timeout: 20000, stdio: 'pipe' });
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
  // ⚠️ `-zsh` WITH THE DASH is what a login shell reports, and it is the
  // spelling the status engine uses as its canonical crashed-pane value. A
  // denylist that missed it adopted a crashed agent instead of restarting it,
  // and the supervision loop then kept the launchd job "running" forever, so
  // KeepAlive could never recover it. A permanently dead agent that looks
  // supervised is worse than one that is plainly down.
  const crashed = runLauncher({ claim: 'probe', paneCommands: ['-zsh', 'bash'] });
  assert.ok(crashed.some((c) => c.startsWith('kill-session')),
    'an agent that crashed back to a shell was adopted rather than restarted');
  assert.ok(crashed.some((c) => c.startsWith('new-session')), 'nothing was restarted');

  // ⚠️ A session with a shell in ONE pane and Claude in another is ALIVE. The
  // probe read only the current window's first pane, so splitting a window or
  // opening a second one -- which this script's own header invites -- made a
  // live agent look crashed.
  // ⚠️ AN EDITOR IS NOT CLAUDE. The probe used a denylist of shell names, so a
  // crashed agent whose remaining pane held vim, less, ssh or python3 read as
  // alive: the script adopted a dead agent and sat in the supervision loop, and
  // launchd's KeepAlive could never recover it because the job looked healthy.
  // The status engine already paid for this exact defect and replaced its
  // denylist with an allowlist; this is that same definition.
  // ⚠️ `1.2.3.4` and `1a.2b.3c` are in this list because the first version
  // matched with a GLOB, which accepts both, while the definition it claimed
  // parity with is `^[0-9]+\.[0-9]+\.[0-9]+$`. A looser copy of a definition,
  // beside a comment asserting they are the same, in the place where being
  // loose means supervising a dead agent forever.
  for (const leftover of ['vim', 'less', 'ssh', 'python3', '-zsh', '1.2.3.4', '1a.2b.3c']) {
    const dead = runLauncher({ claim: 'probe', paneCommands: [leftover] });
    assert.ok(dead.some((c) => c.startsWith('kill-session')),
      `a pane running ${leftover} was read as a live agent, so a crashed one is never recovered`);
  }

  const split = runLauncher({ claim: 'probe', paneCommands: ['zsh', '2.1.227'] });
  assert.ok(!split.some((c) => c.startsWith('kill-session')),
    'an agent with a shell open beside it was killed as though it had crashed');

  // ⚠️ And a tmux that will not say what is running is NOT a reason to destroy
  // anything. An empty answer read as "every pane is a shell", so a failed
  // list-panes became grounds for killing a session we had just confirmed is
  // ours -- "I cannot see it" turned into "it is dead", which is the inversion
  // this whole codebase exists to prevent.
  const blind = runLauncher({ claim: 'probe', paneCommands: [] });
  assert.ok(!blind.some((c) => c.startsWith('kill-session')),
    'a session was killed because tmux would not say what was running in it');
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

test('a creation that fails leaves nothing behind, so the same name can be tried again', () => {
  // ⚠️ TWO half-states shipped before this, and both were worse than the
  // failure they followed:
  //
  //   - a failed write left the FOLDER, so the next attempt at that name was
  //     refused for the folder's existence -- permanently, from a screen whose
  //     own button says "Start over".
  //   - a failed `bootstrap` left the PLIST, and launchd loads every plist in
  //     that directory at the next login. An agent the person was told is "not
  //     running yet" was in fact installed to start at their next login, with
  //     --dangerously-skip-permissions, and nothing said so.
  const realWrite = fs.writeFileSync;
  try {
    recorder();
    create.setDryRun(false);
    fs.writeFileSync = (file, ...rest) => {
      if (String(file).endsWith('CLAUDE.md')) throw new Error('disk full');
      return realWrite(file, ...rest);
    };
    const halfWritten = create.createAgent({ ...BINS, name: 'rollback-a', role: 'pm' });
    assert.equal(halfWritten.outcome, create.OUTCOME.PARTIAL);
    assert.ok(!fs.existsSync(create.workerDir('rollback-a')), 'the folder was left behind');
    assert.ok(!fs.existsSync(create.plistPath('rollback-a')), 'the launchd job was left behind');
  } finally {
    fs.writeFileSync = realWrite;
  }

  // The same name goes through afterwards, which is the point.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'rollback-a', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'a failed attempt blocked the name it failed on');

  // And a failed START rolls back too.
  create.setRunner((file, args) => (args && args[0] === 'bootstrap'
    ? { ok: false } : { ok: true, stdout: '' }));
  create.setDryRun(false);
  const notStarted = create.createAgent({ ...BINS, name: 'rollback-b', role: 'pm' });
  assert.equal(notStarted.outcome, create.OUTCOME.PARTIAL);
  assert.ok(!fs.existsSync(create.plistPath('rollback-b')),
    'a job that could not be started was left installed, so it starts at the next login anyway');
  // ⚠️ And UNLOADED, not just deleted. `bootstrap` can register a service and
  // still exit non-zero; removing the plist alone would leave that job
  // respawning against a start.sh this rollback just deleted, while every retry
  // of the name hits the already-loaded refusal -- so "you can try that name
  // again" would be false forever.
  const bootouts = [];
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootout') bootouts.push(args[1]);
    return args && args[0] === 'bootstrap' ? { ok: false } : { ok: true, stdout: '' };
  });
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'rollback-c', role: 'pm' });
  assert.ok(bootouts.some((t) => String(t).endsWith('com.kosmos.agent.rollback-c')),
    'the service this creation installed was left loaded after the start failed');
  assert.ok(!fs.existsSync(create.workerDir('rollback-b')), 'the folder was left behind');
  assert.match(notStarted.because, /try that name again/);
});

test('a name whose startup job is loaded with nothing on disk is refused by name', () => {
  // ⚠️ This is what the README's own removal recipe produces if the `rm` runs
  // without the `bootout`, or before it. Without this check the creation goes
  // ahead, `bootstrap` fails with "service already bootstrapped", the rollback
  // deletes the plist it just wrote, and the person is told "we have taken it
  // back off your computer. You can try that name again." Retrying fails the
  // same way forever, against a message promising the opposite -- while the
  // orphaned job keeps respawning against a startup script that was just
  // deleted.
  //
  // Loaded means launchctl DESCRIBED the service. A recorder that reports every
  // command as succeeding must not thereby claim every name is taken, so the
  // signal is the output rather than the exit.
  const calls = [];
  create.setRunner((file, args) => {
    calls.push([file, args]);
    if (args && args[0] === 'print') return { ok: true, stdout: 'com.kosmos.agent.ghost = { ... }' };
    return { ok: true, stdout: '' };
  });
  create.setDryRun(false);

  const r = create.createAgent({ ...BINS, name: 'ghost-job', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'a name whose service is loaded was accepted');
  /* ⚠️ THE ADVERB IS NOT THE DISCRIMINATOR. Two refusals now share this
     clause and differ only by still/already: :715 is a plist FILE on disk with
     no folder, :761 (this one) is a LOADED service with nothing on disk. One
     harmonised adverb and this pin would match the wrong arm in silence. The
     tail is what names the state, so the pin asserts that and refuses the
     sibling's. */
  assert.match(r.because, /already set to start on this computer/);
  assert.match(r.because, /though there is nothing else left of it/,
    'the loaded-service refusal no longer says what state it found');
  assert.doesNotMatch(r.because, /though there is no folder for it/,
    'it gave the plist-on-disk sentence for a name whose only trace is a loaded service');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'bootstrap'), 'it tried to load a second job');
  assert.ok(!fs.existsSync(create.workerDir('ghost-job')), 'it made a folder for a name it refused');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'bootout'),
    "it unloaded a service this creation did not install, which is acting on something we have not tied to us");

  // THE CONTROL: the same name goes through when launchctl describes nothing.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'ghost-job', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever launchctl says, so the above proves nothing');
});

test('a folder left behind on its own is refused, and says so', () => {
  // ⚠️ Untested until now, and `rollBack()` leans on it: its stated premise is
  // that nothing it removes existed before the call, which is only true because
  // a pre-existing folder is refused here. Delete this branch and a later
  // failure would recursively remove a directory the person already had.
  const calls = recorder();
  create.setDryRun(false);
  fs.mkdirSync(create.workerDir('lonely-folder'), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir('lonely-folder'), 'notes.md'), 'mine', 'utf8');

  const r = create.createAgent({ ...BINS, name: 'lonely-folder', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'a name with a folder already there was accepted');
  assert.match(r.because, /already a folder/,
    'the refusal names an agent rather than the folder, so it points at the wrong thing');
  assert.equal(fs.readFileSync(nodePath.join(create.workerDir('lonely-folder'), 'notes.md'), 'utf8'), 'mine',
    'it wrote into a folder that was already there');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'bootstrap'), 'it started an agent over an existing folder');
});

test('a name that shares a KEY with a live session is refused, not just an identical one', () => {
  // ⚠️ Every name-keyed route resolves through `store.safeKey`, so `my.bot` and
  // `mybot` are two names and ONE key: one instruction file, one avatar, one
  // profile, one commitment record. Comparing raw session names let this create
  // `mybot` beside a live `my.bot-discord`, and a write naming either then
  // reached the other's boot file. This module's header exists to prevent that
  // exact collision, and the gate was checking the wrong thing to enforce it.
  const calls = recorder();
  create.setDryRun(false);
  status.setPaneSource(() => fleet.line({ session: 'my.bot-discord', title: 'idle' }));

  const r = create.createAgent({ ...BINS, name: 'mybot', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED,
    'a name that resolves to the same key as a live agent was accepted, so both '
    + 'now share one instruction file');
  assert.match(r.because, /already running/);
  assert.match(r.because, /my\.bot-discord/,
    'the refusal does not say which session it collides with, so the person cannot act on it');
  assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0, 'it started something anyway');

  // THE CONTROL: a name that shares no key goes through.
  status.setPaneSource(() => fleet.line({ session: 'my.bot-discord', title: 'idle' }));
  assert.equal(create.createAgent({ ...BINS, name: 'other-bot', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'every name is refused while that session runs, so the above proves nothing');
});

test('the supervisor is installed once and shared, not copied per agent', () => {
  // ⚠️ THE WHOLE POINT OF THE CHANGE. Each agent used to get its own copy of a
  // 151-line generated script, so every defect in it shipped as many times as
  // there were agents and every FIX reached only the ones created afterwards --
  // the agents already on the machine kept their copy of the bug forever.
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'shared-one', role: 'pm' });
  create.createAgent({ ...BINS, name: 'shared-two', role: 'writer' });

  for (const name of ['shared-one', 'shared-two']) {
    assert.ok(!fs.existsSync(nodePath.join(create.workerDir(name), 'start.sh')),
      `${name} has its own copy of the supervisor`);
    const plist = fs.readFileSync(create.plistPath(name), 'utf8');
    assert.match(plist, new RegExp(create.supervisorPath().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${name}'s job does not run the shared supervisor`);
    assert.match(plist, new RegExp(`<string>${name}</string>`),
      `${name}'s job does not tell the supervisor which agent it is for`);
  }

  // ⚠️ AND IT IS REFRESHED. Installing only when absent would mean a fix never
  // reaches a machine that already has an older copy, which is the same defect
  // one level up: the file would be shared and still stale.
  fs.writeFileSync(create.supervisorPath(), '# an older version\n', 'utf8');
  create.createAgent({ ...BINS, name: 'shared-three', role: 'pm' });
  assert.equal(fs.readFileSync(create.supervisorPath(), 'utf8'),
    fs.readFileSync(create.supervisorSource(), 'utf8'),
    'an older supervisor was left in place, so every agent keeps running it');
});

test('a supervisor that cannot be installed stops the creation', () => {
  // ⚠️ A job pointing at a script that is not there IS the respawn loop: bash
  // exits at once and KeepAlive retries every thirty seconds for as long as the
  // machine is on. So this refuses before the job is written, and rolls back.
  const calls = recorder();
  create.setDryRun(false);
  const realCopy = fs.copyFileSync;
  try {
    fs.copyFileSync = () => { throw new Error('read-only'); };
    const r = create.createAgent({ ...BINS, name: 'no-supervisor', role: 'pm' });
    assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'it created an agent with no supervisor to run it');
    assert.ok(r.steps.some((s) => /script that starts agents/.test(s.label) && !s.ok),
      'the failing step is not visible in the record');
    // ⚠️ The SENTENCE, which is the only thing this branch adds to the failure
    // path beyond a step label, and was the one thing unpinned. A transient
    // failure must invite a retry; a missing file must not.
    assert.match(r.because, /could not put the script that starts agents in place/);
    assert.match(r.because, /try that name again/,
      'a transient failure tells the person not to bother retrying');
    // ⚠️ This holds through the ROLLBACK as much as through the write ordering,
    // and saying so matters: removing the gate that stops the job being written
    // leaves this assertion green, because the rollback removes it either way.
    // The load-bearing assertion is the next one -- nothing was ever STARTED.
    assert.ok(!fs.existsSync(create.plistPath('no-supervisor')),
      'a job pointing at a supervisor that is not there was left on the machine');
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0, 'it started something anyway');
  } finally {
    fs.copyFileSync = realCopy;
  }

  // THE CONTROL: with the copy working, the same name goes through.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'no-supervisor', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever happens, so the above proves nothing');
});

test('the job passes the supervisor exactly the arguments it reads, in that order', () => {
  // ⚠️ ONE CONTRACT, TWO ENDS, and nothing else in the suite holds it: the
  // order `plistFor` writes those strings, and the order the script reads $1..$5.
  // Swap two and every real agent starts with its working directory as its
  // session name -- `has-session -t "=/Users/.../workers/x"`, a session created
  // under that name, and a claim the board can never match -- with the whole
  // suite green.
  const args = jobArguments('order-check');
  assert.deepEqual(args, [
    create.supervisorPath(),
    'order-check',
    create.workerDir('order-check'),
    '/bin/echo',
    '/opt/homebrew/bin/tmux',
    nodePath.join(create.workerDir('order-check'), 'start.log'),
  ], 'the job no longer passes the supervisor what it reads, in the order it reads it');

  // And the script reads them in that order, by position.
  const script = supervisorText();
  for (const [pos, name] of [[1, 'SESSION'], [2, 'WORKDIR'], [3, 'CLAUDE'], [4, 'TMUX_BIN'], [5, 'LOG'], [6, 'MODEL']]) {
    assert.ok(script.includes(`${name}="\${${pos}`),
      `the supervisor does not read ${name} from argument ${pos}`);
  }
  // ...and MODEL is not merely read: a supervisor that assigns $6 and never
  // passes it keeps every test green while every model choice silently runs
  // the default. The flag must reach the claude invocation, quoted.
  assert.ok(script.includes('--model "$MODEL"'),
    'the supervisor reads MODEL but never passes --model to claude');
});

test('a supervisor missing from the app says so, instead of inviting a retry', () => {
  // ⚠️ Two different failures, two different sentences. `installSupervisor`
  // collapsed everything into one boolean, so a full disk was told "trying
  // again will not help until it is fixed" -- false in exactly the case that
  // produced it, and the sentence that stops the operator retrying.
  recorder();
  create.setDryRun(false);
  const realCopy = fs.copyFileSync;
  try {
    fs.copyFileSync = () => {
      const err = new Error('no such file'); err.code = 'ENOENT'; throw err;
    };
    // The source really is present; the ENOENT is the destination's.
    const transient = create.createAgent({ ...BINS, name: 'enoent-dest', role: 'pm' });
    assert.match(transient.because, /try that name again/,
      'a failure that is not the app missing tells the person not to retry');

    // And with the source genuinely gone, the opposite.
    const realExists = fs.existsSync;
    try {
      fs.existsSync = (f) => (String(f).endsWith('agent-supervisor.sh') ? false : realExists(f));
      const permanent = create.createAgent({ ...BINS, name: 'no-source', role: 'pm' });
      assert.match(permanent.because, /missing from this app/,
        'a missing supervisor invites a retry that can never work');
    } finally {
      fs.existsSync = realExists;
    }
  } finally {
    fs.copyFileSync = realCopy;
  }
});

test('the supervisor trims its own log rather than growing it forever', () => {
  // ⚠️ The one destructive branch in the shipped script that nothing exercised.
  // launchd appends to that log, and a job failing every thirty seconds writes
  // to it for as long as the machine is on.
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'logtrim-'));
  const log = nodePath.join(dir, 'start.log');
  fs.writeFileSync(log, 'x'.repeat(1048576 + 10), 'utf8');
  const fake = nodePath.join(dir, 'tmux');
  // A tmux that reports no session at all: the script starts one and falls
  // straight out of the supervision loop.
  fs.writeFileSync(fake, '#!/bin/bash\nexit 1\n', { mode: 0o755 });
  try {
    require('node:child_process').execFileSync(
      '/bin/bash',
      [create.supervisorSource(), 'logtrim', dir, '/bin/echo', fake, log],
      { timeout: 20000, stdio: 'pipe' },
    );
  } catch { /* new-session "fails" with this fake, which is fine */ }
  assert.ok(fs.statSync(log).size < 1048576,
    'the log was left over its ceiling, so it grows without bound');

  // ⚠️ AND AN UNREADABLE ONE IS NOT AN ERROR. `wc` prints nothing for a file it
  // cannot read, and `[ "" -gt N ]` is a bash error written into the very log
  // being managed.
  fs.writeFileSync(log, 'small', 'utf8');
  fs.chmodSync(log, 0o000);
  let stderr = '';
  try {
    require('node:child_process').execFileSync(
      '/bin/bash',
      [create.supervisorSource(), 'logtrim', dir, '/bin/echo', fake, log],
      { timeout: 20000, stdio: 'pipe' },
    );
  } catch (err) { stderr = String((err && err.stderr) || ''); }
  fs.chmodSync(log, 0o644);
  assert.doesNotMatch(stderr, /integer expression expected/,
    'an unreadable log makes the supervisor emit a bash error');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// The capital, and where it does and does not go
//
// ⚠️ WHAT THIS BLOCK IS FOR. Somebody naming a colleague types `Casey`, and the
// product used to answer "use lower case, so the name is the same everywhere it
// appears" — a true sentence about the machinery, said to the wrong person. The
// capital now survives as the display name and the machinery uses the slug, so
// the thing worth testing is exactly which name reaches which place.
// ─────────────────────────────────────────────────────────────────────────────

test('a capitalised name makes its folder, job and session under the LOWER-CASE name', () => {
  const calls = recorder();
  create.setDryRun(false);

  const r = create.createAgent({ ...BINS, name: 'Bex', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  // Everything the operating system touches.
  assert.ok(fs.existsSync(create.workerDir('bex')), 'the folder is not under the machine name');
  assert.ok(fs.existsSync(create.plistPath('bex')), 'the job is not under the machine name');
  assert.equal(create.serviceLabel('bex'), 'com.kosmos.agent.bex');
  /**
   * ⚠️ ASSERTED ON THE DIRECTORY LISTING, NOT ON `existsSync('Bex')`, and the
   * first version of this line was wrong in a way worth recording. macOS's
   * default volume is case-INSENSITIVE: `existsSync(workerDir('Bex'))` answers
   * true for a folder that is really named `bex`, so the check could not
   * distinguish the thing it was written to distinguish. It would have passed on
   * a case-sensitive volume and failed here for a correct implementation —
   * a measurement of the filesystem rather than of the code.
   *
   * The listing says what the name on disk actually IS, on either kind of
   * volume, and that is the property: one folder, spelled lower case.
   */
  const named = fs.readdirSync(process.env.AGENT_WORKFORCE_WORKERS)
    .filter((entry) => entry.toLowerCase() === 'bex');
  assert.deepEqual(named, ['bex'],
    'the folder on disk is not the lower-case name, or there is more than one of it');

  // And the session tmux is asked for. The supervisor takes the agent as its
  // first argument, so this is the name the window will be called.
  const launched = calls.find(([, args]) => Array.isArray(args) && args.includes('bootstrap'));
  assert.ok(launched, 'nothing was bootstrapped, so the assertions above are about nothing');
  const plist = fs.readFileSync(create.plistPath('bex'), 'utf8');
  assert.match(plist, /<string>bex<\/string>/, 'the supervisor is passed the machine name');
  assert.doesNotMatch(plist, /<string>Bex<\/string>/, 'the typed name reached the launchd job');
});

test('and it is CALLED Casey: the instruction file and the stored record both say so', () => {
  recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'Delia', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  const text = fs.readFileSync(create.instructionFile('delia'), 'utf8');
  assert.match(text, /You are \*\*Delia\*\*, a project manager/,
    'the file the agent boots from calls it by the machine name');

  // The second record, which is what survives the person editing that file.
  assert.equal(store.readProfile('delia').displayName, 'Delia');

  // And the answer carries both, so no screen has to derive either.
  assert.equal(r.name, 'delia');
  assert.equal(r.shownAs, 'Delia');
  assert.match(r.because, /^Delia is set up/, 'the sentence a person reads uses the name they typed');
});

test('the board reads the typed name back, and keeps reading it after the file is edited', () => {
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'Rhona', role: 'pm' }).outcome, create.OUTCOME.CREATED);

  // The control: it reads back at all.
  assert.equal(status.readIdentity('rhona').displayName, 'Rhona');

  // ⚠️ THE CASE THE STORED RECORD EXISTS FOR. The instruction file belongs to
  // the PERSON, and they may rewrite its first line. A display name that
  // vanishes when somebody edits their own instructions is not a name.
  fs.writeFileSync(create.instructionFile('rhona'), '# my own notes\n\nnothing about who I am\n', 'utf8');
  const after = status.readIdentity('rhona');
  assert.equal(after.displayName, 'Rhona', 'the name did not survive an edit to the file');
  assert.equal(after.derived, true,
    'a name the person typed themselves must not be flagged on the card as a machine name');

  // ⚠️ AND THE PRECEDENCE ITSELF, on a file that PARSES to a different name.
  // The edited-file case above exits through the no-match branch, so it never
  // reaches the `recorded || parsed` line -- measured in round 13, reducing
  // that line to the parsed name alone left the suite green. This file
  // parses fine and disagrees, which is the one shape that can catch it:
  // "one wins, stated" is only true if the stored name beats a readable file.
  fs.writeFileSync(create.instructionFile('rhona'),
    'You are **Completely Different**, a bricklayer.\n', 'utf8');
  const disagree = status.readIdentity('rhona');
  assert.equal(disagree.displayName, 'Rhona',
    'a parseable file must not out-rank the name the person typed');
  assert.equal(disagree.role, 'bricklayer',
    'control: the file WAS parsed (its role came through), so the name above was a choice, not a fallback');
});

test('an agent with no stored name is UNCHANGED: it still reads its name out of its file', () => {
  // ⚠️ The whole existing fleet is in this state, and this is the assertion
  // that says the change is additive. `claudebot` reads `Splinter` out of its
  // instruction file and nothing on this branch renames anything on disk.
  const dir = create.workerDir('legacybot');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'You are **Splinter**, a project manager.\n', 'utf8');
  assert.equal(store.readProfile('legacybot').displayName, undefined, 'the control: nothing is recorded');
  const identity = status.readIdentity('legacybot');
  assert.equal(identity.displayName, 'Splinter');
  assert.equal(identity.role, 'project manager');
  assert.equal(identity.derived, true);
});

test('two spellings of one name are ONE agent, not two', () => {
  // ⚠️ The hazard the split introduces if the slug is not the key everywhere:
  // `Casey` and `casey` would be two folders, two jobs, two sessions and one
  // very confused person. The second creation must meet the existing one.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'Wren', role: 'pm' }).outcome, create.OUTCOME.CREATED);
  const again = create.createAgent({ ...BINS, name: 'wren', role: 'pm' });
  assert.equal(again.outcome, create.OUTCOME.REFUSED);
  assert.match(again.because, /already/);
});

test('the launchd job says WHOSE background item it is, so macOS names Kosmos and not bash', () => {
  /**
   * ⚠️ WHAT THIS PREVENTS, in the words of the notice it changes. macOS posts a
   * "background item added" notification for every launchd job and lists it
   * under Login Items. With nothing to attribute the job to it names the
   * executable — so the person is told `bash` was added as a background item,
   * and later that `bash` is running in the background on their Mac. Minutes
   * after installing something. The honest reading of that is alarming, and the
   * thing it describes is their own agent staying alive between logins.
   */
  const plist = create.plistFor('fixture-agent', '/bin/echo', '/bin/echo');
  assert.match(plist, /<key>AssociatedBundleIdentifiers<\/key>/);
  // ⚠️ The identifier is the one the INSTALLER registers the bundle under. A
  // plist pointing at an identifier no bundle claims attributes the job to
  // nothing, which is the state this key exists to leave.
  // ⚠️ EXTRACTED FROM BOTH SIDES AND COMPARED, never a literal held in this
  // test: the first version asserted a hardcoded string against each file
  // separately, which passed when the installer's real CFBundleIdentifier
  // changed (a stale mention elsewhere in the file satisfied includes()) and
  // FAILED when both sides were renamed consistently -- silent on the
  // disagreement it exists to catch, red on a correct change (round 14).
  const inPlist = (plist.match(/<key>AssociatedBundleIdentifiers<\/key>\s*<array><string>([^<]+)<\/string>/) || [])[1];
  assert.ok(inPlist, 'control: the plist really carries an identifier to compare');
  const setup = fs.readFileSync(nodePath.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const inSetup = (setup.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
  assert.ok(inSetup, 'control: the installer really registers a CFBundleIdentifier to compare');
  assert.equal(inPlist, inSetup,
    'the plist attributes the job to an identifier the installer does not register');
  // And the job still parses as a plist: an array in the wrong place is a file
  // launchd silently refuses to load, which is an agent that never starts.
  const file = nodePath.join(SANDBOX, 'bundle-id-check.plist');
  fs.writeFileSync(file, plist, 'utf8');
  // Guarded on platform (round 40): plutil is macOS-only, and launchd -- the
  // consumer this lint stands in for -- exists only there too, so on another
  // OS the honest outcome is a skip, not an ENOENT masquerading as a failure.
  if (process.platform === 'darwin') {
    const read = require('node:child_process').execFileSync(
      '/usr/bin/plutil', ['-lint', file], { encoding: 'utf8' },
    );
    assert.match(read, /OK/, 'launchd would refuse this plist, so the agent would never start');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The pane-2 creation options (label, instructions, model), 2026-08-16
// ─────────────────────────────────────────────────────────────────────────────

test('every pane-2 option is validated BEFORE any write, and refusals leave no trace', () => {
  recorder();
  create.setDryRun(false);
  for (const [opts, why] of [
    [{ label: 42 }, 'a non-string label'],
    [{ label: '   ' }, 'a blank label'],
    [{ label: 'x'.repeat(81) }, 'an 81-character label'],
    [{ instructions: '' }, 'empty instructions'],
    [{ instructions: 7 }, 'non-string instructions'],
    [{ model: 'gpt-5' }, 'a model not on the list'],
  ]) {
    const r = create.createAgent({ ...BINS, name: 'opts-refusal', role: 'pm', ...opts });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, `${why} was not refused: ${r.because}`);
    // ⚠️ The refusal must land before the folder exists: a rollback nobody
    // needs is a rollback that will one day half-run.
    assert.ok(!fs.existsSync(create.workerDir('opts-refusal')),
      `${why} was refused only after writing the folder`);
  }
});

test('custom instructions are written verbatim with a trailing newline, and the role template is not', () => {
  recorder();
  create.setDryRun(false);
  const mine = 'You are **{{NAME}}**, precisely what I typed.\n\nNo template.';
  const made = create.createAgent({ ...BINS, name: 'own-words', role: 'pm', instructions: mine });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const text = fs.readFileSync(create.instructionFile('own-words'), 'utf8');
  // ⚠️ Verbatim means no {{NAME}} substitution: these are the person's own
  // words, and rewriting any part of them is the drift rule broken at birth.
  assert.equal(text, mine + '\n');
  assert.ok(!text.includes('project manager'),
    'the role template leaked into instructions the person replaced');
});

test('a chosen label lands in the profile only on a completed creation', () => {
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name: 'labelled', role: 'researcher', label: 'Napkin Sketcher' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  assert.equal(store.readProfile('labelled').role, 'Napkin Sketcher',
    'the label the person chose is not what the board will read');
});

test('the model choice writes a sixth supervisor argument, and no choice writes the five every existing agent runs', () => {
  recorder();
  create.setDryRun(false);
  const chosen = create.createAgent({ ...BINS, name: 'modelled', role: 'pm', model: 'haiku' });
  assert.equal(chosen.outcome, create.OUTCOME.CREATED, chosen.because);
  const plist = fs.readFileSync(create.plistPath('modelled'), 'utf8');
  assert.match(plist, /claude-haiku-4-5-20251001/,
    'the chosen model never reached the job, so the agent runs on the default while the menu claims otherwise');
  const withArgs = plist.match(/<string>/g).length;

  const plain = create.createAgent({ ...BINS, name: 'unmodelled', role: 'pm' });
  assert.equal(plain.outcome, create.OUTCOME.CREATED, plain.because);
  const plist2 = fs.readFileSync(create.plistPath('unmodelled'), 'utf8');
  assert.ok(!/--model|claude-haiku|claude-sonnet/.test(plist2),
    'an agent created without a choice carries a model flag anyway');
  assert.equal(plist2.match(/<string>/g).length, withArgs - 1,
    'the five-argument shape every existing agent runs did not survive');
});

test('the MODELS list has one default and args the CLI will accept as model ids', () => {
  const defaults = create.MODELS.filter((m) => m.default);
  assert.equal(defaults.length, 1, 'the menu needs exactly one preselected model');
  for (const m of create.MODELS) {
    assert.ok(m.key && m.label && m.arg, 'a model entry is missing a field the menu or the job needs');
    assert.match(m.arg, /^claude-[a-z0-9-]+$/, `${m.key}'s arg does not look like a model id`);
  }
});

test('own is the 27th entry and the 26th role does not exist', () => {
  // ⚠️ Both counts asserted BY NAME (catalogue 0ef34cc): 27 entries, 26
  // pickable. A test that asserted one bare number would not know which
  // fact it held when the next entry lands.
  assert.equal(roles.ROLES.length, 27, 'the catalogue grew or shrank; decide which count this is');
  const menu = roles.ROLES.filter((r) => r.menu !== false);
  assert.equal(menu.length, 26, 'own leaked into the pickable menu, or a menu role got hidden');
  assert.ok(!menu.some((r) => r.key === 'own'), 'own is in the grouped menu');
  // POSITIVE CONTROL: the exclusion is the flag doing work, not a
  // coincidence of counting -- flipping it in a copy must change the count.
  const flipped = roles.ROLES.map((r) => (r.key === 'own' ? { ...r, menu: true } : r))
    .filter((r) => r.menu !== false);
  assert.equal(flipped.length, 27, 'the menu filter is not reading the flag this test guards');
  // No label on purpose: it prints under the agent's name, and "Custom" is
  // nobody's job. The gate lives in create and is tested below.
  assert.ok(!roles.byKey('own').label, 'own grew a default label');
});

test('creating own without a label is a gating refusal, never a default', () => {
  recorder();
  create.setDryRun(false);
  for (const opts of [{}, { label: '  ' }]) {
    const r = create.createAgent({ ...BINS, name: 'own-nolabel', role: 'own', ...opts });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, r.because);
    assert.match(r.because, /your own words/i, 'the refusal does not ask the gating question');
    assert.ok(!fs.existsSync(create.workerDir('own-nolabel')), 'refused after writing');
  }
  const made = create.createAgent({ ...BINS, name: 'own-labelled', role: 'own', label: 'Napkin Wrangler' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  assert.equal(store.readProfile('own-labelled').role, 'Napkin Wrangler');
  const text = fs.readFileSync(create.instructionFile('own-labelled'), 'utf8');
  assert.match(text, /^You are \*\*own-labelled\*\*, an assistant\./,
    'the example did not substitute the name in the identity shape the board parses');
  assert.match(text, /stuck rather than filling the gap/,
    "the example's posture bullet is missing");
});

test('a saved About-you record rides the boot file from birth, and its absence costs nothing', () => {
  const you = require('./you');
  recorder();
  create.setDryRun(false);

  // With a record: the block is spliced into the SAME write that creates the
  // file, because at create time the session does not exist yet and the tell
  // path's tied-session gate would refuse the very agent being made.
  you.save({ name: 'Josh', does: 'Runs a company that builds AI tools' });
  const r1 = create.createAgent({ ...BINS, name: 'born-knowing', role: 'pm' });
  assert.equal(r1.outcome, create.OUTCOME.CREATED, r1.because);
  const text = fs.readFileSync(create.instructionFile('born-knowing'), 'utf8');
  assert.match(text, /Who you work for/, 'the boot file does not carry the answers');
  assert.match(text, /Josh\. Runs a company/);
  assert.match(text, /You are \*\*born-knowing\*\*/, 'the role instructions were displaced');

  // Without one: the boot file simply ships without the block.
  fs.rmSync(you.FILE, { force: true });
  const r2 = create.createAgent({ ...BINS, name: 'born-plain', role: 'pm' });
  assert.equal(r2.outcome, create.OUTCOME.CREATED, r2.because);
  assert.ok(!fs.readFileSync(create.instructionFile('born-plain'), 'utf8').includes('Who you work for'));
});

test('the birth splice never pushes a boot file past the size its own reader accepts', () => {
  const you = require('./you');
  const instructions = require('./instructions');
  recorder();
  create.setDryRun(false);
  you.save({ name: 'Josh', does: 'Runs a company' });
  // Instructions that validate just under the cap: the block must be the
  // thing dropped, never the person's words, and never the file's
  // editability.
  // Sized so the file lands 10 bytes under the cap: any block is bigger
  // than that, so a splice that ignored the margin would cross it.
  const header = 'You are **Margin**, a tester.\n';
  const nearCap = header + 'x'.repeat(instructions.MAX_BYTES - Buffer.byteLength(header, 'utf8') - 11) + '\n';
  const r = create.createAgent({ ...BINS, name: 'margin', role: 'pm', instructions: nearCap });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const text = fs.readFileSync(create.instructionFile('margin'), 'utf8');
  assert.ok(!text.includes('Who you work for'), 'the block crossed the size margin anyway');
  assert.ok(Buffer.byteLength(text, 'utf8') <= instructions.MAX_BYTES, 'the boot file outgrew its own reader');
  fs.rmSync(you.FILE, { force: true });
});

/**
 * The model the job will start on, read back out of the job we wrote.
 *
 * ⚠️ A ROUND TRIP THROUGH THE REAL WRITER, not a hand-built plist. The reader
 * takes the model from a fixed position in `ProgramArguments`, so a test that
 * fed it a plist typed out here would be asserting my arithmetic against
 * itself: add an argument to `plistFor` and both the product and the fixture
 * shift, silently, together. Creating the agent for real is what makes the
 * writer and the reader one contract with two ends.
 */
test('the planned model survives the round trip through the real job file', () => {
  recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'plannedone', role: 'pm', model: 'opus' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  // The exact string `claude --model` is handed, not the key the route accepts:
  // showing a person the key would show them "opus".
  assert.equal(create.plannedModelArg('plannedone'), 'claude-opus-5');
});

/**
 * ⚠️ THE CONTROL FOR THE TEST ABOVE. Without it, `plannedModelArg` could return
 * a hardcoded string, or read the wrong index and happen to be right for one
 * model, and both tests would pass. This asserts the value TRACKS the choice.
 */
test('a different choice comes back different, and every model in the list round-trips', () => {
  recorder();
  create.setDryRun(false);
  for (const m of create.MODELS) {
    const name = `rt${m.key}`;
    const r = create.createAgent({ ...BINS, name, role: 'pm', model: m.key });
    assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
    assert.equal(create.plannedModelArg(name), m.arg,
      `${m.key} did not come back as the argument the job runs with`);
  }
});

/**
 * ⚠️ NULL MEANS WE DO NOT KNOW, AND THE THREE WAYS OF NOT KNOWING ALL HAVE TO
 * REACH IT. A reader that returned the default model for a job that carries no
 * model argument would put a confident sentence on the screen about an agent
 * whose model nobody ever chose — the exact could-not-look versus is-not-there
 * confusion this product refuses everywhere else.
 */
test('no job, no model argument, and an unreadable file all answer null', () => {
  recorder();
  create.setDryRun(false);

  // 1. No job at all.
  assert.equal(create.plannedModelArg('never-made-at-all'), null);

  // 2. A job written without a model choice — the five-argument form every
  //    agent created before the picker existed still runs.
  const r = create.createAgent({ ...BINS, name: 'nomodelpick', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const plist = fs.readFileSync(create.plistPath('nomodelpick'), 'utf8');
  assert.ok(!/claude-(opus|sonnet|fable|haiku)/.test(plist),
    'this agent was supposed to be created without a model choice');
  assert.equal(create.plannedModelArg('nomodelpick'), null);

  // 3. Present but unparseable.
  fs.writeFileSync(create.plistPath('nomodelpick'), 'not a plist at all', 'utf8');
  assert.equal(create.plannedModelArg('nomodelpick'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Trusting the folder we made (#164)
// ─────────────────────────────────────────────────────────────────────────────

const trustCfg = () => nodePath.join(SANDBOX, 'claude.json');
const writeCfg = (obj) => fs.writeFileSync(trustCfg(), JSON.stringify(obj, null, 2) + '\n', 'utf8');
const readCfg = () => JSON.parse(fs.readFileSync(trustCfg(), 'utf8'));

test('a new agent does not stop to ask whether it can trust the folder we just made it', () => {
  /**
   * ⚠️ THE COST OF THE PROMPT IS NOT THE PROMPT. Every agent showed `Needs you`
   * from birth, so the badge stopped separating an agent that genuinely needs
   * an answer from one that was merely born (#164).
   */
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const r = create.createAgent({ ...BINS, name: 'trustfix-one', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  const dir = fs.realpathSync(nodePath.join(SANDBOX, 'workers', 'trustfix-one'));
  assert.equal(readCfg().projects[dir].hasTrustDialogAccepted, true);
});

test('a folder the PERSON already made is refused outright, so nothing downstream can touch it', () => {
  /**
   * 🛑 THE SECURITY-RELEVANT HALF, and writing it taught me which guard is
   * actually doing the work. I assumed `weMadeTheFolder` was, and asserted a
   * successful creation that left the config alone. It came back REFUSED:
   * `createAgent` already turns down a name whose folder exists, so the trust
   * write is unreachable on that path — the refusal upstream is the first line
   * and the `weMadeTheFolder` check is the second.
   *
   * Naming the wrong guard would have left a comment claiming a protection
   * that a later loosening of the refusal would silently remove. So this test
   * asserts what is TRUE: nobody else's folder can reach the trust write,
   * because nobody else's folder can reach a created agent.
   *
   * ⚠️ SO IT IS A REGRESSION GUARD ON THE REFUSAL, NOT A TRUST TEST, and it is
   * named that way now. It passes with the entire trust feature deleted, which
   * is honest for what it covers and would be a lie under its old name. The
   * trust half is covered by the race test further down.
   */
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const theirs = nodePath.join(SANDBOX, 'workers', 'trustfix-two');
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(nodePath.join(theirs, 'their-notes.txt'), 'not ours\n', 'utf8');

  const r = create.createAgent({ ...BINS, name: 'trustfix-two', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'a folder that is already there is not ours to take over');

  assert.deepEqual(Object.keys(readCfg().projects), [],
    'we answered a safety question about a folder we did not make');
  assert.equal(fs.readFileSync(nodePath.join(theirs, 'their-notes.txt'), 'utf8'), 'not ours\n',
    'and their file is still theirs');
});

test('a config we cannot write does not cost the person their agent', () => {
  /**
   * The fallback, asserted rather than assumed: every refusal inside the trust
   * write returns the person to the behaviour they have today, which is an
   * agent that starts and asks once.
   */
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  fs.writeFileSync(trustCfg(), '{ not json at all', 'utf8');

  const r = create.createAgent({ ...BINS, name: 'trustfix-three', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(fs.readFileSync(trustCfg(), 'utf8'), '{ not json at all', 'and their file is untouched');
});

test('an agent that will not start takes its trust entry back off the machine with it', () => {
  /**
   * ⚠️ THE SENTENCE IS THE TEST. A failed start tells the person "we have taken
   * it back off your computer rather than leave something half installed" —
   * and the trust write happens BEFORE the start, because the question it
   * answers is asked at startup. Without the undo, an entry for a folder that
   * no longer exists sits in another tool's config forever and that sentence is
   * false in exactly the case that produces it.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'Load failed: 5: Input/output error' };
    return { ok: true };
  });
  create.setDryRun(false);
  writeCfg({ theme: 'dark', projects: {} });

  const r = create.createAgent({ ...BINS, name: 'trustfix-rollback', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so this tests nothing');

  const after = readCfg();
  assert.deepEqual(Object.keys(after.projects), [],
    'a trust entry survived a rollback, for a folder that no longer exists');
  assert.equal(after.theme, 'dark', 'the undo took more than it wrote');
  assert.ok(!r.steps.some((s) => s.label === 'took back the folder trust'),
    'the undo refused, so the "taken it back off your computer" sentence is not true');
  create.setRunner(null);

  /* 🛑 ASSERT PRESENCE BEFORE ABSENCE. Everything above is an empty
     `projects`, which is also what a creation that NEVER WROTE THE KEY leaves —
     a broken `weMadeTheFolder`, a `trustFolder` refusal on this fixture, or the
     whole feature deleted. The test could not tell "the undo worked" from
     "there was nothing to undo".
     So the same fixture is run again with a start that SUCCEEDS: if the key
     does not appear there, the emptiness above proved nothing. */
  create.setRunner(() => ({ ok: true }));
  /* ⚠️ AND dry-run again: `setRunner(null)` above RE-ARMS it, so without this
     the control creation reports CREATED and writes nothing — the control
     would then fail for a reason that has nothing to do with what it checks.
     The suite told me this by throwing on a folder that was never made. */
  create.setDryRun(false);
  writeCfg({ theme: 'dark', projects: {} });
  const ok = create.createAgent({ ...BINS, name: 'trustfix-rollback-control', role: 'pm' });
  assert.equal(ok.outcome, create.OUTCOME.CREATED, ok.because);
  const controlPath = fs.realpathSync(nodePath.join(SANDBOX, 'workers', 'trustfix-rollback-control'));
  assert.equal(readCfg().projects[controlPath].hasTrustDialogAccepted, true,
    'CONTROL: this fixture never produces a trust entry at all, so the rollback assertion above is vacuous');
  create.setRunner(null);
});

test('a rollback leaves a trust decision THEY already made for that same path', () => {
  /**
   * 🛑 THE CONTROL ON THE UNDO, and the first version of it could not fail. It
   * seeded somebody's entry at a DIFFERENT path — which `forgetFolder` would
   * never touch whatever the guard said, so the test passed with the guard
   * inverted to `true` and proved nothing.
   *
   * The case that actually exercises it: a person trusted this exact folder
   * once, the folder was later removed, the config entry stayed (Claude Code
   * never prunes them; the "93 dead entries" this once cited were THIS BRANCH'S
   * OWN unsandboxed suite, retracted in trust.js — the property holds and the
   * number measured a bug of mine), and now
   * the name is created again. `trustFolder` finds it already true and writes
   * NOTHING, so a rollback that deleted "the entry for our folder" would be
   * deleting THEIR answer, not ours.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);

  // Their standing decision about the very path this creation will use.
  const samePath = nodePath.join(fs.realpathSync(SANDBOX), 'workers', 'trustfix-rollback-two');
  writeCfg({ projects: { [samePath]: { hasTrustDialogAccepted: true, allowedTools: ['Bash(ls:*)'] } } });

  const r = create.createAgent({ ...BINS, name: 'trustfix-rollback-two', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so no rollback ran');

  const after = readCfg();
  assert.deepEqual(Object.keys(after.projects), [samePath],
    'the rollback deleted a trust decision the person had already made for that folder');
  assert.equal(after.projects[samePath].hasTrustDialogAccepted, true);
  assert.deepEqual(after.projects[samePath].allowedTools, ['Bash(ls:*)'], 'and took their other settings with it');
  create.setRunner(null);
});

test('a folder that appears in the window between the check and the mkdir is not trusted', () => {
  /**
   * 🛑 THE ONE CASE `weMadeTheFolder` ACTUALLY GUARDS, and it had no test —
   * the test named for it was watching the refusal further up instead, which
   * the comment beside it says out loud.
   *
   * The refusal checks `existsSync` early; `mkdirSync` runs later. Anything
   * that creates the folder in that window makes recursive mkdir succeed
   * silently and return undefined, and the trust write must not fire — we did
   * not make that folder and have no idea what is in it.
   *
   * ⚠️ Simulated by creating the folder inside a wrapped `mkdirSync`, which is
   * the only way to be inside the window. The alternative was to argue it.
   */
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const dir = nodePath.join(SANDBOX, 'workers', 'trustfix-race');
  const realMkdir = fs.mkdirSync;
  let armed = true;
  fs.mkdirSync = function (p, opts) {
    if (armed && String(p) === dir) {
      armed = false;
      realMkdir.call(fs, p, { recursive: true });        // somebody else got there first
      const r = realMkdir.call(fs, p, opts);             // ...and now ours is the no-op
      fs.writeFileSync(nodePath.join(p, 'not-ours.txt'), 'theirs\n', 'utf8');
      return r;
    }
    return realMkdir.call(fs, p, opts);
  };
  let r;
  try {
    r = create.createAgent({ ...BINS, name: 'trustfix-race', role: 'pm' });
  } finally {
    fs.mkdirSync = realMkdir;
    create.setRunner(null);
  }

  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(armed, false, 'the wrapper never fired, so the window was never entered');
  assert.deepEqual(Object.keys(readCfg().projects), [],
    'we answered a safety question about a folder that appeared under us');
});

test('a rollback removes only the key it added, not the entry it found', () => {
  /**
   * 🛑 THE BLOCKER THIS REPLACES WAS IN THE FIX FOR A BLOCKER. The rollback
   * deleted the whole `projects[…]` entry on the reasoning that we must have
   * created it. We may only have MERGED INTO it: Claude Code never prunes
   * entries, so a person can have one for that exact path holding their
   * allowedTools and MCP servers, with no trust key in it. The undo took all of
   * it, on the path whose entire job is putting things back.
   *
   * ⚠️ AND THE TEST GUARDING THAT COULD NOT FAIL. It seeded the entry with the
   * trust key already TRUE — which short-circuits before any write, so the undo
   * never ran and the guard was never evaluated against a live deletion. The
   * shape that loses data is the key ABSENT, which is this fixture.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);

  const samePath = nodePath.join(fs.realpathSync(SANDBOX), 'workers', 'trustfix-merge');
  writeCfg({ projects: { [samePath]: { allowedTools: ['Bash(ls:*)'], mcpServers: { linear: {} } } } });

  const r = create.createAgent({ ...BINS, name: 'trustfix-merge', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so no rollback ran');

  const e = readCfg().projects[samePath];
  assert.ok(e, 'the rollback deleted an entry it had only merged into');
  assert.deepEqual(e.allowedTools, ['Bash(ls:*)'], 'their allowed tools went with it');
  assert.deepEqual(e.mcpServers, { linear: {} }, 'their MCP servers went with it');
  assert.equal('hasTrustDialogAccepted' in e, false, 'the key we added survived the rollback');
  create.setRunner(null);
});

test('an undo that could not run is recorded, because the sentence says it did', () => {
  /**
   * 🛑 THE TEST THIS REPLACES ASSERTED THE ABSENCE OF A STEP NOTHING PUSHED.
   * `assert.ok(!r.steps.some(s => s.label === 'took back the folder trust'))`
   * passed because that string existed nowhere in the product — the push had
   * been lost to a `git checkout` during mutation testing, and an absence
   * assertion cannot tell "it did not happen" from "it cannot happen".
   *
   * ⚠️ THE FAILURE IS INJECTED ON THE SECOND RENAME, which is the only way to
   * have the trust write SUCCEED and its undo FAIL. Making the config
   * unwritable fails both, and then there is nothing to take back.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const realRename = fs.renameSync;
  let n = 0;
  fs.renameSync = function (...args) {
    if (String(args[0]).includes('.kosmos-')) {
      n += 1;
      if (n === 2) { const e = new Error('injected'); e.code = 'EIO'; throw e; }
    }
    return realRename.apply(fs, args);
  };
  let r;
  try {
    r = create.createAgent({ ...BINS, name: 'trustfix-undo-fail', role: 'pm' });
  } finally {
    fs.renameSync = realRename;
    create.setRunner(null);
  }

  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so no rollback ran');
  assert.equal(n, 2, 'the undo never attempted a write, so nothing was injected into');
  assert.ok(r.steps.some((s) => s.label === 'took back the folder trust' && s.ok === false),
    'the undo failed and nothing on the machine says so, while the person is told we took it back');

  assert.equal(Object.keys(readCfg().projects).length, 1,
    'the entry was removed after all, so the injection did not reach the undo');
});

test('a successful undo adds no step, so the failure step means something', () => {
  /**
   * ⚠️ THE VERSION BEFORE THIS PASSED WITH THE WHOLE TRUST FEATURE DELETED. Its
   * two assertions were "projects is empty" and "no failure step" — and a
   * creation that never wrote the key produces both. Its own guard message,
   * "the undo did not run, so this proves nothing", named a check that could
   * not tell "the undo removed the entry" from "there was never an entry".
   *
   * ⚠️ So it proves PRESENCE first, with a succeeding creation on the same
   * fixture, exactly as its sibling above does.
   */
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  writeCfg({ projects: {} });
  const ok = create.createAgent({ ...BINS, name: 'trustfix-undo-ok-control', role: 'pm' });
  assert.equal(ok.outcome, create.OUTCOME.CREATED, ok.because);
  const controlPath = fs.realpathSync(nodePath.join(SANDBOX, 'workers', 'trustfix-undo-ok-control'));
  assert.equal(readCfg().projects[controlPath].hasTrustDialogAccepted, true,
    'CONTROL: this fixture never produces a trust entry, so the emptiness below proves nothing');

  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const r = create.createAgent({ ...BINS, name: 'trustfix-undo-ok', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL);
  assert.deepEqual(Object.keys(readCfg().projects), [], 'the undo did not run');
  assert.ok(!r.steps.some((s) => s.label === 'took back the folder trust'),
    'a successful undo reported itself as a failure');
  create.setRunner(null);
});


test('setModel rewrites the startup file and keeps everything else about the job', () => {
  /**
   * 🔑 THE MODEL WAS ALWAYS WRITTEN INTO THE JOB and always parsed back out;
   * what was missing was the ability to change it. Josh, 2026-08-21, with an
   * agent stopped on a spent Fable 5 limit: *"maybe we should go ahead and
   * build in picking a different model now so I could pick a different model
   * for her and see if we can get her restored."*
   *
   * ⚠️ THE PATHS MUST SURVIVE THE REWRITE. `claude` and `tmux` live in that file
   * and are the only record of which binaries this agent was built against.
   * Inventing them would repoint an agent at binaries nobody chose, which is
   * why an unreadable job is refused rather than regenerated.
   */
  const name = 'switcher';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name, role: 'pm', model: 'opus' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const before = fs.readFileSync(create.plistPath(name), 'utf8');
  const argsOf = (text) => [...text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1]
    .matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
  const was = argsOf(before);

  const out = create.setModel(name, 'haiku');
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  assert.equal(out.model.arg, 'claude-haiku-4-5-20251001');

  const now = argsOf(fs.readFileSync(create.plistPath(name), 'utf8'));
  assert.equal(create.plannedModelArg(name), 'claude-haiku-4-5-20251001',
    'the reader beside the writer does not agree with what was written');
  assert.equal(now[4], was[4], 'the claude path was not preserved across the rewrite');
  assert.equal(now[5], was[5], 'the tmux path was not preserved across the rewrite');
  assert.equal(now[2], name, 'the job stopped being about this agent');

  /* A model that is not on the list is refused rather than written through. */
  const bad = create.setModel(name, 'gpt-9');
  assert.equal(bad.outcome, create.OUTCOME.REFUSED);
  assert.match(bad.because, /pick a model/);
  assert.equal(create.plannedModelArg(name), 'claude-haiku-4-5-20251001',
    'a refused change still altered the file');

  /* 🛑 AND AN AGENT KOSMOS DID NOT START IS REFUSED, not regenerated. We have no
     record of which binaries it was built against. */
  const nobody = create.setModel('neverexisted', 'opus');
  assert.equal(nobody.outcome, create.OUTCOME.REFUSED);
  assert.match(nobody.because, /not started by Kosmos/);
});


/* ---- which Claude account an agent runs on ------------------------------
   Josh, 2026-08-22, on an account close to its limit: *"connect another
   account will immediately help me move agents off that account that is almost
   out of"*. */

function seedAccounts() {
  const home = nodePath.join(SANDBOX, 'home');
  const put = (rel, obj) => {
    const f = nodePath.join(home, rel);
    fs.mkdirSync(nodePath.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(obj), 'utf8');
  };
  fs.mkdirSync(nodePath.join(home, '.claude', 'projects'), { recursive: true });
  put('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  // shared history: a legal destination
  fs.mkdirSync(nodePath.join(home, '.claude-work'), { recursive: true });
  put('.claude-work/.claude.json', { oauthAccount: { emailAddress: 'work@example.com' } });
  try { fs.symlinkSync(nodePath.join(home, '.claude', 'projects'), nodePath.join(home, '.claude-work', 'projects')); } catch { /* already there */ }

  // its own history: an illegal destination
  fs.mkdirSync(nodePath.join(home, '.claude-solo', 'projects'), { recursive: true });
  put('.claude-solo/.claude.json', { oauthAccount: { emailAddress: 'solo@example.com' } });
  return { home };
}

const cfgOf = (text) => {
  const m = text.match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([\s\S]*?)<\/string>/);
  return m ? m[1] : null;
};

test('an agent can be moved to another account, and the model comes with it', () => {
  const { home } = seedAccounts();
  const name = 'mover';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name, role: 'pm', model: 'opus' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);

  /* ⚠️ THE PREMISE: an agent starts with NO key at all, and absent has always
     meant the default account. A rewrite that started stamping the default
     would make every unrelated edit look like an account change. */
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null);

  const out = create.setAccount(name, nodePath.join(home, '.claude-work'));
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  assert.equal(out.account.email, 'work@example.com');
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), nodePath.join(home, '.claude-work'));
  assert.equal(create.plannedModelArg(name), 'claude-opus-5',
    'moving accounts dropped the model the agent was created with');

  /* 🛑 AND THE OTHER DIRECTION, WHICH IS THE ONE THAT WOULD HAVE SHIPPED.
     `plistFor` regenerates the whole file, so before `readJob` existed a model
     change silently moved the agent back to the default account -- a file that
     still parses, a job that still starts, and an agent quietly on the wrong
     account. Neither setter is safe without the other being tested. */
  const modelled = create.setModel(name, 'haiku');
  assert.equal(modelled.outcome, create.OUTCOME.CREATED, modelled.because);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), nodePath.join(home, '.claude-work'),
    'changing the model moved the agent back to the default account');
  assert.equal(create.plannedModelArg(name), 'claude-haiku-4-5-20251001');

  // Back to the default is a real choice, and it removes the key rather than
  // writing the default path.
  const back = create.setAccount(name, '');
  assert.equal(back.outcome, create.OUTCOME.CREATED, back.because);
  assert.equal(back.account.isDefault, true);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null);
});

test('an account that keeps its own history is refused, and the refusal says what to do', () => {
  const { home } = seedAccounts();
  const name = 'stayer';
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name, role: 'pm', model: 'opus' });

  const out = create.setAccount(name, nodePath.join(home, '.claude-solo'));
  assert.equal(out.outcome, create.OUTCOME.REFUSED);
  /* 🔑 THE WHOLE REASON THIS REFUSAL EXISTS: transcripts live under the config
     directory, so this move would give the agent a blank past -- and it would
     look like a working agent behaving like a new one, with nothing on screen
     saying why. */
  assert.match(out.because, /nothing it has ever done/);
  assert.match(out.because, /Point that account at your agents' history first/);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null,
    'a refused move still wrote the file');
});

test('an account we do not know, and an agent Kosmos did not start, are both refused', () => {
  seedAccounts();
  const name = 'refusals';
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name, role: 'pm' });

  const unknown = create.setAccount(name, '/tmp/not-an-account');
  assert.equal(unknown.outcome, create.OUTCOME.REFUSED);
  assert.match(unknown.because, /do not know that account/);

  const nobody = create.setAccount('neverexisted', '');
  assert.equal(nobody.outcome, create.OUTCOME.REFUSED);
  assert.match(nobody.because, /could not read how neverexisted is started/);
});

test('a new agent can be created on another account, and its history is still shared', () => {
  const { home } = seedAccounts();
  const name = 'bornelsewhere';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({
    ...BINS, name, role: 'pm', model: 'opus', account: nodePath.join(home, '.claude-work'),
  });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), nodePath.join(home, '.claude-work'));
  assert.equal(create.plannedModelArg(name), 'claude-opus-5', 'the model and the account both landed');
});

test('creating on an account that keeps its own history is refused before anything is made', () => {
  const { home } = seedAccounts();
  const name = 'wouldbeorphan';
  recorder();
  create.setDryRun(false);
  const out = create.createAgent({
    ...BINS, name, role: 'pm', account: nodePath.join(home, '.claude-solo'),
  });
  assert.equal(out.outcome, create.OUTCOME.REFUSED);
  /* 🔑 THE REASON IS DIFFERENT FROM THE MOVE'S, and stronger. Moving an agent
     there costs it the past it has; being BORN there costs nothing today and
     costs everything the first time somebody moves it back, because its whole
     life would sit in a tree nothing else reads. Kosmos would have quietly
     built a second history for one agent. */
  assert.match(out.because, /would live somewhere nothing else reads/);
  /* 🛑 AND NOTHING WAS MADE. A refusal that has already written the folder and
     the launch file is not a refusal; the name would then be permanently taken
     by a half-agent and the person could not even retry. */
  assert.equal(fs.existsSync(create.plistPath(name)), false, 'the refusal left a launchd job behind');
  assert.equal(fs.existsSync(create.workerDir(name)), false, 'the refusal left a worker folder behind');
});

test('the default account writes no key, exactly as every existing agent has', () => {
  const { home } = seedAccounts();
  const name = 'plainborn';
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name, role: 'pm', account: nodePath.join(home, '.claude') });
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null,
    'choosing the default account stamped a path where absence has always been the answer');
});
