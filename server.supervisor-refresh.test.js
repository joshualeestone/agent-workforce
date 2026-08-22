'use strict';

/**
 * The startup script every agent runs is refreshed when the board starts.
 *
 * 🛑 A FIX TO IT REACHED NOBODY UNTIL SOMEBODY MADE A NEW AGENT. `installSupervisor`
 * had exactly two callers, agent creation and the login-job repair, so on an
 * install where nobody happens to create an agent, an update ships a new
 * supervisor into the bundle and every job goes on running the old copy. The
 * file's own header describes an update model it did not have.
 *
 * ⚠️ THIS RUNS THE REAL SERVER as a child process, because the behaviour under
 * test is a BOOT behaviour: it lives behind `require.main === module`, which is
 * unreachable from a require, and deliberately so.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const REPO = __dirname;
const SOURCE = path.join(REPO, 'bin', 'agent-supervisor.sh');

function boot(sandbox, extraEnv) {
  /* PORT=0 binds a free port, so a suite run cannot collide with a board the
     operator has open. The child is killed as soon as it has spoken. */
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sandbox, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sandbox, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sandbox, 'launch'),
      AGENT_WORKFORCE_DRY_RUN: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const done = () => { try { child.kill(); } catch { /* already gone */ } resolve({ out, err }); };
    child.stdout.on('data', (b) => { out += b; if (/Kosmos on http/.test(out)) done(); });
    child.stderr.on('data', (b) => { err += b; });
    setTimeout(done, 8000);
  });
}

test('starting the board puts the current script where the jobs point', async () => {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sup-'));
  const dest = path.join(sb, 'data', 'AgentWorkforce', 'bin', 'agent-supervisor.sh');
  assert.equal(fs.existsSync(dest), false, 'the control is not a control: it was there before we started');
  await boot(sb);
  assert.equal(fs.existsSync(dest), true, 'the board started without installing the script its agents run');
  assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(SOURCE, 'utf8'));
  assert.equal(fs.statSync(dest).mode & 0o111, 0o111, 'the script is not executable, so every job fails at once');
  fs.rmSync(sb, { recursive: true, force: true });
});

test('an old copy is replaced, which is the whole point', async () => {
  /* The update case: a previous version's script is already sitting there. */
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sup-'));
  const dest = path.join(sb, 'data', 'AgentWorkforce', 'bin', 'agent-supervisor.sh');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, '#!/bin/bash\n# a version from before the fix\n', { mode: 0o755 });
  const before = fs.statSync(dest).ino;
  await boot(sb);
  assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(SOURCE, 'utf8'), 'the old script survived an update');
  /* ⚠️ A NEW INODE, not an overwrite. Every live agent's supervisor is a bash
     process reading that exact file by offset; rewriting it in place can make a
     running one execute whatever now sits at that offset. */
  assert.notEqual(fs.statSync(dest).ino, before, 'the file was rewritten in place under running agents');
  fs.rmSync(sb, { recursive: true, force: true });
});

test('a refresh it cannot do is said, and does not stop the board', async () => {
  /* ⚠️ THE FAILURE DIRECTION. A board that refuses to start because it could not
     refresh a script is strictly worse than one running with the previous copy,
     which is the state every install is in today. */
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sup-'));
  const binDir = path.join(sb, 'data', 'AgentWorkforce', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.chmodSync(binDir, 0o500);
  const { out, err } = await boot(sb);
  fs.chmodSync(binDir, 0o700);
  assert.match(out, /Kosmos on http/, 'the board refused to start over a script it could not refresh');
  assert.match(err, /keep the one they have/);
  fs.rmSync(sb, { recursive: true, force: true });
});

test('requiring the module writes nothing', () => {
  /* Same rule as the port: the routing tests require this module, and writing
     files as a side effect of an import is the same class as binding one. */
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sup-'));
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(REPO, 'server.js'))})`], {
    env: {
      ...process.env,
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(sb, 'data', 'AgentWorkforce', 'bin', 'agent-supervisor.sh')), false,
    'importing the server installed a file');
  fs.rmSync(sb, { recursive: true, force: true });
});
