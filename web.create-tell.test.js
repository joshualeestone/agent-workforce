'use strict';

/**
 * The create page's "let Kosmos know" box tells the truth about the second
 * gate (#258).
 *
 * 🛑 IT SHIPPED `checked` IN THE MARKUP, UNCONDITIONALLY. Sending is two gates,
 * both of which must be true: this box for one agent, and the standing answer
 * in Settings. So a person who had turned it off in Settings opened the create
 * form, saw a ticked box, made an agent, and nothing was sent. The screen was
 * showing consent to something the engine was about to refuse.
 *
 * 🔑 THE FORM ALREADY REFUSES THIS SHAPE THREE FIELDS UP, where Reports to is
 * hidden rather than offering a choice nobody can make. The difference is that
 * reports-to is IMPOSSIBLE and this is ALREADY ANSWERED, so the row stays and
 * says which: a row that vanishes teaches nothing, and the person who turned it
 * off is exactly the one who benefits from seeing that it took.
 *
 * Found by Mona Lisa, create-flow package 2026-08-22.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

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

/* The real painter against stub elements, so what is asserted is what the
   function writes rather than a restatement of it. */
function paint(answer) {
  const els = {
    'create-tell': { disabled: null, checked: null },
    'create-tell-note': { textContent: null },
  };
  // eslint-disable-next-line no-new-func
  new Function('document', lift('createTellPaint') + '\ncreateTellPaint(ANSWER);'
    .replace('ANSWER', JSON.stringify(answer)))({ getElementById: (id) => els[id] });
  return { box: els['create-tell'], note: els['create-tell-note'].textContent };
}

test('the box is not checked in the markup, because nothing has been read yet', () => {
  /* 🔑 THE DEFECT ITSELF, pinned in the static markup rather than through the
     painter. The painter could be perfect and this attribute would still show
     a tick for the whole first frame, before any read has happened, on the
     screen where the claim is made. */
  const row = PAGE.slice(PAGE.indexOf('id="create-tell-wrap"'), PAGE.indexOf('id="create-reports-wrap"'));
  assert.ok(row.includes('id="create-tell"'), 'the row moved, so this test is reading the wrong markup');
  assert.ok(!/id="create-tell"[^>]*\schecked/.test(row),
    'the box is hard-coded checked again, which claims consent before anything has been read');
});

test('the standing answer being ON leaves the box checked and usable', () => {
  const { box, note } = paint({ on: true, ok: true });
  assert.equal(box.checked, true);
  assert.equal(box.disabled, false);
  assert.equal(note, '', 'a note appeared on the state that needs no explanation');
});

test('the standing answer being OFF disables the box and says where it was answered', () => {
  const { box, note } = paint({ on: false, ok: true });
  assert.equal(box.checked, false, 'the box claimed consent the engine will refuse');
  assert.equal(box.disabled, true, 'the box invites a click that changes nothing');
  assert.match(note, /Turned off in Settings/,
    'the row is dead and does not say why, which is worse than hiding it');
});

test('a setting we could NOT read is not treated as on', () => {
  /* ⚠️ THE THIRD STATE, and the reason it goes with OFF rather than ON: the
     engine refuses on `!pref.on`, and an unread preference is not on. The
     setting's own painter states the same rule at its own declaration, so a
     version of this that guessed "probably on" would contradict the screen
     the person would go to check. */
  for (const answer of [null, undefined, { ok: false }, {}]) {
    const { box, note } = paint(answer === undefined ? null : answer);
    assert.equal(box.checked, false, 'an unread setting rendered as consent: ' + JSON.stringify(answer));
    assert.equal(box.disabled, true, 'an unread setting offered a box to tick');
    assert.ok(note.length > 0, 'an unread setting explained nothing');
  }
  assert.match(paint(null).note, /could not read/,
    'the unread state borrowed the turned-off sentence, which is a different fact');
});

test('the three states say three different things', () => {
  /* POSITIVE CONTROL: a painter that ignored its argument would satisfy every
     assertion above on whichever single answer it produced. */
  const notes = [paint({ on: true, ok: true }).note, paint({ on: false, ok: true }).note, paint(null).note];
  assert.equal(new Set(notes).size, 3, 'two of the three states read identically: ' + JSON.stringify(notes));
});

test('the form reads the setting every time it opens, not once on boot', () => {
  /* The standing answer can be changed in Settings between two visits to this
     form, and a value learned at boot would be stale for the rest of the
     session on the one screen where it is acted on. */
  assert.match(lift('openCreate'), /refreshCreateTell\(\)/,
    'opening the create form no longer re-reads the setting');
  assert.match(lift('refreshCreateTell'), /createTellPaint\(null\)/,
    'the read no longer starts from unread, so a slow fetch shows a stale claim');
});

test('nothing on the create page writes the standing setting', () => {
  /* Unchecking here is about this one agent. The standing answer is changed in
     Settings and nowhere else, and a create form that quietly rewrote it would
     turn a per-agent decision into a permanent one. */
  assert.ok(!/ping-setting[^)]*method:\s*'POST'/.test(lift('refreshCreateTell')),
    'the create page writes the standing preference');
  assert.ok(!/createTellPaint[\s\S]{0,400}fetch\(/.test(lift('createTellPaint')),
    'the painter performs a request');
});
