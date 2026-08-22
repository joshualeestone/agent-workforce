'use strict';

/**
 * The name a person can create and the key we file it under are the same string.
 *
 * 🔑 THIS IS A GUARD ON AN ASSUMPTION HELD IN TWO FILES THAT DO NOT KNOW ABOUT
 * EACH OTHER. `create.js` decides which names may exist (`NAME_RE`, lowercase
 * alphanumerics plus `_` and `-`). `store.js` decides what a name is filed under
 * (`safeKey`, which lowercases and DROPS anything else). Today `safeKey` is the
 * identity function for every name `NAME_RE` admits, so no two agents can share
 * an avatar or a profile.
 *
 * 🛑 THAT IS A COINCIDENCE OF TWO RULES, NOT A PROPERTY EITHER ONE STATES.
 * Loosen `NAME_RE` to allow capitals and `April` and `april` become one file.
 * Nothing in either file would fail, nothing would look wrong, and the first
 * symptom is one agent wearing another's face. #18 asks whether that mismatch
 * is real; it is not reachable today, and this is what keeps the answer true.
 *
 * ⚠️ `NAME_RE` IS NOT EXPORTED, so it is read out of the source rather than
 * restated. A copy of a regex in a test is a second place to be right about
 * which names are legal, and it would go stale silently in exactly the
 * direction this guards.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'namekey-'));
const store = require('./store');

function nameRule() {
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');
  const m = src.match(/const NAME_RE = (\/.+?\/);/);
  assert.ok(m, 'NAME_RE is gone or no longer a literal, so this test cannot read the rule it guards');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);
  assert.ok(re.test('april') && !re.test('April'),
    'the rule read out of create.js does not behave like the one this test was written against');
  return re;
}

test('safeKey does not alter any name a person is allowed to create', () => {
  const NAME_RE = nameRule();
  /* Every two-character name the rule admits, plus longer awkward ones. Two
     characters is the shortest it allows, and the alphabet is small enough to
     walk rather than sample. */
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
  const names = [];
  for (const a of alphabet) for (const b of alphabet) names.push(a + b);
  names.push('april', 'a_b-c', 'agent-9', '0abc', 'z-', 'a__b', 'x'.repeat(32));
  const legal = names.filter((n) => NAME_RE.test(n));
  assert.ok(legal.length > 100, 'only ' + legal.length + ' legal names generated, so this proves little');

  const altered = legal.filter((n) => store.safeKey(n) !== n);
  assert.deepEqual(altered, [],
    'safeKey changes a legal name, so two different agents can be filed under one key');
});

test('the names safeKey WOULD collapse are all refused before they reach it', () => {
  const NAME_RE = nameRule();
  /* 🔑 THE OTHER HALF, and without it the test above is satisfied by a safeKey
     that changes nothing at all. These are real collisions, and every one of
     them must be unreachable because the NAME rule rejects it, not because
     safeKey is gentle. */
  const collide = ['April', 'A.B', 'my agent', 'Bob!', 'a b'];
  for (const n of collide) {
    assert.ok(!NAME_RE.test(n), JSON.stringify(n) + ' is now a legal name, and safeKey collapses it');
    assert.notEqual(store.safeKey(n), n, 'CONTROL: ' + JSON.stringify(n) + ' no longer collides, so it proves nothing');
  }
  /* And the pair that matters, stated as the thing itself: two legal-looking
     names differing only in case must not exist, because they would be one key. */
  assert.equal(store.safeKey('April'), store.safeKey('april'),
    'CONTROL: case no longer collapses, so the rule above is guarding nothing');
});
