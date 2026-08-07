'use strict';

/**
 * Routing tests.
 *
 * These exist because of one bug, and the bug is worth stating so nobody
 * removes them later as redundant.
 *
 * Routes were matched against `req.url`, which includes the query string. An
 * anchored pattern therefore stopped matching the moment a caller appended
 * anything, the request fell past every route to the catch-all, and the server
 * answered with the HTML page at status 200. Nothing errored anywhere.
 *
 * The detail page cache-busts its avatar with `?t=<now>` so a freshly uploaded
 * picture shows up immediately -- so **the query string added to make the
 * avatar appear was the exact reason it never appeared**. The card grid, which
 * requests the same avatar with no query string, rendered it correctly. That
 * split is why three people spent an afternoon on image formats.
 *
 * These drive the real server. A unit test on the path-parsing helper would
 * have passed against the broken code, because the helper was never the broken
 * part -- the routes around it were.
 *
 *   node --test server.test.js
 */

process.env.PORT = '0'; // let the OS pick, so tests never collide with a real board

const test = require('node:test');
const assert = require('node:assert/strict');
const { server, pathOf } = require('./server');

const ready = new Promise((resolve) => {
  if (server.listening) return resolve();
  server.once('listening', resolve);
});

async function get(path) {
  await ready;
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}

test.after(() => server.close());

// ---------------------------------------------------------------------------
// The bug itself
// ---------------------------------------------------------------------------

test('a query string does not change which handler answers', async () => {
  // The regression test. Before the fix this returned the HTML page at 200.
  const plain = await get('/api/status');
  const busted = await get('/api/status?t=123456');

  assert.match(plain.type, /application\/json/);
  assert.match(busted.type, /application\/json/,
    'a query string sent /api/status to the catch-all and returned the page');
  assert.equal(busted.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(busted.body)).sort(),
    Object.keys(JSON.parse(plain.body)).sort());
});

test('an API route never answers with HTML', async () => {
  // The shape of the failure matters more than any single route: the caller
  // asked for data and got a web page, with a success status attached.
  for (const path of ['/api/status', '/api/status?t=1', '/api/status?a=b&c=d']) {
    const res = await get(path);
    assert.ok(!res.type.includes('text/html'), `${path} answered with the page`);
  }
});

test('an unknown agent avatar still 404s with a query string attached', async () => {
  // Before the fix this was a 200 and the HTML page, which is indistinguishable
  // from success to an <img> tag -- it just renders broken.
  const res = await get('/api/agent/definitely-not-an-agent/avatar?t=99');
  assert.equal(res.status, 404);
  assert.ok(!res.type.includes('text/html'));
});

// ---------------------------------------------------------------------------
// The catch-all still works
// ---------------------------------------------------------------------------

test('a non-API path still serves the page, with or without a query string', async () => {
  for (const path of ['/', '/anything', '/?limit=2']) {
    const res = await get(path);
    assert.equal(res.status, 200);
    assert.match(res.type, /text\/html/, `${path} should still serve the page`);
  }
});

test('the page is what the board loads with ?limit, which the UI uses for small-fleet testing', async () => {
  const res = await get('/?limit=2');
  assert.match(res.body, /<title>/);
});

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

test('pathOf strips the query string and survives junk', () => {
  assert.equal(pathOf({ url: '/api/status' }), '/api/status');
  assert.equal(pathOf({ url: '/api/status?t=1' }), '/api/status');
  assert.equal(pathOf({ url: '/api/agent/angel/avatar?t=1&x=2' }), '/api/agent/angel/avatar');
  // A fragment never reaches a server, but not crashing on one is free.
  assert.equal(pathOf({ url: '/api/status#frag' }), '/api/status');
  assert.equal(pathOf({ url: undefined }), '/');
  assert.equal(pathOf({}), '/');
});

test('pathOf does not let a query string smuggle in a different path', () => {
  // ?/../ and friends live in the query, so they must not affect the pathname.
  assert.equal(pathOf({ url: '/api/status?next=/api/agent/x/avatar' }), '/api/status');
  assert.equal(pathOf({ url: '/api/status?../../etc/passwd' }), '/api/status');
});
