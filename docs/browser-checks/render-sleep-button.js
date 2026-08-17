/* Drive-through of the Open-sleep-settings button on first-run step 2:
 * rendered only because the engine proved the pane exists on this Mac, and
 * clicking it REALLY opens the pane, verified by process (the pane appex
 * runs as its own process; a bogus id measurably does not launch it).
 *
 * Run with the durable playwright runtime:
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules node \
 *     docs/browser-checks/render-sleep-button.js
 *
 * ⚠️ Console side effect by design: this opens System Settings on the
 * machine and quits it afterwards. It kills only what it started. */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 4667;

const paneRunning = () => {
  try { return execFileSync('/usr/bin/pgrep', ['-f', 'PowerPreferences'], { encoding: 'utf8' }).trim().length > 0; }
  catch { return false; }
};

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-drive-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA,
      AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH,
      AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
    },
    stdio: 'ignore',
  });
  const cleanup = () => {
    srv.kill();
    try { execFileSync('/usr/bin/killall', ['System Settings']); } catch { /* was not open */ }
  };
  const die = (msg) => { cleanup(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  if (paneRunning()) die('precondition: the power pane is already running; close System Settings first');

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (!(await p.isVisible('#firstrun'))) die('fresh sandbox did not show first-run');
    await p.click('#fr-next');                       // step 1 -> step 2, the machine checks
    await p.waitForSelector('.fr-check', { timeout: 20000 });
    await p.waitForSelector('.fr-sleepbtn', { state: 'visible', timeout: 20000 });
    const label = (await p.locator('.fr-sleepbtn').textContent()).trim();
    if (label !== 'Open sleep settings') die('button label drifted: ' + label);
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/sleep-settings-button.png') });

    await p.click('.fr-sleepbtn');
    let up = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (paneRunning()) { up = true; break; }
    }
    if (!up) die('the click did not launch the power pane process within 10s');
    const msg = (await p.locator('#fr-machine-msg').textContent()).trim();
    if (msg) die('a successful open wrote an error message: ' + msg);

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('SLEEP BUTTON DRIVE OK: rendered because the pane exists, click launched the pane process, no error message, 0 page errors');
  } finally {
    await b.close();
    cleanup();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
