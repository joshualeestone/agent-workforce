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
  c.report('corrupted', [{ what: 'something real', id: 'gen1', createdAt: new Date().toISOString(), source: 'agent' }]);
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
    commitments: { what: 'not a list', id: 'gen2', createdAt: new Date().toISOString(), source: 'agent' },
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
    { what: 'verify the 14:00 sweep settled', id: 'gen3', createdAt: new Date().toISOString(), source: 'agent' },
    { what: 'reply to Leo about PR #80', id: 'gen4', createdAt: new Date().toISOString(), source: 'agent' },
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
  c.report('emptied', [{ what: 'a thing', id: 'gen5', createdAt: new Date().toISOString(), source: 'agent' }]);
  assert.equal(c.read('emptied').state, c.STATE.HOLDING);
  c.report('emptied', []);
  assert.equal(c.read('emptied').state, c.STATE.CLEAR);
});

test('add extends the existing list', () => {
  c.report('adder', [{ what: 'first', id: 'gen6', createdAt: new Date().toISOString(), source: 'agent' }]);
  c.add('adder', 'second');
  assert.deepEqual(c.read('adder').commitments.map((x) => x.what), ['first', 'second']);
});


test('resolve removes one and refuses when the record cannot be read', () => {
  c.report('resolver', [{ what: 'keep me', id: 'gen7', createdAt: new Date().toISOString(), source: 'agent' }, { what: 'remove me', id: 'gen8', createdAt: new Date().toISOString(), source: 'agent' }]);
  const target = c.read('resolver').commitments.find((x) => x.what === 'remove me');
  c.resolve('resolver', target.id);
  assert.deepEqual(c.read('resolver').commitments.map((x) => x.what), ['keep me']);

  assert.throws(() => c.resolve('someone-unknown', 'any-id'), /cannot resolve/);
});

test('a commitment with no description is refused rather than stored blank', () => {
  assert.throws(() => c.report('blank', [{ what: '   ', id: 'gen9', createdAt: new Date().toISOString(), source: 'agent' }]), /needs a description/);
  assert.throws(() => c.report('blank', [{}]), /needs a description/);
});

test('readAll returns every agent we hold a record for', () => {
  c.report('one-of-many', [{ what: 'x', id: 'gen10', createdAt: new Date().toISOString(), source: 'agent' }]);
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
    commitments: [{ id: 'a', what: 'verify the sweep', createdAt: new Date().toISOString(), source: 'agent' }, { id: 'b', what: 'reply to Leo', createdAt: new Date().toISOString(), source: 'agent' }],
  }));
  assert.equal(c.read('stalebot').state, c.STATE.UNKNOWN, 'precondition: it reads as stale');

  c.add('stalebot', 'one new thing');

  const after = c.read('stalebot');
  assert.deepEqual(after.commitments.map((x) => x.what),
    ['verify the sweep', 'reply to Leo', 'one new thing'],
    'the two it was already holding must survive');

  // And it must STILL read unknown. The agent told us about one new thing; it
  // has not re-asserted everything else. Re-dating the record here would
  // launder "we cannot tell" into a confident answer, which is the failure the
  // whole module exists to prevent -- reached through its own convenience API.
  assert.equal(after.state, c.STATE.UNKNOWN,
    'a derived change must not re-publish a stale record as current');
});

test('a no-op resolve on a stale record does not turn unknown into a confident answer', () => {
  // The sharpest version of it: resolving an id that is not even present
  // changes nothing, and used to come back `clear` on a record we had just
  // refused to vouch for. The agent never asserted its current state; the old
  // data was simply re-stamped as fresh.
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('ghost'), JSON.stringify({
    name: 'ghost', reportedAt: stale, commitments: [{ id: 'x', what: 'still pending', createdAt: new Date().toISOString(), source: 'agent' }],
  }));
  assert.equal(c.read('ghost').state, c.STATE.UNKNOWN, 'precondition');

  c.resolve('ghost', 'no-such-id');

  const after = c.read('ghost');
  assert.equal(after.state, c.STATE.UNKNOWN, 'a no-op resolve must not refresh the assertion');
  assert.deepEqual(after.commitments.map((x) => x.what), ['still pending']);
});

test('resolving the LAST commitment on a stale record does not produce clear', () => {
  // The dangerous direction: emptying a stale list looks exactly like "nothing
  // pending" unless the timestamp is preserved.
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('emptying'), JSON.stringify({
    name: 'emptying', reportedAt: stale, commitments: [{ id: 'only', what: 'the last one', createdAt: new Date().toISOString(), source: 'agent' }],
  }));
  c.resolve('emptying', 'only');

  const after = c.read('emptying');
  assert.equal(after.commitments.length, 0);
  assert.equal(after.state, c.STATE.UNKNOWN,
    'an emptied stale list must not read as clear');
});

test('add and resolve on a FRESH record do refresh it, which is the whole point', () => {
  // The preserve-the-timestamp rule must not accidentally freeze fresh records.
  c.report('freshbot', [{ id: 'one', what: 'first', createdAt: new Date().toISOString(), source: 'agent' }]);
  c.add('freshbot', 'second');
  assert.equal(c.read('freshbot').state, c.STATE.HOLDING);
  c.resolve('freshbot', 'one');
  const after = c.read('freshbot');
  assert.equal(after.state, c.STATE.HOLDING);
  assert.deepEqual(after.commitments.map((x) => x.what), ['second']);
});

test('a stale read still returns the list it managed to read', () => {
  // "These three were pending 40 minutes ago" is far more useful at 3am than an
  // empty array, as long as the state says we cannot vouch for it.
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('stalelist'), JSON.stringify({
    name: 'stalelist',
    reportedAt: stale, commitments: [{ id: 'x', what: 'something real', createdAt: new Date().toISOString(), source: 'agent' }],
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
    reportedAt: stale, commitments: [{ id: 'keep', what: 'keep me', createdAt: new Date().toISOString(), source: 'agent' }, { id: 'drop', what: 'drop me', createdAt: new Date().toISOString(), source: 'agent' }],
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
  c.report('permbot', [{ what: 'first real thing', id: 'gen11', createdAt: new Date().toISOString(), source: 'agent' }, { what: 'second real thing', id: 'gen12', createdAt: new Date().toISOString(), source: 'agent' }]);
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
  c.report('realagent', [{ what: 'something genuinely pending', id: 'gen13', createdAt: new Date().toISOString(), source: 'agent' }]);

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

test('a record that is not a regular file is refused rather than opened', (t) => {
  // readFileSync on a FIFO blocks FOREVER, and read() runs synchronously per
  // agent inside the request handler, so one named pipe in the store wedges the
  // whole server with no crash to notice.
  //
  // Run in a CHILD with a wall-clock kill. Done in-process, removing the guard
  // does not fail this test, it hangs it: the synchronous read never yields, so
  // --test-timeout cannot fire and CI gets an indefinite stall instead of a
  // diagnostic. A test whose failure mode is "the run never ends" is worse than
  // no test.
  const { execFileSync: run } = require('node:child_process');
  const nodePath = require('node:path');
  fs.mkdirSync(c.DIR, { recursive: true });
  const fifo = c.recordPath('fifobot');
  try {
    run('/usr/bin/mkfifo', [fifo]);
  } catch {
    // Visible skip, not a silent tick for a property never exercised.
    return t.skip('mkfifo unavailable on this machine');
  }

  try {
    const out = run(process.execPath, ['-e', `
      const c = require(${JSON.stringify(nodePath.resolve(__dirname, 'commitments.js'))});
      const got = c.read('fifobot');
      process.stdout.write(JSON.stringify({ state: got.state, because: got.because }));
    `], { env: { ...process.env, AGENT_WORKFORCE_DATA: TMP }, timeout: 5000, encoding: 'utf8' });

    const got = JSON.parse(out);
    assert.equal(got.state, c.STATE.UNKNOWN);
    assert.match(got.because, /not a file we can read/);
  } catch (err) {
    // A timeout here IS the bug: the guard is gone and the read blocked.
    assert.fail(`reading a FIFO did not return promptly: ${err.code || err.message}`);
  } finally {
    fs.rmSync(fifo, { force: true });
  }
});

test('a symlinked record cannot point the read outside the store', (t) => {
  // lstat rather than stat, so a link is seen as a link. This test is what
  // pins it: swapping lstatSync for statSync fails here. (An earlier version of
  // this comment said the guard was unpinned, which was true when written and
  // became false when this test landed. A stale comment that says "safe to
  // change" is worse than none.)
  const os = require('node:os');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-link-'));
  const target = path.join(outside, 'target.json');
  fs.writeFileSync(target, JSON.stringify({
    name: 'linkbot', reportedAt: new Date().toISOString(),
    commitments: [{ id: 'l', what: 'REACHED THROUGH A SYMLINK', createdAt: new Date().toISOString(), source: 'agent' }],
  }));
  fs.mkdirSync(c.DIR, { recursive: true });
  const link = c.recordPath('linkbot');
  fs.rmSync(link, { force: true });
  try {
    fs.symlinkSync(target, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    return t.skip('symlinks unavailable on this machine');
  }
  try {
    const got = c.read('linkbot');
    assert.equal(got.state, c.STATE.UNKNOWN, 'a symlink was followed out of the store');
    assert.ok(!JSON.stringify(got).includes('REACHED THROUGH A SYMLINK'));
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a record listing something unreadable is unknown, and resolve does not throw', () => {
  // report() sanitises what it writes, but a record can be edited by hand. A
  // null element made resolve() throw on .id from inside a request handler.
  fs.writeFileSync(c.recordPath('badlist'), JSON.stringify({
    name: 'badlist', reportedAt: new Date().toISOString(),
    commitments: [null, 42, { what: 'a real one', id: 'gen14', createdAt: new Date().toISOString(), source: 'agent' }],
  }));
  const got = c.read('badlist');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.throws(() => c.resolve('badlist', 'anything'), /cannot resolve/);
});

test('a failed write leaves no temp file behind', () => {
  // Any failure between the write and the rename otherwise leaks one temp file
  // per attempt, forever.
  const before = fs.existsSync(c.DIR) ? fs.readdirSync(c.DIR).filter((f) => f.includes('.tmp')) : [];
  assert.throws(() => c.report('tmpbot', [{ what: '', id: 'gen15', createdAt: new Date().toISOString(), source: 'agent' }]), /needs a description/);
  const after = fs.readdirSync(c.DIR).filter((f) => f.includes('.tmp'));
  assert.deepEqual(after, before, `temp files left behind: ${after.join(', ')}`);
});

test('createdAt is capped and validated, not passed through whole', () => {
  c.report('longdate', [{ what: 'x', createdAt: 'z'.repeat(25000), id: 'gen16', source: 'agent' }]);
  const got = c.read('longdate').commitments[0];
  assert.ok(got.createdAt.length <= 40, `createdAt was ${got.createdAt.length} chars`);
  assert.ok(!Number.isNaN(Date.parse(got.createdAt)), 'an unparseable date should be replaced, not stored');
});

test('readAll does not let a __proto__ record mutate its result', () => {
  // safeKey strips [^a-z0-9_-] and therefore PRESERVES underscores, so
  // `__proto__` survives it intact and report('__proto__', ...) writes this
  // file through the ordinary public API. An earlier comment claimed the
  // opposite, that only something dropping a file into the store could produce
  // it, which understated how easily it arises.
  const raw = path.join(c.DIR, '__proto__.json');
  fs.mkdirSync(c.DIR, { recursive: true });
  fs.writeFileSync(raw, JSON.stringify({
    name: '__proto__',
    reportedAt: new Date().toISOString(), commitments: [{ id: 'p', what: 'polluting', createdAt: new Date().toISOString(), source: 'agent' }],
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

// ---------------------------------------------------------------------------
// Guards that were load-bearing but unpinned
// ---------------------------------------------------------------------------

test('a record with an unparseable timestamp is unknown, not clear', () => {
  // The earlier version of this test omitted `name`, so the record was rejected
  // by the name guard first and the timestamp check was never reached: setting
  // that check to `if (false)` left the whole suite green while a record with
  // `reportedAt: 'not-a-date'` read as clear.
  for (const bad of ['not-a-date', '', 'yesterday', '2026-13-45T99:99:99Z']) {
    fs.writeFileSync(c.recordPath('badstamp'), JSON.stringify({
      name: 'badstamp', reportedAt: bad, commitments: [],
    }));
    const got = c.read('badstamp');
    assert.equal(got.state, c.STATE.UNKNOWN, `reportedAt=${JSON.stringify(bad)} should be unknown`);
  }
});

test('a record with a non-string timestamp is unknown', () => {
  for (const bad of [12345, null, { at: 'now' }, ['2026-01-01']]) {
    fs.writeFileSync(c.recordPath('typestamp'), JSON.stringify({
      name: 'typestamp', reportedAt: bad, commitments: [],
    }));
    assert.equal(c.read('typestamp').state, c.STATE.UNKNOWN,
      `reportedAt=${JSON.stringify(bad)} should be unknown`);
  }
});

test('the staleness window is thirty minutes, not whatever the constant happens to say', () => {
  // Every other test derives its offset from the exported constant, so widening
  // STALE_AFTER_MS to 30 DAYS passed the entire suite. The plan calls this "the
  // one number I would expect to tune", which makes an unguarded edit likely,
  // and a stale `clear` surviving 30 days is a false "safe to restart".
  assert.equal(c.STALE_AFTER_MS, 30 * 60 * 1000, 'staleness window changed; was that deliberate?');
  assert.equal(c.FUTURE_TOLERANCE_MS, 60 * 1000, 'future tolerance changed; was that deliberate?');
});

test('field caps are enforced at their stated lengths', () => {
  // The caps were load-bearing but unpinned: removing the createdAt slice left
  // the suite green, because the fixture was rejected by Date.parse rather than
  // by the cap. Date.parse accepts arbitrarily long strings through its legacy
  // parenthesised-comment syntax, so the cap has to come first.
  const longButParseable = '2026-01-01 ' + '('.repeat(2000) + ')'.repeat(2000);
  assert.ok(!Number.isNaN(Date.parse(longButParseable)), 'fixture must actually parse as a date');

  c.report('caps', [{
    what: 'w'.repeat(5000),
    id: 'i'.repeat(5000),
    source: 's'.repeat(5000),
    createdAt: longButParseable,
  }]);
  const got = c.read('caps').commitments[0];
  assert.ok(got.what.length <= 300, `what was ${got.what.length}`);
  assert.ok(got.id.length <= 80, `id was ${got.id.length}`);
  assert.ok(got.source.length <= 40, `source was ${got.source.length}`);
  assert.ok(got.createdAt.length <= 40, `createdAt was ${got.createdAt.length}`);
});

test('a write that fails AFTER the temp file exists cleans it up', () => {
  // The earlier version of this test threw inside sanitise(), before any temp
  // file was written, so it never reached the cleanup path it was named for:
  // deleting the rmSync left the suite green. Making the destination a
  // directory fails the rename instead, which is after the temp write.
  ensure_dir();
  const dest = c.recordPath('renamefail');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest);
  try {
    assert.throws(() => c.report('renamefail', [{ what: 'something', id: 'gen17', createdAt: new Date().toISOString(), source: 'agent' }]), /could not be saved/);
    const strays = fs.readdirSync(c.DIR).filter((f) => f.startsWith('renamefail') && f.includes('.tmp'));
    assert.deepEqual(strays, [], `temp file left behind: ${strays.join(', ')}`);
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

function ensure_dir() {
  fs.mkdirSync(c.DIR, { recursive: true });
}

test('traversal is refused by the code that actually reads and writes, not just by a helper', () => {
  // Two earlier versions of this test proved nothing. The first asserted only
  // on recordPath(), which NO production path called. The second went through
  // read() but used attack strings that did not actually resolve to anything,
  // so it passed against a deliberately vulnerable build.
  //
  // This one computes the traversal RELATIVE TO THE STORE and plants a real
  // file at the target, so the attack either reaches it or does not.
  const os = require('node:os');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-outside-'));
  const secretName = 'secret';

  fs.mkdirSync(c.DIR, { recursive: true });
  // e.g. '../../aw-outside-XXXX/secret' -- a name that, used unsanitised, lands
  // exactly on the planted file.
  const escape = path.join(path.relative(c.DIR, outsideDir), secretName);

  // The planted record's `name` is the ATTACK STRING, not a plain name. That
  // matters: an earlier version planted `name: 'secret'`, so the stored-name
  // guard rejected the record and the test passed even against a build with no
  // path sanitising at all. It was passing for the wrong reason, and could not
  // tell the two guards apart. With the name matching, only the path derivation
  // can stop this.
  fs.writeFileSync(path.join(outsideDir, `${secretName}.json`), JSON.stringify({
    name: escape, reportedAt: new Date().toISOString(),
    commitments: [{ id: 's', what: 'SECRET FROM OUTSIDE THE STORE', createdAt: new Date().toISOString(), source: 'agent' }],
  }));

  try {
    // Sanity: the attack string really does point at the secret when joined raw.
    const wouldReach = path.join(c.DIR, `${escape}.json`);
    assert.ok(fs.existsSync(wouldReach), 'fixture is wrong: the traversal target does not exist');

    const got = c.read(escape);
    assert.notEqual(got.state, c.STATE.HOLDING, 'traversal reached a record outside the store');
    assert.ok(!JSON.stringify(got).includes('SECRET FROM OUTSIDE'),
      'traversal returned content from outside the store');

    // And the write path must not land outside DIR either.
    const before = fs.readdirSync(outsideDir).sort();
    try { c.report(escape, [{ what: 'should not land here', id: 'gen18', createdAt: new Date().toISOString(), source: 'agent' }]); } catch { /* refused is fine */ }
    assert.deepEqual(fs.readdirSync(outsideDir).sort(), before,
      'a write escaped the store directory');
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('a stale add cannot grow a record past the cap', () => {
  // The cap lived only in report(), and the stale branch of add() calls the
  // writer directly. Because that branch deliberately preserves the old
  // timestamp, the record STAYS stale, so every later add takes the same
  // uncapped path: a 200-entry record grew to 250 in fifty calls.
  const stale = new Date(Date.now() - c.STALE_AFTER_MS - 60000).toISOString();
  fs.writeFileSync(c.recordPath('growbot'), JSON.stringify({
    name: 'growbot', reportedAt: stale,
    commitments: Array.from({ length: c.MAX_COMMITMENTS }, (_, i) => ({ id: `i${i}`, what: `thing ${i}`, createdAt: new Date().toISOString(), source: 'agent' })),
  }));
  assert.throws(() => c.add('growbot', 'one too many'), /cannot hold more than/);
  assert.equal(c.read('growbot').commitments.length, c.MAX_COMMITMENTS);
});

test('a hand-written record beyond the cap is refused rather than served', () => {
  // Caps were write-side only, and read() feeds straight into every status
  // poll: 5,000 entries measured 12.6 MB per agent, serialised synchronously
  // inside the request handler.
  fs.writeFileSync(c.recordPath('hugebot'), JSON.stringify({
    name: 'hugebot', reportedAt: new Date().toISOString(),
    commitments: Array.from({ length: c.MAX_COMMITMENTS + 50 }, (_, i) => ({ id: `i${i}`, what: `x${i}`, createdAt: new Date().toISOString(), source: 'agent' })),
  }));
  assert.equal(c.read('hugebot').state, c.STATE.UNKNOWN);
});

test('a future-dated record is not laundered fresh by add or resolve either', () => {
  // The future half of isStale() was unpinned: mutating it away left the suite
  // green. Every laundering scenario was tested against a STALE record and none
  // against a future-dated one, even though both reach the same branch.
  const ahead = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  fs.writeFileSync(c.recordPath('aheadbot'), JSON.stringify({
    name: 'aheadbot', reportedAt: ahead, commitments: [{ id: 'a', what: 'pending', createdAt: new Date().toISOString(), source: 'agent' }],
  }));
  assert.equal(c.read('aheadbot').state, c.STATE.UNKNOWN, 'precondition');

  c.add('aheadbot', 'another');
  assert.equal(c.read('aheadbot').state, c.STATE.UNKNOWN,
    'add must not re-publish a future-dated record as current');

  c.resolve('aheadbot', 'a');
  assert.equal(c.read('aheadbot').state, c.STATE.UNKNOWN,
    'resolve must not re-publish a future-dated record as current');
});

test('an enormous record is refused before it is read, not after it is parsed', () => {
  // The entry cap counts commitments and only applies after the whole file is
  // parsed, which is far too late: a 200MB record measured 232ms per read,
  // 1.1GB resident and a 209MB status payload, synchronously inside the request
  // handler on a board that polls continuously. Same failure class as the FIFO.
  fs.mkdirSync(c.DIR, { recursive: true });
  const huge = { name: 'hugefile', reportedAt: new Date().toISOString(), commitments: [{ id: 'a', what: 'x', createdAt: new Date().toISOString(), source: 'agent' }] };
  // Pad past the byte ceiling while staying valid JSON and under the entry cap.
  huge.padding = 'p'.repeat(c.MAX_RECORD_BYTES + 1024);
  fs.writeFileSync(c.recordPath('hugefile'), JSON.stringify(huge));

  const got = c.read('hugefile');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.match(got.because, /larger than we can read/);
});

test('every field is capped on the way OUT, not just what', () => {
  // The read path capped only `what` and re-served id, createdAt, source and
  // any extra key verbatim: 135KB from one hand-edited commitment on every
  // poll. That is the createdAt bug the write path records as fixed, reached
  // through the one door all the surrounding guards exist to defend.
  fs.writeFileSync(c.recordPath('fatfields'), JSON.stringify({
    name: 'fatfields', reportedAt: new Date().toISOString(),
    commitments: [{
      what: 'w'.repeat(5000), id: 'i'.repeat(5000),
      source: 's'.repeat(5000), createdAt: 'c'.repeat(5000),
      junk: 'j'.repeat(50000),
    }],
  }));
  const got = c.read('fatfields');
  assert.equal(got.state, c.STATE.HOLDING);
  const only = got.commitments[0];
  assert.ok(only.what.length <= 300, `what ${only.what.length}`);
  assert.ok(only.id.length <= 80, `id ${only.id.length}`);
  assert.ok(only.source.length <= 40, `source ${only.source.length}`);
  assert.ok(only.createdAt.length <= 40, `createdAt ${only.createdAt.length}`);
  assert.equal(only.junk, undefined, 'unknown keys must not be re-served');
  assert.ok(JSON.stringify(got).length < 2000, `payload was ${JSON.stringify(got).length} bytes`);
});

test('a blank description in a hand-edited record is unknown, and does NOT throw', () => {
  // The usability check accepted any string `what`, but sanitise() throws on an
  // empty or whitespace-only one. Sanitising on the way out made that throw
  // reachable from read(), which runs synchronously inside the request handler:
  // one such record exited the process on a GET and 500'd the WHOLE BOARD on
  // /api/status, because every agent's block is read on the same request.
  //
  // read() must never throw. That is the property; this pins it.
  for (const [name, what] of [['blankws', '   '], ['blankempty', ''], ['blanktab', '\t\n']]) {
    fs.writeFileSync(c.recordPath(name), JSON.stringify({
      name, reportedAt: new Date().toISOString(), commitments: [{ id: 'x', what }],
    }));
    let got;
    assert.doesNotThrow(() => { got = c.read(name); }, `what=${JSON.stringify(what)} threw`);
    assert.equal(got.state, c.STATE.UNKNOWN);
  }
});

test('read() never throws, whatever the record contains', () => {
  // A blanket property test, because this is the one function whose throwing
  // takes the process down. Every shape that has ever broken it, plus a few
  // more, asserted in one place so a future edit has to trip over it.
  const shapes = [
    'null', '42', '"text"', '[]', '{}', 'not json at all', '',
    JSON.stringify({ name: 'x' }),
    JSON.stringify({ name: 'shapes', reportedAt: 'nope', commitments: [] }),
    JSON.stringify({ name: 'shapes', reportedAt: new Date().toISOString(), commitments: 'no' }),
    JSON.stringify({ name: 'shapes', reportedAt: new Date().toISOString(), commitments: [null] }),
    JSON.stringify({ name: 'shapes', reportedAt: new Date().toISOString(), commitments: [{ what: '', id: 'gen19', createdAt: new Date().toISOString(), source: 'agent' }] }),
    JSON.stringify({ name: 'shapes', reportedAt: new Date().toISOString(), commitments: [{ what: 0, id: 'gen20', createdAt: new Date().toISOString(), source: 'agent' }] }),
    JSON.stringify({ name: 'shapes', reportedAt: null, commitments: [] }),
    // An object-valued `name`. String() throws on this (non-callable toString
    // and valueOf), and the throw sat OUTSIDE every try, so one such record
    // answered 500 for the entire board on /api/status. The first version of
    // this very test missed it: a blanket property test is only as blanket as
    // its list of shapes.
    JSON.stringify({ name: { toString: 'x', valueOf: 'y' }, reportedAt: new Date().toISOString(), commitments: [] }),
    JSON.stringify({ name: 42, reportedAt: new Date().toISOString(), commitments: [] }),
    JSON.stringify({ name: ['shapes'], reportedAt: new Date().toISOString(), commitments: [] }),
    // An object-valued id, refused by the usability check's type test.
    JSON.stringify({ name: 'shapes', reportedAt: new Date().toISOString(),
      commitments: [{ what: 'real', createdAt: new Date().toISOString(), id: { toString: 'x', valueOf: 'y' } }] }),
  ];
  for (const body of shapes) {
    fs.writeFileSync(c.recordPath('shapes'), body);
    let got;
    assert.doesNotThrow(() => { got = c.read('shapes'); }, `threw on ${body.slice(0, 60)}`);
    assert.ok(got && typeof got.state === 'string', `no usable answer for ${body.slice(0, 60)}`);
    assert.notEqual(got.state, c.STATE.CLEAR, `${body.slice(0, 60)} must not read as clear`);
  }
});

test('the read path caps fields but never invents them', () => {
  // It used to run the WRITE-path sanitiser, which fills in a missing id or
  // timestamp because the write path legitimately can. On the read path there
  // is nothing to derive them from, so a record missing an id got a fresh UUID
  // on EVERY read: `resolve()` with an id the caller had just read back removed
  // nothing and still reported success, and the board saw a churning id plus a
  // "created just now" timestamp for a commitment of unknown age.
  //
  // In a module whose thesis is "never invent a confident answer", minting an
  // identifier is the same class of lie as an empty list.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('noinvent'), JSON.stringify({
    name: 'noinvent', reportedAt: stamp,
    commitments: [{ what: 'no id on this one', createdAt: stamp, source: 'agent' }],
  }));
  assert.equal(c.read('noinvent').state, c.STATE.UNKNOWN,
    'a record missing an id must be refused, not repaired');

  // With a real id it reads fine, and the id is stable across reads.
  fs.writeFileSync(c.recordPath('stableid'), JSON.stringify({
    name: 'stableid', reportedAt: stamp,
    commitments: [{ id: 'fixed-id', what: 'has an id', createdAt: stamp, source: 'agent' }],
  }));
  const first = c.read('stableid').commitments[0];
  const second = c.read('stableid').commitments[0];
  assert.equal(first.id, 'fixed-id');
  assert.equal(first.id, second.id, 'the id must not change between reads');
  assert.equal(first.createdAt, stamp, 'createdAt must not be replaced with now');
});

test('the blank-what and bad-type clauses of the usability check are pinned separately', () => {
  // Two clauses of the same predicate, each reached by exactly one fixture.
  // They previously masked each other: one test satisfied by either guard
  // alone, both producing the same message, so no assertion could tell them
  // apart. (The name of this test used to say "throw-guard", which stopped
  // being accurate when the type check landed and made the catch redundant.)
  const stamp = new Date().toISOString();

  // Reaches the usability check only: a blank `what` never gets to the coercion.
  fs.writeFileSync(c.recordPath('onlyblank'), JSON.stringify({
    name: 'onlyblank', reportedAt: stamp, commitments: [{ id: 'a', what: '  ', createdAt: stamp, source: 'agent' }],
  }));
  assert.equal(c.read('onlyblank').state, c.STATE.UNKNOWN);

  // An object-valued id, caught by the usability check's type test.
  fs.writeFileSync(c.recordPath('onlythrow'), JSON.stringify({
    name: 'onlythrow', reportedAt: stamp,
    commitments: [{ id: { toString: 'x', valueOf: 'y' }, what: 'a real one', createdAt: stamp }],
  }));
  let got;
  assert.doesNotThrow(() => { got = c.read('onlythrow'); });
  assert.equal(got.state, c.STATE.UNKNOWN);
});

test('an unparseable createdAt is served verbatim, not replaced with now', () => {
  // The one input where the read-path capper and the write-path sanitiser
  // genuinely differ, and it was untested: sanitise() replaces an unparseable
  // createdAt with the current time, so the board would show "created just now"
  // for a commitment of unknown age. Without this fixture, swapping the read
  // path back to sanitise() left the whole suite green.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('oddstamp'), JSON.stringify({
    name: 'oddstamp', reportedAt: stamp,
    commitments: [{ id: 'a', what: 'real', createdAt: 'not-a-date-at-all', source: 'agent' }],
  }));
  const got = c.read('oddstamp');
  assert.equal(got.state, c.STATE.HOLDING);
  assert.equal(got.commitments[0].createdAt, 'not-a-date-at-all',
    'the read path must not invent a creation time it cannot know');
});

test('a record missing source is refused rather than given one', () => {
  // report() always writes source, so a record without it was not written by
  // us. Defaulting it to 'agent' asserted a provenance the record never stated,
  // in a module that refuses to default id, createdAt or name for exactly that
  // reason.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('nosource'), JSON.stringify({
    name: 'nosource', reportedAt: stamp,
    commitments: [{ id: 'a', what: 'real', createdAt: stamp }],
  }));
  assert.equal(c.read('nosource').state, c.STATE.UNKNOWN);
});

test('a description that is only padding is not served as blank', () => {
  // The guard tested the TRIMMED value while the display sliced the RAW one, so
  // 300 spaces followed by real text passed the non-blank check and came back
  // as an empty string. Worse, add() and resolve() on that agent then threw
  // "every commitment needs a description" forever, so the record could not be
  // corrected through the module's own API.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('padded'), JSON.stringify({
    name: 'padded', reportedAt: stamp,
    commitments: [{ id: 'a', what: ' '.repeat(300) + 'the real text', createdAt: stamp, source: 'agent' }],
  }));
  const got = c.read('padded');
  assert.equal(got.state, c.STATE.HOLDING);
  assert.equal(got.commitments[0].what.trim(), 'the real text',
    'padding must be trimmed before the cap, not sliced into blankness');

  // And the record stays usable through the module's own API.
  assert.doesNotThrow(() => c.add('padded', 'another'));
});

test('an empty-string id is refused, so resolve cannot remove two things at once', () => {
  const stamp = new Date().toISOString();
  // ONE commitment, deliberately. With two, idsAreUnique() refuses the record
  // and the non-empty clause never decides anything: deleting it left the suite
  // green while a single-commitment record with an empty id read as holding.
  fs.writeFileSync(c.recordPath('emptyid'), JSON.stringify({
    name: 'emptyid', reportedAt: stamp,
    commitments: [{ id: '', what: 'one', createdAt: stamp, source: 'agent' }],
  }));
  assert.equal(c.read('emptyid').state, c.STATE.UNKNOWN);
});

test('a huge foreign name in the mismatch message is capped', () => {
  // `because` is echoed into every status response, and the name comes from a
  // file: a 400KB name sits under the byte ceiling and would ride along on
  // every five-second poll.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('bigname'), JSON.stringify({
    name: 'z'.repeat(400 * 1024), reportedAt: stamp, commitments: [],
  }));
  const got = c.read('bigname');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.ok(got.because.length < 200, `because was ${got.because.length} bytes`);
});

test('two commitments cannot share an id, because resolve removes by id', () => {
  // The bug this closes: report two things under one id, resolve the one that
  // finished, and the record comes back CLEAR with real work outstanding. Two
  // ordinary API calls, no error anywhere, and the restart dialog is told it is
  // safe to proceed. A confident false answer is the one thing this module
  // exists to prevent.
  assert.throws(() => c.report('leo', [
    { id: 'reply', what: 'reply to Josh about the DNS record' },
    { id: 'reply', what: 'reply to Splinter about the rollup' },
  ]), /its own id/, 'a duplicate id must be refused at the door');
});

test('a hand-written record with duplicate ids is refused rather than served', () => {
  // The door covers what we write; a record can still be edited by hand, and
  // serving one whose resolve() would remove two things is the same lie.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('dupfile'), JSON.stringify({
    name: 'dupfile', reportedAt: stamp,
    commitments: [
      { id: 'same', what: 'one', createdAt: stamp, source: 'agent' },
      { id: 'same', what: 'two', createdAt: stamp, source: 'agent' },
    ],
  }));
  const got = c.read('dupfile');
  assert.equal(got.state, c.STATE.UNKNOWN);
  assert.match(got.because, /two things under one id/);
});

test('a record missing createdAt is refused rather than served an invented one', () => {
  // The sibling clauses (id, source) were each pinned; this one was not. With
  // it removed, a commitment with no createdAt reads as holding and is served
  // the string "undefined", an invented value in the one module whose thesis is
  // that it never invents.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('nostamp'), JSON.stringify({
    name: 'nostamp', reportedAt: stamp,
    commitments: [{ id: 'a', what: 'real', source: 'agent' }],
  }));
  assert.equal(c.read('nostamp').state, c.STATE.UNKNOWN);
});

test('report() at its own caps writes a record its own reader accepts', () => {
  // Pins the RELATIONSHIP, not a number: whatever report() can write at its own
  // caps, read() must accept. A record written successfully and then refused by
  // its own reader leaves add() and resolve() throwing from then on, so the
  // agent cannot correct it through the module's own API.
  //
  // The fixture maxes EVERY field, not just `what`. An earlier version maxed
  // only `what`, measured 406,708 bytes, and on that basis I concluded the old
  // 512KB ceiling was fine and dismissed the finding. It was not fine: with
  // every field maxed the true figure is 525,708 bytes, which the old ceiling
  // did NOT clear. A weaker reproduction is how a real finding gets waved off.
  const six = String.fromCharCode(1); // serialises as \u0001, six bytes
  const many = Array.from({ length: c.MAX_COMMITMENTS }, (_, i) => ({
    // Unique prefix so ids stay distinct, then padded with six-byte characters.
    id: String(i).padStart(4, '0') + six.repeat(76),
    what: six.repeat(300),
    source: six.repeat(40),
    createdAt: '2026-01-01 ' + '('.repeat(14) + ')'.repeat(14),
  }));
  c.report('bigreal', many);

  const written = fs.statSync(c.recordPath('bigreal')).size;
  assert.ok(written < c.MAX_RECORD_BYTES,
    `report() wrote ${written} bytes, over its own ${c.MAX_RECORD_BYTES} ceiling`);

  const got = c.read('bigreal');
  assert.equal(got.state, c.STATE.HOLDING, `own reader refused own write: ${got.because}`);
  assert.equal(got.commitments.length, c.MAX_COMMITMENTS);
  assert.doesNotThrow(() => c.resolve('bigreal', got.commitments[0].id));
});

test('add and resolve preserve stored fields rather than re-sanitising them', () => {
  // read() deliberately serves an unparseable createdAt verbatim, because it
  // cannot know the real one. add() and resolve() re-ran the WRITE-path
  // sanitiser over the already-stored list, which rewrote it to `now` -- so the
  // never-invent rule held on the read path and was reversed by the convenience
  // API one call later.
  const stamp = new Date().toISOString();
  fs.writeFileSync(c.recordPath('preserve'), JSON.stringify({
    name: 'preserve', reportedAt: stamp,
    commitments: [{ id: 'a', what: 'existing', createdAt: 'not-a-date-at-all', source: 'agent' }],
  }));

  c.add('preserve', 'a new one');
  const after = c.read('preserve');
  assert.equal(after.commitments[0].createdAt, 'not-a-date-at-all',
    'add() rewrote a stored timestamp it could not know');
  assert.equal(after.commitments.length, 2);

  c.resolve('preserve', 'nonexistent');
  assert.equal(c.read('preserve').commitments[0].createdAt, 'not-a-date-at-all',
    'resolve() rewrote a stored timestamp it could not know');
});

test('a destroyed conversation is marked, not deleted', () => {
  // ⚠️ `markDestroyed` is what a clear or a restart leaves behind, and the
  // first version of it removed the record outright. That lost the only
  // surviving list of what had just been destroyed, and made `read` answer
  // "this agent has never reported what it is holding" — which is false. It
  // reported. We deleted it.
  //
  // The state must be `unknown` (the agent cannot correct this record, because
  // we deleted the conversation it would speak from), and the items must
  // survive so the board can still say what was lost.
  const agent = 'tombstoned';
  c.report(agent, [
    { what: 'Rewriting the feed parser for #48' },
    { what: 'Verify the 14:00 sweep settled' },
  ]);
  assert.equal(c.read(agent).state, c.STATE.HOLDING);

  assert.equal(c.markDestroyed(agent), true);

  const after = c.read(agent);
  assert.equal(after.state, c.STATE.UNKNOWN, 'a destroyed record still read as confident');
  assert.equal(after.commitments.length, 2, 'the record of what was lost was deleted');
  assert.match(after.because, /cleared its conversation/);
  assert.doesNotMatch(after.because, /never reported/,
    'claimed the agent never reported what we ourselves deleted');
  assert.ok(after.destroyedAt, 'no record of when we destroyed it');
});

test('marking a record we cannot read is not a failure worth surfacing', () => {
  assert.equal(c.markDestroyed('an-agent-with-no-record-at-all'), false);
});

test('a malformed record cannot crash the tombstone after the action has fired', () => {
  // ⚠️ This threw a raw TypeError on a record containing `null`, AFTER the
  // clear had already been sent. The operator was shown "Cannot set properties
  // of null" and told the action failed, while the conversation was in fact
  // destroyed and the record left un-tombstoned. `parseRecord` guards this
  // exact shape five functions above; the new code did not.
  const agent = 'malformedtomb';
  c.report(agent, [{ what: 'something worth not losing here' }]);
  for (const junk of ['null', '5', '"hi"', 'true', '[]', 'not json at all']) {
    fs.writeFileSync(c.recordPath(agent), junk);
    let got;
    assert.doesNotThrow(() => { got = c.markDestroyed(agent); }, `threw on ${junk}`);
    assert.equal(got, false, `${junk} reported as successfully marked`);
  }
});

test('a tombstone is never stamped on a record belonging to another agent', () => {
  // ⚠️ `parseRecord` refuses a record whose stored `name` is not the agent being
  // asked about, because `safeKey` maps several spellings onto one file and two
  // agents could collide on it (`mybot` / `my.bot`, documented on
  // `server.js:knownAgent`). `markDestroyed` carried a comment claiming it
  // applied "every guard parseRecord applies" and was missing this one.
  //
  // The consequence is the worst available: `read()` refuses the record, so the
  // dialog shows nothing and the route computes `hadRecord` as false — and then
  // the tombstone is written anyway, putting "your conversation was destroyed"
  // into ANOTHER agent's record. In a store whose only job is being the honest
  // account of what was lost, that is a fabricated loss.
  //
  // Deleting the `raw.name !== String(agent)` line in markDestroyed fails here.
  const agent = 'tombowner';
  c.report(agent, [{ what: 'work that belongs to somebody else entirely' }]);

  const onDisk = JSON.parse(fs.readFileSync(c.recordPath(agent), 'utf8'));
  onDisk.name = 'a-completely-different-agent';
  fs.writeFileSync(c.recordPath(agent), JSON.stringify(onDisk, null, 2));

  // Precondition: the reader already refuses it, which is what makes the
  // missing guard invisible from the outside.
  assert.equal(c.read(agent).state, c.STATE.UNKNOWN);

  assert.equal(c.markDestroyed(agent), false, 'stamped a tombstone on a foreign record');
  const after = JSON.parse(fs.readFileSync(c.recordPath(agent), 'utf8'));
  assert.equal(after.destroyedAt, undefined, 'a destruction we never performed was recorded');
  assert.equal(after.name, 'a-completely-different-agent', 'the foreign record was rewritten');
});

test('adding to a destroyed record does not re-publish what we destroyed', () => {
  // ⚠️ `add()` and `resolve()` route through the same writer, which did not
  // carry `destroyedAt`. So a single add erased the tombstone and brought the
  // destroyed commitments back at FULL confidence: laundering through the
  // module's own convenience API, undoing the one honesty guarantee
  // `markDestroyed` exists to provide.
  const agent = 'tomblaunder';
  c.report(agent, [{ what: 'the thing that was destroyed with the conversation' }]);
  c.markDestroyed(agent);
  assert.equal(c.read(agent).state, c.STATE.UNKNOWN);

  c.add(agent, 'a brand new thing said after the clear');
  const after = c.read(agent);
  assert.equal(after.state, c.STATE.UNKNOWN,
    'a destroyed record was re-published as confident by an add');
  assert.ok(after.destroyedAt, 'the tombstone was erased');

  // ⚠️ And the destroyed items are NOT carried alongside the new one.
  //
  // `preserveDestroyed` stopped the tombstone being laundered away, and created
  // the inverse: the post-clear item was MERGED into the destroyed list, so the
  // two became indistinguishable and `read()` said "we cleared its conversation,
  // so it can no longer tell us what it was holding" over a commitment made
  // after the clear. The record could never recover.
  //
  // The tombstone stays (only `report` is the agent re-asserting what it
  // holds), but the destroyed items do not come back.
  assert.deepEqual(after.commitments.map((x) => x.what), ['a brand new thing said after the clear'],
    'destroyed work was re-listed alongside a commitment made after the clear');

  // But the agent SPEAKING for itself is exactly what should clear it.
  c.report(agent, [{ what: 'what I am actually holding now that I am back' }]);
  assert.equal(c.read(agent).state, c.STATE.HOLDING,
    'a fresh report from the agent did not clear the tombstone');
});
