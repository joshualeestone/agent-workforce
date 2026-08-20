'use strict';
/* The agent page's own thread: the question, the option buttons, the composer,
 * and every state the drawing names, in both themes.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-talk.js
 *      (HEADED=0 on a machine with no console session)
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT EXERCISE. Unlike its siblings here, it does
 * NOT spawn server.js: it loads the page over file:// and answers the poll from
 * fixtures, because the states worth looking at (an agent that cannot be
 * reached, a menu we refused to parse, a store that cannot be written) need a
 * machine state a sandboxed server has no way to be in. So it checks the PAINT
 * and not the route. The route is covered by the suite; the paint is what
 * `node --test` cannot see.
 *
 * It measures IN THE PAGE rather than judging from the picture: scrollWidth vs
 * clientWidth for overflow, computed backgrounds for the transparent-panel
 * class, and elementFromPoint for what is actually on top.
 *
 * ⚠️ TWO THINGS IT LEARNED THE HARD WAY, both of which look like success:
 *   - Its first run screenshotted the FIRST-RUN OVERLAY with all eight states
 *     laid out correctly underneath it, every measurement green. A clip
 *     rectangle does not know what is painted over it.
 *   - Dismissing that overlay is not enough: the app sets `inert` on every body
 *     child while it is up. With inert left on, every elementFromPoint answers
 *     BODY and a Playwright click times out, on a page that screenshots
 *     perfectly. A picture cannot show you that nothing on it can be clicked.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

/**
 * A REAL agent card, from the real producer.
 *
 * ⚠️ NOT HAND-BUILT. `openDetail` reads fields this script has no business
 * knowing about (it wanted `context.percent` first), and a literal invented
 * here is exactly the fixture that made six rounds of review pass against a
 * world that does not exist. This asks `status.snapshot()` for a card off this
 * machine and renames it, so the shape is whatever the board really serves.
 *
 * If the machine is running no agents there is no card, and the reopen check
 * SAYS SO rather than quietly not running.
 */
function realCard() {
  try {
    const status = require(path.join(__dirname, '..', '..', 'engine', 'status.js'));
    const board = status.snapshot();
    const card = (board.agents || []).find((a) => a && a.isNamedOurs === true);
    return card ? { ...card, sessionName: 'april', name: 'April', state: 'needs_you' } : null;
  } catch (err) {
    return null;
  }
}

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'talk-shots-'));

const QUESTION = {
  text: [
    '│ Two of the help docs disagree about the trial. One says 14 days, the',
    '│ other says 30. Which is right?',
    '│',
    '│ ❯ 1. 14 days',
    '│   2. 30 days',
  ].join('\n'),
};

/**
 * ⚠️ EXACTLY THE ROUTE'S OWN PAYLOAD, field for field. The first version also
 * carried `agent`, `viewport` and `agentsUnreadable` — three fields the route
 * deliberately does NOT serve, and whose absence `server.projects.test.js`
 * pins. A fixture that invents fields the producer does not make is how six
 * rounds of review passed against a world that does not exist (see the note at
 * `safeRoster`), and nothing lints this file: `fixture-discipline.test.js`
 * only reads `*.test.js`.
 */
const base = {
  messages: [],
  olderCount: 0,
  historyBecause: null,
  historyUnfilable: false,
  presence: 'on',
  presenceBecause: null,
  asking: false,
  question: null,
  questionBecause: null,
  options: null,
};

const placed = (text, wire) => ({
  at: new Date(Date.now() - 4 * 60000).toISOString(),
  text, wire: wire || null,
  delivery: { state: 'placed', because: null, paneState: 'working', paneNote: 'it was mid-task' },
});

const STATES = {
  '1-menu': { ...base, asking: true, question: QUESTION, options: [{ n: 1, label: '14 days' }, { n: 2, label: '30 days' }] },
  '2-answered-placed': { ...base, messages: [placed('14 days', '1')] },
  '3-unconfirmed': {
    ...base,
    messages: [{
      at: new Date().toISOString(), text: '14 days', wire: '1',
      delivery: { state: 'unconfirmed', because: 'we typed it and could not tell whether it arrived', paneNote: null },
    }],
  },
  '4-failed': {
    ...base, asking: true, question: QUESTION,
    options: [{ n: 1, label: '14 days' }, { n: 2, label: '30 days' }],
    messages: [{
      at: new Date().toISOString(), text: '14 days', wire: '1',
      delivery: { state: 'could_not', because: 'it stopped responding while we were sending', paneNote: null },
    }],
    // ⚠️ THE FLAG A REAL FAILED SEND SETS. Without it this state rendered as
    // "the buttons happen to still be there" and the committed screenshot did
    // not show the one sentence that distinguishes state 4 in the drawing.
    __failed: true,
  },
  '5-no-parse': { ...base, asking: true, question: { text: '│ One I cannot answer from the docs: when somebody adds a second\n│ person, does that person get their own trial, or join the existing one?' } },
  '6-off': {
    ...base, asking: true, question: QUESTION,
    options: [{ n: 1, label: '14 days' }, { n: 2, label: '30 days' }],
    presence: 'off',
    presenceBecause: 'there is no Claude running in its window right now, so anything we typed would be run as a command instead of read',
    messages: [placed('are you there')],
  },
  '7-unsure': { ...base, presence: 'unsure', presenceBecause: 'we could not check which agents are running, so we did not type anything anywhere', messages: [placed('are you there')] },
  '9-unfilable': { ...base, historyUnfilable: true, historyBecause: 'we cannot keep a conversation under this agent’s name' },
  '10-history-unreadable': { ...base, historyBecause: 'we cannot read what you have sent this agent' },
  '11-answered-hold': {
    ...base, asking: true, question: QUESTION,
    options: [{ n: 1, label: '14 days' }, { n: 2, label: '30 days' }],
    messages: [placed('14 days', '1')],
    __answered: true,
  },
  '8-long-labels': {
    ...base, asking: true, question: QUESTION,
    options: [
      { n: 1, label: 'Yes, and do not ask me again for anything in this project' },
      { n: 2, label: 'No, stop and let me look at the file myself first' },
      { n: 3, label: 'Yes' },
    ],
    messages: [placed('https://example.com/a/very/long/unbroken/path/that/people/actually/paste/into/agents/all-the-time')],
  },
};

(async () => {
  /* ⚠️ HEADED by default, like render-thread and render-projects. Headless
     renders through SwiftShader rather than the real compositor, and this
     script's whole output is the class of evidence that weakens under it:
     contrast ratios, computed backgrounds, scrollWidth overflow and
     elementFromPoint. `HEADED=0` for a machine with no console session. */
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const problems = [];
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 900 },
      colorScheme: theme,
    });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      /* ⚠️ ONE EXEMPTION, NARROWLY: the page requests the open agent's avatar,
         and under file:// there is no server to serve it. That is this
         harness's own condition rather than the page's defect. Everything
         else -- including any other failed load -- still counts, because a
         console error is usually the only sign of a paint that half ran. */
      if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;
      problems.push(`[${theme}] console: ${m.text()}`);
    });
    // Installed BEFORE the page's own scripts run, so its startup polls are
    // answered rather than failing against file:// and filling the console
    // with errors that would mask a real one.
    await page.addInitScript(() => {
      window.__fx = null;
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.__posted = [];
      window.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes('/thread') && opts && opts.method === 'POST') {
          window.__posted.push(JSON.parse(opts.body));
          return enc(window.__postAnswer || {
            delivery: { state: 'placed', because: null, at: '2026-08-19T12:00:00.000Z', paneNote: null },
            recorded: true, recordedBecause: null,
          });
        }
        if (u.includes('/thread')) return enc(window.__fx);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
        return enc({});
      };
    });
    await page.goto(PAGE);
    for (const [name, fx] of Object.entries(STATES)) {
      await page.evaluate((f) => {
        window.__fx = f;
        // ⚠️ A BARE ASSIGNMENT, not `window.CURRENT`. The page declares
        // `let CURRENT` at top level, which is a lexical binding and NOT a
        // window property -- setting window.CURRENT made a second, unrelated
        // global while paintTalk's guard read the real one and returned early,
        // painting nothing. Every measurement came back empty and green.
        CURRENT = { sessionName: 'april', name: 'April' };
        document.getElementById('panel-detail').hidden = false;
        // ⚠️ THE FIRST-RUN OVERLAY IS DISMISSED, and the assertion below
        // proves it: the first run of this script captured eight states of
        // the SETUP screen with the box perfectly laid out underneath it,
        // and every measurement came back green. A clip rectangle does not
        // know what is painted over it.
        const fr = document.getElementById('firstrun');
        if (fr) fr.hidden = true;
        // ⚠️ AND `inert` CLEARED, which is the app's own second half (it sets
        // `inert` on every body child except #firstrun while the overlay is
        // up, and clears it on dismissal). Hiding the overlay alone left the
        // WHOLE PAGE non-hit-testable: every elementFromPoint answered BODY
        // and a Playwright click timed out, on a page that screenshots
        // perfectly. A picture cannot show you that nothing on it can be
        // clicked.
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
        // (there is no panel-agents element; the board is the default view)
      }, fx);
      // The answered-hold is client state, so it is armed the way a real send
      // arms it: keyed on the question text the paint recorded.
      await page.evaluate((f) => {
        delete TALK_ANSWERED.april;
        delete TALK_FAILED.april;
        /* ⚠️ ARMED WITH THE KEY THE PAGE ACTUALLY USES, which is the parsed
           MENU rather than the capture slice. Keying these on `question.text`
           here would arm a hold the paint immediately discards, and the states
           would look right for the wrong reason. */
        // The page's own key function, so a fixture cannot arm a hold the paint
        // would immediately discard.
        const key = talkKey(f);
        if (key) TALK_QUESTION.april = key;
        if (f.__answered && key) TALK_ANSWERED.april = { question: key, at: Date.now() };
        if (f.__failed && key) TALK_FAILED.april = { question: key };
      }, fx);
      await page.evaluate(() => paintTalk('april', 'April'));
      const box = page.locator('#d-talk-box');
      await box.scrollIntoViewIfNeeded();
      /* ⚠️ THE COMMITTED NAME, `talk-<state>-<theme>.png`, and not a shorter
         one. render-thread's header states the rule this file was breaking:
         "a screenshot in the repo is evidence only if the next person can
         regenerate the same picture", and the committed set was a hand-picked
         subset renamed by hand (`4-failed` copied onto `talk-4-send-failed`).
         Nobody reproduces that, and a mismatched pair is how a stale image
         outlives the screen it claims to show. */
      await page.screenshot({ path: `${OUT}/talk-${name}-${theme}.png`, clip: await box.boundingBox() });

      // ⚠️ MEASURED IN THE PAGE, not judged from the picture: scrollWidth vs
      // clientWidth is the one comparison immune to a capture narrower than
      // the render.
      const m = await page.evaluate(() => {
        const el = (id) => document.getElementById(id);
        const vis = (n) => !!(n && !n.hidden && n.getClientRects().length);
        const bubble = document.querySelector('#d-dmthread .dm-b');
        const cs = bubble ? getComputedStyle(bubble) : null;
        const qask = el('d-qask');
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          boxOverflow: el('d-talk-box').scrollWidth - el('d-talk-box').clientWidth,
          optsOverflow: el('d-qopts').scrollWidth - el('d-qopts').clientWidth,
          threadOverflowX: el('d-dmthread').scrollWidth - el('d-dmthread').clientWidth,
          qaskVisible: vis(qask),
          qaskBg: qask && vis(qask) ? getComputedStyle(qask).backgroundColor : null,
          optsVisible: vis(el('d-qopts')),
          qoutVisible: vis(el('d-qout')),
          optCount: el('d-qopts').querySelectorAll('.qopt').length,
          bubbleBg: cs ? cs.backgroundColor : null,
          offVisible: vis(el('d-dmoff')),
          offText: el('d-dmoff').textContent,
          sayDisabled: el('d-say').disabled,
          threadText: el('d-dmthread').textContent.trim().slice(0, 220),
          sendDisabled: el('d-send').disabled,
          label: el('d-talk-label').textContent,
          qlab: el('d-qask-lab').textContent,
          qfail: el('d-qask-fail').hidden ? '' : el('d-qask-fail').textContent,
          // ⚠️ THE CONTROL'S BOUNDARY, measured in the page. WCAG SC 1.4.11
          // asks 3:1 of whatever identifies a control, and a screenshot cannot
          // tell you a border is invisible -- it looks tasteful.
          optEdge: (() => {
            const b = document.querySelector('#d-qopts .qopt');
            if (!b) return null;
            const parse = (c) => (c.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
            /* ⚠️ THE ALPHA IS APPLIED, and the first version dropped it: a
               computed `rgba(20, 22, 26, .05)` panel read as its own rgb —
               near-black — so the check reported 5:1 for a boundary that
               measures 3.3:1, and it reported it as a PASS. A measurement that
               ignores the compositing is not measuring the screen. */
            const over = (fg, bg) => {
              const f = parse(fg); const g = parse(bg);
              const a = f.length > 3 ? f[3] : 1;
              return [0, 1, 2].map((i) => f[i] * a + g[i] * (1 - a));
            };
            const lum = (rgb) => {
              const n = rgb.map((v) => v / 255)
                .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
              return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
            };
            // The panel sits on the card, which sits on the page.
            const page = getComputedStyle(document.body).backgroundColor;
            const card = over(getComputedStyle(el('d-talk-box')).backgroundColor, page);
            const panel = over(getComputedStyle(el('d-qask')).backgroundColor,
              'rgb(' + card.map(Math.round).join(',') + ')');
            const edge = over(getComputedStyle(b).borderTopColor,
              'rgb(' + panel.map(Math.round).join(',') + ')');
            const l1 = lum(edge); const l2 = lum(panel);
            return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
          })(),
          // ⚠️ WHAT IS ACTUALLY ON TOP at the box's own centre. `hidden` on
          // an overlay is a claim; this is the pixel.
          rect: JSON.stringify(el('d-talk-box').getBoundingClientRect()),
          onTop: (() => {
            const r = el('d-talk-box').getBoundingClientRect();
            // Clamped INTO the viewport: elementFromPoint answers about a
            // point on screen, and a point above the fold answers BODY --
            // which reads exactly like an overlay and is not one.
            const y = Math.min(Math.max(r.top + 20, 10), window.innerHeight - 10);
            const hit = document.elementFromPoint(r.left + r.width / 2, y);
            return hit ? (el('d-talk-box').contains(hit) ? 'the box' : (hit.id || hit.className || hit.tagName)) : 'nothing';
          })(),
        };
      });
      const tag = `${name}/${theme}`;
      // ⚠️ THE STATE-4 SENTENCE IS ASSERTED, not merely photographed. It is the
      // one thing that distinguishes that state, and the fixture that was
      // supposed to produce it did not, so the committed evidence for state 4
      // showed everything except state 4.
      if (name === '4-failed' && !/buttons still work/.test(m.qfail)) {
        problems.push(`${tag}: state 4 is missing its own sentence (qfail: ${JSON.stringify(m.qfail)})`);
      }
      if (name !== '4-failed' && m.qfail) {
        problems.push(`${tag}: the failure sentence is showing where nothing failed: ${JSON.stringify(m.qfail)}`);
      }
      // ⚠️ The question's own two elements are read DIRECTLY, hidden or not:
      // they were holding the last question's sentence on every idle state,
      // which is one `hidden` away from one agent's question under another's
      // name.
      if (!fx.asking && m.qlab) {
        problems.push(`${tag}: a question sentence is loaded while nothing is asking: ${JSON.stringify(m.qlab)}`);
      }
      /**
       * WARNING: PRESENCE BEFORE ABSENCE, APPLIED TO THIS FILE'S OWN SUBJECT.
       * Every option measurement here was logged and none was asserted, so
       * ZERO BUTTONS was a pass on every arm -- including the four states that
       * exist to be about the buttons. It reported `problems: none` against a
       * screen showing the hazard, the question, an empty options row, and
       * "Or write your own answer below." pointing at nothing.
       */
      const wantOpts = (fx.options && fx.presence === 'on' && fx.asking && !fx.__answered)
        ? fx.options.length : 0;
      if (m.optCount !== wantOpts) {
        problems.push(`${tag}: ${m.optCount} option buttons on screen, expected ${wantOpts}`);
      }
      if (wantOpts && !m.optsVisible) problems.push(`${tag}: the options row is hidden with buttons in it`);
      if (!wantOpts && m.optsVisible) problems.push(`${tag}: an empty options row is on screen`);
      // The out points AT the buttons, so it may not outlive them.
      if (m.qoutVisible !== (wantOpts > 0)) {
        problems.push(`${tag}: "Or write your own answer below" is ${m.qoutVisible ? 'on screen without' : 'missing from'} the buttons it points at`);
      }
      if (m.optEdge !== null && m.optEdge < 3) {
        problems.push(`${tag}: the option button's edge is ${m.optEdge}:1 against the panel, under the 3:1 floor`);
      }
      if (m.onTop !== 'the box') problems.push(`${tag}: something else is painted over the box: ${m.onTop}`);
      if (m.pageOverflow > 0) problems.push(`${tag}: the PAGE scrolls sideways by ${m.pageOverflow}px`);
      if (m.boxOverflow > 0) problems.push(`${tag}: the box overflows by ${m.boxOverflow}px`);
      if (m.optsOverflow > 0) problems.push(`${tag}: the options row overflows by ${m.optsOverflow}px`);
      if (m.threadOverflowX > 0) problems.push(`${tag}: the thread scrolls sideways by ${m.threadOverflowX}px`);
      // A transparent panel is the defect a screenshot flatters and a text
      // check cannot see at all.
      /* ⚠️ NAMED FOR WHAT IT CAN ACTUALLY SEE. This used to say it caught the
         `--k-sunk` failure; it cannot. Every usage site keeps the pack's
         fallback, so deleting the token yields a WRONG wash in dark, never a
         transparent one. What this detects is a question box with no ground at
         all, whatever the cause. The token's own protection is the text pin in
         server.test.js, which does work. */
      if (m.qaskVisible && (m.qaskBg === 'rgba(0, 0, 0, 0)' || m.qaskBg === 'transparent')) {
        problems.push(`${tag}: the question box has no background at all`);
      }
      /* ⚠️ THE BUBBLE CHECK IS GONE, because it could not fail. `dmRow` emits
         `class="dm mine"` unconditionally and `.dm.mine .dm-b` sets a literal
         gold, so the transparent case it named was unreachable and every run
         reported the same colour. A guard that reads as protection and cannot
         fire teaches the next reader that the case is handled. What it is
         replaced by is the one thing that IS true of every bubble: the gold. */
      if (m.bubbleBg && m.bubbleBg !== 'rgba(214, 166, 46, 0.14)') {
        problems.push(`${tag}: a message bubble is not the person's own colour: ${m.bubbleBg}`);
      }
      console.log(tag, JSON.stringify(m));
    }
    /**
     * WARNING: THE STATE SWEEP ABOVE ONLY LOOKS. Both of the worst defects this
     * file has caught lived in what happens when a control is PRESSED -- a
     * focus rescue that was dead code, and a poll that destroyed the button
     * under the person's keyboard every five seconds. Neither is visible in a
     * screenshot or a computed style. So this pass touches things.
     */
    {
      const menu = STATES['1-menu'];
      await page.evaluate((f) => {
        window.__fx = f; window.__posted = [];
        CURRENT = { sessionName: 'april', name: 'April' };
        delete TALK_ANSWERED.april; delete TALK_FAILED.april;
      }, menu);
      await page.evaluate(() => paintTalk('april', 'April'));

      // 0. REOPENING THE SAME AGENT must not leave an empty options row.
      // ⚠️ The bug this catches needs the SAME state painted twice with a
      // clear in between: only then does the paint's "nothing changed" cache
      // match what it is about to write, and skip a rebuild the clear has
      // already undone. A harness that always paints a fresh state cannot see
      // it, which is why this sequence is spelled out rather than implied.
      // ⚠️ THROUGH THE APP'S OWN CLEARING BLOCK, not a copy of it in this file.
      // `openDetail` is what runs when somebody goes back to the board and
      // opens an agent again, and its clear is where a cache can be left
      // speaking for markup that no longer exists. Clearing by hand here would
      // be testing this script's idea of the clear.
      const card = realCard();
      if (!card) {
        problems.push(`[${theme}] reopen: no real agent card on this machine, so the clear path is UNCHECKED`);
      } else {
        const reopened = await page.evaluate((c) => {
          try { window.__card = c; LAST = [c]; openDetail(c.sessionName); return true; }
          catch (e) { return String(e && e.message); }
        }, card);
        if (reopened !== true) {
          problems.push(`[${theme}] reopen: could not drive openDetail (${reopened}) -- the clear path is UNCHECKED`);
        }
      }
      await page.evaluate(() => paintTalk('april', 'April'));
      const afterReopen = await page.evaluate(() => document.querySelectorAll('#d-qopts .qopt').length);
      /* ⚠️ THE THREAD BOX TOO, and with MESSAGES in it. The first version of
         this check reopened on a state whose fixture has none, so it exercised
         only the empty arms -- which were the arms that already cleared their
         cache. The stranded box needs a thread that renders rows and a repaint
         that produces byte-identical markup, which is every thread whose newest
         message is over an hour old. */
      /* ⚠️ GATED ON THE CARD, like the block above it. `window.__card` is only
         assigned when `realCard()` found one, and this block read it
         unconditionally: on a machine running no agent of ours, `LAST` became
         `[undefined]` and `openDetail` threw a TypeError INSIDE the evaluate,
         which rejects the top-level IIFE -- so the run died before printing
         the problem list at all. That is the same "a check that dies instead
         of reporting" failure the press pass documents forty lines down, and
         it would have hit whoever ran this on a quiet machine. */
      const threadAfterReopen = card ? await page.evaluate(async (f) => {
        window.__fx = f;
        await paintTalk('april', 'April');
        const before = document.getElementById('d-dmthread').textContent.slice(0, 40);
        LAST = [window.__card];
        openDetail('april');
        await paintTalk('april', 'April');
        return { before, after: document.getElementById('d-dmthread').textContent.slice(0, 40) };
      }, STATES['2-answered-placed']) : null;
      if (!threadAfterReopen) {
        problems.push(`[${theme}] reopen: no real agent card on this machine, so the STRANDED-BOX path is UNCHECKED`);
      } else if (threadAfterReopen.after !== threadAfterReopen.before) {
        problems.push(`[${theme}] reopen: the thread box is stranded after a reopen `
          + `(${JSON.stringify(threadAfterReopen.before)} -> ${JSON.stringify(threadAfterReopen.after)})`);
      }
      // Put the menu back: the steps below are about the buttons, and the check
      // above left a thread state with none.
      await page.evaluate(async (f) => { window.__fx = f; await paintTalk('april', 'April'); }, menu);
      if (afterReopen !== menu.options.length) {
        problems.push(`[${theme}] reopen: ${afterReopen} buttons after a clear-and-repaint, expected ${menu.options.length}`);
      }

      /* ⚠️ THE PRESS PASS FAILS SOFT FROM HERE. With the buttons missing, the
         steps below throw a TypeError and the run dies BEFORE printing the
         problem list -- so a real defect was reported as a crash in the check
         rather than as a finding about the page. Measured: reintroducing the
         cache bug killed the run at the focus step, and the reopen problem it
         had already recorded never reached the screen. A check that dies
         instead of reporting is a check that has to be debugged before it can
         be believed. */
      if (afterReopen !== menu.options.length) {
        console.log(`[${theme}] press pass skipped: the buttons are not on screen`);
      } else {

      // 1. A repaint with identical data must not take the keyboard away.
      // ⚠️ THE SECOND BUTTON, deliberately: focusing the first made this pass
      // against a rebuild that restored focus to whichever option came first,
      // which moves somebody standing on "No" onto "Yes".
      await page.evaluate(() => document.querySelectorAll('#d-qopts .qopt')[1].focus());
      const beforeId = await page.evaluate(() => document.activeElement.dataset.n || document.activeElement.tagName);
      await page.evaluate(() => paintTalk('april', 'April'));
      const afterId = await page.evaluate(() => document.activeElement.dataset.n || document.activeElement.tagName);
      if (beforeId !== afterId) {
        problems.push(`[${theme}] press: a repaint moved focus off the option button (${beforeId} -> ${afterId})`);
      }

      // 2. A press sends the digit AND the words, and does not strand focus.
      await page.evaluate(() => document.querySelectorAll('#d-qopts .qopt')[0].focus());
      await page.click('#d-qopts .qopt');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      const sent = await page.evaluate(() => window.__posted[0]);
      if (sent.text !== '1' || sent.chose !== '14 days') {
        problems.push(`[${theme}] press: the option sent ${JSON.stringify(sent)}, not the digit plus the words`);
      }
      const landed = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
      if (landed === 'BODY') {
        problems.push(`[${theme}] press: focus was stranded on the document after answering`);
      }

      /* 2b. A FAILED press must leave the buttons pressable.
       *
       * ⚠️ THE ONE STATE THIS FILE USED TO FABRICATE. State 4 was reached by
       * setting a flag and hand-writing TALK_FAILED, never by pressing a button
       * and getting a failure back -- and no assertion anywhere read `disabled`
       * on an option. So the harness AND the committed screenshot were green
       * against a screen where both buttons were permanently dead under the
       * sentence "The buttons still work." A state reached by a shortcut is a
       * state nobody has tested. */
      await page.evaluate((f) => {
        window.__posted = [];
        window.__postAnswer = {
          delivery: { state: 'could_not', because: 'it stopped responding while we were sending', at: '2026-08-19T12:00:00.000Z', paneNote: null },
          recorded: true, recordedBecause: null,
        };
        window.__fx = f;
        delete TALK_ANSWERED.april; delete TALK_FAILED.april;
      }, menu);
      await page.evaluate(() => paintTalk('april', 'April'));
      const preFail = await page.evaluate(() => ({
        n: document.querySelectorAll('#d-qopts .qopt').length,
        qaskHidden: document.getElementById('d-qask').hidden,
        answered: !!TALK_ANSWERED.april,
        sending: TALK_SENDING,
      }));
      if (preFail.n === 0) {
        problems.push(`[${theme}] press: could not set up the failed-send case (${JSON.stringify(preFail)})`);
      } else {
      await page.click('#d-qopts .qopt');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      // The paint in sendTalk's finally has to have run; give the poll nothing
      // to do and read the buttons.
      await page.evaluate(() => paintTalk('april', 'April'));
      const afterFail = await page.evaluate(() => ({
        dis: Array.from(document.querySelectorAll('#d-qopts .qopt')).map((b) => b.disabled),
        said: document.getElementById('d-qask-fail').textContent,
      }));
      if (afterFail.dis.some(Boolean)) {
        problems.push(`[${theme}] press: the buttons are dead after a failed send (${JSON.stringify(afterFail.dis)})`
          + (afterFail.said ? ` while saying ${JSON.stringify(afterFail.said)}` : ''));
      }
      if (!/buttons still work/.test(afterFail.said)) {
        problems.push(`[${theme}] press: a failed send left no state-4 sentence`);
      }
      }
      await page.evaluate(() => { window.__postAnswer = null; delete TALK_FAILED.april; });

      /* 2c. THE SCROLL HALF, which nothing asserted. Mutating `setThread`'s
       * count key into an unconditional scroll-to-bottom -- the documented
       * "poll fighting the reader" defect -- left the whole suite green and
       * this file reporting no problems. The most documented half of the
       * newest function had no check at all. */
      const scroll = await page.evaluate(async () => {
        const many = Array.from({ length: 30 }, (_, i) => ({
          at: new Date(Date.UTC(2026, 0, 1, 9, 0, i)).toISOString(),
          text: 'message number ' + (i + 1), wire: null,
          delivery: { state: 'placed', because: null, paneNote: null },
        }));
        window.__fx = { ...window.__fx, asking: false, question: null, options: null, messages: many };
        await paintTalk('april', 'April');
        const box = document.getElementById('d-dmthread');
        box.scrollTop = 0;
        await paintTalk('april', 'April');           // identical repaint
        const held = box.scrollTop;
        window.__fx = { ...window.__fx, messages: many.concat([{
          at: new Date(Date.UTC(2026, 0, 1, 9, 0, 31)).toISOString(),
          text: 'a new one', wire: null,
          delivery: { state: 'placed', because: null, paneNote: null },
        }]) };
        await paintTalk('april', 'April');           // one more message
        return { held, moved: box.scrollTop, height: box.scrollHeight };
      });
      if (scroll.held !== 0) {
        problems.push(`[${theme}] scroll: an identical repaint moved a reader from 0 to ${scroll.held}`);
      }
      if (scroll.moved === 0) {
        problems.push(`[${theme}] scroll: a new message did not bring the thread into view`);
      }

      /* 2d. THE FOCUS RESCUE AND ITS `tabindex="-1"` ARE A PAIR. Delete the
       * attribute and `.focus()` becomes a silent no-op, restoring the
       * stranded-on-<body> state the rescue exists to prevent, with nothing
       * failing. So the pair is asserted rather than the line. */
      /* ⚠️ THE RESCUE ITSELF, not only its `tabindex`. The first version focused
         the panel by hand and checked it took focus, which fails if the
         attribute goes -- but left the rescue BLOCK untested: by the time the
         press pass reaches a repaint, focus is already on `#d-say`, which is
         outside `#d-qask`, so the branch never ran. Deleting the rescue left
         this green. So the state is arranged properly: somebody standing
         INSIDE the question region, on a screen where the composer is closed,
         at the moment the region is hidden. */
      const rescue = await page.evaluate(async (f) => {
        window.__fx = { ...f, presence: 'off',
          presenceBecause: 'there is no Claude running in its window right now' };
        delete TALK_ANSWERED.april;
        await paintTalk('april', 'April');
        document.getElementById('d-qask-text').focus();
        const stood = document.activeElement.id;
        // Now the question goes: asking false, so the block hides underneath them.
        window.__fx = { ...f, presence: 'off', asking: false, question: null, options: null };
        await paintTalk('april', 'April');
        return { stood, landed: document.activeElement.id || document.activeElement.tagName };
      }, menu);
      /* ⚠️ THE TRANSITION ARM, which the check above cannot reach. That one
       * paints `presence:'off'` FIRST and only then hides the question, so the
       * composer is already disabled and the rescue takes its `else` branch.
       * The branch that was broken is the other one: the paint where the agent's
       * Claude exits, so the question hides and the composer closes AT ONCE.
       * There the rescue used to read a composer that was still open, hand it
       * focus, and have the same paint disable it underneath -- landing on the
       * document, which is what the rescue exists to prevent. A check that only
       * ever exercises the working branch is the third time on this branch that
       * has happened. */
      const transition = await page.evaluate(async (f) => {
        window.__fx = { ...f, presence: 'on' };
        delete TALK_ANSWERED.april;
        await paintTalk('april', 'April');
        document.getElementById('d-qask-text').focus();
        const stood = document.activeElement.id;
        // The agent's Claude exits: no question any more AND nowhere to type.
        window.__fx = { ...f, presence: 'off', asking: false, question: null, options: null,
          presenceBecause: 'there is no Claude running in its window right now' };
        await paintTalk('april', 'April');
        return { stood, landed: document.activeElement.id || document.activeElement.tagName };
      }, menu);
      if (transition.stood !== 'd-qask-text') {
        problems.push(`[${theme}] focus: could not set up the closing-composer case, so it is UNCHECKED`);
      } else if (transition.landed === 'BODY') {
        problems.push(`[${theme}] focus: the composer closing on the same paint stranded focus on the document`);
      }
      await page.evaluate(async (f) => { window.__fx = f; await paintTalk('april', 'April'); }, menu);

      if (rescue.stood !== 'd-qask-text') {
        problems.push(`[${theme}] focus: could not stand inside the question region, so the rescue is UNCHECKED`);
      } else if (rescue.landed === 'BODY') {
        problems.push(`[${theme}] focus: hiding the question region stranded focus on the document`);
      }
      await page.evaluate(async (f) => { window.__fx = f; await paintTalk('april', 'April'); }, menu);

      /* 2e. THE HOLD SURVIVES THE PANE MOVING ON, which is the whole reason it
       * exists. A pane accumulates: the agent prints another line, a context
       * percentage ticks over, the box redraws. None of that is a new question,
       * and the first version treated all of it as one -- because the hold was
       * keyed on `questionIn`'s slice, which runs to the end of the capture.
       * Answering then left live buttons over the answered prompt within one
       * poll. */
      await page.evaluate(async (f) => {
        window.__posted = [];
        window.__postAnswer = null;
        window.__fx = f;
        delete TALK_ANSWERED.april; delete TALK_FAILED.april;
        await paintTalk('april', 'April');
      }, menu);
      /* ⚠️ GUARDED LIKE 2b, and for the reason this file states twice: a
         regression that empties the option row turns a bare click into a
         four-second timeout that REJECTS the run, so the whole problem list
         goes unprinted and a real defect is reported as the check being
         broken. The guard makes it a finding instead. */
      const preHold = await page.evaluate(() => document.querySelectorAll('#d-qopts .qopt').length);
      if (preHold === 0) {
        problems.push(`[${theme}] hold: no option buttons to answer, so the hold is UNCHECKED`);
      } else {
      await page.click('#d-qopts .qopt');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      const held = await page.evaluate(async (f) => {
        const count = () => document.querySelectorAll('#d-qopts .qopt').length;
        const out = { afterAnswer: count() };
        // The SAME menu, with the pane having moved on underneath it.
        window.__fx = { ...f, question: { text: f.question.text + '\n\n  ✳ Thinking… (3s · 41% context left)' } };
        await paintTalk('april', 'April');
        out.afterPaneMoved = count();
        // A genuinely different menu DOES spend it.
        window.__fx = { ...f, options: [{ n: 1, label: 'Something else' }, { n: 2, label: 'No' }] };
        await paintTalk('april', 'April');
        out.afterNewMenu = count();
        /* ⚠️ AND A NEW QUESTION WITH THE SAME LABELS. Claude's edit-permission
           menu draws identical labels for every file, so a key made of the
           options alone hid the next question entirely -- panel gone, no
           buttons, while the board card still said the person was needed. */
        window.__fx = { ...f, question: { text: 'Edit file src/a.js?\n❯ 1. Yes\n  2. No' } };
        await paintTalk('april', 'April');
        TALK_ANSWERED.april = { question: talkKey(window.__fx), at: Date.now() };
        window.__fx = { ...f, question: { text: 'Edit file src/b.js?\n❯ 1. Yes\n  2. No' } };
        await paintTalk('april', 'April');
        out.afterSameLabelsNewQuestion = count();
        return out;
      }, menu);
      if (held.afterAnswer !== 0) {
        problems.push(`[${theme}] hold: ${held.afterAnswer} buttons still on screen straight after answering`);
      }
      if (held.afterPaneMoved !== 0) {
        problems.push(`[${theme}] hold: the pane moving on brought ${held.afterPaneMoved} buttons back over an answered question`);
      }
      if (held.afterNewMenu === 0) {
        problems.push(`[${theme}] hold: a genuinely NEW menu was suppressed, so the hold never releases`);
      }
      if (held.afterSameLabelsNewQuestion === 0) {
        problems.push(`[${theme}] hold: a NEW question with the same option words was suppressed`);
      }
      }
      await page.evaluate((f) => { window.__fx = f; delete TALK_ANSWERED.april; }, menu);
      await page.evaluate(() => paintTalk('april', 'April'));

      // 3. Send with the keyboard: the same rescue, from the other control.
      await page.evaluate(() => {
        window.__posted = [];
        delete TALK_ANSWERED.april;
        document.getElementById('d-say').value = 'typed by hand';
      });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.evaluate(() => document.getElementById('d-send').focus());
      await page.click('#d-send');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      const landed2 = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
      if (landed2 === 'BODY') {
        problems.push(`[${theme}] press: focus was stranded on the document after Send`);
      }

      /* 4. A message with whitespace around it, which is what a paste is.
         ⚠️ THE BOX MUST BE EMPTY AFTERWARDS. `clearSent` clears only when the
         box still holds exactly the text this send took, and the composer was
         handing `say.value` RAW to a comparison against `say.value.trim()` --
         so a pasted line was delivered, recorded, and left sitting armed in
         the box under "Placed into April's session". Two presses of Enter on
         one paste is a message typed into a live agent twice. The room's own
         composer trims at the source; this is that, driven. */
      await page.evaluate(() => {
        window.__posted = [];
        delete TALK_ANSWERED.april;
        document.getElementById('d-say').value = '  14 days  ';
      });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.click('#d-send');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      const pasted = await page.evaluate(() => ({
        sent: window.__posted[0],
        left: document.getElementById('d-say').value,
        draft: TALK_DRAFTS.april,
      }));
      if (!pasted.sent || pasted.sent.text !== '14 days') {
        problems.push(`[${theme}] paste: the untrimmed value was sent as ${JSON.stringify(pasted.sent)}`);
      }
      if (pasted.left !== '') {
        problems.push(`[${theme}] paste: the composer still holds ${JSON.stringify(pasted.left)} after a placed send`);
      }
      if (pasted.draft) {
        problems.push(`[${theme}] paste: the draft survived a placed send as ${JSON.stringify(pasted.draft)}`);
      }

      /* 5. A poll that FAILS while the person is standing on an option button.
         ⚠️ THE ARM WITH NO RESCUE. paintTalk's success path carries four focus
         rescues and its failure arm carried none: it hides the question region
         and disables the composer, and disabling a focused control blurs it
         synchronously, so one failed tick -- a restart, a 500 -- dropped a
         keyboard user onto the document, every five seconds, for as long as
         the failure lasted. A picture cannot show this. */
      await page.evaluate((f) => { window.__fx = f; delete TALK_ANSWERED.april; }, menu);
      await page.evaluate(() => paintTalk('april', 'April'));
      const stoodOn = await page.evaluate(() => {
        const b = document.querySelectorAll('#d-qopts .qopt')[1];
        if (b) b.focus();
        return document.activeElement.className || document.activeElement.tagName;
      });
      if (!/qopt/.test(stoodOn)) {
        /* CONTROL: without this the check below passes on a page where nobody
           was standing anywhere, which is the shape that cannot fail. */
        problems.push(`[${theme}] fail-poll: could not stand on an option button (${stoodOn}), so the rescue is UNCHECKED`);
      }
      const landed3 = await page.evaluate(async () => {
        const real = window.fetch;
        window.fetch = async () => new Response('{"error":"we could not read this conversation"}',
          { status: 500, headers: { 'content-type': 'application/json' } });
        try {
          await paintTalk('april', 'April');
        } finally {
          window.fetch = real;
        }
        return document.activeElement.id || document.activeElement.tagName;
      });
      if (landed3 !== 'd-talk-box') {
        problems.push(`[${theme}] fail-poll: a failed poll left focus on ${landed3}, not the section it just closed`);
      }

      /* 6. A REPAINT WHERE ONLY THE CLOCK MOVED, on a thread long enough to
         scroll and new enough to say "a minute ago".
         ⚠️ EVERY OTHER FIXTURE IN THIS FILE IS DATED January 2026, so its
         verdict lines render a fixed "at 9:00 on Jan 1" and a repaint is
         byte-identical. That makes the scroll block above an honest test of
         "an unchanged list does not move", and NO test at all of the case the
         product actually spends its first hour in: `pjWhen` returns a RELATIVE
         phrase under an hour, so the markup changes once a minute on a thread
         nobody touched, `setThread` rewrites `innerHTML`, and the count key is
         unchanged so the jump-to-bottom arm does not fire. Whether that moves
         a reader is a question about the browser, not about this code, and the
         answer measured here (2026-08-20, Chromium, headed) is that it does
         not: a same-height rewrite keeps `scrollTop`. This block exists so the
         day that stops being true is a failure rather than a discovery. */
      const clockOnly = await page.evaluate(async () => {
        const at = new Date(Date.now() - 65 * 1000).toISOString();
        window.__fx = {
          messages: Array.from({ length: 8 }, (_, i) => ({
            text: 'message number ' + (i + 1) + ' with enough words in it to take a line or two of the box',
            at, delivery: { state: 'placed', because: null, at, paneNote: null },
          })),
          olderCount: 0, historyBecause: null, historyUnfilable: false,
          presence: 'on', presenceBecause: null, asking: false, question: null,
          questionBecause: null, options: null,
        };
        await paintTalk('april', 'April');
        const t = document.getElementById('d-dmthread');
        t.scrollTop = t.scrollHeight;
        const before = { top: Math.round(t.scrollTop), key: t.__lastThread,
          scrolls: t.scrollHeight > t.clientHeight };
        const real = Date.now;
        Date.now = () => real() + 120000;
        try { await paintTalk('april', 'April'); } finally { Date.now = real; }
        return { ...before, after: Math.round(t.scrollTop), rewrote: t.__lastThread !== before.key };
      });
      if (!clockOnly.scrolls) {
        /* CONTROL: with nothing to scroll, `scrollTop` is 0 both times and the
           check below passes on a box that cannot demonstrate anything. */
        problems.push(`[${theme}] clock: the thread box did not overflow, so the scroll-hold is UNCHECKED`);
      }
      if (!clockOnly.rewrote) {
        /* CONTROL: and if the markup did NOT change, no rewrite happened and
           the check below is measuring the wrong thing entirely. */
        problems.push(`[${theme}] clock: a minute passing did not change the markup, so the rewrite is UNCHECKED`);
      }
      if (clockOnly.scrolls && clockOnly.rewrote && clockOnly.after !== clockOnly.top) {
        problems.push(`[${theme}] clock: a repaint where only the time phrase moved took the reader `
          + `from ${clockOnly.top} to ${clockOnly.after}`);
      }

      /* 7. THE TWO 404s, which are one status and two different facts.
         ⚠️ THE PAGE MUST NOT READ PERMANENCE OFF THE STATUS. A pane holding
         this name untied answers 404 on every poll forever ('borrowed'); a
         tmux read that failed once answers 404 too, because the gate fails
         closed ('unreadable'), and it clears by itself. Told apart only by the
         status, a five-second hiccup on an ordinary tied agent drew the
         written-for-forever sentence with no cause anywhere on the panel --
         `#d-untied` is hidden for a tied card. So the route sends the reason
         and this asserts BOTH arms off it. */
      const both = await page.evaluate(async () => {
        const out = {};
        const real = window.fetch;
        const four04 = (body) => async () => new Response(JSON.stringify(body),
          { status: 404, headers: { 'content-type': 'application/json' } });
        try {
          window.fetch = four04({ error: 'no agent by that name', because: 'borrowed' });
          await paintTalk('april', 'April');
          out.borrowed = document.getElementById('d-dmthread').innerText.trim();
          window.fetch = four04({ error: 'we could not check which agents are running', because: 'unreadable' });
          await paintTalk('april', 'April');
          out.unreadable = document.getElementById('d-dmthread').innerText.trim();
        } finally {
          window.fetch = real;
        }
        return out;
      });
      if (both.borrowed !== 'We cannot show a conversation for this name.') {
        problems.push(`[${theme}] refusal: the standing 404 drew ${JSON.stringify(both.borrowed)}`);
      }
      if (!/just now/.test(both.unreadable || '')) {
        problems.push(`[${theme}] refusal: a 404 we may recover from lost its time phrase: ${JSON.stringify(both.unreadable)}`);
      }
      if (/no agent by that name/i.test(both.borrowed || '')) {
        problems.push(`[${theme}] refusal: the route's own sentence reached the panel: ${JSON.stringify(both.borrowed)}`);
      }

      /* 8. THE PERSISTENCE LINE, on both sides of a refusal.
         ⚠️ "This stays here after a restart" is a promise about a conversation
         and it was printed under the sentence saying there is none to show --
         the same contradiction the arm already clears two other sentences for.
         Hiding it is only half: it must come BACK, or the next agent opened
         after a failed one has a box that quietly stopped saying what it does.
         The good-state read is the CONTROL: without it, a regex typo below
         passes on a line the check never saw in the first place. */
      const persistence = await page.evaluate(async (f) => {
        const line = () => {
          const el = document.getElementById('d-persist');
          return { hidden: el.hidden, text: el.textContent.trim() };
        };
        window.__fx = f;
        await paintTalk('april', 'April');
        const good = line();
        const real = window.fetch;
        window.fetch = async () => new Response('{"error":"no agent by that name","because":"borrowed"}',
          { status: 404, headers: { 'content-type': 'application/json' } });
        try { await paintTalk('april', 'April'); } finally { window.fetch = real; }
        const refused = line();
        await paintTalk('april', 'April');
        return { good, refused, recovered: line() };
      }, menu);
      if (persistence.good.hidden || !/stays here after a restart/.test(persistence.good.text)) {
        problems.push(`[${theme}] persist: CONTROL FAILED, the line is not on a good paint: ${JSON.stringify(persistence.good)}`);
      }
      if (!persistence.refused.hidden) {
        problems.push(`[${theme}] persist: the box promises it keeps things, under the sentence saying it cannot show them`);
      }
      if (persistence.recovered.hidden) {
        problems.push(`[${theme}] persist: the line never came back after a refusal`);
      }
      }
    }
    await page.close();
  }
  await browser.close();
  console.log('\n=== problems ===');
  console.log(problems.length ? problems.join('\n') : 'none');
  console.log('shots in', OUT);
  if (problems.length) process.exitCode = 1;
})();
