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
  remove.setRunner(() => ({ ok: true, stdout: '' }));
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, 'a removal that could not ask tmux reported success');
  assert.match(r.because, /could not ask tmux/);
  assert.equal(remove.isRemoved(name), false, 'it was hidden while possibly still running');

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
  assert.equal(remove.isRemoved(name), false, 'it was taken off the board while still running');
});

test('a session the board does not tie to this agent is left alone', () => {
  // Owning the job is a fact about disk. It does not say the session holding
  // that name right now is this agent, and `bin/agent-supervisor.sh` already
  // refuses to touch a session it cannot tie to us.
  const name = madeAgent('name-taken');
  status.setPaneSource(() => `${name}\t0.0\t2.1.212\t0\tsomebody-else\t✳ Claude Code`);
  const calls = world();
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.ok(!calls.some(([, a]) => a && a[0] === 'kill-session'),
    'it killed a session the board does not tie to this agent');
  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);
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

test('a name that could not be an agent is refused before anything runs', () => {
  const calls = [];
  remove.setRunner((f, a) => { calls.push([f, a]); return { ok: true, stdout: '' }; });
  remove.setDryRun(false);
  for (const [bad, why] of [
    ['', /give the agent a name/],
    ['Angel', /lower case/],
    ['../../etc', /letters, numbers/],
    ['x'.repeat(40), /32 characters/],
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

test('an unreadable removed-list hides nothing, rather than hiding everything', () => {
  // A list we cannot read must not become a board that hides agents for reasons
  // nobody can inspect. The honest answer to "which agents are removed" when
  // the record is unreadable is "none that we can tell you about".
  fs.mkdirSync(nodePath.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, 'not json at all', 'utf8');
  assert.deepEqual(remove.removedAgents(), []);
  assert.equal(remove.isRemoved('anything'), false);
});
