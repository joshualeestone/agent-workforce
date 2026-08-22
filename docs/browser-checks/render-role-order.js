/**
 * The three role options, in Josh's order, with the menu opening between the
 * second and the third -- and the keyboard behaviour that is now the browser's.
 *
 * 🔑 WHY A BROWSER AND NOT A SOURCE TEST. What this pins is that three radio
 * inputs form ONE group by sharing a name while a `<div>` sits between two of
 * them. That is a fact about the platform's grouping, not about our markup: a
 * source assertion could confirm the three `name="rmode"` attributes and say
 * nothing at all about whether arrowing moves between them or whether checking
 * the third clears the first.
 *
 * ⚠️ AND IT RUNS IN WEBKIT AS WELL AS CHROMIUM, which is not optional here.
 * Kosmos opens the DEFAULT browser, which on a stock Mac is Safari. The
 * selected-row styling is now `:has(input:checked)` -- if `:has` did not
 * resolve, every option would look unselected forever while the form worked
 * perfectly, and a Chromium-only run would report that as fine.
 *
 * ⚠️ IT ASSERTS THE ROW IS PAINTED BEFORE IT ASSERTS WHERE THE ROW IS. A
 * hidden element reports a bottom of 0, which is above everything, so "the menu
 * is under its own option" is VACUOUSLY true of a menu that is not there. That
 * is not a hypothetical: it is how a sibling check in this directory passed
 * with its paint deleted, on 2026-08-22.
 *
 * Needs a sandbox with first run already complete -- see the README.
 *
 * Run: see the README in this directory.
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* Painted and reachable, asked of the ELEMENT rather than of its rectangle. */
const LIVE = `(el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > 0;
}`;

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

    await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
    await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });

    /* --- one group, by name, across a non-radio sibling ------------------ */
    const shape = await page.evaluate(() => {
      const ins = Array.from(document.querySelectorAll('input[name="rmode"]'));
      const menu = document.getElementById('rolepick');
      return {
        count: ins.length,
        values: ins.map((i) => i.value),
        /* The document order of the four things that have to be in this order. */
        order: Array.from(document.querySelectorAll('#pick-pm, #pick-list, #rolepick, #pick-own'))
          .map((n) => n.id),
        /* Every radio is inside the fieldset, and so is the menu. */
        allInFieldset: ins.every((i) => i.closest('fieldset.pickradios')),
        menuInFieldset: Boolean(menu.closest('fieldset.pickradios')),
        /* Nothing hand-rolls the role or its state any more. */
        strayRoles: document.querySelectorAll('#roles-list [role="radio"], #roles-list [role="radiogroup"]').length,
        strayAria: document.querySelectorAll('#roles-list [aria-checked]').length,
        legend: (document.querySelector('fieldset.pickradios legend') || {}).textContent || null,
      };
    });

    check(`[${engine}] three radios share one name`, shape.count === 3, shape.values.join(', '));
    check(`[${engine}] Josh's order, with the menu between the second and third`,
      shape.order.join(' > ') === 'pick-pm > pick-list > rolepick > pick-own',
      shape.order.join(' > '));
    check(`[${engine}] the menu is INSIDE the group, which is the whole point`,
      shape.allInFieldset && shape.menuInFieldset);
    check(`[${engine}] no hand-rolled radio role or aria-checked is left`,
      shape.strayRoles === 0 && shape.strayAria === 0,
      `roles=${shape.strayRoles} aria-checked=${shape.strayAria}`);
    check(`[${engine}] the group is still named`, /what this agent is for/i.test(shape.legend || ''),
      JSON.stringify(shape.legend));

    /* --- checking the third clears the first, across the sibling --------- */
    await page.click('#pick-pm');
    const afterPm = await page.evaluate(() => document.querySelector('input[name="rmode"]:checked').value);
    await page.click('#pick-own');
    const afterOwn = await page.evaluate(() => ({
      checked: Array.from(document.querySelectorAll('input[name="rmode"]:checked')).map((i) => i.value),
    }));
    check(`[${engine}] choosing one clears the other, across the menu between them`,
      afterPm === 'pm' && afterOwn.checked.length === 1 && afterOwn.checked[0] === 'own',
      `pm -> ${afterPm}, own -> ${afterOwn.checked.join(',')}`);

    /* --- the menu opens in place and pushes the third option down -------- */
    const before = await page.evaluate(() => document.getElementById('pick-own').getBoundingClientRect().top);
    await page.click('#pick-list');
    await page.waitForTimeout(200);
    const open = await page.evaluate((liveSrc) => {
      const live = eval(liveSrc);
      const menu = document.getElementById('rolepick');
      const list = document.getElementById('pick-list');
      const own = document.getElementById('pick-own');
      return {
        menuLive: live(menu),
        menuTop: menu.getBoundingClientRect().top,
        listBottom: list.getBoundingClientRect().bottom,
        ownTop: own.getBoundingClientRect().top,
      };
    }, LIVE);

    /* Liveness FIRST. Everything below is geometry, and geometry is happy to
       describe an element that is not on the screen. */
    check(`[${engine}] the menu is actually painted`, open.menuLive);
    check(`[${engine}] it opens directly under its own option`,
      open.menuLive && open.menuTop >= open.listBottom - 1,
      `option ends ${Math.round(open.listBottom)}, menu starts ${Math.round(open.menuTop)}`);
    check(`[${engine}] and it pushes the third option down rather than covering it`,
      open.menuLive && open.ownTop > before + 20,
      `describe-it-yourself moved ${Math.round(open.ownTop - before)}px`);

    /* --- the styling the platform now drives ---------------------------- */
    const paint = await page.evaluate(() => {
      const on = getComputedStyle(document.getElementById('pick-list'));
      const off = getComputedStyle(document.getElementById('pick-pm'));
      return { on: on.borderTopColor + ' ' + on.boxShadow, off: off.borderTopColor + ' ' + off.boxShadow };
    });
    /* 🛑 THE ONE THAT MATTERS IN WEBKIT: `:has(input:checked)` is the only thing
       marking the chosen row now. If it does not resolve, both rows compute the
       same border and the form silently loses its selected state. */
    check(`[${engine}] the chosen row looks different from an unchosen one`,
      paint.on !== paint.off, `${paint.on}  vs  ${paint.off}`);

    /* --- the keyboard, which is no longer our code ----------------------- */
    /* ⚠️ FOCUSED, NOT CLICKED, AND THAT IS A REAL PLATFORM DIFFERENCE RATHER
       THAN A TEST CONVENIENCE. On macOS a click on a radio does not move
       keyboard focus to it unless Full Keyboard Access is on, so in WebKit the
       arrow press after a click went nowhere and this check read as "native
       grouping does not work in Safari". It works; the click had simply left
       focus elsewhere. A keyboard user arrives here by Tab, which does focus
       the checked radio, so this is the sequence a keyboard user performs. */
    await page.evaluate(() => document.querySelector('input[name="rmode"][value="pm"]').focus());
    await page.evaluate(() => { document.querySelector('input[name="rmode"][value="pm"]').checked = true; });
    const focused = await page.evaluate(() => {
      const a = document.activeElement;
      return Boolean(a && a.name === 'rmode' && a.value === 'pm');
    });
    check(`[${engine}] the radio can hold keyboard focus`, focused);
    await page.keyboard.press('ArrowDown');
    const arrowed = await page.evaluate(() => ({
      value: (document.querySelector('input[name="rmode"]:checked') || {}).value,
      picked: typeof PICKED === 'undefined' ? null : PICKED,
      nextEnabled: !document.getElementById('role-next').disabled,
    }));
    check(`[${engine}] arrowing moves to the next option with no code of ours`,
      arrowed.value === 'list', `now ${arrowed.value}`);
    /* The app's own state has to follow the browser's, or Continue creates the
       previous choice. */
    check(`[${engine}] and the app followed it`, arrowed.nextEnabled && arrowed.picked && arrowed.picked !== 'pm',
      `PICKED=${arrowed.picked}`);

    check(`[${engine}] no page errors`, errors.length === 0, errors.join(' | ').slice(0, 160));
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  - ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
