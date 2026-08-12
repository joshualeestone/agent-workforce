/* The agent detail panel calls the instructions a "special purpose", and names
 * no file.
 *
 * WHY THIS IS RENDERED. The defect is not logical, it is what a person reads, and
 * the specific risk is a filename surviving somewhere on screen. A grep over the
 * source cannot tell a user-facing string from a code comment, and this file has
 * both. So the page is opened and its VISIBLE TEXT is swept.
 *
 * ⚠️ The second reason the filename must go is not readability, it is that it is
 * about to be WRONG: Codex uses AGENTS.md, so any label spelling out CLAUDE.md
 * becomes a lie on a non-Claude agent. That is why the sweep looks for the
 * pattern, not just the one string.
 *
 * Run: see the README in this directory.
 */
'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:4416';
const SHOTS = process.argv[3] || '/tmp/spshots';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  // The deep link this file supports, so the panel can be seen without a live agent.
  await page.goto(BASE + '/?tab=detail', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  const seen = await page.evaluate(() => {
    const label = document.querySelector('label[for="d-instr"]');
    const hint = label && label.nextElementSibling;
    const foot = document.getElementById('d-instr-foot');
    const prev = document.getElementById('d-instr-prev');
    const cs = foot ? getComputedStyle(foot) : null;

    /* ⚠️ VISIBLE text only. `innerText` respects display and hidden, which is
       what makes this different from grepping the file: a filename inside a code
       comment is not on screen, and one inside a hidden element is not either. */
    const visible = (document.body.innerText || '').replace(/\s+/g, ' ');

    return {
      label: label ? label.textContent.trim() : null,
      hint: hint ? hint.textContent.trim() : null,
      footHTML: foot ? foot.textContent.trim() : null,
      prevText: prev ? prev.textContent.trim() : null,
      footFont: cs ? cs.fontSize : null,
      footColor: cs ? cs.color : null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      visible,
    };
  });

  check('the label calls it a special purpose',
    /special purpose/i.test(seen.label || ''), JSON.stringify(seen.label));

  /* ⚠️ THE PATTERN, not the one string. `CLAUDE.md` is today's name; the point is
     that no per-provider filename should reach the screen at all. */
  const FILENAME = /\b[A-Z_]{3,}\.md\b|\bagents\.md\b|\bsoul\.md\b/i;
  check('no agent-instruction filename appears in the visible text',
    !FILENAME.test(seen.visible),
    (seen.visible.match(FILENAME) || []).join(', ') || 'none found');

  check('the "previous version" note names no file',
    seen.prevText !== null && !FILENAME.test(seen.prevText), JSON.stringify(seen.prevText));

  /* CONTROL: the sweep really did read the panel, or an empty page passes for
     the wrong reason. */
  check('CONTROL: the panel is actually on screen',
    /special purpose/i.test(seen.visible), `${seen.visible.length} chars of visible text`);

  /* The path is DEMOTED, not deleted: it must still be there, and still legible. */
  check('the file location is still offered, in mouse print',
    (seen.footHTML || '').length > 0 && /edit by hand/i.test(seen.footHTML || ''),
    JSON.stringify(seen.footHTML));

  const parse = (v) => { const n = (v.match(/[\d.]+/g) || []).map(Number); return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }; };
  const over = (f, b) => f.rgb.map((c, i) => Math.round(c * f.a + b.rgb[i] * (1 - f.a)));
  const lum = (c) => { const f = c.map((x) => { const t = x / 255; return t <= 0.03928 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const fg = over(parse(seen.footColor), parse(seen.bodyBg));
  const bg = parse(seen.bodyBg).rgb;
  const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);

  /* ⚠️ Mouse print is still text somebody has to be able to read. It got SMALLER
     in importance, not smaller in legibility, and it is now the only place the
     file is named, so it cannot be decorative. */
  check('the mouse print still meets AA', ratio >= 4.5,
    `${ratio.toFixed(2)}:1 at ${seen.footFont}`);

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));

  await page.screenshot({ path: path.join(SHOTS, 'special-purpose.png') });
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots in ${SHOTS}`);
  if (failed.length) { failed.forEach((f) => console.log('  - ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
