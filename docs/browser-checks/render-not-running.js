'use strict';

/**
 * The card and the tile for an agent that is not running (#278).
 *
 * 🔑 THE CLAIMS ARE ABOUT WHAT IS ABSENT, which a markup test answered wrongly
 * once already today: the card renders, and what matters is that there is no
 * memory ring inside it and that the face is still there. Both are counts of
 * rendered elements rather than a search of a string.
 *
 * ⚠️ AND IT FOUND THE SHIP-BLOCKER. `lrow` read `a.context.percent`, which a
 * not-running agent does not have, so a single stopped agent took the whole
 * board down to "we cannot read your agents" while every markup test passed.
 *
 *   SB=$(mktemp -d); mkdir -p "$SB/data/AgentWorkforce/profiles" "$SB/workers/ghosty"
 *   echo '{"role":"Copywriter","displayName":"Ghosty"}' > "$SB/data/AgentWorkforce/profiles/ghosty.json"
 *   AGENT_WORKFORCE_DRY_RUN=1 AGENT_WORKFORCE_DATA="$SB/data" \
 *     AGENT_WORKFORCE_WORKERS="$SB/workers" PORT=17421 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-not-running.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 700 }, colorScheme: theme });
    await pg.goto('http://127.0.0.1:17421', { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(1400);
    const seen = await pg.evaluate(() => {
      const c = (id) => { const e = document.getElementById(id); return e ? { t: e.textContent, hidden: e.hidden } : null; };
      const nr = document.querySelector('.acard.notrunning');
      const box = nr ? nr.getBoundingClientRect() : null;
      return {
        agents: c('st-agents'), off: c('st-off'), idle: c('st-idle'),
        cardText: nr ? nr.innerText.replace(/\n/g, ' | ') : 'NO CARD',
        w: box ? Math.round(box.width) : 0, h: box ? Math.round(box.height) : 0,
        rings: nr ? nr.querySelectorAll('circle.gu, circle.gt, circle.gf').length : -1,
        face: nr ? nr.querySelectorAll('.avatar-initials, image').length : -1,
        running: document.querySelectorAll('.acard:not(.notrunning)').length,
      };
    });
    const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + theme + ': ' + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
    say(seen.w > 100 && seen.h > 80, 'the not-running card has real size', seen.w + 'x' + seen.h);
    say(/Not running/.test(seen.cardText), 'it says Not running', seen.cardText.slice(0, 70));
    say(seen.rings === 0, 'no memory ring at all, not even the unknown one', String(seen.rings));
    say(seen.face === 1, 'the face is still drawn', String(seen.face));
    say(!seen.off.hidden && seen.off.t === '2', 'the tile counts them', JSON.stringify(seen.off));
    say(Number(seen.agents.t) === seen.running + 2, 'the row adds up', seen.agents.t + ' = ' + seen.running + ' running + 2');
    await pg.screenshot({ path: '/tmp/nrshots/nr-' + theme + '.png', clip: { x: 0, y: 60, width: 1400, height: 420 } });
    await pg.close();
  }
  await b.close();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
