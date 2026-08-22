'use strict';

/**
 * Which agents survive a restart, and giving the missing ones their job.
 *
 * 🛑 ON JOSH'S MACHINE THIS WAS ONE OUT OF SIXTEEN, and nothing anywhere said
 * so: an agent with a login job and one without are identical on the board and
 * identical in every API. The difference showed up once, at the next login.
 *
 * ⚠️ EVERY TEST HERE RUNS AGAINST A SANDBOXED HOME. `create` is put in dry-run
 * with an injected runner, so no `launchctl` call can reach the real machine —
 * and the plist directory, the worker directory and the data root are all
 * pointed into a temp folder. The one root that has no override is launchd
 * itself, which is why the runner is the belt to those braces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-register-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SB, 'bin', 'claude');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(SB, 'bin', 'tmux');

const create = require('./create');
const store = require('./store');
const register = require('./register');

let CALLS = [];
create.setRunner((file, args) => { CALLS.push([file, ...args].join(' ')); return { ok: true, stdout: '' }; });
create.setDryRun(false);

function agent(name, { folder = true, job = false, profile = true } = {}) {
  if (profile) store.writeProfile(name, { role: 'helper' });
  if (folder) fs.mkdirSync(create.workerDir(name), { recursive: true });
  if (job) {
    fs.mkdirSync(path.dirname(create.plistPath(name)), { recursive: true });
    fs.writeFileSync(create.plistPath(name), '<plist/>', 'utf8');
  }
}
function reset() {
  CALLS = [];
  fs.rmSync(store.PROFILES, { recursive: true, force: true });
  fs.rmSync(path.join(SB, 'launch'), { recursive: true, force: true });
  fs.rmSync(path.join(SB, 'workers'), { recursive: true, force: true });
  fs.rmSync(path.join(store.ROOT, 'removed.json'), { force: true });
  fs.mkdirSync(path.join(SB, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(SB, 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(SB, 'bin', 'tmux'), '#!/bin/sh\n', { mode: 0o755 });
}

test('an agent with a folder and no job is the thing being looked for', () => {
  reset();
  agent('anna', { job: true });
  agent('brigitte');
  agent('marilyn');
  const s = register.survey();
  assert.equal(s.ok, true);
  assert.deepEqual(s.missing, ['brigitte', 'marilyn']);
  assert.deepEqual(s.agents.find((a) => a.name === 'anna'), { name: 'anna', removed: false, folder: true, job: true });
});

test('the roster comes from what Kosmos wrote, never from what is in the folder', () => {
  /* 🛑 `~/work/workers` IS A PLAIN DIRECTORY. On this fleet's own Mac it holds
     worker checkouts that are not Kosmos agents at all, and writing launchd
     jobs for whatever is sitting there would start strangers' processes at
     every login. The failure direction is to do nothing. */
  reset();
  fs.mkdirSync(path.join(SB, 'workers', 'somebody-elses-thing'), { recursive: true });
  assert.deepEqual(register.survey().missing, []);
});

test('a removed agent is not resurrected', () => {
  reset();
  agent('rick');
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'rick' }]), 'utf8');
  const s = register.survey();
  assert.deepEqual(s.missing, [], 'an agent somebody removed on purpose was queued to be started again');
  assert.equal(s.agents.find((a) => a.name === 'rick').removed, true);
});

test('an unreadable removed list stops everything, rather than guessing', () => {
  /* ⚠️ FAIL CLOSED, and this is the one place in the module where that is the
     right direction: without the list we cannot tell a forgotten agent from one
     somebody deliberately took off the board, and the wrong guess starts a
     process they stopped on purpose. */
  reset();
  agent('rick');
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), '{not json', 'utf8');
  const s = register.survey();
  assert.equal(s.ok, false);
  assert.match(s.because, /removed/);
  assert.deepEqual(register.repair().results, [], 'a repair ran against a list we could not read');
});

test('a profile with no folder is reported and never acted on', () => {
  /* An agent whose folder is gone would get a job that fails every thirty
     seconds forever. It stays on the survey so it can be SEEN. */
  reset();
  agent('tom', { folder: false });
  const s = register.survey();
  assert.equal(s.agents.find((a) => a.name === 'tom').folder, false);
  assert.deepEqual(s.missing, []);
});

test('a name that is not a name is not turned into a path', () => {
  reset();
  fs.mkdirSync(store.PROFILES, { recursive: true });
  fs.writeFileSync(path.join(store.PROFILES, '...json'), '{}', 'utf8');
  assert.deepEqual(register.survey().agents.map((a) => a.name), []);
});

test('the repair writes the job, enables the label, and bootstraps it', () => {
  reset();
  agent('brigitte');
  const out = register.repair();
  assert.equal(out.ok, true);
  assert.equal(out.installed, 1);
  assert.equal(fs.existsSync(create.plistPath('brigitte')), true, 'no job was written');
  /* ⚠️ enable BEFORE bootstrap. `remove` sticks by writing a per-user disable
     override keyed on the LABEL, and it outlives the plist — so bootstrapping
     into a standing disable succeeds and starts nothing, which would report a
     repaired agent that never comes up. */
  const enable = CALLS.findIndex((c) => c.includes('enable'));
  const boot = CALLS.findIndex((c) => c.includes('bootstrap'));
  assert.ok(enable !== -1 && boot !== -1, 'launchctl was not asked at all');
  assert.ok(enable < boot, 'bootstrap ran before enable, so a disabled label starts nothing');
});

test('the model it last ran as goes into the job, and an unknown one is left out', () => {
  reset();
  agent('christina');
  agent('heather');
  register.repair({ modelFor: (n) => (n === 'christina' ? 'claude-opus-5' : null) });
  assert.match(fs.readFileSync(create.plistPath('christina'), 'utf8'), /claude-opus-5/);
  /* ⚠️ AND NOT GUESSED. A plist naming the wrong model is a silent downgrade
     that outlives everybody's memory of the day it was written; the
     five-argument job every pre-model agent already runs is correct. */
  const args = fs.readFileSync(create.plistPath('heather'), 'utf8')
    .match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1]
    .match(/<string>/g).length;
  assert.equal(args, 7, 'a model was invented for an agent that had no record of one');
});

test('what we had to assume travels back, so the screen can say it', () => {
  reset();
  agent('marilyn');
  const r = register.repair().results[0];
  assert.match(r.guessed.model, /default/);
  assert.match(r.guessed.account, /main Claude account/);
  const kept = register.repair({ modelFor: () => 'claude-opus-5' });
  assert.deepEqual(kept.results, [], 'it repaired the same agent twice');
});

test('an existing job is never overwritten', () => {
  /* Somebody edited theirs by hand, or `remove` merely disabled it: removal
     deletes nothing. Rewriting from defaults we had to guess at would be the
     silent downgrade this module refuses everywhere else. */
  reset();
  agent('anna', { job: true });
  const r = create.installJob('anna');
  assert.equal(r.ok, false);
  assert.equal(r.already, true);
  assert.equal(fs.readFileSync(create.plistPath('anna'), 'utf8'), '<plist/>');
});

test('the job stays on disk when it could not be started', () => {
  /* ⚠️ THE ONE PLACE THIS DIFFERS FROM CREATION'S ROLLBACK. A failed bootstrap
     during creation leaves nothing a person owns. Here the agent already
     exists, and the file is what brings it back at the NEXT login even if it
     could not be started now. Removing it would throw away the fix to keep the
     report tidy. */
  reset();
  agent('spensor');
  create.setRunner((file, args) => {
    if (args[0] === 'bootstrap') return { ok: false };
    return { ok: true, stdout: '' };
  });
  const r = register.repair().results[0];
  create.setRunner((file, args) => { CALLS.push([file, ...args].join(' ')); return { ok: true, stdout: '' }; });
  assert.equal(r.ok, true);
  assert.equal(r.started, false);
  assert.match(r.because, /next login/);
  assert.equal(fs.existsSync(create.plistPath('spensor')), true, 'the fix was thrown away to keep the report tidy');
});

test('no job is written when Claude is not on this computer', () => {
  /* The same refusal creation makes, for the same reason: a job pointing at a
     binary that is not there fails every thirty seconds forever. */
  reset();
  agent('dan');
  fs.rmSync(path.join(SB, 'bin', 'claude'));
  const r = create.installJob('dan');
  assert.equal(r.ok, false);
  assert.match(r.because, /could not find Claude/);
  assert.equal(fs.existsSync(create.plistPath('dan')), false);
});

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });
