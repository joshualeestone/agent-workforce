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
 * These drive the real server. A unit test on the path helper would have passed
 * against the broken code, because the helper was never the broken part -- the
 * routes around it were.
 *
 * Assertions here check the **content type**, not the status, wherever they
 * can. Routing is the property under test, and `/api/status` runs the real
 * status engine, which shells out to tmux; if that engine fails the endpoint
 * answers 500 *as JSON*, which is still correct routing. Asserting on status
 * would make these fail for reasons that have nothing to do with routing.
 *
 *   node --test server.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, pathOf, decodeSegment } = require('./server');

let base;
test.before(async () => {
  await start(0); // 0 = let the OS pick, so tests never collide with a real board
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  // fetch keeps sockets warm, and close() waits for them. Without this the
  // suite can hang on a slower dispatcher even though every test has passed.
  server.closeAllConnections();
  server.close();
});

async function req(path, options) {
  const res = await fetch(base + path, options);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}

// ---------------------------------------------------------------------------
// The routing bug itself
// ---------------------------------------------------------------------------

test('a query string does not change which handler answers', async () => {
  // The regression test. Before the fix this returned the HTML page at 200.
  const plain = await req('/api/status');
  const busted = await req('/api/status?t=123456');

  assert.match(plain.type, /application\/json/);
  assert.match(busted.type, /application\/json/,
    'a query string sent /api/status to the catch-all and returned the page');
  assert.equal(busted.status, plain.status,
    'the same path should get the same answer with or without a query string');
});

test('an API route never answers with HTML, whatever the query string or method', async () => {
  // The shape of the failure matters more than any single route: the caller
  // asked for data and got a web page, with a success status attached.
  //
  // A query string was one way to fall through to the page. An unhandled
  // METHOD is another with the identical signature -- PATCH on an avatar
  // matched no guard and returned the index at 200 -- so both axes are pinned
  // here. An earlier version of this test only tried query strings and passed
  // while the method axis was wide open.
  const cases = [
    ['/api/status', undefined],
    ['/api/status?t=1', undefined],
    ['/api/status?a=b&c=d', undefined],
    ['/api/agent/angel/avatar', { method: 'PATCH' }],
    ['/api/agent/angel/profile', { method: 'POST' }],
    ['/api/agent/angel/profile?t=1', { method: 'GET' }],
    ['/api/nonsense', undefined],
  ];
  for (const [path, options] of cases) {
    const res = await req(path, options);
    assert.ok(!res.type.includes('text/html'),
      `${options ? options.method + ' ' : ''}${path} answered with the page`);
  }
});

test('an unknown agent avatar still 404s with a query string attached', async () => {
  // Before the fix this was a 200 and the HTML page, which is indistinguishable
  // from success to an <img> tag -- it just renders broken.
  const res = await req('/api/agent/definitely-not-an-agent/avatar?t=99');
  assert.equal(res.status, 404);
  assert.ok(!res.type.includes('text/html'));
});

test('the profile route is reached with a query string attached', async () => {
  // The third route this change touched, and the one with no coverage before.
  // Pre-fix this answered 200 text/html; a caller PUTting JSON would have had
  // its write silently swallowed by the page handler.
  const res = await req('/api/agent/definitely-not-an-agent/profile?t=1',
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"role":"x"}' });
  assert.equal(res.status, 404, 'should reach the route and be refused as an unknown agent');
  assert.match(res.type, /application\/json/);
});

// ---------------------------------------------------------------------------
// A malformed name must not take the process down
// ---------------------------------------------------------------------------

test('a stray percent in an agent name does not crash the server', async () => {
  // `decodeURIComponent('%')` throws, and a throw in the request handler is an
  // uncaught exception that kills the process. One unauthenticated GET was
  // enough. Routing on the pathname WIDENED this: pre-fix the query-string form
  // did not match the route at all, so only the bare form crashed.
  for (const path of ['/api/agent/%/avatar', '/api/agent/%/avatar?t=1', '/api/agent/%zz/avatar']) {
    const res = await req(path);
    assert.equal(res.status, 404, `${path} should be refused`);
  }
  // The assertion that matters: still answering afterwards.
  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'server died on a malformed agent name');
});

test('a malformed name is refused on the write routes too, without crashing', async () => {
  const put = await req('/api/agent/%/avatar', { method: 'PUT', body: 'x' });
  assert.equal(put.status, 400);
  const prof = await req('/api/agent/%/profile',
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(prof.status, 400);

  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'server died on a malformed agent name');
});

// ---------------------------------------------------------------------------
// The catch-all still works
// ---------------------------------------------------------------------------

test('an existing avatar is served with the cache-buster the detail page actually sends', async () => {
  // The positive half of the bug: an avatar that exists, asked for with
  // `?t=<now>` -- the exact request the detail page makes, and the one that
  // returned the HTML page before the fix.
  //
  // Uses a fixture rather than whatever the live fleet happens to have. An
  // earlier version read the real board and skipped when no agent had an
  // avatar, which meant the branch's own user-visible symptom went unexercised
  // on any clean machine while the suite still reported green.
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const store = require('./engine/store');

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-avatar-'));
  const fixture = nodePath.join(dir, 'fixture.png');
  fs.writeFileSync(fixture, PNG);

  const original = store.avatarPath;
  store.avatarPath = () => fixture;
  try {
    const bare = await fetch(`${base}/api/agent/angel/avatar`);
    const busted = await fetch(`${base}/api/agent/angel/avatar?t=${Date.now()}`);

    assert.match(bare.headers.get('content-type') || '', /^image\/png/);
    assert.match(busted.headers.get('content-type') || '', /^image\/png/,
      'the cache-busted form returned the page instead of the image');

    // Compare bytes. Decoding binary as UTF-8 and comparing lengths would let
    // two different mojibake strings of equal length pass.
    const a = Buffer.from(await bare.arrayBuffer());
    const b = Buffer.from(await busted.arrayBuffer());
    assert.deepEqual(b, a);
    assert.deepEqual(b, PNG);
  } finally {
    store.avatarPath = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-API path still serves the page, with or without a query string', async () => {
  // `?limit=2` is what the board itself uses to test small fleets.
  for (const path of ['/', '/anything', '/?limit=2']) {
    const res = await req(path);
    assert.equal(res.status, 200);
    assert.match(res.type, /text\/html/, `${path} should still serve the page`);
  }
});

// ---------------------------------------------------------------------------
// The parsers
// ---------------------------------------------------------------------------

test('pathOf strips the query string and survives junk', () => {
  assert.equal(pathOf({ url: '/api/status' }), '/api/status');
  assert.equal(pathOf({ url: '/api/status?t=1' }), '/api/status');
  assert.equal(pathOf({ url: '/api/agent/angel/avatar?t=1&x=2' }), '/api/agent/angel/avatar');
  // A fragment never reaches a server, but not crashing on one is free.
  assert.equal(pathOf({ url: '/api/status#frag' }), '/api/status');
  assert.equal(pathOf({ url: undefined }), null);
  assert.equal(pathOf({}), null);
  assert.equal(pathOf(null), null);
});

test('pathOf does not let a query string smuggle in a different path', () => {
  assert.equal(pathOf({ url: '/api/status?next=/api/agent/x/avatar' }), '/api/status');
  assert.equal(pathOf({ url: '/api/status?../../etc/passwd' }), '/api/status');
});

test('pathOf refuses targets carrying an authority rather than discarding the host', () => {
  // `new URL('//evil.example/api/status', base)` yields pathname '/api/status'
  // with the host quietly dropped, which would route an off-origin-looking
  // target straight into the status handler.
  // null, not '/': an unplaceable target is a request that was not for us,
  // which is a different answer from "unknown page, show the index".
  assert.equal(pathOf({ url: '//evil.example/api/status' }), null);
  assert.equal(pathOf({ url: 'http://other.example/api/status' }), null);
  assert.equal(pathOf({ url: '//api/status' }), null);
});

test('pathOf is not fooled by a backslash, which the URL parser treats as a slash', () => {
  // The first version of the guard was `raw.startsWith('//')`, and these got
  // past it: the parser normalises `\` to `/` for http, so each of these is
  // authority-form while looking like an ordinary absolute path. Each resolved
  // to host `evil.example` and pathname `/api/status`, and the test written
  // alongside that guard passed anyway because it only tried the `//` spelling.
  // Kept as its own case because it is the one a syntactic check gets wrong.
  assert.equal(pathOf({ url: '/\\evil.example/api/status' }), null);
  assert.equal(pathOf({ url: '/\\/evil.example/api/status' }), null);
  assert.equal(pathOf({ url: '\\\\evil.example/api/status' }), null);
});

test('decodeSegment returns null on a malformed escape rather than throwing', () => {
  assert.equal(decodeSegment('angel'), 'angel');
  assert.equal(decodeSegment('casey%20jones'), 'casey jones');
  assert.equal(decodeSegment('%'), null);
  assert.equal(decodeSegment('%zz'), null);
  assert.equal(decodeSegment('%E0%A4%A'), null, 'a truncated escape is malformed');
});

// ---------------------------------------------------------------------------
// A file that vanishes between being found and being opened
// ---------------------------------------------------------------------------

test('an avatar that disappears mid-request answers 404, not an empty 200', async () => {
  // Two failures live here. The first is a crash: `pipe` does not forward the
  // source's errors, so an unhandled 'error' event killed the process.
  //
  // The second is subtler and was introduced by the obvious fix. Writing the
  // 200 header first and catching the error afterwards stops the crash, but the
  // headers are already committed, so the caller gets a success status and an
  // empty body -- a picture that is not there, reported as fine, rendering as a
  // broken image. That is the exact symptom this branch exists to remove, so
  // "it no longer crashes" is not the bar.
  const store = require('./engine/store');
  const original = store.avatarPath;
  store.avatarPath = () => '/tmp/definitely-not-a-real-avatar-' + Date.now() + '.png';
  try {
    const res = await req('/api/agent/angel/avatar?t=1');
    assert.equal(res.status, 404, 'a missing file must not answer 200');
    assert.match(res.type, /application\/json/, 'API errors carry a readable message, not an empty body');
  } finally {
    store.avatarPath = original;
  }

  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'server died on a vanished avatar file');
});

test('a target carrying a foreign authority is refused, not answered with the page', async () => {
  // Absolute-form is legal on the wire and Node passes it through verbatim, so
  // a proxy in front of this port can send it. Answering it with the index at
  // 200 is the same silent-success shape as the query-string bug: the caller
  // asked for an API and got a web page that looks like success.
  const res = await fetch(`${base}/api/status`, { headers: { 'x-probe': '1' } });
  assert.equal(res.status, 200); // sanity: the normal path still works

  const net = require('node:net');
  const raw = await new Promise((resolve) => {
    const sock = net.connect(server.address().port, '127.0.0.1', () => {
      sock.write('GET http://evil.example/api/status HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    });
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve(buf));
  });
  assert.match(raw, /^HTTP\/1\.1 400 /, 'absolute-form with a foreign host should be refused');
  assert.ok(!raw.includes('<!doctype html>'), 'answered an API path with the page');
});

test('a directory in the avatar store answers 404, not an empty 200', async () => {
  // `open` succeeding is not proof the read will. A directory opens fine and
  // fails on the first read, which lands after the 200 header is committed --
  // so the caller gets a success status and a zero-byte picture, the exact
  // broken-image symptom this branch removes. store.avatarPath prefix-scans the
  // directory and returns any matching entry, directories included.
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const store = require('./engine/store');

  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-notafile-'));
  const asDir = nodePath.join(dir, 'angel.png');
  fs.mkdirSync(asDir);

  const original = store.avatarPath;
  store.avatarPath = () => asDir;
  try {
    const res = await req('/api/agent/angel/avatar?t=1');
    assert.equal(res.status, 404, 'a directory must not be served as a picture');
    assert.ok(!res.type.includes('image/'), 'answered with an image content-type for a directory');
  } finally {
    store.avatarPath = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Spellings a syntactic check gets wrong
// ---------------------------------------------------------------------------

test('an encoded slash cannot smuggle an API path past the guard into the page', async () => {
  // `/api%2fstatus` does not start with `/api/` as a string, so an un-decoded
  // check let it through to the catch-all and answered a web page at 200 --
  // the same invariant, failing on the one spelling the obvious check misses.
  for (const path of ['/api%2fstatus', '/api%2Fstatus', '/api%2fagent/x/avatar']) {
    const res = await req(path);
    assert.ok(!res.type.includes('text/html'), `${path} answered with the page`);
  }
});

test('absolute-form naming this server is routed, not refused', async () => {
  // What a proxy in front of this port actually sends. An earlier guard
  // rejected anything not starting with '/', which threw absolute-form out
  // before the loopback check could see it, making that check dead code.
  const net = require('node:net');
  const ask = (target) => new Promise((resolve) => {
    const sock = net.connect(server.address().port, '127.0.0.1', () => {
      sock.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve(buf));
  });

  const port = server.address().port;
  for (const target of [`http://127.0.0.1:${port}/api/status`, `http://localhost:${port}/api/status`]) {
    const raw = await ask(target);
    assert.match(raw, /^HTTP\/1\.1 200 /, `${target} should be routed`);
    assert.match(raw, /application\/json/);
  }
  // Still refused when the authority is not us.
  assert.match(await ask('http://evil.example/api/status'), /^HTTP\/1\.1 400 /);
});

test('HEAD still works on the routes that answer GET', async () => {
  // Adding a method guard plus the /api catch-all turned a working HEAD into a
  // 404. Node suppresses the body for HEAD on its own; the route just has to
  // let it through.
  const res = await req('/api/status', { method: 'HEAD' });
  assert.notEqual(res.status, 404, 'HEAD on a GET route should not 404');
  assert.match(res.type, /application\/json/);
});

test('a zero-byte avatar answers 404 rather than a clean 200 with nothing in it', async () => {
  // saveAvatar writes non-atomically, so an interrupted save leaves a real file
  // of zero length: a perfectly good file and a perfectly useless picture. It
  // passed the is-a-file gate and answered 200 with content-length 0, which is
  // the broken-image-reported-as-fine symptom this branch exists to remove.
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const store = require('./engine/store');

  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-empty-'));
  const empty = nodePath.join(dir, 'angel.png');
  fs.writeFileSync(empty, '');

  const original = store.avatarPath;
  store.avatarPath = () => empty;
  try {
    const res = await req('/api/agent/angel/avatar?t=1');
    assert.equal(res.status, 404);
    assert.ok(!res.type.includes('image/'));
  } finally {
    store.avatarPath = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an avatar that cannot be opened answers 404 rather than crashing', async () => {
  // Reaches `stream.once('error')`: the file passes stat (a real, non-empty,
  // regular file) and then fails to open because it is unreadable. Without the
  // listener this is an unhandled 'error' event that exits the process.
  //
  // ⚠️ What this does NOT cover is a read that fails AFTER the header is
  // committed -- the `pipeline` callback's `res.destroy()`. Producing that
  // portably needs a file whose open succeeds and whose read fails, which an
  // ordinary filesystem will not give you. Saying so plainly beats a test that
  // looks like it covers the path and does not; an earlier version of this test
  // used a directory, which the stat gate rejects before the stream is ever
  // created, so it asserted nothing while claiming to pin the whole rewrite.
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const store = require('./engine/store');

  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-unreadable-'));
  const target = nodePath.join(dir, 'angel.png');
  fs.writeFileSync(target, Buffer.alloc(64, 1));
  fs.chmodSync(target, 0o000);

  const original = store.avatarPath;
  store.avatarPath = () => target;
  try {
    const res = await req('/api/agent/angel/avatar?t=1');
    // Root can read a 000 file, so skip the assertion rather than fail there.
    if (process.getuid && process.getuid() !== 0) {
      assert.equal(res.status, 404, 'an unreadable file must not answer 200');
      assert.ok(!res.type.includes('image/'));
    }
  } finally {
    store.avatarPath = original;
    fs.chmodSync(target, 0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'server died on an unreadable avatar');
});

test('an avatar response carries no content-length, so a short read cannot desync the connection', async () => {
  // content-length would have to come from the stat while the bytes come from a
  // separate read. saveAvatar writes non-atomically, so a stat that
  // under-reports gives a clean 200 truncated to the declared length AND puts
  // the surplus bytes on the wire afterwards, which desyncs a keep-alive
  // connection into the next response.
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const store = require('./engine/store');

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-nolen-'));
  const fixture = nodePath.join(dir, 'angel.png');
  fs.writeFileSync(fixture, PNG);

  const original = store.avatarPath;
  store.avatarPath = () => fixture;
  try {
    const res = await fetch(`${base}/api/agent/angel/avatar?t=1`);
    assert.equal(res.headers.get('content-length'), null,
      'a length taken from stat cannot be trusted to match the bytes actually read');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  } finally {
    store.avatarPath = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
