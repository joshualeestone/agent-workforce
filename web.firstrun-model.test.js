'use strict';

/**
 * The first-run model step shows one choosable model at full weight and the
 * rest behind a disclosure (#262).
 *
 * 🛑 THE STEP RENDERED 1003px AND ITS CONTINUE SAT BELOW THE FOLD at 950, 800
 * and 700. The overlay scrolls, so nothing was clipped and nothing was
 * unreachable; what a person met was a screen that looked complete with its
 * only way forward two to three hundred pixels under the edge.
 *
 * 🔑 THE FIX IS ABOUT WEIGHT AND THE OVERFLOW IS A CONSEQUENCE. The step asks
 * somebody to choose a model and there is exactly ONE choosable model. Five
 * rows nobody can select are a roadmap, and at full weight above an invisible
 * Continue they invert the priority: the thing you cannot do is visible and the
 * thing you must do is not.
 *
 * 📌 AND IT IS THE TREATMENT THE CREATE FORM ALREADY USES for the same five, so
 * a person now meets one list twice rather than two lists that look different.
 * Measured after the change: 616px, primary above the fold at all three
 * heights.
 *
 * Ruled by Mona Lisa, who measured the recovery before ruling it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const STEP = PAGE.slice(PAGE.indexOf('id="fr-pane-3"'), PAGE.indexOf('id="fr-sub"'));

test('the step is a real slice of the model pane', () => {
  /* The whole file would satisfy every assertion below, since the create form
     carries the same disclosure. Without this the tests are about the page
     rather than about this step. */
  assert.ok(STEP.length > 200 && STEP.length < 6000, 'the slice is ' + STEP.length + ' chars, so it is not this step');
  assert.match(STEP, /Your agents run on your own subscription/, 'the slice does not contain the model step');
  assert.ok(!STEP.includes('id="create-model"'), 'the slice ran past this step into the create form');
});

test('the one choosable model stays at full weight', () => {
  assert.match(STEP, /class="llm on"[\s\S]{0,200}<b>Claude<\/b>/,
    'the model a person can actually pick is no longer the prominent row');
  assert.match(STEP, /id="fr-llm-connect"/, 'the Connect button left the step');
});

test('the five that cannot be chosen are behind a closed disclosure', () => {
  assert.match(STEP, /<details class="smore">[\s\S]*?<summary>More models<\/summary>/,
    'the coming-soon models are not behind a disclosure');
  /* 🛑 NO `open` ATTRIBUTE. A disclosure that ships open recovers nothing and
     is the previous layout with a summary line added on top. */
  assert.ok(!/<details class="smore"\s+open/.test(STEP), 'the disclosure ships open');
  for (const name of ['Gemini', 'GPT', 'Llama', 'Qwen', 'Mistral']) {
    assert.ok(STEP.includes(name), name + ' vanished from the step rather than moving into the disclosure');
  }
  /* ⚠️ THE FAILURE DIRECTION THE ORIGINAL LAYOUT PROTECTED: understating the
     product on the screen where somebody is choosing. Shortening the list would
     have fixed the height and broken that, so every name must survive the move. */
  assert.ok(!/class="llm off"/.test(STEP),
    'a coming-soon row is still drawn at full weight beside the choosable one');
});

test('the disclosure uses the separator the rest of the product uses', () => {
  /* The pack specced these five lines with em dashes. The house never ships
     one, and the first-run provider list already used a middle dot, so the two
     surfaces match rather than merely both being legal. */
  const dis = STEP.slice(STEP.indexOf('<details class="smore">'));
  assert.ok(!/&mdash;|—/.test(dis), 'an em dash reached the disclosure');
  assert.match(dis, /&middot;/, 'the separator changed to something the sibling list does not use');
});
