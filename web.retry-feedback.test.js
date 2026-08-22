'use strict';

/**
 * Try again has to look like it did something, even when the answer is the same.
 *
 * 🛑 JOSH, 2026-08-22, on a board that could not read tmux: "Hitting Try Again
 * does nothing. It doesn't even feel like the button is submitting when I push
 * Try Again". It ran every time. The answer was the same, so the box repainted
 * identically and the press left no trace at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = require('./test-support/page').scriptOf(PAGE);

/* The handler is a delegated listener rather than a named function, so it is
   driven the way the page drives it: the block is lifted by its own anchor and
   run with a fake event. Anchored on `data-board-retry`, which is the contract
   between the markup and the handler and cannot drift without both moving. */
function handler(tickImpl) {
  const at = SCRIPT.indexOf("const retry = e.target.closest('[data-board-retry]');");
  assert.ok(at > -1, 'the retry handler is gone or has been renamed');
  const end = SCRIPT.indexOf('\n  }', SCRIPT.indexOf('Promise.resolve(tick())', at)) + 4;
  // eslint-disable-next-line no-new-func
  return new Function('tick', 'return (e) => {\n' + SCRIPT.slice(at, end) + '\n};')(tickImpl);
}

function button() {
  return { disabled: false, textContent: 'Try again' };
}
function ev(btn) {
  return { target: { closest: (sel) => (sel === '[data-board-retry]' ? btn : null) } };
}

test('pressing it says what it is doing while it is doing it', async () => {
  const btn = button();
  let release;
  const fn = handler(() => new Promise((r) => { release = r; }));
  fn(ev(btn));
  assert.equal(btn.disabled, true, 'the button can be pressed again mid-look');
  assert.equal(btn.textContent, 'Looking…', 'nothing about the button changed, so the press left no trace');
  release();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(btn.textContent, 'Try again');
  assert.equal(btn.disabled, false, 'the button is left permanently disabled');
});

test('a look that fails restores it too', async () => {
  /* ⚠️ THE FAILURE DIRECTION, and it is the one that matters here: this button
     exists because something is already wrong, so the path where the retry also
     fails is the ordinary path rather than the edge. A permanently disabled
     button would be worse than the inert one it replaces. */
  const btn = button();
  const fn = handler(() => Promise.reject(new Error('still down')));
  fn(ev(btn));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Try again');
});

test('a second press while one is in flight is ignored', async () => {
  let calls = 0;
  const btn = button();
  const fn = handler(() => { calls += 1; return new Promise(() => {}); });
  fn(ev(btn));
  fn(ev(btn));
  assert.equal(calls, 1, 'a held button queued a second look');
});

test('a tick that returns nothing at all still restores the button', async () => {
  /* `tick` is not declared async everywhere it could be edited to; a handler
     that only works on a promise would leave the button dead the day it is not
     one. Promise.resolve is what makes that a non-event, and this is the test
     that would notice it being taken out. */
  const btn = button();
  const fn = handler(() => undefined);
  fn(ev(btn));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Try again');
});
