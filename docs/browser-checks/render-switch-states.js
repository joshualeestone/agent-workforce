'use strict';

/**
 * The four Settings switches, on a machine where their settings CAN be read.
 *
 * 🔑 THE RISK THIS COVERS IS THE OPPOSITE OF THE ONE THE UNIT TESTS COVER. Those
 * prove the control disappears when the answer is unknown; this proves it comes
 * BACK when the answer arrives. A paint that hides and never un-hides passes
 * every honesty assertion and leaves Settings with no controls at all (#229).
 *
 *   AGENT_WORKFORCE_DATA=/tmp/sw PORT=17461 node server.js &
 *   NODE_PATH="/Users/agent1/work/pw-runtime/node_modules" node docs/browser-checks/render-switch-states.js
 *
 * ⚠️ HEADED by default.  on a machine with no console session.
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(1000);
  await pg.click('.tab[data-tab="settings"]');
  await pg.waitForTimeout(1200);
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const seen = await pg.evaluate(() => ['lim-toggle', 'tell-toggle', 'auto-toggle', 'eng-toggle'].map((id) => {
    const e = document.getElementById(id);
    const r = e.getBoundingClientRect();
    return { id, hidden: e.hidden, checked: e.getAttribute('aria-checked'), w: Math.round(r.width), h: Math.round(r.height) };
  }));
  for (const s of seen) {
    say(s.hidden === false, s.id + ': is on screen once its setting is read', JSON.stringify(s));
    say(s.checked === 'true' || s.checked === 'false', s.id + ': carries a real position', String(s.checked));
    say(s.w > 20 && s.h > 10, s.id + ': has real size', s.w + 'x' + s.h);
  }
  await pg.screenshot({ path: '/tmp/swshots/settings-switches.png', clip: { x: 0, y: 60, width: 1500, height: 520 } });
  await pg.close();
  await b.close();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
