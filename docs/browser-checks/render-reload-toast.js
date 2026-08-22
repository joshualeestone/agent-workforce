'use strict';

/**
 * The reload toast, rendered in both tones beside the one it must not look
 * like (#270).
 *
 * 🔑 THE CLAIM IS A COMPARISON, so both states are captured in one run: the
 * shipped offer toast is red and earns it, and the reload state must read as
 * neutral. A check that only rendered the new one could pass on a toast painted
 * the same alarming red as the thing it is not.
 *
 * The page's own poll decides which state to draw, and neither is reachable
 * against a healthy local board (the baked version and the served version
 * agree, which is the point of a real install). So the states are driven the
 * way the page drives them: by calling the renderer with the globals set.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/rt PORT=17371 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17371 node docs/browser-checks/render-reload-toast.js /tmp/rtshots
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17371';
const OUT = process.argv[2] || '/tmp/rtshots';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* WCAG: 3:1 for a graphical boundary, 4.5:1 for the sentence. */
function lum(c) {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
function rgb(s) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s);
  if (!m) return null;
  return { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
}
function over(fg, bg) {
  /* A translucent label composited on its own background, because measuring the
     declared colour of a 0.62-alpha white would report a contrast nobody sees. */
  return fg.c.map((v, i) => v * fg.a + bg.c[i] * (1 - fg.a));
}

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 700 }, colorScheme: theme });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(800);

    for (const state of ['offer', 'stale']) {
      /* Drive the page's own renderer, with the globals the poll would set. */
      await pg.evaluate(([s]) => {
        // eslint-disable-next-line no-undef
        SERVED_VERSION = s === 'stale' ? '9.9.9' : null;
        const meta = document.querySelector('meta[name="kosmos-version"]');
        if (meta && s === 'stale') meta.setAttribute('content', '0.0.1');
        // eslint-disable-next-line no-undef
        document.getElementById('utoast-slot').innerHTML = '';
        // eslint-disable-next-line no-undef
        delete document.getElementById('utoast-slot').dataset.v;
        // eslint-disable-next-line no-undef
        renderUpdateToast(s === 'offer' ? { version: '9.9.9' } : null);
      }, [state]);
      await pg.waitForTimeout(250);

      const el = await pg.$('.utoast');
      chk(Boolean(el), theme + '/' + state + ': the toast is drawn');
      if (!el) continue;
      const box = await el.boundingBox();
      chk(Boolean(box && box.width > 150 && box.height > 20), theme + '/' + state + ': it has real size',
        box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'none');

      const seen = await pg.evaluate(() => {
        const t = document.querySelector('.utoast');
        const cs = getComputedStyle(t);
        const title = getComputedStyle(t.querySelector('.utxt b'));
        const small = getComputedStyle(t.querySelector('.utxt small'));
        return {
          border: cs.borderTopColor, bg: cs.backgroundColor,
          title: title.color, titleSize: title.fontSize,
          small: small.color, text: t.innerText,
          buttons: t.querySelectorAll('button').length,
        };
      });
      const bg = rgb(seen.bg);
      const border = rgb(seen.border);
      const title = rgb(seen.title);
      const small = rgb(seen.small);
      chk(ratio(over(border, bg), bg.c) >= 3, theme + '/' + state + ': the border clears 3:1',
        ratio(over(border, bg), bg.c).toFixed(2));
      chk(ratio(over(title, bg), bg.c) >= 4.5, theme + '/' + state + ': the title clears 4.5:1',
        ratio(over(title, bg), bg.c).toFixed(2));
      chk(ratio(over(small, bg), bg.c) >= 4.5, theme + '/' + state + ': the sentence clears 4.5:1',
        ratio(over(small, bg), bg.c).toFixed(2));

      if (state === 'stale') {
        chk(seen.buttons === 1, theme + ': one action and no dismiss', String(seen.buttons));
        chk(/Kosmos updated/.test(seen.text) && !/Install/i.test(seen.text),
          theme + ': it does not tell them to install what is installed');
      } else {
        chk(seen.buttons === 2, theme + ': the shipped toast still has Later and Install', String(seen.buttons));
      }
      await pg.screenshot({ path: path.join(OUT, 'toast-' + state + '-' + theme + '.png'), clip: { x: 0, y: 0, width: 700, height: 130 } });
    }
    chk(errs.length === 0, theme + ': no console errors', errs.join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
