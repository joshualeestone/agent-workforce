'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING, all four roots. This module STOPS agents, and on
// the machine it was written on the board includes the ones the operator is
// talking to. An unsandboxed run does not litter anything — it takes somebody's
// project manager off the air.
//
// `AGENT_WORKFORCE_DATA` matters twice: `create` installs the shared supervisor
// under it, and this module keeps its removed-list there.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'remove-test-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const remove = require('./remove');
const create = require('./create');
const status = require('./status');
const fleet = require('../test-support/fleet');

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };

// Arm dry-run at load, before any test can run.
remove.setRunner(null);
create.setRunner(null);

/**
 * A launchd and tmux world, described rather than assumed.
 *
 * ⚠️ Every command's answer is stated, because the module reads exit codes and
 * treats "already gone" differently from "it failed". A recorder that answered
 * everything with success would describe a world that cannot occur.
 */
/**
 * ⚠️ TWO INDEPENDENT KNOBS, and collapsing them into one made a whole guard
 * untestable.
 *
 * `killWorks` used to control BOTH the kill's exit code and the look-again's
 * answer, so the only two worlds it could describe were "kill succeeded and the
 * session is gone" and "kill failed". The case the look-again exists for --
 * **the kill reported success and the session is still there** -- could not be
 * expressed at all: with `killWorks: false` the caller short-circuits on the
 * kill's own exit code one line earlier, so the `has-session` arm never ran.
 * Proven by collapsing that arm to a constant, with nothing failing.
 *
 * That is the arm that stops a removal being reported over a live agent, which
 * is the single worst thing this module can do.
 */
function world({ killWorks = true, sessionSurvives = false } = {}) {
  const calls = [];
  remove.setRunner((file, args) => {
    calls.push([file, args]);
    const cmd = args && args[0];
    // ⚠️ `has-session` here is the LOOK-AGAIN after the kill, and only that.
    // Whether a session exists at all is answered by the ROSTER, through
    // `status.setPaneSource` — the module asks the board which pane is this
    // agent rather than asking tmux twice. An earlier version of this helper
    // modelled a pre-kill probe that does not exist, so the first answer landed
    // on the post-kill check and every removal read as "still running".
    //
    // Exit 1 from `has-session` means "no such session", i.e. the kill worked.
    // Exit 0 means it is still there.
    if (cmd === 'has-session') {
      return sessionSurvives ? { ok: true, stdout: '' } : { ok: false, code: 1 };
    }
    if (cmd === 'kill-session') return killWorks ? { ok: true, stdout: '' } : { ok: false, code: 2 };
    return { ok: true, stdout: '' };
  });
  return calls;
}

/** An agent that really exists in the sandbox, made the way the product makes them. */
function madeAgent(name) {
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  status.setPaneSource(() => '');
  const r = create.createAgent({ ...BINS, name, role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, `fixture ${name} was not created: ${r.because}`);
  create.setRunner(null);
  status.setPaneSource(null);
  return name;
}

/** An agent another tool created: a worker folder and a `com.<name>.discord` job. */
function foreignAgent(name) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), `You are **${name}**.\n`, 'utf8');
  const dir = nodePath.dirname(create.plistPath(name));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, `com.${name}.discord.plist`), '<plist/>', 'utf8');
  return name;
}

/** The board sees this agent running in this session. */
function boardShows(name, session) {
  const claim = session.endsWith('-discord') ? '' : name;
  status.setPaneSource(() => fleet.line({ session, claim, title: '✳ Claude Code' }));
}

test.afterEach(() => {
  remove.setRunner(null);
  create.setRunner(null);
  status.setPaneSource(null);
  try { fs.rmSync(remove.REMOVED_FILE, { force: true }); } catch { /* best effort */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// Remove is not delete
// ─────────────────────────────────────────────────────────────────────────────

test('removing an agent deletes nothing at all', () => {
  // ⚠️ THE RULE THE WHOLE MODULE IS SHAPED BY. Remove means: stop it, do not let
  // it come back, take it off the board. The folder, the instructions somebody
  // wrote, the log — none of it is touched, which is what makes the action
  // reversible and the confirmation light rather than frightening.
  const name = madeAgent('keeps-everything');
  const folderBefore = fs.readdirSync(create.workerDir(name)).sort();
  const instructions = fs.readFileSync(create.instructionFile(name), 'utf8');

  boardShows(name, name);
  world();
  remove.setDryRun(false);
  const r = remove.remove(name);

  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);
  assert.deepEqual(fs.readdirSync(create.workerDir(name)).sort(), folderBefore,
    'removing an agent changed what is in its folder');
  assert.equal(fs.readFileSync(create.instructionFile(name), 'utf8'), instructions,
    'the instructions somebody wrote were altered by a removal');
  assert.ok(fs.existsSync(create.plistPath(name)),
    'the startup job file was deleted, which makes restoring it guesswork');
  assert.match(r.because, /still on your computer/);
});

// ─────────────────────────────────────────────────────────────────────────────
// It manages the whole fleet, not only what it made
// ─────────────────────────────────────────────────────────────────────────────

test('an agent another tool created can be removed, and ITS job is the one stopped', () => {
  // ⚠️ Reversed from an earlier design that refused these. Kosmos manages a
  // fleet; a fleet agent it cannot manage is a hole rather than a safeguard.
  // What it must not do is destroy anything of theirs — so the job is DISABLED,
  // never deleted, and the exact label is recorded so Restore can undo it.
  const name = foreignAgent('legacy-bot');
  boardShows(name, `${name}-discord`);
  const calls = world();
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);

  const disable = calls.find(([, a]) => a && a[0] === 'disable');
  assert.ok(disable, 'nothing was disabled, so it comes back at the next login');
  assert.match(disable[1][1], /com\.legacy-bot\.discord$/,
    'it disabled the wrong job — ours rather than the one that actually starts this agent');
  assert.ok(fs.existsSync(nodePath.join(nodePath.dirname(create.plistPath(name)), `com.${name}.discord.plist`)),
    "another tool's job file was deleted rather than disabled");

  // The kill targets the session the BOARD ties to this agent, which for a
  // legacy agent is the `-discord` one and not the bare name.
  const kill = calls.find(([, a]) => a && a[0] === 'kill-session');
  assert.ok(kill, 'the session was never ended');
  assert.equal(kill[1][2], `=${name}-discord`,
    'it killed the wrong session, or fell back to the board name');
});

test('the job label is recorded at removal, so restoring cannot guess wrong', () => {
  const name = foreignAgent('recorded-label');
  boardShows(name, `${name}-discord`);
  world();
  remove.setDryRun(false);
  remove.remove(name);

  const [record] = remove.removedAgents().filter((r) => r.name === name);
  assert.ok(record, 'nothing was recorded, so the agent is stopped and invisible with no way back');
  assert.equal(record.label, `com.${name}.discord`, 'the recorded label is not the one that was disabled');
  assert.equal(record.ours, false, 'a foreign agent was recorded as one of ours');
  assert.ok(record.removedAt, 'no time was recorded, so the removed list cannot be ordered');
});

// ─────────────────────────────────────────────────────────────────────────────
// The round trip
// ─────────────────────────────────────────────────────────────────────────────

test('restore re-enables exactly the job that was disabled, and puts the agent back', () => {
  // ⚠️ "Reversible by design" is only true if the implementation reverses. This
  // is the assertion that makes the claim honest, and it matters most for an
  // agent another tool created, where getting it wrong leaves somebody's real
  // bot disabled with no sign of why.
  const name = foreignAgent('round-trip');
  boardShows(name, `${name}-discord`);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);
  assert.equal(remove.isRemoved(name), true, 'it was not recorded as removed');

  const back = world();
  remove.setDryRun(false);
  const r = remove.restore(name);

  assert.equal(r.outcome, remove.OUTCOME.RESTORED, r.because);
  assert.equal(remove.isRemoved(name), false, 'it is still hidden after being restored');
  const enable = back.find(([, a]) => a && a[0] === 'enable');
  assert.ok(enable, 'nothing was re-enabled, so it stays disabled at the next login');
  assert.match(enable[1][1], /com\.round-trip\.discord$/, 'it re-enabled the wrong job');
  assert.ok(back.some(([, a]) => a && a[0] === 'bootstrap'),
    'the job was enabled but never started, so the agent does not come back until a reboot');
});

test('restoring something that was never removed is refused', () => {
  const r = remove.restore('never-removed');
  assert.equal(r.outcome, remove.OUTCOME.REFUSED);
  assert.match(r.because, /not on the removed list/);
});

test('a removed agent is refused a second removal, and says why', () => {
  const name = madeAgent('twice-removed');
  boardShows(name, name);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  const again = remove.plan(name);
  assert.equal(again.ok, false);
  assert.match(again.because, /already been removed/);
});

// ─────────────────────────────────────────────────────────────────────────────
// What the person is asked
// ─────────────────────────────────────────────────────────────────────────────

test('the confirmation names the agent, and answers the only fear it should', () => {
  // ⚠️ NOT a list of consequences. An earlier version enumerated the job, the
  // session and the startup entry; every line of that describes our
  // implementation rather than their decision.
  //
  // ⚠️ And it NAMES the agent, because this board includes the ones the operator
  // is talking to. An unnamed "are you sure?" is the same dialog for a demo
  // agent and for their project manager.
  const name = madeAgent('asked-about');
  const p = remove.plan(name);

  assert.equal(p.ok, true, p.because);
  assert.match(p.question, new RegExp(`remove ${name} from Kosmos`),
    'the question does not name the agent, so every agent gets the same dialog');
  assert.match(p.reassurance, /will not be deleted/,
    'the one thing a person might fear is not answered');
  assert.ok(!/startup job|tmux|session|launchd/i.test(`${p.question} ${p.reassurance}`),
    'the confirmation describes our implementation rather than their decision');
});

// ─────────────────────────────────────────────────────────────────────────────
// Failing honestly
// ─────────────────────────────────────────────────────────────────────────────

test('a job that will not stop leaves everything alone', () => {
  const name = madeAgent('wont-stop');
  boardShows(name, name);
  const calls = [];
  remove.setRunner((file, args) => {
    calls.push([file, args]);
    if (args && args[0] === 'disable') return { ok: false, code: 1 };
    return { ok: true, stdout: '' };
  });
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, 'a job that could not be stopped was reported as removed');
  assert.match(r.because, /Nothing has changed/);
  assert.ok(!calls.some(([, a]) => a && a[0] === 'kill-session'),
    'it ended the session anyway, which KeepAlive would immediately undo');
  assert.equal(remove.isRemoved(name), false,
    'it was hidden from the board while still running and still able to restart');
});

test('a tmux we cannot ask stops the removal, rather than reading as "nothing is running"', () => {
  // ⚠️ THE INVERSION THIS CODEBASE IS WRITTEN AGAINST, in the one place that
  // stops things. "Nothing running", "not this agent's session" and "we could
  // not ask" are three different answers; treating the third as the first
  // reports a removal over an agent that is still going.
  const name = madeAgent('tmux-missing');
  status.setPaneSource(() => { throw new Error('tmux is not where we thought'); });
  const calls = world();
  remove.setDryRun(false);

  /**
   * ⚠️ REFUSED OUTRIGHT NOW, and NOTHING RAN — which is stronger than the
   * partial this used to assert.
   *
   * "I could not check which agent this name refers to" is not permission to
   * disable a launchd job. The tie is asked before the first command rather
   * than after `disable` and `bootout`, so an unaskable tmux costs the person a
   * retry instead of leaving an agent half-removed.
   */
  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.REFUSED, 'a removal ran commands without knowing whose name it was acting on');
  assert.match(r.because, /could not check which agent/);
  assert.match(r.because, /Try again in a moment/, 'it does not tell them this is retryable');
  assert.deepEqual(calls, [], 'it disabled or stopped something while unable to say what');
  assert.equal(remove.isRemoved(name), false, 'it recorded a removal it never performed');

  // THE CONTROL: "nothing is running" IS an answer, and proceeds.
  status.setPaneSource(() => '');
  remove.setRunner(() => ({ ok: true, stdout: '' }));
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED,
    'an agent that is not running cannot be removed at all');
});

test('a session that survives the kill is not reported as removed', () => {
  const name = madeAgent('survives');
  boardShows(name, name);
  world({ killWorks: false });
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, 'a surviving session was reported as removed');
  assert.match(r.because, /still going/);
  assert.equal(remove.isHidden(name), false, 'it was taken off the board while still running');
  assert.equal(remove.isRemoved(name), true,
    'the agent is stopped from restarting with no way to undo it');
});

test('a session the board does not tie to this agent is left alone', () => {
  // Owning the job is a fact about disk. It does not say the session holding
  // that name right now is this agent, and `bin/agent-supervisor.sh` already
  // refuses to touch a session it cannot tie to us.
  const name = madeAgent('name-taken');
  status.setPaneSource(() => fleet.line({ session: name, claim: 'somebody-else', title: '✳ Claude Code' }));
  const calls = world();
  remove.setDryRun(false);

  /**
   * ⚠️ AND THE JOB IS NOT TOUCHED EITHER, which is the half that used to be
   * missing.
   *
   * Leaving the session alone was always right. But the tie was not consulted
   * until AFTER `disable` and `bootout`, so this case still disabled a launchd
   * job on the strength of a name that the board itself would not vouch for.
   * On this fleet that is not theoretical: with the real `claudebot-discord`
   * down and a bystander's `tmux new -s claudebot` up, the untied card offers a
   * live Remove button and `jobFor('claudebot')` resolves to the REAL agent's
   * plist. The gate now runs before the first command.
   */
  const r = remove.remove(name);
  assert.deepEqual(calls, [],
    'it disabled, stopped or killed something on the strength of a name the board will not vouch for');

  assert.equal(r.outcome, remove.OUTCOME.REFUSED, r.because);
  assert.match(r.because, /cannot confirm it is this agent/,
    'the reason does not say WHY it refused, so it reads as an unexplained failure');
  assert.match(r.because, /stop the wrong thing/,
    'it does not say what the refusal is protecting them from');
  assert.equal(remove.isRemoved(name), false, 'it recorded a removal it never performed');
});

test('the untied check is still made at the session step, for a roster that changes mid-removal', () => {
  /**
   * ⚠️ THE GATE IS NOT A REPLACEMENT FOR THE LATER CHECK, and this pins the
   * later one so nobody deletes it as unreachable.
   *
   * `plan` asks the tie before the first command; `sessionFor` asks again
   * before the kill. Between them the roster can change — somebody opens a
   * session under this name in the second it takes launchctl to answer — and
   * the kill is the irreversible half. Two asks, deliberately.
   */
  const name = madeAgent('roster-moved');
  let asked = 0;
  status.setPaneSource(() => {
    asked += 1;
    // Tied when `plan` looks, untied by the time the session is about to be
    // ended. `world()` is installed after this, so the count starts at the
    // plan's own lookup.
    return asked <= 1
      ? fleet.line({ session: name, claim: name, title: '✳ Claude Code' })
      : fleet.line({ session: name, claim: 'somebody-else', title: '✳ Claude Code' });
  });
  const calls = world();
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.ok(asked > 1, 'the roster was only consulted once, so the second check does not exist');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'kill-session'),
    'it killed a session that stopped being this agent between the two checks');
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, r.because);
  assert.match(r.because, /cannot confirm is this agent/);
});

test('dry-run cannot be left without a runner, and is not the default', () => {
  remove.setRunner(null);
  assert.throws(() => remove.setDryRun(false), /refusing to leave dry-run/);
  remove.setRunner(() => ({ ok: true, stdout: '' }));
  remove.setDryRun(false);
  assert.equal(remove.DRY_RUN, false);
  remove.setRunner(null);
  assert.equal(remove.DRY_RUN, true, 'clearing the runner left the real one armed');

  // ⚠️ And the module does NOT start in dry-run. Defaulting it on made the
  // server silently do nothing while reporting success — an invisible default,
  // not a safe one. Asked of a fresh process, because this file arms it at load.
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e', "console.log(require('./engine/remove').DRY_RUN)"],
    { cwd: nodePath.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DRY_RUN: '' } });
  assert.equal(out.trim(), 'false', 'the module starts inert, so the product removes nothing and says it did');
});

test('a name that could escape a path is refused before anything runs', () => {
  const calls = [];
  remove.setRunner((f, a) => { calls.push([f, a]); return { ok: true, stdout: '' }; });
  remove.setDryRun(false);
  for (const [bad, why] of [
    ['', /no name to look up/],
    ['../../etc', /not a name we can act on safely/],
    ['a/b', /not a name we can act on safely/],
    ['..', /not a name we can act on safely/],
    ['-rf', /not a name we can act on safely/],
    ['x'.repeat(400), /too long/],
  ]) {
    const r = remove.remove(bad);
    assert.equal(r.outcome, remove.OUTCOME.REFUSED, `'${bad}' was accepted`);
    // ⚠️ The REASON, not just the enum: every one of these would also be refused
    // for having no job, so asserting the outcome alone leaves the name rule
    // free to be deleted.
    assert.match(r.because, why, `'${bad}' was refused for the wrong reason`);
  }
  assert.equal(calls.length, 0, 'a refused name still ran a command');
});

test('a session the product did not name is still removable', () => {
  /**
   * ⚠️ THE OTHER HALF, and without it the test above passes against a rule that
   * refuses everything.
   *
   * Removal acts on names nobody chose: the roster admits any tmux session
   * running Claude. Running those through the CREATION rule refused `Notes`,
   * `orch.main`, a default session called `0`, and anything capitalised —
   * printing "use lower case, so the name is the same everywhere it appears"
   * under "Remove this agent", about an agent nobody is naming. The README
   * promises the opposite: the board shows every agent on this machine and
   * managing the ones you already have is the point.
   */
  for (const odd of ['Notes', 'orch.main', '0', 'UPPER', 'has space']) {
    fs.mkdirSync(create.workerDir(odd), { recursive: true });
    fs.writeFileSync(nodePath.join(create.workerDir(odd), 'CLAUDE.md'), `You are **${odd}**.\n`, 'utf8');
    status.setPaneSource(() => fleet.line({ session: odd, claim: odd, title: '✳ Claude Code' }));
    const ask = remove.plan(odd);
    assert.equal(ask.ok, true, `'${odd}' cannot be removed: ${ask.because}`);
    assert.match(ask.question, new RegExp(odd.replace('.', '\\.')), `'${odd}' is not named in its own confirmation`);
  }
});

test('an unreadable removed-list hides nothing, rather than hiding everything', () => {
  // A list we cannot read must not become a board that hides agents for reasons
  // nobody can inspect. The honest answer to "which agents are removed" when
  // the record is unreadable is "none that we can tell you about".
  fs.mkdirSync(nodePath.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, 'not json at all', 'utf8');
  assert.deepEqual(remove.removedAgents(), []);
  assert.equal(remove.isRemoved('anything'), false);
});

test('a name that was never an agent cannot be removed', () => {
  /**
   * ⚠️ THE RECORD OUTLIVES THE MISTAKE, which is what makes this worth
   * refusing rather than allowing harmlessly.
   *
   * Any name at all used to produce a completed removal: no folder, no job,
   * nothing running, and a record written anyway. Nothing prunes that record
   * and the board FILTERS on it — so a name removed by mistake, or typed into
   * the address bar, silently hid a real agent created under that name later,
   * showing no card and nothing on screen to explain where it went.
   */
  status.setPaneSource(() => '');
  const p = remove.plan('never-existed');
  assert.equal(p.ok, false, 'a name with no folder, no job and no session was offered a removal');
  assert.match(p.because, /cannot find an agent/);

  world();
  remove.setDryRun(false);
  const r = remove.remove('never-existed');
  assert.equal(r.outcome, remove.OUTCOME.REFUSED, r.because);
  assert.ok(!remove.removedAgents().some((x) => x.name === 'never-existed'),
    'a name that was never an agent is now on the removed list, where it will hide a real one later');

  // ⚠️ THE CONTROL. A real agent must still pass the same gate, or this test
  // would be satisfied by a guard that refuses everything.
  const real = madeAgent('really-here');
  assert.equal(remove.plan(real).ok, true, 'the guard refuses agents that do exist');
});

test('a half-removed agent is recoverable, retryable, and still visible', () => {
  /**
   * ⚠️ THE STATE WITH NO WAY OUT, which is what this test exists to prevent.
   *
   * When the job is disabled but the session survives, three things all have to
   * be true at once, and each was false at some point in this feature's life:
   *
   *   it is RECORDED   — or there is no Restore button, and the only route back
   *                      is the manual launchctl recipe;
   *   it is VISIBLE    — or a possibly-running agent has been hidden, which is
   *                      the one thing this board must never do;
   *   it is RETRYABLE  — or the person is looking at an agent that did not stop,
   *                      under a button answering "it has already been removed".
   */
  const name = madeAgent('stuck-halfway');
  boardShows(name, name);
  world({ killWorks: false });
  remove.setDryRun(false);

  const first = remove.remove(name);
  assert.equal(first.outcome, remove.OUTCOME.PARTIAL, first.because);
  assert.equal(remove.isRemoved(name), true, 'not recorded: there is no way to put it back');
  assert.equal(remove.isHidden(name), false, 'hidden while it may still be running');
  assert.match(first.because, /put it back from the removed list/,
    'nothing tells the person there is a way back');

  // RETRYABLE: the same removal, offered again rather than refused.
  const again = remove.plan(name);
  assert.equal(again.ok, true, 'a half-removed agent cannot be removed again, so it is stuck: ' + again.because);

  // And when the kill works the second time, it completes and goes.
  world({ killWorks: true });
  remove.setDryRun(false);
  const second = remove.remove(name);
  assert.equal(second.outcome, remove.OUTCOME.REMOVED, second.because);
  assert.equal(remove.isHidden(name), true, 'a completed retry still leaves it on the board');

  // ⚠️ AND RESTORE WORKS FROM THE HALF STATE TOO — the record was written by
  // the partial, so this is the path a person actually reaches from that row.
  const back = remove.restore(name);
  assert.equal(back.outcome, remove.OUTCOME.RESTORED, back.because);
  assert.equal(remove.isRemoved(name), false, 'restoring left the record behind');
});

test('a removed name cannot be created into invisibility', () => {
  /**
   * ⚠️ THE TRAP WITH NO TELL, which is why this is refused rather than allowed.
   *
   * The board hides removed agents BY NAME, nothing prunes the list, and a
   * removal deletes nothing — so creating a fresh agent under a removed name
   * used to succeed and then be filtered off the board on every poll. No card,
   * no error, nothing on screen to explain it. Somebody hitting that has no
   * route to the answer at all.
   */
  const name = madeAgent('reused-name');
  boardShows(name, name);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);
  assert.equal(remove.isHidden(name), true, 'the fixture is not hidden, so nothing below can fail');

  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  status.setPaneSource(() => '');
  try {
    const again = create.createAgent({ ...BINS, name, role: 'pm' });
    assert.equal(again.outcome, create.OUTCOME.REFUSED,
      'a new agent was created under a removed name, so it exists and the board will never show it');
    assert.match(again.because, /removed list/,
      'the refusal does not mention the removed list, so the person cannot act on it');
    assert.match(again.because, /Show removed agents/,
      'it refuses without pointing at Restore, which is what they almost certainly want');
  } finally {
    create.setRunner(null);
    status.setPaneSource(null);
  }

  // ⚠️ THE CONTROL. Putting it back frees the name, or this refusal would be a
  // permanent tax on every name ever removed.
  assert.equal(remove.restore(name).outcome, remove.OUTCOME.RESTORED);
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  status.setPaneSource(() => '');
  try {
    const after = create.createAgent({ ...BINS, name: 'reused-name-2', role: 'pm' });
    assert.equal(after.outcome, create.OUTCOME.CREATED, after.because);
  } finally {
    create.setRunner(null);
    status.setPaneSource(null);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Act on the session name, SPEAK the display name
//
// ⚠️ These two names are the same string for every agent Kosmos creates -- the
// only kind most of the fixtures above use -- and differ for exactly the
// pre-existing agents this feature was rebuilt to support. On the real fleet
// the pair is `claudebot` / `Splinter`. The split has now produced a defect
// pointing EACH way: the board once filtered on the display name while a
// removal recorded the session name, and later the confirmation asked about the
// session name on a screen showing the display name. Every test below uses a
// fixture where the two genuinely differ, because one where they agree passes
// against code that has the rule backwards.
// ─────────────────────────────────────────────────────────────────────────────

/** A pre-existing agent whose card says one thing and whose session says another. */
function twoNamedAgent(session, shown) {
  foreignAgent(session);
  fs.writeFileSync(
    nodePath.join(create.workerDir(session), 'CLAUDE.md'),
    `You are **${shown}**, a project manager.\n`,
    'utf8',
  );
  return session;
}

test('every sentence about a removal speaks the name on the card, not the one on the machine', () => {
  const name = twoNamedAgent('spoken-session', 'Spoken');
  // ⚠️ THE CONTROL: prove the fixture actually has two different names before
  // asserting anything about which one is used. Without this the whole test
  // passes against an agent whose names agree, which is every other fixture here.
  assert.equal(status.readIdentity(name).displayName, 'Spoken', 'the fixture does not have two names');
  assert.notEqual(status.readIdentity(name).displayName, name);

  boardShows(name, `${name}-discord`);
  world();
  remove.setDryRun(false);

  const ask = remove.plan(name);
  assert.match(ask.question, /Spoken/, 'the question does not use the name on the card');
  assert.doesNotMatch(ask.question, /spoken-session/, 'the question uses the machine name');
  assert.equal(ask.label, 'Spoken', 'the buttons have nothing to name the agent with');
  assert.equal(ask.name, 'spoken-session', 'the machine name did not reach the field the removal acts on');

  const gone = remove.remove(name);
  assert.equal(gone.outcome, remove.OUTCOME.REMOVED, gone.because);
  // ⚠️ The ANSWER, not just the question. This is the half that was missed: the
  // confirmation said "Remove Spoken" and the outcome came back about
  // `spoken-session`, so one dialog showed two names for one agent.
  assert.match(gone.because, /Spoken/, 'the outcome message uses the machine name');
  assert.doesNotMatch(gone.because, /spoken-session/, 'the outcome message uses the machine name');

  // ⚠️ And the record carries it, so the removed LIST can show a recognisable
  // row. That list is the one screen where the agent has no card to read it off.
  const rec = remove.removedAgents().find((r) => r.name === name);
  assert.equal(rec.shownAs, 'Spoken', 'the removed list has nothing recognisable to show');
  assert.equal(rec.name, 'spoken-session', 'the record lost the name Restore has to act on');

  const back = remove.restore(name);
  assert.equal(back.outcome, remove.OUTCOME.RESTORED, back.because);
  assert.match(back.because, /Spoken/, 'the restore message uses the machine name');
  assert.doesNotMatch(back.because, /spoken-session/, 'the restore message uses the machine name');
});

test('a removed agent is still named recognisably after its instruction file changes', () => {
  // ⚠️ Why `shownAs` is CAPTURED at removal rather than re-derived when the list
  // is drawn. The agent is off the board for as long as somebody leaves it
  // there, and its folder stays editable the whole time -- so re-deriving would
  // silently rename the row, or fall back to the machine name, in exactly the
  // situation where the person is trying to recognise something they removed.
  const name = twoNamedAgent('drifted-session', 'Drifted');
  boardShows(name, `${name}-discord`);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'no name line at all\n', 'utf8');
  assert.equal(status.readIdentity(name).displayName, name,
    'the control failed: re-deriving still finds the old name, so this test proves nothing');

  const rec = remove.removedAgents().find((r) => r.name === name);
  assert.equal(rec.shownAs, 'Drifted', 'the row would now show a name the person never saw');
});

// ─────────────────────────────────────────────────────────────────────────────
// The paths that leave an agent stopped
// ─────────────────────────────────────────────────────────────────────────────

test('a removed list that cannot be written reports a partial rather than crashing', () => {
  /**
   * ⚠️ THE ONE STATE WITH NO WAY BACK, reached by an exception rather than by a
   * decision. By the time the record is written the job is already disabled and
   * booted out, so a throw escaping here leaves the agent stopped, disabled and
   * on no removed list: no Restore button, and the only route back is the
   * manual launchctl recipe this product exists to spare people.
   *
   * ⚠️ IT HAS TO BE A **PARTIAL** PATH, and the first version of this test was
   * not. It removed cleanly, so the only `recordRemoval` it reached was the one
   * already inside `step()` -- which catches throws by construction. The test
   * passed identically with the fix reverted: it proved that `step` works,
   * which nobody doubted, while the four calls the fix is about sit OUTSIDE it.
   * Caught by reverting the fix and watching nothing fail.
   *
   * So: `bootout` refuses. That is the earliest partial, it is reached with the
   * job already disabled, and its `recordRemoval` is one of the bare four.
   */
  const name = madeAgent('unwritable-record');
  boardShows(name, name);
  remove.setRunner((file, args) => (args && args[0] === 'bootout'
    ? { ok: false, code: 2 }
    : { ok: true, stdout: '' }));
  remove.setDryRun(false);

  /**
   * ⚠️ THIS FIXTURE EXERCISES THE **READ** REFUSAL, not the write. A directory
   * where the file goes makes `readFileSync` throw EISDIR, so
   * `readRemovedForWrite` answers UNREADABLE and the write is never attempted.
   * That is worth pinning on its own -- refusing beats overwriting every other
   * agent's record -- but the docblock here used to claim it covered the throw
   * containment around `writeRemoved`, and it did not. The test below this one
   * does.
   */
  fs.rmSync(remove.REMOVED_FILE, { force: true });
  fs.mkdirSync(remove.REMOVED_FILE, { recursive: true });
  try {
    // ⚠️ CONTROL: prove the read really is impossible before believing the
    // outcome. A misjudged fixture makes a crashing path look handled.
    assert.throws(() => fs.readFileSync(remove.REMOVED_FILE, 'utf8'),
      'the fixture did not actually block the read, so this proves nothing');

    const gone = remove.remove(name);
    assert.equal(gone.outcome, remove.OUTCOME.PARTIAL,
      'an unwritable removed list crashed the removal instead of reporting it');

    // ⚠️ And it must NOT promise a Restore button that will not be there. A
    // contained failure still telling somebody to "put it back from the removed
    // list" is the same lie in a quieter voice.
    assert.doesNotMatch(gone.because, /put it back from the removed list/,
      'it sends them to a list that has no row for this agent');
    assert.match(gone.because, /will not appear there/,
      'it does not say the agent is missing from the removed list');
    assert.match(gone.because, /com\.kosmos\.agent\.unwritable-record/,
      'it does not name the startup job, which is the only remaining way back');
  } finally {
    fs.rmSync(remove.REMOVED_FILE, { recursive: true, force: true });
  }
});

test('a partial that DID record still points at the removed list', () => {
  // ⚠️ The control for the test above. "It does not promise Restore" passes
  // just as well against code that never promises it, so the ordinary partial
  // has to be shown still saying the helpful thing.
  const name = madeAgent('recorded-partial');
  boardShows(name, name);
  remove.setRunner((file, args) => (args && args[0] === 'bootout'
    ? { ok: false, code: 2 }
    : { ok: true, stdout: '' }));
  remove.setDryRun(false);

  const gone = remove.remove(name);
  assert.equal(gone.outcome, remove.OUTCOME.PARTIAL);
  assert.match(gone.because, /put it back from the removed list/,
    'an ordinary partial stopped telling people how to undo it');
  assert.equal(remove.isRemoved(name), true, 'the partial was not recorded at all');
  assert.equal(remove.removedAgents().find((r) => r.name === name).stopped, false,
    'a half-removed agent was recorded as stopped, which takes a possibly-running agent off the board');
});

// ─────────────────────────────────────────────────────────────────────────────
// Restore, on the paths that are not the happy one
//
// Restore is what makes a single light confirmation honest, so its failures
// matter more than most. Only its success and its refusal were covered.
// ─────────────────────────────────────────────────────────────────────────────

test('restore says so when the startup file has gone, rather than claiming it started it', () => {
  // Somebody deleted the plist by hand while the agent was off the board. The
  // `enable` still stands, so their own tooling can start it -- but bootstrap
  // has nothing to load, and saying "it is back" would assert something nobody
  // checked.
  const name = foreignAgent('plist-vanished');
  boardShows(name, `${name}-discord`);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  const plist = remove.removedAgents().find((r) => r.name === name).plist;
  assert.ok(fs.existsSync(plist), 'the control failed: the fixture never had a plist to delete');
  fs.rmSync(plist, { force: true });

  const calls = world();
  remove.setDryRun(false);
  const r = remove.restore(name);

  assert.equal(r.outcome, remove.OUTCOME.RESTORED, r.because);
  assert.ok(calls.some(([, a]) => a && a[0] === 'enable'),
    'it did not re-enable the job, which is the half that still works');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'bootstrap'),
    'it tried to load a startup file that is not there');
  /**
   * ⚠️ AND THE SENTENCE, which is what this test was missing. Asserting the
   * outcome and the absent `bootstrap` passed against a message reading
   * "<name> is back on the board and set to start again" -- an assertion that
   * launchd will start something it has nothing to load. The behaviour was
   * right and the words were wrong, and only the words reach the person.
   */
  assert.match(r.because, /will not start on its own/,
    'it promises the agent is set to start again when there is no file left to start it');
  assert.doesNotMatch(r.because, /set to start again\./,
    'it still claims the startup job will bring the agent back');
});

test('a job that will not re-enable is reported, not reported as restored', () => {
  const name = madeAgent('stuck-enable');
  boardShows(name, name);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  // launchctl refuses the enable. The record still has to come off the list --
  // leaving it would hide an agent nobody is hiding -- but the person must be
  // told it may need starting by hand.
  remove.setRunner((file, args) => (args && args[0] === 'enable'
    ? { ok: false, code: 2 }
    : { ok: true, stdout: '' }));
  remove.setDryRun(false);
  const r = remove.restore(name);

  assert.equal(r.outcome, remove.OUTCOME.PARTIAL,
    'a failed re-enable was reported as a completed restore');
  assert.match(r.because, /back on the board/);
  assert.match(r.because, /starting by hand/,
    'it does not tell them the agent may not come back on its own');
  assert.equal(remove.isRemoved(name), false,
    'it stayed on the removed list, so the board hides an agent Kosmos is no longer hiding');
});

test('an already-loaded job is a success, not a failure', () => {
  // launchctl answers 5 for "already loaded", which is the end state wanted.
  // Reading it as a failure would report a PARTIAL over a working restore.
  const name = madeAgent('already-loaded');
  boardShows(name, name);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  remove.setRunner((file, args) => (args && args[0] === 'bootstrap'
    ? { ok: false, code: 5 }
    : { ok: true, stdout: '' }));
  remove.setDryRun(false);
  assert.equal(remove.restore(name).outcome, remove.OUTCOME.RESTORED,
    'launchd saying the job is already loaded was read as a failure to load it');
});

test('an agent that had no startup job is not told one was turned back on', () => {
  // ⚠️ Two sentences exist for this. Telling somebody an agent is "set to start
  // again" when there is no job to start is a claim about something that does
  // not exist -- the same shape as every other unchecked assertion this
  // codebase catalogues, in the one message meant to reassure them.
  const name = 'jobless';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), `You are **${name}**.\n`, 'utf8');
  assert.equal(remove.jobFor(name), null, 'the control failed: the fixture has a job after all');

  boardShows(name, name);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  const calls = world();
  remove.setDryRun(false);
  const r = remove.restore(name);
  assert.equal(r.outcome, remove.OUTCOME.RESTORED, r.because);
  assert.match(r.because, /nothing to turn back on/,
    'it claims a startup job was re-enabled for an agent that never had one');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'enable'),
    'it tried to enable a job that does not exist');
});

test('an env-driven dry run cannot pass itself off as a real removal', () => {
  /**
   * ⚠️ The failure this module already shipped once, still reachable through
   * `AGENT_WORKFORCE_DRY_RUN=1`. Every command answers success and every write
   * short-circuits, so the removal reports REMOVED having done nothing — the
   * exact "silently do nothing while claiming success" the default was moved
   * out of the module to prevent. The env var stays, because it is a real dev
   * affordance; what it must not do is look identical to work.
   */
  const name = madeAgent('dry-marker');
  boardShows(name, name);
  remove.setRunner(null);   // re-arms dry-run, with no runner installed
  const r = remove.remove(name);

  /**
   * ⚠️ CONTROL: it took a path that DESCRIBES WORK, or "it is marked" is true of
   * a refusal and proves nothing. It lands on a partial rather than a full
   * removal, and that is itself worth pinning: every command answers success in
   * this mode, including the look-again after the kill, so the engine reads the
   * session as still running.
   */
  assert.notEqual(r.outcome, remove.OUTCOME.REFUSED, r.because);

  assert.equal(r.dryRun, true, 'a dry run is indistinguishable from a real removal to any caller');
  assert.match(r.because, /Nothing actually happened/,
    'the sentence a person reads claims the agent was removed when nothing was touched');
});

test('a removed list that reads but cannot be WRITTEN is a partial, not a crash', () => {
  /**
   * ⚠️ THE PATH THE SIBLING TEST ABOVE DOES NOT REACH, and the one the longest
   * comment in the module is about.
   *
   * `recordRemoval` reads first and refuses on an unreadable list, so a fixture
   * that blocks the READ never gets as far as `writeRemoved`. To reach the
   * write the read has to SUCCEED and the write has to fail — so: a perfectly
   * valid `removed.json` inside a directory with the write bit off. Verified
   * both ways in the controls below, because a fixture that fails to fail is
   * how the previous version of this looked like coverage for a year.
   *
   * Without the try/catch, this throws out of `remove()`, out of the route and
   * out of the process — with the agent already disabled and booted out.
   */
  const name = madeAgent('unwritable-dir');
  boardShows(name, name);
  remove.setRunner((file, args) => (args && args[0] === 'bootout'
    ? { ok: false, code: 2 }
    : { ok: true, stdout: '' }));
  remove.setDryRun(false);

  const dir = nodePath.dirname(remove.REMOVED_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(remove.REMOVED_FILE, { recursive: true, force: true });
  fs.writeFileSync(remove.REMOVED_FILE, '[]\n', 'utf8');
  fs.chmodSync(dir, 0o500);   // r-x: readable, not writable
  try {
    // ⚠️ CONTROL 1: the list really is still readable, or this is the sibling
    // test in disguise and proves nothing new.
    assert.equal(fs.readFileSync(remove.REMOVED_FILE, 'utf8'), '[]\n',
      'the fixture blocked the read too, so this exercises the wrong branch');
    // ⚠️ CONTROL 2: and the write really is impossible.
    assert.throws(() => fs.writeFileSync(nodePath.join(dir, 'probe.tmp'), 'x'),
      'the directory is still writable, so the containment is never tested');

    const gone = remove.remove(name);
    assert.equal(gone.outcome, remove.OUTCOME.PARTIAL,
      'a write that threw escaped the removal and would take the process with it');
    assert.match(gone.because, /will not appear there/,
      'it does not say the agent is missing from the removed list');
    assert.match(gone.because, /com\.kosmos\.agent\.unwritable-dir/,
      'it does not name the startup job, which is the only remaining way back');
  } finally {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(remove.REMOVED_FILE, { force: true });
  }
});

test('an agent stopped but never recorded is told where its way back is', () => {
  /**
   * ⚠️ THE LAST STATE WITH NO WAY BACK, and until this test nothing reached it.
   *
   * Everything worked — disabled, booted out, session ended — and only the
   * record failed. The agent is now stopped, disabled, on no removed list, and
   * with no card either, because the board is built from live tmux panes and
   * the session is gone. Invisible in every direction.
   *
   * The sentence here used to say it "will still appear on the board", which is
   * the opposite of true, and it named no way back at all — while every other
   * partial hands over the launchd label. This is the one path where the person
   * has nothing else to go on.
   *
   * ⚠️ And it is not an exotic path: `readRemoved` fails open, so a `removed.json`
   * that is corrupt rather than absent sends every otherwise-successful removal
   * straight here.
   */
  const name = madeAgent('stopped-unrecorded');
  boardShows(name, name);
  // Everything succeeds; only the record will fail.
  remove.setRunner((file, args) => (args && args[0] === 'has-session'
    ? { ok: false, code: 1 }
    : { ok: true, stdout: '' }));
  remove.setDryRun(false);

  const dir = nodePath.dirname(remove.REMOVED_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(remove.REMOVED_FILE, { recursive: true, force: true });
  fs.writeFileSync(remove.REMOVED_FILE, '[]\n', 'utf8');
  fs.chmodSync(dir, 0o500);
  try {
    const gone = remove.remove(name);

    // ⚠️ CONTROL: it really did get all the way to the record, or this is one
    // of the earlier partials wearing the same outcome.
    const labels = gone.steps.map((s) => s.label);
    assert.ok(labels.includes('stopped it'),
      'it never reached the session step, so this is an earlier partial and proves nothing');
    assert.equal(gone.outcome, remove.OUTCOME.PARTIAL, gone.because);

    assert.doesNotMatch(gone.because, /still appear on the board/,
      'it says the agent is still on the board, and the board is built from sessions it just killed');
    assert.match(gone.because, /com\.kosmos\.agent\.stopped-unrecorded/,
      'the one path where the person has nothing else to go on does not name the startup job');
    assert.match(gone.because, /turning that back on is what undoes this/,
      'it names the job without saying what to do with it');
  } finally {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(remove.REMOVED_FILE, { force: true });
  }
});

test('a case-variant spelling cannot report a live agent removed while touching nothing', () => {
  /**
   * ⚠️ macOS VOLUMES ARE CASE-INSENSITIVE BY DEFAULT, so `fs.existsSync` on a
   * path built from `CASEY` resolves `casey`'s real plist and real folder --
   * while every step after the probe keys on the exact string. Measured before
   * the fix, in a sandbox, against a real agent running in tmux:
   *
   *     remove('CASEY') -> removed | "casey has been removed from Kosmos."
   *     commands run:      disable gui/501/com.kosmos.agent.CASEY
   *                        bootout gui/501/com.kosmos.agent.CASEY
   *     isHidden('casey') = false
   *
   * Three separate harms from one probe: the screen names a LIVE agent as
   * removed; nothing is done to that agent; and a persistent disabled override
   * is written into launchd's per-user database under a label that has never
   * existed, with no file anywhere recording it. That last one is exactly the
   * invisible state the README's `enable` paragraph warns about.
   *
   * ⚠️ Every other fixture in both test files uses the exact spelling, which is
   * why nothing saw this. The whole point of this test is the spelling.
   */
  const name = madeAgent('cased');
  boardShows(name, name);
  const calls = world();
  remove.setDryRun(false);

  /**
   * ⚠️ CONTROL: the platform really does behave this way, or the test passes
   * for the wrong reason on a case-SENSITIVE volume and silently stops covering
   * anything the day the code regresses.
   */
  assert.ok(fs.existsSync(create.workerDir('CASED')),
    'this volume is case-sensitive, so this test is not exercising the hazard it was written for');

  const r = remove.remove('CASED');

  assert.equal(r.outcome, remove.OUTCOME.REFUSED, `an alias spelling was accepted: ${r.because}`);
  assert.match(r.because, /cannot find an agent called CASED/,
    'the refusal names a different, living agent than the one that was asked about');
  assert.deepEqual(calls, [],
    'it ran launchctl against a label that does not exist, leaving a disabled override nothing records');
  assert.equal(remove.isRemoved('CASED'), false, 'it filed a removal record for an agent that does not exist');
  assert.equal(remove.isHidden(name), false, 'the real agent was hidden by a request that never named it');
  assert.equal(remove.isRemoved(name), false, 'the real agent was recorded as removed');
});

test('a restore that cannot clear the removed list says so, and says which half failed', () => {
  /**
   * ⚠️ THIS BRANCH WAS DEAD TO THE SUITE. Short-circuiting it — so a failed
   * list-write reported RESTORED — left all 331 tests green, and neither of its
   * two sentences appeared anywhere in either test file.
   *
   * It matters because of what the SCREEN does with the answer: the record is
   * still on the list, so `/api/removed` is unchanged, so the row's markup is
   * unchanged, so the poll's change-guard correctly declines to repaint — and
   * the row keeps the disabled "Restoring…" the click handler set. A restore
   * reported as successful there is an undo button that is now dead.
   */
  const name = madeAgent('stuck-forget');
  boardShows(name, name);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  const dir = nodePath.dirname(remove.REMOVED_FILE);
  remove.setRunner(() => ({ ok: true, stdout: '' }));   // the enable succeeds
  remove.setDryRun(false);
  fs.chmodSync(dir, 0o500);
  try {
    // ⚠️ CONTROL: the list really cannot be rewritten, and it really is still
    // readable — or this is the read-refusal path in disguise.
    assert.ok(fs.readFileSync(remove.REMOVED_FILE, 'utf8').includes(name),
      'the record is not there to be cleared, so this proves nothing');
    assert.throws(() => fs.writeFileSync(nodePath.join(dir, 'probe.tmp'), 'x'),
      'the directory is writable, so the failure under test cannot occur');

    const r = remove.restore(name);
    assert.equal(r.outcome, remove.OUTCOME.PARTIAL,
      'a restore that could not clear the removed list reported success, leaving a dead undo button');
    assert.match(r.because, /may still be hidden/,
      'it does not say the agent is still hidden, which is the visible symptom');
    assert.equal(remove.isRemoved(name), true, 'the control failed: the record went away after all');
  } finally {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(remove.REMOVED_FILE, { force: true });
  }
});

test('when BOTH halves of a restore fail, it does not claim the agent was started', () => {
  // ⚠️ The two failures are independent and this branch used to speak for one:
  // it opened with "we started <name> again" while the enable had just been
  // watched to fail, and the "may need starting by hand" sentence never
  // rendered because this return came first.
  const name = madeAgent('both-failed');
  boardShows(name, name);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  const dir = nodePath.dirname(remove.REMOVED_FILE);
  remove.setRunner((file, args) => (args && args[0] === 'enable'
    ? { ok: false, code: 2 }
    : { ok: true, stdout: '' }));
  remove.setDryRun(false);
  fs.chmodSync(dir, 0o500);
  try {
    const r = remove.restore(name);
    assert.equal(r.outcome, remove.OUTCOME.PARTIAL, r.because);
    assert.doesNotMatch(r.because, /we started .* again/,
      'it claims the agent was started by code that had just watched the start fail');
    assert.match(r.because, /could not start/, 'it does not say the start failed');
    assert.match(r.because, /stays hidden and stopped/, 'it does not say what state the agent is left in');
  } finally {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(remove.REMOVED_FILE, { force: true });
  }
});

test('the env var alone arms dry-run, not just a cleared runner', () => {
  // ⚠️ The sibling test reaches the same `DRY_RUN && !runner` predicate through
  // `setRunner(null)`, so the ENV arm — `process.env.AGENT_WORKFORCE_DRY_RUN
  // === '1'` at module load — was never itself exercised. It is the arm an
  // operator actually uses, and the one that can make the product report work
  // it did not do.
  const { execFileSync } = require('node:child_process');
  const probe = 'const r = require(process.argv[1]); console.log(JSON.stringify(r.DRY_RUN));';
  const withEnv = execFileSync(process.execPath, ['-e', probe, nodePath.join(__dirname, 'remove.js')],
    { encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DRY_RUN: '1' } }).trim();
  const without = execFileSync(process.execPath, ['-e', probe, nodePath.join(__dirname, 'remove.js')],
    { encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DRY_RUN: '' } }).trim();

  // ⚠️ Both directions in a FRESH process, because this file has already armed
  // dry-run by the time any test in it runs.
  assert.equal(withEnv, 'true', 'AGENT_WORKFORCE_DRY_RUN=1 does not arm dry-run, so a dev run does real work');
  assert.equal(without, 'false', 'dry-run is the default, which makes the product silently do nothing');
});

test('an unreadable removed list is refused, not used as an empty starting point', () => {
  /**
   * ⚠️ THE INVARIANT WITH THE LONGEST COMMENT IN THE MODULE, AND NOTHING HELD
   * IT. Reverting `if (existing === UNREADABLE) return false;` to fall back to
   * `[]` left the whole suite green.
   *
   * What that revert actually costs, measured rather than argued: with a
   * transiently unreadable `removed.json`, a removal of ONE agent rewrites the
   * list from an empty base and **destroys every other removed agent's
   * `label`, `plist` and `shownAs`** -- the three fields that are the entire
   * reason Restore can work. The fail-open read then hides the damage by
   * putting them all back on the board as though nothing happened.
   *
   * `readRemoved` failing open is right for the QUERY (a list we cannot read
   * must not become a board that hides agents for reasons nobody can inspect)
   * and wrong as the base of a read-modify-write. This test is the difference.
   */
  const keep = madeAgent('keep-me');
  const other = madeAgent('remove-me');
  boardShows(keep, keep);
  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(keep).outcome, remove.OUTCOME.REMOVED);

  // ⚠️ CONTROL: the record we are protecting is really there, with the fields
  // that make Restore possible, before anything is made unreadable.
  const before = remove.removedAgents().find((r) => r.name === keep);
  assert.ok(before && before.label && before.shownAs,
    'the control failed: there is no populated record to lose, so this proves nothing');

  const raw = fs.readFileSync(remove.REMOVED_FILE, 'utf8');
  fs.chmodSync(remove.REMOVED_FILE, 0o000);
  try {
    // ⚠️ CONTROL: it really is unreadable now. On a machine running as root
    // chmod 000 does not deny the owner, and this test would silently stop
    // covering anything.
    let readable = true;
    try { fs.readFileSync(remove.REMOVED_FILE, 'utf8'); } catch { readable = false; }
    assert.equal(readable, false, 'the list is still readable, so the refusal under test cannot fire');

    boardShows(other, other);
    world();
    remove.setDryRun(false);
    const second = remove.remove(other);
    assert.equal(second.outcome, remove.OUTCOME.PARTIAL,
      'it removed an agent while unable to read the list, so it was about to rewrite the list from nothing');
    assert.match(second.because, /will not appear there/);
  } finally {
    fs.chmodSync(remove.REMOVED_FILE, 0o600);
  }

  // ⚠️ THE ASSERTION THAT MATTERS: the other agent's way back is still intact.
  assert.equal(fs.readFileSync(remove.REMOVED_FILE, 'utf8'), raw,
    'the removed list was rewritten from an unreadable base, destroying every other agent\'s label and plist');
  const after = remove.removedAgents().find((r) => r.name === keep);
  assert.equal(after.label, before.label, 'the surviving record lost the label Restore has to re-enable');
  assert.equal(after.shownAs, before.shownAs, 'the surviving record lost the name the removed list shows');
});

test('a removed list that parses to something that is not a list is corrupt, not empty', () => {
  // ⚠️ The sibling of the guard above, and equally unheld: `if
  // (!Array.isArray(parsed)) return UNREADABLE`. A file that parses to an
  // object is not an empty list, and treating it as one is the same overwrite
  // by another route. The existing "unreadable removed-list hides nothing"
  // test asserts only the READ side, which fails open by design.
  const name = madeAgent('corrupt-base');
  boardShows(name, name);
  world();
  remove.setDryRun(false);

  fs.mkdirSync(nodePath.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, '{"not":"a list"}\n', 'utf8');
  // ⚠️ CONTROL: it really does parse. A file that fails JSON.parse would take
  // the other branch and this would prove nothing about the Array check.
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(remove.REMOVED_FILE, 'utf8')),
    'the fixture is unparseable, so it exercises the wrong branch');

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL,
    'it overwrote a file it could not understand, which is how a corrupt list becomes a silent data loss');
  assert.equal(fs.readFileSync(remove.REMOVED_FILE, 'utf8').trim(), '{"not":"a list"}',
    'the corrupt file was replaced rather than left for somebody to look at');
});

test('a kill that reports success over a session that is STILL THERE is not a removal', () => {
  /**
   * ⚠️ THE WORST THING THIS MODULE CAN DO, and until now no fixture could even
   * describe it.
   *
   * `kill-session` answering 0 is not evidence the session has gone -- that is
   * the entire reason the look-again exists. Replacing the look-again with
   * `return true` left the suite green, because the only "kill" failure the old
   * fixture could model was the kill command itself failing, which
   * short-circuits one line earlier and never reaches this check.
   *
   * The case that matters is the quiet one: tmux says fine, the session is
   * still running, and without this the board reports an agent removed while it
   * is still working.
   */
  const name = madeAgent('kill-lied');
  boardShows(name, name);
  const calls = world({ killWorks: true, sessionSurvives: true });
  remove.setDryRun(false);

  const r = remove.remove(name);

  // ⚠️ CONTROL: the kill really was attempted and really did report success,
  // or this is the kill-failed path in disguise.
  const kill = calls.find(([, a]) => a && a[0] === 'kill-session');
  assert.ok(kill, 'no kill was attempted, so the look-again was never reached');
  assert.ok(calls.some(([, a]) => a && a[0] === 'has-session'),
    'it never looked again, so it took the kill command at its word');

  assert.equal(r.outcome, remove.OUTCOME.PARTIAL,
    'a session that outlived a successful-looking kill was reported as removed');
  assert.match(r.because, /could not stop it, so it is still going/);
  assert.equal(remove.isHidden(name), false,
    'the agent was hidden from the board while still running, which is the one thing it must never do');
  assert.equal(remove.isRemoved(name), true,
    'it is on no removed list, so a half-removal has no Restore button');
});

test('bootout answering "no such service" is the end state we wanted, not a failure', () => {
  // ⚠️ launchd answers 3 for a job that is not loaded. Reading that as a
  // failure reports a PARTIAL over a removal that fully worked, and sends
  // somebody to the manual recipe for nothing. Its counterpart --
  // `bootstrap`'s code 5 on restore -- has a test; this one did not.
  const name = madeAgent('already-unloaded');
  boardShows(name, name);
  remove.setRunner((file, args) => {
    if (args && args[0] === 'bootout') return { ok: false, code: 3 };
    if (args && args[0] === 'has-session') return { ok: false, code: 1 };
    return { ok: true, stdout: '' };
  });
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.REMOVED,
    'a job that was already unloaded was treated as a job that would not unload');
  assert.equal(remove.isHidden(name), true);
});

test('what the detail screen is told about removing an agent comes from here, and fits the agent', () => {
  /**
   * ⚠️ `plan().hint` HAD NO TEST AT ALL -- grepping either test file for `hint`
   * returned nothing, so the whole field could be deleted or made wrong for
   * free. It was moved into the engine precisely because the browser composing
   * it produced a sentence that was false for a jobless agent, and then the fix
   * shipped without the coverage its siblings got.
   */
  const withJob = madeAgent('has-a-job');
  boardShows(withJob, withJob);
  // ⚠️ CONTROL: the two fixtures really do differ in the property under test.
  assert.ok(remove.jobFor(withJob), 'the control failed: the with-job fixture has no job');
  const jobless = 'no-job-at-all';
  fs.mkdirSync(create.workerDir(jobless), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(jobless), 'CLAUDE.md'), 'You are **Jobless**.\n', 'utf8');
  assert.equal(remove.jobFor(jobless), null, 'the control failed: the jobless fixture has a job');

  const a = remove.plan(withJob);
  assert.ok(a.hint, 'the detail screen is given nothing to say about what removing does');
  assert.match(a.hint, /stops it starting again/);
  assert.match(a.hint, /Nothing on your computer is deleted/,
    'it does not answer the one thing they might fear');

  boardShows(jobless, jobless);
  const b = remove.plan(jobless);
  assert.match(b.hint, /not set to start on its own/,
    'it promises to stop something starting again for an agent that nothing was going to start');
  assert.doesNotMatch(b.hint, /stops it starting again/,
    'the jobless hint still describes work that will not happen');
});

test('a partial about an agent with no startup job does not claim one was turned off', () => {
  // ⚠️ `didToJob`'s jobless arm was untested, so the sentence it exists to
  // prevent -- "we stopped X from starting again" about an agent that has
  // nothing to stop -- could come back for free.
  const name = 'jobless-partial';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), `You are **${name}**.\n`, 'utf8');
  assert.equal(remove.jobFor(name), null, 'the control failed: this fixture has a startup job');

  boardShows(name, name);
  // The kill reports success and the session is still there: a partial, reached
  // with no job in the picture at all.
  world({ killWorks: true, sessionSurvives: true });
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, r.because);
  assert.doesNotMatch(r.because, /we stopped .* from starting again/,
    'it reported stopping a startup job that does not exist');
  assert.match(r.because, /was not set to start on its own/,
    'it does not say what was actually true of the job');
});

test('an agent with no folder is not reassured about a folder', () => {
  // ⚠️ The success sentence's folder branch was the one sibling missed when the
  // other three were fixed, and its own comment says so. `exists()` admits an
  // agent on a startup job alone, so this is reachable.
  const name = 'plist-only';
  fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>', 'utf8');
  // ⚠️ CONTROL: no folder, and there IS something to remove.
  assert.equal(fs.existsSync(create.workerDir(name)), false, 'the control failed: this fixture has a folder');
  assert.ok(remove.jobFor(name), 'the control failed: nothing exists to remove');

  status.setPaneSource(() => '');
  world();
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);
  assert.doesNotMatch(r.because, /Its folder/,
    'it reassured somebody about a folder the agent never had');
  assert.match(r.because, /Nothing on your computer was deleted/);
});

test('the two partials a person actually hits still record, so Restore is there', () => {
  /**
   * ⚠️ NEITHER OF THESE WAS HELD. Deleting `recordAndSay(false)` from the
   * unreachable-tmux partial or from the untied-session partial left all 344
   * tests green -- and those are the two the module's own comment singles out:
   * *"these three returns were left behind, and they are the ones a person
   * actually hits, because an unreachable tmux and an untied session are
   * ordinary."*
   *
   * Losing the record on either one puts the agent back in the state this whole
   * module is shaped around avoiding: job disabled and booted out, no row on the
   * removed list, no Restore button, and only the manual launchctl recipe left.
   * Their kill-failed sibling had a test; these did not.
   */

  // (1) tmux cannot be asked at all, AFTER the job work has happened.
  const a = madeAgent('tmux-gone-midway');
  boardShows(a, a);
  world();
  remove.setDryRun(false);
  // ⚠️ Tied when `plan` looks, unaskable by the time the session is checked --
  // the only way to reach this partial, since `plan` refuses up front otherwise.
  let asked = 0;
  status.setPaneSource(() => {
    asked += 1;
    if (asked <= 1) return fleet.line({ session: a, claim: a, title: '✳ Claude Code' });
    throw new Error('tmux went away');
  });
  const r1 = remove.remove(a);
  assert.equal(r1.outcome, remove.OUTCOME.PARTIAL, r1.because);
  assert.match(r1.because, /could not check whether it is still running/, 'this is a different partial than the one under test');
  assert.equal(remove.isRemoved(a), true,
    'it disabled and stopped the job and then filed no record, so there is no Restore button');
  assert.equal(remove.isHidden(a), false,
    'it hid an agent it could not confirm had stopped');
  assert.match(r1.because, /put it back from the removed list/,
    'it does not tell them the undo exists');

  // (2) something is running under this name that the board will not vouch for,
  // discovered after the job work.
  const b = madeAgent('untied-midway');
  let asked2 = 0;
  status.setPaneSource(() => {
    asked2 += 1;
    return asked2 <= 1
      ? fleet.line({ session: b, claim: b, title: '✳ Claude Code' })
      : fleet.line({ session: b, claim: 'somebody-else', title: '✳ Claude Code' });
  });
  world();
  remove.setDryRun(false);
  const r2 = remove.remove(b);
  assert.equal(r2.outcome, remove.OUTCOME.PARTIAL, r2.because);
  assert.match(r2.because, /cannot confirm is this agent/, 'this is a different partial than the one under test');
  assert.equal(remove.isRemoved(b), true,
    'it disabled and stopped the job and then filed no record, so there is no Restore button');
  assert.equal(remove.isHidden(b), false, 'it hid an agent that may still be running');
});

test('the startup job is disabled BEFORE it is booted out', () => {
  /**
   * ⚠️ LOAD-BEARING ORDER, DOCUMENTED AND UNHELD. Swapping the two -- with both
   * still checked -- left the suite green.
   *
   * The reason is in the module: between `bootout` and `disable` there is a
   * window where the job is unloaded but still enabled, and a login in that
   * window brings the agent straight back. Disabling first closes it. An
   * ordering whose only defence is a comment is an ordering somebody will
   * tidy.
   */
  const name = madeAgent('order-matters');
  boardShows(name, name);
  const calls = world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);

  const seq = calls.map(([, a]) => a && a[0]);
  const iDisable = seq.indexOf('disable');
  const iBootout = seq.indexOf('bootout');
  // ⚠️ CONTROL: both really ran, or "disable came first" is true of a run that
  // never booted anything out.
  assert.ok(iDisable !== -1, 'nothing was disabled, so the order proves nothing');
  assert.ok(iBootout !== -1, 'nothing was booted out, so the order proves nothing');
  assert.ok(iDisable < iBootout,
    'it unloaded the job before disabling it, leaving a window where a login brings the agent back');
});

test('a partial for an agent with no startup job does not name a job that is not there', () => {
  /**
   * ⚠️ `recoveryRoute`'s no-job branch was unheld. Replacing the whole function
   * with the unconditional job sentence left the suite at 346 green -- so the
   * suite could not see the product telling somebody *"Its startup job is null,
   * and re-enabling that is what undoes this."*
   *
   * Its three named siblings (`hint`, `didToJob`, restore's endings) are all
   * held. This one is the same family and was not on the plan's list of
   * deliberately-unheld guards either, which is the part worth fixing rather
   * than documenting.
   */
  const name = 'no-job-recovery';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), `You are **${name}**.\n`, 'utf8');
  assert.equal(remove.jobFor(name), null, 'the control failed: this fixture has a startup job');

  boardShows(name, name);
  world({ killWorks: true, sessionSurvives: true });
  remove.setDryRun(false);

  // Make the record fail, so the recovery sentence is the one that renders.
  const dir = nodePath.dirname(remove.REMOVED_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(remove.REMOVED_FILE, { recursive: true, force: true });
  fs.writeFileSync(remove.REMOVED_FILE, '[]\n', 'utf8');
  fs.chmodSync(dir, 0o500);
  try {
    const r = remove.remove(name);
    assert.equal(r.outcome, remove.OUTCOME.PARTIAL, r.because);
    // ⚠️ CONTROL: it really is the recovery sentence being rendered.
    assert.match(r.because, /will not appear there/, 'the record succeeded, so no recovery route is offered');

    assert.doesNotMatch(r.because, /Its startup job is/,
      'it named a startup job for an agent that has none');
    assert.doesNotMatch(r.because, /null|undefined/,
      'it printed a missing value straight onto the screen');
    assert.match(r.because, /Nothing will start it again on its own/,
      'it does not say what is actually true, which is that nothing will bring it back');
  } finally {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(remove.REMOVED_FILE, { force: true });
  }
});

test('the steps report what was done, including when nothing was', () => {
  // ⚠️ The no-startup-job step label was unheld: mutating it back to "stopped
  // it starting again" -- the exact wrong label its own comment names -- kept
  // the suite green. The browser ignores `steps`, but the route ships them, so
  // it is a sentence on the wire asserting work nobody did.
  const name = 'jobless-steps';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), `You are **${name}**.\n`, 'utf8');
  assert.equal(remove.jobFor(name), null, 'the control failed: this fixture has a startup job');

  boardShows(name, name);
  world();
  remove.setDryRun(false);
  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);

  const labels = r.steps.map((s) => s.label);
  // ⚠️ CONTROL: there really are steps to inspect.
  assert.ok(labels.length > 0, 'no steps were reported at all, so this asserts nothing');
  assert.ok(!labels.includes('stopped it starting again'),
    'it reported stopping a startup job for an agent that never had one');
  /* Back to naming the JOB, which is what this assertion's own message says it
     checks. The alternation that briefly replaced it matched a label about the
     SESSION, so the test certified a step list that contradicted itself. */
  assert.ok(labels.some((l) => /not set to start on its own/.test(l)),
    'it does not say what was actually true of the job');
});

test('the removed list is newest first, so the thing you just removed is at the top', () => {
  /**
   * ⚠️ Unheld: removing the sort passed. Small, but it is the ordering somebody
   * relies on the moment they have removed two agents and want the recent one.
   *
   * ⚠️ Seeded directly rather than by removing two agents, because two real
   * removals land in the same MILLISECOND and get identical ISO timestamps --
   * so the first version of this test could not distinguish any ordering at
   * all. Its own control caught that, which is the only reason this is a
   * fixture change rather than a test that passes for no reason.
   */
  fs.mkdirSync(nodePath.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, JSON.stringify([
    { name: 'seeded-oldest', removedAt: '2026-08-09T10:00:00.000Z', stopped: true },
    { name: 'seeded-newest', removedAt: '2026-08-11T10:00:00.000Z', stopped: true },
    { name: 'seeded-middle', removedAt: '2026-08-10T10:00:00.000Z', stopped: true },
  ]), 'utf8');

  const list = remove.removedAgents();
  // ⚠️ CONTROL: the file really is in a different order than the answer, or
  // "it sorts" is true of a function that returns its input untouched.
  assert.equal(JSON.parse(fs.readFileSync(remove.REMOVED_FILE, 'utf8'))[0].name, 'seeded-oldest',
    'the fixture is already sorted, so this proves nothing');

  assert.deepEqual(list.map((r) => r.name), ['seeded-newest', 'seeded-middle', 'seeded-oldest'],
    'the undo list is not newest-first, so the agent somebody just removed is not where they look');
});

test('the success sentence checks the folder by its exact spelling', () => {
  /**
   * ⚠️ Unheld until now: swapping `existsExactly` back to `fs.existsSync` here
   * left all 351 tests green, despite the comment above it explaining the
   * hazard and despite two sibling sites already being fixed for it.
   *
   * On a case-insensitive volume, removing `PLISTCASE` -- which has its own
   * exact plist and no folder of its own -- resolves the REAL `plistcase`
   * folder and promises "its folder is still on your computer" about a folder
   * that agent never had.
   */
  const real = 'plistcase';
  fs.mkdirSync(create.workerDir(real), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(real), 'CLAUDE.md'), `You are **${real}**.\n`, 'utf8');

  const asked = 'PLISTCASE';
  fs.mkdirSync(nodePath.dirname(create.plistPath(asked)), { recursive: true });
  fs.writeFileSync(create.plistPath(asked), '<plist/>', 'utf8');

  // ⚠️ CONTROLS: the volume really is case-insensitive, the asked-for agent has
  // no folder of its own, and there IS something to remove. Without all three
  // this passes for the wrong reason.
  assert.ok(fs.existsSync(create.workerDir(asked)),
    'this volume is case-sensitive, so the hazard under test cannot occur here');
  assert.ok(!fs.readdirSync(nodePath.dirname(create.workerDir(asked))).includes(asked),
    'the fixture accidentally has a folder under the asked-for spelling');
  assert.ok(remove.jobFor(asked), 'the control failed: nothing exists to remove');

  status.setPaneSource(() => '');
  world();
  remove.setDryRun(false);

  const r = remove.remove(asked);
  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);
  assert.doesNotMatch(r.because, /Its folder/,
    'it promised a folder that belongs to a different agent with a similar name');
  assert.match(r.because, /Nothing on your computer was deleted/);
});

test('an agent Kosmos cannot restart is not promised that Kosmos will put it back', () => {
  /**
   * ⚠️ Restore re-enables a launchd job; it does not start a tmux session. For
   * an agent WITH a job those are the same thing. For one without -- a
   * hand-started session, which `isNamedOurs` admits -- there is nothing to
   * re-enable, so the record comes off the list and no card appears, and
   * nothing will make one.
   *
   * Both sentences claimed otherwise: the confirmation said "you can put it
   * back", and restore said "is back on the board". That is the branch's own
   * rule slipping on the exact reassurance that makes a single light
   * confirmation honest.
   */
  const name = 'handstarted';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), `You are **${name}**.\n`, 'utf8');
  // ⚠️ CONTROL: it really has no job, and it really is removable.
  assert.equal(remove.jobFor(name), null, 'the control failed: this fixture has a startup job');
  boardShows(name, name);
  const ask = remove.plan(name);
  assert.equal(ask.ok, true, `it cannot be removed at all: ${ask.because}`);

  assert.doesNotMatch(ask.hint, /you can put it back/,
    'it promises an undo that Kosmos cannot perform for this agent');
  assert.match(ask.hint, /cannot start it again for you/,
    'it does not say who has to start it');

  world();
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED);
  const back = remove.restore(name);
  assert.equal(back.outcome, remove.OUTCOME.RESTORED, back.because);
  assert.doesNotMatch(back.because, /is back on the board/,
    'it says the agent is back on a board that will not show it until something starts it');
  assert.match(back.because, /no longer removed from Kosmos/);
  assert.match(back.because, /start it again the way you did before/,
    'it does not tell them what actually has to happen next');
});
