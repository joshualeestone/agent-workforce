/* Drive-through of the project settings screen (pack section 3099): the
 * door from the project page, the pack's fields painting from the record,
 * the immediate-parent location sentence, a save round trip, and the
 * relocated archive/remove blocks present with their original ids.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-pjsettings.js
 * Sandboxed roots; kills only what it starts; Reveal is NOT clicked (it
 * opens a real Finder window; its route is wire-tested instead). */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 4679;

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS },
    stdio: 'ignore',
  });
  const die = (msg) => { srv.kill(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.click('#fr-skip');
    await p.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Settings Drive' }) });
      if (!r.ok) throw new Error('fixture create failed');
    });
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Settings Drive').first().click();

    // The project page no longer shows the path; the door is there.
    await p.waitForSelector('#pj-settings-link', { state: 'visible' });
    const pageText = await p.locator('#pj-one-view').innerText();
    if (/\/var\/folders|\/Users\//.test(pageText)) die('a filesystem path is still on the project page');

    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    if ((await p.inputValue('#pjs-name')) !== 'Settings Drive') die('name did not paint');
    const folderName = (await p.locator('#pjs-folder-name').textContent()).trim();
    if (folderName !== 'Settings Drive') die('folder name line: ' + folderName);
    const where = (await p.locator('#pjs-folder-where').textContent()).trim();
    // Sandboxed root is a temp dir, not the Kosmos folder: the parent rule
    // must produce "In your <tempdirname> folder." — assert the SHAPE.
    if (!/^In (your .+ folder\.|a folder you chose\.)$/.test(where)) die('location sentence shape: ' + where);
    for (const id of ['pjs-reveal', 'pj-one-archive', 'pj-one-remove', 'pjs-save']) {
      if (!(await p.locator('#' + id).isVisible())) die(id + ' is missing from settings');
    }
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/project-settings.png') });

    // Save round trip: rename, verify it lands everywhere.
    await p.fill('#pjs-name', 'Settings Drive Renamed');
    await p.click('#pjs-save');
    await p.waitForFunction(() => document.getElementById('pjs-msg').textContent === 'Saved.', { timeout: 10000 });
    const back = (await p.locator('#pj-settings-backname').textContent()).trim();
    if (back !== 'Settings Drive Renamed') die('the back link did not pick up the rename');
    await p.click('#pj-settings-back');
    await p.waitForSelector('#pj-one-view', { state: 'visible' });
    if ((await p.locator('#pj-one-name').textContent()).trim() !== 'Settings Drive Renamed') die('the project page missed the rename');

    // And a no-change save says so instead of lying "Saved."
    await p.click('#pj-settings-link');
    await p.click('#pjs-save');
    await p.waitForFunction(() => document.getElementById('pjs-msg').textContent === 'Nothing has changed.', { timeout: 5000 });

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('PJSETTINGS DRIVE OK: door, paint, parent sentence, save round trip, honest no-op, relocated blocks present, no path on the project page, 0 page errors');
  } finally {
    await b.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
