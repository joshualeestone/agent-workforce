'use strict';

/**
 * "Nothing back yet" on the agent's own thread (#5).
 *
 * 🛑 THE ENGINE HAD THIS AND NO SCREEN COULD REACH IT. `messages.owesReply` was
 * implemented, exported and covered by twelve tests, and nothing called it: no
 * route, no payload field, no line. Fourth instance of that shape in a night.
 *
 * 🔑 IT IS THE MISSING HALF OF A SIGNAL THE ROOM ALREADY HAS. `pjSilentSince`
 * is gated on a project having two or more members, so a one-to-one thread had
 * no way to say an agent had gone quiet on you.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 10 * 60 * 1000).toISOString();

function line(owes, rows = []) {
  // eslint-disable-next-line no-new-func
  return new Function('OWES', 'ROWS',
    page.lift(SCRIPT, 'pjOldEnoughToJudge') + '\n'
    + 'const PJ_SILENCE_AFTER_MS = ' + (SCRIPT.match(/const PJ_SILENCE_AFTER_MS = ([^;]+);/)[1]) + ';\n'
    + page.lift(SCRIPT, 'dmOwesLine') + '\nreturn dmOwesLine(OWES, ROWS);')(owes, rows);
}

test('an agent that has gone quiet on you says so, after the grace period', () => {
  assert.match(line({ state: 'owes', lastHeardAt: OLD }), /Nothing back yet\./);
});

test('the grace period is the room’s, from the room’s constant', () => {
  /* ⚠️ SHARED, NOT COPIED. Two surfaces disagreeing about how long silence is
     normal shows a person two claims about one silence, and a copied number
     drifts the first time either is tuned. */
  assert.equal(line({ state: 'owes', lastHeardAt: NOW }), '',
    'a message sent seconds ago already accuses the agent of not answering');
  const decl = SCRIPT.match(/const PJ_SILENCE_AFTER_MS = ([^;]+);/);
  assert.ok(decl, 'the room constant is gone, so this line has its own number now');
  assert.ok(!/2 \* 60 \* 1000/.test(page.lift(SCRIPT, 'dmOwesLine')),
    'the grace period is written out again inside the line rather than shared');
});

test('an unreadable record says it cannot tell, and never that it answered', () => {
  /* 🛑 THE STATE THAT WAS ALREADY WRONG IN THE ENGINE: an unreadable log came
     back as "nothing is owed". Silence here would render "we could not look" as
     "it has answered". */
  const s = line({ state: 'unknown', because: 'we could not read it' });
  assert.match(s, /cannot tell whether it has answered/);
  assert.ok(!/Nothing back yet/.test(s), 'a could-not-look rendered as a verdict');
});

test('a clear agent, and a malformed answer, say nothing at all', () => {
  for (const owes of [{ state: 'clear', lastHeardAt: OLD }, null, undefined, {}, 'yes', { state: 'nonsense' }]) {
    assert.equal(line(owes), '', 'a line appeared for ' + JSON.stringify(owes));
  }
  /* CONTROL: something can produce a line, so the emptiness above is a
     decision rather than a function that returns nothing. */
  assert.notEqual(line({ state: 'owes', lastHeardAt: OLD }), '');
});

test('an unparseable timestamp is not treated as long ago', () => {
  /* The room's own rule: no timestamp is not "long ago". Falling the other way
     would accuse an agent on the strength of a broken field. */
  for (const at of ['not a date', '', null, 0]) {
    assert.equal(line({ state: 'owes', lastHeardAt: at }), '',
      'a bad timestamp of ' + JSON.stringify(at) + ' counted as old enough to judge');
  }
  /* And it falls back to the last row when the engine gave no timestamp, which
     is the case where the answer is knowable from what is on screen. */
  assert.match(line({ state: 'owes', lastHeardAt: null }, [{ at: OLD }]), /Nothing back yet/);
});

test('the route carries the answer, and reads it off the module rather than the local', () => {
  const srv = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  assert.match(srv, /const owes = messageLog\.owesReply\(name\);/,
    'the thread route no longer computes it, or reads it off the shadowed name');
  /* 🛑 `messages` IS SHADOWED IN THAT HANDLER by the local array being sent, so
     `messages.owesReply` there would be a property of an array. The alias is
     what makes the module reachable. */
  assert.match(srv, /const messageLog = messages;/, 'the module alias is gone');
  assert.match(srv, /^\s+owes,$/m, 'the payload no longer carries it');
  assert.match(SCRIPT, /dmOwesLine\(body\.owes, rows\)/, 'the thread box no longer draws it');
});
