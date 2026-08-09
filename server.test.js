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

// Sandbox the real stores BEFORE requiring the server: both modules read their
// root at module load.
//
// ⚠️ There are THREE real roots behind this server, and these two variables
// cover two of them.
//
//   1. `AGENT_WORKFORCE_DATA`  -> the commitment store. Sandboxed here.
//   2. `AGENT_WORKFORCE_WORKERS` -> the instruction files, `~/work/workers/
//      <agent>/CLAUDE.md`. Sandboxed here. These are the LIVE files that the
//      working agents boot from, so a stray PUT does not corrupt test data, it
//      changes how a real agent behaves the next time it starts. The route
//      tests below deliberately drive PUT with a real agent's name, and before
//      this line the only thing standing between them and those files was the
//      handler's `typeof text !== 'string'` check. One test with a valid string
//      would have rewritten a colleague's instructions.
//
//      ⚠️ This variable only covered the instruction read and write when it was
//      first added. `status.js` had its own hardcoded copy of the same path for
//      `readIdentity`, so `snapshot()` kept reading the real files while this
//      comment said they were sandboxed. Reads only, nothing was corrupted, but
//      the comment was the thing a future author would trust before deciding a
//      write was safe. Both modules now read this one variable.
//   3. `store.ROOT` -> avatars and profiles. NOT sandboxed, no variable for it.
//      That is why no test here sends a PUT or DELETE to an avatar or profile
//      route, and why any test that does must sandbox it first. A reviewer once
//      deleted a real avatar by assuming one variable covered everything.
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-workers-'));
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;

//   4. tmux and launchd. There is NO variable that can relocate those: they are
//      global to the machine, and this machine has thirteen live agents. The
//      fresh-start routes below drive `tmux send-keys` and `restart-bot.sh`
//      against whatever the live roster says, so a test that reached them for
//      real would clear or restart a colleague mid-work.
//
//      ⚠️ `AGENT_WORKFORCE_DRY_RUN` is what stands in for a sandbox here, and it
//      is set for this ENTIRE FILE rather than per test. `node --test` runs each
//      test file in its own process, so this cannot leak into
//      `engine/lifecycle.test.js`, which needs the real behaviour to test it.
//
//      This is not hypothetical caution: probing these routes by hand typed
//      `/compact` into a live agent's composer, and that agent was the session
//      doing the work. One of the tests below posts a valid confirmation token,
//      and without this line it would have done the same thing on every run.
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

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
  // Every run otherwise leaks a temp directory: SANDBOX holds commitment
  // records under real agent names, WORKERS holds the instruction files the
  // route tests write. Both, not just the first: WORKERS was added later and
  // the cleanup was not extended with it.
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.rmSync(WORKERS, { recursive: true, force: true });
});

/**
 * An agent name the write routes will accept, or null with a VISIBLE skip.
 *
 * `knownAgent()` guards the write routes and `server.js` destructures
 * `snapshot()` at import, so the roster cannot be stubbed from here. That makes
 * these two tests dependent on live tmux state, which is worth saying out loud
 * rather than papering over: a silent early return prints a tick for a test
 * that asserted nothing, and a hard failure makes the suite unrunnable on CI.
 */
async function anyAgent(t) {
  const board = await req('/api/status');
  if (!board.type.includes('application/json')) {
    t.skip('the status engine did not return a board on this machine');
    return null;
  }
  const agents = JSON.parse(board.body).agents || [];
  if (!agents.length) {
    t.skip('no live agents on this machine, so the write routes cannot be exercised');
    return null;
  }
  return encodeURIComponent(agents[0].sessionName);
}

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

test('a request claiming a non-loopback Host is refused', async () => {
  // ⚠️ DNS rebinding. The routing check inspects the request TARGET; this
  // inspects what the client thinks it is talking to, and they are different
  // questions. Without it the server answers `Host: evil.example.com` with the
  // full agent roster, which means a page on another site whose DNS is then
  // pointed at 127.0.0.1 becomes same-origin with this server: no CORS
  // preflight, the response readable, and every write route reachable.
  //
  // The gap predates this branch and was survivable while the writes were an
  // avatar and a job title. It is not survivable now that the same hole rewrites
  // the file an agent boots from.
  // ⚠️ Driven with `node:http`, NOT `fetch`. `Host` is a forbidden header name,
  // so fetch silently drops it and the request goes out with the real host: a
  // version of this test written with `fetch` passes against a server that has
  // no check at all, which is the "test that pins nothing" shape exactly.
  const raw = (host) => new Promise((resolve, reject) => {
    const r = require('node:http').request({
      host: '127.0.0.1', port: server.address().port, path: '/api/status',
      method: 'GET', headers: { Host: host },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    r.on('error', reject);
    r.end();
  });

  const evil = await raw('evil.example.com');
  assert.equal(evil.status, 400, 'a rebound host was served the agent roster');
  assert.ok(!evil.body.includes('sessionName'), 'the roster leaked in the refusal');

  // Every spelling of loopback still works, and the PORT is deliberately not
  // compared: a proxy in front of this process legitimately names another one.
  //
  // The trailing dot and the case are load-bearing rather than tidiness: a
  // browser will send `localhost.`, and `Host` is case-insensitive, so without
  // the normalisation the guard refuses the operator's own board.
  for (const host of ['localhost:1', '127.0.0.1:65535', '[::1]:4317',
    'localhost.', 'LOCALHOST', 'LocalHost:4317', '127.0.0.1.']) {
    const ok = await raw(host);
    assert.notEqual(ok.status, 400, `${host} should still be routed`);
  }
});

test('the allowlist opt-in is reachable, and tolerant of how it is written', async () => {
  // ⚠️ Drives a REAL server in a child process with the variable set, rather
  // than asserting on `server.js` source text.
  //
  // The first version of this test regex-matched the shipped source, and it was
  // inverted in both directions: deleting the case and trailing-dot handling (a
  // real regression, an operator's `Board.Local` entry silently stops matching)
  // left it green, while rewriting the same regex as an equivalent `/:[0-9]+$/`
  // (no behaviour change at all) turned it red. It failed on harmless refactors
  // and passed on the regression it was named for, which is the "test that pins
  // nothing" shape this whole suite is written against, committed while adding
  // the guard it was supposed to pin.
  //
  // The excuse was that the allowlist is read at module load so a running
  // server cannot be asked about it. A child process with the environment set
  // is the answer, and `engine/instructions.test.js` already does exactly this.
  const probe = `
    process.env.AGENT_WORKFORCE_ALLOWED_HOSTS = ' Board.Local , proxy.example.com:8443 , Dotted.Example. ';
    process.env.AGENT_WORKFORCE_DATA = ${JSON.stringify(SANDBOX)};
    process.env.AGENT_WORKFORCE_WORKERS = ${JSON.stringify(WORKERS)};
    const http = require('node:http');
    const { start, server } = require(${JSON.stringify(nodePath.join(__dirname, 'server.js'))});
    const ask = (host) => new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: server.address().port,
        path: '/api/status', headers: { Host: host } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('error', reject); r.end();
    });
    start(0).then(async () => {
      const out = {};
      for (const h of ['board.local', 'BOARD.local:9', 'board.local.',
                       'proxy.example.com:8443', 'proxy.example.com',
                       'dotted.example', 'dotted.example.',
                       'evil.example.com', 'board.local.evil.com']) {
        out[h] = await ask(h);
      }
      console.log(JSON.stringify(out));
      server.closeAllConnections(); server.close();
    });
  `;
  const out = require('node:child_process')
    .execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 20000 });
  const got = JSON.parse(out.trim().split('\n').pop());

  // Every spelling of an allowed host, including the one an operator would
  // paste out of a proxy config with the port still attached.
  // Includes an entry WRITTEN with a trailing dot, which was the one axis of the
  // parser the fixture did not exercise: dropping the config-side dot strip
  // left the suite green while an operator's `Dotted.Example.` entry silently
  // stopped matching.
  for (const h of ['board.local', 'BOARD.local:9', 'board.local.',
    'proxy.example.com:8443', 'proxy.example.com',
    'dotted.example', 'dotted.example.']) {
    assert.notEqual(got[h], 400, `${h} should have been allowed`);
  }
  // And the allowlist must not become a suffix match.
  assert.equal(got['evil.example.com'], 400);
  assert.equal(got['board.local.evil.com'], 400, 'the allowlist matched a suffix');
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

test('cancelled avatar requests do not kill the server', async () => {
  // The scenario the pipeline choice was justified by, and the one that had no
  // test: it turned out `pipeline` THROWS synchronously on an already-destroyed
  // destination, and since the call sits inside a 'readable' handler that throw
  // was an uncaught exception that exited the process.
  //
  // This is ordinary use. A browser cancels in-flight <img> loads as a matter
  // of course, and the detail page re-sets img.src with a fresh ?t= on every
  // render, so a person clicking between agents produces exactly this.
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const store = require('./engine/store');

  // A payload big enough that the response cannot complete before the abort.
  const big = Buffer.alloc(3 * 1024 * 1024, 7);
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-abort-'));
  const fixture = nodePath.join(dir, 'angel.png');
  fs.writeFileSync(fixture, big);

  // Catch the throw directly. Asserting only "the server still answers" is not
  // enough here: under the test runner these surface as uncaughtException
  // events that the runner absorbs, so the process survives the suite while the
  // same code would exit a real `node server.js`. Counting them is what makes
  // this test fail on the bug instead of merely printing errors beside a tick.
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);

  const original = store.avatarPath;
  store.avatarPath = () => fixture;
  try {
    for (let i = 0; i < 120; i++) {
      const ac = new AbortController();
      const p = fetch(`${base}/api/agent/angel/avatar?t=${i}`, { signal: ac.signal })
        .then((r) => r.arrayBuffer())
        .catch(() => {}); // aborts reject; that is the point
      // Cancel immediately, so some land before the header and some mid-body.
      setTimeout(() => ac.abort(), i % 3);
      await p.catch(() => {});
    }
    // Let any deferred throw land before we judge.
    await new Promise((r) => setTimeout(r, 400));
  } finally {
    store.avatarPath = original;
    process.removeListener('uncaughtException', onUncaught);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.deepEqual(uncaught.map((e) => e.code), [],
    `cancelled requests threw: ${uncaught.map((e) => e.code).join(', ')} -- in a real process each of these exits the board`);

  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'server died on cancelled avatar requests');
});

test('HEAD on an avatar runs the whole stat and stream path without a body', async () => {
  // The avatar route is the one whose HEAD path exercises the stat, stream and
  // pipeline machinery this branch rewrote; /api/status alone does not.
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const store = require('./engine/store');

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-head-'));
  const fixture = nodePath.join(dir, 'angel.png');
  fs.writeFileSync(fixture, PNG);

  const original = store.avatarPath;
  store.avatarPath = () => fixture;
  try {
    const res = await req('/api/agent/angel/avatar?t=1', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.match(res.type, /^image\/png/);
    assert.equal(res.body.length, 0, 'HEAD must not carry a body');
  } finally {
    store.avatarPath = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The commitments endpoints
//
// These had no coverage at all when the store landed, which is the gap this
// file's own header warns about: the routes around a helper are where bugs
// live, not the helper. The first review of that branch found a crash on this
// exact surface that one route test would have caught.
// ---------------------------------------------------------------------------

test('commitments are reachable with a query string attached', async () => {
  // The branch was written before routing moved to the pathname, so its
  // original form matched on req.url and would have reintroduced the very bug
  // this file exists to pin, on a brand-new endpoint.
  const bare = await req('/api/agent/angel/commitments');
  const busted = await req('/api/agent/angel/commitments?t=1');
  assert.match(bare.type, /application\/json/);
  assert.match(busted.type, /application\/json/, 'a query string sent it to the catch-all');
  assert.equal(busted.status, bare.status);
});

test('an agent that has never reported reads unknown over HTTP, not clear', async () => {
  // The whole point of the store, asserted at the boundary a caller actually
  // uses rather than only in the module.
  const res = await req('/api/agent/never-reported-over-http/commitments');
  const body = JSON.parse(res.body);
  assert.equal(body.state, 'unknown');
  assert.notEqual(body.state, 'clear');
});

test('a malformed agent name does not crash the commitments route', async () => {
  for (const path of ['/api/agent/%/commitments', '/api/agent/%zz/commitments?t=1']) {
    const res = await req(path);
    assert.equal(res.status, 404, `${path} should be refused`);
  }
  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'server died on a malformed name');
});

test('PUT refuses an unknown agent', async () => {
  const res = await req('/api/agent/definitely-not-an-agent/commitments',
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"commitments":[]}' });
  assert.equal(res.status, 404);
  assert.match(res.type, /application\/json/);
});

test('PUT refuses a payload that is not a list', async (t) => {
  // Previously bundled into the test above, which made one request and never
  // exercised this half: deleting the Array.isArray guard left the suite green.
  //
  // Needs a real agent, because knownAgent() guards the route and server.js
  // destructures snapshot() at import, so it cannot be stubbed from here.
  //
  // A VISIBLE skip when the roster is empty, not a bare return. An earlier
  // version returned silently and printed a tick for a test that asserted
  // nothing; a later one hard-failed, which makes the suite unrunnable on any
  // machine without live agents. Skipping says which of the two happened.
  const name = await anyAgent(t);
  if (!name) return;

  for (const body of ['{}', '{"commitments":"nope"}', '{"commitments":{"what":"x"}}', '{"commitments":null}']) {
    const res = await req(`/api/agent/${name}/commitments`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
    assert.equal(res.status, 400, `${body} should be refused`);
    assert.match(JSON.parse(res.body).error, /commitments list/);
  }
});

test('the status payload carries the STORE value for each agent, not a placeholder', async (t) => {
  // The worst possible regression here is the board telling the restart dialog
  // that every agent is `clear`. An earlier version of this test only checked
  // that a block existed with one of three state strings and a truthy reason,
  // which a hardcoded {state:'clear'} satisfies perfectly. It also returned
  // early on any machine without tmux, so it asserted nothing on CI.
  //
  // This stubs the store so the expected value is known, and asserts the
  // payload carries it per agent.
  // NOTE: the roster cannot be stubbed from here. server.js destructures
  // snapshot() at import, so reassigning the export has no effect -- an earlier
  // version of this test did exactly that and carried a comment claiming it
  // pinned behaviour on an agentless machine. It did not; the stub was inert
  // and the test still ran against live tmux. The store CAN be stubbed, which
  // is what actually matters here, and the roster dependency is handled by the
  // same visible skip the sibling tests use.
  if (!(await anyAgent(t))) return;

  const commitments = require('./engine/commitments');
  const real = commitments.read;
  const seen = [];
  commitments.read = (agent) => {
    seen.push(agent);
    return { state: 'holding', commitments: [{ id: 'x', what: `pending for ${agent}` }],
             reportedAt: '2026-01-01T00:00:00.000Z', because: 'stubbed for this test' };
  };
  try {
    const res = await req('/api/status');
    assert.match(res.type, /application\/json/);
    const agents = JSON.parse(res.body).agents || [];
    assert.ok(agents.length > 0, 'no agents on the board, cannot verify enrichment');

    for (const a of agents) {
      assert.equal(a.commitments.state, 'holding', `${a.sessionName} did not carry the store value`);
      assert.equal(a.commitments.because, 'stubbed for this test');
      assert.deepEqual(a.commitments.commitments.map((x) => x.what), [`pending for ${a.sessionName}`],
        'the block must be this agent value, not a shared placeholder');
    }
    assert.deepEqual(seen.sort(), agents.map((a) => a.sessionName).sort(),
      'read() must be called once per agent, with that agent sessionName');
  } finally {
    commitments.read = real;
  }
});

test('the commitments route is ordered before the /api fallthrough', async () => {
  // The /api guard answers 404 "no such endpoint" for anything it reaches. If
  // the commitments route were declared after it, this endpoint would never be
  // reached at all and would 404 with that message instead of a state.
  const res = await req('/api/agent/order-check/commitments');
  const body = JSON.parse(res.body);
  assert.ok(body.state, 'reached the /api fallthrough instead of the route');
  assert.notEqual(body.error, 'no such endpoint');
});

test('PUT answers in the same three-state vocabulary as GET', async (t) => {
  // PUT used to return report()'s raw record, which has no state and no
  // because. A client asserting "I hold nothing" got back a bare empty list:
  // the exact shape the store exists to keep out of callers' hands.
  const name = await anyAgent(t);
  if (!name) return;

  const put = await req(`/api/agent/${name}/commitments`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commitments: [] }),
  });
  assert.equal(put.status, 200);
  const body = JSON.parse(put.body);
  assert.equal(body.state, 'clear', 'an asserted empty must come back as clear, not a bare list');
  assert.ok(body.because, 'the answer must carry its reason');
});

test('GET reflects what was actually stored, not a fixed answer', async (t) => {
  // The GET route was pinned only in the safe direction: a hardcoded
  // {state:'unknown'} left every server test green, so a regression that read
  // the wrong name would render every agent "cannot tell" undetected. Nothing
  // did a write-then-read round trip.
  const name = await anyAgent(t);
  if (!name) return;

  const put = await req(`/api/agent/${name}/commitments`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commitments: [{ what: 'a round-tripped commitment' }] }),
  });
  assert.equal(put.status, 200);

  const got = await req(`/api/agent/${name}/commitments?t=${Date.now()}`);
  const body = JSON.parse(got.body);
  assert.equal(body.state, 'holding', 'GET did not reflect the write');
  assert.deepEqual(body.commitments.map((x) => x.what), ['a round-tripped commitment']);

  // And back to clear, so both transitions are covered.
  await req(`/api/agent/${name}/commitments`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commitments: [] }),
  });
  assert.equal(JSON.parse((await req(`/api/agent/${name}/commitments`)).body).state, 'clear');
});

test('a null PUT body is refused with a readable message, not an exception name', async (t) => {
  // Previously answered 400 with the raw JS text "Cannot read properties of
  // null (reading 'commitments')", which names an exception rather than saying
  // what to do. The house rule for this catch is stated in server.js itself.
  const name = await anyAgent(t);
  if (!name) return;

  const res = await req(`/api/agent/${name}/commitments`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'null',
  });
  assert.equal(res.status, 400);
  const { error } = JSON.parse(res.body);
  assert.match(error, /commitments list/, `unhelpful message: ${error}`);
  assert.ok(!/Cannot read properties/.test(error), 'surfaced a raw exception message');
});

// ---------------------------------------------------------------------------
// The instructions route: the most powerful write on the surface
// ---------------------------------------------------------------------------

test('instructions are reachable with a query string attached', async () => {
  // The detail page cache-busts this fetch, which is the exact shape that
  // returned the HTML page before routing moved to the pathname.
  const bare = await req('/api/agent/angel/instructions');
  const busted = await req('/api/agent/angel/instructions?t=1');
  assert.match(bare.type, /application\/json/);
  assert.match(busted.type, /application\/json/, 'a query string sent it to the catch-all');
  assert.equal(busted.status, bare.status);
});

test('a malformed agent name does not crash the instructions route', async () => {
  for (const path of ['/api/agent/%/instructions', '/api/agent/%zz/instructions?t=1']) {
    const res = await req(path);
    assert.equal(res.status, 404, `${path} should be refused`);
  }
  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'server died on a malformed name');
});

test('PUT refuses an unknown agent and a body that is not text', async (t) => {
  const unknown = await req('/api/agent/definitely-not-an-agent/instructions', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'a'.repeat(50) }),
  });
  assert.equal(unknown.status, 404);

  const name = await anyAgent(t);
  if (!name) return;
  for (const body of ['{}', '{"text":123}', '{"text":null}', 'null']) {
    const res = await req(`/api/agent/${name}/instructions`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
    assert.equal(res.status, 400, `${body} should be refused`);
    assert.match(JSON.parse(res.body).error, /as text/);
  }
});

test('a successful PUT rewrites the file and answers with the new stale state', async (t) => {
  // The riskiest path on the surface, and it was covered at the engine level
  // only: every route test above asserts a REFUSAL, so nothing drove this to a
  // 200 and checked that the bytes on disk actually changed. Safe to write now
  // only because AGENT_WORKFORCE_WORKERS is sandboxed at the top of this file.
  const name = await anyAgent(t);
  if (!name) return;

  // A worker directory inside the SANDBOX, named for a real agent so the
  // handler's knownAgent guard passes. Nothing under ~/work/workers is touched.
  const dir = nodePath.join(WORKERS, decodeURIComponent(name));
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, 'CLAUDE.md');
  fs.writeFileSync(file, 'The instructions this agent had before the test ran.');

  const text = 'These are the instructions the route was asked to save for this agent.';
  const res = await req(`/api/agent/${name}/instructions`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });

  assert.equal(res.status, 200, res.body);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'the file on disk did not change');

  const body = JSON.parse(res.body);
  assert.equal(body.text, text, 'the answer must reflect what was stored, not what was sent');
  assert.equal(body.exists, true);
  // A save makes the file newer than the session, which is exactly when the
  // agent stops running on what the box now shows. It must not answer
  // `current`, because that is the untrue claim the whole state exists to stop.
  assert.notEqual(body.staleness.state, 'current',
    'a just-saved file cannot be what a running agent already booted from');

  const back = await req(`/api/agent/${name}/instructions`);
  assert.equal(JSON.parse(back.body).text, text, 'a re-read did not see the write');
});

test('both modules resolve worker files under the SAME sandboxed root', async (t) => {
  // ⚠️ Pins the one thing standing between `node --test` and the live CLAUDE.md
  // files that real agents boot from. `status.js` used to carry its own
  // hardcoded `~/work/workers`, so this suite read the operator's real agents
  // while believing it was sandboxed. Nothing pinned the fix, so reverting that
  // one line silently restored the regression with the whole suite green.
  const name = await anyAgent(t);
  if (!name) return;
  const plain = decodeURIComponent(name);

  if (plain === 'claudebot') {
    t.skip('this agent has a hardcoded identity override, so readIdentity never reads its file');
    return;
  }

  const dir = nodePath.join(WORKERS, plain);
  fs.mkdirSync(dir, { recursive: true });
  // Shaped to match what readIdentity actually parses (`You are **Name**, role`)
  // rather than to any text that merely contains a marker.
  const marker = 'Sandbox Marker Agent';
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'),
    `# ${plain}\n\nYou are **${marker}**, the sandbox fixture worker.\n`);

  // The instruction route reads through instructions.js...
  const got = JSON.parse((await req(`/api/agent/${name}/instructions`)).body);
  assert.match(got.text, /Sandbox Marker Agent/, 'instructions.js read outside the sandbox');
  assert.ok(got.path.startsWith(WORKERS),
    `instructions.js resolved outside the sandbox: ${got.path}`);

  // ...and the status payload reads through status.js readIdentity. If the two
  // disagree about the root, this file is invisible to one of them, which is
  // exactly the state the suite shipped in.
  const board = JSON.parse((await req('/api/status')).body);
  const mine = (board.agents || []).find((a) => a.sessionName === plain);
  assert.ok(mine, 'the agent vanished from the board');
  assert.equal(mine.name, marker,
    'status.js did not read the sandboxed file, so it is resolving a different root');
});

test('the route refuses a save that would overwrite an edit made since the read', async (t) => {
  const name = await anyAgent(t);
  if (!name) return;
  const dir = nodePath.join(WORKERS, decodeURIComponent(name));
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, 'CLAUDE.md');
  fs.writeFileSync(file, 'The version the editor was shown when the panel opened.');

  const opened = JSON.parse((await req(`/api/agent/${name}/instructions`)).body);
  assert.ok(opened.version, 'GET must say which version it served');

  // Someone edits the file while the panel sits open, and the mtime is put back
  // so the guard cannot pass by comparing timestamps.
  const before = fs.statSync(file).mtime;
  const outside = 'AN EDIT MADE OUTSIDE THE APP THAT MUST NOT BE LOST';
  fs.writeFileSync(file, outside);
  fs.utimesSync(file, before, before);

  const res = await req(`/api/agent/${name}/instructions`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'a'.repeat(40), version: opened.version }),
  });
  // 409, not 400: this is a conflict, not a malformed request, and a
  // non-browser client keys on the difference to offer a reload over a retry.
  assert.equal(res.status, 409, res.body);
  assert.match(JSON.parse(res.body).error, /changed since you opened them/);
  assert.equal(fs.readFileSync(file, 'utf8'), outside, 'the outside edit was destroyed');
});

test('an unparseable body is refused with a readable message, not an exception name', async (t) => {
  const name = await anyAgent(t);
  if (!name) return;
  for (const body of ['{', 'not json at all', '{"text":']) {
    const res = await req(`/api/agent/${name}/instructions`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
    assert.equal(res.status, 400, `${body} should be refused`);
    const { error } = JSON.parse(res.body);
    assert.doesNotMatch(error, /SyntaxError|Unexpected token|JSON at position/,
      `the message named an exception instead of saying what to send: ${error}`);
    assert.match(error, /as JSON/);
  }
});

test('GET refuses an unknown agent rather than reporting a path for it', async () => {
  const res = await req('/api/agent/definitely-not-an-agent/instructions');
  assert.equal(res.status, 404);
  assert.equal(JSON.parse(res.body).path, undefined, 'a refusal must not hand back a filesystem path');
});

// ---------------------------------------------------------------------------
// The fresh-start routes: the only ones that reach a RUNNING agent
// ---------------------------------------------------------------------------

test('a cross-site POST cannot restart an agent', async (t) => {
  // ⚠️ The one that mattered most. Every pre-existing write is PUT or DELETE,
  // which an HTML form cannot emit, so this diff introduced the first forgeable
  // write and it was `restart`. A `<form enctype="text/plain">` is a CORS
  // simple request: no preflight, and the JSON body smuggles through the field
  // name. Measured before the guard: 200, and it reached the restart.
  //
  // The `Host` check does NOT cover this and cannot. That one stops DNS
  // rebinding, where the attacker controls the hostname; here the request
  // really is addressed to 127.0.0.1 and the Host header is genuine.
  const name = await anyAgent(t);
  if (!name) return;

  const forged = await req(`/api/agent/${name}/restart`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', Origin: 'https://evil.example' },
    body: '{"holding":"unknown:","x":"="}',
  });
  assert.equal(forged.status, 403, 'a cross-site form POST reached a restart');
  assert.match(JSON.parse(forged.body).error, /another site/);

  // The other signal a browser sends, which script cannot forge.
  const fetched = await req(`/api/agent/${name}/compact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    body: '{}',
  });
  assert.equal(fetched.status, 403);

  // And it covers EVERY write, not just the new ones: PUT and DELETE are safe
  // today only because HTML cannot emit them, which is a property of browsers
  // rather than a decision this code made.
  //
  // ⚠️ Aimed at a name that is NOT on the roster, deliberately. The avatar
  // store is the one root with no environment override (`store.ROOT` is
  // hardcoded under the real Application Support directory), so a DELETE at a
  // LIVE agent here would be protected only by the very guard it is testing:
  // narrow that guard to POST-only, a plausible edit, and the test deletes a
  // real avatar on its way to reporting the failure. This file's own header
  // records a reviewer doing exactly that once.
  //
  // The guard runs ahead of every route, including `knownAgent`, so an unknown
  // name still exercises it and can touch nothing.
  const del = await req('/api/agent/definitely-not-an-agent/avatar', {
    method: 'DELETE', headers: { Origin: 'https://evil.example' },
  });
  assert.equal(del.status, 403, 'a cross-site DELETE was allowed');
});

test('a non-browser caller is still allowed through', async (t) => {
  // curl and scripts send neither header. They are already inside the loopback
  // boundary and cannot be aimed by a web page, so refusing them would break
  // every legitimate non-browser caller to stop an attack that needs a browser.
  const name = await anyAgent(t);
  if (!name) return;
  // ⚠️ The REAL token, so this request actually reaches the action. It used to
  // send a made-up `unknown:`, which always 409'd, so the dry-run assertion
  // below was unreachable and the protection it claims to pin was not pinned.
  const board = JSON.parse((await req('/api/status')).body);
  const mine = (board.agents || []).find((a) => a.sessionName === decodeURIComponent(name));
  assert.ok(mine, 'the agent vanished from the board');

  const res = await req(`/api/agent/${name}/compact`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ holding: mine.commitments.token }),
  });
  assert.notEqual(res.status, 403);
  // ⚠️ And nothing actually happened to the agent. This is the one test here
  // that carries a token which can MATCH, so it is the one that would have
  // reached a live `tmux send-keys` without the dry-run set at the top of this
  // file. Asserting the outcome makes that protection visible rather than
  // implicit, and fails loudly if the flag is ever dropped.
  if (res.status === 200) {
    assert.equal(JSON.parse(res.body).outcome, 'dry-run',
      'this test performed a REAL action on a live agent');
  }
});

test('every fresh-start action requires the caller to say what it was shown', async (t) => {
  // ⚠️ Including compact. It was exempt on the grounds that it loses nothing,
  // which was false: `/compact` replaces the older conversation with a summary,
  // and this feature's premise is that commitments live in the conversation.
  const name = await anyAgent(t);
  if (!name) return;
  for (const action of ['compact', 'clear', 'restart']) {
    const res = await req(`/api/agent/${name}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 400, `${action} fired with no confirmation`);
    assert.match(JSON.parse(res.body).error, /what you were shown/);
  }
});

test('a stale view of what an agent is holding is refused with 409', async (t) => {
  // The dialog listed three commitments; approving twenty minutes later must
  // not quietly destroy a fourth that arrived in between. The cost you agreed
  // to pay has to be the cost that is actually there.
  const name = await anyAgent(t);
  if (!name) return;
  const res = await req(`/api/agent/${name}/clear`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ holding: 'holding:a-commitment-that-does-not-exist' }),
  });
  assert.equal(res.status, 409, res.body);
  assert.match(JSON.parse(res.body).error, /changed since you were shown/);
});

test('an unknown agent and an unknown action are both refused', async () => {
  const unknown = await req('/api/agent/definitely-not-an-agent/restart', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ holding: 'unknown:' }),
  });
  assert.equal(unknown.status, 404);

  // `reboot` is not a route at all, so it must not fall through to the page.
  const bogus = await req('/api/agent/angel/reboot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.ok(!bogus.type.includes('text/html'), 'an unknown action was answered with the page');
});

test('an alias spelling of an agent name cannot walk past the confirmation', async (t) => {
  // ⚠️ The guard read the RAW name while the action fired on the SANITISED key,
  // so any alias defeated it entirely: refused under `probe`, and then cleared
  // `probe` anyway when asked as `PROBE`. `knownAgent` documents that `ANGEL`,
  // `an.gel` and `ang!el` all reach this route, so the alias is not exotic —
  // it is the obvious spelling for a human or a script to use.
  const name = await anyAgent(t);
  if (!name) return;
  const plain = decodeURIComponent(name);

  // ⚠️ The fixture is what makes this discriminating. Give the agent REAL
  // commitments, then ask under an alias with the token for an agent that has
  // none (`unknown:`).
  //
  // Reading the raw alias finds no record, so the token matches and the clear
  // fires. Reading the sanitised key finds the real record, so it does not. A
  // test that merely sent a wrong token would 409 either way and pin nothing.
  const crypto = require('node:crypto');
  const seeded = await req(`/api/agent/${name}/commitments`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commitments: [{ what: 'work that must not be destroyed by an alias' }] }),
  });
  assert.equal(seeded.status, 200, seeded.body);

  // ⚠️ The token must be the REAL one an agent with no record produces, not a
  // made-up `unknown:`. The first version sent the latter, which no code path
  // ever generates, so it 409'd whichever name was read and the mutation that
  // reintroduces the raw-name defect left the whole file green.
  const emptyToken = `unknown:${crypto.createHash('sha256').update('', 'utf8').digest('hex').slice(0, 32)}`;

  for (const alias of [plain.toUpperCase(), plain.split('').join('.')]) {
    const res = await req(`/api/agent/${encodeURIComponent(alias)}/clear`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holding: emptyToken }),
    });
    assert.equal(res.status, 409,
      `${alias} walked past the confirmation and would have cleared the agent`);
  }
});

test('the confirmation token distinguishes a state we can vouch for', async (t) => {
  // ⚠️ The token carries the STATE, not just the ids. `unknown` with three
  // items and `holding` with the same three are different situations: the first
  // means we cannot vouch for the list. Approving one against the other is the
  // conflation this token exists to catch, and dropping the state component
  // left the whole suite green.
  const name = await anyAgent(t);
  if (!name) return;

  // ⚠️ Same id, DIFFERENT text. `resolve(agent, id)` requires ids to be stable
  // across reports, so an agent re-reporting an item with new wording is
  // ordinary. Measured before the fix: the dialog showed "Draft the internal
  // memo", the agent re-reported that id as "Wire the 40k payment to the
  // vendor", and the original token was still accepted — the operator approved
  // destroying one thing and destroyed another.
  const seed = async (what) => {
    const r = await req(`/api/agent/${name}/commitments`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commitments: [{ id: 'stable-id-1', what }] }),
    });
    assert.equal(r.status, 200, r.body);
  };

  await seed('Draft the internal memo');
  const shown = JSON.parse((await req(`/api/agent/${name}/instructions`)).body); // any GET refreshes nothing; token comes from status
  const board = JSON.parse((await req('/api/status')).body);
  const mine = (board.agents || []).find((a) => a.sessionName === decodeURIComponent(name));
  assert.ok(mine, 'the agent vanished from the board');
  assert.ok(shown, 'fixture read failed');

  // Reproduce the token the dialog would have held for the FIRST wording.
  const crypto = require('node:crypto');
  const tokenFor = (items, state) => `${state}:${crypto.createHash('sha256')
    .update(items.map((c) => `${c.id}\u0000${c.what}`).sort().join('\u0001'), 'utf8')
    .digest('hex').slice(0, 32)}`;
  const staleToken = tokenFor([{ id: 'stable-id-1', what: 'Draft the internal memo' }], mine.commitments.state);

  // Now the same id says something else entirely.
  await seed('Wire the 40k payment to the vendor');

  const res = await req(`/api/agent/${name}/clear`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ holding: staleToken }),
  });
  assert.equal(res.status, 409,
    'a commitment whose text changed under a stable id walked past the confirmation');

  // ⚠️ And the DISCRIMINATING half. The assertion above passes against an
  // id-only token too, because a client hashing id+text would not match an
  // id-only server either. This one sends exactly the token an ID-ONLY server
  // would accept for the CURRENT record: if the text is not in the fingerprint,
  // it matches and the clear fires.
  const idsOnly = `${mine.commitments.state}:${crypto.createHash('sha256')
    .update(['stable-id-1'].join('\u0001'), 'utf8').digest('hex').slice(0, 32)}`;
  const idOnlyRes = await req(`/api/agent/${name}/clear`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ holding: idsOnly }),
  });
  assert.equal(idOnlyRes.status, 409,
    'a fingerprint that ignores the commitment text was accepted');

  // And the state still has to match: ids and text alone are not enough.
  const noState = await req(`/api/agent/${name}/clear`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ holding: tokenFor([{ id: 'stable-id-1', what: 'Wire the 40k payment to the vendor' }], '') }),
  });
  assert.equal(noState.status, 409, 'a token missing its state was accepted');
});

test('an agent waiting on a question is never typed into', async (t) => {
  // ⚠️ The most dangerous thing in this feature. `clear` and `compact` send the
  // command and then a bare `Enter`. If the agent is sitting on a permission
  // prompt, the text is ignored by the select and the ENTER CONFIRMS THE
  // HIGHLIGHTED OPTION, which is Yes. Clicking the gentlest button on a screen
  // built to show you the cost of an action would instead approve an arbitrary
  // tool call the operator never saw.
  //
  // ⚠️ Accepts ANY state the allowlist refuses, not only `needs_you`.
  //
  // This test named the route's most dangerous guard and had never once run:
  // it required an agent to be sitting on a permission prompt at the exact
  // moment the suite executed, which on a healthy fleet is almost never. So
  // deleting the `if (!allowed.ok)` block in the route left all 238 tests
  // green — the guard was pinned by a test that skipped.
  //
  // `mayTypeInto` is an ALLOWLIST of `idle` and `working`, so every other
  // state refuses through the identical branch: `rate_limited`, `unknown`,
  // `stopped` and `needs_you` all exercise the same line. Any of them proves
  // the route consults the decision, and at least one is almost always present
  // on a real board.
  const board = JSON.parse((await req('/api/status')).body);
  const REFUSED_STATES = ['needs_you', 'rate_limited', 'unknown', 'stopped'];
  const waiting = (board.agents || []).find((a) => REFUSED_STATES.includes(a.state));
  if (!waiting) {
    t.skip('every agent on this board is idle or working, so no refusing state exists to drive');
    return;
  }
  // ⚠️ The token must be the REAL one, taken from the payload. The first
  // version of this sent a made-up `unknown:`, so the changed-since-shown check
  // threw CONFLICT before `mayTypeInto` ever ran, and the assertion below read
  // `.because` off a body that only has `.error`. It could never have passed,
  // and it never ran, because no agent happened to be waiting.
  for (const action of ['clear', 'compact']) {
    const res = await req(`/api/agent/${encodeURIComponent(waiting.sessionName)}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holding: waiting.commitments.token }),
    });
    assert.equal(res.status, 409, `${action} was sent to an agent showing a question`);
    assert.match(JSON.parse(res.body).because, /waiting on an answer|cannot see clearly enough/);
  }
});

test('a destructive action tombstones what it destroyed', async (t) => {
  // ⚠️ THE guard of this feature, and until now it ran in no test at all.
  //
  // `AGENT_WORKFORCE_DRY_RUN=1` is set file-wide above, so `perform()` always
  // returned `dry-run`, so `invalidatesCommitments()` always returned false, so
  // the route's whole reconciliation block never executed. Deleting that block
  // — the `markDestroyed` call, the `hadRecord` check and the appended warning
  // — left all 244 tests green. The flag added to make this surface safe to
  // probe was precisely what stopped its most consequential branch being
  // pinned: new safety code disabling the coverage of the thing it protects.
  //
  // Without the tombstone the board goes on asserting the destroyed items at
  // FULL confidence ("it reported these itself") for the next thirty minutes,
  // about work that no longer exists anywhere, and the cleared agent can never
  // correct it because it has forgotten it ever said them.
  //
  // ⚠️ Safety here rests on the injected runner, not on the flag. `setRunner`
  // is installed FIRST and `setDryRun(false)` refuses to fire while the real
  // runner is in place, so no keystroke can reach a live pane.
  const lifecycle = require('./engine/lifecycle');
  const commitments = require('./engine/commitments');

  const board = JSON.parse((await req('/api/status')).body);
  const target = (board.agents || []).find((a) => a.state === 'idle' || a.state === 'working');
  if (!target) {
    t.skip('no agent on this board is in a state the route would act on');
    return;
  }

  const sent = [];
  lifecycle.setRunner((file, args) => { sent.push([file, ...args]); return ''; });
  try {
    lifecycle.setDryRun(false);

    // Seed the SANDBOXED store, never the real one.
    commitments.report(target.sessionName, [
      { what: 'a thing that is about to stop existing' },
      { what: 'a second thing nobody will remember' },
    ]);
    const before = commitments.read(target.sessionName);
    assert.equal(before.state, commitments.STATE.HOLDING);
    assert.equal(before.commitments.length, 2);

    const fresh = JSON.parse((await req('/api/status')).body);
    const now = fresh.agents.find((a) => a.sessionName === target.sessionName);
    const res = await req(`/api/agent/${encodeURIComponent(target.sessionName)}/clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holding: now.commitments.token }),
    });

    assert.equal(res.status, 200, JSON.parse(res.body).because || res.body);
    const body = JSON.parse(res.body);
    assert.notEqual(body.outcome, 'dry-run', 'the action was still dry-run, so this proves nothing');

    // Nothing reached a real agent: the recorder saw the send-keys instead.
    assert.ok(sent.length >= 1, 'no command was issued at all');
    assert.ok(sent.every((c) => c[0] === 'tmux'), 'something other than tmux was run');

    // The answer carries what was lost, not an empty list.
    assert.equal(body.holding.commitments.length, 2,
      'the record of the cost actually paid was empty');

    // And the store no longer asserts them at full confidence.
    const after = commitments.read(target.sessionName);
    assert.equal(after.state, commitments.STATE.UNKNOWN,
      'the board would still be claiming these at full confidence');
    assert.equal(body.reconciled, true, 'the route did not report reconciling the record');
  } finally {
    lifecycle.setDryRun(true);
    lifecycle.setRunner(null);
  }
});

test('dry-run cannot be switched off while the real runner is installed', () => {
  // ⚠️ The invariant that makes `setDryRun` safe to exist at all. Without it
  // this is a switch that disarms the fleet-wide protection on a machine with
  // thirteen live agents, and the next test to call it in the wrong order sends
  // real keystrokes. Deleting the guard in `setDryRun` fails here.
  const lifecycle = require('./engine/lifecycle');
  lifecycle.setRunner(null);
  assert.throws(() => lifecycle.setDryRun(false), /refusing to leave dry-run/);
  // Still armed afterwards.
  assert.equal(lifecycle.compact('nobody', 'nobody-discord:0.0').outcome, 'dry-run');
});

test('the browser fallback descriptions match the engine word for word', async () => {
  // ⚠️ `web/index.html` carries a copy of the action copy for the window before
  // `/api/actions` resolves. The engine's own comment says the costs live there
  // "so the screen cannot describe an action differently from the thing that
  // performs it", and this fallback re-creates exactly that drift channel. It
  // has already drifted once: the first version said compact "loses nothing",
  // which is the one claim the engine was reworded to stop making.
  const engine = JSON.parse((await req('/api/actions')).body);
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

  for (const id of ['compact', 'clear', 'restart']) {
    assert.ok(page.includes(engine[id].what), `the page's fallback "what" for ${id} has drifted`);
    assert.ok(page.includes(engine[id].loses), `the page's fallback "loses" for ${id} has drifted`);
    assert.ok(page.includes(`label: '${engine[id].label}'`), `the page's fallback label for ${id} has drifted`);
  }

  // ⚠️ `gentlest` too, not just the prose. It decides which button is visually
  // primary, and the fallback is what renders for every `?fresh=` deep link and
  // every render before `/api/actions` resolves. If the engine ever moved
  // `gentlest` to a different action, a fallback still marking Compact primary
  // would put the wrong recommendation on the most destructive screen here —
  // and no assertion on wording would notice.
  const gentlestInEngine = ['compact', 'clear', 'restart'].filter((id) => engine[id].gentlest);
  assert.deepEqual(gentlestInEngine, ['compact'], 'the engine changed which action is gentlest');
  const fallbackGentlest = [...page.matchAll(/(\w+): \{ label: '[^']*', gentlest: (true|false)/g)]
    .filter((m) => m[2] === 'true')
    .map((m) => m[1]);
  assert.deepEqual(fallbackGentlest, gentlestInEngine,
    'the page marks a different action gentlest than the engine does');
});

/**
 * Pull a top-level `function <name>(...) { ... }` out of the page and return it
 * as a callable.
 *
 * ⚠️ The page has no build step and no module system, so there is nothing to
 * require. The alternative is a test that re-implements the function and then
 * asserts its own copy is correct, which is the species of test that passes
 * while the shipped code is broken. This evaluates the REAL text.
 *
 * It throws rather than returning null when the function cannot be found, so
 * deleting or renaming `ageText` fails this file loudly instead of silently
 * skipping the assertions that pin it.
 */
function pageFunction(name) {
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const start = page.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`web/index.html no longer defines ${name}()`);

  // Brace-match from the first `{` after the signature. Crude, and sufficient:
  // these are small pure helpers with no braces inside string literals.
  const open = page.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < page.length; i += 1) {
    if (page[i] === '{') depth += 1;
    else if (page[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error(`could not find the end of ${name}()`);
  // eslint-disable-next-line no-new-func
  return new Function(`${page.slice(start, end)}; return ${name};`)();
}

test('the freshness stamp stays readable at both ends of the range', () => {
  const ageText = pageFunction('ageText');

  // The ordinary case, unchanged.
  assert.equal(ageText(0), 'just now');
  assert.equal(ageText(4), 'just now');
  assert.equal(ageText(20), '20 seconds ago');

  // ⚠️ The top end. This printed raw seconds with no upper bucket, so a page
  // left open, or a server clock months out, rendered "17824112 seconds ago" as
  // the freshness stamp on a board whose argument is that a stale reading must
  // be legible as stale. An unreadable number is not a legible warning.
  assert.equal(ageText(17824112), '206 days ago');
  assert.equal(ageText(300), '5 minutes ago');
  assert.equal(ageText(7200), '2 hours ago');

  // ⚠️ Every singular, because the first set of cut-offs (90s / 90min / 36h)
  // made all three unreachable: 90 seconds rounds to "2 minutes", so "1 minute
  // ago" could never print. Three dead branches that read as careful.
  assert.equal(ageText(60), '1 minute ago');
  assert.equal(ageText(3600), '1 hour ago');
  assert.equal(ageText(86400), '1 day ago');

  // ⚠️ The bottom end. `age` subtracts the SERVER's clock from the BROWSER's,
  // and nothing makes those agree, so a client a few seconds behind produced
  // "-4 seconds ago" — which reads as a broken page, not a fresh one.
  assert.equal(ageText(-4), 'just now');
  assert.equal(ageText(-9999), 'just now');

  // An unparseable timestamp must say so rather than rendering "NaN seconds ago".
  assert.equal(ageText(NaN), 'at an unknown time');
});

test('an unreadable check time is flagged stale, not silently treated as fresh', () => {
  // ⚠️ Pins the direction of the comparison, not the wording. The stamp read
  // `age > 30 ? ' stale' : ''`, and every comparison against NaN is false, so an
  // unparseable `checkedAt` took the NOT-stale branch: the board looked freshly
  // checked at the exact moment it could not say when it had been checked.
  //
  // Deleting the inverted form and restoring `age > 30` fails this test.
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const stamp = page.match(/checked\.className\s*=\s*'checked'\s*\+\s*\(([^)]*)\)/);
  assert.ok(stamp, 'the freshness stamp no longer sets its own class');

  // Evaluate the real expression against NaN and assert it lands on stale.
  // eslint-disable-next-line no-new-func
  const decide = new Function('age', `return (${stamp[1]});`);
  assert.equal(decide(NaN), ' stale', 'an unknown age renders as freshly checked');
  assert.equal(decide(5), '', 'a recent check is wrongly flagged stale');
  assert.equal(decide(120), ' stale', 'an old check is not flagged');
});

test('an unexpected failure never puts an errno or a path on screen', () => {
  // ⚠️ The fresh-start chain calls `snapshot()`, which shells out to tmux and
  // reads transcripts, so an unexpected throw here carries filesystem errnos
  // and absolute home-directory paths. The catch echoed `err.message` verbatim,
  // which handed both to the operator — against the rule `safeTarget` states
  // and plan item 1.5.
  //
  // Pinned as a function because provoking a genuine unexpected throw from the
  // live route would mean breaking tmux or the filesystem under a running
  // fleet. Same reasoning that made `mayTypeInto` a function.
  const { errorAnswer } = require('./server');

  const leaky = new Error("EACCES: permission denied, open '/Users/example/.claude/projects/x.jsonl'");
  const answer = errorAnswer(leaky);
  assert.equal(answer.status, 500);
  assert.doesNotMatch(answer.error, /EACCES|\/Users\/|\.jsonl/, 'the raw error reached the operator');

  // Deleting the allowlist check fails the assertion above. These two pin the
  // other direction: the guard must not swallow the sentences we wrote FOR the
  // operator, which are the whole point of the confirmation flow.
  const conflict = new Error('what this agent is holding changed since you were shown it, look again before going ahead');
  conflict.code = 'CONFLICT';
  assert.equal(errorAnswer(conflict).status, 409);
  assert.match(errorAnswer(conflict).error, /changed since you were shown it/);

  const missing = new Error('say what you were shown this would lose');
  missing.code = 'SAY_WHAT';
  assert.equal(errorAnswer(missing).status, 400);
  assert.match(errorAnswer(missing).error, /say what you were shown/);

  // A thrown non-Error, and a code we never set, both land on the safe side.
  assert.equal(errorAnswer(null).status, 500);
  assert.equal(errorAnswer({ code: 'ENOENT', message: '/Users/example/secret' }).status, 500);
  assert.doesNotMatch(errorAnswer({ code: 'ENOENT', message: '/Users/example/secret' }).error, /Users/);
});

test('the action descriptions are served from the engine', async () => {
  // So the dialog cannot describe an action differently from the code that
  // performs it. The instruction editor shipped that exact bug.
  const res = await req('/api/actions');
  assert.match(res.type, /application\/json/);
  const body = JSON.parse(res.body);
  for (const id of ['compact', 'clear', 'restart']) {
    assert.ok(body[id], `${id} missing`);
    assert.ok(body[id].what && body[id].loses, `${id} has no description or cost`);
  }
  assert.equal(body.compact.gentlest, true);
  assert.notEqual(body.compact.loses, 'nothing', 'the gentlest option claims to be free');
});

test('the status payload carries staleness but NOT the instruction text', async (t) => {
  // The board polls this every five seconds for every agent, and the real files
  // run to several kilobytes each. Carrying them here would put roughly 90KB on
  // the wire per poll to render a badge.
  const res = await req('/api/status');
  if (!res.type.includes('application/json')) {
    t.skip('the status engine did not return a board on this machine');
    return;
  }
  const body = JSON.parse(res.body);
  const agents = body.agents || [];
  if (!agents.length) {
    // A bare return here prints a tick for a test that asserted nothing, which
    // is the failure `anyAgent` exists to avoid. Say it out loud instead.
    t.skip('no live agents on this machine, so there is no payload to inspect');
    return;
  }

  for (const a of agents) {
    assert.ok(a.instructions, `${a.sessionName} has no instructions block`);
    assert.ok(['current', 'stale', 'unknown'].includes(a.instructions.state),
      `${a.sessionName} has an unexpected state: ${a.instructions.state}`);
    assert.equal(a.instructions.text, undefined,
      'the instruction TEXT must not ride on the status poll');
  }

  assert.ok(JSON.stringify(body).length < 200 * 1024,
    `status payload is ${JSON.stringify(body).length} bytes; the text is probably riding along`);
});
