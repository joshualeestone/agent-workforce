'use strict';

/**
 * Every place a person picks a picture looks like the same product.
 *
 * 🛑 TWO OF THE THREE SHIPPED THE BROWSER DEFAULT. The create form had a real
 * button over a hidden input; the agent's own page and Settings had bare
 * `<input type="file">`, which Chrome draws as an unstyled "Choose File / No
 * file chosen" in a product where every other control is drawn. Found by
 * looking at the rendered Settings screen rather than by reading the markup.
 *
 * 🔑 AND THE BUTTON IS NOT DECORATION. The comment on the create form records
 * why it is a real `<button>` rather than a `<label>` wrapping the input: a
 * hidden file input is out of the tab order and a label is not
 * keyboard-activatable, so the label-only version makes it the one control on
 * the form a keyboard cannot reach.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const PICKERS = [
  { input: 'create-avatar', button: 'create-avatar-btn' },
  { input: 'd-file', button: 'd-file-btn' },
  { input: 'you-file', button: 'you-file-btn' },
];

test('every file input is hidden and driven by a real button', () => {
  const inputs = PAGE.match(/<input[^>]*type="file"[^>]*>/g) || [];
  assert.equal(inputs.length, PICKERS.length,
    'a file input appeared or vanished; there are ' + inputs.length + ' and this test knows ' + PICKERS.length);
  for (const raw of inputs) {
    assert.match(raw, /\bhidden\b/,
      'a file input renders as the browser default: ' + raw);
  }
  for (const p of PICKERS) {
    assert.ok(PAGE.includes('id="' + p.input + '"'), p.input + ' is gone');
    /* A BUTTON, not a label. Asserted by tag, because a label around the input
       would satisfy "there is something to click" and fail the keyboard. */
    const re = new RegExp('<button[^>]*id="' + p.button + '"');
    assert.match(PAGE, re, p.button + ' is not a real button');
  }
});

test('each button forwards the click to its own input', () => {
  /* ⚠️ ITS OWN. A copied forwarder pointing at the create input would leave two
     screens opening a picker whose file lands nowhere, and every visual check
     would pass because the dialog opens. */
  for (const p of PICKERS) {
    const re = new RegExp("getElementById\\('" + p.button + "'\\)\\.addEventListener\\('click'[\\s\\S]{0,120}getElementById\\('" + p.input + "'\\)\\.click\\(\\)");
    assert.match(SCRIPT, re, p.button + ' does not forward to ' + p.input);
  }
});

test('hiding the input did not orphan the handler that reads the file', () => {
  /* `.click()` on a file input fires `change` exactly as a direct click does,
     so the readers must still be listening on the INPUT rather than on the
     button, or the picture is chosen and never read. */
  for (const p of PICKERS) {
    const re = new RegExp("getElementById\\('" + p.input + "'\\)\\.addEventListener\\('change'");
    assert.match(SCRIPT, re, p.input + ' has no change handler, so a chosen file goes nowhere');
  }
});

/**
 * No two controls on one surface answer to the same name.
 *
 * 🛑 THE AGENT PANEL HAD TWO BUTTONS BOTH SAYING "Save", one for the
 * instructions and one for the name and role. Neither was MISSING a name;
 * the name did not IDENTIFY, and a check asking only whether a name exists
 * passes on both. Found by a browser sweep
 * (`docs/browser-checks/named-controls.js`), which is where the real version
 * of this lives because only a render knows which controls are on screen
 * together.
 *
 * 🔑 THIS IS THE CHEAP HALF, pinned here so a regression fails in `yarn test`
 * rather than waiting for somebody to run a browser. It cannot know what is
 * visible, so it asserts the two specific labels rather than the property.
 */
test('the two Save buttons on the agent panel say which they are', () => {
  for (const [id, name] of [['d-instr-save', 'Save instructions'], ['d-save', 'Save name and role']]) {
    const re = new RegExp('id="' + id + '"[^>]*aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*id="' + id + '"');
    const m = PAGE.match(re);
    assert.ok(m, id + ' has no accessible name, so it announces as the same word as its sibling');
    const label = m[1] || m[2];
    assert.equal(label, name, id + ' is named ' + label);
    /* ⚠️ SC 2.5.3: the visible word survives verbatim inside it, or somebody
       driving by voice says what they can see and nothing happens. */
    assert.ok(label.includes('Save'), id + ' rewords the visible label: ' + label);
  }
  /* CONTROL: both buttons really do still show the same visible word, which is
     the condition that makes the labels necessary. If one is ever renamed this
     test should be revisited rather than silently kept. */
  assert.equal((PAGE.match(/>Save</g) || []).length, 2,
    'the number of buttons visibly reading Save changed, so this pairing needs re-checking');
});
