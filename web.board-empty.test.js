'use strict';

/**
 * The agents board with no cards in it, which is THREE answers (#board-empty).
 *
 * 🛑 IT RENDERED AN EMPTY STRING FOR ALL OF THEM. A person who had just
 * finished the install could be looking at a New agent tile, four zeroes, and
 * then nothing at all. The rule that forbids it is stated in the build itself,
 * at the declaration of `BOARD_SEEN`: [] before the first answer means "not
 * heard yet", not "empty board", and the two must never be conflated. The org
 * view honours it and the Recommended pill honours it; the grid and the list
 * did not.
 *
 * 🔑 THE THIRD STATE IS THE ONE THAT MATTERS AND THE ONE THAT NEVER APPEARS
 * WHILE BUILDING, because the machine you build on answers. Every assertion
 * about it below is therefore worth more than the two comfortable ones.
 *
 * Found by Mona Lisa, agents-page package 2026-08-22.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* Boundary-anchored, for the reason server.test.js records: a sibling whose
   name merely starts with the wanted one silently captures the extractor. */
function lift(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  return SCRIPT.slice(at, end);
}

/* The real function, run against the two globals it reads. Nothing is
   restated here: a copy of the copy would go stale the day somebody edits the
   page, which is exactly the failure this file is about. */
function boardEmpty(state) {
  /* `esc` is lifted rather than stubbed: the failure box puts the raw reason
     on screen, and a stub would let an escaping bug through the one branch
     that renders a value this code did not write. */
  // eslint-disable-next-line no-new-func
  return new Function('BOARD_SEEN', 'BOARD_LOOK_FAILED',
    lift('esc') + '\n' + lift('boardEmpty') + '\nreturn boardEmpty();')(state.seen, state.failed);
}

const LOOKING = { seen: false, failed: null };
const NONE = { seen: true, failed: null };
const CANNOT = { seen: true, failed: 'tmux is not answering' };

test('before the first answer it says it is looking, and offers nothing to press', () => {
  const html = boardEmpty(LOOKING);
  assert.match(html, /Looking for your agents/);
  /* No button, and the reason is not tidiness: there is nothing to decide yet,
     and a control here invites a click that races the answer it is waiting on. */
  assert.ok(!/<button/.test(html), 'the looking state grew a button to race the answer');
  assert.ok(!/No agents yet/.test(html), 'a look that has not happened claimed the board is empty');
});

test('a look that ANSWERED with nothing says so, and offers the one action', () => {
  const html = boardEmpty(NONE);
  assert.match(html, /No agents yet\./);
  assert.match(html, /An agent is a worker you put on a job/,
    'the screen where somebody meets the word does not define it');
  assert.match(html, /data-board-new/, 'the empty board offers no way off it');
  /* 🔑 THE BUILD'S NAME FOR THE PACK'S GOLD PRIMARY, which is `.btn.uprime.big`
     and not `.btn-gold`: the latter has no rule in this app, so shipping it
     renders a plain button while the markup claims a gold one. Asserted with
     the CSS beside it, because the class name alone is only a claim. */
  assert.match(html, /class="btn uprime big"/, 'the one action lost its gold primary');
  assert.match(PAGE, /\.btn\.uprime\.big\s*{[^}]*font-size:\s*1\.0625rem/,
    'the class the button asks for has no rule, so it renders plain');
  assert.ok(!/Looking for your agents/.test(html));
});

test('a look that FAILED refuses to call the board empty', () => {
  const html = boardEmpty(CANNOT);
  assert.match(html, /We cannot read your agents right now/);
  assert.match(html, /not the same as having none/,
    'the distinction this box exists for is not stated in it');
  /* 🛑 THE ASSERTION THIS FILE IS FOR. Everything else here is copy; this is
     the claim. A failed look must not render as an answered one. */
  assert.ok(!/No agents yet/.test(html), 'a failed look rendered as an empty board');
  assert.ok(!/An agent is a worker/.test(html), 'a failed look offered the onboarding copy');
  assert.match(html, /data-board-retry/, 'the failure offers no way to ask again');
  assert.match(html, /tmux is not answering/, 'the box does not say what did not answer');
  /* The reason is a value this code did not write, so it is escaped. A raw
     one would be the only unescaped path on the board. */
  const evil = boardEmpty({ seen: true, failed: '<img src=x onerror=1>' });
  assert.ok(!/<img/.test(evil), 'the failure reason reaches the page unescaped');
});

test('both empty states weight their one action the same', () => {
  /* Two screens with the same shape doing the same job taught two mental
     models when one used a plain button and the other gold. */
  /* ⚠️ ANCHORED ON THE BUTTON'S OWN ID, not on a character window after the
     heading. The first version sliced 400 characters from "No projects yet"
     and failed because a comment sat between the two, which reads exactly like
     the class being wrong. A window is a guess about layout; the id is the
     thing. */
  const at = SCRIPT.indexOf("id=\"pj-new-empty\"");
  assert.ok(at > -1, 'the projects empty-state button lost its id, so this test found nothing');
  const line = SCRIPT.slice(SCRIPT.lastIndexOf('<button', at), at + 40);
  assert.match(line, /class="btn uprime big"/,
    'the projects empty state weights its action differently from the agents one: ' + line);
});

test('the three states are three different screens, not one with wording swapped', () => {
  /* POSITIVE CONTROL for the whole file: if the function ignored its inputs
     every assertion above would still pass on whichever single string it
     returned. Three distinct outputs is the property. */
  const all = [boardEmpty(LOOKING), boardEmpty(NONE), boardEmpty(CANNOT)];
  assert.equal(new Set(all).size, 3, 'two of the three states render identically');
});

test('failure outranks having-looked, because both are true at once', () => {
  /* ⚠️ `BOARD_LOOK_FAILED` is only ever set after `BOARD_SEEN` has been true,
     so the failing state ALWAYS arrives with seen=true. An order that tested
     seen first would render "No agents yet" over a look that failed, which is
     the defect with extra steps. */
  assert.match(boardEmpty({ seen: true, failed: 'down' }), /We cannot read your agents/);
  assert.match(boardEmpty({ seen: false, failed: 'down' }), /We cannot read your agents/,
    'a failure before the first success rendered as looking');
});

test('the failure box is solid, and the two comfortable ones are not', () => {
  /* A dashed border is the shape of a slot waiting to be filled. "We could not
     read this" is not an empty slot, it is an unanswered question. The rule
     lives in CSS, so it is read from the page rather than from the markup. */
  assert.match(PAGE, /\.pj-empty\s*{[^}]*border:\s*[^;]*dashed/,
    'the empty-state box is no longer dashed, so the failure box no longer differs');
  assert.match(PAGE, /\.pj-empty\.boardfail\s*{[^}]*border-style:\s*solid/,
    'the failure box is drawn as a slot waiting to be filled');
  assert.match(boardEmpty(CANNOT), /class="pj-empty boardfail"/);
  assert.ok(!/boardfail/.test(boardEmpty(NONE)), 'the empty board is drawn as a failure');
});

test('both layouts paint the empty board, not just the one that happens to be open', () => {
  /* The grid and the list are the same agents through the same derivations on
     the same tick. A version of this that fixed only `#grid` would leave the
     list view rendering nothing, and which view is resting is a preference the
     person set days ago. */
  assert.match(SCRIPT, /getElementById\('grid'\)\.innerHTML = shown\.length \? shown\.map\(card\)\.join\(''\) : boardEmpty\(\)/);
  assert.match(SCRIPT, /getElementById\('alist'\)\.innerHTML = shown\.length \? shown\.map\(lrow\)\.join\(''\) : boardEmpty\(\)/);
});
