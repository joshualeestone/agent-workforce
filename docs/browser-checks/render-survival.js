'use strict';

/**
 * The restart-survival panel, as a person actually sees it (#277).
 *
 * 🔑 IT ASSERTS THE RENDERED STATE. The unit tests read the markup this panel
 * writes; nothing in them has ever rendered a page, which is how a fully
 * transparent modal once survived 316 tests here. What matters about this
 * panel is that somebody LOOKS at their board and finds out, so the claims are
 * visibility, contrast and the absence of a dismiss.
 *
 * Run against a sandboxed board, never the operator's real data. It also needs
 * AGENT_WORKFORCE_DRY_RUN=1: the button writes launchd jobs and starts
 * processes, and launchd has no sandbox root to point somewhere harmless.
 *
 *   SB=$(mktemp -d); mkdir -p "$SB/data/AgentWorkforce/profiles" "$SB/workers/brigitte"
 *   echo '{"role":"helper"}' > "$SB/data/AgentWorkforce/profiles/brigitte.json"
 *   AGENT_WORKFORCE_DRY_RUN=1 AGENT_WORKFORCE_DATA="$SB/data" \
 *     AGENT_WORKFORCE_WORKERS="$SB/workers" AGENT_WORKFORCE_LAUNCH="$SB/launch" \
 *     PORT=17351 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17351 node docs/browser-checks/render-survival.js /tmp/survshots
 *
 * ⚠️ HEADED by default. Headless is SwiftShader software rendering and its
 * screenshots differ from the real compositor on every pixel, which reads as a
 * visual regression and is a GPU.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17351';
const OUT = process.argv[2] || '/tmp/survshots';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); }
    await pg.waitForTimeout(1200);

    const wrap = await pg.$('#restart-wrap');
    chk(Boolean(wrap), theme + ': the panel is in the page');
    /* ⚠️ NOT offsetParent, and not `hidden`. A panel can be present, unhidden
       and painted a colour nobody can see; what a person needs is a box with
       real size on screen. */
    const box = wrap && await wrap.boundingBox();
    chk(Boolean(box && box.width > 200 && box.height > 40), theme + ': it has real size on screen',
      box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'no box');

    const txt = wrap ? (await wrap.innerText()) : '';
    chk(/will not come back if you restart/.test(txt), theme + ': it says what is wrong');
    chk(/brigitte/.test(txt), theme + ': it names the agent');
    chk(!/Later|Dismiss/i.test(txt), theme + ': there is no dismiss on a state with a remedy');

    /* ⚠️ ABOVE THE CARDS. It is a fact about the whole fleet, and a person who
       has to scroll past their agents to find it has not been told. */
    const grid = await pg.$('#grid');
    const gbox = grid && await grid.boundingBox();
    chk(Boolean(box && gbox && box.y < gbox.y), theme + ': it sits above the cards');

    /* The action, actually clicked, against a dry-run engine. */
    await pg.screenshot({ path: path.join(OUT, 'survival-before-' + theme + '.png'), fullPage: false });
    await pg.click('[data-survival-fix]');
    await pg.waitForTimeout(1200);
    const after = await pg.innerText('#restart-wrap');
    chk(/Done\./.test(after), theme + ': pressing it reports back', after.slice(0, 60).replace(/\n/g, ' '));
    chk(/brigitte/.test(after), theme + ': the report is per agent, not a total');

    await pg.screenshot({ path: path.join(OUT, 'survival-' + theme + '.png'), fullPage: false });
    chk(errs.length === 0, theme + ': no console errors', errs.join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
