/**
 * The field and control invariants, measured in a real browser, in BOTH schemes.
 *
 * ⚠️ WHY THIS EXISTS. Two thirds of the `screen-pass` diff was CSS, and CSS had
 * no standing guard at all -- `node --test` reads source, and source is exactly
 * what lied. That branch found THREE separate rules that lost the cascade and
 * read in the diff as if they had worked (`#firstrun .inp` beating
 * `.fr-youfield input`, `#d-instr` beating the `.dbox` treatment, and a
 * `.agauge` margin that restated a value it already had). A rule that loses the
 * cascade is identical to a rule that is not there, and only the ELEMENT knows
 * which one is winning.
 *
 * ⚠️ AND IT RUNS IN DARK AS WELL AS LIGHT, because the app carries two token
 * systems (`--label`/`--bg`/`--bg-elevated` and `--k-ink`/`--k-bg`/`--k-surface`)
 * that are equal in light and divergent in dark. Every defect of that class this
 * project has shipped was invisible in light: a light-only check is measuring
 * agreement between the two systems, not correctness of either.
 *
 * ⚠️ EVERY CHECK PRINTS ITS DENOMINATOR. "All 6 selects share one appearance"
 * and "all 0 selects share one appearance" are the same sentence, and a checker
 * that says only OK cannot be caught doing nothing.
 *
 * Not part of `npm test` -- it needs a browser, and this repo has no
 * dependencies. See README.md in this directory for the sandboxed recipe.
 *
 *   NODE_PATH=<pw>/node_modules node docs/browser-checks/render-fields.js [base]
 */
const pw = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const ENGINES = ['webkit', 'chromium'];

/* ⚠️ WEBKIT FIRST AND NOT OPTIONAL. Kosmos opens the DEFAULT browser
   (`/usr/bin/open`, install/setup.sh), which on a stock Mac is Safari, and
   WebKit renders a `menulist` select differently from Chromium: a declared 20px
   radius comes back 5px and the padding is dropped. A Chromium-only check
   passes that defect. */

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const parse = (s) => {
  const m = String(s).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
};
const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (fgStr, bgStr) => {
  const bg = parse(bgStr); let fg = parse(fgStr);
  if (!fg || !bg) return null;
  if (fg.a < 1) fg = over(fg, bg);
  const la = L(fg), lb = L(bg);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return +(((hi + 0.05) / (lo + 0.05)).toFixed(2));
};

/* ⚠️ THE INSTRUMENT VALIDATES ITSELF BEFORE IT MEASURES ANYTHING. A contrast
   function that is wrong is indistinguishable from a design that is wrong, and
   the first version of this one dropped the alpha -- scoring a `.26` border at
   18:1 instead of 1.77:1 and reading entirely plausible either way. */
function selfCheck() {
  const cases = [
    ['rgb(0,0,0)', 'rgb(255,255,255)', 21],
    ['rgb(119,119,119)', 'rgb(255,255,255)', 4.48],
    ['rgb(255,255,255)', 'rgb(255,255,255)', 1],
    ['rgba(0,0,0,0)', 'rgb(255,255,255)', 1],      // transparent == the ground
    ['rgba(0,0,0,1)', 'rgb(255,255,255)', 21],     // opaque == solid
    ['rgba(20,22,26,0.26)', 'rgb(255,255,255)', 1.78],
  ];
  const bad = cases.filter(([f, b, want]) => Math.abs(ratio(f, b) - want) > 0.02);
  if (bad.length) {
    console.log('INSTRUMENT FAILED SELF-CHECK on ' + bad.length + ' known pairs; no result below means anything');
    process.exit(1);
  }
  console.log('  contrast function validated on ' + cases.length + ' known pairs');
}

/* Everything a person types into. ⚠️ ASKED, NOT LISTED: an earlier version
   named `input[type=text], textarea, select` and was silently blind to
   `type=search`. Name what it is NOT rather than enumerating what it is. */
const FIELDS = 'input:not([type=button]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=submit]), textarea, select';

async function measure(engine, scheme) {
  const browser = await pw[engine].launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: scheme });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  let out;
  try {
  out = await page.evaluate((sel) => {
    /* The wizard covers the board, so it stays hidden -- and is EXCLUDED from
       the unhide sweep below, which previously put it straight back. A line
       stating an intent the next line reverses is worse than no line. */
    document.querySelectorAll('[hidden]').forEach((el) => {
      if (el.id !== 'firstrun') el.hidden = false;
    });
    const fr = document.getElementById('firstrun');
    if (fr) fr.hidden = true;
    /* ⚠️ `body *`, not `*`: the latter also forced `head`, `style`, `script` and
       `title` visible, rendering the whole stylesheet and page script as text.
       The badge-vs-dot result survived that (both rects shift together), but any
       absolute-position or viewport assertion added later would have been
       measuring a page the product never draws. */
    document.querySelectorAll('body *').forEach((el) => {
      if (getComputedStyle(el).display === 'none') el.style.display = 'block';
    });
    // A card in the unknown-memory state, which only exists once painted.
    const grid = document.getElementById('grid');
    if (grid && typeof card === 'function') {
      const mk = (pct) => ({ name: 'Probe', sessionName: 'probe', state: 'idle',
        context: { percent: pct }, isNamedOurs: true, nameDerived: true,
        commitments: { state: 'unknown', commitments: [] },
        instructions: { state: 'unknown', editable: false } });
      grid.innerHTML = card(mk(null)) + card(mk(40));
    }
    /* ⚠️ A "NEAREST ANCESTOR MATCHING X" QUERY CANNOT REPORT AN ABSENT X. It
       finds the next match and succeeds, so a container that LOSES its paint
       makes this function skip past it silently -- and the fields it was
       flagging get measured against a different ancestor that happens to
       differ from them. Demonstrated on the design pack: deleting `.dbox`'s
       background turned four flagged fields into four clean ones. The broken
       file scored HEALTHIER than the working one.

       That is the same shape as the orphaned declaration this branch shipped,
       where `#firstrun` lost its background to a parse error and no instrument
       here could see it. So the chain is reported WHOLE, and any ancestor
       carrying a known container class is required to paint. */
    /* ⚠️ DERIVED FROM THE STYLESHEET, NOT LISTED. The first version enumerated
       these from memory and included `modalbox`, which appears nowhere in this
       build — an entry that can never match. The second version then failed on
       `.fr-box` and `.acard`, which are perfectly healthy: one is hidden in this
       fixture and the other holds no fields at all. Both mistakes are the
       enumerate-from-memory habit, the second one inside the fix for the first.
       A container is whatever DECLARES `--field-fill`, which is exactly the set
       whose paint matters to a field, and the stylesheet already knows it. */
    const CONTAINERS = (() => {
      const out = new Set();
      /* ⚠️ IDs AS WELL AS CLASSES, and rules INSIDE @media too. The first
         derivation matched only `.class` at the top level, so it silently
         dropped `#firstrun`, `#pj-settings-view` and `#pj-add-view` — and
         `#firstrun` is precisely the declarer whose lost background is the
         blocker this whole mechanism cites in its header. An instrument that
         quotes a defect as its reason and cannot see that defect is the shape
         this file exists to reject, and it took three versions to stop making
         it: enumerate-from-memory, then class-only, then this. */
      const walk = (rules) => {
        for (const rule of rules || []) {
          /* ⚠️ RECURSE AND ALSO INSPECT, never `continue`. An empty CSSRuleList
             is TRUTHY, and with CSS nesting every plain style rule carries one —
             so `if (rule.cssRules) { walk(...); continue; }` sent every rule
             down the recursion and none of them ever had its own style read.
             The derivation returned zero and the run failed loudly, which is the
             only reason this was a two-minute bug rather than a silent one: the
             denominator I added an hour ago caught the instrument, not the app. */
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
          if (!rule.style || !rule.selectorText) continue;
          if (!rule.style.getPropertyValue('--field-fill')) continue;
          for (const m of rule.selectorText.matchAll(/[.#]([a-z][a-z0-9_-]*)/gi)) {
            out.add(m[0]);   // keep the sigil: '.dbox' and '#firstrun' are different questions
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules); } catch { /* cross-origin, not ours */ }
      }
      return [...out];
    })();
    const seenContainers = new Set();
    const ground = (el) => {
      let first = null;
      const mute = [];
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const cls = String(n.className || '').split(' ');
        const known = CONTAINERS.find((c) =>
          (c[0] === '.' ? cls.includes(c.slice(1)) : n.id === c.slice(1)));
        const paints = bg && bg !== 'rgba(0, 0, 0, 0)';
        if (known) { seenContainers.add(known); if (!paints) mute.push(known); }
        if (paints && !first) {
          first = { bg, name: n.id ? '#' + n.id : '.' + String(n.className).split(' ')[0] };
        }
      }
      return first ? { ...first, mute } : { bg: null, name: '(page)', mute };
    };
    const fields = [...document.querySelectorAll(sel)].map((el) => {
      const c = getComputedStyle(el);
      const g = ground(el);
      return { id: el.id || el.tagName.toLowerCase(), tag: el.tagName.toLowerCase(),
        fill: c.backgroundColor, border: c.borderTopColor, appearance: c.appearance,
        radius: c.borderTopLeftRadius, box: g.bg, boxName: g.name, mute: g.mute,
        arrows: (c.backgroundImage.match(/linear-gradient/g) || []).length };
    });
    // The unknown-memory caption must not paint over the presence dot.
    let badgeHit = null;
    const badge = document.querySelector('.membadge.unk');
    const pres = badge && badge.closest('.agauge') && badge.closest('.agauge').querySelector('.pres');
    if (badge && pres) {
      const a = badge.getBoundingClientRect(), p = pres.getBoundingClientRect();
      const ox = Math.min(a.right, p.right) - Math.max(a.left, p.left);
      const oy = Math.min(a.bottom, p.bottom) - Math.max(a.top, p.top);
      badgeHit = { overlaps: ox > 1 && oy > 1, x: Math.round(ox), y: Math.round(oy) };
    }
    // The list row's unknown cell must carry a word, never a blank.
    let listCell = null;
    if (typeof lrow === 'function') {
      const html = lrow({ name: 'Probe', sessionName: 'probe', state: 'idle',
        context: { percent: null }, isNamedOurs: true, nameDerived: true,
        commitments: { state: 'unknown', commitments: [] },
        instructions: { state: 'unknown', editable: false } });
      const box = document.createElement('div');
      box.innerHTML = html;
      const pct = box.querySelector('.pct');
      if (pct) {
        /* ⚠️ VISIBLE TEXT ONLY. Reading `textContent` counts the `.vh`
           screen-reader span, so a cell containing ONLY hidden words scores as
           populated -- which is the exact defect this check exists to catch,
           and the mutation run proved it: blanking the visible cell left this
           reporting "memory unknown" and passing. The same mistake as asserting
           /Memory unknown/ against markup where a ring's aria-label already
           said it. Strip the hidden nodes, then read what is left. */
        const vis = pct.cloneNode(true);
        vis.querySelectorAll('.vh').forEach((n) => n.remove());
        listCell = vis.textContent.trim();
      }
    }
    return { fields, badgeHit, listCell, seenContainers: [...seenContainers], containers: CONTAINERS };
  }, FIELDS);
  } finally {
    // ⚠️ Without this a throw inside the evaluate leaks the browser and the
    // script dies on an unhandled rejection, losing its own FAILED: line and
    // its exit code — a checker that cannot report its own failure.
    await browser.close();
  }
  return { ...out, errs };
}

(async () => {
  selfCheck();
  let failures = 0;
  const fail = (msg) => { failures += 1; console.log('  FAIL  ' + msg); };

  for (const engine of ENGINES) {
    const seen = {};
    for (const scheme of ['light', 'dark']) {
      const r = await measure(engine, scheme);
      seen[scheme] = r;
      console.log(`\n== ${engine} / ${scheme} ==  fields ${r.fields.length}, page errors ${r.errs.length}`);
      for (const e of r.errs) fail(`${engine}/${scheme} ${e}`);

      const selects = r.fields.filter((f) => f.tag === 'select');
      console.log(`  selects ${selects.length}`);
      for (const s of selects) {
        if (s.appearance !== 'none') fail(`${engine}/${scheme} select #${s.id} renders the browser's own control (appearance: ${s.appearance})`);
        if (s.arrows !== 2) fail(`${engine}/${scheme} select #${s.id} lost its drawn arrow (${s.arrows} gradients)`);
      }
      const radii = new Set(selects.map((s) => s.radius));
      if (radii.size > 1) fail(`${engine}/${scheme} selects disagree on radius: ${[...radii].join(', ')}`);

      // ⚠️ A field must never be the same fill as the box it sits in.
      let level = 0;
      for (const f of r.fields) {
        if (!f.box || !f.fill) continue;
        const rr = ratio(f.fill, f.box);
        if (rr !== null && rr < 1.03 && parse(f.fill).a > 0.5) {
          level += 1;
          fail(`${engine}/${scheme} field #${f.id} is the same fill as ${f.boxName} (${f.fill})`);
        }
      }
      console.log(`  fields level with their container: ${level}`);

      /* ⚠️ A CONTAINER THAT STOPPED PAINTING. Without this the check reads a
         lost background as an improvement, because the field is then compared
         against whatever ancestor paints next. */
      const muted = new Set();
      for (const f of r.fields) for (const m of (f.mute || [])) muted.add(m);
      console.log(`  known containers painting nothing: ${muted.size}${muted.size ? ' — ' + [...muted].join(', ') : ''}`);
      /* ⚠️ THE DENOMINATOR. Without it a renamed or deleted container prints
         "0 painting nothing" and passes, which is the silent-skip shape this
         file rejects one screen below for badgeHit and listCell. */
      console.log(`  containers declaring --field-fill: ${(r.containers || []).length}`
        + `  (reached by a field in this fixture: ${(r.seenContainers || []).length})`);
      /* ⚠️ NOT REACHING one is not a failure — `.fr-box` is hidden here and
         `.acard` holds no fields — but declaring ZERO is, because it means the
         derivation found nothing and every verdict above is over an empty set. */
      if (!(r.containers || []).length) fail(`${engine}/${scheme} no container declares --field-fill, so the container check ran over nothing`);
      for (const m of muted) fail(`${engine}/${scheme} ${m} paints nothing, so every field inside it is being measured against some other ancestor`);

      /* ⚠️ BOTH REPORT UNCONDITIONALLY, AND A MISSING FIXTURE IS A FAILURE. These
         two used to be wrapped in `if (r.badgeHit)` / `if (r.listCell !== null)`,
         so a renamed class, a `card` that stopped being global, or a missing
         `#grid` would have made them print nothing and the run still say OK --
         contradicting this file's own header rule that a checker saying only OK
         cannot be caught doing nothing. The absence of a probe is not the
         absence of a defect. */
      console.log(`  unknown caption vs presence dot: ${r.badgeHit === null ? 'FIXTURE MISSING' : (r.badgeHit.overlaps ? r.badgeHit.x + 'x' + r.badgeHit.y : 'clear')}`);
      if (r.badgeHit === null) fail(`${engine}/${scheme} could not build the unknown-memory card, so nothing checked the caption against the presence dot`);
      else if (r.badgeHit.overlaps) fail(`${engine}/${scheme} the unknown-memory caption paints over the presence dot`);

      console.log(`  list row unknown cell: ${r.listCell === null ? 'FIXTURE MISSING' : JSON.stringify(r.listCell)}`);
      // ⚠️ A BLANK CELL READS AS 0%, and for memory 0% means "loads of room" --
      // the inverse of the truth, which is the worst direction to fail in.
      if (r.listCell === null) fail(`${engine}/${scheme} could not render a list row, so nothing checked its unknown cell`);
      else if (!r.listCell) fail(`${engine}/${scheme} the list row's unknown memory cell is blank, which reads as 0%`);
    }

    // ⚠️ SAME DIRECTION IN BOTH SCHEMES. A field lighter than its container in
    // one and darker in the other is distinguishable in both and still wrong:
    // the relationship flips. A level check alone cannot see this.
    const dir = (f) => {
      const a = parse(f.fill), b = parse(f.box);
      if (!a || !b || a.a === 0) return 'n/a';
      const d = L(a) - L(b);
      return Math.abs(d) < 0.002 ? 'level' : (d > 0 ? 'raised' : 'recessed');
    };
    /* ⚠️ INDEX-QUALIFIED. Keying on `id || tagName` collapsed every field without
       an id onto one key per tag and silently dropped all but the last from the
       comparison -- coverage shrinking with no printed sign, which is the same
       cannot-be-caught-doing-nothing hazard this file's header names. */
    const byId = (list) => Object.fromEntries(list.map((f, i) => [f.id ? '#' + f.id : `${f.tag}[${i}]`, f]));
    const lightById = byId(seen.light.fields), darkById = byId(seen.dark.fields);
    let flipped = 0;
    for (const id of Object.keys(lightById)) {
      if (!darkById[id]) continue;
      const dl = dir(lightById[id]), dd = dir(darkById[id]);
      if (dl !== 'n/a' && dd !== 'n/a' && dl !== dd) {
        flipped += 1;
        fail(`${engine} field #${id} is ${dl} in light and ${dd} in dark`);
      }
    }
    console.log(`\n  ${engine}: fields whose relationship to their container flips between schemes: ${flipped}`);
  }

  console.log('\n' + (failures ? `FAILED: ${failures}` : 'OK: every field and control invariant holds in both engines, both schemes'));
  process.exit(failures ? 1 : 0);
})();
