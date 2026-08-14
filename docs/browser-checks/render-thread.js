'use strict';

/**
 * Render and DRIVE the project thread in a real browser.
 *
 * ⚠️ WHY THIS EXISTS. `node --test` reads text. It cannot see a control that
 * renders transparent, a terminal viewport whose text has no contrast, or a
 * question box that is in the DOM and invisible on screen — this repo has
 * shipped all three, and 316 tests once went past a fully transparent modal
 * because nothing had ever put the page on a screen. A screenshot, plus a
 * measurement taken FROM the rendered page, is the only evidence that what a
 * person opens is what the tests describe.
 *
 * ⚠️ IT MUST BE POINTED AT `thread-server.js`, NOT AT `node server.js`. This
 * screen SENDS: against a plain server on this machine, pressing Send would
 * type into a live agent's conversation. The fixture server stubs the pane
 * source and `chat`'s tmux runner so a Send reaches a log line and no further,
 * and this check REFUSES to run against anything else.
 *
 *   SB=$(mktemp -d)
 *   PORT=4421 AGENT_WORKFORCE_DATA="$SB/data" \
 *     AGENT_WORKFORCE_WORKERS="$SB/workers" \
 *     AGENT_WORKFORCE_LAUNCH="$SB/launch" \
 *     node docs/browser-checks/thread-server.js > /tmp/threadsrv.log &
 *
 *   PW=/tmp/pw-projects
 *   NODE_PATH="$PW/node_modules" node docs/browser-checks/render-thread.js \
 *     http://127.0.0.1:4421 /tmp/threadshots /tmp/threadsrv.log
 *
 * ⚠️ `NODE_PATH` is not optional: `require` resolves from THIS file's
 * directory, so without it the script walks docs/browser-checks/node_modules
 * and exits MODULE_NOT_FOUND.
 *
 * ⚠️ HEADED by default. Headless renders through SwiftShader rather than the
 * real compositor, so a paint or geometry result from it is weaker evidence.
 * `HEADED=0` for a machine with no console session.
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4421';
const OUT = process.argv[3] || '/tmp/threadshots';
// The fixture server's stdout. It is what proves a Send reached the seam
// carrying the person's exact words — the one thing a screenshot cannot show.
const LOG = process.argv[4] || null;
const HEADED = process.env.HEADED !== '0';

/* ── contrast, measured rather than eyeballed ────────────────────────────── */

/**
 * ⚠️ THE COLOURS ARE rgbA AND THE ALPHA IS LOAD-BEARING. The first version of
 * this check elsewhere in this directory parsed `rgba(0,0,0,0.42)` as pure
 * black, reported 21.00 for grey-on-white, and passed every element on the page
 * — a measurement that could not fail, hiding two real failures. Composite over
 * the background first, then compare.
 */
function parseColor(c) {
  const p = String(c).match(/[\d.]+/g).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function over(fg, bg) {
  const f = parseColor(fg); const b = parseColor(bg);
  return { r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a) };
}
function luminance(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(fg, bg) {
  const l1 = luminance(over(fg, bg)); const l2 = luminance(parseColor(bg));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Flatten a stack of backgrounds, nearest first, into the opaque colour a
 * person actually sees.
 *
 * ⚠️ THE NEIGHBOURING CHECKS DO NOT DO THIS, and it produced a FALSE FAILURE
 * the first time this one ran: they take the first background that is not fully
 * transparent and treat it as opaque. That is fine everywhere they look and
 * wrong here, because this screen's terminal boxes sit on `--attn-bg`, which is
 * `rgba(0,0,0,0.035)` — a 3.5%-black VEIL over the page. Treated as opaque it
 * reads as near-black, so near-black text on it measured 1.00 and the check
 * reported two failures on a page that has none.
 *
 * It is the same alpha bug those checks fixed for the FOREGROUND, one layer
 * further back, and it is why this returns a composited colour rather than a
 * lookup. A false failure is cheaper than a false pass and still costs the next
 * person an hour chasing a defect that is not there.
 */
function flatten(stack) {
  let out = 'rgb(255, 255, 255)';
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const c = over(stack[i], out);
    out = `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
  return out;
}

const failures = [];
function check(ok, what) {
  if (ok) process.stdout.write(`  ✔ ${what}\n`);
  else { failures.push(what); process.stdout.write(`  ✘ ${what}\n`); }
}

async function api(p, options) {
  const res = await fetch(BASE + p, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const post = (p, body) => api(p, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
});

/**
 * ⚠️ REFUSES to run against a server whose send seam is live.
 *
 * A documented requirement that nothing checks is a requirement that gets
 * skipped exactly once — and the cost of skipping this one is typing into
 * somebody's running agent. So it is PROVEN rather than assumed: the fixture
 * server announces its stub on stdout, and this reads that announcement.
 */
function assertFixtureServer() {
  if (!LOG) {
    throw new Error('pass the fixture server\'s log as the 3rd argument; this check presses Send, '
      + 'and against a real server that types into a live agent');
  }
  const text = fs.readFileSync(LOG, 'utf8');
  if (!/thread-server: fixture fleet/.test(text)) {
    throw new Error(`${LOG} is not a thread-server log, so nothing proves this server's send seam is stubbed. Refusing.`);
  }
}

function sentKeys() {
  return fs.readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('SEND-KEYS '))
    .map((l) => JSON.parse(l.slice('SEND-KEYS '.length)));
}

/** Is this element actually on screen, with real size, and painted? */
async function reallyVisible(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { there: false };
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      there: true,
      w: Math.round(box.width),
      h: Math.round(box.height),
      opacity: Number(style.opacity),
      display: style.display,
      visibility: style.visibility,
    };
  }, selector);
}

async function main() {
  assertFixtureServer();
  fs.mkdirSync(OUT, { recursive: true });

  // A project with all three agents on it, made through the real route.
  const made = await post('/api/projects', {
    name: 'Henderson lease',
    folder: process.env.AGENT_WORKFORCE_DATA || require('node:os').tmpdir(),
    agents: ['mara', 'casey', 'nils'],
  });
  const id = (made.project && made.project.id) || made.id;

  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

  try {
    /* ── 1. the one click out of the stranded state ─────────────────────── */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card', { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-0-board.png'), fullPage: true });

    const answerBtn = page.locator('.card[data-agent="mara"] .card-answer');
    check(await answerBtn.count() === 1, 'the "Needs you" card carries exactly one way into the question');
    check(await page.locator('.card[data-agent="nils"] .card-answer').count() === 0,
      'a card that is NOT asking anything does not offer to show a question');

    // ⚠️ The click is the whole point. The button sits INSIDE the card, whose
    // own handler opens the detail panel — so a wrongly-ordered listener would
    // land somewhere plausible and this would be the only thing that noticed.
    await answerBtn.click();
    await page.waitForSelector('#panel-projects:not([hidden])', { timeout: 10000 });
    await page.waitForSelector('#pj-one-view:not([hidden])', { timeout: 10000 });
    await page.waitForFunction(() => {
      const q = document.getElementById('pj-question');
      return q && !q.hidden && (document.getElementById('pj-question-text').textContent || '').length > 0;
    }, null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-1-question.png'), fullPage: true });

    const question = await page.locator('#pj-question-text').textContent();
    check(/Do you want to proceed\?/.test(question), 'one click lands on the question itself, not on a panel about it');
    check(/replace the old summary file/.test(question), 'and on the run-up that says what it is asking about');

    const qBox = await reallyVisible(page, '#pj-question-text');
    check(qBox.there && qBox.w > 200 && qBox.h > 40 && qBox.opacity === 1,
      `the question box is really on screen (${qBox.w}x${qBox.h}, opacity ${qBox.opacity})`);

    /* ── 2. one agent answers, and it is the manager ────────────────────── */
    const who = await page.locator('#pj-thread-who').inputValue();
    check(who === 'mara', `the thread is addressed to one agent, and it is the one asking (${who})`);
    const options = await page.locator('#pj-thread-who option').allTextContents();
    check(options.length === 3, 'the other agents on the project are visible in the picker, and silent');
    check(options.includes('Mara') && options.includes('Casey'),
      'and they are named the way the rest of the app names them');

    /* ── 3. the agent's side is a screen, and says so ───────────────────── */
    const screen = await page.locator('#pj-screen').textContent();
    check(/Wrote 41 lines/.test(screen), 'the viewport shows what the pane is really displaying');
    const screenLabel = await page.locator('#pj-screen-label').textContent();
    check(/screen shows right now/.test(screenLabel), `the viewport is labelled as a screen: "${screenLabel}"`);
    const hint = await page.locator('#pj-screen-hint').textContent();
    check(/not a transcript/.test(hint) && /not what the agent said/.test(hint),
      'and it says outright that it is not the agent talking');

    // ⚠️ The terminal box must not stretch the page. A `pre` with `white-space:
    // pre` and no scroll container pushes the whole layout sideways, which a
    // text assertion cannot see at all.
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      screen: (() => { const el = document.getElementById('pj-screen');
        return el.scrollWidth > el.clientWidth; })(),
    }));
    check(overflow.body <= 0, `the page does not scroll sideways (overflow ${overflow.body}px)`);

    /* ── 4. sending ─────────────────────────────────────────────────────── */
    const before = sentKeys().length;
    await page.fill('#pj-say', '1');
    await page.click('#pj-send');
    await page.waitForFunction(() => document.querySelectorAll('.pj-msg').length > 0, null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-2-sent.png'), fullPage: true });

    const keys = sentKeys().slice(before);
    check(keys.length === 2, `a send is two tmux calls, the text then Enter (saw ${keys.length})`);
    check(keys[0] && keys[0][keys[0].length - 1] === '1',
      'the text that reached the seam is the text that was typed into the box');
    check(keys[0] && keys[0][2] === '=mara-discord:0.0',
      `and it was aimed at the exact pinned pane (${keys[0] && keys[0][2]})`);
    check(keys[1] && keys[1][keys[1].length - 1] === 'Enter', 'and Enter was a separate call');

    const said = await page.locator('.pj-msg .pj-msg-said').first().textContent();
    check(/Placed into Mara’s session/.test(said), `the verdict is about the keystroke: "${said}"`);
    // ⚠️ THE CLAIM CHECK. This whole feature's discipline is what the screen is
    // allowed to say. A tick, or the words "received"/"read", would be a claim
    // about a program's understanding that a keystroke cannot support.
    const panelText = await page.locator('#pj-thread').textContent();
    check(!/\breceived\b|\bhas read\b|\bread it\b|\bgot it\b/i.test(panelText),
      'nothing on this screen says the agent received or read anything');

    const box = await page.locator('#pj-say').inputValue();
    check(box === '', 'a delivered message is cleared from the box');

    /* ── 5. a delivery that fails keeps the person's words ──────────────── */
    // ⚠️ A REAL REFUSAL, THROUGH THE WHOLE STACK. `nils`'s pane answers the way
    // tmux answers for a session that has gone since the roster was read, so
    // this exercises the failure sentence the person actually reads rather than
    // one simulated inside the page. The happy path alone would photograph half
    // a feature.
    await page.selectOption('#pj-thread-who', 'nils');
    await page.waitForFunction(() => /Nils/.test(
      document.getElementById('pj-screen-label').textContent || ''), null, { timeout: 10000 });
    await page.fill('#pj-say', 'and this one cannot get through');
    await page.click('#pj-send');
    await page.waitForFunction(() => /Could not deliver/i.test(
      document.getElementById('pj-thread-msg').textContent || ''), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-4-failed.png'), fullPage: true });

    const failedSaid = await page.locator('#pj-thread-msg').textContent();
    check(/can't find pane/.test(failedSaid), `the refusal carries what tmux said: "${failedSaid}"`);
    const kept = await page.locator('#pj-say').inputValue();
    check(kept === 'and this one cannot get through',
      'a message that did not go through is still in the box, not thrown away');
    // And the attempt is kept in the thread, drawn differently from one that
    // landed: a thread that remembers only its successes rewrites its history.
    const failedRow = await page.locator('.pj-msg.failed').count();
    check(failedRow === 1, 'the failed attempt is in the thread, and does not draw like a delivered one');

    /* ── 6. contrast, on the rendered page, in both themes ──────────────── */
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(BASE + '?tab=projects', { waitUntil: 'networkidle' });
      await page.waitForSelector('.pj-row', { timeout: 10000 });
      await page.click('.pj-row');
      await page.waitForSelector('#pj-screen', { timeout: 10000 });
      await page.waitForFunction(() => (document.getElementById('pj-screen').textContent || '').length > 0,
        null, { timeout: 10000 });
      await page.screenshot({ path: path.join(OUT, `thread-3-${scheme}.png`), fullPage: true });

      /**
       * ⚠️ THE CONTROL, AND IT IS LOAD-BEARING. The only assertion below is
       * "nothing failed", which is exactly what a checker broken into silence
       * produces. So one element is planted that genuinely fails, and the
       * checker must catch it before any clean result is worth reading.
       */
      const measured = await page.evaluate(() => {
        const planted = document.createElement('span');
        planted.id = 'planted-failure';
        planted.textContent = 'planted';
        planted.style.color = 'rgb(200,200,200)';
        planted.style.background = 'rgb(215,215,215)';
        document.getElementById('pj-thread').appendChild(planted);
        const out = [];
        for (const el of document.querySelectorAll('#pj-thread *, .pj-msg, .pj-screen')) {
          const text = (el.textContent || '').trim();
          if (!text || el.children.length) continue;
          const box = el.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          // The whole STACK, nearest first, up to and including the first
          // opaque one. See `flatten`: a translucent veil treated as opaque is
          // how this check first reported failures the page does not have.
          const stack = [];
          for (let node = el; node; node = node.parentElement) {
            const c = getComputedStyle(node).backgroundColor;
            if (!c || /transparent/.test(c)) continue;
            const parts = String(c).match(/[\d.]+/g).map(Number);
            const alpha = parts.length > 3 ? parts[3] : 1;
            if (alpha === 0) continue;
            stack.push(c);
            if (alpha === 1) break;
          }
          out.push({ id: el.id || el.className || el.tagName, color: style.color, stack,
            size: parseFloat(style.fontSize), weight: style.fontWeight, text: text.slice(0, 40) });
        }
        planted.remove();
        return out;
      });

      const bad = measured.filter((m) => {
        const large = m.size >= 24 || (m.size >= 18.66 && Number(m.weight) >= 700);
        return contrast(m.color, flatten(m.stack)) < (large ? 3 : 4.5);
      });
      const caught = bad.some((m) => String(m.id).includes('planted'));
      check(caught, `${scheme}: the contrast checker catches a planted failure, so a clean result means something`);
      const real = bad.filter((m) => !String(m.id).includes('planted'));
      check(real.length === 0,
        `${scheme}: every visible string in the thread clears WCAG AA`
        + (real.length ? ` — ${real.map((m) => `${m.id} "${m.text}" ${contrast(m.color, flatten(m.stack)).toFixed(2)}`).join('; ')}` : ''));
    }

    /* ── 7. keyboard ────────────────────────────────────────────────────── */
    // ⚠️ The terminal boxes SCROLL, and a scrollable region that cannot be
    // reached by keyboard is a region some people cannot read (WCAG 2.1 SC
    // 2.1.1). This project's floor is AA.
    const focusable = await page.evaluate(() => {
      const ids = ['pj-screen', 'pj-question-text', 'pj-say', 'pj-send', 'pj-thread-who'];
      return ids.map((id) => {
        const el = document.getElementById(id);
        if (!el) return { id, there: false };
        el.focus();
        return { id, there: true, focused: document.activeElement === el, hidden: el.hidden };
      });
    });
    for (const f of focusable) {
      check(!f.there || f.hidden || f.focused, `${f.id} can be reached from the keyboard`);
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(failures.length
    ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}\n`
    : `\nall checks passed; shots in ${OUT}\n`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { process.stderr.write(String(err && err.stack || err) + '\n'); process.exit(1); });
