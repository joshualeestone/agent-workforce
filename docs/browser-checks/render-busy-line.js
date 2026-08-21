'use strict';

/**
 * The "<name> is working…" line, rendered.
 *
 * ⚠️ WHY A BROWSER. `node --test` reads this file as text: it can prove the
 * sentence is in the page and cannot prove it is on the screen, that it is
 * hidden in the states where it must be, or what an assistive technology
 * actually says. The avatar sits INSIDE the line, so `textContent` is
 * "DDan is working…" while the accessible name should be the sentence alone —
 * a distinction only a render can settle, and one this repo got wrong once on
 * the list row's memory caption.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-busy-line.js
 *
 * ⚠️ HEADED by default, matching the other checks here. `HEADED=0` on a machine
 * with no console session; the verdicts are the same either way, because this
 * asserts computed state rather than comparing pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-busy-line: playwright is not on NODE_PATH — SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('render-busy-line: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const rows = await page.evaluate(() => {
    document.getElementById('panel-detail').hidden = false;
    const el = document.getElementById('d-busy');
    /* What an assistive technology takes: aria-hidden subtrees are not part of
       the accessible name, and the avatar is one. */
    const spoken = (root) => {
      let out = '';
      for (const n of root.childNodes) {
        if (n.nodeType === 3) { out += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        if (n.getAttribute('aria-hidden') === 'true') continue;
        out += spoken(n);
      }
      return out.replace(/\s+/g, ' ').trim();
    };
    const look = (label, card) => {
      paintBusy(card, card && card.name);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        label,
        shown: !el.hidden && cs.display !== 'none' && r.width > 0 && r.height > 0,
        spoken: spoken(el),
        dots: !!el.querySelector('.act'),
        face: !!el.querySelector('.msg-av'),
        w: Math.round(r.width),
      };
    };
    return [
      look('working', { sessionName: 'dan', name: 'Dan', state: 'working' }),
      look('idle', { sessionName: 'dan', name: 'Dan', state: 'idle' }),
      look('unknown', { sessionName: 'dan', name: 'Dan', state: 'unknown' }),
      look('needs_you', { sessionName: 'dan', name: 'Dan', state: 'needs_you' }),
      look('stopped', { sessionName: 'dan', name: 'Dan', state: 'stopped' }),
      look('no card at all', null),
    ];
  });

  await browser.close();
  const problems = [];
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  const work = byLabel.working;

  if (!work.shown) problems.push('a working agent draws nothing');
  if (work.spoken !== 'Dan is working…') {
    problems.push(`a working agent is announced as "${work.spoken}", not "Dan is working…"`);
  }
  if (/typing|replying|composing/i.test(work.spoken)) {
    problems.push(`the line claims to know what the agent is working on: "${work.spoken}"`);
  }
  if (!work.dots) problems.push('the working glyph the board uses is missing');
  if (!work.face) problems.push('the avatar is missing');
  if (work.w < 40) problems.push(`the line is ${work.w}px wide, which is not a line`);

  /* ⚠️ EVERY OTHER STATE, not just idle. `unknown` is the one that matters most
     — an agent we cannot read must not be rendered as working OR as idle. */
  for (const label of ['idle', 'unknown', 'needs_you', 'stopped', 'no card at all']) {
    if (byLabel[label].shown) problems.push(`a ${label} agent is shown as working`);
  }

  for (const r of rows) console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error(`render-busy-line: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('render-busy-line: shown only for a working agent, announced without claiming why.');
})();
