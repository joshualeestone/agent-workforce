'use strict';

/**
 * Tests for the store.
 *
 * This is the file that decides where uploaded bytes land, so it is the one
 * place in the codebase where being wrong writes to somewhere it should not.
 * It was written quickly and verified by hand once; these pin the behaviour
 * that hand-check confirmed.
 *
 *   node --test engine/store.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { safeKey, ALLOWED_IMAGES, AVATARS } = require('./store');

// ---------------------------------------------------------------------------
// Name sanitising -- the security-relevant part
// ---------------------------------------------------------------------------

test('traversal sequences cannot escape the store', () => {
  // Verified by hand once: ../../evil resolved inside the store rather than
  // outside it. This pins that, because "the response said ok" was not
  // evidence of where the bytes actually went.
  for (const attack of ['../../evil', '../../../etc/passwd', '..%2F..%2Fevil', './../x']) {
    const key = safeKey(attack);
    assert.ok(!key.includes('/'), `slash survived in ${attack} -> ${key}`);
    assert.ok(!key.includes('.'), `dot survived in ${attack} -> ${key}`);
    const resolved = path.resolve(AVATARS, key + '.png');
    assert.ok(resolved.startsWith(path.resolve(AVATARS) + path.sep),
      `${attack} resolved outside the store: ${resolved}`);
  }
});

test('an absolute path cannot be smuggled in as a name', () => {
  const resolved = path.resolve(AVATARS, safeKey('/etc/passwd') + '.png');
  assert.ok(resolved.startsWith(path.resolve(AVATARS) + path.sep));
});

test('a name that sanitises to nothing is refused rather than silently allowed', () => {
  // '...' becoming '' would otherwise write to the store directory itself.
  for (const empty of ['...', '///', '../..', '']) {
    assert.throws(() => safeKey(empty), /invalid agent name/,
      `${JSON.stringify(empty)} should be refused`);
  }
});

test('names are case-folded so one agent cannot own two avatars', () => {
  assert.equal(safeKey('Angel'), safeKey('angel'));
  assert.equal(safeKey('ANGEL'), 'angel');
});

test('ordinary names survive intact', () => {
  assert.equal(safeKey('angel'), 'angel');
  assert.equal(safeKey('casey-jones'), 'casey-jones');
  assert.equal(safeKey('agent_2'), 'agent_2');
});

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

test('only image types the page can actually render are accepted', () => {
  // A file the browser cannot display looks identical to an upload that
  // silently failed, which is the worse of the two outcomes.
  for (const good of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.ok(ALLOWED_IMAGES[good], `${good} should be allowed`);
  }
  for (const bad of ['application/zip', 'text/html', 'image/svg+xml', 'application/octet-stream', '']) {
    assert.ok(!ALLOWED_IMAGES[bad], `${bad} should not be allowed`);
  }
});

test('svg is deliberately excluded', () => {
  // SVG is a document format that can carry script. It renders like an image
  // and behaves like a web page, which is not a trade worth making for an
  // avatar.
  assert.ok(!ALLOWED_IMAGES['image/svg+xml']);
});

test('every allowed type maps to a real file extension', () => {
  for (const [type, ext] of Object.entries(ALLOWED_IMAGES)) {
    assert.match(ext, /^\.[a-z]+$/, `${type} has a suspect extension: ${ext}`);
  }
});
