'use strict';
/* The agent page's own thread: the question, the option buttons, the composer,
 * and every state the drawing names, in both themes.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-talk.js
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
  const browser = await chromium.launch();
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
        if (f.question) TALK_QUESTION.april = f.question.text;
        if (f.__answered) {
          TALK_ANSWERED.april = { question: f.question.text, at: Date.now() };
        }
        if (f.__failed) {
          // Keyed on the question it failed against, exactly as sendTalk keys it.
          TALK_FAILED.april = { question: f.question.text };
        }
      }, fx);
      await page.evaluate(() => paintTalk('april', 'April'));
      const box = page.locator('#d-talk-box');
      await box.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, clip: await box.boundingBox() });

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
      if (m.qaskVisible && (m.qaskBg === 'rgba(0, 0, 0, 0)' || m.qaskBg === 'transparent')) {
        problems.push(`${tag}: the question box has NO background (the --k-sunk failure)`);
      }
      if (m.bubbleBg && (m.bubbleBg === 'rgba(0, 0, 0, 0)' || m.bubbleBg === 'transparent')) {
        problems.push(`${tag}: a message bubble has NO background`);
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
          try { LAST = [c]; openDetail(c.sessionName); return true; }
          catch (e) { return String(e && e.message); }
        }, card);
        if (reopened !== true) {
          problems.push(`[${theme}] reopen: could not drive openDetail (${reopened}) -- the clear path is UNCHECKED`);
        }
      }
      await page.evaluate(() => paintTalk('april', 'April'));
      const afterReopen = await page.evaluate(() => document.querySelectorAll('#d-qopts .qopt').length);
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
      await page.waitForFunction(() => window.__posted.length > 0, null, { timeout: 4000 });
      const sent = await page.evaluate(() => window.__posted[0]);
      if (sent.text !== '1' || sent.chose !== '14 days') {
        problems.push(`[${theme}] press: the option sent ${JSON.stringify(sent)}, not the digit plus the words`);
      }
      const landed = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
      if (landed === 'BODY') {
        problems.push(`[${theme}] press: focus was stranded on the document after answering`);
      }

      // 3. Send with the keyboard: the same rescue, from the other control.
      await page.evaluate(() => {
        window.__posted = [];
        delete TALK_ANSWERED.april;
        document.getElementById('d-say').value = 'typed by hand';
      });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.evaluate(() => document.getElementById('d-send').focus());
      await page.click('#d-send');
      await page.waitForFunction(() => window.__posted.length > 0, null, { timeout: 4000 });
      const landed2 = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
      if (landed2 === 'BODY') {
        problems.push(`[${theme}] press: focus was stranded on the document after Send`);
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
