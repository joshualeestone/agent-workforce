'use strict';

/**
 * An agent past its ceiling does not print a number we know is wrong (#260).
 *
 * 🛑 THE ENGINE CAPS THE FIGURE. `status.js` returns
 * `percent: Math.min(100, percent)` and sets `overCeiling` when the true one
 * was higher. The page read `percent` and printed it, so an agent at 130% of
 * its ceiling drew `100%`, which is the one number we positively know to be
 * false. `overCeiling` was sent and never read.
 *
 * 🔑 A WORD, NOT THE TRUE NUMBER. The slot already renders `Unknown` when there
 * is no percentage to give, so `Full` is a third value in a pattern that
 * exists. Printing 130 would be honest and useless: the ring cannot draw past
 * its own end and the decision is identical at 100 and at 130.
 *
 * ⚠️ AND IT IS TRUE UNDER BOTH READINGS OF `overCeiling`. Against a watched
 * limit the agent is really past one; against an assumed limit the likelier
 * truth is that our assumption is wrong. `Full` holds either way. A figure
 * would be a claim about which one we are in.
 *
 * Ruled by Mona Lisa; found by the field sweep in server.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function print(ctx, pct) {
  // eslint-disable-next-line no-new-func
  return new Function('CTX', 'PCT',
    page.lift(SCRIPT, 'memUnknown') + '\n' + page.lift(SCRIPT, 'memPrint')
    + '\nreturn memPrint(CTX, PCT);')(ctx, pct);
}

test('an agent past its ceiling says Full, not the capped number', () => {
  assert.equal(print({ percent: 100, overCeiling: true }, 100), 'Full');
  /* Whether the ceiling was watched or assumed, because the word is true under
     both and a number would be a claim about which. */
  assert.equal(print({ percent: 100, overCeiling: true, ceilingAssumed: true }, 100), 'Full');
  assert.equal(print({ percent: 100, overCeiling: true, ceilingAssumed: false }, 100), 'Full');
});

test('an agent exactly at its ceiling still says 100%', () => {
  /* 🔑 THE CONTROL THAT MAKES THE TEST ABOVE MEAN ANYTHING. If `Full` were
     returned for every full agent the assertions above would pass while the
     flag did nothing, and the two states would be conflated in the other
     direction. */
  assert.equal(print({ percent: 100, overCeiling: false }, 100), '100%');
  assert.equal(print({ percent: 43, overCeiling: false }, 43), '43%');
});

test('an unreadable memory still says its own word, not Full', () => {
  const word = print({ notYet: true }, null);
  assert.ok(word && word !== 'Full', 'an unread memory was reported as full: ' + word);
  assert.ok(!/%/.test(word), 'an unread memory printed a percentage: ' + word);
});

test('a missing or malformed context never invents Full', () => {
  /* The failure direction: `Full` is a claim about an agent being out of room,
     and a context we do not understand is not evidence for it. */
  for (const ctx of [null, undefined, {}, { overCeiling: 'yes' }]) {
    assert.equal(print(ctx, 62), '62%', 'a context of ' + JSON.stringify(ctx) + ' invented a state');
  }
});

test('all three surfaces that print the figure go through one reading', () => {
  /* 🛑 THE REASON THIS CHANGE IS A HELPER RATHER THAN THREE EDITS. The board
     card, the list row and the detail badge all print this fact, and the
     comment beside the detail badge records the last time one of them was left
     behind: "three surfaces, one fact, and the third left on the old
     treatment". A fourth surface that prints `pct + '%'` directly fails here. */
  const printers = SCRIPT.match(/memPrint\(a\.context, \w+\)/g) || [];
  assert.equal(printers.length, 4,
    'the memory figure is printed on ' + printers.length + ' surfaces through memPrint, and there are four');
  /* ⚠️ THE RAW SEARCH IS ANCHORED ON THE PRINTING CONTEXT, not on `pct` alone.
     A bar's `width:${pct}%` legitimately keeps the capped number, because a bar
     cannot draw past its own end; that is the reason the printed figure became
     a word rather than an argument against it. The class `.pct` is what marks
     a figure a person READS, and the first version of this check found the
     download progress bar in first run, which has nothing to do with memory. */
  const printed = SCRIPT.match(/class="pct"[^<]*<[^>]*>[^<]*(?:\$\{)?d?pct/g) || [];
  assert.deepEqual(printed, [],
    'a surface still prints the capped percentage into a .pct slot: ' + printed.join(' | '));
});
