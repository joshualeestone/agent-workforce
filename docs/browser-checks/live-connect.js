'use strict';
/* Live verify for click-to-connect, SANDBOXED. Real network, real binary,
   real tmux, real CLI -- and every write root pointed into a temp dir. The
   one thing this never does is complete an OAuth login. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-live-'));
console.log('SANDBOX', SB);

process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SB, 'config', '.claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SB, 'config');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SB, 'home', '.local', 'bin', 'claude');
delete process.env.AGENT_WORKFORCE_DRY_RUN;
fs.mkdirSync(path.join(SB, 'config'), { recursive: true });
fs.mkdirSync(path.join(SB, 'home'), { recursive: true });

const connect = require(path.join(__dirname, '..', '..', 'engine', 'connect.js'));

const fail = (m) => { console.error('FAIL', m); process.exit(1); };
const pass = (m) => console.log('PASS', m);

(async () => {
  /* ── stage 1: the real download, verified ─────────────────────────────── */
  let lastLog = 0;
  const t0 = Date.now();
  const got = await connect.download((g, total) => {
    if (g - lastLog > 25 * 1024 * 1024) {
      lastLog = g;
      console.log(`  ... ${Math.round(g / 1048576)}MB${total ? ' of ' + Math.round(total / 1048576) + 'MB' : ''}`);
    }
  });
  pass(`downloaded ${got.version} in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${got.path}`);
  if (!/^\d+\.\d+\.\d+/.test(got.version)) fail('version does not look like a version');
  const st = fs.statSync(got.path);
  if (!(st.mode & 0o100)) fail('binary is not executable');
  pass(`binary is ${Math.round(st.size / 1048576)}MB and executable (checksum verified by the engine before rename)`);

  /* ── stage 2: the real install, into a sandboxed HOME ─────────────────── */
  await new Promise((resolve) => {
    execFile(got.path, ['install'], {
      timeout: 180000,
      env: { ...process.env, HOME: path.join(SB, 'home'), TERM: 'dumb' },
    }, (err, stdout, stderr) => {
      if (err) fail(`claude install failed (no tty): ${err.message}\n${String(stdout).slice(-400)}\n${String(stderr).slice(-400)}`);
      pass('claude install exited 0 with no tty (TERM=dumb), which is how the engine runs it');
      resolve();
    });
  });
  const installed = path.join(SB, 'home', '.local', 'bin', 'claude');
  if (!fs.existsSync(installed)) fail(`launcher not at ${installed} -- the engine expects it there`);
  pass(`launcher landed at HOME/.local/bin/claude, where claudeBinPath() expects it`);

  await new Promise((resolve) => {
    execFile(installed, ['--version'], {
      timeout: 30000, env: { ...process.env, HOME: path.join(SB, 'home') },
    }, (err, stdout) => {
      if (err) fail(`installed claude --version failed: ${err.message}`);
      pass(`installed claude answers: ${String(stdout).trim()}`);
      resolve();
    });
  });

  /* ── stage 3: the real driver, to the paste prompt and no further ─────── */
  const tmux = process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux';
  if (!fs.existsSync(tmux)) fail(`no tmux at ${tmux}`);
  connect.setTickInterval(500);

  await connect.start();
  const deadline = Date.now() + 90000;
  let s;
  for (;;) {
    s = connect.state();
    if (s.phase === 'signin-awaiting-code') break;
    if (s.phase === 'stuck') fail(`driver got stuck: ${s.because}\n${s.tail || ''}`);
    if (Date.now() > deadline) fail(`never reached the paste prompt; parked at ${s.phase}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  pass('the real driver walked the real CLI to signin-awaiting-code');
  if (!s.url || !/oauth/.test(s.url)) fail(`no OAuth URL captured: ${JSON.stringify(s.url)}`);
  pass(`OAuth URL captured (${s.url.slice(0, 60)}...)`);

  await connect.cancel();
  const after = connect.state();
  if (after.phase !== 'idle') fail(`cancel left phase ${after.phase}`);
  pass('cancelled cleanly back to idle; no login was completed');

  /* the config must NOT have gained an account: we never signed in */
  const cfgPath = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : null;
  if (cfg && cfg.oauthAccount) fail('the sandboxed config gained an account -- something completed a login');
  pass('no credentials were created anywhere (sandboxed config has no account block)');

  console.log('\nALL STAGES PASSED. Sandbox left at', SB, '(delete when done)');
  process.exit(0);
})().catch((e) => fail(e.stack || String(e)));
