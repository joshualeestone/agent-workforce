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
/* One extractor, in test-support/page.js. There were four copies of this and
   three walked to the first brace after the function NAME, which for a
   destructured parameter is the parameter itself. See that file for why that
   fails quietly rather than loudly. */
const page = require('./test-support/page');
const lift = (name) => page.lift(SCRIPT, name);

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

test('a refusal stays in the dialog and a success reports on the control that opened it', () => {
  /* ⚠️ TWO SURFACES, TWO DESTINATIONS, and both were once one. The engine
     refuses a restart with a sentence naming the reason and the remedy
     ("was not started by Kosmos, so we cannot start it again"). Closing the
     dialog first would put that sentence on a surface the person has already
     looked away from, so the refusal stays where they are looking.

     The receipt goes the other way. The dialog closes on success, so a
     sentence written into it would vanish with it; it lands on the control
     that opened it, which is still there. The stale-instructions notice needs
     no receipt at all because its receipt is DISAPPEARING, and the shared
     lookup handles both. */
  const src = SCRIPT.slice(SCRIPT.indexOf("getElementById('rst-go').addEventListener"));
  const body = src.slice(0, src.indexOf('\n});'));
  assert.match(body, /getElementById\('rst-msg'\)\.textContent/,
    'a refused restart says nothing in the dialog the person is looking at');
  assert.match(body, /Restarted\./, 'a successful restart says nothing anywhere');
  assert.match(body, /noteFor\(btn\)/, 'the receipt does not use the shared lookup');
  assert.match(body, /closeRestartModal\(\)/, 'the dialog stays open after a successful restart');
  /* The order matters: the receipt is written BEFORE the close, because the
     close returns focus and a write after it would race that. */
  assert.ok(body.indexOf('noteFor(btn)') < body.indexOf('closeRestartModal()'),
    'the receipt is written after the dialog closes');
});


test('the consequence is named before the click, not after it', () => {
  /* Josh has twice read a restarted agent's empty memory as the product being
     broken. The sentence exists for that, and it belongs above the button. */
  const block = PAGE.slice(PAGE.indexOf('id="d-restart-agent"'), PAGE.indexOf('id="d-remove-agent"'));
  assert.ok(block.length > 0 && block.length < 4000, 'the two blocks are no longer adjacent');
  /* ⚠️ AND IT DOES NOT RESTATE THE VERB. "It stops and starts, so" is what the
     word restart already means, and a hint that spends its opening clause on
     the heading's own meaning buys nothing (Mona Lisa, #259). Asserted as an
     absence with the presence beside it, so a rewrite that drops the whole
     sentence fails rather than passing on the absence alone. */
  assert.ok(!/It stops and starts/.test(block),
    'the hint reopened with a restatement of what restart means');
  const hintAt = block.indexOf('comes back with nothing in its memory');
  const btnAt = block.indexOf('<button');
  assert.ok(hintAt > -1, 'the memory consequence is not stated');
  assert.ok(hintAt < btnAt, 'the consequence is stated after the button rather than before it');
  assert.match(block, /instructions and its files are untouched/,
    'the sentence names what is lost without naming what is kept');
  /* ⚠️ MEMORY ALONE READS AS CONTEXT. What a person actually loses is anything
     the agent agreed to and has not done, which they read as "the thing I
     asked it to do". The clause is general and claims nothing about whether
     there IS anything pending, which is the dialog's job; it exists so the
     hint and the dialog use one vocabulary (Mona Lisa, #259). */
  assert.match(block, /anything it was part way through ends/,
    'the hint names only memory, which reads as losing context rather than losing work');
});
