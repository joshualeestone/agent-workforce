'use strict';

/**
 * What the restart confirmation says a restart would cost.
 *
 * 🛑 THIS DIALOG IS THE REASON `engine/commitments.js` EXISTS. Its opening
 * line: restarting an agent kills whatever it had in flight, and the fresh
 * session reports a confident all-clear. Its purpose line: "The point of this
 * file is not to hold a list. It is to make the restart confirmation incapable
 * of lying."
 *
 * ⚠️ AND THE DIALOG HAD NEVER BEEN DRAWN. `server.js` attaches a commitment
 * block to every agent, its comment says "it is that value the restart
 * confirmation needs" and "the restart dialog reads these", and the page did
 * not contain the word `commitments` anywhere. Engine and route complete,
 * screen absent.
 *
 * 🔑 THE ONE RULE UNDER ALL OF IT: "nothing to lose" is honest ONLY when the
 * agent said so RECENTLY. `clear` is earned. `unknown` covers never-reported,
 * stale past thirty minutes, future-dated and untied, and rendering any of
 * those as "nothing pending" is the confident all-clear the file exists to
 * prevent.
 *
 * Found by Mona Lisa, who withdrew her own no-dialog ruling on #259 after
 * reading commitments.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function cost(rec, shown = 'April') {
  // eslint-disable-next-line no-new-func
  return new Function('REC', 'SHOWN',
    page.lift(SCRIPT, 'restartCost') + '\nreturn restartCost(SHOWN, REC);')(rec, shown);
}

const HOLDING = {
  state: 'holding',
  commitments: ['Send the Q3 summary to Dana', 'Chase the invoice from Ramp'],
  because: 'it reported these itself',
};
const CLEAR = { state: 'clear', commitments: [], because: 'it reported nothing' };
const NEVER = { state: 'unknown', commitments: [], because: 'it has never reported' };
const STALE = {
  state: 'unknown',
  commitments: ['Draft the supplier email'],
  because: 'it last reported 41 minutes ago, too long to still be true',
};

test('holding names the count and says the work ends', () => {
  const c = cost(HOLDING);
  assert.match(c.small, /part way through 2 things/);
  assert.match(c.small, /Restarting ends them/);
  assert.equal(c.list.length, 2, 'the work is counted and not shown');
  /* ⚠️ AND IT DECLENSES AT ONE. "part way through 1 things" on the one screen
     whose job is being believed is the kind of seam that makes a person
     distrust the number beside it. */
  assert.match(cost({ ...HOLDING, commitments: ['Just the one'] }).small, /part way through one thing\./);
});

test('clear is the ONLY state that says nothing is pending', () => {
  const c = cost(CLEAR);
  assert.match(c.small, /is not part way through anything/);
  assert.equal(c.list.length, 0);
  /* 🛑 THE ASSERTION THIS FILE IS FOR. Every state that is not `clear` must
     refuse to make this claim, because `clear` is the only one the agent
     earned by speaking recently. */
  for (const [label, rec] of [['never', NEVER], ['stale', STALE], ['holding', HOLDING]]) {
    assert.ok(!/not part way through anything/.test(cost(rec).small),
      'the ' + label + ' state claimed nothing is pending');
  }
});

test('unknown says we cannot tell, in the ENGINE’S words for why', () => {
  /* The engine distinguishes never-reported from stale from untied, and those
     are different facts a person weighs differently. A sentence written here
     would flatten all three into one, and would go stale the day the engine
     learns a fourth. */
  assert.match(cost(NEVER).small, /cannot tell what April is part way through/);
  assert.match(cost(NEVER).small, /it has never reported/);
  assert.match(cost(STALE).small, /41 minutes ago/);
  assert.match(cost(STALE).small, /Restarting ends anything it had in flight/);
});

test('a stale record still shows its list, because it is worth more than an empty one', () => {
  /* commitments.js keeps the list on a stale record deliberately: "these three
     were pending 40 minutes ago" is far more useful at 3am than an empty
     array, as long as the state says we cannot vouch for it. So the list is
     shown and the SENTENCE does the disclaiming. */
  const c = cost(STALE);
  assert.equal(c.list.length, 1, 'a stale record dropped the work it knew about');
  assert.match(c.small, /cannot tell/, 'a stale list is shown without the disclaimer');
});

test('a missing or malformed record is treated as unknown, never as clear', () => {
  /* ⚠️ THE FAILURE DIRECTION. A card with no commitment block at all, or one
     whose shape drifted, must not read as "nothing pending". Every one of
     these is a state where we have not been told, and the honest answer for
     all of them is the same. */
  for (const rec of [null, undefined, {}, { state: 'nonsense' }, { state: 'clear', commitments: 'not an array' }]) {
    const c = cost(rec);
    assert.ok(!/is not part way through anything/.test(c.small),
      'a record of ' + JSON.stringify(rec) + ' rendered as nothing pending');
    assert.ok(Array.isArray(c.list), 'the list is not an array for ' + JSON.stringify(rec));
  }
  /* Except the one that IS well-formed and clear: the control above must not
     be passing merely because nothing can produce that sentence any more. */
  assert.match(cost(CLEAR).small, /is not part way through anything/);
});

test('the dialog is its own, and both entry points go through it', () => {
  assert.match(PAGE, /id="rst-modal"/, 'the restart confirmation does not exist');
  assert.match(PAGE, /id="rst-modal"[\s\S]{0,400}role="alertdialog"/,
    'the confirmation is not announced as one');
  /* 🔑 The click handler OPENS the dialog rather than restarting. A dialog on
     the panel control only would leave the stale-instructions notice able to
     end an agent's in-flight work silently, which is the older path and the
     one somebody already uses. */
  const opener = SCRIPT.slice(SCRIPT.indexOf("closest('[data-restart-agent]')"));
  const body = opener.slice(0, opener.indexOf('\n});'));
  assert.match(body, /openRestartModal\(btn, name\)/, 'the shared handler no longer opens the dialog');
  assert.ok(!/fetch\(/.test(body), 'the shared handler still restarts directly, skipping the confirmation');
});

test('every accidental dismissal lands on leaving it running', () => {
  /* What makes a loud dialog safe. Backdrop, Escape and initial focus all
     resolve to the harmless answer, which is the removal dialog's rule and is
     the reason it can afford to be loud. */
  assert.match(SCRIPT, /getElementById\('rst-modal'\)\.addEventListener\('click'[\s\S]{0,200}closeRestartModal/,
    'clicking the backdrop does not leave it running');
  assert.match(SCRIPT, /if \(!document\.getElementById\('rst-modal'\)\.hidden\) closeRestartModal\(\)/,
    'Escape does not leave it running');
  assert.match(page.lift(SCRIPT, 'openRestartModal'), /getElementById\('rst-keep'\)\.focus\(\)/,
    'the dialog opens with focus on the destructive answer');
});

test('the commitment text is escaped, because an agent wrote it', () => {
  /* The one value in this dialog that this code did not write. It comes from a
     file an agent writes about itself. */
  const src = page.lift(SCRIPT, 'openRestartModal');
  assert.match(src, /esc\(/, 'the commitments an agent wrote reach the page unescaped');
});
