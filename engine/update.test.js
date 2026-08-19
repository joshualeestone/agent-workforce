const test = require('node:test');
const assert = require('node:assert/strict');
const update = require('./update');
const { version: RUNNING } = require('../package.json');

test.beforeEach(() => { update.resetCache(); update.setFetcher(null); update.setBase(null); });

test('newer(): strictly numeric dotted-triple, and unknown loses', () => {
  assert.equal(update.newer('0.1.1', '0.1.0'), true);
  assert.equal(update.newer('0.2.0', '0.1.9'), true);
  assert.equal(update.newer('1.0.0', '0.9.9'), true);
  assert.equal(update.newer('0.1.0', '0.1.0'), false);
  assert.equal(update.newer('0.1.0', '0.1.1'), false);
  // ⚠️ Unknown NEVER wins: a corrupted manifest cannot pop a toast.
  assert.equal(update.newer('banana', '0.0.0'), false);
  assert.equal(update.newer('0.2', '0.1.0'), false);
  assert.equal(update.newer('0.1.1-rc1', '0.1.0'), false);
  assert.equal(update.newer('', '0.1.0'), false);
  assert.equal(update.newer('1e3.0.0', '0.1.0'), false);
});

test('available() reports a newer published version, and only a newer one', async () => {
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  await update.refresh();
  assert.deepEqual(update.available(), { version: '99.0.0' });

  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.available(), null, 'the running version showed as an update');

  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '0.0.1' }) }));
  await update.refresh();
  assert.equal(update.available(), null, 'an OLDER published version showed as an update');
});

test('every failure is soft: no network, bad status, bad JSON, bad shape', async () => {
  for (const [label, f] of [
    ['a thrown fetch', async () => { throw new Error('offline'); }],
    ['a non-ok response', async () => ({ ok: false, json: async () => ({}) })],
    ['unparseable JSON', async () => ({ ok: true, json: async () => { throw new Error('nope'); } })],
    ['a version that is not a string', async () => ({ ok: true, json: async () => ({ version: 42 }) })],
    ['a malformed version string', async () => ({ ok: true, json: async () => ({ version: 'latest' }) })],
  ]) {
    update.resetCache();
    update.setFetcher(f);
    await update.refresh().catch(() => { /* the thrown-fetch case */ });
    assert.equal(update.available(), null, `${label} produced an update notice`);
  }
});

test('a down host is asked once per cache window, not once per status tick', async () => {
  let calls = 0;
  update.setFetcher(async () => { calls += 1; return { ok: false, json: async () => ({}) }; });
  await update.refresh();
  // poke() must see the fresh (miss) cache and not fetch again.
  update.poke();
  update.poke();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 1, 'poke() re-fetched inside the cache window');

  // ⚠️ And a host that THROWS (offline, DNS, abort), not just one that
  // answers badly: the attempt stamp used to sit after the await, so a
  // rejecting fetch never stamped and the five-second status poll asked a
  // dead host forever.
  update.resetCache();
  let throws = 0;
  update.setFetcher(async () => { throws += 1; throw new Error('offline'); });
  await update.refresh().catch(() => { });
  update.poke();
  update.poke();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(throws, 1, 'a throwing fetch is retried inside the cache window');
});

/* ---------------------------------------------------------------------------
 * update-control: reachability, checkNow, and the 15-minute TTL.
 * ------------------------------------------------------------------------ */

test('the check interval is fifteen minutes, not six hours', () => {
  // Pinned as a value because it is a PROMISE made in-channel: a release
  // reaches every running app within the quarter hour.
  const src = require('node:fs').readFileSync(require.resolve('./update'), 'utf8');
  assert.ok(src.includes('const TTL = 15 * 60 * 1000;'),
    'the TTL drifted from the promised fifteen minutes');
});

test('reachability is its own fact: could-not-reach never reads as up-to-date', async () => {
  // Never looked: not reached.
  assert.deepEqual(update.lastLook().reached, false);
  // A look that got an answer (even "nothing newer") is reached.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.lastLook().reached, true, 'a successful look did not read as reached');
  assert.equal(update.available(), null, 'CONTROL: no offer, which is exactly the up-to-date case');
  // The next look fails: reached flips false even though a cached answer exists.
  update.setFetcher(async () => { throw new Error('offline'); });
  await update.refresh().catch(() => {});
  assert.equal(update.lastLook().reached, false,
    'an unreachable host still read as reached (would render "up to date" while offline)');
});

test('checkNow bypasses the TTL and answers fresh, with reachability', async () => {
  // Prime the cache with a fresh successful look...
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.lastLook().reached, true);
  // ...then change the world: poke() would sit on the TTL, checkNow asks anyway.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.poke();
  assert.equal(update.available(), null,
    'CONTROL: poke inside the TTL refreshed anyway, so checkNow proves nothing');
  const out = await update.checkNow();
  assert.deepEqual(out, { running: RUNNING, latest: '99.0.0', reached: true });
  assert.deepEqual(update.available(), { version: '99.0.0' },
    'the fresh answer did not land in the cache the toast reads');
  // And a checkNow that cannot reach says so rather than throwing.
  update.setFetcher(async () => { throw new Error('offline'); });
  const down = await update.checkNow();
  assert.equal(down.reached, false);
  assert.equal(down.running, RUNNING, 'the running version vanished from an unreachable answer');
});
