'use strict';

/**
 * Measure the two unknown-memory captions on all three surfaces that draw them,
 * in a real browser.
 *
 * ⚠️ WHY THIS EXISTS. Every other test of this change reads text, and text
 * cannot see layout. The captions are absolutely positioned, centred under
 * their avatar and set to `white-space: nowrap`, and the CSS beside them
 * carries measurements taken once, years of edits ago — one of which this check
 * proved wrong on its first run ("the caption is 105px wide"; it is 62px).
 * "Not yet read" is five characters longer than "Unknown", so whether it still
 * clears the name below and stays inside its card is a question only a renderer
 * can answer.
 *
 * 🔑 IT MEASURES IN THE PAGE, never from a picture. `getBoundingClientRect` and
 * `getComputedStyle` are mode-independent; screenshots are not, because
 * headless renders through SwiftShader and headed through the Metal
 * compositor, and the two differ on every file.
 *
 * ⚠️ AND IT CHECKS THE CAPTION IS VISIBLE, not merely present. An earlier
 * version measured geometry only, which a caption at `opacity: 0` satisfies
 * perfectly — the fully transparent modal this directory exists because of.
 *
 * Run:
 *   PW=$(mktemp -d); cd "$PW" && npm init -y && npm i playwright \
 *     && npx playwright install chromium
 *   NODE_PATH="$PW/node_modules" node docs/browser-checks/render-memory-words.js
 *
 * ⚠️ `NODE_PATH` is not optional: `require` resolves from THIS file's directory.
 * ⚠️ HEADED by default, matching every other check here. `HEADED=0` for a
 *    machine with no console session; the verdicts are the same either way,
 *    which is the point of asserting geometry rather than comparing images.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-memory-words: playwright is not on NODE_PATH — SKIPPED, not passed.');
  console.log('  NODE_PATH="$PW/node_modules" node docs/browser-checks/render-memory-words.js');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';

const agent = (name, context) => ({
  name, sessionName: name, state: 'idle', presence: 'online',
  model: 'claude-sonnet-5', role: 'Designer', task: null,
  context, instructions: { staleness: 'current' },
});

/* 🛑 ALL THREE BRANCHES, and the version with two reported a pass for a caption
   that broke its own rules. `memUnknown` grew a third arm for a reading we took
   but cannot scale; the check had no fixture for it, so the longest caption in
   the product was the one never drawn. Measured when it finally was: 90px on an
   82px gauge, 90px inside an 88px avatar, and the list bar squeezed to 18px
   against this file's own 24px threshold.
   ⚠️ A CHECK IS ONLY AS WIDE AS ITS FIXTURES, which is obvious and was still
   missed, because the branch was added to the page and not to the list here. */
const FIXTURES = [
  agent('brandnew', { tokens: null, percent: null, notYet: true, because: 'it has not started a session yet' }),
  agent('unreadable', { tokens: null, percent: null, notYet: false, because: 'could not read the transcript' }),
  agent('nolimit', { tokens: 42000, percent: null, noCeiling: true, notYet: false,
    because: 'measured, but we do not know how much this model can hold' }),
  // ⚠️ THE POSITIVE CONTROL, and it is not decoration: every assertion below is
  // about a caption that IS drawn. A page that stopped drawing cards would
  // satisfy "nothing overflows" perfectly.
  agent('measured', { tokens: 90000, percent: 45, notYet: false }),
];

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: !HEADED });
  } catch (err) {
    // ⚠️ Headed Chromium cannot start without a console session. Say which
    // failure this is rather than dying as an unhandled rejection.
    console.error('render-memory-words: could not start a browser'
      + (HEADED ? ' (headed; try HEADED=0 on a machine with no console session)' : '') + '.');
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('file://' + PAGE);

  const out = await page.evaluate((agents) => {
    /* ⚠️ A NON-ZERO BOX IS PART OF "VISIBLE", and leaving it out made this
       check unable to fail. The detail panel ships `hidden`, so its caption
       measured 0x0 while its OWN computed style was perfectly visible — every
       assertion about it then passed on a thing that was not on the screen.
       A zero box is also how an unrendered ancestor shows up, which no amount
       of getComputedStyle on the element itself can see. */
    const seen = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
        && r.width > 0 && r.height > 0;
    };
    const box = (el) => el.getBoundingClientRect();
    /* Text as an assistive technology would take it: aria-hidden subtrees are
       not part of the accessible name. */
    const spoken = (root) => {
      let out = '';
      for (const n of root.childNodes) {
        if (n.nodeType === 3) { out += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        if (n.getAttribute('aria-hidden') === 'true') continue;
        out += spoken(n);
      }
      return out.replace(/\s+/g, ' ').trim();
    };
    const res = { cards: [], rows: [], detail: null, pageOverflow: 0 };

    // ---- the card grid -----------------------------------------------------
    const grid = document.getElementById('grid');
    grid.innerHTML = agents.map((a) => card(a)).join('');
    for (const el of grid.querySelectorAll('.acard')) {
      const c = box(el);
      const b = el.querySelector('.membadge.unk');
      const row = { who: el.dataset.agent, cardW: Math.round(c.width), caption: b ? b.textContent : null };
      if (b) {
        const r = box(b);
        row.w = Math.round(r.width);
        row.h = Math.round(r.height);
        row.visible = seen(b);
        row.insideLeft = Math.round(r.left - c.left);
        row.insideRight = Math.round(c.right - r.right);
        row.gapToName = Math.round(box(el.querySelector('.aname')).top - r.bottom);
        row.gapToDot = Math.round(r.top - box(el.querySelector('.pres')).bottom);
        row.ring = el.querySelector('svg[role=img]').getAttribute('aria-label');
      }
      res.cards.push(row);
    }

    // ---- the list layout, the other half of the board ----------------------
    const list = document.getElementById('alist');
    list.hidden = false;
    list.innerHTML = agents.map((a) => lrow(a)).join('');
    for (const el of list.children) {
      const pct = el.querySelector('.pct');
      const bar = el.querySelector('.bar');
      if (!pct) continue;
      const wordEl = pct.querySelector('[aria-hidden="true"]');
      res.rows.push({
        caption: (wordEl ? wordEl.textContent : (pct.firstChild ? pct.firstChild.textContent : '')).trim(),
        // ⚠️ WHAT A SCREEN READER ACTUALLY SAYS, WHICH IS NOT `textContent`.
        // An earlier version used textContent and, the moment the visible word
        // became `aria-hidden`, reported "Not yet readNothing has been recorded"
        // — a string no assistive technology produces. The accessible name
        // skips aria-hidden subtrees, so this does too.
        spoken: spoken(pct),
        vh: pct.querySelector('.vh') ? pct.querySelector('.vh').textContent : '',
        pctW: Math.round(box(pct).width),
        barW: Math.round(box(bar).width),
        visible: seen(pct),
        rowOverflow: Math.round(box(pct).right - box(el).right),
      });
    }

    // ---- the detail header, whose avatar reserves no space for a caption ---
    /* ⚠️ THE PANEL IS OPENED FIRST. It ships `hidden`, and measuring inside a
       hidden section returns zeroes that satisfy every geometry assertion. */
    document.getElementById('panel-detail').hidden = false;
    const dbadge = document.getElementById('d-membadge');
    dbadge.hidden = false;
    dbadge.className = 'membadge unk';
    dbadge.textContent = memUnknown({ notYet: true }).word;
    const wrap = dbadge.closest('.dav-wrap');
    res.detail = {
      caption: dbadge.textContent,
      visible: seen(dbadge),
      w: Math.round(box(dbadge).width),
      wrapW: Math.round(box(wrap).width),
      insideLeft: Math.round(box(dbadge).left - box(wrap).left),
      insideRight: Math.round(box(wrap).right - box(dbadge).right),
      belowWrap: Math.round(box(dbadge).bottom - box(wrap).bottom),
      /* ⚠️ THE QUESTION THAT MATTERS is not how far it hangs below its avatar —
         it is absolutely positioned, so it always does — but whether it escapes
         the header it lives in. `.dav-wrap` HAD no equivalent of the card's
         `:has(.membadge.unk) { margin-bottom: 26px }` until this check found it
         hanging 15px past the header. The rule exists now, and this assertion
         is what keeps it: remove the rule and `belowHead` goes -11 to +15. */
      belowHead: Math.round(box(dbadge).bottom - box(document.querySelector('.dhead')).bottom),
    };

    res.pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return res;
  }, FIXTURES);

  await browser.close();

  const problems = [];
  const captions = out.cards.filter((r) => r.caption !== null);
  if (captions.length !== 3) problems.push(`expected three card captions and drew ${captions.length}`);
  if (out.cards.some((r) => r.who === 'measured' && r.caption !== null)) {
    problems.push('a measured agent drew an unknown caption, so the fixtures distinguish nothing');
  }
  for (const r of captions) {
    if (!r.visible) problems.push(`${r.who}: "${r.caption}" is in the DOM and not visible`);
    if (!(r.w > 0 && r.h > 0)) problems.push(`${r.who}: "${r.caption}" has no size`);
    if (r.insideLeft < 0 || r.insideRight < 0) problems.push(`${r.who}: "${r.caption}" hangs outside the card (${r.insideLeft}/${r.insideRight})`);
    if (r.gapToName < 2) problems.push(`${r.who}: "${r.caption}" collides with the name below (gap ${r.gapToName}px)`);
    if (r.gapToDot < 0) problems.push(`${r.who}: "${r.caption}" overlaps the presence dot (gap ${r.gapToDot}px)`);
    if (r.ring && r.ring.includes(r.caption)) problems.push(`${r.who}: the ring label repeats the caption, so an assertion about one can be satisfied by the other`);
  }

  const worded = out.rows.filter((r) => r.caption && !/%$/.test(r.caption));
  if (worded.length !== 3) problems.push(`expected three worded list rows and drew ${worded.length}`);
  for (const r of worded) {
    if (!r.visible) problems.push(`list row "${r.caption}" is not visible`);
    if (r.rowOverflow > 0) problems.push(`list row "${r.caption}" runs past the end of its row by ${r.rowOverflow}px`);
    // ⚠️ THE BAR IS THE THING THE WIDER WORD EATS: `.pct` is a min-width, so the
    // cell grows and the flex bar beside it shrinks.
    if (r.barW < 24) problems.push(`list row "${r.caption}" squeezed the bar to ${r.barW}px`);
    if (!/[a-z]/.test(r.vh)) problems.push(`list row "${r.caption}" has no spoken sentence in its .vh span`);
    /* ⚠️ AIMED AT THE COMPOSED STRING, and the version before this caught
       NEITHER of the two defects its own comment named. It looked for a
       repeated word: "Not yet read memory" has no repeat, and
       "Not yet read memory: Nothing has been recorded for it so far." has none
       either — twelve distinct words and a full stop. It passed both.
       🔑 WHAT ACTUALLY WENT WRONG BOTH TIMES was the spoken cell saying MORE
       than the visible word plus its noun: the first added a claim by
       juxtaposition, the second appended a whole second sentence. So the rule
       is a length one — the cell is the word and a short noun phrase, nothing
       else — which is checkable and is what was violated. */
    /* ⚠️ THE SPOKEN CELL MUST NOT REPEAT THE VISIBLE WORD. Three attempts at
       "the word plus a noun" all parsed as a claim about OUR reading — the head
       of the phrase carried it, so no suffix could fix it. The row now hides
       the word from assistive technology and speaks the sentence, exactly as
       the card does, and this is the rule that keeps it that way. */
    if (r.spoken.toLowerCase().includes(r.caption.toLowerCase())) {
      problems.push(`list row speaks as "${r.spoken}", which reads the visible word aloud instead of explaining it`);
    }
    if (!/[.!?]$/.test(r.spoken)) problems.push(`list row speaks as "${r.spoken}", which is not a sentence`);
    if (r.spoken.split(/\s+/).length < 4) problems.push(`list row speaks as "${r.spoken}", which is not a sentence either`);
  }

  const d = out.detail;
  if (!d || !d.visible) problems.push('the detail header caption is not visible');
  else {
    if (d.insideLeft < -12 || d.insideRight < -12) problems.push(`the detail caption hangs well outside its avatar (${d.insideLeft}/${d.insideRight})`);
    if (d.belowHead > 0) problems.push(`the detail caption escapes the header by ${d.belowHead}px; nothing reserves space for it there`);
  }
  if (out.pageOverflow > 0) problems.push(`the page scrolls sideways by ${out.pageOverflow}px`);

  console.log(JSON.stringify(out, null, 1));
  if (problems.length) {
    console.error(`render-memory-words: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('render-memory-words: all three captions fit and are visible on the card, the list row and the detail header.');
})();
