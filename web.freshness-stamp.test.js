'use strict';

/**
 * How long ago the board was read, in words (#292, Mona Lisa).
 *
 * 🛑 IT PRINTED RAW SECONDS AT ANY SIZE. A slept machine read "Refreshed 41283
 * seconds ago": the stamp whose entire job is making a frozen board legible,
 * being least legible exactly when the board is frozen. Nobody converts five
 * figures of seconds in their head, and the number looks like precision and
 * reads as noise.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);
const say = new Function(`${page.lift(SCRIPT, 'freshWords')}\nreturn freshWords;`)();

test('a slept machine reads in hours, not in five figures of seconds', () => {
  assert.equal(say(41283), 'Refreshed 11 hours ago');
  assert.equal(say(129600), 'Refreshed 1 day ago');
  assert.equal(say(172800), 'Refreshed 2 days ago');
});

test('the ladder never rounds up', () => {
  /* ⚠️ ROUNDING UP AT A BOUNDARY WOULD LET THE WORDS AND THE CLASS DISAGREE ON
     THE SAME PAINT: the `stale` treatment fires above 30 seconds, and a stamp
     reading "1 minute ago" while the element is not stale is two answers to one
     question. Down at every step. */
  assert.equal(say(89), 'Refreshed 89 seconds ago');
  assert.equal(say(119), 'Refreshed 1 minute ago');
  assert.equal(say(5399), 'Refreshed 89 minutes ago');
  assert.equal(say(86399), 'Refreshed 23 hours ago');
});

test('singulars are singular', () => {
  /* "1 minutes ago" is the seam this file keeps being caught on. */
  assert.equal(say(90), 'Refreshed 1 minute ago');
  assert.equal(say(5400), 'Refreshed 1 hour ago');
  assert.equal(say(129600), 'Refreshed 1 day ago');
  for (const n of [120, 7200, 172800]) assert.ok(/s ago$/.test(say(n)), `${n} lost its plural`);
});

test('a reading from the future is just now, not a minus sign', () => {
  /* ⚠️ THE TWO CLOCKS IN THAT SUBTRACTION are the browser's and the server's
     stamp on a response that has crossed a network and, after a sleep, possibly
     a clock correction. A slightly-negative age is a measurement artefact, and
     "-4 seconds ago" reads as a bug in the product rather than as a rounding. */
  for (const n of [-1, -4000]) assert.equal(say(n), 'Refreshed just now');
});

test('an age we cannot read says the part that is true and stops', () => {
  /* ⚠️ NOT "just now", which would be a claim about a time we do not have. The
     poll succeeded, so "Refreshed" holds; only the number is missing. */
  for (const bad of [NaN, undefined, null, 'soon', {}]) {
    assert.equal(say(bad), 'Refreshed', `${JSON.stringify(bad)} produced a time`);
  }
});

test('the floor is unchanged, because a ticking single digit is furniture', () => {
  assert.equal(say(0), 'Refreshed just now');
  assert.equal(say(4), 'Refreshed just now');
  assert.equal(say(5), 'Refreshed 5 seconds ago');
});

test('the stamp is painted through it, not around it', () => {
  /* 🛑 A HELPER NOTHING CALLS IS THE DEFECT THIS SUITE KEEPS FINDING: complete,
     tested, and unreachable from the screen. */
  assert.match(SCRIPT, /checked\.innerHTML = '<span>Agent status<\/span><b>' \+ freshWords\(age\) \+ '<\/b>'/);
  assert.ok(!/'Refreshed ' \+ age \+ ' seconds ago'/.test(SCRIPT),
    'the raw-seconds string is still in the page, so something still prints it');
});
