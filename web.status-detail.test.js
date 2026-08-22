'use strict';

/**
 * A failed status call says what the server said, not just its number.
 *
 * 🛑 THE BODY WAS NEVER READ. `tick` threw `status 500` and the cannot-read box
 * printed exactly that, while the response carried a sentence and, since this
 * change, tmux's own words for what went wrong. Josh spent a morning on a
 * machine that was telling us the answer into a discarded body.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = require('./test-support/page').scriptOf(PAGE);

/* The arm is inside `tick`, which is far too entangled to lift whole. It is
   extracted by its own anchor: the fetch and the guard that follows it, which
   are the two lines this behaviour IS. */
function armFor(res) {
  const at = SCRIPT.indexOf("    if (!res.ok) {\n      const said = await res.json().catch(() => null);");
  assert.ok(at > -1, 'the failed-status arm is gone or has been rewritten');
  const end = SCRIPT.indexOf("\n    }", SCRIPT.indexOf("throw new Error(parts.join", at)) + 6;
  // eslint-disable-next-line no-new-func
  const fn = new Function('res', 'return (async () => {\n' + SCRIPT.slice(at, end) + '\nreturn null; })();');
  return fn(res);
}

function reply(status, body) {
  return { ok: false, status, json: async () => { if (body === 'unparseable') throw new Error('bad'); return body; } };
}

test('the server sentence and the machine words both reach the screen', async () => {
  const err = await armFor(reply(500, {
    error: 'we could not see what is running on this computer',
    detail: 'no server running on /private/tmp/tmux-501/default',
  })).then(() => null, (e) => e);
  assert.ok(err, 'a failed status no longer throws, so nothing paints the failure');
  assert.match(err.message, /we could not see what is running/);
  assert.match(err.message, /no server running/);
  /* ⚠️ AND THE NUMBER SURVIVES, at the end. It is the one part that is true even
     when the body is missing or is not ours, and it is what somebody pastes
     into a message to us. */
  assert.match(err.message, /status 500$/);
});

test('a body with no detail says what it has', async () => {
  const err = await armFor(reply(500, { error: 'we could not see what is running on this computer' }))
    .then(() => null, (e) => e);
  assert.match(err.message, /we could not see what is running on this computer · status 500/);
});

test('a body that is not ours, or not JSON at all, still reports the number', async () => {
  /* ⚠️ THE FAILURE DIRECTION. This runs when something is already wrong, so the
     path where the error response is itself broken is ordinary rather than
     exotic: a proxy's HTML error page, a truncated body, a 502 from nothing we
     wrote. Throwing while building the message would replace a bad board with a
     blank one. */
  for (const bad of ['unparseable', null, {}, { error: null }, 'a string']) {
    const err = await armFor(reply(502, bad)).then(() => null, (e) => e);
    assert.ok(err, `a ${JSON.stringify(bad)} body stopped the failure being reported`);
    assert.match(err.message, /status 502/);
  }
});

test('no em dash reaches the screen', () => {
  /* House style, and it is a sentence a person reads. The parts are joined with
     the same middle dot the version line uses. */
  const at = SCRIPT.indexOf("throw new Error(parts.join");
  assert.ok(at > -1);
  assert.ok(!/—/.test(SCRIPT.slice(at, at + 60)), 'the joiner is an em dash');
});
