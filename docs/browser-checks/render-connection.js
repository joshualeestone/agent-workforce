/* Browser check for the connection notice on the board.
 *
 * WHY A RENDERED CHECK AND NOT A UNIT TEST. The thing most likely to be wrong
 * here is not the logic, it is the PRESENTATION of `unknown`. A text assertion
 * cannot see whether "we could not read your settings" got styled as a failure,
 * and styling it as one is the specific defect this feature exists to avoid: it
 * tells a paying customer their account is broken because a file was
 * unreadable. So the states are rendered and photographed.
 *
 * ⚠️ SANDBOX EVERY WRITE ROOT. This drives a real server, and an unsandboxed run
 * does not litter, it takes live fleet agents off the air. AGENT_WORKFORCE_DATA,
 * _WORKERS, _LAUNCH and _CLAUDE_CONFIG are all pointed at a temp dir by the
 * runner, and this script REFUSES to run if the config path is the real one.
 *
 * Run: see the README in this directory.
 */
'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = process.argv[2] || 'http://127.0.0.1:4412';
const SHOTS = process.argv[3] || '/tmp/connshots';
const CONFIG = process.argv[4];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* ⚠️ Proved by a READ, not by a string comparison on an argument. A guard that
   only checks that a path "looks like" a sandbox is theatre; this one refuses
   unless the file it is about to rewrite is demonstrably inside a temp dir. */
const REAL = path.join(os.homedir(), '.claude.json');
if (!CONFIG || path.resolve(CONFIG) === path.resolve(REAL)) {
  console.error('REFUSING: pass a sandboxed config path. This script REWRITES it, and the real one is the operator\'s Claude account.');
  process.exit(2);
}
/* ⚠️ REAL PATHS, AND MORE THAN ONE TEMP ROOT. The first version compared
   against `os.tmpdir()` alone and refused a perfectly good sandbox in `/tmp`,
   because on macOS `os.tmpdir()` is the per-user `/var/folders/...` and `/tmp`
   is a symlink to `/private/tmp`. Two correct temp locations, one of them
   rejected, and a raw string prefix could not see either fact.
   Resolved through realpath so the symlink cannot hide a path from the check,
   and the guard still refuses everything outside a temp root. */
const realTemp = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const TEMP_ROOTS = [os.tmpdir(), '/tmp', '/private/tmp'].map(realTemp);
const target = realTemp(path.dirname(path.resolve(CONFIG)));
if (!TEMP_ROOTS.some((root) => target === root || target.startsWith(root + path.sep))) {
  console.error(`REFUSING: ${CONFIG} resolves to ${target}, which is not under any of ${TEMP_ROOTS.join(', ')}`);
  process.exit(2);
}

/* ⚠️ MARK FIRST RUN DONE, IN THE SANDBOX, OR EVERY SCREENSHOT IS THE WIZARD.
   A board with no completion flag opens the four-screen setup over everything.
   MEASURED on this very check: the first run reported 17/19 passing while all
   THREE screenshots were byte-identical pictures of "Welcome to Agent
   Workforce". The DOM assertions passed because the notice existed behind the
   overlay, which is the worst kind of green, because those images are the PR's
   evidence.

   ⚠️ Written by the ENGINE'S OWN `complete()`, never a shape typed here. `seen()`
   keys on `completedAt`, so an invented `{done:true}` parses, answers "not
   done", and the wizard opens anyway. The producer is one require away. */
process.env.AGENT_WORKFORCE_DATA = process.env.AGENT_WORKFORCE_DATA
  || path.join(path.dirname(path.resolve(CONFIG)), 'data');
require('../../engine/firstrun').complete();

const CONNECTED = { oauthAccount: { organizationType: 'claude_max', billingType: 'stripe_subscription' } };
const FREE = { oauthAccount: { organizationType: 'claude_free' } };

const writeConfig = (o) => fs.writeFileSync(CONFIG, JSON.stringify(o, null, 2), 'utf8');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  async function stateOf(page) {
    return page.evaluate(() => {
      const el = document.getElementById('conn');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return {
        present: true,
        visible: el.checkVisibility
          ? el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true })
          : !el.hidden,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        cls: el.className,
        bg: cs.backgroundColor,
        color: cs.color,
        border: cs.borderTopColor,
        pageBg: getComputedStyle(document.body).backgroundColor,
      };
    });
  }

  for (const [label, cfg, expect] of [
    ['connected', CONNECTED, 'hidden'],
    ['no subscription', FREE, 'bad'],
    ['unreadable settings', null, 'unsure'],
  ]) {
    if (cfg) writeConfig(cfg);
    else fs.writeFileSync(CONFIG, '{ not json', 'utf8');

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1200);          // let a tick land

    /* ⚠️ ASSERT WHAT IS ON SCREEN BEFORE BELIEVING ANY OF IT. Not
       `offsetParent`: the overlay is `position: fixed`, whose offsetParent is
       always null, so a guard using it reports "no wizard" while the wizard
       fills the screen. `hidden` is what the code toggles, and the rect is the
       belt to its braces. */
    const covered = await page.evaluate(() => {
      const vis = (el) => {
        if (!el || el.hidden) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
      };
      return { wizard: vis(document.getElementById('firstrun')), grid: vis(document.getElementById('grid')) };
    });
    check(`[${label}] the BOARD is on screen, not the first-run wizard`,
      covered.wizard === false && covered.grid === true,
      `wizard=${covered.wizard} grid=${covered.grid}`);
    if (covered.wizard || !covered.grid) {
      throw new Error('every screenshot from this run would be of the wrong screen, and they are the PR evidence');
    }

    const s = await stateOf(page);
    check(`[${label}] the notice element exists`, s.present);

    if (expect === 'hidden') {
      /* ⚠️ THE CONTROL, and it comes first on purpose. "The banner is showing"
         proves nothing unless the same check first proved it can be absent. */
      check('CONTROL: no notice at all while the connection is fine', s.visible === false,
        s.visible ? `unexpectedly showing: "${s.text}"` : 'absent');
    } else {
      check(`[${label}] the notice is visible`, s.visible === true, s.text.slice(0, 110));
      check(`[${label}] it carries the ${expect} class`, (s.cls || '').includes('conn-' + expect), s.cls);

      /* The copy contract, which is where the honesty lives. */
      if (expect === 'bad') {
        check('[no subscription] says it cannot REACH a subscription',
          /cannot reach a Claude subscription/i.test(s.text), s.text.slice(0, 90));
      } else {
        check('[unreadable] says it cannot TELL, not that you have nothing',
          /cannot tell whether/i.test(s.text), s.text.slice(0, 90));
        check('[unreadable] does NOT assert the customer has no subscription',
          !/cannot reach a Claude subscription/i.test(s.text) && !/no Claude subscription is connected/i.test(s.text),
          s.text.slice(0, 110));
      }

      /* ⚠️ READ THE WHOLE SENTENCE, not just that the right words appear. The
         first render said the same fact twice and started a sentence with a
         lower-case word, and every keyword assertion passed anyway. */
      check(`[${label}] no sentence starts lower-case after a full stop`,
        !/[.!?]\s+[a-z]/.test(s.text), s.text.slice(0, 140));
      check(`[${label}] does not state the same fact twice`,
        !(/cannot reach a Claude subscription/i.test(s.text) && /no Claude subscription is connected/i.test(s.text)),
        s.text.slice(0, 140));

      /* ⚠️ Never counts corpses. We infer from one machine-level fact, so the
         copy must hedge about the agents rather than declare them dead. */
      check(`[${label}] hedges about the agents rather than declaring them dead`,
        !/\bare dead\b|\bhave stopped\b|\bcannot work\b/i.test(s.text)
          && (!/agents? (is|are)/i.test(s.text) || /may not be able to/i.test(s.text)),
        s.text.slice(0, 130));

      /* AA contrast of the notice text on its own ground. */
      /* ⚠️ COMPOSITE THE ALPHA. The notice background is a token like
         `rgba(0,0,0,0.035)`, and taking its first three numbers reads a 3.5%
         black wash as SOLID BLACK. The first version did exactly that and
         reported 1.00:1, a number that described nothing on screen. Blend over
         the page's own background, which is what a reader actually sees. */
      const parse = (v) => { const n = (v.match(/[\d.]+/g) || []).map(Number); return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }; };
      const over = (fgc, bgc) => fgc.rgb.map((c, i) => Math.round(c * fgc.a + bgc.rgb[i] * (1 - fgc.a)));
      const rgb = (v) => parse(v).rgb;
      const lum = (c) => { const f = c.map((x) => { const t = x / 255; return t <= 0.03928 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
      // Not `page`: that name is the Playwright page in this scope, and
      // shadowing it here would be a live footgun for the next edit.
      const ground = parse(s.pageBg);
      const fg = rgb(s.color), bgc = over(parse(s.bg), ground);
      const ratio = (Math.max(lum(fg), lum(bgc)) + 0.05) / (Math.min(lum(fg), lum(bgc)) + 0.05);
      check(`[${label}] notice text meets AA`, ratio >= 4.5, `${ratio.toFixed(2)}:1`);
    }

    check(`[${label}] no page errors`, errors.length === 0, errors.join(' | ').slice(0, 160));
    await page.screenshot({ path: path.join(SHOTS, `conn-${label.replace(/\s+/g, '-')}.png`) });
    await ctx.close();
  }

  /* ⚠️ The two failure states must not look the same. If they render
     identically then "unknown is not a failure" is a claim in a comment and
     nothing else. */
  const bad = fs.readFileSync(path.join(SHOTS, 'conn-no-subscription.png'));
  const unsure = fs.readFileSync(path.join(SHOTS, 'conn-unreadable-settings.png'));
  check('the two failure states are visibly different from each other',
    !bad.equals(unsure), 'byte-identical screenshots would mean one style for two claims');

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots in ${SHOTS}`);
  if (failed.length) { failed.forEach((f) => console.log('  - ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
