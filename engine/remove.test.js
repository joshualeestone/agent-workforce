'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING, all four roots. The module under test DESTROYS
// things: it boots out launchd jobs, kills tmux sessions, and deletes
// directories. An unsandboxed run does not litter the machine, it takes things
// off it.
//
// ⚠️ `AGENT_WORKFORCE_DATA` is here because `create` installs the shared
// supervisor under it, and the sibling suite learned this the hard way: it
// sandboxed two roots of three and overwrote the operator's live supervisor.
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

// Arm dry-run at load, so nothing here can reach the real machine before a
// recorder is installed.
remove.setRunner(null);
create.setRunner(null);

function recorder(mod) {
  const calls = [];
  mod.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  return calls;
}

/** An agent that really exists in the sandbox, made the way the product makes them. */
function madeAgent(name) {
  recorder(create);
  create.setDryRun(false);
  status.setPaneSource(() => '');
  const r = create.createAgent({ ...BINS, name, role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, `fixture agent ${name} was not created: ${r.because}`);
  create.setRunner(null);
  status.setPaneSource(null);
  return name;
}

test.afterEach(() => { remove.setRunner(null); create.setRunner(null); status.setPaneSource(null); });

// ─────────────────────────────────────────────────────────────────────────────
// What it will not touch
// ─────────────────────────────────────────────────────────────────────────────

test('an agent this app did not create is refused, and the refusal says why', () => {
  // ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. The board shows every agent on the
  // machine, including thirteen this product did not create, whose launchd jobs
  // belong to somebody else's tooling and whose sessions somebody is talking to
  // right now. A remove that can reach those is a worse defect than having no
  // remove at all.
  const calls = recorder(remove);
  remove.setDryRun(false);

  const r = remove.remove('angel');   // a real fleet agent, not ours
  assert.equal(r.outcome, remove.OUTCOME.REFUSED, 'it agreed to remove an agent it did not create');
  assert.match(r.because, /not created by this app/);
  assert.equal(calls.length, 0, 'it ran a command against an agent it does not own');

  // ⚠️ AND THE REFUSAL MUST BE ABOUT OWNERSHIP, NOT ABSENCE. The first version
  // of this test proved nothing: in the sandbox `angel` has no plist AND no
  // folder, so the refusal was over-determined. Swapping `isOurs` to check the
  // FOLDER instead of the plist left all ten tests green — and a folder is
  // precisely the wrong key, because every one of the thirteen fleet agents has
  // `~/work/workers/<name>`. The guard that matters more than the feature could
  // be broken in the exact direction that reaches live agents.
  //
  // So the fixture is a foreign agent as it actually appears on this machine:
  // a worker folder with the person's instructions in it, and NO plist of ours.
  const foreign = 'foreign-agent';
  fs.mkdirSync(create.workerDir(foreign), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(foreign), 'CLAUDE.md'), 'You are **Foreign**, somebody else\'s agent.\n', 'utf8');
  // What its launchd job looks like: another tool's label, not ours.
  fs.mkdirSync(nodePath.dirname(create.plistPath(foreign)), { recursive: true });
  fs.writeFileSync(nodePath.join(nodePath.dirname(create.plistPath(foreign)), `com.${foreign}.discord.plist`), '<plist/>', 'utf8');

  assert.equal(remove.isOurs(foreign), false,
    'an agent with a worker folder but no job of ours is treated as ours to delete');
  const foreignPlan = remove.plan(foreign);
  assert.equal(foreignPlan.ok, false, 'it offered to remove an agent another tool created');
  assert.match(foreignPlan.because, /not created by this app/);
  assert.ok(fs.existsSync(create.workerDir(foreign)), 'it touched a foreign agent while refusing it');

  assert.equal(remove.isOurs('angel'), false,
    'a fleet agent is treated as ours to delete because the board recognises it');

  // THE CONTROL: an agent we DID make is ours, and the ONLY difference between
  // it and the fixture above is the plist we wrote.
  const mine = madeAgent('ours-to-remove');
  assert.equal(remove.isOurs(mine), true,
    'nothing is ever ours, so the refusal above proves nothing');
  assert.ok(fs.existsSync(create.plistPath(mine)), 'the control has no job of ours, so it differs in more than one way');
});

test('a name that could not have been made here is refused before anything runs', () => {
  const calls = recorder(remove);
  remove.setDryRun(false);
  // ⚠️ Asserts the REASON, not just the enum. Every one of these is also
  // refused by the ownership check, so the outcome alone is satisfied whether
  // or not the name rule exists at all — deleting the `nameProblem` gate left
  // the first version of this test green. It matters more than usual here:
  // `../../etc` reaching `workerDir()` would put a recursive delete outside the
  // workers root, and this is the only test standing over that.
  for (const [bad, why] of [
    ['', /give the agent a name/],
    ['Angel', /lower case/],
    ['../../etc', /letters, numbers/],
    ['has space', /letters, numbers/],
    ['x'.repeat(40), /32 characters/],
  ]) {
    const r = remove.remove(bad);
    assert.equal(r.outcome, remove.OUTCOME.REFUSED, `'${bad}' was accepted`);
    assert.match(r.because, why,
      `'${bad}' was refused for the wrong reason, so the name rule may not be running at all`);
  }
  assert.equal(calls.length, 0, 'a refused name still ran a command');
});

// ─────────────────────────────────────────────────────────────────────────────
// Saying what will happen, before it happens
// ─────────────────────────────────────────────────────────────────────────────

test('the plan names every step, and says what is permanent', () => {
  // ⚠️ The screen renders THIS. If the plan and the removal can disagree, the
  // confirmation is decoration — so the same function that describes the work is
  // the one the engine performs.
  const name = madeAgent('planned');
  const keep = remove.plan(name);

  assert.equal(keep.ok, true, keep.because);
  assert.ok(keep.steps.length >= 3, 'the plan does not say what it will do');
  assert.ok(keep.steps.some((s) => /startup job/.test(s)),
    'the plan does not mention the job, which is the part that makes it stick');
  assert.match(keep.warning, /cannot be undone/,
    'the confirmation does not say the thing a person cannot take back');

  // ⚠️ THE FOLDER IS KEPT BY DEFAULT, and the plan says so in words. It holds
  // the instruction file the PERSON wrote, which is the whole of what made this
  // agent theirs. "Remove this agent" does not imply "delete what I wrote".
  assert.equal(keep.keepsFolder, true, 'removing an agent deletes what the person wrote, by default');
  assert.match(keep.warning, /folder stays/);
  assert.ok(!keep.steps.some((s) => /delete its folder/.test(s)));

  // And with the box ticked, it says exactly what is inside rather than "files".
  const wipe = remove.plan(name, { alsoDeleteFolder: true });
  assert.ok(wipe.steps.some((s) => /delete its folder/.test(s)));
  assert.match(wipe.warning, /instructions, the ones you wrote/,
    'the destructive version does not name what is being destroyed');
  assert.ok(wipe.folderContents.includes('CLAUDE.md'),
    'the plan does not know what is in the folder it offers to delete');
});

// ─────────────────────────────────────────────────────────────────────────────
// Doing it
// ─────────────────────────────────────────────────────────────────────────────

test('removing an agent stops the job BEFORE it ends the session', () => {
  // ⚠️ ORDER, and it is the one thing that cannot be got wrong quietly. While
  // the job is loaded, `KeepAlive` restarts the agent the moment its session
  // ends — so killing the session first makes launchd put it straight back, and
  // the person watches the agent they just removed reappear on the board.
  const name = madeAgent('order-matters');
  const calls = recorder(remove);
  remove.setDryRun(false);
  remove.remove(name);

  const bootout = calls.findIndex(([, a]) => a && a[0] === 'bootout');
  const kill = calls.findIndex(([, a]) => a && a[0] === 'kill-session');
  assert.ok(bootout > -1, 'the launchd job was never stopped');
  assert.ok(kill > -1, 'the session was never ended');
  assert.ok(bootout < kill,
    'the session is killed before the job is stopped, so KeepAlive restarts the agent');
});

test('the session is ended by exact name, never by prefix', () => {
  // `kill-session -t sam` prefix-matches and will happily end
  // `samantha-discord`. Measured on this machine, by doing it.
  const name = madeAgent('exact-target');
  const calls = recorder(remove);
  remove.setDryRun(false);
  remove.remove(name);

  const kill = calls.find(([, a]) => a && a[0] === 'kill-session');
  assert.equal(kill[1][2], `=${name}`,
    'the kill target is not anchored, so it can end a different session whose name starts the same way');
});

test('a removed agent leaves no job behind, and keeps its folder unless asked', () => {
  const name = madeAgent('goodbye');
  assert.ok(fs.existsSync(create.plistPath(name)), 'the fixture has no job to remove');

  recorder(remove);
  remove.setDryRun(false);
  const r = remove.remove(name);

  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);
  assert.ok(!fs.existsSync(create.plistPath(name)),
    'the startup job survived, so the agent comes back at the next login');
  assert.ok(fs.existsSync(create.instructionFile(name)),
    'the instruction file the person wrote was deleted without being asked for');
  assert.match(r.because, /folder is still on your computer/);
});

test('deleting the folder is possible, and only when it is asked for', () => {
  const name = madeAgent('wipe-me');
  recorder(remove);
  remove.setDryRun(false);
  const r = remove.remove(name, { alsoDeleteFolder: true });

  assert.equal(r.outcome, remove.OUTCOME.REMOVED, r.because);
  assert.ok(!fs.existsSync(create.workerDir(name)), 'the folder was kept despite being asked for');
  // ⚠️ `.label`, not the step object. `plan()` returns step STRINGS and
  // `remove()` returns `{label, ok}` records -- two shapes for what a reader
  // thinks of as one thing, and testing the object stringifies it to
  // "[object Object]" and quietly matches nothing.
  assert.ok(r.steps.some((s) => /deleted its folder/.test(s.label) && s.ok),
    'the folder deletion is not in the record, so the screen cannot show which half happened');
});

test('a job that will not go is PARTIAL, and says the agent will come back', () => {
  // ⚠️ The job is what makes a removal STICK. A screen saying "removed" over a
  // surviving plist is the same lie as a board reporting an agent it cannot see
  // as healthy: at the next login the agent returns, and the person has no idea
  // why. Everything else failing here is recoverable by hand; this is not.
  const name = madeAgent('sticky');
  recorder(remove);
  remove.setDryRun(false);

  const realRm = fs.rmSync;
  try {
    fs.rmSync = (p, ...rest) => {
      if (String(p).endsWith('.plist')) throw new Error('read-only');
      return realRm(p, ...rest);
    };
    const r = remove.remove(name);
    assert.equal(r.outcome, remove.OUTCOME.PARTIAL, 'a surviving startup job was reported as removed');
    assert.match(r.because, /come back when you next log in/,
      'the person is not told the agent will return');
  } finally {
    fs.rmSync = realRm;
  }

  // THE CONTROL: with the write working, the same agent removes cleanly.
  recorder(remove);
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED,
    'this agent cannot be removed at all, so the assertion above is about nothing');
});

test('dry-run cannot be left without a runner in place', () => {
  // The same interlock `create` uses, for a stronger reason: a test that
  // reaches the real machine here does not litter it, it kills a live agent.
  remove.setRunner(null);
  assert.throws(() => remove.setDryRun(false), /refusing to leave dry-run/);
  recorder(remove);
  remove.setDryRun(false);
  assert.equal(remove.DRY_RUN, false);
  remove.setRunner(null);
  assert.equal(remove.DRY_RUN, true, 'clearing the runner left the real one armed');
});

test('the module does not start in dry-run, or the product silently does nothing', () => {
  // ⚠️ THE BUG THIS PINS, found by removing an agent through the real UI and
  // then looking at the machine: the board said "gone", the session was killed,
  // and the launchd job and its plist were still there -- so the agent would
  // have come back at the next login. Every filesystem step short-circuits on
  // `DRY_RUN && !runner`, and this module defaulted that to true because it
  // looked like the careful choice.
  //
  // A default that makes the product do nothing while reporting success is not
  // a safe default. The safety lives at the top of THIS file instead, which
  // arms dry-run before any test runs.
  //
  // Checked in a child process, because this file has already armed dry-run by
  // the time any test executes -- asking the loaded module would answer about
  // the test harness rather than about the default.
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e',
    "console.log(require('./engine/remove').DRY_RUN)"],
  { cwd: nodePath.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DRY_RUN: '' } });
  assert.equal(out.trim(), 'false',
    'the module starts in dry-run, so the server removes nothing and says it did');

  // And the env var still arms it, which is what a sandboxed run relies on.
  const armed = execFileSync(process.execPath, ['-e',
    "console.log(require('./engine/remove').DRY_RUN)"],
  { cwd: nodePath.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DRY_RUN: '1' } });
  assert.equal(armed.trim(), 'true', 'AGENT_WORKFORCE_DRY_RUN no longer arms dry-run');
});

test('a bootout that fails stops everything, rather than reporting success over it', () => {
  // ⚠️ THE WORST DEFECT THIS FILE HAS HAD. The bootout result was discarded, so
  // a genuine failure was recorded as done; the session was then killed, which
  // KeepAlive instantly undoes because the job is still loaded; and the plist
  // was deleted on top of it. That leaves a loaded service with nothing on disk
  // explaining it -- the one state `create` refuses to clean up -- so the NAME
  // IS PERMANENTLY UNUSABLE, while the person is told the agent is gone and
  // watches it come back.
  const name = madeAgent('bootout-fails');
  remove.setRunner((file, args) => {
    if (args && args[0] === 'bootout') return { ok: false, code: 5 };   // a real failure
    return { ok: true, stdout: '' };
  });
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, 'a failed bootout was reported as a removal');
  assert.match(r.because, /still running, and nothing has been removed/);
  assert.ok(fs.existsSync(create.plistPath(name)),
    'the plist was deleted after the job could not be stopped, which is the state that '
    + 'makes the name unusable forever');
  assert.ok(!r.steps.some((s) => /ended its session/.test(s.label)),
    'it went on to kill the session, which KeepAlive would immediately undo');

  // ⚠️ EXIT 3 IS NOT A FAILURE. launchd answers 3 for a job that is not loaded,
  // which is the end state we wanted. Without this the common case -- removing
  // an agent whose job is already stopped -- would refuse to proceed.
  remove.setRunner((file, args) => (args && args[0] === 'bootout'
    ? { ok: false, code: 3 } : { ok: true, stdout: '' }));
  remove.setDryRun(false);
  assert.equal(remove.remove(name).outcome, remove.OUTCOME.REMOVED,
    'a job that was already not loaded is treated as a failure, so nothing can be removed');
});

test('a session that cannot be killed is not reported as ended', () => {
  // On a machine where tmux is not at the Homebrew path and the override is
  // unset -- the Intel-Mac case the README names -- every removal recorded
  // "ended its session" over a session somebody can still talk to.
  const name = madeAgent('kill-fails');
  remove.setRunner((file, args) => {
    if (args && args[0] === 'kill-session') return { ok: false, code: 127 };  // tmux not found
    return { ok: true, stdout: '' };
  });
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.ok(r.steps.some((s) => /ended its session/.test(s.label) && !s.ok),
    'a session that could not be killed is recorded as ended');

  // Exit 1 IS fine: the session was already gone.
  const name2 = madeAgent('already-gone');
  remove.setRunner((file, args) => (args && args[0] === 'kill-session'
    ? { ok: false, code: 1 } : { ok: true, stdout: '' }));
  remove.setDryRun(false);
  assert.ok(remove.remove(name2).steps.some((s) => /ended its session/.test(s.label) && s.ok),
    'a session that was already gone is treated as a failure');
});

test('a job still registered afterwards is PARTIAL, not a removal', () => {
  // ⚠️ Creating an agent WATCHES the board before saying it is running. Removing
  // one was claiming its outcome from commands whose answers it had not read.
  // The same rule both ways, and this is the direction where being wrong means
  // the agent comes back.
  const name = madeAgent('still-there');
  remove.setRunner((file, args) => {
    if (args && args[0] === 'print') return { ok: true, stdout: 'com.kosmos.agent.still-there = { ... }' };
    return { ok: true, stdout: '' };
  });
  remove.setDryRun(false);

  const r = remove.remove(name);
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, 'a job still registered afterwards was called removed');
  assert.match(r.because, /still registered as a startup job/);

  // THE CONTROL: with launchctl describing nothing, the same agent is removed.
  const name2 = madeAgent('really-gone');
  recorder(remove);
  remove.setDryRun(false);
  assert.equal(remove.remove(name2).outcome, remove.OUTCOME.REMOVED,
    'nothing can ever be removed, so the assertion above is about nothing');
});
