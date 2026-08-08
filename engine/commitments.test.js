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
    name: 'wrong-shape',
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
    name: 'went-quiet',
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
    name: 'recent',
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


// ---------------------------------------------------------------------------
// Ways the store used to hand back an answer it had not earned
// ---------------------------------------------------------------------------

test('a record that parses to null is unknown, and does not throw', () => {
  // `JSON.parse('null')` succeeds and returns null, and reaching for
  // `.reportedAt` on it throws. From inside the HTTP handler that is an
  // uncaught exception that exits the process, so one file containing `null`
  // took down every caller. Same shape as the stray-% crash on the routes.
  fs.writeFileSync(c.recordPath('nullbot'), 'null');
  let got;
  assert.doesNotThrow(() => { got = c.read('nullbot'); });
  assert.equal(got.state, c.STATE.UNKNOWN);
});

test('a record that parses to a non-object is unknown, and does not throw', () => {
  for (const [name, body] of [['numbot', '42'], ['strbot', '"hello"'], ['arrbot', '[]']]) {
    fs.writeFileSync(c.recordPath(name), body);
    let got;
    assert.doesNotThrow(() => { got = c.read(name); }, `${body} threw`);
    assert.equal(got.state, c.STATE.UNKNOWN, `${body} should be unknown`);
  }
});

test('a future-dated report is unknown, not clear forever', () => {
  // The staleness check was one-sided, so a timestamp ahead of now produced a
  // negative age, sailed under the ceiling, and read as `clear` permanently.
  // reportedAt comes from the local clock, so an NTP correction or a machine
  // that booted fast produces one. A future timestamp is not a fresh
  // assertion, it is an unreadable one.
  fs.writeFileSync(c.recordPath('futurebot'), JSON.stringify({
    name: 'futurebot',
    reportedAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    commitments: [],
  }));
  const got = c.read('futurebot');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.match(got.because, /dated in the future/);
});

test('small clock jitter into the future is still believed', () => {
  // A tolerance, or every machine with a slightly fast clock reads unknown.
  fs.writeFileSync(c.recordPath('jitterbot'), JSON.stringify({
    name: 'jitterbot',
    reportedAt: new Date(Date.now() + 5000).toISOString(),
    commitments: [],
  }));
  assert.equal(c.read('jitterbot').state, c.STATE.CLEAR);
});

// ---------------------------------------------------------------------------
// The data-loss path: stale is not the same as unreadable
// ---------------------------------------------------------------------------

test('add() on a STALE record keeps what was already there', () => {
  // The one that destroyed data. `add()` treated every unknown as "nothing to
  // preserve", so an agent holding three real commitments whose record had
  // merely aged past the window lost all three on the next add, and then read
  // `clear`. A genuinely-holding agent became "nothing in flight" through two
  // ordinary calls, which is the exact lie this store exists to prevent.
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('stalebot'), JSON.stringify({
    name: 'stalebot',
    reportedAt: stale,
    commitments: [{ id: 'a', what: 'verify the sweep' }, { id: 'b', what: 'reply to Leo' }],
  }));
  assert.equal(c.read('stalebot').state, c.STATE.UNKNOWN, 'precondition: it reads as stale');

  c.add('stalebot', 'one new thing');

  const after = c.read('stalebot');
  assert.equal(after.state, c.STATE.HOLDING);
  assert.deepEqual(after.commitments.map((x) => x.what),
    ['verify the sweep', 'reply to Leo', 'one new thing'],
    'the two it was already holding must survive');
});

test('a stale read still returns the list it managed to read', () => {
  // "These three were pending 40 minutes ago" is far more useful at 3am than an
  // empty array, as long as the state says we cannot vouch for it.
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('stalelist'), JSON.stringify({
    name: 'stalelist',
    reportedAt: stale, commitments: [{ id: 'x', what: 'something real' }],
  }));
  const got = c.read('stalelist');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.deepEqual(got.commitments.map((x) => x.what), ['something real']);
});

test('add() REFUSES on a record it could not read, rather than starting fresh', () => {
  // An unreadable record is not an empty one. Overwriting it converts "I cannot
  // tell" into a confident answer and loses whatever it held.
  fs.writeFileSync(c.recordPath('corruptadd'), '{"commitments": [{"what": "trunca');
  assert.throws(() => c.add('corruptadd', 'new thing'), /cannot add to a record we cannot read/);
});

test('add() on a never-reported agent starts a list, which is the one safe case', () => {
  const got = c.add('brandnew', 'first thing');
  assert.equal(got.commitments.length, 1);
});

test('resolve() works on a stale record but refuses an unreadable one', () => {
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('staleresolve'), JSON.stringify({
    name: 'staleresolve',
    reportedAt: stale, commitments: [{ id: 'keep', what: 'keep me' }, { id: 'drop', what: 'drop me' }],
  }));
  c.resolve('staleresolve', 'drop');
  assert.deepEqual(c.read('staleresolve').commitments.map((x) => x.what), ['keep me']);

  fs.writeFileSync(c.recordPath('corruptresolve'), 'null');
  assert.throws(() => c.resolve('corruptresolve', 'any'), /cannot resolve/);
});

// ---------------------------------------------------------------------------
// Bounds and coercion
// ---------------------------------------------------------------------------

test('an absurd number of commitments is refused', () => {
  // Without a cap one local PUT writes hundreds of thousands of entries that
  // then serialise into every /api/status poll.
  const many = Array.from({ length: c.MAX_COMMITMENTS + 1 }, (_, i) => ({ what: `thing ${i}` }));
  assert.throws(() => c.report('floodbot', many), /cannot hold more than/);
  assert.doesNotThrow(() => c.report('floodbot', many.slice(0, c.MAX_COMMITMENTS)));
});

test('every stored field is coerced, including createdAt', () => {
  // createdAt was the one field passing through uncoerced, so an object in the
  // PUT body was stored and re-served verbatim on every status poll.
  c.report('coerce', [{ what: 'x', createdAt: { nested: 'object' }, id: { bad: 1 }, source: 12345 }]);
  const got = c.read('coerce').commitments[0];
  assert.equal(typeof got.createdAt, 'string');
  assert.equal(typeof got.id, 'string');
  assert.equal(typeof got.source, 'string');
});

// ---------------------------------------------------------------------------
// Concurrency, for real
// ---------------------------------------------------------------------------

test('a reader never observes a torn record while writers are racing', async () => {
  // Atomicity is the reason report() writes to a temp file and renames. Proving
  // it needs a READER running while the writers race: writers alone cannot show
  // it, because the last write always lands intact and that is all a
  // read-afterwards sees. Two earlier versions of this test missed for exactly
  // that reason, one of which was a sequential loop with no concurrency at all.
  //
  // Records are ~150KB so a bare writeFileSync genuinely tears mid-write.
  const { execFile } = require('node:child_process');
  const nodePath = require('node:path');
  const modulePath = nodePath.resolve(__dirname, 'commitments.js');

  const writer = (n) => new Promise((resolve) => {
    execFile(process.execPath, ['-e', `
      const c = require(${JSON.stringify(modulePath)});
      const bulk = Array.from({ length: 150 }, (_, k) =>
        ({ what: 'writer ${n} item ' + k + ' ' + 'x'.repeat(900) }));
      for (let i = 0; i < 60; i++) c.report('racer', bulk);
    `], { env: { ...process.env, AGENT_WORKFORCE_DATA: TMP } }, () => resolve());
  });

  let torn = 0, reads = 0;
  let racing = true;
  const reader = (async () => {
    while (racing) {
      const got = c.read('racer');
      reads++;
      // A record that exists but reads back unknown, or reads back short, is a
      // torn write observed in flight. With rename it is impossible: the reader
      // sees either the old file or the new one, never a partial one.
      if (got.state === c.STATE.UNKNOWN && !/never reported/.test(got.because)) torn++;
      else if (got.state !== c.STATE.UNKNOWN && got.commitments.length !== 150) torn++;
      await new Promise((r) => setImmediate(r));
    }
  })();

  await Promise.all([writer(1), writer(2), writer(3), writer(4)]);
  racing = false;
  await reader;

  assert.ok(reads > 50, `reader only sampled ${reads} times, too few to conclude anything`);
  assert.equal(torn, 0, `reader observed ${torn} torn records out of ${reads} reads`);

  const got = c.read('racer');
  assert.notEqual(got.state, c.STATE.UNKNOWN, `record unreadable after the race: ${got.because}`);
  assert.equal(got.commitments.length, 150);

  const strays = fs.readdirSync(c.DIR).filter((f) => f.includes('.tmp'));
  assert.deepEqual(strays, [], `temp files left behind: ${strays.join(', ')}`);
});

test('an unreadable record is NOT treated as a missing one by add()', () => {
  // The guard used to be a string comparison against a message that every read
  // failure produced, so a record behind a permissions error looked identical
  // to one that was never written, and add() overwrote it. Two real
  // commitments were destroyed by a chmod.
  if (process.getuid && process.getuid() === 0) return; // root reads anything
  c.report('permbot', [{ what: 'first real thing' }, { what: 'second real thing' }]);
  fs.chmodSync(c.recordPath('permbot'), 0o000);
  try {
    assert.throws(() => c.add('permbot', 'a new thing'),
      /cannot add to a record we cannot read/,
      'an unreadable record must not be overwritten');
  } finally {
    fs.chmodSync(c.recordPath('permbot'), 0o600);
  }
  assert.deepEqual(c.read('permbot').commitments.map((x) => x.what),
    ['first real thing', 'second real thing'], 'both must survive');
});

test('an aliased spelling of an agent name is refused, not written under it', () => {
  // The dangerous version of this: safeKey strips rather than rejects, so
  // `ANGEL`, `angel.` and `angel` all sanitise to one key and a write under any
  // of them landed in the same file. An earlier fix only DETECTED that on a
  // later read, by which point the real record was already overwritten and the
  // writer had been told it succeeded. Detection after destruction is not a
  // guard, so the write is refused instead.
  c.report('realagent', [{ what: 'something genuinely pending' }]);

  for (const alias of ['REALAGENT', 'realagent.', 'real agent']) {
    assert.throws(() => c.report(alias, []), /exact name/, `${alias} should be refused`);
  }

  // The real record is untouched, and still holding.
  const got = c.read('realagent');
  assert.equal(got.state, c.STATE.HOLDING);
  assert.deepEqual(got.commitments.map((x) => x.what), ['something genuinely pending']);
});

test('a record whose stored name does not match is not served for the wrong agent', () => {
  // Belt to the door's braces: even if a record appears in the store under a
  // key that is not its own name, it must not answer for the agent asking.
  fs.writeFileSync(c.recordPath('impostor'), JSON.stringify({
    name: 'someone-else', reportedAt: new Date().toISOString(), commitments: [],
  }));
  const got = c.read('impostor');
  assert.equal(got.state, c.STATE.UNKNOWN, 'must not inherit another agent assertion');
  assert.match(got.because, /belongs to someone-else/);
});

test('a record with no stored name at all is refused rather than trusted', () => {
  // This module has never shipped a version that omitted the field, so a record
  // missing it was not written by us. An earlier carve-out accepted those and
  // reopened the hole the guard closes.
  fs.writeFileSync(c.recordPath('nameless'), JSON.stringify({
    reportedAt: new Date().toISOString(), commitments: [],
  }));
  assert.equal(c.read('nameless').state, c.STATE.UNKNOWN);
});

test('a record that is not a regular file is refused rather than opened', () => {
  // readFileSync on a FIFO blocks FOREVER, and read() runs synchronously per
  // agent inside the request handler, so one named pipe in the store wedges the
  // whole server with no crash to notice.
  const { execFileSync } = require('node:child_process');
  fs.mkdirSync(c.DIR, { recursive: true });
  const fifo = c.recordPath('fifobot');
  try {
    execFileSync('/usr/bin/mkfifo', [fifo]);
  } catch {
    return; // mkfifo unavailable; nothing to assert
  }
  try {
    const got = c.read('fifobot');
    assert.equal(got.state, c.STATE.UNKNOWN);
    assert.match(got.because, /not a file we can read/);
  } finally {
    fs.rmSync(fifo, { force: true });
  }
});

test('a record listing something unreadable is unknown, and resolve does not throw', () => {
  // report() sanitises what it writes, but a record can be edited by hand. A
  // null element made resolve() throw on .id from inside a request handler.
  fs.writeFileSync(c.recordPath('badlist'), JSON.stringify({
    name: 'badlist', reportedAt: new Date().toISOString(),
    commitments: [null, 42, { what: 'a real one' }],
  }));
  const got = c.read('badlist');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.throws(() => c.resolve('badlist', 'anything'), /cannot resolve/);
});

test('a failed write leaves no temp file behind', () => {
  // Any failure between the write and the rename otherwise leaks one temp file
  // per attempt, forever.
  const before = fs.existsSync(c.DIR) ? fs.readdirSync(c.DIR).filter((f) => f.includes('.tmp')) : [];
  assert.throws(() => c.report('tmpbot', [{ what: '' }]), /needs a description/);
  const after = fs.readdirSync(c.DIR).filter((f) => f.includes('.tmp'));
  assert.deepEqual(after, before, `temp files left behind: ${after.join(', ')}`);
});

test('createdAt is capped and validated, not passed through whole', () => {
  c.report('longdate', [{ what: 'x', createdAt: 'z'.repeat(25000) }]);
  const got = c.read('longdate').commitments[0];
  assert.ok(got.createdAt.length <= 40, `createdAt was ${got.createdAt.length} chars`);
  assert.ok(!Number.isNaN(Date.parse(got.createdAt)), 'an unparseable date should be replaced, not stored');
});

test('readAll does not let a __proto__ record mutate its result', () => {
  // Written with the literal filename, bypassing recordPath: safeKey would
  // sanitise `__proto__` down to `proto`, so going through the normal API
  // cannot produce this file. Anything that can drop a file into the store
  // directory can.
  const raw = path.join(c.DIR, '__proto__.json');
  fs.mkdirSync(c.DIR, { recursive: true });
  fs.writeFileSync(raw, JSON.stringify({
    name: '__proto__',
    reportedAt: new Date().toISOString(), commitments: [{ id: 'p', what: 'polluting' }],
  }));
  try {
    const all = c.readAll();
    // On a plain {} this key vanishes into the prototype instead of appearing.
    assert.ok(Object.prototype.hasOwnProperty.call(all, '__proto__'),
      '__proto__ record should be an own key, not a prototype mutation');
    assert.equal({}.commitments, undefined, 'nothing should have reached Object.prototype');
  } finally {
    fs.rmSync(raw, { force: true });
  }
});
