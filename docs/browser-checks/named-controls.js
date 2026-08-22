'use strict';

/**
 * Every control a person can reach has a name a screen reader can say.
 *
 * 🛑 THE FAILURE THIS CATCHES IS SILENT AND LOOKS FINE. A button with an icon
 * and no accessible name renders perfectly and announces as "button". Mona Lisa
 * found one the night this was written: six agents behind on a project, six
 * buttons reading "Bring it up to date", and nothing to tell a screen-reader
 * user which was which. It was correct markup and a correct sentence, and it
 * was unusable by ear.
 *
 * 🔑 IT WALKS SURFACES, NOT THE PAGE. A one-off scan of the four tabs came back
 * clean and proved less than it looked: the create form, the two modals and the
 * project room are all controls a person reaches and none of them are on a
 * resting tab. What is checked is listed in SURFACES below, and what is NOT
 * checked is listed under it, because a sweep that does not say where it did
 * not look reads as a clean bill.
 *
 * ⚠️ NAME, NOT LABEL. The accessible name can come from `aria-label`,
 * `aria-labelledby`, the control's own text, a `<label for>`, an image's alt
 * or `title`. Checking only `aria-label` would fail every correctly-built
 * button in the product.
 *
 * Run against a sandboxed board (never the operator's real data):
 *
 *   AGENT_WORKFORCE_DATA=/tmp/a11y PORT=17370 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17370 node docs/browser-checks/named-controls.js
 *
 * ⚠️ HEADED by default, like its neighbours. `HEADED=0` on a machine with no
 * console session.
 */

const { chromium } = require('playwright');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17370';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* Each surface: how to get there from a FRESH page. Fresh rather than chained,
   because the first version walked tab to tab and the settings step timed out
   behind a panel the previous step had opened, which printed nothing and read
   as a pass. */
const SURFACES = [
  ['agents board', async () => {}],
  ['agent panel', async (pg) => { await pg.locator('.acard .namego').first().click(); }],
  ['projects', async (pg) => { await pg.evaluate(() => showTab('projects')); }],
  ['settings', async (pg) => { await pg.evaluate(() => showTab('settings')); }],
  ['create form', async (pg) => {
    await pg.click('#new-agent');
    await pg.click('#pick-pm');
    await pg.click('#role-next');
  }],
  ['restart dialog', async (pg) => {
    await pg.locator('.acard .namego').first().click();
    await pg.waitForTimeout(1200);
    await pg.click('#d-restart-start');
  }],
  ['removal dialog', async (pg) => {
    await pg.locator('.acard .namego').first().click();
    await pg.waitForTimeout(1400);
    await pg.click('#d-remove-start');
  }],
  /* First run is six panes behind one overlay, and each is a surface a person
     sees on their first minute with the product. Driven by `frGo` rather than
     by clicking Continue, because Continue is gated on real machine answers
     and this check is about names rather than about the flow. */
  /* ⚠️ THE COUNTS ON THESE SIX INCLUDE THE BOARD BEHIND THE OVERLAY, so "step 3:
     28 controls" is not 28 first-run controls. The overlay makes the page inert
     rather than removing it, and an inert element still has a bounding box. The
     check is still sound, because an unnamed control anywhere is a finding
     wherever it sits, but the NUMBER should not be read as a measure of the
     step. Said here rather than fixed, because scoping to the overlay would
     stop this noticing an unnamed control that the overlay fails to cover. */
  ...[1, 2, 3, 4, 5, 6].map((n) => ['first run step ' + n, async (pg) => {
    await pg.evaluate((step) => { document.getElementById('firstrun').hidden = false; frGo(step); }, n);
  }]),
];

/* Read the accessible name the way a screen reader assembles it, not the way a
   linter with one rule would. */
const SCAN = () => {
  const named = (el) => {
    const lab = (el.getAttribute('aria-label') || '').trim();
    if (lab) return lab;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    const text = (el.textContent || '').trim();
    if (text) return text;
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const img = el.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && (l.textContent || '').trim()) return l.textContent.trim();
    }
    return '';
  };
  const out = { checked: 0, unnamed: [], duplicates: [] };
  const seen = new Map();
  document.querySelectorAll('button, a[href], [role="button"], [role="switch"], [role="radio"], [role="tab"], input:not([type=hidden])')
    .forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      out.checked += 1;
      const name = named(el);
      const id = el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0];
      if (!name) { out.unnamed.push(id); return; }
      seen.set(name, (seen.get(name) || 0) + 1);
    });
  /* 🔑 AND THE ONE MONA LISA FOUND: several controls sharing one name is not a
     missing name, it is a name that does not identify. A screen reader user
     hearing it three times cannot pick. */
  for (const [name, n] of seen) if (n > 1) out.duplicates.push(name + ' x' + n);
  return out;
};

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const [surface, go] of SURFACES) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 1200 } });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(2200);
    /* ⚠️ The first-run surfaces REOPEN it, so this dismissal must not fight
       them: it runs before `go`, and those steps put the overlay back. */
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(600); }
    let reached = true;
    try { await go(pg); } catch (e) {
      reached = false;
      /* 🛑 A SURFACE WE COULD NOT REACH IS A FAILURE, NOT A SKIP. The first
         version continued past a failed navigation and printed nothing for
         that surface, which reads exactly like a clean one. */
      chk(false, surface + ': could not be reached, so it was not checked', e.message.slice(0, 70));
    }
    if (reached) {
      await pg.waitForTimeout(1400);
      const r = await pg.evaluate(SCAN);
      chk(r.checked > 0, surface + ': found controls to check', String(r.checked));
      chk(r.unnamed.length === 0, surface + ': every visible control has a name', r.unnamed.join(', '));
      chk(r.duplicates.length === 0, surface + ': no two controls answer to the same name', r.duplicates.join(', '));
    }
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED: ' + fail.join('; ') : '\nall green');
  console.log('\nNOT CHECKED, said so nobody reads this as a clean bill: the '
    + 'new-task and history modals, the project room, and anything that only '
    + 'appears after an error. Everything else a person can reach is above.');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED', e.message); process.exit(2); });
