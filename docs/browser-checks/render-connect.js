/* Browser check for the click-to-connect flow on first-run step 3.
 *
 * WHY A RENDERED CHECK. The connect panel is repainted every second by a poll,
 * holds an input a person types into mid-repaint, shows captured TERMINAL
 * output inside a styled block, and swaps button meanings per phase. Every one
 * of those is invisible to a test that reads source, and two of this repo's
 * worst defects (a transparent modal, an inert CSS rule) were exactly this
 * shape. So the states are rendered, driven, and photographed -- light and
 * dark.
 *
 * WHAT DRIVES WHAT: the none-state and the live click go through the REAL
 * routes (the server runs with DRY_RUN, so the click launches a driver that
 * runs no real programs). The other phases are painted by intercepting GET
 * /api/connect -- the painter and the page are real, the answer is scripted,
 * and the engine behind those answers has its own node tests.
 *
 * ⚠️ SANDBOX EVERY WRITE ROOT. Refuses to run against the operator's real
 * Claude config, proved by a READ of where the path resolves.
 *
 * Run: see the README in this directory. Args: BASE SHOTS CONFIG
 */
'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = process.argv[2] || 'http://127.0.0.1:4413';
const SHOTS = process.argv[3] || '/tmp/connectshots';
const CONFIG = process.argv[4];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* Same guard as render-connection.js: proved by where the path RESOLVES. */
const REAL = path.join(os.homedir(), '.claude.json');
if (!CONFIG || path.resolve(CONFIG) === path.resolve(REAL)) {
  console.error('REFUSING: pass a sandboxed config path.');
  process.exit(2);
}
const realTemp = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const TEMP_ROOTS = [os.tmpdir(), '/tmp', '/private/tmp'].map(realTemp);
const target = realTemp(path.dirname(path.resolve(CONFIG)));
if (!TEMP_ROOTS.some((root) => target === root || target.startsWith(root + path.sep))) {
  console.error(`REFUSING: ${CONFIG} resolves to ${target}, which is not under any of ${TEMP_ROOTS.join(', ')}`);
  process.exit(2);
}

const FREE = { oauthAccount: { organizationType: 'claude_free' } };
fs.writeFileSync(CONFIG, JSON.stringify(FREE, null, 2), 'utf8');

/* Shared contrast math, composited over the real ground -- the 3.5% wash
   lesson from render-connection.js applies to every colour read here. */
const parse = (v) => { const n = (String(v).match(/[\d.]+/g) || []).map(Number); return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }; };
const over = (fgc, bgc) => fgc.rgb.map((c, i) => Math.round(c * fgc.a + bgc.rgb[i] * (1 - fgc.a)));
const lum = (c) => { const f = c.map((x) => { const t = x / 255; return t <= 0.03928 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratioOf = (fgV, bgV, groundV) => {
  const ground = parse(groundV);
  const bg = over(parse(bgV), ground);
  const fg = over(parse(fgV), { rgb: bg, a: 1 });
  return (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
};

const LONG_TAIL = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of what the terminal actually printed`).join('\n');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const headless = process.env.HEADED === '0';
  const browser = await chromium.launch({ headless });

  async function step3Page(ctx, stub) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    if (stub) {
      await page.route('**/api/connect', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(stub) });
        } else route.continue();
      });
    }
    await page.goto(`${BASE}/?first-run=1&fr-step=3`, { waitUntil: 'load' });
    await page.waitForTimeout(1400);   // step paint + one poll tick
    /* ⚠️ THE SCREEN GUARD, inverted from render-connection.js: HERE the wizard
       must be up, at step 3, or every assertion below reads a hidden panel and
       every screenshot is of the wrong screen. */
    const where = await page.evaluate(() => {
      const el = document.getElementById('firstrun');
      const vis = el && !el.hidden && el.getBoundingClientRect().height > 0;
      return { vis, step: (document.getElementById('fr-step') || {}).textContent };
    });
    if (!where.vis || !/Step 3/.test(where.step || '')) {
      throw new Error(`not on step 3 (visible=${where.vis}, "${where.step}") -- everything after this would be evidence of the wrong screen`);
    }
    return { page, errors };
  }

  /* ── 1. the none state offers the connect click, through the real route ── */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await step3Page(ctx, null);

    const buttons = await page.evaluate(() => ({
      primary: document.getElementById('fr-next').textContent,
      alt: document.getElementById('fr-alt').textContent,
      altHidden: document.getElementById('fr-alt').hidden,
    }));
    check('[none] the primary action is Connect Claude', buttons.primary === 'Connect Claude', JSON.stringify(buttons));
    check('[none] the way past is still there', !buttons.altHidden && buttons.alt === 'Continue anyway', JSON.stringify(buttons));
    await page.screenshot({ path: path.join(SHOTS, 'connect-1-none.png') });

    /* The real click, against the real POST route. DRY_RUN on the server makes
       the driver inert (blank pane), so the flow parks at a sign-in phase. */
    await page.click('#fr-next');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({
      box: document.getElementById('fr-sub').textContent,
      alt: document.getElementById('fr-alt').textContent,
    }));
    check('[click] the click starts a live flow through the real route',
      /Getting the sign-in ready|browser has opened/i.test(after.box), after.box.slice(0, 90));
    check('[click] Cancel appears once a flow is live', after.alt === 'Cancel', after.alt);
    await page.screenshot({ path: path.join(SHOTS, 'connect-2-launching.png') });

    /* Cancel through the real route, and the screen comes back honest. */
    await page.click('#fr-alt');
    await page.waitForTimeout(1200);
    const back = await page.evaluate(() => document.getElementById('fr-sub').textContent);
    check('[cancel] cancelling lands back on the plain verdict',
      /No Claude subscription is connected yet/i.test(back), back.slice(0, 90));
    check('[none] no page errors through click and cancel', errors.length === 0, errors.join(' | ').slice(0, 160));
    await ctx.close();
  }

  /* ── 2. downloading: the bar tracks the numbers on screen ───────────────── */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await step3Page(ctx, {
      phase: 'downloading', progress: { got: 52428800, total: 104857600 },
    });
    const got = await page.evaluate(() => {
      const fill = document.getElementById('fr-conn-fill');
      const bar = fill && fill.parentElement;
      const fr = fill.getBoundingClientRect(); const br = bar.getBoundingClientRect();
      return {
        text: document.getElementById('fr-conn-prog').textContent,
        frac: br.width ? fr.width / br.width : 0,
        visible: fr.height > 0,
      };
    });
    check('[downloading] the numbers are on screen', /50MB of 100MB/.test(got.text), got.text);
    /* ⚠️ Found by LOOKING at the screenshot, not by any assertion: the phase
       announcement rendered visibly under a title that already said it.
       "Downloading Claude" must appear ONCE in what a sighted person sees. */
    const visibleSays = await page.evaluate(() => {
      const pane = document.getElementById('fr-pane-3');
      const vh = pane.querySelector('.vh');
      const visible = pane.textContent.replace(vh ? vh.textContent : '', '');
      return (visible.match(/Downloading Claude/g) || []).length;
    });
    check('[downloading] the panel does not say the same thing twice', visibleSays === 1,
      `"Downloading Claude" appears ${visibleSays} times in visible text`);
    check('[downloading] the phase is still announced for screen readers',
      await page.evaluate(() => {
        const say = document.getElementById('fr-conn-say');
        return say && /Downloading Claude/.test(say.textContent) && getComputedStyle(say).position === 'absolute';
      }));
    /* ⚠️ wanted-vs-got on the GEOMETRY, not the style attribute: a style of
       "width:50%" on an element whose parent collapsed renders as nothing. */
    check('[downloading] the bar half-fills, measured on screen',
      got.visible && Math.abs(got.frac - 0.5) < 0.02, `filled ${(got.frac * 100).toFixed(1)}% of the track`);
    check('[downloading] no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
    await page.screenshot({ path: path.join(SHOTS, 'connect-3-downloading.png') });
    await ctx.close();
  }

  /* ── 3. awaiting-code: the input is usable and typing survives the poll ── */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const sent = [];
    const { page, errors } = await step3Page(ctx, {
      phase: 'signin-awaiting-code',
      url: 'https://claude.com/cai/oauth/authorize?code=true&state=check',
    });
    await page.route('**/api/connect/code', (route) => {
      sent.push(route.request().postDataJSON());
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    check('[code] the fallback sign-in link is on screen and real',
      await page.evaluate(() => {
        const a = document.querySelector('#fr-sub a');
        return a && a.href.startsWith('https://claude.com/cai/oauth/authorize') && a.target === '_blank';
      }));

    /* Type slowly across MORE THAN ONE POLL TICK: the poll repaints on the
       same phase, and the defect this guards is the input emptying under the
       person's cursor. Wanted-vs-got on the field's actual value. */
    const code = 'abCD1234#efGH5678';
    await page.click('#fr-conn-code');
    for (const ch of code) { await page.keyboard.type(ch); await page.waitForTimeout(90); }
    const held = await page.inputValue('#fr-conn-code');
    check('[code] typing survives at least one repaint tick', held === code,
      `wanted "${code}", field holds "${held}"`);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    check('[code] Enter submits what was typed', sent.length === 1 && sent[0] && sent[0].code === code,
      JSON.stringify(sent));

    /* Keyboard reachability, asserted by FOCUS ARRIVING, not by properties an
       enabled input always has -- the first version of this check could not
       fail. Focus lands (visible, enabled, tabIndex !== -1 all required for
       focus() to take), and Tab moves OFF it, proving it sits in the order. */
    const reachable = await page.evaluate(() => {
      const input = document.getElementById('fr-conn-code');
      input.blur();
      input.focus();
      return document.activeElement === input && input.tabIndex !== -1;
    });
    check('[code] focus actually lands on the input', reachable);
    await page.keyboard.press('Tab');
    check('[code] Tab moves focus onward, so it is in the tab order',
      await page.evaluate(() => document.activeElement && document.activeElement.id === 'fr-conn-code-go'));

    check('[code] no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
    await page.screenshot({ path: path.join(SHOTS, 'connect-4-awaiting-code.png') });
    await ctx.close();
  }

  /* ── 4. stuck: honest, contained, and AA in both themes ─────────────────── */
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const { page, errors } = await step3Page(ctx, {
      phase: 'stuck',
      because: 'Claude showed a screen we do not recognise',
      tail: LONG_TAIL,
    });
    const got = await page.evaluate(() => {
      const box = document.getElementById('fr-sub');
      const tail = box.querySelector('.fr-conn-tail');
      const t = tail.getBoundingClientRect();
      const cs = getComputedStyle(tail);
      const title = box.querySelector('.fr-ctitle');
      const tcs = title ? getComputedStyle(title) : null;
      return {
        text: box.textContent,
        tailShown: t.height > 0,
        tailScrolls: tail.scrollHeight > tail.clientHeight + 5,
        tailHeight: tail.clientHeight,
        tailColor: cs.color, tailBg: cs.backgroundColor,
        titleColor: tcs && tcs.color,
        pageBg: getComputedStyle(document.body).backgroundColor,
        buttons: {
          primary: document.getElementById('fr-next').textContent,
          alt: document.getElementById('fr-alt').textContent,
        },
      };
    });
    check(`[stuck ${scheme}] says why, in the panel`, /do not recognise/.test(got.text), got.text.slice(0, 90));
    check(`[stuck ${scheme}] the manual path is offered`, /open Terminal/i.test(got.text));
    check(`[stuck ${scheme}] 40 lines of terminal are contained, not a 40-line dialog`,
      got.tailShown && got.tailScrolls && got.tailHeight < 200,
      `clientHeight=${got.tailHeight}, scrolls=${got.tailScrolls}`);
    check(`[stuck ${scheme}] a way to retry and a way past`,
      got.buttons.primary === 'Try again' && got.buttons.alt === 'Continue anyway', JSON.stringify(got.buttons));
    const tailRatio = ratioOf(got.tailColor, got.tailBg, got.pageBg);
    check(`[stuck ${scheme}] the terminal tail meets AA`, tailRatio >= 4.5, `${tailRatio.toFixed(2)}:1`);
    const titleRatio = ratioOf(got.titleColor, 'rgba(0,0,0,0)', got.pageBg);
    check(`[stuck ${scheme}] the title meets AA`, titleRatio >= 4.5, `${titleRatio.toFixed(2)}:1`);
    check(`[stuck ${scheme}] no page errors`, errors.length === 0, errors.join(' | ').slice(0, 160));
    await page.screenshot({ path: path.join(SHOTS, `connect-5-stuck-${scheme}.png`) });
    await ctx.close();
  }

  /* ── 5. interrupted: an honest restart offer, not a fake progress bar ──── */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await step3Page(ctx, {
      phase: 'interrupted', before: 'downloading',
    });
    const got = await page.evaluate(() => ({
      text: document.getElementById('fr-sub').textContent,
      primary: document.getElementById('fr-next').textContent,
      bars: document.querySelectorAll('.fr-progress').length,
    }));
    check('[interrupted] says what was interrupted', /downloading Claude/.test(got.text), got.text.slice(0, 110));
    check('[interrupted] offers to start again', got.primary === 'Start again', got.primary);
    check('[interrupted] shows NO progress bar for progress nobody is making', got.bars === 0, `${got.bars} bars`);
    check('[interrupted] no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
    await page.screenshot({ path: path.join(SHOTS, 'connect-6-interrupted.png') });
    await ctx.close();
  }

  /* ── 5b. a flow that finished while they were away wins over the cache ──── */
  {
    /* The page loads while "not connected" (first /api/first-run answer),
       but the connect flow already finished server-side. The resume must
       route to a re-check, which then answers connected -- both answers
       scripted so the sequence is deterministic. */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    let firstRunCalls = 0;
    await page.route('**/api/first-run', (route) => {
      firstRunCalls += 1;
      const sub = firstRunCalls === 1
        ? { state: 'none', plan: null, because: 'no Claude subscription is connected on this computer yet.' }
        : { state: 'connected', plan: 'Claude Max', because: 'a Claude subscription is connected on this computer' };
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ done: false, fleetKnown: true, fleetCount: 0, fleetNames: [], path: 'create', subscription: sub }),
      });
    });
    await page.route('**/api/connect', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ phase: 'connected', plan: 'Claude Max' }) });
      } else route.continue();
    });
    await page.goto(`${BASE}/?first-run=1&fr-step=3`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const got = await page.evaluate(() => document.getElementById('fr-sub').textContent);
    check('[resume-connected] a finished flow beats the page-load cache',
      /is connected/.test(got) && !/No Claude subscription/.test(got), got.slice(0, 110));
    check('[resume-connected] no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
    await ctx.close();
  }

  /* ── 6. a stale stuck record loses to a connected verdict ───────────────── */
  {
    fs.writeFileSync(CONFIG, JSON.stringify({
      oauthAccount: { organizationType: 'claude_max', billingType: 'stripe_subscription' },
    }, null, 2), 'utf8');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await step3Page(ctx, {
      phase: 'stuck', because: 'an attempt from last week', tail: 'old noise',
    });
    await page.waitForTimeout(800);
    const got = await page.evaluate(() => document.getElementById('fr-sub').textContent);
    check('[stale-stuck] a connected verdict is NOT replaced by a dead failure record',
      /is connected/.test(got) && !/could not finish/.test(got), got.slice(0, 110));
    check('[stale-stuck] no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
    // Back to the free config for anything that runs after this block.
    fs.writeFileSync(CONFIG, JSON.stringify(FREE, null, 2), 'utf8');
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
