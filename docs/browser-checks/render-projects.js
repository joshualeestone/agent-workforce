'use strict';

/**
 * Render every state of the Projects screens in a real browser, light and dark.
 *
 * ⚠️ WHY THIS EXISTS. The suite reads text. It cannot see a control that renders
 * transparent, a row whose warning has no contrast, or a panel that is present
 * in the DOM and invisible on screen — 316 tests and two blind reviews once
 * passed a fully transparent modal because nothing had ever rendered the page.
 * A screenshot is the only evidence that the thing a person opens is the thing
 * the tests describe.
 *
 * ⚠️ IT DRIVES THE REAL ROUTES. Every state below is set up by POSTing to the
 * running server, not by injecting markup — a fixture painted into the DOM
 * proves the CSS works on markup this page might never produce. So SANDBOX THE
 * SERVER YOU POINT IT AT. Unsandboxed, the membership writes rewrite the
 * instruction files that live agents boot from.
 *
 *   SB=$(mktemp -d)
 *   PORT=4399 AGENT_WORKFORCE_DATA="$SB/data" \
 *     AGENT_WORKFORCE_WORKERS="$SB/workers" \
 *     AGENT_WORKFORCE_LAUNCH="$SB/launch" node server.js &
 *
 *   PW=$(mktemp -d); cd "$PW" && npm init -y && npm i playwright \
 *     && npx playwright install chromium
 *
 *   NODE_PATH="$PW/node_modules" node docs/browser-checks/render-projects.js \
 *     http://127.0.0.1:4399 /tmp/pjshots "$SB"
 *
 * ⚠️ `NODE_PATH` is not optional: `require` resolves from THIS file's directory,
 * so without it the script walks docs/browser-checks/node_modules and exits
 * MODULE_NOT_FOUND.
 *
 * ⚠️ HEADED by default. Headless renders through SwiftShader rather than the
 * real compositor, so a paint or geometry result from it is weaker evidence.
 * `HEADED=0` for a machine with no console session.
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

/**
 * WCAG AA, measured rather than eyeballed.
 *
 * ⚠️ THE COLOURS ARE rgbA AND THE ALPHA IS LOAD-BEARING. The first version of
 * this check parsed `rgba(0, 0, 0, 0.42)` as pure black, reported 21.00 for
 * grey-on-white, and passed every element on the page — a measurement that
 * could not fail. It hid two real failures. Composite over the background
 * first, then compare.
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

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const OUT = process.argv[3] || '/tmp/pjshots';
// The server's sandbox root, so the 'told' half of the verdict can be shown.
const SANDBOX = process.argv[4] || process.env.AGENT_WORKFORCE_SANDBOX || null;
const HEADED = process.env.HEADED !== '0';

async function api(p, options) {
  const res = await fetch(BASE + p, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const post = (p, body) => api(p, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
});

/**
 * ⚠️ REFUSES to run against a server that is not sandboxed. The header has
 * always SAID to sandbox it; nothing enforced it, and `clearProjects` below
 * deletes every project on whatever server it is pointed at and rewrites those
 * members' instruction files. A documented requirement that nothing checks is
 * a requirement that gets skipped exactly once.
 */
async function assertSandboxed() {
  if (!SANDBOX) {
    throw new Error('pass the server\'s sandbox root as the 4th argument; this check deletes every project on the server it is pointed at');
  }
  // ⚠️ PROVES it, rather than taking the argument's word for it. The first
  // version only checked that argv[4] was a non-empty string -- so any string
  // at all satisfied a guard whose own comment said "a documented requirement
  // that nothing checks is a requirement that gets skipped exactly once", while
  // `clearProjects` below deletes every project on whatever server it is
  // pointed at and rewrites those members' real instruction files.
  //
  // The probe is a real project through the real route, and it passes only if
  // the record lands INSIDE the sandbox we were handed.
  const probe = path.join(SANDBOX, 'sandbox-probe');
  fs.mkdirSync(probe, { recursive: true });
  const made = await post('/api/projects', { name: 'kosmos sandbox probe', folder: probe });
  try {
    const store = path.join(SANDBOX, 'data', 'AgentWorkforce', 'projects.json');
    if (!fs.existsSync(store)) {
      throw new Error(`the server at ${BASE} did not write to ${store} -- it is NOT running against the sandbox you passed. Refusing to touch it.`);
    }
    if (!fs.readFileSync(store, 'utf8').includes('kosmos sandbox probe')) {
      throw new Error(`the server at ${BASE} wrote somewhere other than ${store} -- refusing to touch it.`);
    }
  } finally {
    await api('/api/project/' + encodeURIComponent(made.project.id), { method: 'DELETE' });
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

async function clearProjects() {
  const { projects } = await api('/api/projects');
  for (const p of projects) await api('/api/project/' + encodeURIComponent(p.id), { method: 'DELETE' });
}

/**
 * Agents the running board can see, WITH a worker folder inside the sandbox.
 *
 * ⚠️ The folder is created here on purpose. Without it every member renders
 * "we could not tell it", and the run silently shows only the failure half of
 * the verdict -- a set of screenshots that agrees with itself and misses the
 * state the feature is mostly about. Pass the server's sandbox as argv[4].
 */
async function someAgents(n, sandbox) {
  const board = await api('/api/status');
  const names = (board.agents || []).slice(0, n).map((a) => a.sessionName);
  if (sandbox) {
    for (const name of names) {
      const dir = path.join(sandbox, 'workers', name);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'CLAUDE.md');
      // ⚠️ Only if absent: overwriting would destroy an instruction file, and
      // the point of the sandbox is that this script never can.
      if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${name}\n\nYou are an agent on this fleet.\n`);
    }
  }
  return names;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED });
  const shots = [];

  async function shot(name, prepare) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      if (prepare) await prepare(page);
      await page.waitForTimeout(400);

      const file = path.join(OUT, `projects-${name}${scheme === 'dark' ? '-dark' : ''}.png`);
      await page.screenshot({ path: file, fullPage: true });
      shots.push({ file, errors });
      if (errors.length) console.log(`  ⚠️ console errors on ${name} (${scheme}):`, errors.slice(0, 3));

      // ⚠️ Measured in the page rather than judged from the picture. A capture
      // narrower than the render looks exactly like a responsive bug, and
      // `scrollWidth - clientWidth` is the one comparison immune to that.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) console.log(`  ⚠️ ${name} (${scheme}) overflows horizontally by ${overflow}px`);

      await ctx.close();
    }
    console.log(`✔ ${name}`);
  }

  // 1. Nothing yet — the screen first-run hands you.
  await assertSandboxed();
  await clearProjects();
  await shot('1-empty');

  // 2. A list, built through the real routes. One project gets an agent this
  //    machine can tell, one gets an agent it cannot, one gets nobody.
  const agents = await someAgents(2, SANDBOX);
  const home = process.env.HOME;
  const demo = path.join(home, 'kosmos-demo');
  // ⚠️ REFUSES to reuse a folder that was already there, because the cleanup at
  // the end removes this tree recursively -- and `mkdirSync(recursive)`
  // succeeds silently on an existing directory, so an operator who happens to
  // keep a `~/kosmos-demo` would have lost it. The check and the delete have to
  // agree about who owns the folder.
  if (fs.existsSync(demo)) {
    throw new Error(`${demo} already exists; this check creates and deletes that folder, so it will not touch yours. Move it aside and re-run.`);
  }
  for (const d of ['henderson-lease', 'quarter-close', 'reed-handover']) {
    fs.mkdirSync(path.join(demo, d), { recursive: true });
  }
  await post('/api/projects', { name: 'Henderson lease', folder: path.join(demo, 'henderson-lease'), agents });
  await post('/api/projects', { name: 'Quarter close', folder: path.join(demo, 'quarter-close'), agents: ['claudebot'] });
  await post('/api/projects', { name: 'Reed handover', folder: path.join(demo, 'reed-handover') });
  await shot('2-list');

  // 3. One project — where the told-verdicts are visible.
  await shot('3-one', async (page) => {
    await page.click('[data-project="hendersonlease"]');
    await page.waitForTimeout(300);
  });

  // 4. The project whose members we could NOT tell.
  await shot('4-could-not-tell', async (page) => {
    await page.click('[data-project="quarterclose"]');
    await page.waitForTimeout(300);
  });

  // 5. Adding one: the folder browser.
  await shot('5-add', async (page) => {
    await page.click('#pj-new');
    await page.waitForTimeout(600);
    // Walk in and choose, so the screenshot shows a real chosen folder rather
    // than the opening state -- and so a regression that re-selects whatever
    // is being looked at would show up here.
    await page.click('button[data-into$="kosmos-demo"]');
    await page.waitForTimeout(400);
    await page.click('#pj-use');
    await page.waitForTimeout(300);
  });

  // 6a. The removal question. ⚠️ A confirmation is exactly the control that can
  //     ship invisible -- this repo once had 316 tests and two blind reviews
  //     pass a fully transparent modal, because nothing had ever rendered it.
  await shot('6-confirm-remove', async (page) => {
    await page.click('[data-project="quarterclose"]');
    await page.waitForTimeout(300);
    await page.click('#pj-one-remove');
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => {
      const el = document.getElementById('pj-one-remove-go');
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: r.width, h: r.height, opacity: cs.opacity, visibility: cs.visibility, text: el.textContent };
    });
    // Measured in the page, not judged from the picture.
    if (!seen.w || !seen.h || seen.opacity === '0' || seen.visibility === 'hidden') {
      throw new Error('the removal confirmation is not actually visible: ' + JSON.stringify(seen));
    }
    if (!seen.text.includes('Quarter close')) {
      throw new Error('the confirmation must name the project in the button: ' + seen.text);
    }
  });

  // 7. A folder that went away AFTER the project was made. The state this whole
  //    screen exists to render honestly.
  fs.rmSync(path.join(demo, 'reed-handover'), { recursive: true, force: true });
  await shot('7-folder-missing');
  fs.mkdirSync(path.join(demo, 'reed-handover'), { recursive: true });

  // 7. Contrast, on the list where every text token on this screen appears.
  let contrastFails = 0;
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // ⚠️ MEASURED FROM THE ONE-PROJECT VIEW, not the list. On a freshly loaded
    // list view `#pj-one-agents` is empty and `#pj-one-view` is hidden, so four
    // of the nine selectors -- including the told-line and the folder warning,
    // the copy carrying this feature's honesty claims -- never matched, were
    // silently skipped, and the run printed a pass anyway. Another measurement
    // that could not fail, in the very check written because the last one
    // could not fail.
    await page.click('[data-project="hendersonlease"]');
    await page.waitForTimeout(400);
    const els = await page.evaluate(() => {
      const bgOf = (el) => {
        let n = el;
        while (n) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)') return c;
          n = n.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };
      const out = [];
      // ⚠️ SCOPED to the projects panel. Unscoped, `.fhint` and `.flabel`
      // matched the FIRST one in the document -- inside a hidden panel -- and
      // the stricter miss-reporting above caught it on the first run, which is
      // the check working rather than the check being wrong.
      for (const sel of ['#panel-projects .pj-folder', '#panel-projects .pj-member b',
        '#panel-projects .pj-member small', '#panel-projects .pj-member .pj-told',
        '#panel-projects .pj-member .drop', '#pj-one-view .fhint', '#pj-one-view .flabel']) {
        const el = document.querySelector(sel);
        // ⚠️ A MISS IS RECORDED, not skipped. Skipping is how four selectors
        // went unmeasured under a printed pass.
        if (!el || !el.offsetParent) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        out.push({ sel, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
      }
      return out;
    });
    for (const e of els) {
      if (e.missing) {
        contrastFails += 1;
        console.log(`  ⚠️ ${e.sel} was not on screen to measure (${scheme}) — the check cannot pass on a selector it never found`);
        continue;
      }
      const cr = contrast(e.fg, e.bg);
      const large = e.size >= 24 || (e.size >= 18.66 && Number(e.weight) >= 700);
      const need = large ? 3 : 4.5;
      if (cr < need) {
        contrastFails += 1;
        console.log(`  ⚠️ contrast ${cr.toFixed(2)} (needs ${need}) — ${e.sel} @${e.size}px, ${scheme}`);
      }
    }
    await ctx.close();
  }
  console.log(contrastFails ? `✖ ${contrastFails} contrast failures` : '✔ 7-contrast (WCAG AA, light and dark)');

  // ⚠️ The fixture folders live in the REAL home, because the folder browser is
  // rooted there and a fixture in /tmp could not be reached by the thing under
  // test. That makes cleaning them up part of the run rather than an
  // afterthought -- a check that litters the operator's home every time it is
  // run is a check people stop running.
  fs.rmSync(demo, { recursive: true, force: true });

  await browser.close();

  const withErrors = shots.filter((s) => s.errors.length);
  console.log(`\n${shots.length} screenshots in ${OUT}`);
  console.log(withErrors.length
    ? `⚠️ ${withErrors.length} had console errors`
    : 'no console errors on any state');
  if (withErrors.length || contrastFails) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
