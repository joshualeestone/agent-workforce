'use strict';

/**
 * What the page says when the server it was loaded from stops answering (#269).
 *
 * 🔑 THE SERVER IS REALLY KILLED, not stubbed. The state under test is a fetch
 * that rejects against a host that is gone, which is the one thing a mock of
 * `fetch` cannot be wrong about in the same way: the page has to survive its own
 * poll failing, repaint its chrome, and keep the note up across later polls.
 *
 * ⚠️ AND THE IN-FLIGHT ARM IS ASSERTED FIRST, before the server dies. On a slow
 * machine the in-flight state and the failed state look identical to whoever is
 * writing the code, and a check that only looks after the failure passes on a
 * build that shows the note immediately.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/on PORT=17451 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17451 node docs/browser-checks/render-offline-note.js /tmp/onshots
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17451';
const OUT = process.argv[2] || '/tmp/onshots';
const fails = [];
const say = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fails.push(label);
};

const port = new URL_(URL).port;
function URL_(u) { return new (require('node:url').URL)(u); }

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const pg = await b.newPage({ viewport: { width: 1400, height: 600 } });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(1200);

  const read = () => pg.evaluate(() => {
    const s = document.getElementById('uoffline-slot');
    const r = s && s.getBoundingClientRect();
    return { text: s ? s.innerText.trim() : null, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };
  });

  say((await read()).text === '', 'nothing is said while the board is answering', JSON.stringify(await read()));

  /* 🛑 THE ARM THAT MATTERS: a poll that has gone out and not come back. The
     route is held, not failed, so the page is in exactly the state a slow first
     load is in. */
  await pg.route('**/api/status', () => { /* never fulfilled, never aborted */ });
  await pg.waitForTimeout(6000);
  const held = await read();
  say(held.text === '', 'and nothing while a poll is merely in flight', JSON.stringify(held));

  /* Now let it fail for real: the server goes away underneath the page. */
  await pg.unroute('**/api/status');
  try { execFileSync('/bin/sh', ['-c', `lsof -nP -iTCP:${port} -sTCP:LISTEN -t | xargs kill`]); } catch { /* already gone */ }
  await pg.waitForTimeout(7000);

  const down = await read();
  say(/not answering on this computer/i.test(down.text), 'the note appears once a poll has come back failing',
    JSON.stringify(down.text));
  say(down.w > 150 && down.h > 20, 'it has real size on screen', down.w + 'x' + down.h);
  /* ⚠️ ONLY WHERE THERE IS A VERSION TO CARRY. A source checkout has the build
     marker un-substituted, so `bakedVersion()` correctly answers null and the
     detail is correctly absent: asserting it here would be measuring a bundle
     property against a tree that is not one. Reported rather than skipped
     silently, because a check that quietly stops asking is worse than one that
     fails. */
  const baked = await pg.evaluate(() => {
    const m = document.querySelector('meta[name="kosmos-version"]');
    const v = m && m.getAttribute('content');
    return typeof v === 'string' && v.indexOf('KOSMOS_VERSION') === -1 ? v : null;
  });
  if (baked) say(down.text.includes(baked), 'it carries the version this page is', baked);
  else console.log('SKIP  the version line: this tree is a source checkout, so nothing is baked to carry (web.offline-note.test.js pins both arms)');
  say(down.text.includes(port), 'and where it tried', port);
  for (const word of ['server', 'crashed', 'stopped', 'restart', 'offline']) {
    say(!down.text.toLowerCase().includes(word), `it does not name "${word}" as a cause`);
  }
  say(!(await pg.$('#uoffline-slot button')), 'it offers nothing to press');

  await pg.screenshot({ path: path.join(OUT, 'offline.png'), clip: { x: 0, y: 0, width: 900, height: 200 } });
  await pg.close();
  await b.close();
  console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nall good');
  process.exit(fails.length ? 1 : 0);
})();
