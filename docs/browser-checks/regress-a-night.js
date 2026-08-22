'use strict';

/**
 * Everything the night of 2026-08-21 added, drawn together on one build.
 *
 * ⚠️ WHY THIS EXISTS SEPARATELY FROM THE OTHER CHECKS HERE. Each of those pins
 * one surface. This one pins that twenty-one releases still COMPOSE: the three
 * board layouts, four Settings switches, the accounts list, Delete history and
 * a task page with parts, in both themes, on one page load. Every one of those
 * was verified when it shipped and then had hours of other work land on top of
 * it, which is the moment nobody looks again.
 *
 * 🔑 IT ASSERTS COMPUTED STATE, not pixels. Border widths, `aria-checked`,
 * which container is hidden, derived text. A screenshot diff would fail on a
 * font hint and pass on a missing rule; these fail only when the claim is
 * false.
 *
 * Run against a sandboxed board (never the operator's real data):
 *
 *   AGENT_WORKFORCE_DATA=/tmp/regress PORT=17340 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17340 node docs/browser-checks/regress-a-night.js
 *
 * It needs one project called "Regression Sweep" with two members and one task
 * carrying two parts; `seed()` below prints the four lines that make it.
 *
 * ⚠️ HEADED by default, like its neighbours. `HEADED=0` on a machine with no
 * console session.
 */

const { chromium } = require('playwright');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17340';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

function seed() {
  console.log(`  const projects = require('./engine/projects'), tasks = require('./engine/tasks');
  const p = projects.create({ name: 'Regression Sweep' });
  projects.writeAll(projects.readAll().map((x) => (x.id === p.id ? { ...x, agents: ['april', 'mikey'] } : x)));
  tasks.create(p.id, { sentence: 'A task with parts', who: 'april' });
  tasks.addPart(p.id, 1, { sentence: 'Second piece' });`);
}

(async () => {
  if (process.argv.includes('--seed')) { seed(); return; }
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: theme });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    pg.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text());
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); }
    await pg.waitForTimeout(1400);

    /* ⚠️ SCOPED TO THE AGENTS TOGGLE. `[data-layout="grid"]` matches TWO
       buttons -- the projects screen has its own pair -- and the first in the
       DOM is the projects one, which is hidden. A selector resolving to two
       elements and silently taking the first is the class this whole directory
       exists for. */
    for (const layout of ['grid', 'list', 'org']) {
      await pg.click('.viewtoggle[data-scope="agents"] [data-layout="' + layout + '"]');
      await pg.waitForTimeout(700);
      const state = await pg.evaluate(() => ({
        grid: document.getElementById('grid').hidden,
        list: document.getElementById('alist').hidden,
        org: document.getElementById('orgview').hidden,
      }));
      const shown = Object.keys(state).filter((k) => state[k] === false);
      /* 🔑 EXACTLY ONE. The two-layout version tested `!== 'list'`, which is
         true for `org` -- so the grid stayed on UNDERNEATH the chart, and any
         check asking only "is the org view visible" passed. */
      chk(shown.length === 1, theme + ': ' + layout + ' shows exactly one container', JSON.stringify(shown));
    }
    chk((await pg.evaluate(() => document.querySelectorAll('.onode').length)) > 0,
      theme + ': the org chart draws');

    await pg.click('.tab:has-text("Settings")');
    await pg.waitForTimeout(1800);
    const sw = await pg.evaluate(() => ['lim-toggle', 'tell-toggle', 'auto-toggle', 'eng-toggle']
      .map((id) => document.getElementById(id).getAttribute('aria-checked')));
    /* Every switch is born `mixed` and must resolve. A switch still reading
       mixed after a good load means its fetch never landed. */
    chk(sw.every((x) => x === 'true' || x === 'false'),
      theme + ': all four switches resolved', JSON.stringify(sw));
    chk((await pg.evaluate(() => document.querySelectorAll('#set-accounts .acct-row').length)) > 0,
      theme + ': the accounts list is read, not asserted');
    const hist = await pg.evaluate(() => document.getElementById('hist-count').textContent);
    chk(/nothing here to delete|Right now/.test(hist), theme + ': delete-history says what is there', hist);

    await pg.click('.tab:has-text("Projects")'); await pg.waitForTimeout(500);
    await pg.click('text=Regression Sweep'); await pg.waitForTimeout(700);
    const door = await pg.$('#pj-alltasks:not([hidden])');
    if (door) { await door.click(); await pg.waitForTimeout(300); }
    await pg.click('.tkcard'); await pg.waitForTimeout(700);
    const tk = await pg.evaluate(() => ({
      parts: document.querySelectorAll('.tkpart').length,
      state: document.getElementById('tk-state').textContent,
      pickable: document.querySelectorAll('[data-pick-part]').length,
      tops: [...document.querySelectorAll('.tkpart')]
        .map((r) => Math.round(parseFloat(getComputedStyle(r).borderTopWidth) || 0)),
      addTop: Math.round(parseFloat(getComputedStyle(document.querySelector('.tkpart-add')).borderTopWidth) || 0),
    }));
    chk(tk.parts === 2, theme + ': two parts draw', String(tk.parts));
    chk(tk.state === '0 of 2 parts done', theme + ': the state is derived from the parts', tk.state);
    chk(tk.pickable === 2, theme + ': both parts can be assigned');
    /* 🛑 THE SEPARATOR, WHICH SHIPPED WRONG ONCE. A `:last-of-type` cancel
       selected zero elements because the Add row is the last div, so every task
       drew a stray rule above the input. Between-siblings cannot break that
       way, and this is what says so. */
    chk(tk.tops[0] === 0 && tk.tops[1] === 1 && tk.addTop === 0,
      theme + ': the rule sits between parts and not above the Add row',
      JSON.stringify(tk.tops) + ' add ' + tk.addTop);

    chk(errs.length === 0, theme + ': no console errors', errs.slice(0, 2).join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED: ' + fail.join('; ') : '\nall green');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED', e.message); process.exit(2); });
