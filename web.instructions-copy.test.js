'use strict';

/**
 * The two sentences on the instructions box that have each been wrong once.
 *
 * 🛑 BOTH SHIPPED UNGUARDED. Reverting either passed the whole suite: 1291
 * tests, and the two lines a person reads about what their instructions ARE
 * had nothing watching them. Found by mutating them after the fix rather than
 * before, which is the only order that shows an absent guard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

test('the lede states the consequence, not that the file is stable (#198)', () => {
  /* 🔑 TWO CLAIMS THAT LOOK LIKE ONE. "A restart does not change what it says"
     is about the FILE being stable, which is true and uninteresting: of course
     restarting does not rewrite your file. "The only thing that survives a
     restart" is about CONSEQUENCE, and it is the half that tells somebody why
     anything belongs in the field. */
  const painter = page.lift(SCRIPT, 'openDetail');
  assert.match(painter, /the only thing that survives a restart/,
    'the lede no longer says what survives, which is the reason to put anything in that field');
  assert.ok(!/a restart does not change what it says/.test(PAGE),
    'the file-stability wording came back');
  /* ⚠️ AND IT MUST AGREE WITH THE TALK BOX ON THE SAME PAGE, which is the split
     this fixed: that box says anything that needs to last belongs in their
     instructions, which points at survival and not at stability. Two boxes on
     one screen making different claims about one fact is the whole card. */
  assert.match(PAGE, /needs to last belongs in their instructions/,
    'the talk box lost the sentence the lede was made to agree with');
});

test('the lede names the agent, and does not render a hole when it cannot', () => {
  const painter = page.lift(SCRIPT, 'openDetail');
  assert.match(painter, /'What ' \+ who \+ ' is for'/, 'the lede stopped naming the agent');
  /* A missing name is a state this panel can be in for a tick. "What  is for"
     reads as broken; the generic reads as generic. */
  assert.match(painter, /'What this agent is for'/, 'there is no fallback, so a nameless tick renders a gap');
});

test('the path line is gone from the instructions box (#198)', () => {
  assert.ok(!/A real file you can also edit by hand/.test(PAGE),
    'the path sentence came back');
  /* ⚠️ THE ELEMENT STAYS. Three call sites hide it and one shows it, so
     removing it would be a change to the panel's wiring rather than to its
     copy, and the card was about the copy. */
  assert.match(PAGE, /id="d-instr-foot"/, 'the element went with the sentence, which is a wiring change');
});

test('the stale sentence names the edits rather than pointing at nothing (#212)', () => {
  const stale = page.lift(SCRIPT, 'renderStale');
  /* 🛑 "RESTARTING THE AGENT IS WHAT APPLIES THEM" had no antecedent. The
     nearest plural noun in that block is "older instructions", and applying
     THOSE is the opposite of what a restart does. */
  assert.ok(!/applies them/.test(stale), 'the pronoun with the wrong antecedent came back');
  assert.match(stale, /A restart is what picks up the edits/,
    'the sentence no longer names what a restart picks up');
  /* ⚠️ IT HAS TO STAND ALONE. The clause before it is conditional and drops out
     whenever either timestamp is missing, so a sentence relying on it to supply
     the noun fails exactly when we know least. */
  assert.match(stale, /edited && started[\s\S]{0,24}\?/,
    'the dates stopped being conditional, so the stand-alone concern is stale');
  assert.match(stale, /Running on older instructions/, 'the heading the sentence stands under is gone');
});
