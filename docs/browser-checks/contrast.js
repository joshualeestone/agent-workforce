'use strict';

/**
 * Every visible piece of text clears the AA contrast floor, in both themes.
 *
 * 🛑 FOUR VERSIONS OF THIS WERE WRONG BEFORE ONE WAS RIGHT, and every wrong one
 * reported MORE failures than the truth. That is the interesting part, because
 * a contrast checker's false positives are indistinguishable from findings:
 * each came with a number, an element and a ratio, and each was rubbish.
 *
 *   1. it treated ANY alpha above zero as an opaque background, so a 5% ink
 *      over white measured as near-black on near-black and reported the theme
 *      picker at 1.00, on a control that is plainly legible
 *   2. it measured `color: rgba(0,0,0,0)` on a tick whose mark is drawn in CSS,
 *      comparing nothing against nothing and calling it 1.00
 *   3. it counted `.vh` spans, which are visually hidden by a 1px clip and so
 *      still have a bounding box, and reported screen-reader-only text as
 *      unreadable
 *   4. its light/dark split was a loose pattern that put a dark token in the
 *      light bucket and measured white on white
 *
 * 🔑 WHAT SURVIVED IS THE ONLY VERSION WHOSE ARITHMETIC IS CHECKED. The control
 * below asserts black on white is exactly 21, which is the maximum the formula
 * can produce and the one value that cannot come out right by accident, and
 * that a 5% ink over white is near 1.0 rather than near 21, which is the alpha
 * bug specifically.
 *
 * ⚠️ WHAT IT DOES NOT DO: it reads the composited colours the browser reports,
 * so it cannot see text over an image or a gradient, and it takes the nearest
 * opaque ancestor as the ground, which is wrong for anything positioned over
 * something it is not descended from. Both would show up as a pass.
 *
 * Run against a sandboxed board (never the operator's real data):
 *
 *   AGENT_WORKFORCE_DATA=/tmp/contrast PORT=17390 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17390 node docs/browser-checks/contrast.js
 *
 * ⚠️ HEADED by default, like its neighbours. `HEADED=0` on a machine with no
 * console session.
 */

const { chromium } = require('playwright');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17390';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const SCAN = () => {
  const parse = (c) => { const m = String(c).match(/[\d.]+/g); return m ? { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 } : null; };
  const lum = (c) => { const f = [c.r, c.g, c.b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const over = (top, under) => ({ r: top.a * top.r + (1 - top.a) * under.r, g: top.a * top.g + (1 - top.a) * under.g, b: top.a * top.b + (1 - top.a) * under.b, a: 1 });
  const ratio = (fg, bg) => { const L1 = lum(fg), L2 = lum(bg); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };

  /* Lesson 1: composite every translucent layer down to the first opaque one,
     in order, rather than stopping at the first with any alpha at all. */
  const groundOf = (el) => {
    const stack = []; let n = el;
    while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } n = n.parentElement; }
    if (!stack.length || stack[stack.length - 1].a !== 1) stack.push(parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 });
    let base = stack.pop();
    while (stack.length) base = over(stack.pop(), base);
    return base;
  };

  const out = { checked: 0, skipped: 0, bad: [], control: {} };
  document.querySelectorAll('body *').forEach((el) => {
    if (el.children.length) return;
    const text = (el.textContent || '').trim();
    if (!text) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return;
    /* Lesson 3: visually-hidden text has a box. Detected by the CLIP so a
       second implementation of the technique is caught too, not by class. */
    if (r.width <= 2 || r.height <= 2) { out.skipped += 1; return; }
    if (/inset\(\s*50%|rect\(\s*0/.test(cs.clipPath || cs.clip || '')) { out.skipped += 1; return; }
    const fg = parse(cs.color);
    /* Lesson 2: transparent text is not text, and neither is a decorative
       glyph the sentence beside it already states. */
    if (!fg || fg.a === 0) { out.skipped += 1; return; }
    if (el.closest('[aria-hidden="true"]')) { out.skipped += 1; return; }

    const bg = groundOf(el);
    out.checked += 1;
    const got = ratio(fg.a === 1 ? fg : over(fg, bg), bg);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    /* WCAG's large-text carve-out, which is 24px, or 18.66px when bold. */
    const need = (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;
    if (got < need - 0.005) out.bad.push(JSON.stringify(text.slice(0, 34)) + ' ' + got.toFixed(2) + '/' + need + ' ' + px + 'px' + (bold ? ' bold' : ''));
  });

  /* 🔑 THE ARITHMETIC, CHECKED IN THE PAGE where it runs rather than reasoned
     about here. Every finding above is an inequality, and an inequality is
     satisfied by a formula returning a large number for everything. */
  const W = { r: 255, g: 255, b: 255, a: 1 }, K = { r: 0, g: 0, b: 0, a: 1 };
  out.control.blackOnWhite = ratio(K, W);
  out.control.whiteOnWhite = ratio(W, W);
  out.control.faintInkOnWhite = ratio(over({ r: 20, g: 22, b: 26, a: 0.05 }, W), W);
  return out;
};

const SURFACES = [
  ['agents', null],
  ['agent panel', '.acard .namego'],
  ['projects', 'PROJECTS'],
  ['settings', 'SETTINGS'],
];

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    for (const [name, go] of SURFACES) {
      const pg = await b.newPage({ viewport: { width: 1400, height: 1200 }, colorScheme: theme });
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForTimeout(2200);
      if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(600); }
      let reached = true;
      try {
        if (go === 'SETTINGS') await pg.evaluate(() => showTab('settings'));
        else if (go === 'PROJECTS') await pg.evaluate(() => showTab('projects'));
        else if (go) await pg.locator(go).first().click();
      } catch (e) { reached = false; chk(false, theme + ' ' + name + ': could not be reached, so it was not checked', e.message.slice(0, 60)); }
      if (reached) {
        await pg.waitForTimeout(1400);
        const r = await pg.evaluate(SCAN);
        /* The control first: if the arithmetic is wrong nothing below means
           anything, and a broken formula usually produces a clean sweep. */
        chk(Math.round(r.control.blackOnWhite) === 21 && Math.round(r.control.whiteOnWhite) === 1
          && r.control.faintInkOnWhite < 1.3,
        theme + ' ' + name + ': the contrast arithmetic is right',
        JSON.stringify(r.control));
        chk(r.checked > 0, theme + ' ' + name + ': found text to check', String(r.checked));
        chk(r.bad.length === 0, theme + ' ' + name + ': every visible text clears AA', r.bad.slice(0, 4).join(' | '));
      }
      await pg.close();
    }
  }
  await b.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED: ' + fail.join('; ') : '\nall green');
  console.log('\nKNOWN AND NOT FIXED: the Settings status ticks (.chk-m) measure 2.78 '
    + 'in light. They are gold on a gold tint, the sentence beside each states the '
    + 'same thing, and whether they are exempt is a design ruling rather than a '
    + 'measurement. They are excluded here by nothing: if they still fail, they '
    + 'will show above.');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED', e.message); process.exit(2); });
