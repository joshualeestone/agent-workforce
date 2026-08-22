'use strict';

/**
 * The not-running row in the LIST layout, measured against its neighbour.
 *
 * 🛑 IT SHIPPED IN THE WRONG COLUMNS. `.lrow` is a five-column grid and the
 * not-running row supplied four children, so every cell moved one column
 * right and the agent's ROLE landed in the STATE column: scanning that column
 * down a list read "Idle / Legal / Idle". Wrong in the way that reads as
 * information rather than as a glitch (Mona Lisa, rendered rather than
 * reasoned).
 *
 * 🔑 SO THE CLAIM IS A COMPARISON, cell by cell, against a running row in the
 * same list. A check that only read this row would pass on any geometry.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17431 node docs/browser-checks/render-list-row.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17431';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(1200);
  /* The toggle lives in the board bar, which is hidden until the first poll
     lands; clicking it before then times out on an invisible element. */
  await pg.waitForSelector('[data-scope="agents"] .vt[data-layout="list"]', { state: 'visible', timeout: 15000 });
  await pg.click('[data-scope="agents"] .vt[data-layout="list"]');
  await pg.waitForTimeout(900);
  const seen = await pg.evaluate(() => {
    const cell = (row, sel) => { const e = row.querySelector(sel); const r = e && e.getBoundingClientRect(); return r ? { left: Math.round(r.left), width: Math.round(r.width) } : null; };
    const off = document.querySelector('.lrow.notrunning');
    const on = document.querySelector('.lrow:not(.notrunning)');
    return {
      offState: off && cell(off, '.lstate'), onState: on && cell(on, '.lstate'),
      offName: off && cell(off, '.lname'), onName: on && cell(on, '.lname'),
      offKids: off ? [...off.children].map((c) => c.className) : [],
      stateText: off ? off.querySelector('.lstate').innerText.trim() : '',
      taskText: off ? off.querySelector('.ltask').innerText.trim() : 'NO CELL',
    };
  });
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  say(seen.offKids.length === 5, 'five children', seen.offKids.join(','));
  say(seen.offState && seen.onState && seen.offState.left === seen.onState.left, 'the state column lines up', JSON.stringify([seen.offState, seen.onState]));
  say(seen.offName && seen.onName && seen.offName.left === seen.onName.left, 'the name column lines up', JSON.stringify([seen.offName, seen.onName]));
  say(seen.stateText === 'Not running', 'the state cell says the state', JSON.stringify(seen.stateText));
  say(seen.taskText === '', 'the task cell is empty', JSON.stringify(seen.taskText));
  const el = await pg.$('.lrow.notrunning');
  let bx = await el.boundingBox();
  /* Scroll it into view first: the clip is in PAGE coordinates and a row below
     the fold produces an empty rectangle rather than a picture. */
  await pg.evaluate((y) => window.scrollTo(0, Math.max(0, y - 200)), bx.y);
  await pg.waitForTimeout(300);
  bx = await (await pg.$('.lrow.notrunning')).boundingBox();
  await pg.screenshot({ path: '/tmp/nrshots/lrow.png', clip: { x: Math.max(0, bx.x - 20), y: Math.max(0, bx.y - 90), width: Math.min(1360, bx.width + 40), height: bx.height + 180 } });
  await pg.close();
  await b.close();
  console.log(fails.length ? 'FAILED' : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
