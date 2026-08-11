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
function world({ killWorks = true } = {}) {
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
    if (cmd === 'has-session') return killWorks ? { ok: false, code: 1 } : { ok: true, stdout: '' };
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
  status.setPaneSource(() => `${session}\t0.0\t2.1.212\t0\t${claim}\t✳ Claude Code`);
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
  status.setPaneSource(() => `${name}\t0.0\t2.1.212\t0\tsomebody-else\t✳ Claude Code`);
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
      ? `${name}\t0.0\t2.1.212\t0\t${name}\t✳ Claude Code`
      : `${name}\t0.0\t2.1.212\t0\tsomebody-else\t✳ Claude Code`;
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
    status.setPaneSource(() => `${odd}\t0.0\t2.1.212\t0\t${odd}\t✳ Claude Code`);
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

  // A directory where the file goes: the write lands, the rename cannot.
  fs.rmSync(remove.REMOVED_FILE, { force: true });
  fs.mkdirSync(remove.REMOVED_FILE, { recursive: true });
  try {
    // ⚠️ CONTROL: prove the write really is impossible before believing the
    // outcome. A misjudged fixture makes a crashing path look handled.
    assert.throws(() => fs.renameSync(__filename, remove.REMOVED_FILE),
      'the fixture did not actually block the write, so this proves nothing');

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
