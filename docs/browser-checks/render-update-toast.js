/* Drive-through of the update toast + confirm: the toast renders from a
   published newer version, clears the header controls, opens the drawn
   confirm with the exact frozen copy, surfaces the route's honest from-source
   refusal, and Later remembers per version. Sandboxed server + local release
   host. */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

/* Run with the durable playwright runtime:
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules node \
 *     docs/browser-checks/render-update-toast.js
 * Sandboxes every root the server writes to and runs its own local release
 * host; kills only the processes it started. */
const REPO = path.resolve(__dirname, '..', '..');
const PORT = 4653;
const RELPORT = 4654;

(async () => {
  const rel = http.createServer((req, res) => {
    if (req.url === '/dist/latest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: '9.9.9' }));
    } else { res.writeHead(404); res.end(); }
  }).listen(RELPORT, '127.0.0.1');

  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-drive-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_WORKFORCE_RELEASE_BASE: `http://127.0.0.1:${RELPORT}/dist`,
      AGENT_WORKFORCE_DATA: roots.DATA,
      AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH,
      AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
    },
    stdio: 'ignore',
  });
  const die = (msg) => { srv.kill(); rel.close(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    // The first status tick pokes the release host; the second renders the
    // verdict. Wait for the toast.
    await p.waitForSelector('.utoast', { state: 'visible', timeout: 20000 });
    const txt = await p.locator('.utoast .utxt').textContent();
    if (!/Update available/.test(txt) || !/Kosmos 9\.9\.9/.test(txt)) die('toast text wrong: ' + txt);

    // In the flow beside the mark; the checks below prove no overlap with the header controls either way.
    const boxes = {};
    for (const [k, sel] of [['toast', '.utoast'], ['newagent', '#new-agent'], ['checked', '#checked']]) {
      boxes[k] = await p.locator(sel).boundingBox();
    }
    const overlap = (a, c) => a && c && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
    if (overlap(boxes.toast, boxes.newagent)) die('toast overlaps the New agent button');
    if (overlap(boxes.toast, boxes.checked)) die('toast overlaps the checked stamp');

    // The drawn placement (#47, pack 2e4e100): the notice lives INSIDE the
    // header's left group, in line beside the mark, not floating anywhere.
    // Without this pin, the clear-of-controls checks pass any placement.
    const placement = await p.evaluate(() => {
      const t = document.querySelector('.utoast');
      const k = document.getElementById('klink');
      const inLeft = !!t.closest('.headleft');
      const tb = t.getBoundingClientRect();
      const kb = k.getBoundingClientRect();
      return { inLeft, rightOfMark: tb.left >= kb.right,
               sameBand: Math.abs((tb.top + tb.height / 2) - (kb.top + kb.height / 2)) < kb.height,
               staticPos: getComputedStyle(t).position === 'static' };
    });
    if (!placement.inLeft || !placement.rightOfMark || !placement.sameBand || !placement.staticPos) {
      die('desktop: the notice is not inline beside the mark ' + JSON.stringify(placement));
    }

    // The old absolute comment's warning, mechanized: a child in the flow
    // must not re-space the row. Measured 2026-08-17: zero x-shift on the
    // right group; the header grows 8px taller, the trade the pack's own
    // mobile comment blesses ("the header grows when an update is waiting"
    // over anything unclickable). Pin the x-shift at zero.
    const withToast = await p.evaluate(() => ({
      newagent: Math.round(document.getElementById('new-agent').getBoundingClientRect().x),
      checked: Math.round(document.getElementById('checked').getBoundingClientRect().x),
    }));
    // display:none, not an innerHTML round trip: rebuilding the markup from
    // a string would strip the buttons' listeners and kill the Install step
    // this drive runs later.
    await p.evaluate(() => { document.getElementById('utoast-slot').style.display = 'none'; });
    const sansToast = await p.evaluate(() => ({
      newagent: Math.round(document.getElementById('new-agent').getBoundingClientRect().x),
      checked: Math.round(document.getElementById('checked').getBoundingClientRect().x),
    }));
    await p.evaluate(() => { document.getElementById('utoast-slot').style.display = ''; });
    if (withToast.newagent !== sansToast.newagent || withToast.checked !== sansToast.checked) {
      die('the notice re-spaces the header row: ' + JSON.stringify({ withToast, sansToast }));
    }
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/update-toast.png') });

    // The toast's Install is GOLD (the pack's action colour): the neutral
    // .uacts button rule outweighed the gold class once, silently.
    const goldBg = await p.locator('#ut-install').evaluate((el) => getComputedStyle(el).backgroundColor);
    if (goldBg !== 'rgb(227, 179, 65)') die('toast Install lost the gold: ' + goldBg);

    // Install opens the confirm with the frozen copy, word for word.
    await p.click('#ut-install');
    await p.waitForSelector('#updconfirm', { state: 'visible' });
    const title = (await p.locator('#uc-t').textContent()).trim();
    const bodyTx = (await p.locator('#uc-small').textContent()).replace(/\s+/g, ' ').trim();
    if (title !== 'Update Kosmos?') die('confirm title: ' + title);
    if (bodyTx !== 'Kosmos closes for a few seconds while it updates. Your agents keep working the whole time.')
      die('confirm body drifted: ' + bodyTx);
    const goTxt = (await p.locator('#uc-go').textContent()).trim();
    const noTxt = (await p.locator('#uc-no').textContent()).trim();
    if (goTxt !== 'Update' || noTxt !== 'Not now') die('confirm buttons: ' + noTxt + ' / ' + goTxt);
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/update-confirm.png') });

    // The trap holds at BOTH wrap boundaries, with real keypresses: Tab on
    // the last stop wraps to the first; Shift+Tab on the first wraps back.
    await p.locator('#uc-go').focus();
    await p.keyboard.press('Tab');
    let active = await p.evaluate(() => document.activeElement && document.activeElement.id);
    if (active !== 'uc-no') die('Tab from the last stop escaped the confirm to: ' + active);
    await p.keyboard.press('Shift+Tab');
    active = await p.evaluate(() => document.activeElement && document.activeElement.id);
    if (active !== 'uc-go') die('Shift+Tab from the first stop escaped the confirm to: ' + active);

    // This checkout runs from source, so Update surfaces the route's honest
    // 409 sentence inside the modal instead of pretending.
    await p.click('#uc-go');
    await p.waitForSelector('#uc-err', { state: 'visible' });
    const err = await p.locator('#uc-err').textContent();
    if (!/source code/.test(err)) die('from-source refusal not surfaced: ' + err);

    // Not now closes; Later hides and remembers the version.
    await p.click('#uc-no');
    if (await p.isVisible('#updconfirm')) die('Not now did not close the confirm');
    await p.click('#ut-later');
    if (await p.isVisible('.utoast')) die('Later did not hide the toast');
    const remembered = await p.evaluate(() => localStorage.getItem('kosmos-update-later'));
    if (remembered !== '9.9.9') die('Later did not remember the version: ' + remembered);

    // ...and it STAYS hidden across the next ticks.
    await p.waitForTimeout(6000);
    if (await p.isVisible('.utoast')) die('the toast came back after Later');

    // Mobile pass: at 375 the toast must still clear whatever header
    // controls are visible.
    await p.setViewportSize({ width: 375, height: 812 });
    await p.evaluate(() => localStorage.removeItem('kosmos-update-later'));
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForSelector('.utoast', { state: 'visible', timeout: 20000 });
    const mboxes = {};
    for (const [k, sel] of [['toast', '.utoast'], ['newagent', '#new-agent'], ['checked', '#checked'], ['burger', '.burger']]) {
      const loc = p.locator(sel).first();
      mboxes[k] = (await loc.count()) && await loc.isVisible() ? await loc.boundingBox() : null;
    }
    for (const k of ['newagent', 'checked', 'burger']) {
      if (overlap(mboxes.toast, mboxes[k])) die('mobile: toast overlaps ' + k + ' ' + JSON.stringify(mboxes));
    }
    if (mboxes.toast.x < 0 || mboxes.toast.y < 0) die('mobile: toast off-screen ' + JSON.stringify(mboxes.toast));
    await p.screenshot({ path: path.join(REPO, 'docs/browser-checks/shots/update-toast-375.png') });

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('TOAST DRIVE OK: render, geometry clear of header controls, frozen copy verbatim, from-source refusal surfaced, Later remembered per version, 0 page errors');
  } finally {
    await b.close();
    srv.kill();
    rel.close();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
