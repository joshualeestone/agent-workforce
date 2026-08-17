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
});
