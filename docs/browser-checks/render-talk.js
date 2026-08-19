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
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${theme}] console: ${m.text()}`); });
    // Installed BEFORE the page's own scripts run, so its startup polls are
    // answered rather than failing against file:// and filling the console
    // with errors that would mask a real one.
    await page.addInitScript(() => {
      window.__fx = null;
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.fetch = async (url) => {
        const u = String(url);
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
    await page.close();
  }
  await browser.close();
  console.log('\n=== problems ===');
  console.log(problems.length ? problems.join('\n') : 'none');
  console.log('shots in', OUT);
  if (problems.length) process.exitCode = 1;
})();
