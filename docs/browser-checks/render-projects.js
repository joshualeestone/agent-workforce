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
    throw new Error(`${demo} already exists; this check creates and deletes that folder, so it will not touch yours. Move it aside and re-run.`);
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
          onRow: row ? ((row.querySelector('.pj-desc') || {}).textContent || null) : null,
          rowHasBold: row ? Boolean(row.querySelector('.pj-desc b')) : null,
          bareHasDesc: bare ? Boolean(bare.querySelector('.pj-desc')) : null,
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
      // The DETAIL's absence arm, exercised, not inferred from the row's: an
      // undescribed project's detail must hide the element (hidden === true),
      // which is the arm the markup comment says the toggle exists for.
      await page.click('#pj-back');
      await page.waitForTimeout(200);
      await page.click('[data-project="reedhandover"]');
      await page.waitForTimeout(300);
      const bareDetail = await page.evaluate(() => {
        const el = document.getElementById('pj-one-desc');
        return { hidden: el ? el.hidden : null, text: el ? el.textContent : null };
      });
      if (bareDetail.hidden !== true) {
        throw new Error('an undescribed project’s detail did not hide the description element: ' + JSON.stringify(bareDetail));
      }
      // A description AT THE CAP stays one line on the row: nowrap+ellipsis
      // is a claim about rendering, and no fixture carried a long sentence.
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
        const el = row && row.querySelector('.pj-desc');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
          truncated: el.scrollWidth > el.clientWidth,
          whiteSpace: cs.whiteSpace,
        };
      });
      if (!longRow) throw new Error('the 200-char description never rendered on its row');
      if (longRow.lines !== 1 || longRow.whiteSpace !== 'nowrap' || !longRow.truncated) {
        throw new Error('a description at the cap did not truncate to one row line: ' + JSON.stringify(longRow));
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
    // The list carries `.pj-warn` (the missing folder, left missing above); the
    // one-project view carries the member and told copy. Both are needed, so
    // the members are read first and the list rules are read before the click.
    const listEls = await page.evaluate(() => {
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
      for (const sel of ['#panel-projects .pj-warn', '#panel-projects .pj-row .pj-desc']) {
        const el = document.querySelector(sel);
        if (!el || !el.offsetParent) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        out.push({ sel, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
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
    const badFolderEls = await page.evaluate(() => {
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
      for (const sel of ['#pj-one-view .pj-folder-state.bad']) {
        const el = document.querySelector(sel);
        if (!el || !el.offsetParent) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        out.push({ sel, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight });
      }
      return out;
    });
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
      // ⚠️ The two rules whose whole job is to look DIFFERENT from a healthy
      // row are measured elsewhere, because neither exists on this screen:
      // `.pj-warn` in the `listEls` pass above (it is a list row), and
      // `.pj-folder-state.bad` in the `badFolderEls` pass below, while the
      // project whose folder is missing is open. This list is the one-project
      // view of a HEALTHY project, so it cannot carry either.
      for (const sel of ['#panel-projects .pj-folder', '#panel-projects .pj-member b',
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
    for (const e of [...listEls, ...badFolderEls, ...els]) {
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
