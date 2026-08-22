'use strict';

/**
 * Everything two nights of releases added, drawn together on one build.
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

    /* ══ the night of 2026-08-22, fifteen more releases ══════════════════
       Added for the same reason as everything above: each of these was
       verified when it shipped and then had hours of other work land on top of
       it. What is pinned here is that they still COMPOSE on one build, not that
       they work, which their own tests already say. */

    /* The restart control (#259) and its confirmation (#144's remedy path).
       On the panel, above Remove, outside the danger block.
       ⚠️ BACK TO THE AGENTS TAB AND THE GRID FIRST, in that order. The checks
       above leave the page on a task, and the layout loop leaves the agents
       view on `org`, which draws no `.acard` at all. Each of those made a click
       here time out for thirty seconds and read as the control being missing
       rather than as the wrong screen being open, which is the same
       could-not-look-reported-as-a-finding this file exists to avoid. */
    await pg.evaluate(() => showTab('agents'));
    await pg.waitForTimeout(700);
    await pg.click('.viewtoggle[data-scope="agents"] [data-layout="grid"]');
    await pg.waitForTimeout(600);
    await pg.locator('.acard .namego').first().click();
    await pg.waitForTimeout(1600);
    const rst = await pg.evaluate(() => {
      const box = document.getElementById('d-restart-agent');
      const rm = document.getElementById('d-remove-agent');
      return {
        shown: box && !box.hidden,
        aboveRemove: box && rm && box.getBoundingClientRect().top < rm.getBoundingClientRect().top,
        hint: box && box.querySelector('.fhint').textContent,
        /* The lede is painted per agent now (#198), so it must not be the
           generic once a panel is open. */
        lede: (document.getElementById('d-instr-lede') || {}).textContent || '',
        saves: [...document.querySelectorAll('#d-instr-save, #d-save')].map((b) => b.getAttribute('aria-label')),
      };
    });
    chk(rst.shown && rst.aboveRemove, theme + ': restart is on the panel, above Remove');
    chk(/anything it was part way through ends/.test(rst.hint),
      theme + ': the restart hint names the work, not only the memory');
    chk(/the only thing that survives a restart/.test(rst.lede),
      theme + ': the instructions lede states the consequence', rst.lede.slice(0, 40));
    chk(!/^What this agent is for/.test(rst.lede), theme + ': the lede names the agent');
    /* 🔑 TWO SAVES, TWO NAMES. A screen reader heard one word for both. */
    chk(new Set(rst.saves.filter(Boolean)).size === 2,
      theme + ': the two Save buttons answer to different names', JSON.stringify(rst.saves));

    await pg.click('#d-restart-start');
    await pg.waitForTimeout(600);
    const dlg = await pg.evaluate(() => {
      const m = document.getElementById('rst-modal');
      const box = m.querySelector('.rm-box');
      return { open: !m.hidden, h: Math.round(box.getBoundingClientRect().height),
        title: document.getElementById('rst-title').textContent,
        small: document.getElementById('rst-small').textContent,
        focused: document.activeElement && document.activeElement.id };
    });
    chk(dlg.open && dlg.h > 100, theme + ': the restart confirmation opens and is drawn', String(dlg.h));
    chk(/^Restart /.test(dlg.title), theme + ': it names the agent', dlg.title);
    /* Only `clear` may say nothing is pending, and this board's agents have
       never reported, so the dialog must NOT claim they are clear. */
    chk(!/is not part way through anything/.test(dlg.small),
      theme + ': an unreported agent is not called clear', dlg.small.slice(0, 60));
    chk(dlg.focused === 'rst-keep', theme + ': it opens on the harmless answer', String(dlg.focused));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(300);
    chk(await pg.evaluate(() => document.getElementById('rst-modal').hidden),
      theme + ': Escape leaves it running');

    /* The create form: the model hint and the disclosure (#202), and the tell
       box reading the standing answer (#258). */
    /* Back to the board: the detail panel is still open from the block above,
       and `#new-agent` lives on the board behind it. Third time in this file a
       click has needed the previous screen closed first, which is what happens
       when checks share one page in sequence. */
    await pg.evaluate(() => showTab('agents'));
    await pg.waitForTimeout(700);
    await pg.click('#new-agent');
    await pg.waitForTimeout(400);
    await pg.click('#pick-pm');
    await pg.click('#role-next');
    await pg.waitForTimeout(700);
    const create = await pg.evaluate(() => {
      const d = document.querySelector('#cstep-name .smore');
      const tell = document.getElementById('create-tell');
      return { hint: (document.querySelector('#cstep-name p.shint') || {}).textContent,
        disclosureClosed: d ? d.open === false : null,
        models: d ? d.querySelectorAll('li').length : 0,
        tellDisabled: tell.disabled, tellChecked: tell.checked,
        note: (document.getElementById('create-tell-note') || {}).textContent };
    });
    chk(/You can change this later/.test(create.hint || ''), theme + ': the model hint is there');
    chk(create.disclosureClosed === true && create.models === 5,
      theme + ': five more models, behind a closed disclosure', JSON.stringify(create));
    /* The setting is on by default on a fresh board, so the box is usable and
       says nothing. What must never happen is checked-and-disabled, or a note
       with the box enabled. */
    chk(create.tellChecked !== create.tellDisabled,
      theme + ': the tell box agrees with itself', JSON.stringify([create.tellChecked, create.tellDisabled]));

    chk(errs.length === 0, theme + ': no console errors', errs.slice(0, 2).join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED: ' + fail.join('; ') : '\nall green');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED', e.message); process.exit(2); });
