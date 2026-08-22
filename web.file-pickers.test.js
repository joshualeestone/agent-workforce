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
