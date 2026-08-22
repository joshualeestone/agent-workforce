'use strict';

/**
 * Restarting an agent is reachable when the agent is FINE.
 *
 * 🛑 IT WAS NOT. `removal.restart` and the route `/api/agent/<name>/restart`
 * have existed for as long as the detail panel has, and the only button that
 * called either lived inside the stale-instructions notice, which
 * `renderStale` hides whenever the state is `current`. So a person could
 * restart an agent whose instructions had drifted and could NOT restart one
 * that was simply wedged, which is the case anybody actually reaches for.
 *
 * 🔑 Complete on the server, unreachable on the screen. An engine-side check
 * for "does a restart path exist" answers yes and cannot see this by
 * construction, which is the same re-keying Mona Lisa made on #204 the same
 * night.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/**
 * ⚠️ THE BODY BRACE, NOT THE FIRST ONE. The obvious version starts its walk at
 * `indexOf('{', at)`, which for `loadRemoval(sessionName, { fromPoll = false }
 * = {})` is a DESTRUCTURED PARAMETER. The walk then closes on that parameter
 * and returns a signature instead of a function, so every assertion about the
 * body fails and reads exactly like the code being wrong. Walk the parameter
 * parens first, then take the brace after them.
 */
function lift(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  let p = 0; let bodyAt = -1;
  for (let k = SCRIPT.indexOf('(', at); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '(') p += 1;
    else if (SCRIPT[k] === ')') { p -= 1; if (p === 0) { bodyAt = SCRIPT.indexOf('{', k); break; } }
  }
  assert.ok(bodyAt > -1, name + ' has no body');
  let depth = 0; let end = -1;
  for (let k = bodyAt; k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  return SCRIPT.slice(at, end);
}

/* CONTROL for the above: a function with a destructured parameter must come
   back with its body, not with its signature. If this shrinks to a few dozen
   characters the walker has closed on the parameter again. */
test('the extractor returns a body, not a parameter list', () => {
  const got = lift('loadRemoval');
  assert.ok(got.length > 2000, 'lift returned ' + got.length + ' characters, which is a signature');
  assert.match(got, /REMOVE_TOKEN/, 'the extracted text does not contain the function body');
});

test('the control is in the static markup and is not the stale notice', () => {
  assert.match(PAGE, /id="d-restart-agent"/, 'the detail panel has no restart control');
  assert.match(PAGE, /id="d-restart-start"[\s\S]{0,200}data-restart-agent/,
    'the button does not carry the attribute the restart handler listens for');
  /* 🔑 THE POINT OF THE WHOLE CHANGE: two restart buttons, in two places, one
     of which is not inside the conditional notice. A single one would mean the
     control is still hidden whenever instructions are current. */
  const count = (PAGE.match(/data-restart-agent/g) || []).length;
  assert.ok(count >= 2, 'there is only one restart button, so it is still the notice-only one');
});

test('opening a panel points the button at that agent and reveals it', () => {
  const src = lift('loadRemoval');
  assert.match(src, /rstBtn\.dataset\.restartAgent = sessionName/,
    'the button is not pointed at the open agent, so it restarts nobody or the wrong one');
  assert.match(src, /rst\.hidden = false/, 'the control is never revealed');
  /* ⚠️ UNCONDITIONALLY, not behind the removal answer. Gating it on that would
     hide the control on exactly the machines where the board cannot answer,
     which is when an agent is most likely to be wedged. */
  const gate = src.slice(0, src.indexOf('rst.hidden = false'));
  assert.ok(!/if \(!reached\)/.test(gate) && !/ask &&/.test(gate),
    'revealing the restart control was made conditional on the removal answer');
});

test('a poll does not wipe the receipt of a restart just performed', () => {
  /* The five-second poll calls this with fromPoll. Clearing the message there
     would blank the confirmation while the person is still reading it, which
     is the regression its neighbour's comment records having been introduced
     once already. */
  const src = lift('loadRemoval');
  const at = src.indexOf("getElementById('d-restart-msg')");
  assert.ok(at > -1, 'the restart message is never cleared, so it survives a change of agent');
  const before = src.slice(0, at);
  const lastGuard = before.lastIndexOf('if (!fromPoll)');
  const lastClose = before.lastIndexOf('}');
  assert.ok(lastGuard > lastClose,
    'the restart message is cleared outside a !fromPoll guard, so every poll wipes it');
});

test('the message goes where the button says, not where one of the two layouts puts it', () => {
  const src = lift('noteFor');
  assert.match(src, /dataset\.restartNote/, 'the named element is not consulted');
  /* 🛑 AND THE SIBLING LOOKUP SURVIVES. It is correct for the stale notice,
     where the button and its note share a parent. Replacing it rather than
     falling back to it would have moved the defect instead of fixing it. */
  assert.match(src, /instr-restart-note/, 'the stale notice lost its message element');
});

test('the panel control gives a receipt, because nothing else on it changes', () => {
  /* ⚠️ THE NOTICE DELIBERATELY HAS NO SUCCESS SENTENCE: its receipt is that it
     disappears, which is truer than a line claiming it worked. The panel
     control does not disappear, so without a sentence its success and its
     silent failure are the same picture. Same rule, opposite conclusion. */
  const src = SCRIPT.slice(SCRIPT.indexOf("closest('[data-restart-agent]')"));
  const body = src.slice(0, src.indexOf('\n});'));
  assert.match(body, /Restarted\./, 'a successful restart says nothing anywhere');
  assert.match(body, /noteFor\(btn\)/g, 'the receipt does not use the shared lookup');
  assert.ok((body.match(/noteFor\(btn\)/g) || []).length >= 2,
    'only one of the two outcomes reports through the shared lookup');
});

test('the consequence is named before the click, not after it', () => {
  /* Josh has twice read a restarted agent's empty memory as the product being
     broken. The sentence exists for that, and it belongs above the button. */
  const block = PAGE.slice(PAGE.indexOf('id="d-restart-agent"'), PAGE.indexOf('id="d-remove-agent"'));
  assert.ok(block.length > 0 && block.length < 4000, 'the two blocks are no longer adjacent');
  const hintAt = block.indexOf('comes back with nothing in its memory');
  const btnAt = block.indexOf('<button');
  assert.ok(hintAt > -1, 'the memory consequence is not stated');
  assert.ok(hintAt < btnAt, 'the consequence is stated after the button rather than before it');
  assert.match(block, /instructions and its files are untouched/,
    'the sentence names what is lost without naming what is kept');
});
