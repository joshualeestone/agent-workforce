/* Drive-through of the tasks column: the pack's New-task modal creates
 * through the real route, the who chip is the status (Mona Lisa's v1
 * ruling), the door reveals what the column deliberately hides, and the
 * view dialog's close-note names the agent with the blessed wording.
 *
 * Run with the durable playwright runtime:
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules node \
 *     docs/browser-checks/render-tasks.js
 * Sandboxes every root the server writes to; kills only what it started.
 * The roster read is the machine's real tmux (read-only), which is why the
 * member added below is one of this fleet's own session names. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 4671;
const MEMBER = 'angel';   // a session name that really exists on this machine

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-drive-' + k.toLowerCase() + '-'));
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
  const die = (msg) => { srv.kill(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.click('#fr-skip');

    // A project with one member, made through the real routes; a second bare
    // project exists to bounce through (the door's reveal resets on a
    // project SWITCH, deliberately not on same-project Back-and-return,
    // which follows the page's own round-31 same-project rule).
    const made = await p.evaluate(async (member) => {
      const r = await fetch('/api/projects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Task Drive' }),
      });
      const body = await r.json();
      await fetch('/api/project/' + body.project.id + '/agent/' + member, {
        method: 'POST', headers: { 'content-type': 'application/json' },
      });
      await fetch('/api/projects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Elsewhere' }),
      });
      return body.project.id;
    }, MEMBER);
    if (!made) die('could not create the fixture project');

    // Into the project.
    await p.click('[data-tab="projects"]');
    await p.waitForSelector('#pj-list .pj-row, .pj-item, [data-pj-open]', { timeout: 10000 }).catch(() => { });
    // The list row: click by project name text.
    await p.locator('#pj-list').getByText('Task Drive').first().click();
    await p.waitForSelector('#pj-tasks-field', { state: 'visible', timeout: 10000 });

    // The modal, pack copy verbatim.
    await p.click('#pj-newtask');
    await p.waitForSelector('#nt-modal', { state: 'visible' });
    const hint = await p.evaluate(() => document.querySelector('#nt-modal .fhint').textContent.trim());
    if (hint !== 'You can give it to somebody later.') die('the default-to-nobody hint drifted: ' + hint);
    if (!(await p.locator('#nt-go').isDisabled())) die('Create task is live with no sentence');
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/tasks-new-modal.png') });

    // Escape closes; the trap holds while open.
    await p.locator('#nt-who').focus();
    await p.keyboard.press('Tab');   // -> Cancel
    await p.keyboard.press('Tab');   // -> nt-go is disabled, wraps to nt-what
    const active = await p.evaluate(() => document.activeElement.id);
    if (active !== 'nt-what') die('the new-task trap leaked to: ' + active);
    await p.keyboard.press('Escape');
    if (await p.isVisible('#nt-modal')) die('Escape did not close the new-task dialog');

    // Create one task given to the member, one given to nobody.
    await p.click('#pj-newtask');
    await p.fill('#nt-what', 'Rewrite the handoff checklist');
    await p.fill('#nt-detail', 'The old one mentions the removed billing screen.');
    await p.selectOption('#nt-who', MEMBER);
    await p.click('#nt-go');
    await p.waitForSelector('.tkcard', { timeout: 10000 });
    await p.click('#pj-newtask');
    await p.fill('#nt-what', 'Check it against the live flow');
    await p.click('#nt-go');
    await p.waitForSelector('#pj-alltasks:not([hidden])', { timeout: 10000 });

    // The column shows ONLY the assigned open task; the door counts both.
    const cards = await p.locator('.tkcard').count();
    if (cards !== 1) die('the column shows ' + cards + ' cards; the unassigned one belongs behind the door');
    const doorTxt = (await p.locator('#pj-alltasks').textContent()).trim();
    if (!/View all tasks \(2\)/.test(doorTxt)) die('door text: ' + doorTxt);
    const chip = (await p.locator('.tkcard-who').textContent()).trim();
    if (!chip.includes(MEMBER)) die('the who chip does not name the member: ' + chip);
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/tasks-column.png') });

    // Behind the door: the unassigned card says the only allowed state word.
    await p.click('#pj-alltasks');
    if ((await p.locator('.tkcard').count()) !== 2) die('the door did not reveal the whole list');
    const nobody = await p.locator('.tkcard').nth(1).locator('.tkcard-who').textContent();
    if (nobody.trim() !== 'Nobody yet') die('unassigned state word: ' + nobody);

    // THE JOIN: the assignee reports holding "task 1" in the taught
    // spelling; the card grows the pack's says-line and the dialog's note
    // leads with it. Before the report, no card carries the line (claimed
    // false and could-not-read both render nothing).
    if ((await p.locator('.tksay').count()) !== 0) die('a says-line rendered before any report');
    await p.evaluate(async (member) => {
      const r = await fetch('/api/agent/' + member + '/commitments', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commitments: [{ what: 'On task 1: the handoff checklist rewrite' }] }),
      });
      if (!r.ok) throw new Error('report failed ' + r.status);
    }, MEMBER);
    await p.waitForSelector('.tksay', { timeout: 15000 });
    const say = (await p.locator('.tksay').textContent()).trim();
    if (!/says it is on this/.test(say)) die('says-line text: ' + say);
    if ((await p.locator('.tksay').count()) !== 1) die('the says-line leaked onto unclaimed cards');

    // The view dialog: meta, the blessed close-note naming the agent.
    await p.locator('.tkcard').first().click();
    await p.waitForSelector('#tk-modal', { state: 'visible' });
    const note = (await p.locator('#tk-note').textContent()).replace(/\s+/g, ' ').trim();
    if (!note.startsWith(MEMBER + ' says it is on this. Marking it done closes it here. It does not stop ')
        || !note.includes(MEMBER)) die('the joined close-note drifted: ' + note);
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/tasks-view-modal.png') });

    // Mark as done. The reveal is still on (it persists across same-project
    // repaints by design), so the done card stays visible, now struck
    // through, and the door stays hidden because everything is showing.
    await p.click('#tk-done');
    await p.waitForSelector('#tk-modal', { state: 'hidden', timeout: 10000 });
    await p.waitForSelector('.tkcard.closed', { timeout: 10000 });
    if ((await p.locator('.tkcard').count()) !== 2) die('the reveal lost a card on repaint');
    if (!(await p.locator('#pj-alltasks').isHidden())) die('the door shows while everything is revealed');
    // And with the reveal OFF, the done card is behind the door. The reveal
    // survives same-project Back-and-return by design, so the reset needs a
    // real project SWITCH: bounce through Elsewhere and come back.
    await p.click('#pj-back');
    await p.locator('#pj-list').getByText('Elsewhere').first().click();
    await p.waitForSelector('#pj-tasks-field', { state: 'visible', timeout: 10000 });
    await p.click('#pj-back');
    await p.locator('#pj-list').getByText('Task Drive').first().click();
    await p.waitForSelector('#pj-tasks-field', { state: 'visible', timeout: 10000 });
    if ((await p.locator('.tkcard').count()) !== 0) die('a done or unassigned task sits in the fresh column');
    const doorAfter = (await p.locator('#pj-alltasks').textContent()).trim();
    if (!/View all tasks \(2\)/.test(doorAfter)) die('door after done: ' + doorAfter);
    await p.click('#pj-alltasks');
    const doneCard = p.locator('.tkcard.closed').first();
    if (!(await doneCard.count())) die('the done task is not behind the door');
    await doneCard.click();
    await p.waitForSelector('#tk-modal', { state: 'visible' });
    if ((await p.locator('#tk-done').textContent()).trim() !== 'Reopen') die('a done task does not offer Reopen');
    if (!(await p.locator('#tk-note').isHidden())) die('the close-note shows on a done task');
    await p.click('#tk-done');
    await p.waitForSelector('#tk-modal', { state: 'hidden', timeout: 10000 });

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('TASKS DRIVE OK: modal verbatim + gated, trap holds, column/door split, chip-is-status, THE JOIN (report -> says-line -> joined note, nothing before the report), done and reopen round trip, 0 page errors');
  } finally {
    await b.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
