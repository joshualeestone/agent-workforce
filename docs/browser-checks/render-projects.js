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
 *     AGENT_WORKFORCE_LAUNCH="$SB/launch" \
 *     AGENT_WORKFORCE_PROJECTS="$SB/projects" node server.js &
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
// Set only once we have created the fixture tree ourselves; the cleanup keys on it.
let OURS = null;
// The launched browser, held at module level so the tail finally can close
// it after ANY failure inside main().
let BROWSER = null;

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
  // ⚠️ FIRST RUN IS MARKED DONE, IN THE SANDBOX, OR THIS CHECK PHOTOGRAPHS THE
  // WIZARD. Once first-run merged, a board with no completion flag opens the
  // four-screen setup over everything — correct product behaviour, and fatal to
  // a check that assumed the board was the first thing on screen. MEASURED: the
  // run that first met it reported `✔ 1-empty` and `✔ 2-list` while both
  // screenshots were pictures of "Welcome to Agent Workforce", then hung
  // clicking a project row that was behind a modal. Two states passed while
  // looking at the wrong screen, and those images are the PR's visual evidence.
  //
  // Written into the sandbox's own data dir, never `~`: the flag is what
  // switches somebody's real onboarding off.
  // ⚠️ WRITTEN BY THE ENGINE'S OWN `complete()`, not by a shape typed here. The
  // first version of this wrote `{done: true, at: …}` — and `seen()` keys on
  // `completedAt`, so the flag parsed, answered "not done", and the wizard
  // opened anyway. A fixture inventing a field the real producer does not
  // write, which is the exact defect this branch spent three rounds building a
  // mechanism against, committed once more in the check for it. The producer is
  // one require away, so there is no reason to guess.
  process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
  require('../../engine/firstrun').complete();

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
    // ⚠️ AND THE WORKERS ROOT, WHICH IS THE ONE THAT MATTERS — PROVED BY A READ.
    // Checking only the projects store proved the harmless half: the writes this
    // guard exists to prevent go to AGENT_WORKFORCE_WORKERS, the instruction
    // files the live fleet boots from.
    //
    // Two earlier versions of this check were themselves the hazard. The first
    // picked a REAL agent off /api/status and added it to a project — so against
    // an unsandboxed server the guard performed the exact destructive write it
    // exists to prevent, and only THEN noticed. A guard that has to do the
    // damage to detect it is not a guard. The second used a probe NAME instead,
    // which cannot work at all: `tellAgent` requires an exact roster match, and
    // an invented name is in no roster, so a correctly sandboxed server would
    // have been refused too.
    //
    // The instructions route ANSWERS WITH THE PATH IT WOULD READ, so asking it
    // where a real agent's file lives proves which workers root the server is
    // using, and writes nothing at all.
    const board = await api('/api/status');
    const someone = (board.agents || []).map((a) => a.sessionName)[0];
    if (!someone) {
      throw new Error(`the server at ${BASE} reports no agents, so the workers root cannot be verified. Refusing rather than guessing.`);
    }
    const seen = await api(`/api/agent/${encodeURIComponent(someone)}/instructions`);
    if (!seen.path || !path.resolve(seen.path).startsWith(path.resolve(SANDBOX) + path.sep)) {
      throw new Error(`the server at ${BASE} reads instructions from ${seen.path}, which is OUTSIDE ${SANDBOX} -- its AGENT_WORKFORCE_WORKERS is not sandboxed, and this check would rewrite the real fleet's boot files. Refusing.`);
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
  // ⚠️ BEFORE the browser is launched and before the output directory is made.
  // A refusal should cost a second and touch nothing; running it after
  // `chromium.launch()` meant a run that was going to be refused spawned a
  // browser first and took a minute to say no.
  await assertSandboxed();
  // A killed prior run can leave Engineering mode ON in the sandbox;
  // removed HERE so every state (not only 3c) renders the shipped
  // default -- states 1-3b screenshot the viewport-adjacent surfaces a
  // human reviews.
  fs.rmSync(path.join(SANDBOX, 'data', 'engmode.json'), { force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED });
  BROWSER = browser;
  const shots = [];
  let overflows = 0;

  async function shot(name, prepare) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });

      // ⚠️ IS THE THING WE CAME TO PHOTOGRAPH ACTUALLY ON SCREEN. Asked before
      // every state, because "the screenshot was taken" is not "the screenshot
      // is of this feature": with first-run merged, a board with no completion
      // flag opens the setup wizard over everything, and this check reported
      // `✔ 1-empty` and `✔ 2-list` for two pictures of "Welcome to Agent
      // Workforce". A passing run whose images are of another screen is the
      // worst kind of green, because the images ARE the evidence in the PR.
      //
      // Neither branch could have caught it alone -- it exists only in the
      // merge -- so it is asserted here rather than assumed anywhere.
      const covered = await page.evaluate(() => {
        // ⚠️ NOT `offsetParent`. The overlay is `position: fixed`, and a fixed
        // element's `offsetParent` is ALWAYS null — so the first version of this
        // guard computed "wizard: false" while the wizard filled the screen, and
        // passed. A visibility test that cannot see the thing it is testing for
        // is worse than none. `hidden` is what the code actually toggles, and
        // the rect is the belt to its braces.
        const vis = (el) => {
          if (!el || el.hidden) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
        };
        return {
          wizard: vis(document.getElementById('firstrun')),
          projects: vis(document.getElementById('panel-projects')),
        };
      });
      if (covered.wizard || !covered.projects) {
        throw new Error(
          `the projects panel is not what is on screen (first-run wizard visible: ${covered.wizard}, `
          + `projects panel visible: ${covered.projects}). Every screenshot from this run would be `
          + 'of the wrong screen, and they are the PR\'s evidence.',
        );
      }

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
      if (overflow > 0) {
        // ⚠️ FAILS the run. Every other measurement in this file does; this one
        // only logged, so a page that overflowed still exited 0 and the check
        // reported success.
        overflows += 1;
        console.log(`  ⚠️ ${name} (${scheme}) overflows horizontally by ${overflow}px`);
      }

      await ctx.close();
    }
    console.log(`✔ ${name}`);
  }

  // 1. Nothing yet — the screen first-run hands you.
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
    throw new Error(`${demo} already exists -- usually the leftover of a KILLED harness run (the finally only runs when main() settles). If its contents are just the fixture dirs (henderson-lease, quarter-close, reed-handover), move it aside (mv ${demo} ${demo}.stale) and re-run; if not, it is yours and this check will not touch it.`);
  }
  // ⚠️ ONLY A TREE THIS RUN CREATED IS EVER DELETED. The cleanup used to be an
  // unconditional `finally`, and `.finally` runs after `.catch` -- so the run
  // that refused to touch an operator's existing ~/kosmos-demo printed
  // "it will not touch yours" and then deleted it on the way out. The guard
  // could not protect anything it was standing in front of.
  OURS = demo;
  for (const d of ['henderson-lease', 'quarter-close', 'reed-handover']) {
    fs.mkdirSync(path.join(demo, d), { recursive: true });
  }
  await post('/api/projects', { name: 'Henderson lease', folder: path.join(demo, 'henderson-lease'), agents,
    description: 'Review the <b>renewal terms</b> & prepare the counter.' });
  await post('/api/projects', { name: 'Quarter close', folder: path.join(demo, 'quarter-close'), agents: ['claudebot'] });
  await post('/api/projects', { name: 'Reed handover', folder: path.join(demo, 'reed-handover') });
  await shot('2-list');

  /* ⚠️ THE FACES ROW IS GEOMETRY, and this check exists because a plain
     aria-hidden wrapper inside the flex row blockified and stacked the
     chips vertically while every text assertion stayed green (pj-cards
     pass 3). Bounding rects, not classes: every chip in a multi-member
     card's row shares a top, laid left to right with the pack's gap
     (separate chips, no overlap -- the pack's .pc-a draws no facepile). */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
    const page = await ctx.newPage();
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const faceGeo = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.pjfaces')]
        .map((f) => [...f.querySelectorAll('.lav')].map((c) => c.getBoundingClientRect()))
        .filter((chips) => chips.length > 1);
      if (!rows.length) return { rows: 0 };
      return {
        rows: rows.length,
        oneRow: rows.every((chips) => chips.every((r) => Math.abs(r.top - chips[0].top) < 2)),
        leftToRight: rows.every((chips) => chips.every((r, i) => i === 0 || r.left > chips[i - 1].left)),
        separated: rows.every((chips) => chips.every((r, i) => i === 0 || r.left >= chips[i - 1].right - 1)),
      };
    });
    if (!faceGeo.rows) throw new Error('no multi-member card rendered, so the faces-row geometry was never checked');
    if (!faceGeo.oneRow || !faceGeo.leftToRight || !faceGeo.separated) {
      throw new Error('the member faces are not one separated left-to-right row: ' + JSON.stringify(faceGeo));
    }
    } finally {
      await ctx.close();
    }
  }

  /* The description, on the RENDERED page in both places it lives, with the
     absence arm as its own assertion (project-description branch): a
     described project shows the sentence on its row and under its detail
     title; an undescribed one renders NO description element at all --
     an empty grey line under every undescribed project is the exact
     empty-state failure the hidden-toggle exists to prevent. Same
     own-context-in-a-finally shape as the add-flow block below. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const seen = await page.evaluate(() => {
        const row = [...document.querySelectorAll('.pj-row')]
          .find((r) => r.textContent.includes('Henderson lease'));
        const bare = [...document.querySelectorAll('.pj-row')]
          .find((r) => r.textContent.includes('Reed handover'));
        return {
          onRow: row ? ((row.querySelector('.pc-t') || {}).textContent || null) : null,
          rowHasBold: row ? Boolean(row.querySelector('.pc-t b')) : null,
          bareHasDesc: bare ? Boolean(bare.querySelector('.pc-t')) : null,
        };
      });
      // ⚠️ RENDERED escaping, not only the source-regex pin: the fixture's
      // description carries live markup, and the row must show it as TEXT,
      // verbatim, with no element born from it. A text assertion alone
      // cannot see the difference between escaped and parsed.
      if (seen.onRow !== 'Review the <b>renewal terms</b> & prepare the counter.') {
        throw new Error('the described row does not carry its sentence verbatim (markup should render as text): ' + JSON.stringify(seen.onRow));
      }
      if (seen.rowHasBold !== false) {
        throw new Error('the description markup PARSED on the row: injection, not text');
      }
      if (seen.bareHasDesc !== false) {
        throw new Error('an undescribed project rendered a description element (empty grey line): ' + JSON.stringify(seen.bareHasDesc));
      }
      await page.click('[data-project="hendersonlease"]');
      await page.waitForTimeout(300);
      const detail = await page.evaluate(() => {
        const el = document.getElementById('pj-one-desc');
        return { text: el ? el.textContent : null, hidden: el ? el.hidden : null };
      });
      if (detail.text !== 'Review the <b>renewal terms</b> & prepare the counter.' || detail.hidden !== false) {
        throw new Error('the detail description is wrong or hidden: ' + JSON.stringify(detail));
      }
      // Each surface at ITS pack size, replacing the old same-token equality
      // (the pack draws them apart on purpose: .pc-t at .875rem on the card,
      // .pjdesc at .9375rem on the detail). Pinned to exact px so the round-1
      // cascade regression -- a bare selector losing its font to .panel p and
      // silently inheriting -- still reds: an inherited size matches neither.
      const sizes = await page.evaluate(() => ({
        row: getComputedStyle(document.querySelector('#pj-list .pc-t')).fontSize,
        detail: getComputedStyle(document.getElementById('pj-one-desc')).fontSize,
      }));
      if (sizes.row !== '14px' || sizes.detail !== '15px') {
        throw new Error('a description lost its pack size (card .875rem, detail .9375rem): ' + JSON.stringify(sizes));
      }
      // The DETAIL's absence arm, exercised, not inferred from the row's: an
      // undescribed project's detail must hide the element (hidden === true),
      // which is the arm the markup comment says the toggle exists for.
      await page.click('#pj-back');
      await page.waitForTimeout(200);
      await page.click('[data-project="reedhandover"]');
      await page.waitForTimeout(300);
      const bareDetail = await page.evaluate(() => {
        const el = document.getElementById('pj-one-desc');
        if (!el) return { present: false };
        const r = el.getBoundingClientRect();
        return {
          present: true,
          hidden: el.hidden,
          display: getComputedStyle(el).display,
          w: r.width, h: r.height,
          text: el.textContent,
        };
      });
      // ⚠️ RENDERED absence, not the attribute: `p.pj-desc { display: block }`
      // is exactly the author rule that beats the UA [hidden], and only the
      // global [hidden]{display:none !important} keeps the empty grey line
      // off this screen. The attribute check passed either way; this one
      // reds if that global rule ever weakens.
      if (!bareDetail.present) {
        throw new Error('#pj-one-desc vanished from the markup entirely');
      }
      if (bareDetail.hidden !== true || bareDetail.display !== 'none' || bareDetail.w > 0 || bareDetail.h > 0) {
        throw new Error('an undescribed project\u2019s detail description is ON SCREEN (attribute vs rendering): ' + JSON.stringify(bareDetail));
      }
      // A description AT THE CAP wraps FULLY on the pack card (the one-line
      // ellipsis retired with the pj-cards restyle): the claim is that the
      // whole sentence is on screen, wrapped, not clipped.
      const cap = 'C'.repeat(200);
      await api('/api/project/' + encodeURIComponent('reedhandover'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: cap }),
      });
      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const longRow = await page.evaluate(() => {
        const row = [...document.querySelectorAll('.pj-row')]
          .find((r) => r.textContent.includes('Reed handover'));
        const el = row && row.querySelector('.pc-t');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
          clippedX: el.scrollWidth > el.clientWidth + 1,
          clippedY: el.scrollHeight > el.clientHeight + 1,
        };
      });
      if (!longRow) throw new Error('the 200-char description never rendered on its card');
      if (longRow.lines < 2 || longRow.clippedX || longRow.clippedY) {
        throw new Error('a description at the cap should wrap fully on the pack card, unclipped: ' + JSON.stringify(longRow));
      }
      await api('/api/project/' + encodeURIComponent('reedhandover'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: '' }),
      });
      console.log('✔ 2b-description (row, both absence arms, detail, and the one-line cap)');
    } finally {
      await ctx.close();
    }
  }

  // 3. One project — where the told-verdicts are visible.
  await shot('3-one', async (page) => {
    await page.click('[data-project="hendersonlease"]');
    await page.waitForTimeout(300);
  });

  /* 3b. THE ROOM (View D). Seeded by APPENDING SHAPED ROWS to the
     sandbox's own record file, never by posting through the route: the
     sandbox roster is the REAL board, so a route post would fan out into
     live agents' panes. The composer's send path is held by the engine
     and route tests (scripted tmux); what only a browser can prove is
     the RENDERING: attribution, the operator's own treatment, the
     receipt naming each recipient's real state, escaping, and the valve
     as reassurance. (The room's text tokens -- msg-t, delivery, the
     valve row -- ride the same k-ink-2-on-k-surface pair the sweep
     already measures on the cards; the log is wiped before the sweep so
     they are not measured HERE, a recorded acceptance, not an
     oversight.) */
  {
    const logFile = path.join(SANDBOX, 'data', 'AgentWorkforce', 'messages.jsonl');
    const at = new Date().toISOString();
    const seeded = [
      { kind: 'post', id: 'm9001', project: 'hendersonlease', from: agents[0],
        to: [agents[1]], text: 'went through the lease <b>end to end</b>', at, outcomes: { [agents[1]]: 'placed' } },
      { kind: 'post', id: 'm9002', project: 'hendersonlease', from: 'you', operator: true,
        to: [agents[0], agents[1]], text: '@' + agents[0] + ' take the renewal terms', at,
        outcomes: { [agents[0]]: 'placed', [agents[1]]: 'could_not' } },
      { kind: 'valve', from: agents[0], to: 'hendersonlease', project: 'hendersonlease',
        because: 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.', at },
    ];
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    for (const row of seeded) fs.appendFileSync(logFile, JSON.stringify(row) + '\n');
    await shot('3b-room', async (page) => {
      await page.click('[data-project="hendersonlease"]');
      await page.waitForTimeout(800);
      const seen = await page.evaluate(() => {
        const box = document.getElementById('pj-room');
        const msgs = [...box.querySelectorAll('.msg')];
        const you = box.querySelector('.msg.you');
        const agentChip = box.querySelector('.msg:not(.you) .msg-av');
        const receipt = you && you.querySelector('.delivery');
        return {
          rows: msgs.length,
          youNamed: you ? you.querySelector('.msg-h b').textContent : null,
          /* The PRESENCE control for the absence claim below: the agent
             chip carries the disc's inline tint, so "the You chip has no
             inline style" is measured against a mechanism proven live,
             not against a refactor that moved tints to classes. */
          agentChipFromFaceSet: agentChip ? Boolean(agentChip.getAttribute('style')) : null,
          youChipFromFaceSet: you ? Boolean(you.querySelector('.msg-av').getAttribute('style')) : null,
          receipt: receipt ? receipt.textContent : null,
          receiptCls: receipt ? receipt.className : null,
          escaped: msgs[0] ? msgs[0].querySelector('p').textContent : null,
          bold: Boolean(box.querySelector('.msg p b')),
          valve: (box.querySelector('.msg-valve') || {}).textContent || null,
          visible: box.getBoundingClientRect().height > 0,
        };
      });
      if (!seen.visible || seen.rows !== 2) throw new Error('the room did not render its two posts: ' + JSON.stringify(seen));
      if (seen.youNamed !== 'You') throw new Error('the operator post is not attributed as You');
      if (seen.agentChipFromFaceSet !== true) throw new Error('the disc mechanism moved (no inline tint on an agent chip), so the You-chip check below cannot mean anything');
      if (seen.youChipFromFaceSet) throw new Error('the person\u2019s chip was drawn from the agent face set (an inline disc style)');
      if (!seen.receipt || !/could not be reached/.test(seen.receipt) || !/Placed with /.test(seen.receipt)) {
        throw new Error('a post that reached one of two does not say so per recipient: ' + JSON.stringify(seen.receipt));
      }
      if (!/failed/.test(seen.receiptCls || '')) throw new Error('a partial post did not carry the failed weight: ' + seen.receiptCls);
      if (seen.bold || !/<b>end to end<\/b>/.test(seen.escaped || '')) {
        throw new Error('post markup PARSED on the room thread: injection, not text');
      }
      if (!seen.valve || !/asked everyone to bring you in/.test(seen.valve)) {
        throw new Error('the room valve row is missing or lost the ruled sentence: ' + JSON.stringify(seen.valve));
      }
    });
    // Removed so every later state (could-not-tell, contrast, archive)
    // sees the record it expects.
    fs.writeFileSync(logFile, '');
  }

  /* 3c. ENGINEERING MODE. The raw window is HIDDEN by default -- hiding
     is the point (the block Josh called garbage nonsense to a business
     person) -- and revealed by the person's own switch, driven through
     the real settings toggle. The question panel ignores the switch
     (safety, not chrome), and the number-answer teaching line ships in
     both modes. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Hermetic: a KILLED earlier run can leave the switch on in the
    // sandbox (the flip-back lives at the end of this state), and the
    // default-Off assertion below would then red against its own
    // leftovers rather than the product.
    const engFile = path.join(SANDBOX, 'data', 'engmode.json');
    try {
      const page = await ctx.newPage();
      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await page.click('[data-project="hendersonlease"]');
      await page.waitForTimeout(400);
      const dfl = await page.evaluate(() => ({
        viewportHidden: document.querySelector('.pj-viewport').hidden,
      }));
      if (!dfl.viewportHidden) throw new Error('the raw window is on screen in the default Off state');
      // The teaching line's VISIBLE rendering (and the question panel's
      // mode-independence) need a live asking agent, which this sandbox
      // does not manufacture: render-thread.js CARRIES those assertions
      // against its scripted fixture (section 0 drives the question open
      // in Off and pins the line's wording; the On section pins it
      // again).


      // The person's own switch, through the real card.
      await page.click('.tab[data-tab="settings"]');
      await page.waitForTimeout(300);
      await page.click('#eng-toggle');
      await page.waitForTimeout(400);
      const tog = await page.evaluate(() => document.getElementById('eng-toggle').getAttribute('aria-checked'));
      if (tog !== 'true') throw new Error('the engineering toggle did not flip on');
      await page.click('.tab[data-tab="projects"]');
      await page.waitForTimeout(500);
      // The tab returns to the DETAIL we left open (the card list is
      // hidden beneath it); the save already re-applied the mode to the
      // open page, which is itself part of the claim.
      const revealed = await page.evaluate(() => ({
        viewportHidden: document.querySelector('.pj-viewport').hidden,
      }));
      if (revealed.viewportHidden) throw new Error('the switch is On and the raw window stayed hidden');
      // The SECOND surface: the agent page's window box, on the same
      // switch. The sandbox roster is the real board, so the capture
      // either succeeds or refuses in words -- both are honest renders,
      // and the claim here is the box is PRESENT and never an empty
      // terminal under an affirmative hint.
      await page.click('#klink');
      await page.waitForTimeout(400);
      await page.click('.acard');
      await page.waitForTimeout(800);
      const win = await page.evaluate(() => {
        const box = document.getElementById('d-window-box');
        const pre = document.getElementById('d-window');
        const msg = document.getElementById('d-window-msg');
        const hint = document.getElementById('d-window-hint');
        return {
          boxHidden: box.hidden,
          preShown: !pre.hidden,
          msgShown: !msg.hidden,
          hintText: hint.textContent,
        };
      });
      if (win.boxHidden) throw new Error('the switch is On and the agent page grew no window box');
      if (!win.preShown && !win.msgShown) throw new Error('the window box is an empty terminal: neither a capture nor a refusal in words');
      if (!win.preShown && win.hintText) throw new Error('an affirmative hint stands over a refused capture');
      await page.click('#detail-back');
      await page.waitForTimeout(200);
      await page.click('.tab[data-tab="projects"]');
      await page.waitForTimeout(300);
      // Back Off through the same switch, so later states see the default.
      await page.click('.tab[data-tab="settings"]');
      await page.waitForTimeout(300);
      await page.click('#eng-toggle');
      await page.waitForTimeout(400);
      const back = await page.evaluate(() => document.getElementById('eng-toggle').getAttribute('aria-checked'));
      if (back !== 'false') throw new Error('the engineering toggle did not flip back off');
    } finally {
      fs.rmSync(engFile, { force: true });
      await ctx.close();
    }
  }

  // 4. The project whose members we could NOT tell.
  await shot('4-could-not-tell', async (page) => {
    await page.click('[data-project="quarterclose"]');
    await page.waitForTimeout(300);
  });

  // 5. Adding one: the folder browser.
  await shot('5-add', async (page) => {
    await page.click('#pj-new');
    await page.waitForTimeout(600);
    // ⚠️ The advanced route starts CLOSED now -- the default path is a name and
    // no picker at all -- so the browser has to be opened before it can be
    // walked. When this line was missing the walk below clicked a control
    // inside a hidden panel, which is this check photographing a screen that
    // no longer exists.
    await page.click('#pj-advanced');
    await page.waitForTimeout(500);
    // Walk in and choose, so the screenshot shows a real chosen folder rather
    // than the opening state -- and so a regression that re-selects whatever
    // is being looked at would show up here.
    await page.click('button[data-into$="kosmos-demo"]');
    await page.waitForTimeout(400);

    // ⚠️ KEYBOARD FOCUS SURVIVED THE STEP. `pjBrowse` replaces the whole list
    // with `innerHTML`, which destroys the button that was just pressed and
    // drops focus to <body> -- so a keyboard person walking home -> work ->
    // clients restarted their Tab journey from the top of the document at every
    // step, in the primary flow for the audience this product is FOR. Nothing
    // in a screenshot can show that, which is why it is asserted here: the same
    // reason the confirmation below is checked for visibility rather than
    // presence.
    const focus = await page.evaluate(() => ({
      id: document.activeElement && document.activeElement.id,
      body: document.activeElement === document.body,
      text: (document.activeElement && document.activeElement.textContent || '').slice(0, 60),
    }));
    if (focus.body || focus.id !== 'pj-crumbs') {
      throw new Error(
        'focus was dropped walking into a folder (activeElement: '
        + (focus.body ? '<body>' : `#${focus.id}`) + '). A keyboard person has to '
        + 'tab from the top of the document again, with nothing saying where they are.',
      );
    }
    if (!focus.text.trim()) {
      throw new Error('focus landed on the crumb but the crumb says nothing about where we are');
    }

    await page.click('#pj-use');
    await page.waitForTimeout(300);
  });

  // 5b. Backing out of the advanced route FORGETS the pick.
  //     ⚠️ Asserted as the SYMPTOM, not the mechanism: the failure was a
  //     project created at the folder the person had just backed out of, under
  //     a line reading "Kosmos will make this at ~/Kosmos/Projects/<name>". So
  //     this drives pick -> back out -> Add and asks the engine where the
  //     project actually went. The two sentence checks on the way are the
  //     visible half of the same promise: while a folder is picked exactly one
  //     line says where the project will be, and after backing out the screen
  //     is back to the default story.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // ctx.close lives in a finally (round 27): an assertion throw anywhere
    // in this block used to leak the context, unlike the sibling blocks.
    try {
      const page = await ctx.newPage();
      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      await page.click('#pj-new');
      await page.waitForTimeout(400);
      await page.click('#pj-advanced');
      await page.waitForTimeout(500);
      await page.click('button[data-into$="kosmos-demo"]');
      await page.waitForTimeout(300);
      await page.click('#pj-use');
      await page.waitForTimeout(200);
      const picked = await page.evaluate(() => ({
        chosen: document.getElementById('pj-chosen').textContent,
        willBe: document.getElementById('pj-will-be').textContent.trim(),
      }));
      if (!picked.chosen.includes('kosmos-demo')) {
        throw new Error('pressing "Use this folder" did not put the folder in the chosen line: ' + picked.chosen);
      }
      if (picked.willBe) {
        throw new Error('with a folder picked, the default-path line still speaks -- two sentences about '
          + 'where the project will be, one of them wrong: ' + JSON.stringify(picked));
      }
      // CONTROL for the back-out check: the pick was really in force just now,
      // so the clearing asserted below is a change this click caused, not a
      // state the screen was already in.
      await page.click('#pj-advanced');
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => ({
        chosen: document.getElementById('pj-chosen').textContent,
        willBe: document.getElementById('pj-will-be').textContent.trim(),
      }));
      if (after.chosen.includes('kosmos-demo') || !after.willBe) {
        throw new Error('closing the advanced route did not forget the pick on screen: ' + JSON.stringify(after));
      }
      // ⚠️ PROBE, DON'T INFER, before the one create in this file that uses
      // the DEFAULT path (round 23): unlike thread-server.js, this check
      // drives whatever server it is pointed at, and against one started
      // without AGENT_WORKFORCE_PROJECTS this click would build a real
      // directory under ~/Kosmos/Projects that the DELETE below never
      // removes (remove rewrites the record and deliberately never touches
      // folders). The route answers with the exact path the server would
      // use, so the refusal is keyed on reality, not on the header comment.
      const os = require('node:os');
      const probe = await api('/api/project-folder?name=' + encodeURIComponent('Backout check'));
      if (String(probe.path || '').startsWith(os.homedir() + '/Kosmos')) {
        throw new Error('refusing the default-path create: the server would build '
          + probe.path + ' inside the operator\'s real home. Start the server with '
          + 'AGENT_WORKFORCE_PROJECTS pointed at a scratch dir.');
      }
      await page.fill('#pj-name', 'Backout check');
      await page.click('#pj-create');
      await page.waitForTimeout(800);
      const { projects } = await api('/api/projects');
      const made = projects.find((p) => p.name === 'Backout check');
      if (!made) throw new Error('the back-out project was not created at all');
      try {
        if (String(made.folder || '').includes('kosmos-demo')) {
          throw new Error('backing out of the folder route did NOT back out: the project was created at '
            + made.folder + ' while the screen promised the default path.');
        }
      } finally {
        await api('/api/project/' + encodeURIComponent(made.id), { method: 'DELETE' });
      }
    } finally {
      await ctx.close();
    }
  }

  // 6a. The removal question. ⚠️ A confirmation is exactly the control that can
  //     ship invisible -- this repo once had 316 tests and two blind reviews
  //     pass a fully transparent modal, because nothing had ever rendered it.
  await shot('6-confirm-remove', async (page) => {
    await page.click('[data-project="quarterclose"]');
    await page.waitForTimeout(300);
    // The remove control moved behind Project settings with the pack
    // restyle (rare-and-destructive off the reading surface), so the
    // question is now two clicks from the card, and this state renders
    // the settings view it actually lives on.
    await page.click('#pj-settings-link');
    await page.waitForTimeout(200);
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
  //    ⚠️ LEFT missing through the contrast pass below, so the warn-coloured
  //    copy is actually on screen to be measured. It used to be recreated
  //    immediately, which is why those selectors could never match.
  fs.rmSync(path.join(demo, 'reed-handover'), { recursive: true, force: true });
  await shot('7-folder-missing');

  // 7. Contrast, on the list where every text token on this screen appears.
  let contrastFails = 0;
  const surfacesByScheme = {};
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // ⚠️ ONE definition of the background walk, shared by every measuring
    // block on this page as `window.__kbg` -- four verbatim copies is how
    // helpers silently diverge. COMPOSITED, not the first painted color:
    // the slug chip's rgba(20,22,26,.05) wash read as near-opaque BLACK and
    // produced a 2.20:1 "failure" in both schemes for text that actually
    // clears 7:1 -- a translucent layer must be folded over what is beneath
    // it before it can be a background.
    await page.evaluate(() => {
      window.__kbg = (el) => {
        const layers = [];
        let n = el;
        while (n) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)') {
            layers.push(c);
            const m = String(c).match(/[\d.]+/g).map(Number);
            if (m.length < 4 || m[3] >= 1) break;
          }
          n = n.parentElement;
        }
        let acc = { r: 255, g: 255, b: 255 };
        for (let i = layers.length - 1; i >= 0; i--) {
          const p = String(layers[i]).match(/[\d.]+/g).map(Number);
          const a = p.length > 3 ? p[3] : 1;
          acc = { r: p[0] * a + acc.r * (1 - a), g: p[1] * a + acc.g * (1 - a), b: p[2] * a + acc.b * (1 - a) };
        }
        return 'rgb(' + Math.round(acc.r) + ', ' + Math.round(acc.g) + ', ' + Math.round(acc.b) + ')';
      };
    });
    // ⚠️ MEASURED FROM THE ONE-PROJECT VIEW, not the list. On a freshly loaded
    // list view `#pj-one-agents` is empty and `#pj-one-view` is hidden, so four
    // of the nine selectors -- including the told-line and the folder warning,
    // the copy carrying this feature's honesty claims -- never matched, were
    // silently skipped, and the run printed a pass anyway. Another measurement
    // that could not fail, in the very check written because the last one
    // could not fail.
    // The list carries `.pj-warn` (the missing folder, left missing above); the
    // one-project view carries the member and told copy. Both are needed, so
    // the members are read first and the list rules are read before the click.
    const listEls = await page.evaluate(() => {
      const bgOf = window.__kbg;
      const out = [];
      // Every text token the pack card carries, not only the honesty lines:
      // the plan's hand-checked ratios were a one-time verification, and a
      // palette edit after it would regress silently. The disc initials
      // (.pjfaces .lav) measure the inline TINT/INK pair the renderer chose.
      for (const sel of ['#panel-projects .pj-warn', '#panel-projects .pj-row .pc-t',
                         '#pj-list .pjcard-h b', '#pj-list .pjpill', '#pj-list .pjslug',
                         '#pj-list .pjcount', '#pj-list .pjfaces .lav',
                         '#pj-list-view .viewtoggle .vt', '#pj-list-view .viewtoggle .vt.on']) {
        const el = document.querySelector(sel);
        if (!el || !el.offsetParent) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        out.push({ sel, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
      }
      // The needs-you pill variant, measured as a STYLE on real markup: the
      // sandbox roster cannot manufacture a live needs-you pane, so the
      // class is toggled onto an existing pill for the read and toggled
      // straight back off. A state claim it is not; the red-on-card ratio
      // is what it pins.
      {
        const pill = document.querySelector('#pj-list .pjpill');
        if (!pill) { out.push({ sel: '#pj-list .pjpill.attn (toggled)', missing: true }); }
        else {
          pill.classList.add('attn');
          const cs = getComputedStyle(pill);
          out.push({ sel: '#pj-list .pjpill.attn (toggled)', fg: cs.color, bg: bgOf(pill), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
          pill.classList.remove('attn');
        }
      }
      // The blind-spot sentence (.pj-who), same synthetic treatment: every
      // member in this sandbox is seen, so the sentence is not on screen to
      // measure -- and it is the one line this branch pinned to a FIXED ink
      // for dark-mode survival, so leaving it unmeasured is the exact
      // narration-outruns-the-check gap. Real card, real class, removed
      // after the read.
      {
        const row = document.querySelector('#pj-list .pj-row');
        if (!row) { out.push({ sel: '#pj-list .pj-who (injected)', missing: true }); }
        else {
          const who = document.createElement('span');
          who.className = 'pj-who';
          who.textContent = '1 we cannot see';
          row.appendChild(who);
          const cs = getComputedStyle(who);
          out.push({ sel: '#pj-list .pj-who (injected)', fg: cs.color, bg: bgOf(who), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
          who.remove();
        }
      }
      return out;
    });
    await page.click('[data-project="reedhandover"]');
    await page.waitForTimeout(300);
    // ⚠️ MEASURED WHILE THE BAD-FOLDER PROJECT IS OPEN, which is the only
    // moment `.pj-folder-state.bad` exists. The comment below used to claim
    // this rule was in the list; it was not, and the `els` pass runs on
    // `hendersonlease`, whose folder is readable -- so `paintOneProject` sets
    // the class WITHOUT `bad` and the selector could not have matched even if
    // it had been listed. Narration outrunning the check, in the file rewritten
    // because the previous check could not fail. It is a real measurement now.
    // ⚠️ AND MEASURED INSIDE PROJECT SETTINGS, where the folder facts moved
    // with the pack restyle -- on the reading surface they live on the card's
    // own .pj-warn line, measured in listEls above.
    await page.click('#pj-settings-link');
    await page.waitForTimeout(200);
    const badFolderEls = await page.evaluate(() => {
      const bgOf = window.__kbg;
      const out = [];
      for (const sel of ['#pj-settings-view .pj-folder-state.bad']) {
        const el = document.querySelector(sel);
        if (!el || !el.offsetParent) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        out.push({ sel, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
      }
      return out;
    });
    await page.click('#pj-settings-back');
    await page.waitForTimeout(200);
    // ⚠️ A typed draft SURVIVES Back-then-reopen OF THE SAME PROJECT
    // (round 34): the round-33 switch-time park read PJ_CURRENT after the
    // back button had nulled it, so this exact sequence deleted the words
    // at green checks. The park now happens on the input event, and this
    // drives the sequence that used to eat it. Set-and-dispatch rather
    // than fill() (fill waits for actionability and the box can be
    // disabled here); and the SAME project is re-opened -- the first
    // version of this check typed in one project and asserted in another,
    // and correctly read an empty box that was a different project's
    // (empty) draft.
    const draftProject = await page.evaluate(() => {
      const b = document.getElementById('pj-say');
      b.value = 'a draft typed and then navigated away from';
      b.dispatchEvent(new Event('input', { bubbles: true }));
      return PJ_CURRENT;
    });
    await page.click('#pj-back');
    await page.waitForTimeout(200);
    await page.click('[data-project="' + draftProject + '"]');
    await page.waitForTimeout(400);
    const draftBack = await page.evaluate(() => document.getElementById('pj-say').value);
    if (draftBack !== 'a draft typed and then navigated away from') {
      throw new Error('the draft did not survive Back-then-reopen: box reads ' + JSON.stringify(draftBack));
    }
    await page.evaluate(() => {
      const b = document.getElementById('pj-say');
      b.value = '';
      b.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#pj-back');
    await page.waitForTimeout(200);
    await page.click('[data-project="hendersonlease"]');
    await page.waitForTimeout(400);
    const els = await page.evaluate(() => {
      const bgOf = window.__kbg;
      const out = [];
      // ⚠️ SCOPED to the projects panel. Unscoped, `.fhint` and `.flabel`
      // matched the FIRST one in the document -- inside a hidden panel -- and
      // the stricter miss-reporting above caught it on the first run, which is
      // the check working rather than the check being wrong.
      // ⚠️ The two rules whose whole job is to look DIFFERENT from a healthy
      // row are measured elsewhere, because neither exists on this screen:
      // `.pj-warn` in the `listEls` pass above (it is a list row), and
      // `.pj-folder-state.bad` in the `badFolderEls` pass below, while the
      // project whose folder is missing is open. This list is the one-project
      // view of a HEALTHY project, so it cannot carry either.
      for (const sel of ['#panel-projects .pj-member b',
        '#panel-projects .pj-member small', '#panel-projects .pj-member .pj-told',
        '#panel-projects .pj-member .drop', '#pj-one-view .fhint', '#pj-one-view .flabel',
        '#pj-one-view #pj-one-desc']) {
        const el = document.querySelector(sel);
        // ⚠️ A MISS IS RECORDED, not skipped. Skipping is how four selectors
        // went unmeasured under a printed pass.
        if (!el || !el.offsetParent) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        out.push({ sel, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
      }
      return out;
    });
    // The healthy project's folder facts moved into Project settings with
    // the pack restyle -- and the raw-path .pj-folder element retired with
    // the pack's tilde cut, so the folder NAME chip and the location
    // sentence are what carry them now. Measured on the view they render on.
    await page.click('#pj-settings-link');
    await page.waitForTimeout(200);
    const settingsEls = await page.evaluate(() => {
      const bgOf = window.__kbg;
      const out = [];
      for (const sel of ['#pj-settings-view #pjs-folder-name', '#pj-settings-view #pjs-folder-where']) {
        const el = document.querySelector(sel);
        if (!el || !el.offsetParent) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        out.push({ sel, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
      }
      return out;
    });
    for (const e of [...listEls, ...badFolderEls, ...els, ...settingsEls]) {
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
    // The surfaces this scheme actually painted, for the flip check below.
    // Read from the LIST view: the sweep leaves the page on the settings
    // view, so navigate back rather than assume.
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    surfacesByScheme[scheme] = await page.evaluate(() => {
      const read = (sel, prop) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('the flip probe found nothing at ' + sel + ' -- a surface that is not on screen cannot prove it flips');
        return getComputedStyle(el)[prop];
      };
      return {
        ground: getComputedStyle(document.body).backgroundColor,
        card: read('#pj-list .pj-row', 'backgroundColor'),
        band: read('.apphead', 'backgroundColor'),
        tile: read('#panel-projects .stat:not(.action)', 'backgroundColor'),
      };
    });
    // The AGENTS board's surfaces too -- the dark-tokens review found the
    // needs-you borders and gauge geometry invisible in dark precisely
    // because no instrument looked at that tab in both schemes.
    await page.click('#klink');
    await page.waitForTimeout(400);
    Object.assign(surfacesByScheme[scheme], await page.evaluate(() => {
      const read = (sel, prop) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('the flip probe found nothing at ' + sel + ' -- a surface that is not on screen cannot prove it flips');
        return getComputedStyle(el)[prop];
      };
      return {
        acard: read('.acard', 'backgroundColor'),
        /* .gt draws only for agents with a KNOWN memory pct; a machine
           where every agent is unreadable renders .gu dashes instead --
           a correct page, so the probe follows the renderer's own
           branches rather than misreporting it as a rendering bug. */
        gaugeTrack: document.querySelector('.acard .gt')
          ? read('.acard .gt', 'stroke')
          : read('.acard .gu', 'stroke'),
      };
    }));
    // The memory .bar exists only in the LIST layout (the grid card draws
    // the gauge instead), so the probe switches through the real toggle
    // rather than reading a hidden renderer's computed style.
    await page.click('.viewtoggle[data-scope="agents"] [data-layout="list"]');
    await page.waitForTimeout(300);
    Object.assign(surfacesByScheme[scheme], await page.evaluate(() => {
      /* Not the first bar blindly: an unknown-memory row draws
         .bar.unknown, whose gradient shorthand resets background-color to
         transparent -- a correct page the transparent-read guard would
         red. Prefer a known-memory bar; fall back to the unknown dash
         pattern's backgroundImage, which is equally scheme-derived. */
      const known = document.querySelector('#alist .bar:not(.unknown)');
      if (known) return { memBar: getComputedStyle(known).backgroundColor };
      const unknown = document.querySelector('#alist .bar.unknown');
      if (unknown) return { memBar: getComputedStyle(unknown).backgroundImage };
      throw new Error('the flip probe found no #alist .bar at all -- a surface that is not on screen cannot prove it flips');
    }));
    await ctx.close();
  }
  console.log(contrastFails ? `✖ ${contrastFails} contrast failures` : '✔ 7-contrast (WCAG AA, light and dark)');

  // 7b. THE FLIP ITSELF, which no contrast assertion can see: dark ink on a
  // literal-white card passes AA in both themes, and that is exactly how a
  // grid whose k-tokens never flipped survived six review passes and this
  // sweep (Mona Lisa measured card interior 255,255,255 in dark,
  // 2026-08-18). The failing property is "does the surface token CHANGE
  // between schemes", so that is the property asserted.
  {
    const light = surfacesByScheme.light; const dark = surfacesByScheme.dark;
    for (const key of ['ground', 'card', 'band', 'tile', 'acard', 'gaugeTrack', 'memBar']) {
      if (!light[key] || light[key] === 'rgba(0, 0, 0, 0)' || !dark[key] || dark[key] === 'rgba(0, 0, 0, 0)') {
        throw new Error(`the ${key} surface was not painted to measure (light ${light[key]}, dark ${dark[key]}) -- a transparent surface cannot prove it flips`);
      }
      if (light[key] === dark[key]) {
        throw new Error(`the ${key} surface does not flip between schemes (${light[key]} in both) -- literal-white-in-dark is the defect this check exists for`);
      }
    }
    console.log('✔ 7b-theme-flip (ground, card, band, tile, acard, gauge track, memory bar all change between schemes)');
  }

  // 8. The app shell: sticky bar, the K mark, the member wording, the two
  //    scoped view toggles, and the archived disclosure. Behaviour in one
  //    context; the states worth evidence get their own shots below.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 520 } });
    try {
      const page = await ctx.newPage();

      // 8a. The bar stays while the page goes. Asserted as the SYMPTOM (after
      // scrolling, the tabs still sit at the top of the screen), not as a
      // computed-style reading of `position: sticky`.
      // ⚠️ The pack's card GRID made three projects one short row, so the
      // page stopped being taller than any viewport and scrollY stayed 0 --
      // a check that never scrolls has not exercised stickiness. Fillers go
      // through the real create route (default folder, inside the sandboxed
      // AGENT_WORKFORCE_PROJECTS) and are deleted before the next check.
      const fillers = [];
      try {
        for (let i = 0; i < 12; i++) {
          // `id` is the field the route guarantees; `project` is null when the
          // post-write re-read throws, and a filler must not die on that.
          const made = await post('/api/projects', { name: 'Scroll filler ' + i });
          fillers.push(made.id);
        }
        await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
        const stick = await page.evaluate(() => {
          window.scrollTo(0, 400);
          const bar = document.querySelector('.apphead');
          const r = bar.getBoundingClientRect();
          return { scrolled: window.scrollY, top: r.top, visible: r.height > 0 };
        });
        if (stick.scrolled < 100) throw new Error('the page did not scroll, so stickiness was never exercised (scrollY ' + stick.scrolled + ')');
        if (!stick.visible || stick.top < -1 || stick.top > 1) {
          throw new Error('after scrolling ' + stick.scrolled + 'px the bar is not at the top of the screen (top ' + stick.top + ') -- the nav is not sticking');
        }
      } finally {
        // Unconditional, like the outer fixture-tree teardown: a thrown
        // assertion must not leave twelve fillers in the store.
        for (const id of fillers) await api('/api/project/' + encodeURIComponent(id), { method: 'DELETE' });
      }
      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      await page.evaluate(() => window.scrollTo(0, 0));

      // 8b. The K mark goes to the Agents board through the real tab control.
      await page.click('#klink');
      await page.waitForTimeout(200);
      const landed = await page.evaluate(() => ({
        selected: document.querySelector('.tab[data-tab="agents"]').getAttribute('aria-selected'),
        gridShown: !document.getElementById('grid').hidden,
        barShown: !document.getElementById('boardbar').hidden,
      }));
      if (landed.selected !== 'true' || !landed.gridShown) {
        throw new Error('clicking the K mark did not land on the Agents board: ' + JSON.stringify(landed));
      }
      if (!landed.barShown) throw new Error('the agents view toggle is not shown with the board it operates on');

      // 8c. The agents toggle drives the agents board -- and ONLY it.
      // ⚠️ Independence is BEFORE == AFTER, not "asgrid absent": the pack
      // restyle made grid the projects DEFAULT, so the class is present on
      // a fresh load and its presence alone no longer implicates this click.
      const pjBefore = await page.evaluate(() => document.getElementById('pj-list').classList.contains('asgrid'));
      await page.click('.viewtoggle[data-scope="agents"] [data-layout="list"]');
      const agLay = await page.evaluate(() => ({
        /* stage 3/4 rebuild: the agents list is its own #alist markup and
           the toggle flips hidden between the two containers -- .aslist is
           gone, so the assertion follows the mechanism that replaced it */
        aslist: document.getElementById('grid').hidden && !document.getElementById('alist').hidden,
        pressed: document.querySelector('.viewtoggle[data-scope="agents"] [data-layout="list"]').getAttribute('aria-pressed'),
        pjGrid: document.getElementById('pj-list').classList.contains('asgrid'),
      }));
      if (!agLay.aslist || agLay.pressed !== 'true') throw new Error('the agents list toggle did not change the board: ' + JSON.stringify(agLay));
      if (agLay.pjGrid !== pjBefore) throw new Error('the agents toggle drove the PROJECTS list -- the scopes are not independent');
      // The AGENTS toggle's contrast, measured here where it is on screen
      // (the sweep runs on the projects tab, where this one is hidden).
      const agContrast = await page.evaluate(() => {
        const parse = (c) => { const m = String(c).match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a) });
        const bgOf = (el) => { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; n = n.parentElement; } return 'rgb(255, 255, 255)'; };
        const ratio = (el) => { const fg = parse(getComputedStyle(el).color); const bg = parse(bgOf(el)); const l1 = lum(over(fg, bg)); const l2 = lum(bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
        const rest = document.querySelector('.boardbar .vt:not(.on)');
        const on = document.querySelector('.boardbar .vt.on');
        return { rest: rest ? ratio(rest) : null, on: on ? ratio(on) : null };
      });
      if (agContrast.rest === null || agContrast.on === null || agContrast.rest < 3 || agContrast.on < 3) {
        throw new Error('the agents toggle is unmeasured or under the 3:1 icon floor: ' + JSON.stringify(agContrast));
      }

      // 8d. The projects toggle, and the choice surviving a reload.
      await page.click('.tab[data-tab="projects"]');
      await page.waitForTimeout(300);
      await page.click('.viewtoggle[data-scope="projects"] [data-layout="grid"]');
      const pjLay = await page.evaluate(() => document.getElementById('pj-list').classList.contains('asgrid'));
      if (!pjLay) throw new Error('the projects grid toggle did not change the list');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      /* ⚠️ The reload lands on the PROJECTS tab (the drive's own URL), where
         the new mechanism hides BOTH agent containers -- container
         visibility cannot witness the agents choice from here (the first
         re-anchor of this line false-failed a correct build on exactly
         that). Persistence is read from the signals that survive tabs
         (the store + the toggle's pressed state), and the visible half is
         asserted AFTER clicking back to the agents tab. */
      const kept = await page.evaluate(() => ({
        pj: document.getElementById('pj-list').classList.contains('asgrid'),
        agSaved: (() => { try { return localStorage.getItem('kosmos.layout.agents'); } catch { return null; } })(),
        agPressed: document.querySelector('.viewtoggle[data-scope="agents"] [data-layout="list"]').getAttribute('aria-pressed'),
        pressed: document.querySelector('.viewtoggle[data-scope="projects"] [data-layout="grid"]').getAttribute('aria-pressed'),
      }));
      if (!kept.pj || kept.agSaved !== 'list' || kept.agPressed !== 'true' || kept.pressed !== 'true') {
        throw new Error('the layout choice did not survive a reload: ' + JSON.stringify(kept));
      }
      await page.click('.tab[data-tab="agents"]');
      await page.waitForTimeout(200);
      const keptVisible = await page.evaluate(() => ({
        ag: document.getElementById('grid').hidden && !document.getElementById('alist').hidden,
      }));
      if (!keptVisible.ag) {
        throw new Error('the surviving agents choice did not drive the board on return: ' + JSON.stringify(keptVisible));
      }
      // Back to the defaults so the shots below show the shipped resting
      // state. ⚠️ ORDER FOLLOWS VISIBILITY: we are on the AGENTS tab here
      // (the persistence assertion above ends there), so the agents toggle
      // resets first; the projects toggle lives inside the hidden projects
      // panel and is clickable only after switching back. The first
      // re-anchor reset projects-first from the agents tab and timed out
      // on a zero-rect control (round 4).
      await page.click('.viewtoggle[data-scope="agents"] [data-layout="grid"]');
      await page.click('.tab[data-tab="projects"]');
      await page.waitForTimeout(200);
      await page.click('.viewtoggle[data-scope="projects"] [data-layout="list"]');
      await page.waitForTimeout(300);

      // 8e. The member wording and the resting picker. The heading is the
      // pinned words; the choosing row hides behind "+ Add Member" and the
      // reveal puts the keyboard on the choice.
      await page.click('[data-project="hendersonlease"]');
      await page.waitForTimeout(300);
      const members = await page.evaluate(() => ({
        heading: (document.querySelector('#pj-one-view .flabel') || {}).textContent,
        btnShown: !document.getElementById('pj-add-member').hidden,
        rowHidden: document.getElementById('pj-one-add-row').hidden,
      }));
      if (members.heading !== 'Project members') throw new Error('the members heading reads "' + members.heading + '", not the pinned words');
      if (!members.btnShown || !members.rowHidden) throw new Error('the picker is not resting behind + Add Member: ' + JSON.stringify(members));
      await page.click('#pj-add-member');
      const revealed = await page.evaluate(() => ({
        rowHidden: document.getElementById('pj-one-add-row').hidden,
        btnShown: !document.getElementById('pj-add-member').hidden,
        focusOnSelect: document.activeElement === document.getElementById('pj-one-add'),
      }));
      if (revealed.rowHidden || revealed.btnShown || !revealed.focusOnSelect) {
        throw new Error('+ Add Member did not reveal the picker with focus on the choice: ' + JSON.stringify(revealed));
      }
      // Leaving and coming back rests it again -- an open picker must not leak
      // between projects.
      await page.click('#pj-back');
      await page.waitForTimeout(200);
      await page.click('[data-project="quarterclose"]');
      await page.waitForTimeout(300);
      const rested = await page.evaluate(() => ({
        btnShown: !document.getElementById('pj-add-member').hidden,
        rowHidden: document.getElementById('pj-one-add-row').hidden,
      }));
      if (!rested.btnShown || !rested.rowHidden) throw new Error('the picker leaked open into the next project: ' + JSON.stringify(rested));

      // 8f. Archiving, from the resting truth outward: no disclosure at all
      // while nothing is archived; archive one from its detail; the count is
      // the rows; Restore brings it back.
      const before = await page.evaluate(() => ({
        wrapHidden: document.getElementById('pj-arch-wrap').hidden,
      }));
      if (!before.wrapHidden) throw new Error('the archived disclosure is on screen with nothing archived');
      // The archive control moved behind Project settings with the pack
      // restyle, one hop from the detail like Remove.
      await page.click('#pj-settings-link');
      await page.waitForTimeout(200);
      await page.click('#pj-one-archive');
      await page.waitForTimeout(400);
      const archivedNow = await page.evaluate(() => ({
        onList: !document.getElementById('pj-list-view').hidden,
        rowGone: !document.querySelector('#pj-list [data-project="quarterclose"]'),
        wrapShown: !document.getElementById('pj-arch-wrap').hidden,
        toggleText: document.getElementById('pj-arch-toggle').textContent,
        listHidden: document.getElementById('pj-arch-list').hidden,
        note: document.getElementById('pj-list-msg').textContent,
      }));
      if (!archivedNow.onList) throw new Error('archiving did not return to the list');
      const focusAfterArchive = await page.evaluate(() => document.activeElement === document.body);
      if (focusAfterArchive) throw new Error('archiving from the detail dropped keyboard focus to body');
      if (!archivedNow.rowGone) throw new Error('the archived project is still in the active list');
      if (!archivedNow.wrapShown || archivedNow.toggleText !== 'Show archived projects (1)') {
        throw new Error('the disclosure does not carry the row-derived count: ' + JSON.stringify(archivedNow));
      }
      if (!archivedNow.listHidden) throw new Error('the archived list opened itself');
      if (!/Archived Quarter close/.test(archivedNow.note)) throw new Error('nothing told the person what just happened: "' + archivedNow.note + '"');
      // The note may not reference the screen (round 6: "in the archived
      // list below" outlived a LATER failed poll that hid the disclosure).
      if (/above|below|this page|archived list/.test(archivedNow.note)) {
        throw new Error('the archive note references the screen, which any later poll can repaint: "' + archivedNow.note + '"');
      }
      await page.click('#pj-arch-toggle');
      await page.waitForTimeout(200);
      const open = await page.evaluate(() => {
        const row = document.querySelector('#pj-arch-list .removed-row');
        return {
          listHidden: document.getElementById('pj-arch-list').hidden,
          expanded: document.getElementById('pj-arch-toggle').getAttribute('aria-expanded'),
          who: row ? row.querySelector('.who').textContent : null,
          hasRestore: !!(row && row.querySelector('[data-restore]')),
          when: row ? row.querySelector('.when').textContent : null,
        };
      });
      if (open.listHidden || open.expanded !== 'true') throw new Error('the disclosure did not open: ' + JSON.stringify(open));
      if (open.who !== 'Quarter close' || !open.hasRestore) throw new Error('the archived row is not the project with its Restore: ' + JSON.stringify(open));
      if (!/^Archived/.test(open.when || '')) throw new Error('the row does not say when it was archived: "' + open.when + '"');
      await page.click('#pj-arch-list [data-restore]');
      await page.waitForTimeout(400);
      const restored = await page.evaluate(() => ({
        back: !!document.querySelector('#pj-list [data-project="quarterclose"]'),
        wrapHidden: document.getElementById('pj-arch-wrap').hidden,
      }));
      if (!restored.back) throw new Error('Restore did not return the project to the list');
      if (!restored.wrapHidden) throw new Error('an empty archived section stayed on screen after the restore');
      // The keyboard survived the section disappearing (round 7: the only
      // focus assertion in step 8 was the picker reveal, so the rescues
      // were undriven and a missing one was invisible to a green run).
      const focusAfterRestore = await page.evaluate(() => document.activeElement === document.body);
      if (focusAfterRestore) throw new Error('the disclosure restore dropped keyboard focus to body');
      // 8g. Archive the SAME project again the same day: the regenerated rows
      // string is byte-identical, so a disclosure that only hid (without
      // clearing the setIfChanged cache) reopens on the stale DOM with its
      // still-disabled Restore -- a one-way door until reload (review round
      // 1, measured). The button must come back enabled.
      const all2 = await api('/api/projects');
      const q2 = (all2.projects || []).find((pr) => pr.name === 'Quarter close');
      await api('/api/project/' + encodeURIComponent(q2.id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.click('#pj-arch-toggle');
      await page.waitForTimeout(200);
      const again = await page.evaluate(() => {
        const b = document.querySelector('#pj-arch-list [data-restore]');
        return { present: !!b, disabled: b ? b.disabled : null, text: b ? b.textContent : null };
      });
      if (!again.present) throw new Error('re-archiving did not put the row back in the disclosure');
      if (again.disabled) throw new Error('the re-archived row reopened with a DISABLED Restore (the stale setIfChanged cache): ' + JSON.stringify(again));
      await page.click('#pj-arch-list [data-restore]');
      await page.waitForTimeout(400);
      const finalBack = await page.evaluate(() => !!document.querySelector('#pj-list [data-project="quarterclose"]'));
      if (!finalBack) throw new Error('the second restore did not return the project');
      // 8h. The ARCHIVED project's detail (reachable via pjAnswerFrom in the
      // product): the screen states the fact and flips the control -- and on
      // a restore whose RE-READ fails, every element tells the same story:
      // the write landed, the read did not, and "Restored." appears nowhere.
      // The two prior review rounds both found their blocker in a path this
      // harness did not visit; this is that path.
      await api('/api/project/' + encodeURIComponent('quarterclose'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      await page.waitForTimeout(200);
      // The page's copy of PROJECTS predates the API archive; the product's
      // own poll would catch up in 5s, but the harness reloads deliberately
      // so the detail is painted from the archived record.
      await page.evaluate(() => loadProjects());
      await page.waitForTimeout(400);
      await page.evaluate(() => { openProject('quarterclose'); });
      await page.waitForTimeout(300);
      // The archive statement and control live in Project settings now;
      // the whole 8h block stays on that view.
      await page.click('#pj-settings-link');
      await page.waitForTimeout(200);
      const archDetail = await page.evaluate(() => ({
        label: document.getElementById('pj-one-archive-label').textContent,
        btn: document.getElementById('pj-one-archive').textContent,
      }));
      if (archDetail.label !== 'This project is archived' || archDetail.btn !== 'Restore it') {
        throw new Error('the archived detail does not state its own fact: ' + JSON.stringify(archDetail));
      }
      // The failed-PUT direction first (round 8: both failure arms dropped
      // the keyboard and left the control unmarked while the success arms
      // had been fixed one by one).
      await page.route('**/api/project/*', (r) => r.fulfill({ status: 500, json: { error: 'stubbed put' } }));
      await page.click('#pj-one-archive');
      await page.waitForTimeout(400);
      const failedPut = await page.evaluate(() => ({
        msg: document.getElementById('pj-one-archive-msg').textContent,
        btn: document.getElementById('pj-one-archive').textContent,
        focusOnBody: document.activeElement === document.body,
      }));
      await page.unroute('**/api/project/*');
      if (!failedPut.msg) throw new Error('a failed PUT said nothing');
      if (!/failed/i.test(failedPut.btn)) throw new Error('a failed PUT left the control unmarked: ' + JSON.stringify(failedPut));
      if (failedPut.focusOnBody) throw new Error('a failed PUT dropped the keyboard to body');
      await page.route('**/api/projects', (r) => r.fulfill({ status: 500, json: { error: 'stubbed' } }));
      await page.click('#pj-one-archive');
      await page.waitForTimeout(500);
      const failedRead = await page.evaluate(() => ({
        archMsg: document.getElementById('pj-one-archive-msg').textContent,
      }));
      if (/^Restored\.$/.test(failedRead.archMsg.trim())) {
        throw new Error('a restore with a failed re-read still claimed "Restored." beside a page that says archived');
      }
      if (!/saved/.test(failedRead.archMsg) || !/could not re-read/.test(failedRead.archMsg)) {
        throw new Error('the failed-re-read note does not name both halves (write landed, read did not): ' + JSON.stringify(failedRead));
      }
      // ⚠️ The note may not describe the SCREEN (review round 5): "this page
      // may still show it archived" became false when the next poll
      // repainted the control around it. Held to the disclosure's standard,
      // and then the recovery is DRIVEN: unroute, force a read, and the
      // sentence must still be true beside the repainted control.
      if (/this page|above|below/.test(failedRead.archMsg)) {
        throw new Error('the detail note references the current screen, which the next poll repaints: ' + JSON.stringify(failedRead));
      }
      await page.unroute('**/api/projects');
      await page.evaluate(() => loadProjects());
      await page.waitForTimeout(400);
      const recovered = await page.evaluate(() => ({
        note: document.getElementById('pj-one-archive-msg').textContent,
        btn: document.getElementById('pj-one-archive').textContent,
        oneMsg: document.getElementById('pj-one-msg').textContent,
      }));
      if (recovered.btn !== 'Archive it') {
        throw new Error('the recovering poll did not repaint the control from the truth: ' + JSON.stringify(recovered));
      }
      const focusAfterDetailRestore = await page.evaluate(() => document.activeElement === document.body);
      if (focusAfterDetailRestore) throw new Error('the detail restore dropped keyboard focus to body');
      if (/this page|above|below|archived list/.test(recovered.note)) {
        throw new Error('the note references the screen, which recovery has repainted: ' + JSON.stringify(recovered));
      }
      if (/We cannot read your projects right now/.test(recovered.oneMsg)) {
        throw new Error('the failure sentence in #pj-one-msg outlived the successful read');
      }
      // The write DID land: the stub's glob (**/api/projects) matches only
      // the LIST endpoint, so the PUT to /api/project/<id> passes through
      // it untouched. A clean reload shows it active again -- which is
      // also the cleanup.
      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const cleanedUp = await page.evaluate(() => !!document.querySelector('#pj-list [data-project="quarterclose"]'));
      if (!cleanedUp) throw new Error('the restore whose re-read failed did not actually land');
      // 8i. The DISCLOSURE restore arm under the same failed re-read: its
      // note must describe the MOMENT and point at nothing, because five
      // seconds after the failure the poll succeeds, repaints the healthy
      // list, and a note referencing "the note above" points at a sentence
      // that no longer exists (review round 4, measured).
      await api('/api/project/' + encodeURIComponent('quarterclose'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      await page.evaluate(() => loadProjects());
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.click('#pj-arch-toggle');
      await page.waitForTimeout(200);
      await page.route('**/api/projects', (r) => r.fulfill({ status: 500, json: { error: 'stubbed' } }));
      await page.click('#pj-arch-list [data-restore]');
      await page.waitForTimeout(600);
      const discFailed = await page.evaluate(() => ({
        note: document.getElementById('pj-list-msg').textContent,
        wrapHidden: document.getElementById('pj-arch-wrap').hidden,
        focusOnBody: document.activeElement === document.body,
        focusTag: document.activeElement.tagName,
      }));
      await page.unroute('**/api/projects');
      if (!/restore saved, but we could not re-read/.test(discFailed.note)) {
        throw new Error('the disclosure arm did not say which half failed: ' + JSON.stringify(discFailed));
      }
      if (/above|below/.test(discFailed.note)) {
        throw new Error('the note points at another element, which the next successful poll will erase: ' + JSON.stringify(discFailed));
      }
      // The list error path withdraws the disclosure WITH the list (round
      // 7: asserting an enabled button inside a hidden wrap measured a
      // property the person cannot reach), so the honest assertions are:
      // the section is off screen, and the keyboard did not die with it.
      if (!discFailed.wrapHidden) {
        throw new Error('the disclosure stayed on screen beside a list saying we could not read: ' + JSON.stringify(discFailed));
      }
      if (discFailed.focusOnBody) {
        throw new Error('the keyboard died with the withdrawn section: ' + JSON.stringify(discFailed));
      }
      // The recovery is DRIVEN here too (round 6: 8h proved its arm across
      // the recovering poll and 8i jumped straight to a goto that wiped
      // the note): force a successful read and the moment sentence must
      // still be true beside the repainted list.
      await page.evaluate(() => loadProjects());
      await page.waitForTimeout(400);
      const discRecovered = await page.evaluate(() => ({
        note: document.getElementById('pj-list-msg').textContent,
        rowBack: !!document.querySelector('#pj-list [data-project="quarterclose"]'),
      }));
      if (!discRecovered.rowBack) throw new Error('the recovering poll did not repaint the restored row');
      if (/above|below|this page|archived list/.test(discRecovered.note)) {
        throw new Error('the disclosure note references the screen after recovery: ' + JSON.stringify(discRecovered));
      }
      await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const discCleaned = await page.evaluate(() => !!document.querySelector('#pj-list [data-project="quarterclose"]'));
      if (!discCleaned) throw new Error('the disclosure restore whose re-read failed did not actually land');
      // 8j. The scroll pad clears the bar at the widths where the header
      // WRAPS (review rounds 4-5: one value measured at one width put focus
      // 22px under the bar at 400). Measured, not trusted from the comment.
      for (const w of [1280, 420, 400]) {
        await page.setViewportSize({ width: w, height: 700 });
        await page.waitForTimeout(250);
        const pad = await page.evaluate(() => ({
          bar: Math.round(document.querySelector('.apphead').getBoundingClientRect().height),
          pad: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
        }));
        if (pad.pad < pad.bar) {
          throw new Error(`at ${w}px wide the scroll pad (${pad.pad}) is under the bar (${pad.bar}): focus scrolls beneath it`);
        }
      }
      await page.setViewportSize({ width: 1280, height: 520 });
      console.log('✔ 8-shell (sticky bar, K mark, members wording, scoped toggles, archive/restore, same-day re-archive, BOTH restore arms under a failed re-read, and the pad clears the bar at wrapped widths)');
    } finally {
      await ctx.close();
    }
  }

  // 9. Evidence shots for the two new resting states.
  {
    const all = await api('/api/projects');
    const q = (all.projects || []).find((p) => p.name === 'Quarter close');
    if (!q) throw new Error('the shot fixture is gone: Quarter close is not in the list');
    await api('/api/project/' + encodeURIComponent(q.id), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    await shot('8-archived', async (page) => {
      await page.click('#pj-arch-toggle');
      await page.waitForTimeout(200);
    });
    await api('/api/project/' + encodeURIComponent(q.id), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    });
    await shot('9-grid-view', async (page) => {
      await page.click('.viewtoggle[data-scope="projects"] [data-layout="grid"]');
      await page.waitForTimeout(200);
    });
  }

  // ⚠️ The fixture folders live in the REAL home, because the folder browser is
  // rooted there and a fixture in /tmp could not be reached by the thing under
  // test. That makes cleaning them up part of the run rather than an
  // afterthought -- a check that litters the operator's home every time it is
  // run is a check people stop running.
  await browser.close();

  const withErrors = shots.filter((s) => s.errors.length);
  console.log(`\n${shots.length} screenshots in ${OUT}`);
  console.log(withErrors.length
    ? `⚠️ ${withErrors.length} had console errors`
    : 'no console errors on any state');
  if (withErrors.length || contrastFails || overflows) process.exitCode = 1;
}

// ⚠️ In a `finally`. The fixture tree lives in the operator's REAL home
// (the folder browser is rooted there, so a fixture in /tmp could not be
// reached by the thing under test), and a throw anywhere in the run used to
// leave it behind -- after which the guard that refuses to reuse a folder it
// did not create rejected every subsequent run until somebody deleted it by
// hand. `assertSandboxed` cleans its own probe in a finally; this is the same
// obligation for the bigger tree.
main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    if (OURS) {
      try { fs.rmSync(OURS, { recursive: true, force: true }); } catch { /* nothing to clean */ }
    }
    // ⚠️ The browser dies HERE, not only on the happy path: every throw
    // inside main() used to leave Chromium attached and node resident
    // forever -- an unattended loop reads a hang as "still running", never
    // as red (one such run sat for 2 days 23 hours on this machine,
    // measured by the round-2 reviewer).
    if (BROWSER) {
      try { await BROWSER.close(); } catch { /* already down */ }
    }
  });
