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
 *     AGENT_WORKFORCE_PROJECTS="$SB/kosmos-projects" \
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
 * ⚠️ THE OUTPUT FILENAMES MATCH THE ONES COMMITTED UNDER docs/screenshots/, on
 * purpose. They did not, and a screenshot in the repo is evidence only if the
 * next person can regenerate the same picture — copying `thread-4-failed.png`
 * onto `thread-3-could-not-deliver.png` by hand is a step nobody will
 * reproduce, and a mismatched pair is how a stale image outlives the screen it
 * claims to show.
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
function check(ok, what, detail) {
  // `detail` prints only on failure (round 28: one caller already passed a
  // third argument and it was silently dropped, so the diagnostic that
  // would say WHICH condition failed never printed).
  const line = ok || !detail ? what : `${what}  <- ${detail}`;
  if (ok) process.stdout.write(`  ✔ ${what}\n`);
  else { failures.push(line); process.stdout.write(`  ✘ ${line}\n`); }
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
  /**
   * ⚠️ THE LOG HAS TO BE THIS SERVER'S LOG, and the first version of this guard
   * never checked that it was. It read any file containing the fixture's
   * announcement and then drove `BASE` — so a stale log from an earlier run,
   * beside a plain `node server.js` on the port actually being driven, passed
   * the refusal and pressed Send against the real machine. A guard that reads
   * one thing and vouches for another is not a guard; it is a sentence.
   *
   * The fixture prints the port it bound, so the two are tied by comparing it
   * to the port being driven.
   */
  const announced = text.match(/thread-server: fixture fleet on (\d+)/);
  const fleetLine = text.match(/thread-server: ((?:[^\s=]+=[^\s]+ ?)+)/);
  if (!announced) {
    throw new Error(`${LOG} is not a thread-server log, so nothing proves this server's send seam is stubbed. Refusing.`);
  }
  let drivingPort;
  try { drivingPort = new URL(BASE).port; } catch { drivingPort = null; }
  if (!drivingPort || drivingPort !== announced[1]) {
    throw new Error(
      `${LOG} is the log of a fixture server on port ${announced[1]}, but this check is driving `
      + `${BASE}. Nothing proves the server being driven has its send seam stubbed, and a send `
      + 'against a real one types into a live agent. Refusing.',
    );
  }
  return fleetLine ? fleetLine[1].trim() : null;
}

/**
 * ⚠️ THE SERVER ANSWERING THE PORT, not only the log beside it. The port
 * comparison above still passes when a fixture died and a plain
 * `node server.js` took the same port next to the stale log -- the exact
 * one-layer-in version of the hazard the docstring above records. The
 * fixture's ROSTER is its identity: it announces its invented fleet in the
 * log, and a real server on this machine answers /api/status with the LIVE
 * fleet, which cannot equal the fixture's names and states. So the roster
 * the driven server actually serves is compared against the announcement
 * before anything presses Send.
 */
async function assertDrivenServerIsTheFixture(announcedFleet) {
  if (!announcedFleet) {
    throw new Error('the fixture log carries no fleet announcement line, so the driven server cannot be identified. Refusing.');
  }
  const res = await fetch(BASE + '/api/status');
  const body = await res.json();
  const served = (body.agents || []).map((a) => `${a.name}=${a.state}`).sort().join(' ');
  const wanted = announcedFleet.split(/\s+/).sort().join(' ');
  if (served !== wanted) {
    throw new Error(
      'the server being driven does not serve the fixture fleet the log announces '
      + `(served: ${served || '(nothing)'} | announced: ${wanted}). A real server here would mean `
      + 'Send types into a live agent. Refusing.',
    );
  }
}

/**
 * The data directory of the server we are DRIVING, from its own announcement.
 *
 * ⚠️ Read from the log rather than taken as an argument, for the same reason
 * the port is: two of the checks below reach into the server's store to arrange
 * a state, and a path handed in on faith could be any store on the machine —
 * including the operator's real one. `assertFixtureServer` has already tied
 * this log to the port being driven, so the path in it belongs to the server we
 * are talking to.
 */
function fixtureStore() {
  const said = fs.readFileSync(LOG, 'utf8').match(/thread-server: data (.+)/);
  return said ? said[1].trim() : null;
}

/**
 * The engine's thread module, pointed at the FIXTURE store.
 *
 * ⚠️ THE ENV MUST BE SET BEFORE THE REQUIRE, AND THIS IS WHY IT IS A FUNCTION.
 * `engine/store.js` resolves its root ONCE, at require time. A first version of
 * the checks below set `AGENT_WORKFORCE_DATA` and then required — the wrong way
 * round — so `threadFile` resolved against the operator's REAL application
 * support directory, and the check planted a lock directory in it. It was
 * removed by the step's own `finally`, and it left an empty `chats/` folder
 * behind in somebody's real store. A browser check reaching outside its
 * sandbox is the same defect this whole file exists to prevent in the product.
 *
 * ⚠️ AND IT REFUSES rather than trusting the ordering held. The resolved path
 * is compared to the fixture store the server announced, so if this is ever
 * called too late, or the env is lost, it stops instead of writing somewhere
 * real. The rule this repo already applies to its suites — sandbox every root
 * the code writes to — applies to the tools that inspect it.
 */
function fixtureChat(store) {
  if (!store) throw new Error('the fixture server did not announce its data dir; refusing to touch any store');
  process.env.AGENT_WORKFORCE_DATA = store;
  // eslint-disable-next-line global-require
  const chat = require('../../engine/chat');
  const probe = chat.threadFile('sandboxprobe', 'casey');
  if (!path.resolve(probe).startsWith(path.resolve(store))) {
    throw new Error(
      `engine/chat resolved a thread path to ${probe}, which is OUTSIDE the fixture store ${store}. `
      + 'Its root was fixed at require time, before AGENT_WORKFORCE_DATA was set. Refusing to write anywhere.',
    );
  }
  return chat;
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
  const announcedFleet = assertFixtureServer();
  await assertDrivenServerIsTheFixture(announcedFleet);
  fs.mkdirSync(OUT, { recursive: true });

  /**
   * ⚠️ START FROM NOTHING, so the check can be run twice.
   *
   * Without this the second run died at creation with "that folder is already
   * the project Henderson lease" — correct product behaviour, and a confusing
   * failure to meet when you are re-running to confirm a fix. Safe here and
   * nowhere else: `assertFixtureServer` has already proved this server is the
   * sandboxed fixture, so these are fixture projects rather than somebody's.
   */
  for (const p of (await api('/api/projects')).projects || []) {
    await api(`/api/project/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
  }

  // A project with all three agents on it, made through the real route.
  const made = await post('/api/projects', {
    name: 'Henderson lease',
    // The announced store dir, NOT process.env (round 40): this process is
    // not documented to have AGENT_WORKFORCE_DATA exported, so the fixture
    // folder silently depended on the operator's shell. `fixtureStore()`
    // parses the dir the server itself announced; tmpdir stays the fallback.
    folder: fixtureStore() || require('node:os').tmpdir(),
    // MyBot is here so the unfilable-name screen can be driven; see 5f.
    // `stopped` has no fleet card and no fixture screen at all: it drives
    // the screen-read-FAILED state (round 30), the ordinary state of a
    // member whose agent has gone.
    agents: ['mara', 'casey', 'nils', 'MyBot', 'stopped'],
  });
  const id = (made.project && made.project.id) || made.id;

  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  /* ⚠️ Console errors and page exceptions are CAPTURED and failed (round
     40), like render-projects does: a thrown exception in this screen's
     renderer that does not happen to stall a waitForFunction otherwise
     goes unreported, on the renderer this branch wrote from scratch. */
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  /* One named exemption: opening an UNTIED agent's panel (the rook
     check) fires the removal probe, whose refusal for untied agents is
     a 400 by design and logs as a failed-resource console error --
     pre-existing product behavior this drive newly exercises, recorded
     rather than silenced wholesale. Everything else still fails the
     run. */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource.*400/.test(m.text()) && /removal/.test(m.location().url || '')) return;
    pageErrors.push(m.text());
  });

  try {
    /* ── 0. Engineering mode: Off hides the raw screen; this drive's
       screen sections need it ON. Asserted in BOTH states rather than
       just flipped: with the switch off (the shipped default) the
       viewport container is hidden, the question panel and teaching
       line still render (safety, not chrome), and an UNCONFIRMED send's
       verdict points at checking with the agent, never "below" at a
       screen the mode has hidden -- the eng-mode chunk's whole claim on
       this page, each half driven rather than narrated. Flipped through
       the real route, not by poking state. ─────────────────────────── */
    await page.goto(BASE + '?tab=projects', { waitUntil: 'networkidle' });
    // Set Off through the real route first (a fixture server that
    // outlives a previous run may hold a flipped switch), then assert
    // the hiding -- the claim is Off-hides, however Off was reached.
    await page.evaluate(async () => {
      await fetch('/api/engmode', { method: 'PUT',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) });
    });
    await page.goto(BASE + '?tab=projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const offState = await page.evaluate(() => ({
      vpHidden: document.querySelector('.pj-viewport').hidden,
    }));
    check(offState.vpHidden === true, 'the raw screen is hidden while Engineering mode is off');
    // The mode-independence half, IN Off where it matters: the question
    // panel and the number-answer teaching line are safety, not chrome,
    // and must render with the raw screen away.
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.acard[data-agent="mara"] .ansgo', { timeout: 10000 });
    await page.click('.acard[data-agent="mara"] .ansgo');
    await page.waitForFunction(() => {
      const q = document.getElementById('pj-question');
      return q && !q.hidden && (document.getElementById('pj-question-text').textContent || '').length > 0;
    }, null, { timeout: 10000 });
    const offQuestion = await page.evaluate(() => ({
      vpHidden: document.querySelector('.pj-viewport').hidden,
      teachShown: !document.getElementById('pj-answer-how').hidden,
      teachText: document.getElementById('pj-answer-how').textContent,
    }));
    check(offQuestion.vpHidden === true, 'the raw screen stays hidden while a question is open in Off');
    check(offQuestion.teachShown === true, 'the number-answer teaching line renders in Off, where it is needed most');
    check(/Answer by sending the number/.test(offQuestion.teachText),
      'and it carries the ruled wording', offQuestion.teachText);
    // The Off arm of the verdict pointer, DRIVEN: the ambiguous-send
    // fixture produces the unconfirmed verdict, and in Off it must send
    // the person to the agent, not "below" to a hidden screen.
    await page.selectOption('#pj-thread-who', 'casey');
    // In Off the screen label rightly claims nothing (the served window
    // is gated), so there is no label to wait on: the settle is a plain
    // beat for the thread refetch, the one timing-shaped wait in this
    // file and named as such.
    await page.waitForTimeout(600);
    await page.fill('#pj-say', 'ambiguous while off');
    await page.click('#pj-send');
    await page.waitForFunction(() => /Could not confirm/i.test(
      document.getElementById('pj-thread-msg').textContent || ''), null, { timeout: 10000 });
    const offUnsure = await page.locator('#pj-thread-msg').textContent();
    check(/check whether it already arrived/i.test(offUnsure),
      'the Off verdict tells the person to check with the agent', offUnsure);
    check(!/screen is below/i.test(offUnsure),
      'and never points below at a screen the mode has hidden', offUnsure);
    const flipped = await page.evaluate(async () => {
      const r = await fetch('/api/engmode', { method: 'PUT',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) });
      return r.ok;
    });
    check(flipped === true, 'the switch actually flipped On before the screen sections (a silent failure here reds them with wrong-cause messages)');

    /* ── 1. the one click out of the stranded state ─────────────────────── */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.acard', { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-0-needs-you-card.png'), fullPage: true });

    const answerBtn = page.locator('.acard[data-agent="mara"] .ansgo');
    check(await answerBtn.count() === 1, 'the "Needs you" card carries exactly one way into the question');
    check(await page.locator('.acard[data-agent="nils"] .ansgo').count() === 0,
      'a card that is NOT asking anything does not offer to show a question');

    /* ⚠️ THE BORROWED-NAME CARD, as the pipeline actually serves it.
       MEASURED (round 13): an untied pane's state is forced to `unknown`
       upstream -- capture is refused for a pane we cannot tie -- so
       `needs_you` cannot reach an untied card through real routes, and the
       button's tie gate (`&& a.isNamedOurs`) is defence-in-depth whose
       enforcement lives in server.test.js's source pin, not here (a render
       check cannot drive a shape the producer refuses to produce). What IS
       asserted here: the untied card is on the board (the fixture's whole
       point), the API control confirms it arrives untied with its state
       withheld as unknown, and it carries no way into a question. */
    const rookCard = page.locator('.acard[data-agent="rook"]');
    check(await rookCard.count() === 1, 'CONTROL: the borrowed-name card is on the board at all');
    const rookState = await page.evaluate(async () => {
      const body = await (await fetch('/api/status')).json();
      const rook = (body.agents || []).find((a) => a.sessionName === 'rook');
      return rook ? { state: rook.state, tied: rook.isNamedOurs === true } : null;
    });
    check(rookState !== null && rookState.tied === false && rookState.state === 'unknown',
      'CONTROL: the pipeline serves the borrowed name UNTIED with its state withheld as unknown',
      JSON.stringify(rookState));
    check(await rookCard.locator('.ansgo').count() === 0,
      'a borrowed-name card gets NO "See the question" button');
    // The window box's untied arm, driven (the pass-5 gate would be
    // deletable-green otherwise): opening the borrowed-name panel with
    // Engineering mode ON must hide the box, and never paint a refusal
    // sentence into it about an agent the person is looking at.
    await rookCard.click();
    await page.waitForSelector('#panel-detail:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(700);
    const rookWindow = await page.evaluate(() => ({
      boxHidden: document.getElementById('d-window-box').hidden,
      msgText: document.getElementById('d-window-msg').textContent,
    }));
    check(rookWindow.boxHidden === true,
      'an untied agent\u2019s panel hides the window box (nothing here is its window to show)', JSON.stringify(rookWindow));
    await page.click('#detail-back');
    await page.waitForTimeout(300);

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
    check(await page.evaluate(() => !document.getElementById('pj-answer-how').hidden),
      'the teaching line renders in On too: mode-independent, like the panel it serves');
    // ⚠️ And FOCUS lands there too (round 30, measured): the card that
    // carried the button is torn down on the tab switch, so activation
    // used to leave activeElement on <body> -- a keyboard user had to
    // re-traverse the whole page to reach the question they clicked for,
    // and this file only ever asserted the box was REACHABLE, never that
    // focus moved.
    const focusedId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check(focusedId === 'pj-question-text',
      'and keyboard focus moves to the question, not back to the top of the document',
      `activeElement is ${focusedId || '(body)'}`);
    check(/replace the old summary file/.test(question), 'and on the run-up that says what it is asking about');

    const qBox = await reallyVisible(page, '#pj-question-text');
    check(qBox.there && qBox.w > 200 && qBox.h > 40 && qBox.opacity === 1,
      `the question box is really on screen (${qBox.w}x${qBox.h}, opacity ${qBox.opacity})`);

    /* ── 2. one agent answers, and it is the manager ────────────────────── */
    const who = await page.locator('#pj-thread-who').inputValue();
    check(who === 'mara', `the thread is addressed to one agent, and it is the one asking (${who})`);
    const options = await page.locator('#pj-thread-who option').allTextContents();
    check(options.length === 5, 'the other agents on the project are visible in the picker, and silent');
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
    /**
     * ⚠️ AND THE `pre` SCROLLS INSIDE ITSELF, which is the other half of the
     * same property and was computed here and then never asserted — a value
     * measured, carried, and dropped, which is indistinguishable from not
     * measuring it. The two together are the actual requirement: this fixture's
     * terminal line is wider than the box, so the box MUST have somewhere to
     * put it, and the page must NOT be that somewhere.
     */
    check(overflow.screen === true,
      'the terminal box scrolls its own content sideways, rather than stretching the page');

    /* ── 4. sending ─────────────────────────────────────────────────────── */
    const before = sentKeys().length;
    await page.fill('#pj-say', '1');
    await page.click('#pj-send');
    await page.waitForFunction(() => document.querySelectorAll('.pj-msg').length > 0, null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-2-sent-placed.png'), fullPage: true });

    const keys = sentKeys().slice(before);
    check(keys.length === 2, `a send is two tmux calls, the text then Enter (saw ${keys.length})`);
    check(keys[0] && keys[0][keys[0].length - 1] === '1',
      'the text that reached the seam is the text that was typed into the box');
    check(keys[0] && keys[0][2] === '=mara-discord:0.0',
      `and it was aimed at the exact pinned pane (${keys[0] && keys[0][2]})`);
    check(keys[1] && keys[1][keys[1].length - 1] === 'Enter', 'and Enter was a separate call');

    const said = await page.locator('.pj-msg .pj-msg-said').first().textContent();
    check(/Placed into Mara’s session/.test(said), `the verdict is about the keystroke: "${said}"`);
    // ⚠️ AND WHAT IT WAS DOING. "Placed into Mara's session" is exactly true and
    // invites the wrong inference — that Mara is reading it. Mara is showing a
    // question, so the clause has to say what was observed rather than what the
    // keystroke did to it.
    check(/waiting on an answer when this was sent/.test(said),
      'the verdict says what the agent was doing when the message was typed');
    check(!/answered its question|it will answer/i.test(said),
      'the clause stays a claim about the screen, never about what the keystroke did to it');
    // ⚠️ THE CLAIM CHECK. This whole feature's discipline is what the screen is
    // allowed to say. A tick, or the words "received"/"read", would be a claim
    // about a program's understanding that a keystroke cannot support.
    const panelText = await page.locator('#pj-thread').textContent();
    check(!/\breceived\b|\bhas read\b|\bread it\b|\bgot it\b/i.test(panelText),
      'nothing on this screen says the agent received or read anything');

    const box = await page.locator('#pj-say').inputValue();
    check(box === '', 'a delivered message is cleared from the box');

    // ⚠️ The sideways-scroll assertion in section 3 ran on a page with NO
    // message rows, so it could not fail on a row defect: it was aimed at an
    // input that answers a different question (round 21, which measured a
    // 300-character token stretching the page 1262px past it, all greens).
    // This is the message-row half of the same property the deliberate wide
    // terminal line in the fixture holds for the screen boxes: a send whose
    // text is one long unbroken token -- a URL, the exact thing people type
    // to agents -- must wrap inside its row rather than drag the page.
    const LONG_TOKEN = 'https://example.com/' + 'a'.repeat(300) + '/report.md';
    await page.fill('#pj-say', LONG_TOKEN);
    await page.click('#pj-send');
    await page.waitForFunction(() => document.querySelectorAll('.pj-msg').length > 1, null, { timeout: 10000 });
    const rowOverflow = await page.evaluate(() =>
      document.body.scrollWidth - document.body.clientWidth);
    check(rowOverflow <= 0,
      `a message that is one long unbroken token wraps in its row instead of stretching the page (overflow ${rowOverflow}px)`);

    /* ── 5. a delivery that fails keeps the person's words ──────────────── */
    // ⚠️ A REAL REFUSAL, THROUGH THE WHOLE STACK. `nils`'s pane answers the way
    // tmux answers for a session that has gone since the roster was read, so
    // this exercises the failure sentence the person actually reads rather than
    // one simulated inside the page. The happy path alone would photograph half
    // a feature.
    await page.selectOption('#pj-thread-who', 'nils');
    await page.waitForFunction(() => /Nils/.test(
      document.getElementById('pj-screen-label').textContent || ''), null, { timeout: 10000 });
    // The count BEFORE this send: the comment below promises a delta and the
    // assertion was an absolute, which is the sibling's exact lesson unapplied.
    const failedBefore = await page.locator('.pj-msg.failed').count();
    await page.fill('#pj-say', 'and this one cannot get through');
    await page.click('#pj-send');
    await page.waitForFunction(() => /Could not deliver/i.test(
      document.getElementById('pj-thread-msg').textContent || ''), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-3-could-not-deliver.png'), fullPage: true });

    const failedSaid = await page.locator('#pj-thread-msg').textContent();
    check(/can't find pane/.test(failedSaid), `the refusal carries what tmux said: "${failedSaid}"`);
    const kept = await page.locator('#pj-say').inputValue();
    check(kept === 'and this one cannot get through',
      'a message that did not go through is still in the box, not thrown away');
    // And the attempt is kept in the thread, drawn differently from one that
    // landed: a thread that remembers only its successes rewrites its history.
    //
    // ⚠️ COUNTED AS A DELTA, not as an absolute. Clearing the projects does not
    // clear the THREADS — a project id is derived from its name, so a re-run
    // rebuilds the same id and lands on the previous run's file (superseded on
    // the first send now, rather than inherited). An
    // absolute count passed on the first run and then climbed (saw 2, saw 3),
    // which is a check measuring its own history rather than this send. The
    // property is "this send added one row of this kind", and that is immune.
    const failedAfter = await page.locator('.pj-msg.failed').count();
    check(failedAfter - failedBefore === 1,
      `this send added exactly one failed row (${failedBefore} -> ${failedAfter})`);

    /* ── 5b. a send we could not confirm is not drawn as a failure ──────── */
    /**
     * ⚠️ THE STATE THAT IS HARDEST TO GET RIGHT ON SCREEN. `casey`'s pane takes
     * the text and refuses the Enter, so the words are in its composer and we
     * cannot say whether they were submitted. If that row draws like the failed
     * one above it, the person reads "it did not go" and sends it again — and a
     * live agent now has the message twice.
     */
    await page.selectOption('#pj-thread-who', 'casey');
    await page.waitForFunction(() => /Casey/.test(
      document.getElementById('pj-screen-label').textContent || ''), null, { timeout: 10000 });
    // The count BEFORE this send — see the note on the failed row above for why
    // an absolute count here measures the check's own history.
    const unsureBefore = await page.locator('.pj-msg.unsure').count();
    await page.fill('#pj-say', 'this one is ambiguous');
    await page.click('#pj-send');
    await page.waitForFunction(() => /Could not confirm/i.test(
      document.getElementById('pj-thread-msg').textContent || ''), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-4-could-not-confirm.png'), fullPage: true });

    const unsure = await page.locator('#pj-thread-msg').textContent();
    check(!/could not deliver/i.test(unsure),
      `an ambiguous send is not reported as a failure: "${unsure}"`);
    check(/may be sitting in its composer/.test(unsure), 'and it says where the words might be');
    check(/check there before sending it again/i.test(unsure),
      'and it points somewhere rather than leaving the person to guess');
    // ⚠️ ONE instruction. Three of them stacked is a wall nobody reads, and
    // this line is read at the exact moment somebody is deciding whether to
    // press Send a second time.
    const tells = (unsure.match(/before sending it again/gi) || []).length;
    check(tells === 1, `it tells the person what to do exactly once (saw ${tells})`);
    /**
     * ⚠️ AND IT READS AS PROSE. The engine's reasons are written as CLAUSES, so
     * pasting one after a full stop produced "…until it finishes). it went into
     * its window…" on screen — with every assertion in the suite green.
     * `renderConnection` has a paragraph about this exact defect further up the
     * page, and this branch committed it again anyway. Reading the rendered
     * sentence is what caught it both times, so the reading is now a check.
     */
    check(!/\.\s+[a-z]/.test(unsure), `every sentence starts upper case: "${unsure}"`);
    // ⚠️ AND THE MESSAGE LIST, not only the live line. The lower-case-clause
    // defect reappeared in #pj-msgs at a call site that skipped pjSentence, so
    // the assertion follows it there.
    const msgsText = (await page.locator('#pj-msgs').textContent()) || '';
    check(!/\.\s+[a-z]/.test(msgsText), `no sentence in the thread starts lower case: "${msgsText.slice(0, 160)}"`);
    check(!/\.\./.test(msgsText), 'no sentence in the thread is double-stopped');
    check(/mid-task/.test(unsure), 'and it still says what the agent was doing');
    // ⚠️ DRAWN as a third thing. Same class as the failed row and the person
    // reads it as a failure whatever the words say — this repo has shipped a
    // sentence nobody read because the picture said otherwise.
    const rows = await page.evaluate(() => ({
      unsure: document.querySelectorAll('.pj-msg.unsure').length,
      failed: document.querySelectorAll('.pj-msg.failed').length,
      unsureBorder: (() => {
        const el = document.querySelector('.pj-msg.unsure');
        return el ? getComputedStyle(el).borderStyle : null;
      })(),
    }));
    check(rows.unsure - unsureBefore === 1,
      `this send added exactly one unconfirmed row (${unsureBefore} -> ${rows.unsure})`);
    // ⚠️ Casey's thread is its own file, so nothing failed can be in it — the
    // failed send went to Nils. An unconfirmed row rendering as a failure here
    // is the defect this whole state exists to prevent.
    check(rows.failed === 0, 'the unconfirmed send is not also drawn as a failure');
    check(rows.unsureBorder !== null && !/dashed/.test(rows.unsureBorder),
      `and it does not wear the failed row's dashed border (${rows.unsureBorder})`);
    // ⚠️ The box is CLEARED here, on purpose: a re-send has to be a decision
    // rather than a second click, and the message is in the thread verbatim.
    check(await page.locator('#pj-say').inputValue() === '',
      'the box is cleared, so re-sending text that may already be in the composer takes a retype');

    /* ── 5b2. the verdict line ages with the rows ───────────────────────── */
    /**
     * ⚠️ IT SAID "just now" FOREVER while the row above it moved on to "2
     * minutes ago" — two claims about one send, on one screen, disagreeing, and
     * the frozen one was the sentence the person had just read. Driven by
     * back-dating the stamp the page holds and letting the real poll re-render.
     */
    const aged = await page.evaluate(async () => {
      const line = document.getElementById('pj-thread-msg');
      const before = line.textContent;
      // Ten minutes ago, which pjWhen renders as a wall-clock time.
      PJ_SENT_LINE.at = new Date(Date.now() - 600000).toISOString();
      await loadThread();
      return { before, after: line.textContent };
    });
    check(/just now/.test(aged.before), 'the control: the line said "just now" when it was sent');
    check(!/just now/.test(aged.after),
      `the verdict line ages rather than saying "just now" forever: "${aged.after.slice(0, 90)}"`);

    /* ── 5c. the recipient cannot change under the person ───────────────── */
    /**
     * ⚠️ THE FLIP THIS PREVENTS, and the mechanism is ordinary rather than
     * exotic. `defaultAgent` is re-derived server-side on every five-second
     * poll, and `describe` withholds an agent's role while its pane is untied —
     * which an agent RESTARTING is, for a moment. So the manager drops out of
     * the manager check, the default falls to whoever is first on the project,
     * and the next repaint moves the picker. Somebody typing a sentence to Mara
     * finishes it addressed to Nils, and the screen gives no sign.
     *
     * Driven against the real page: the poll's own answer is simulated by
     * replacing `PROJECTS` the way a refresh would, then calling the real
     * `loadThread`.
     */
    const flip = await page.evaluate(async () => {
      const before = document.getElementById('pj-thread-who').value;
      const project = PROJECTS.find((p) => p.id === PJ_CURRENT);
      // Exactly what a poll would hand back mid-restart: a different default,
      // and the previous default's role withheld because its pane is untied.
      project.defaultAgent = 'nils';
      const was = project.agents.find((a) => a.sessionName === before);
      if (was) { was.tied = false; was.role = null; }
      await loadThread();
      return { before, after: document.getElementById('pj-thread-who').value };
    });
    check(flip.before === flip.after,
      `the picker stayed on the agent being typed to (${flip.before} -> ${flip.after})`);
    check(flip.after !== 'nils', 'a restarting agent did not re-aim the message at somebody else');

    /* ── 5d. a message we could not RECORD is not claimed to be kept ────── */
    /**
     * ⚠️ THE STATE WHERE THE WORDS EXIST NOWHERE. An `unconfirmed` send used to
     * clear the box AND say "Your message is kept above" — while the sentence
     * two clauses later said we could NOT add it to the conversation. Both
     * copies gone, under a promise that one was safe.
     *
     * Driven for real: a lock directory is planted beside this thread's file, so
     * the route's own recording genuinely fails and the page meets the answer it
     * would meet on the day two windows collided.
     */
    const store = fixtureStore();
    if (store) {
      const chat = fixtureChat(store);
      await page.selectOption('#pj-thread-who', 'casey');
      await page.waitForFunction(() => /Casey/.test(
        document.getElementById('pj-screen-label').textContent || ''), null, { timeout: 10000 });

      const lock = chat.threadFile(id, 'casey') + '.lock';
      fs.mkdirSync(lock, { recursive: true });
      try {
        await page.fill('#pj-say', 'this one cannot be written down');
        await page.click('#pj-send');
        await page.waitForFunction(() => /Could not confirm/i.test(
          document.getElementById('pj-thread-msg').textContent || ''), null, { timeout: 15000 });
        await page.screenshot({ path: path.join(OUT, 'thread-7-unrecorded.png'), fullPage: true });

        const said = await page.locator('#pj-thread-msg').textContent();
        check(/could not add it to this conversation/i.test(said),
          'the page says the message was not recorded');
        check(!/kept above/.test(said),
          'the page does not promise the message is in the thread it was never written to');
        check(await page.locator('#pj-say').inputValue() === 'this one cannot be written down',
          'the only remaining copy of the message is kept in the box');
      } finally {
        fs.rmSync(lock, { recursive: true, force: true });
      }
    } else {
      check(false, 'the fixture server did not publish its data dir, so the unrecorded state was not driven');
    }

    /* ── 5e. a project that reuses an earlier project's name ────────────── */
    /**
     * ⚠️ COMMITTED SCREENSHOTS MUST BE REGENERABLE. `thread-6-reused-name.png`
     * was produced by a one-off script and committed, which this file's own
     * header forbids for exactly the reason it forbids mismatched filenames: an
     * image nothing reproduces is an image that outlives the screen it claims to
     * show. The state is driven here now.
     */
    if (store) {
      const chat = fixtureChat(store);
      const made = await post('/api/projects', { name: 'Reused name', agents: ['mara'] });
      const reusedId = (made.project && made.project.id) || made.id;
      await post(`/api/project/${reusedId}/thread/mara`, { text: 'said to the first project' });
      const file = chat.threadFile(reusedId, 'mara');
      const was = JSON.parse(fs.readFileSync(file, 'utf8'));
      was.projectBornAt = '2020-01-01T00:00:00.000Z';   // an EARLIER project of this name
      fs.writeFileSync(file, JSON.stringify(was));

      await page.goto(`${BASE}?tab=projects`, { waitUntil: 'networkidle' });
      await page.click(`[data-project="${reusedId}"]`);
      await page.waitForFunction(() => /anything from this project/.test(
        document.getElementById('pj-msgs').textContent || ''), null, { timeout: 10000 });
      await page.screenshot({ path: path.join(OUT, 'thread-6-reused-name.png'), fullPage: true });

      const reused = await page.locator('#pj-msgs').textContent();
      check(!/cannot read what you have sent/i.test(reused),
        'the withheld state does not claim we could not read what we read and chose not to show');
      check(!/not saying you have sent nothing/i.test(reused),
        'the withheld state does not deny the one true fact: this project has sent nothing');
      check(/have not sent Mara anything from this project/.test(reused),
        `the withheld state says what is true of THIS project: "${reused.trim()}"`);
      check(!/kept aside/.test(reused),
        'it does not claim an earlier conversation was moved aside before anything moved it');
      check(!/\.\s+[a-z]/.test(reused), `every sentence starts upper case: "${reused.trim()}"`);
    } else {
      // Loud, like 5d above (round 40): without this, a fixture that stops
      // announcing its data dir silently skips the reused-name state and
      // silently stops emitting thread-6-reused-name.png.
      check(false, 'the fixture server did not publish its data dir, so the reused-name state was not driven');
    }

    /* ── 5f. a name we cannot file a conversation under ─────────────────── */
    // Back to the project that has MyBot on it: 5e navigated to a different one.
    await page.goto(`${BASE}?tab=projects`, { waitUntil: 'networkidle' });
    await page.click(`[data-project="${id}"]`);
    await page.waitForSelector('#pj-thread-who', { timeout: 10000 });
    /**
     * ⚠️ THE REGRESSION TEST FOR THIS LIVED IN THE WRONG LAYER. The defect was
     * a PAGE SENTENCE — "Messages you send are delivered to its session",
     * promised from a state that knows nothing about reachability — and the
     * test asserted on the route PAYLOAD, so reverting the exact string left
     * everything green. A guard aimed one layer away from the defect is not a
     * guard.
     *
     * Driven on the rendered page now, which also makes
     * `thread-8-unfilable.png` check-emitted rather than hand-captured.
     */
    await page.selectOption('#pj-thread-who', 'MyBot');
    await page.waitForFunction(() => /MyBot/.test(
      document.getElementById('pj-screen-label').textContent || ''), null, { timeout: 10000 });
    await page.waitForFunction(() => /cannot keep a conversation/.test(
      document.getElementById('pj-msgs').textContent || ''), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'thread-8-unfilable.png'), fullPage: true });

    const unfilable = (await page.locator('#pj-msgs').textContent()) || '';
    check(/nothing sent here is kept/.test(unfilable),
      `the unfilable state says what it knows: "${unfilable.trim()}"`);
    // ⚠️ THE STRING THAT WAS THE DEFECT. Asserted against the whole thread
    // block, not just the one paragraph, because the promise could return
    // anywhere in it.
    const unfilableBlock = (await page.locator('#pj-thread').textContent()) || '';
    check(!/delivered/i.test(unfilableBlock),
      'the unfilable screen promises no delivery it cannot know about');
    // Sending is still offered, because sending still works — only keeping does not.
    check(await page.locator('#pj-say').isEnabled(),
      'the message box is still usable for an agent whose conversation cannot be kept');

    /* ── 5g. a history we could not READ (the third state, driven) ──────── */
    /**
     * ⚠️ The trio's untested third (round 40): historyOther and
     * historyUnfilable were both driven and photographed while
     * `messages === null` -- the arm honesty rule 1 exists for -- was
     * asserted nowhere. Driven for real: the thread file is made
     * unreadable on disk, so the route's own read genuinely fails.
     */
    if (store) {
      const chat = fixtureChat(store);
      await page.selectOption('#pj-thread-who', 'casey');
      const cfile = chat.threadFile(id, 'casey');
      const hadMode = fs.statSync(cfile).mode;
      fs.chmodSync(cfile, 0o000);
      try {
        await page.waitForFunction(() => /cannot read what you have sent/i.test(
          document.getElementById('pj-msgs').textContent || ''), null, { timeout: 15000 });
        await page.screenshot({ path: path.join(OUT, 'thread-10-history-unreadable.png'), fullPage: true });
        const unread = (await page.locator('#pj-msgs').textContent()) || '';
        check(/not saying you have sent nothing/i.test(unread),
          `the unreadable state refuses the empty-list reading: "${unread.trim()}"`);
        check(!/have not sent .* anything/i.test(unread),
          'it does not claim the true-of-a-different-state "you have sent nothing"');
        check(!/EACCES|errno|\/Users\//.test(unread),
          'no errno and no machine path reaches the screen');
      } finally {
        fs.chmodSync(cfile, hadMode);
      }
      // Recovery is part of the state: readable again, the rows return.
      await page.waitForFunction(() => !/cannot read what you have sent/i.test(
        document.getElementById('pj-msgs').textContent || ''), null, { timeout: 15000 });
    } else {
      check(false, 'the fixture server did not publish its data dir, so the unreadable-history state was not driven');
    }

    /* ── 5h. the same screen at a NARROW width ──────────────────────────── */
    /**
     * ⚠️ One width is one data point (round 40): #pj-thread-who and the
     * compose row carry min-width: 220px and the terminal viewport is
     * white-space: pre, so the no-horizontal-overflow property asserted
     * above was established only at 1200. 720 is a real narrow-laptop
     * split-screen width, above the phone layouts this page does not
     * claim, below every width the shots above used.
     */
    await page.setViewportSize({ width: 720, height: 900 });
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth) === 0,
      'no horizontal page overflow on the thread screen at 720 wide',
      String(await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth)) + 'px of overflow');
    await page.screenshot({ path: path.join(OUT, 'thread-11-narrow.png'), fullPage: true });
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(200);

    /* ── 6. contrast, on the rendered page, in both themes ──────────────── */
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(BASE + '?tab=projects', { waitUntil: 'networkidle' });
      await page.waitForSelector('.pj-row', { timeout: 10000 });
      await page.click('.pj-row');
      await page.waitForSelector('#pj-screen', { timeout: 10000 });
      await page.waitForFunction(() => (document.getElementById('pj-screen').textContent || '').length > 0,
        null, { timeout: 10000 });
      await page.screenshot({ path: path.join(OUT, `thread-5-${scheme}.png`), fullPage: true });

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
        if (!el) return { id, there: false, tabIndex: null };
        return { id, there: true, tabIndex: el.tabIndex, hidden: el.hidden };
      });
    });
    /**
     * ⚠️ THE FIRST VERSION MEASURED THE WRONG THING, twice over, and passed
     * with `tabindex="0"` DELETED from the page.
     *
     * `el.focus()` asks whether an element can be focused PROGRAMMATICALLY,
     * which a scrollable div can be either way — it says nothing about whether
     * a person pressing Tab will ever reach it. And Chromium 127+ makes
     * keyboard-focusable scrollers automatic, so the browser under the check
     * disagreed with the browser the product opens in: the installer opens the
     * DEFAULT browser, which on this machine is Safari, where the attribute is
     * load-bearing. A check that passes on the one engine nobody opens this app
     * in is not a check.
     *
     * `tabIndex` is the property the attribute actually sets, read off the live
     * element, and it is the same answer in every engine. The missing-id case
     * is a FAILURE now too: `!f.there || …` passed for an id that is not on the
     * page at all, so renaming an element would have left it reporting itself
     * reachable forever.
     */
    // `hidden` is asserted, not merely captured (round 23): tabIndex reads
    // 0 on a hidden element, so without this half the check would report
    // pj-screen reachable on a page whose screen block is hidden behind
    // "we cannot see its screen right now" -- measured, carried, dropped,
    // the exact shape the overflow check above calls out.
    for (const f of focusable) {
      check(f.there === true && f.tabIndex >= 0 && f.hidden === false,
        `${f.id} is reachable from the keyboard (tabIndex ${f.tabIndex}, ${f.hidden ? 'HIDDEN' : 'visible'})`);
    }
    /* ── the screen-read-FAILED heading (round 30) ──────────────────── */
    // ⚠️ The bold heading used to claim "What stopped's screen shows right
    // now" directly above "We cannot see its screen right now" -- a
    // sentence about a screen nobody read, in the ordinary gone-agent
    // state, and nothing tested or photographed it.
    await page.selectOption('#pj-thread-who', 'stopped');
    await page.waitForFunction(() => /cannot see its screen/.test(
      document.getElementById('pj-screen-hint').textContent || ''), null, { timeout: 10000 });
    const failedState = await page.evaluate(() => ({
      label: document.getElementById('pj-screen-label').textContent,
      hidden: document.getElementById('pj-screen').hidden,
    }));
    check(failedState.hidden === true, 'a member with no readable agent shows no terminal box');
    check(failedState.label === 'Its screen',
      'and the heading over the absent screen claims nothing ("Its screen", no name, no "shows right now")',
      `label reads: ${failedState.label}`);
    await page.screenshot({ path: path.join(OUT, 'thread-9-screen-unread.png'), fullPage: true });
  } finally {
    // The switch goes back Off IN the finally: a thrown section must not
    // hand a long-lived fixture server a flipped mode (section 0 defends
    // inward; this defends whoever comes after, on every exit).
    try {
      await fetch(BASE + '/api/engmode', { method: 'PUT',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) });
    } catch { /* best effort */ }
    await browser.close();
  }

  check(pageErrors.length === 0,
    'no console errors or page exceptions on any driven state', pageErrors.join(' | '));
  process.stdout.write(failures.length
    ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}\n`
    : `\nall checks passed; shots in ${OUT}\n`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  // The check-level diagnostics accumulated before the throw travel with it
  // (round 40): a run that failed checks and THEN threw lost every named
  // failure and reported only the stack.
  if (failures.length) process.stderr.write(`${failures.length} failed before the throw:\n  ${failures.join('\n  ')}\n`);
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
