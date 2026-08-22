'use strict';

/**
 * The board's login job, asserted about the installer's TEXT.
 *
 * ⚠️ WHAT THIS CAN AND CANNOT DO. `yarn test` never executes `install/setup.sh`;
 * `tools/test-install.sh` really installs and is what covers behaviour. What a
 * node test can pin is the shape of the script, and the two claims below are
 * exactly that shape: one block must not contain a command, and the two blocks
 * must remain distinguishable. Both turn red when the file changes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

/* ⚠️ SLICED BY STRUCTURE, not by the next occurrence of some word. The first
   version of this cut at the next `printf` and landed inside the block's own
   `_xmlq` helper, so it reported the probe missing on a file that had it. */
/* ⚠️ COMMENTS STRIPPED, because the claim is about what RUNS. The comment
   explaining why this block does not tear the job down names the command it
   does not use, so a text search over the whole block finds it and reports the
   opposite of the truth. That trap has now cost this codebase five separate
   findings; the instrument answers it once instead of every author remembering
   not to quote themselves. */
function runs(text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}
function stepBlock(title) {
  const at = SETUP.indexOf(`step "${title}"`);
  assert.ok(at > -1, `the step "${title}" is gone from the installer`);
  const rest = SETUP.slice(at + 1);
  const next = rest.indexOf('\nstep "');
  return runs(next === -1 ? rest : rest.slice(0, next));
}

test('installing does not boot out a board that is already registered', () => {
  /* 🛑 AN UPDATE IS RUN BY THE BOARD. `engine/update.js` spawns this installer
     as a detached child of the running server, so once the board is a launchd
     job, `bootout` terminates the job running the update. The child is setsid-ed
     and very likely survives; "very likely" is not a property to rest an update
     path on, and the failure lands hard: the bootout succeeds, the shell dies
     before `bootstrap`, and the machine has the job booted out and no board at
     all until the next login. */
  const block = stepBlock('Keeping Kosmos running after a restart.');
  assert.ok(!/bootout/.test(block),
    'the install path boots the board out, which can kill the update that is running it');
  assert.match(block, /launchctl print/,
    'nothing probes whether the job is already loaded, so the skip cannot happen');
  /* And it still registers a machine that does not have one yet. */
  assert.match(block, /launchctl bootstrap/);
  assert.match(block, /launchctl enable/);
});

test('uninstalling does boot it out, because there is nothing left to protect', () => {
  /* The opposite direction on purpose: the files are going, so a job left
     loaded would run a deleted `kosmos` at every login. */
  const at = SETUP.indexOf('removing the login job for the board');
  assert.ok(at > -1, 'the uninstall no longer removes the board job');
  const block = runs(SETUP.slice(at, at + 900));
  assert.match(block, /launchctl bootout/);
  /* enable first, or a standing per-user disable outlives the plist and a
     reinstalled Kosmos is silently refused. */
  assert.ok(block.indexOf('launchctl enable') < block.indexOf('launchctl bootout'));
});

test('a sandboxed run reaches launchd in neither direction', () => {
  /* launchd has no directory to point somewhere harmless: a bootstrap under a
     harness registers a REAL job on the machine running the test, and it
     outlives the test. Both blocks gate on the same variable. */
  for (const block of [stepBlock('Keeping Kosmos running after a restart.'),
    runs(SETUP.slice(SETUP.indexOf('removing the login job for the board'), SETUP.indexOf('removing the login job for the board') + 900))]) {
    assert.match(block, /if \[ -z "\$\{AGENT_WORKFORCE_LAUNCH:-\}" \]/);
  }
});

test('the job carries what launchd does not set', () => {
  /* Bisected on this fleet's hand-written copy: launchd sets neither PATH nor
     LANG, and without LANG tmux sanitises its format output so every agent
     comes back on the board with its tab separators replaced. */
  const block = stepBlock('Keeping Kosmos running after a restart.');
  assert.match(block, /<key>LANG<\/key><string>en_US\.UTF-8<\/string>/);
  assert.match(block, /<key>PATH<\/key>/);
  assert.match(block, /<key>KOSMOS_PORT<\/key>/);
  /* ⚠️ RunAtLoad and deliberately no KeepAlive: `kosmos start` daemonises and
     exits, so KeepAlive would relaunch it the moment it returned. */
  assert.match(block, /<key>RunAtLoad<\/key><true\/>/);
  assert.ok(!/KeepAlive/.test(block), 'KeepAlive on a job whose program exits is a relaunch loop');
});
