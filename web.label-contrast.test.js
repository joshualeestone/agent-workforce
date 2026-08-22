'use strict';

/**
 * The quietest text token clears AA against the darkest ground it sits on.
 *
 * 🛑 IT DID NOT. `--label-3` measured 3.24 in light and 4.09 in dark as 12px
 * body text, against a 4.5 floor, on sixteen rules including an agent's role
 * line, the making-an-agent status glyphs, a project member's role and the
 * restart consequence hint. Readable content rather than chrome, which is why
 * the text floor applies rather than the 3:1 one for graphics.
 *
 * 🔑 IT COMPUTES THE RATIO FROM THE DECLARED TOKENS rather than matching the
 * strings. A test pinning `rgba(20,22,26,0.61)` passes on any future value
 * somebody types, including a worse one; this one fails on the property. The
 * arithmetic is the WCAG relative-luminance formula, and translucent colours
 * are composited onto the ground rather than treated as opaque, which is the
 * bug that made my first sweep report a plainly legible control at 1.00.
 *
 * ⚠️ AGAINST THE WORST GROUND IN EACH THEME, which is the correction Mona Lisa
 * made to my first numbers. I computed dark against `--k-bg`; panels are
 * `--k-surface`, which is LIGHTER, so the alpha that cleared 4.5 on the page
 * background failed by 0.04 where the text actually lives.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* ⚠️ ONE PARSER FOR BOTH SHAPES. The tokens are a mix: `--label-3` is `rgba()`
   and `--k-bg` is a hex triple, and a helper that handled only one threw
   "not a colour" on a perfectly good value, which reads like a missing token
   rather than a narrow parser. */
const colour = (s) => {
  const t = String(s).trim();
  if (t.startsWith('#')) {
    return { r: parseInt(t.slice(1, 3), 16), g: parseInt(t.slice(3, 5), 16), b: parseInt(t.slice(5, 7), 16), a: 1 };
  }
  const m = t.match(/[\d.]+/g);
  assert.ok(m && m.length >= 3, 'not a colour: ' + s);
  return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
};
const rgb = colour;
const hex = colour;
const lum = (c) => {
  const f = [c.r, c.g, c.b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};
const over = (top, under) => ({
  r: top.a * top.r + (1 - top.a) * under.r,
  g: top.a * top.g + (1 - top.a) * under.g,
  b: top.a * top.b + (1 - top.a) * under.b, a: 1,
});
const ratio = (fg, bg) => {
  const L1 = lum(fg.a === 1 ? fg : over(fg, bg));
  const L2 = lum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};

/* Read out of the page, never restated: a copy of a token goes stale the day
   somebody edits the real one, and this test would then be measuring a colour
   the product does not use. */
function decls(name) {
  const found = [...PAGE.matchAll(new RegExp('--' + name + ':\\s*(rgba\\([^)]*\\)|#[0-9a-fA-F]{6})', 'g'))].map((m) => m[1]);
  assert.ok(found.length, '--' + name + ' is not declared anywhere');
  return found;
}

test('every --label-3 declaration clears 4.5 on the worst ground in its theme', () => {
  const all = decls('label-3');
  const light = all.filter((c) => c.startsWith('rgba(20,'));
  const dark = all.filter((c) => c.startsWith('rgba(255,'));
  assert.ok(light.length && dark.length,
    'the light/dark split stopped working, so this test is measuring one theme twice');
  /* ⚠️ EXHAUSTIVE, and the first version was not. A loose pattern put the DARK
     token in the light bucket and measured white on white at 1.00, which reads
     as a catastrophic failure and was a bad filter. Worse than a false alarm:
     any declaration matching NEITHER pattern would have been silently unchecked,
     which is the shape that lets a token slip through a guard written for it. */
  assert.equal(light.length + dark.length, all.length,
    'a --label-3 declaration matched neither theme and was not checked: '
    + all.filter((c) => !light.includes(c) && !dark.includes(c)).join(', '));

  /* The worst ground each theme puts this text on: white and the panel surface.
     `--k-surface` in dark is lighter than `--k-bg`, so it is the harder one. */
  const grounds = {
    light: [hex('#ffffff'), rgb(decls('k-bg')[0])],
    dark: [rgb(decls('k-surface').find((c) => c.startsWith('#17')) || '#17191c'), hex('#0c0d0f')],
  };

  for (const [theme, colours] of [['light', light], ['dark', dark]]) {
    for (const c of colours) {
      for (const g of grounds[theme]) {
        const r = ratio(rgb(c), g);
        assert.ok(r >= 4.5, theme + ' --label-3 ' + c + ' is ' + r.toFixed(2)
          + ' on rgb(' + [g.r, g.g, g.b].join(',') + '), below the 4.5 floor for body text');
      }
    }
  }
});

test('the arithmetic is right, checked against a pair with a known answer', () => {
  /* 🔑 THE CONTROL. Every assertion above is an inequality, and an inequality
     is satisfied by a formula that returns a large number for everything.
     Black on white is exactly 21, which is the maximum the formula can produce
     and the one value that cannot come out right by accident. */
  assert.equal(Math.round(ratio(hex('#000000'), hex('#ffffff'))), 21);
  assert.equal(Math.round(ratio(hex('#ffffff'), hex('#ffffff'))), 1);
  /* And translucency is composited rather than treated as opaque, which is the
     bug that made a 5% tint over white measure as near-black on near-black. */
  const faint = ratio({ r: 20, g: 22, b: 26, a: 0.05 }, hex('#ffffff'));
  assert.ok(faint < 1.3, 'a 5% ink over white measured as ' + faint.toFixed(2) + ', so alpha is being ignored');
});

test('label-3 still recedes, which is the reason it exists', () => {
  /* Raising it for AA must not collapse the scale into label-2. Measured on
     white: the gap stays close to a factor of two. */
  const white = hex('#ffffff');
  const l2 = decls('label-2').find((c) => c.startsWith('rgba(20,')) || decls('label-2')[0];
  const l3 = decls('label-3').find((c) => c.startsWith('rgba(20,'));
  const r2 = ratio(rgb(l2), white), r3 = ratio(rgb(l3), white);
  assert.ok(r3 >= 4.5, 'label-3 is ' + r3.toFixed(2));
  assert.ok(r2 > r3 * 1.4,
    'label-3 (' + r3.toFixed(2) + ') has crept up to label-2 (' + r2.toFixed(2) + '), so the level stopped meaning anything');
});
