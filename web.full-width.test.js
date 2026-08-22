'use strict';

/**
 * The rules that make the app use the window, and the three traps in them.
 *
 * ⚠️ THE REAL GATE IS `docs/browser-checks/render-full-width.js`, which renders
 * at 1760px and asserts one row lines up with another. This file pins only the
 * declarations whose ABSENCE is silent: each of the three below was written,
 * looked right, and did the wrong thing, and none of them is visible at or
 * below the old cap, which is where every other render check runs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('the header centres against the page, on the rule that wins', () => {
  /* 🛑 `.apphead header` OVERRIDES THE BASE RULE and every header in the app is
     inside `.apphead`, so a fix applied only to `header` is inert. The spec
     this was built from described a flex row; the shipped rule was already a
     grid, and `auto 1fr auto` centres the tabs in the LEFTOVER space, whose
     centre is not the centre of the page. Same arithmetic, different rule. */
  assert.match(PAGE, /\.apphead header \{ display: grid; grid-template-columns: 1fr auto 1fr;/);
  /* The base rule matches so the two cannot disagree if a header ever renders
     outside the sticky bar. */
  assert.match(PAGE, /^header \{ display: grid; grid-template-columns: 1fr auto 1fr;/m);
  /* And it is the same rule the row below already used, which is the whole
     argument: two rows centred by two different rules agree by accident. */
  assert.match(PAGE, /\.statsrow \{ display: grid; grid-template-columns: 1fr auto 1fr;/);
});

test('uncapping a panel needs `none`, because something underneath re-caps it', () => {
  /* 🛑 REMOVING THE 1320px CAP MADE THESE SCREENS NARROWER. `.panel` carries
     `max-width: 720px` for the reading-tier panels, and with the override gone
     that won: settings rendered as a 720px column centred in a 1760px window.
     A sweep that greps for the number cannot see a cap that is not spelled
     that way. */
  assert.match(PAGE, /#panel-settings, #panel-projects \{ max-width: none;/);
  assert.match(PAGE, /\.panel \{ max-width: 720px;/, 'the rule that re-caps them has moved');
});

test('the settings grid gains a column rather than widening its boxes', () => {
  /* 🛑 IT WAS A FIXED PAIR, so uncapping alone doubled the column width instead
     of adding a third: two 850px boxes at 1760. The one rule in the sweep where
     removing the cap by itself gives the wrong answer. */
  assert.match(PAGE, /\.dgrid \{ display: grid; gap: 18px;\s*\n\s*grid-template-columns: repeat\(auto-fill, minmax\(min\(28rem, 100%\), 1fr\)\); \}/);
});

test('the create form keeps a measure and no longer fakes a centred column', () => {
  /* 🛑 THE TRAP THAT GOES SILENTLY WRONG. It re-derived the cap by hand in a
     margin to pull itself into the centred column; with the cap gone that
     expression evaluates to 0px and the rule stays in the file doing nothing.
     A search for `max-width` does not find it. */
  assert.ok(!/calc\(\(100% - 1320px\) \/ 2\)/.test(PAGE),
    'the hand-rolled cap is still there, and it is now a no-op nobody will notice');
  assert.match(PAGE, /#panel-create \{ max-width: 34rem;/, 'the form lost its reading measure');
});

test('no capped rule was left behind', () => {
  /* The sweep was fifteen declarations. What remains are two mentions inside
     comments that describe the old state, which is what a record is for. */
  /* ⚠️ KEYED ON THE DECLARATION, not on the number. The first version of this
     asked whether each line MENTIONING 1320px looked like a comment, which is a
     shape test on prose: it failed on continuation lines of a block comment and
     would have passed on a rule somebody wrote in an unusual style. What must
     not exist is the declaration; the number surviving in a record of why it
     went is the point of the record. */
  assert.ok(!/max-width:\s*1320px/.test(PAGE),
    'a rule still declares the old cap');
  assert.match(PAGE, /1320px/, 'the record of why it went is gone too');
});
