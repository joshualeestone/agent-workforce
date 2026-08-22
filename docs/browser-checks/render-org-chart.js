'use strict';

/**
 * The org chart after Josh's five notes (#284).
 *
 * 🔑 FOUR OF THE FIVE ARE HERE and every one of them is a rendered property, not
 * a markup one: whether a wire crosses a face, whether the hub reads as an object
 * without a stroke, whether the thing that looks pressable is pressable, and
 * whether the drawing sits in the middle of its own canvas.
 *
 * ⚠️ THE CENTRING CHECK IS THE ONE THAT NEEDED MEASURING. Two of his five notes
 * turned out not to be what the words said: the lines were already behind the
 * faces (the discs were see-through), and the chart was not too wide but too
 * sparse and off-centre, using 38% of the canvas with the hub pinned to the
 * middle while the tree grew one way (Mona Lisa, measured off his screenshot).
 *
 *   AGENT_WORKFORCE_DATA=/tmp/org PORT=17471 node server.js &
 *   NODE_PATH="/Users/agent1/work/pw-runtime/node_modules" node docs/browser-checks/render-org-chart.js
 *
 * ⚠️ HEADED by default.  on a machine with no console session.
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(1200);
  await pg.click('[data-scope="agents"] .vt[data-layout="org"]');
  await pg.waitForTimeout(1000);

  const m = await pg.evaluate(() => {
    const map = document.getElementById('orgmap');
    const svg = map.querySelector('svg.wires');
    const hub = map.querySelector('.hub');
    const nodes = [...map.querySelectorAll('.onode')];
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const all = [hub, ...nodes].map(box);
    const bb = { l: Math.min(...all.map(a => a.l)), r: Math.max(...all.map(a => a.r)), t: Math.min(...all.map(a => a.t)), b: Math.max(...all.map(a => a.b)) };
    const cv = svg.getBoundingClientRect();
    return {
      nodes: nodes.length,
      faceOpacity: nodes[0] ? getComputedStyle(nodes[0].querySelector('.face')).opacity : null,
      /* Whatever is inside the disc, photo or letters, must be dimmed: an
         agent with no picture is the common case on a new fleet. */
      contentOpacity: nodes[0] && nodes[0].querySelector('.face > *')
        ? getComputedStyle(nodes[0].querySelector('.face > *')).opacity : 'EMPTY-DISC',
      hubBorder: getComputedStyle(hub).borderTopWidth,
      hubBg: getComputedStyle(hub).backgroundColor,
      calloutEvents: nodes[0] ? getComputedStyle(nodes[0].querySelector('.callout')).pointerEvents : null,
      offsetX: Math.round(((bb.l + bb.r) / 2) - ((cv.left + cv.right) / 2)),
      offsetY: Math.round(((bb.t + bb.b) / 2) - ((cv.top + cv.bottom) / 2)),
      fill: Math.round(((bb.r - bb.l) / (cv.right - cv.left)) * 100),
    };
  });
  say(m.nodes > 0, 'the chart drew', String(m.nodes));
  say(m.faceOpacity === '1', 'the disc is opaque, so no wire crosses a face', m.faceOpacity);
  say(m.contentOpacity === '0.5', 'what is inside it is still quiet', String(m.contentOpacity));
  say(m.hubBorder === '0px', 'the hub has no stroke', m.hubBorder);
  say(m.hubBg !== 'rgba(0, 0, 0, 0)', 'and still reads as an object', m.hubBg);
  say(m.calloutEvents === 'auto', 'the callout can be clicked', m.calloutEvents);
  say(Math.abs(m.offsetX) <= 2 && Math.abs(m.offsetY) <= 2,
    'the drawing is centred on itself, not on the hub', m.offsetX + ',' + m.offsetY);
  say(m.fill >= 55, 'and it fills the canvas rather than a third of it', m.fill + '%');

  await pg.screenshot({ path: '/tmp/orgshots/org.png', clip: { x: 0, y: 110, width: 1400, height: 780 } });
  const n = await pg.$('.onode');
  await n.hover();
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: '/tmp/orgshots/org-hover.png', clip: { x: 0, y: 110, width: 1400, height: 780 } });
  await pg.close();
  await b.close();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
