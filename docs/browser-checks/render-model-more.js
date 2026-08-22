'use strict';

/**
 * The create form's model hint and "More models" disclosure (#202).
 *
 * 🔑 IT ASSERTS THE RENDERED STATE, not the markup. A test reading index.html
 * would pass on a disclosure with no styling rule reaching it, which is how a
 * fully transparent modal once survived 316 tests: nothing had rendered the
 * page. The three claims here are all about what a person can see and do --
 * that it starts closed, that clicking opens it, and that the summary shows a
 * focus ring when reached by keyboard, which is the AA requirement a
 * disclosure most easily fails.
 *
 * Run against a sandboxed board (never the operator's real data):
 *
 *   AGENT_WORKFORCE_DATA=/tmp/modelmore PORT=17341 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17341 node docs/browser-checks/render-model-more.js
 *
 * ⚠️ HEADED by default, like its neighbours. `HEADED=0` on a machine with no
 * console session.
 */

const { chromium } = require('playwright');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17341';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: theme });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    pg.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text());
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); }
    await pg.waitForTimeout(900);
    await pg.click('#new-agent');
    await pg.waitForTimeout(700);
    /* ⚠️ THE MODEL FIELD IS ON THE SECOND STEP, and the first version of this
       check did not know that. Every element it looked for was in the DOM and
       every one measured 0x0, inside `#cstep-name[hidden]`. A check reading
       markup would have called all of this present and correct. Pick the
       recommended role, then Continue. */
    await pg.click('#pick-pm');
    await pg.waitForTimeout(300);
    await pg.click('#role-next');
    await pg.waitForTimeout(700);
    const onStep = await pg.evaluate(() => !document.getElementById('cstep-name').hidden);
    chk(onStep, theme + ': the second step of the create form is open');

    /* The hint is a promise about the NEXT screen, so the check is not that
       the sentence is present: it is that the screen it promises exists. A
       true-sounding sentence with no control behind it is the defect. */
    const hint = await pg.evaluate(() => {
      const p = [...document.querySelectorAll('#create-model')]
        .map((s) => s.closest('.field'))[0];
      const el = p && p.querySelector('p.shint');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
    });
    chk(hint && hint.w > 0 && hint.h > 0, theme + ': the model hint is drawn', JSON.stringify(hint));
    const canChange = await pg.evaluate(() => Boolean(
      document.getElementById('d-model') && document.getElementById('d-model-go'),
    ));
    chk(canChange, theme + ': the screen the hint promises has a model control');

    const shut = await pg.evaluate(() => {
      const d = document.querySelector('.smore');
      if (!d) return null;
      const li = [...d.querySelectorAll('li')].map((n) => n.textContent.trim());
      const sum = d.querySelector('summary').getBoundingClientRect();
      return { open: d.open, li, sumH: Math.round(sum.height), listH: Math.round(d.getBoundingClientRect().height) };
    });
    chk(shut && shut.open === false, theme + ': the disclosure starts closed');
    chk(shut && shut.sumH > 0, theme + ': the summary is drawn', shut && String(shut.sumH));
    /* 🛑 EM DASHES, READ OFF THE RENDERED TEXT. The pack specced these five
       lines with `&mdash;` in them, which is the one punctuation mark this
       house never ships. Reading the DOM catches the entity as the character
       it becomes, which a grep for `&mdash;` in the source would not. */
    const dashes = (shut ? shut.li : []).filter((t) => t.includes('—'));
    chk(dashes.length === 0, theme + ': no em dash reaches the rendered list', dashes.join(' | '));
    chk(shut && shut.li.length === 5, theme + ': five models are disclosed',
      shut && String(shut.li.length));

    await pg.click('.smore summary');
    await pg.waitForTimeout(300);
    const open = await pg.evaluate(() => {
      const d = document.querySelector('.smore');
      return { open: d.open, h: Math.round(d.getBoundingClientRect().height) };
    });
    chk(open.open === true && open.h > shut.listH,
      theme + ': clicking opens it and it takes more room', shut.listH + ' -> ' + open.h);

    /* A disclosure reachable by keyboard with no visible focus is an AA
       failure (2.4.7), and it is invisible to every check that reads text.
       🛑 REACHED BY ACTUAL KEYBOARD, and the first version of this check was
       not. Calling `.focus()` after a click leaves the browser's last
       interaction as a pointer, so `:focus-visible` correctly does not match
       and the rule reads `outline-style: none`. That looked exactly like a
       missing focus ring and it was the measurement that was wrong: the
       property under test is defined by how focus ARRIVED, so nothing but a
       real Tab can observe it. */
    const ring = await pg.evaluate(() => { document.getElementById('create-model').focus(); });
    void ring;
    await pg.keyboard.press('Tab');
    await pg.waitForTimeout(200);
    const ringNow = await pg.evaluate(() => {
      const el = document.querySelector('.smore summary');
      const st = getComputedStyle(el);
      return { w: st.outlineWidth, style: st.outlineStyle, focused: document.activeElement === el };
    });
    chk(ringNow.focused && ringNow.style !== 'none' && parseFloat(ringNow.w) >= 2,
      theme + ': the summary shows a focus ring when tabbed to', JSON.stringify(ringNow));

    chk(errs.length === 0, theme + ': no console errors', errs.slice(0, 2).join(' | '));
    await pg.screenshot({ path: 'docs/browser-checks/shots/model-more-' + theme + '.png' });
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED: ' + fail.join('; ') : '\nall green');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED', e.message); process.exit(2); });
