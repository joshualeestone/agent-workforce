'use strict';

/**
 * The panel that says which agents will not come back after a restart.
 *
 * 🛑 THE BOARD KNEW AND DID NOT SAY. An agent with a login job and one without
 * draw the same card, so the only way to learn which of yours survive a restart
 * was to restart. Josh did, on 2026-08-22, and one of his sixteen came back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function paint(reply, { onAgents = true } = {}) {
  const wrap = { hidden: false, innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'restart-wrap' ? wrap : null) };
  const fetchStub = async () => {
    if (reply === 'throws') throw new Error('offline');
    if (reply === 'down') return { ok: false, json: async () => ({ error: 'no' }) };
    return { ok: true, json: async () => reply };
  };
  const fn = new Function(
    'document', 'fetch', 'esc', 'onAgentsTab', 'SURVIVAL_BUSY',
    page.lift(SCRIPT, 'survivalSay') + '\n' + page.lift(SCRIPT, 'paintSurvival')
    + '\nreturn paintSurvival();',
  )(doc, fetchStub, (x) => String(x), () => onAgents, false);
  return fn.then(() => wrap);
}

test('it names them, because a count is not something anybody can act on', async () => {
  const wrap = await paint({ ok: true, missing: ['brigitte', 'marilyn', 'rick'] });
  assert.equal(wrap.hidden, false);
  assert.match(wrap.innerHTML, /3 of your agents will not come back/);
  for (const n of ['brigitte', 'marilyn', 'rick']) {
    assert.ok(wrap.innerHTML.includes(n), `${n} is missing from the list somebody has to act on`);
  }
});

test('one agent reads as one agent', async () => {
  /* "1 agents" is the seam this screen keeps being caught on. */
  const wrap = await paint({ ok: true, missing: ['anna'] });
  assert.match(wrap.innerHTML, /One of your agents will not come back/);
  assert.ok(!/1 of your agents/.test(wrap.innerHTML));
});

test('there is one action and no way to dismiss it', async () => {
  /* ⚠️ A STATE WITH A REMEDY, not a notice. Closing it would change nothing
     about the machine and the sentence would still be true tomorrow, so a
     dismiss would be a button that lies about what it did. */
  const wrap = await paint({ ok: true, missing: ['brigitte'] });
  assert.match(wrap.innerHTML, /data-survival-fix/);
  assert.ok(!/Later|Dismiss|data-survival-close/i.test(wrap.innerHTML),
    'the panel offers a way to close a state that closing does not change');
});

test('it says nothing at all when every agent has a job', async () => {
  const wrap = await paint({ ok: true, missing: [] });
  assert.equal(wrap.hidden, true);
  assert.equal(wrap.innerHTML, '');
});

test('a failed look leaves the screen alone rather than clearing it', async () => {
  /* 🛑 THE WHOLE DEFECT THIS PANEL EXISTS FOR IS A SILENCE READ AS AN
     ALL-CLEAR. A 500 whose JSON body parses is exactly how that happens
     again, one layer up. */
  for (const bad of ['down', 'throws', { ok: false, because: 'we could not read it' }, null, { ok: true }]) {
    const wrap = { hidden: false, innerHTML: 'STANDING' };
    const doc = { getElementById: () => wrap };
    await new Function('document', 'fetch', 'esc', 'onAgentsTab', 'SURVIVAL_BUSY',
      page.lift(SCRIPT, 'survivalSay') + '\n' + page.lift(SCRIPT, 'paintSurvival') + '\nreturn paintSurvival();')(
      doc,
      async () => {
        if (bad === 'throws') throw new Error('offline');
        if (bad === 'down') return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => bad };
      },
      (x) => String(x), () => true, false,
    );
    assert.equal(wrap.innerHTML, 'STANDING', `a ${JSON.stringify(bad)} answer wiped the panel`);
  }
});

test('it does not stand under another tab', async () => {
  const wrap = await paint({ ok: true, missing: ['brigitte'] }, { onAgents: false });
  assert.equal(wrap.hidden, true);
});

test('the sentence never claims the folders are at risk', async () => {
  /* Nothing was deleted; these agents are stopped and unregistered. The panel
     has to be alarming about the right thing or somebody starts recreating
     agents whose folders are sitting there. */
  const wrap = await paint({ ok: true, missing: ['brigitte'] });
  assert.match(wrap.innerHTML, /folders and everything\s+they remember are untouched/);
});
