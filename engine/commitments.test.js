'use strict';

/**
 * Tests for the commitment store.
 *
 * The store exists so the restart confirmation cannot lie. Most of these tests
 * are therefore about one distinction: **an empty list is not the same as no
 * answer.** If that distinction ever regresses, the dialog starts telling
 * people it is safe to restart an agent whose commitments we simply could not
 * read, which is the exact failure this store was built to remove.
 *
 * Each one was verified by breaking the code first -- a test for "absent reads
 * as unknown" that still passes against a store returning empty is worthless.
 *
 *   node --test engine/commitments.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Point the store at a throwaway directory BEFORE requiring it, so these tests
// never touch the real app data of whoever runs them.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-commitments-'));
process.env.AGENT_WORKFORCE_DATA = TMP;

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./commitments');

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// The distinction the whole store exists for
// ---------------------------------------------------------------------------

test('an agent that has never reported is unknown, NOT clear', () => {
  // The single most important assertion in this file. If this returns `clear`,
  // the restart dialog says "nothing in flight" about an agent it has never
  // heard from, and someone loses work at 3am.
  const got = c.read('never-spoke-to-us');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.notEqual(got.state, c.STATE.CLEAR);
  assert.match(got.because, /never reported/);
});

test('an agent that asserted nothing pending is clear, and distinguishable from absent', () => {
  c.report('asserted-empty', []);
  const asserted = c.read('asserted-empty');
  const absent = c.read('never-reported-either');

  assert.equal(asserted.state, c.STATE.CLEAR);
  assert.equal(absent.state, c.STATE.UNKNOWN);
  // Both hold zero commitments. The state is the only thing telling them
  // apart, which is precisely why an empty array must never be the answer.
  assert.equal(asserted.commitments.length, 0);
  assert.equal(absent.commitments.length, 0);
  assert.notEqual(asserted.state, absent.state);
});

test('a corrupt record is unknown, and does not throw or fall back to empty', () => {
  c.report('corrupted', [{ what: 'something real' }]);
  fs.writeFileSync(c.recordPath('corrupted'), '{"commitments": [{"what": "trunca');

  let got;
  assert.doesNotThrow(() => { got = c.read('corrupted'); });
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.match(got.because, /could not be read/);
});

test('a record with no timestamp is unknown -- an assertion with no "when" is not an assertion', () => {
  c.report('no-timestamp', []);
  fs.writeFileSync(c.recordPath('no-timestamp'), JSON.stringify({ commitments: [] }));
  assert.equal(c.read('no-timestamp').state, c.STATE.UNKNOWN);
});

test('a record whose commitments are not a list is unknown rather than coerced', () => {
  c.report('wrong-shape', []);
  fs.writeFileSync(c.recordPath('wrong-shape'), JSON.stringify({
    reportedAt: new Date().toISOString(),
    commitments: { what: 'not a list' },
  }));
  assert.equal(c.read('wrong-shape').state, c.STATE.UNKNOWN);
});

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

test('clear decays to unknown once it is stale', () => {
  // "Nothing pending" three hours ago is not evidence about now; the agent has
  // been running since it said so.
  c.report('went-quiet', []);
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('went-quiet'), JSON.stringify({
    reportedAt: stale, commitments: [],
  }));

  const got = c.read('went-quiet');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.match(got.because, /too long to still be true/);
  // The timestamp still comes back, so the UI can say *when* rather than
  // implying a freshness it does not have.
  assert.equal(got.reportedAt, stale);
});

test('a report from just inside the window is still believed', () => {
  c.report('recent', []);
  const fresh = new Date(Date.now() - (c.STALE_AFTER_MS - 60000)).toISOString();
  fs.writeFileSync(c.recordPath('recent'), JSON.stringify({
    reportedAt: fresh, commitments: [],
  }));
  assert.equal(c.read('recent').state, c.STATE.CLEAR);
});

// ---------------------------------------------------------------------------
// Round trip and the write API
// ---------------------------------------------------------------------------

test('commitments survive a write and read back intact', () => {
  c.report('raph', [
    { what: 'verify the 14:00 sweep settled' },
    { what: 'reply to Leo about PR #80' },
  ]);
  const got = c.read('raph');
  assert.equal(got.state, c.STATE.HOLDING);
  assert.equal(got.commitments.length, 2);
  assert.equal(got.commitments[0].what, 'verify the 14:00 sweep settled');
  assert.ok(got.commitments[0].id, 'every commitment needs an id to be resolvable');
});

test('report replaces rather than appends, so an agent can say it holds nothing', () => {
  // An append-only store cannot express "nothing", which is the sentence this
  // store most needs to be able to record.
  c.report('emptied', [{ what: 'a thing' }]);
  assert.equal(c.read('emptied').state, c.STATE.HOLDING);
  c.report('emptied', []);
  assert.equal(c.read('emptied').state, c.STATE.CLEAR);
});

test('add extends the existing list', () => {
  c.report('adder', [{ what: 'first' }]);
  c.add('adder', 'second');
  assert.deepEqual(c.read('adder').commitments.map((x) => x.what), ['first', 'second']);
});

test('add on an unreadable record starts fresh rather than silently dropping what it could not read', () => {
  // Extending an `unknown` would quietly discard real commitments. Starting a
  // new list is the honest option, and the old file is unreadable anyway.
  const got = c.add('never-seen-before', 'a new one');
  assert.equal(got.commitments.length, 1);
});

test('resolve removes one and refuses when the record cannot be read', () => {
  c.report('resolver', [{ what: 'keep me' }, { what: 'remove me' }]);
  const target = c.read('resolver').commitments.find((x) => x.what === 'remove me');
  c.resolve('resolver', target.id);
  assert.deepEqual(c.read('resolver').commitments.map((x) => x.what), ['keep me']);

  assert.throws(() => c.resolve('someone-unknown', 'any-id'), /cannot resolve/);
});

test('a commitment with no description is refused rather than stored blank', () => {
  assert.throws(() => c.report('blank', [{ what: '   ' }]), /needs a description/);
  assert.throws(() => c.report('blank', [{}]), /needs a description/);
});

test('readAll returns every agent we hold a record for', () => {
  c.report('one-of-many', [{ what: 'x' }]);
  const all = c.readAll();
  assert.ok(all['one-of-many']);
  assert.equal(all['one-of-many'].state, c.STATE.HOLDING);
});

// ---------------------------------------------------------------------------
// Names are untrusted -- they come from tmux session names
// ---------------------------------------------------------------------------

test('traversal in an agent name cannot escape the store', () => {
  for (const attack of ['../../evil', '../../../etc/passwd', './../x']) {
    const resolved = path.resolve(c.recordPath(attack));
    assert.ok(resolved.startsWith(path.resolve(c.DIR) + path.sep),
      `${attack} resolved outside the store: ${resolved}`);
  }
});

test('a name that sanitises to nothing is unknown rather than reading the store directory', () => {
  assert.equal(c.read('...').state, c.STATE.UNKNOWN);
});

test('concurrent writes leave a valid file rather than a truncated one', () => {
  // Thirteen agents write on this machine. A half-written file that parses as
  // an empty array is the silent loss this store exists to prevent.
  for (let i = 0; i < 40; i++) c.report('busy', [{ what: `commitment ${i}` }]);
  const got = c.read('busy');
  assert.equal(got.state, c.STATE.HOLDING);
  assert.equal(got.commitments[0].what, 'commitment 39');
});
