'use strict';

/**
 * Measure the unknown-memory badge IN A REAL BROWSER.
 *
 * ⚠️ EVERY OTHER TEST OF THIS CHANGE READS TEXT, and text cannot see layout.
 * The badge is absolutely positioned, centred under an 82px gauge and set to
 * `white-space: nowrap`, and the CSS beside it carries measurements ("the
 * caption is 105px wide", "-7px collided with the dot, -15px with the name")
 * that were taken once and can go stale the moment the word inside it changes.
 * "Not yet read" is five characters longer than "Unknown", so whether it still
 * clears the name below and stays inside the card is a question only a
 * renderer can answer.
 *
 * 🔑 IT MEASURES IN THE PAGE, never from a picture. `getBoundingClientRect` is
 * mode-independent; screenshots are not (headless is SwiftShader, headed is the
 * Metal compositor, and the two differ on every file). So this is meaningful
 * headed or headless, which is the whole reason it asserts geometry rather than
 * comparing images.
 *
 *     node tools/measure-memory-badge.js          # headed (default)
 *     HEADED=0 node tools/measure-memory-badge.js # headless, same verdicts
 */

const nodePath = require('node:path');

const PW = '/Users/agent1/work/pw-runtime/node_modules/playwright';
const PAGE = nodePath.join(__dirname, '..', 'web', 'index.html');

const agent = (name, context) => ({
  name, sessionName: name, state: 'idle', presence: 'online',
  model: 'claude-sonnet-5', role: 'Designer', task: null,
  context, instructions: { staleness: 'current' },
});

const FIXTURES = [
  agent('brandnew', { tokens: null, percent: null, notYet: true, because: 'it has not started a session yet' }),
  agent('unreadable', { tokens: null, percent: null, notYet: false, because: 'could not read the transcript' }),
  // ⚠️ THE POSITIVE CONTROL, and it is not decorative: every assertion below is
  // about a badge that IS drawn. A page that stopped drawing cards at all would
  // satisfy "nothing overflows" perfectly.
  agent('measured', { tokens: 90000, percent: 45, notYet: false }),
];

(async () => {
  let chromium;
  try { ({ chromium } = require(PW)); }
  catch {
    console.log('measure-memory-badge: playwright is not installed at ' + PW + ' — SKIPPED, not passed.');
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('file://' + PAGE);

  const rows = await page.evaluate((agents) => {
    const grid = document.getElementById('grid');
    grid.innerHTML = agents.map((a) => card(a)).join('');
    const out = [];
    for (const el of grid.querySelectorAll('.acard')) {
      const c = el.getBoundingClientRect();
      const badge = el.querySelector('.membadge.unk');
      const row = { agent: el.dataset.agent, cardW: Math.round(c.width), badge: badge ? badge.textContent : null };
      if (badge) {
        const b = badge.getBoundingClientRect();
        const n = el.querySelector('.aname').getBoundingClientRect();
        const dot = el.querySelector('.pres').getBoundingClientRect();
        row.badgeW = Math.round(b.width);
        row.insideLeft = Math.round(b.left - c.left);
        row.insideRight = Math.round(c.right - b.right);
        row.gapToName = Math.round(n.top - b.bottom);
        row.gapToDot = Math.round(b.top - dot.bottom);
        row.ring = el.querySelector('svg[role=img]').getAttribute('aria-label');
      }
      out.push(row);
    }
    return { rows: out, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }, FIXTURES);

  await browser.close();

  const problems = [];
  const seen = rows.rows.filter((r) => r.badge !== null);
  if (seen.length !== 2) problems.push(`expected two unknown badges and drew ${seen.length}`);
  if (rows.rows.some((r) => r.agent === 'measured' && r.badge !== null)) {
    problems.push('a measured agent drew an unknown badge, so the fixtures are not distinguishing anything');
  }
  for (const r of seen) {
    if (r.insideLeft < 0 || r.insideRight < 0) problems.push(`${r.agent}: "${r.badge}" hangs outside the card (${r.insideLeft}/${r.insideRight})`);
    if (r.gapToName < 2) problems.push(`${r.agent}: "${r.badge}" collides with the name below (gap ${r.gapToName}px)`);
    if (r.gapToDot < 0) problems.push(`${r.agent}: "${r.badge}" overlaps the presence dot (gap ${r.gapToDot}px)`);
    if (!r.ring || !r.ring.includes(r.agent)) problems.push(`${r.agent}: the ring label does not name the agent`);
    if (r.ring && r.ring.includes(r.badge)) problems.push(`${r.agent}: the ring label repeats the badge word, so an assertion about one can be satisfied by the other`);
  }
  if (rows.pageOverflow > 0) problems.push(`the page scrolls sideways by ${rows.pageOverflow}px`);

  for (const r of rows.rows) console.log(JSON.stringify(r));
  if (problems.length) {
    console.error('measure-memory-badge: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('measure-memory-badge: both unknown words fit the card, clear the name and the dot, and stay disjoint from the ring label.');
})();
