'use strict';

/**
 * The board at a width above the old cap (#286, #287).
 *
 * 🛑 EVERY EXISTING RENDER CHECK RUNS AT OR BELOW 1320px AND CANNOT SEE THIS.
 * The file says so itself, about this cap, causing this class of bug:
 * "Measured at 1400px: header left 40, create left 24. Identical at =<1320px,
 * which is why every render check passed." So a green suite after a full-width
 * change proves nothing, and this runs at 1760.
 *
 * 🔑 THE LOAD-BEARING ASSERTION IS ONE ROW LINING UP WITH ANOTHER. The header's
 * left edge equals the card grid's left edge. That single equality catches the
 * ~276px overhang the grid's own comment records, the `#panel-create` margin
 * becoming a silent no-op, and any one of the fifteen capped rules being
 * missed, because all three present as two rows disagreeing about the edge.
 *
 * ⚠️ AND THE TAB CENTRING NEEDS TWO STAMP LENGTHS. A check with one status
 * message passes on a build where the tabs still slide: the offset was measured
 * as `-(headright - headleft) / 2`, so it is zero only when the two clusters
 * happen to match. Mona Lisa measured a 34px range across the real strings.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/fw PORT=17441 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17441 node docs/browser-checks/render-full-width.js /tmp/fwshots
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17441';
const OUT = process.argv[2] || '/tmp/fwshots';
const WIDE = 1760;
const fails = [];
const say = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fails.push(label);
};

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: WIDE, height: 1000 }, colorScheme: theme });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(1200);

    const edges = await pg.evaluate(() => {
      const box = (sel) => { const e = document.querySelector(sel); const r = e && e.getBoundingClientRect(); return r ? { left: Math.round(r.left), right: Math.round(r.right) } : null; };
      return {
        header: box('.apphead header'), cards: box('#grid'),
        /* ⚠️ BY ID, NOT BY CLASS. `.statsrow` matches the projects row too, and
           `querySelector` took the first in document order: a hidden element
           with a zero box, reported as the agents row being 1736px out of
           place. A confident false failure from a selector, which is the trap
           this suite keeps finding. */
        stats: box('#boardbar'),
        alist: box('#alist'), doc: Math.round(document.documentElement.scrollWidth),
      };
    });
    say(edges.header && edges.cards && edges.header.left === edges.cards.left,
      theme + ': the header and the card grid share a left edge',
      JSON.stringify([edges.header, edges.cards]));
    say(edges.header && edges.cards && edges.header.right === edges.cards.right,
      theme + ': and a right edge', JSON.stringify([edges.header.right, edges.cards.right]));
    say(edges.stats && edges.header && edges.stats.left === edges.header.left,
      theme + ': the stats row shares it too', JSON.stringify(edges.stats));
    /* The whole point of the change: the chrome uses the window it is given. */
    say(edges.header && edges.header.right > 1500,
      theme + ': the chrome actually spans the window', String(edges.header && edges.header.right));
    /* ⚠️ Nothing may push the page sideways; a cap removed from a fixed-column
       grid is exactly how that happens. */
    say(edges.doc <= WIDE, theme + ': the page does not scroll sideways', String(edges.doc));

    /* 🔑 THE TABS, AT TWO STAMP LENGTHS. Driven through the page's own painter
       so the measurement is of what ships, not of markup I substituted. */
    const offsets = [];
    for (const seconds of [3, 41283]) {
      await pg.evaluate((n) => {
        const el = document.getElementById('checked');
        el.innerHTML = '<span>Agent status</span><b>' + freshWords(n) + '</b>';
      }, seconds);
      await pg.waitForTimeout(120);
      offsets.push(await pg.evaluate(() => {
        const t = document.querySelector('.tabs').getBoundingClientRect();
        return Math.round((t.left + t.right) / 2 - document.documentElement.clientWidth / 2);
      }));
    }
    say(Math.abs(offsets[0]) <= 1, theme + ': the tabs sit on the page centre', String(offsets[0]));
    say(offsets[0] === offsets[1], theme + ': and do not move when the stamp changes length',
      offsets.join(' vs '));

    await pg.screenshot({ path: path.join(OUT, 'wide-' + theme + '.png'), clip: { x: 0, y: 0, width: WIDE, height: 620 } });

    /* 🛑 THE TWO RULES THAT WERE NOT SIMPLE REMOVALS, and both fail quietly.
       The create form re-derived the cap by hand in a margin, so removing the
       cap turns that expression into 0px and leaves a rule that does nothing;
       and the settings grid was a FIXED two columns, so uncapping it widens
       the boxes instead of adding a third. Neither shows up on the board. */
    await pg.click('.tab[data-tab="settings"]');
    await pg.waitForTimeout(700);
    const dg = await pg.evaluate(() => {
      /* ⚠️ SCOPED TO THE PANEL ON SCREEN. A bare `.dgrid` matched the one in
         the hidden detail panel first: a zero box, reported as the settings
         grid being 1712px out of place. Second selector trap in this file. */
      const g = document.querySelector('#panel-settings .dgrid');
       if (!g) return null;
      const r = g.getBoundingClientRect();
      const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
      const box = g.querySelector('.dbox');
      return { left: Math.round(r.left), right: Math.round(r.right), cols,
        boxWidth: box ? Math.round(box.getBoundingClientRect().width) : null };
    });
    say(Boolean(dg), theme + ': the settings grid is on screen');
    if (dg) {
      say(dg.left === edges.header.left && dg.right === edges.header.right,
        theme + ': the settings grid shares the page edges', JSON.stringify(dg));
      say(dg.cols >= 3, theme + ': it gained a column rather than widening its boxes', String(dg.cols));
      /* ⚠️ A LOWER BOUND TOO: `< 700` passed on a zero-width hidden element,
         which is an assertion that cannot fail for the reason it was written. */
      say(dg.boxWidth > 200 && dg.boxWidth < 700, theme + ': and the boxes did not inflate', String(dg.boxWidth));
    }

    await pg.click('.tab[data-tab="agents"]');
    await pg.waitForTimeout(400);
    await pg.click('#new-agent');
    await pg.waitForTimeout(700);
    const create = await pg.evaluate(() => {
      const p = document.getElementById('panel-create');
      if (!p || p.hidden) return null;
      const r = p.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width) };
    });
    say(Boolean(create), theme + ': the create form is on screen');
    if (create) {
      /* Left against the same gutter as everything else, which is what the
         old hand-rolled margin was faking with a centred column. */
      say(create.left === edges.header.left, theme + ': the create form starts at the page gutter',
        JSON.stringify(create));
      /* ⚠️ AND IT KEEPS ITS MEASURE. A form stretched to 1712px is the literal
         reading of full width and the one nobody asked for. */
      say(create.width < 700, theme + ': and keeps a reading measure', String(create.width));
      await pg.screenshot({ path: path.join(OUT, 'create-' + theme + '.png'), clip: { x: 0, y: 0, width: WIDE, height: 520 } });
    }
    say(errs.length === 0, theme + ': no console errors', errs.join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nall good');
  process.exit(fails.length ? 1 : 0);
})();
