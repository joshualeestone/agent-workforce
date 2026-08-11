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
//   3. `store.ROOT` -> avatars and profiles. ⚠️ THIS WAS "NOT sandboxed, no
//      variable for it", and that is no longer true: `engine/store.js` now
//      honours `AGENT_WORKFORCE_DATA` too, so all three roots travel together.
//      Tests on this branch DO write to the avatar store and PUT /profile,
//      which the old wording forbade — the header was stale for exactly as long
//      as it took someone to read it and stop. A reviewer once deleted a real
//      avatar by assuming one variable covered everything; the fix is that it
//      now does, not that the warning stands.
//   4. `AGENT_WORKFORCE_CONFIG_ROOT` -> the Claude config root that holds the
//      agent registry and transcripts. ⚠️ NOT set in this file, so /api/status
//      reads the operator's real `~/.claude` on every run here. Reads only —
//      but `engine/status.test.js` sets it, and this file should, and the
//      asymmetry is worth knowing before adding a test that writes.
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-workers-'));
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;

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
  // ⚠️ A TIED agent, or this goes RED on exactly the machine this branch exists
  // to serve. It returned the alphabetically-first of every tmux session, while
  // the write routes now additionally require the name to be tied — so on any
  // machine whose first-sorted session is a plain shell, or the non-Discord
  // agent this branch supports, eight write-route tests get 404 where they
  // assert 200. Green here only because all thirteen sessions on this machine
  // carry the suffix, which is the machine-dependence this suite condemns
  // elsewhere.
  const tied = agents.find((a) => a.isNamedOurs);
  if (!tied) {
    t.skip('no agent on this machine can be tied to its name, so the write routes cannot be exercised');
    return null;
  }
  return encodeURIComponent(tied.sessionName);
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

    // ⚠️ TIED agents only, and this test was silently machine-dependent without
    // it. `/api/status` now skips `read()` for a pane it cannot tie to its name,
    // so this passed here only because all thirteen sessions on this machine
    // carry the `-discord` suffix — i.e. the suite's green status depended on
    // the exact coupling this branch exists to remove, and it would go red on
    // any machine running the non-Discord agent the branch was written for.
    const tied = agents.filter((a) => a.isNamedOurs);
    assert.ok(tied.length > 0, 'no tied agents on the board, cannot verify enrichment');

    for (const a of tied) {
      assert.equal(a.commitments.state, 'holding', `${a.sessionName} did not carry the store value`);
      assert.equal(a.commitments.because, 'stubbed for this test');
      assert.deepEqual(a.commitments.commitments.map((x) => x.what), [`pending for ${a.sessionName}`],
        'the block must be this agent value, not a shared placeholder');
    }
    assert.deepEqual(seen.sort(), tied.map((a) => a.sessionName).sort(),
      'read() must be called once per TIED agent, with that agent sessionName');

    // ⚠️ And an untied agent must NOT have been read. This looped over the LIVE
    // board, which has zero untied agents on this machine — so the loop body
    // never ran and the assertion proved nothing, which is the same
    // machine-dependence the comment above condemns. Asserted below against a
    // stubbed roster instead, where both shapes are guaranteed present.
    // (The hermetic version lives in '/api/status reads the store for a tied
    // agent and not for an untied one', below.)
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

test('a session that merely borrows an agent name cannot rewrite its instructions', async () => {
  // ⚠️ PRE-EXISTING and reachable on main. `knownAgent` gated every write route
  // on `sessionName`, and the roster publishes an untied pane's raw session
  // name — so with the real `angel-discord` down, a stranger's
  // `tmux new -s angel` made `knownAgent('angel')` true and unlocked
  // `PUT /api/agent/angel/instructions`, which rewrites the CLAUDE.md the REAL
  // agent boots from. The avatar and profile routes were open the same way,
  // against the real agent's stored data.
  //
  // Deleting the `isNamedOurs === true` clause in `knownAgent` fails here.
  const status = require('./engine/status');
  status.setPaneSource(() => 'angel\t0.0\t2.1.212\t0\tstranger');
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const board = JSON.parse((await req('/api/status')).body);
    const card = (board.agents || []).find((a) => a.sessionName === 'angel');
    assert.ok(card, 'the fixture did not produce the borrowed-name card');
    assert.equal(card.isNamedOurs, false, 'the fixture is not exercising the untied case');

    for (const route of ['instructions', 'profile']) {
      const res = await req(`/api/agent/angel/${route}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(route === 'instructions' ? { text: 'rewritten by a stranger' } : { role: 'rewritten' }),
      });
      assert.equal(res.status, 404,
        `PUT /${route} was accepted for a session that merely shares the name, so a `
        + 'stranger can rewrite what the real agent boots from');
    }
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('an untied card carries no commitments and no boot-file hash of the name it borrowed', async () => {
  // ⚠️ The snapshot closed this leak and `/api/status` reopened it one layer up.
  // Both enrichments are keyed on the NAME, so an untied stranger's card came
  // back carrying the real agent's commitment TEXT, its boot-file hash, and a
  // `startedAt` read out of the real agent's transcript — while the snapshot's
  // own sentence promises "we will not read another agent's transcript for it".
  //
  // It also reinstates the wrong-card-cost failure the engine documents as
  // measured: the restart dialog reads these, so the cost shown would be the
  // real agent's while the pane acted on is a stranger's.
  //
  // Deleting either gate in the /api/status map fails here.
  const status = require('./engine/status');
  status.setPaneSource(() => 'angel\t0.0\t2.1.212\t0\tstranger');
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const board = JSON.parse((await req('/api/status')).body);
    const card = (board.agents || []).find((a) => a.sessionName === 'angel');
    assert.ok(card, 'the fixture did not produce the borrowed-name card');
    assert.equal(card.isNamedOurs, false, 'the fixture is not exercising the untied case');

    assert.deepEqual(card.commitments.commitments, [],
      'the untied card carried the real agent’s commitment text as the cost of '
      + 'clearing a pane that is not theirs');
    assert.equal(card.commitments.state, 'unknown');

    assert.equal(card.instructions.version, null,
      'the untied card carried the real agent’s boot-file hash');
    assert.equal(card.instructions.startedAt, null,
      'the untied card carried a startedAt read out of the real agent’s transcript');
    // ⚠️ And it must not ADVERTISE an edit the route will then refuse.
    assert.equal(card.instructions.editable, false,
      'the untied card offered an Edit that knownAgent 404s, which is worse than '
      + 'refusing plainly');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('GET /commitments refuses a name a stranger is currently claiming, but not a stopped agent', async () => {
  // ⚠️ The THIRD name-keyed consumer. The comment at `knownAgent` that exists
  // specifically to correct an earlier claim of completeness listed two and
  // missed this one, in the same file — twice now a correction has itself been
  // incomplete.
  //
  // The first fix used `knownAgent`, which was too strict: a record's purpose is
  // to outlive the conversation, so a STOPPED agent must still be readable. The
  // danger is narrower — a pane on the board under this name that is not tied
  // to it — and both halves are asserted here, because a gate that refuses
  // everything would also have passed the first half.
  const status = require('./engine/status');

  // Half one: a stranger claiming the name. Must refuse.
  status.setPaneSource(() => 'angel\t0.0\t2.1.212\t0\tstranger');
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const res = await req('/api/agent/angel/commitments');
    assert.equal(res.status, 404,
      'the route handed out the real agent’s commitment text while a stranger '
      + 'held that name on the board');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }

  // Half two: nobody claiming it at all. Must still read.
  status.setPaneSource(() => 'someone-else-discord\t0.0\t2.1.212\t0\t');
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const res = await req('/api/agent/angel/commitments');
    assert.equal(res.status, 200,
      'a record for an agent that is not running became unreadable, which is the '
      + 'opposite of what a record is for');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('a borrowed name is refused by every name-keyed read, including its alias spellings', async () => {
  // ⚠️ FOUR consumers, found one at a time, each time by a comment that claimed
  // to enumerate them. This test names all four so the next one is added here
  // rather than discovered later.
  //
  // And the alias half is the sharper failure: `borrowedName` compared the
  // SANITISED key against the RAW sessionName, so a stranger on
  // `tmux new -s Angel` or `tmux new -s an.gel` slipped past entirely — the
  // gate's own twenty-line comment was claiming a protection that was actually
  // coming from an independent guard in commitments.js.
  const status = require('./engine/status');

  // ⚠️ The avatar must EXIST for the borrowed name, or the 404 below proves
  // nothing — the route answers 404 for a missing picture too, so without this
  // the assertion passed with the gate deleted. Third time on this work that a
  // test asserted an absence that was already absent.
  const fsx = require('node:fs');
  const nodePathx = require('node:path');
  const avatarDir = nodePathx.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce', 'avatars');
  fsx.mkdirSync(avatarDir, { recursive: true });
  fsx.writeFileSync(nodePathx.join(avatarDir, 'angel.png'), 'seeded', 'utf8');

  // Control: with nobody claiming the name, the picture IS served — so the 404s
  // below are the gate refusing, not the file being absent.
  const status0 = require('./engine/status');
  status0.setPaneSource(() => 'someone-else-discord\t0.0\t2.1.212\t0\t');
  status0.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const ok = await req('/api/agent/angel/avatar');
    assert.equal(ok.status, 200,
      'the seeded avatar is not reachable at all, so the refusals below prove nothing');
  } finally {
    status0.setPaneSource(null);
    status0.setPaneCapture(null);
  }

  for (const strangerSession of ['angel', 'Angel', 'an.gel']) {
    status.setPaneSource(() => `${strangerSession}\t0.0\t2.1.212\t0\tstranger`);
    status.setPaneCapture(() => 'Worked for 1m\n> \n');
    try {
      for (const route of ['commitments', 'avatar']) {
        const res = await req(`/api/agent/angel/${route}`);
        assert.equal(res.status, 404,
          `GET /${route} served the real agent's data while '${strangerSession}' held the name`);
      }
      for (const [route, body] of [['instructions', { text: 'x' }], ['profile', { role: 'x' }]]) {
        const res = await req(`/api/agent/angel/${route}`, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        assert.equal(res.status, 404,
          `PUT /${route} was accepted while '${strangerSession}' held the name`);
      }
    } finally {
      status.setPaneSource(null);
      status.setPaneCapture(null);
    }
  }
});

test('a roster we cannot read refuses the name-keyed reads rather than serving them', async () => {
  // ⚠️ `borrowedName`'s catch returned `false` — "nobody is claiming this name"
  // — so a `snapshot()` that throws SERVED the record. That is the permissive
  // answer asserted from an absence of information, the exact move `parsePanes`
  // and `classify` were both changed to refuse in this same branch, reintroduced
  // one layer up. `knownAgent`'s identical catch already failed closed.
  const status = require('./engine/status');
  status.setPaneSource(() => { throw new Error('tmux is not answering'); });
  try {
    for (const route of ['commitments', 'avatar']) {
      const res = await req(`/api/agent/angel/${route}`);
      assert.equal(res.status, 404,
        `GET /${route} served the record while we could not read the roster at all`);
    }
  } finally {
    status.setPaneSource(null);
  }
});

test('the gate checks do not capture every pane on every request', async () => {
  // ⚠️ A real regression, measured rather than suspected. `borrowedName` called
  // `snapshot()`, which is a synchronous fan-out: one `list-panes` plus one
  // `capture-pane` PER AGENT plus transcript reads. On the avatar route that
  // sits on a polling path — the board rebuilds its grid every five seconds and
  // avatar responses are `no-store`, so every card refetches each tick — which
  // put ~0.65s of blocked event loop and ~170 extra `capture-pane` invocations
  // against live agents into every tick on a thirteen-agent fleet.
  //
  // Memoising `snapshot()` was the other option and it was WRONG: it makes a
  // gate answer from a stale roster, which is the wrong direction for a check
  // deciding whose data to hand out. Two tests caught it immediately.
  // ⚠️ Asserted through the ROUTE, not by calling the helper. Testing that
  // `paneRoster()` captures nothing says nothing about whether the gate uses
  // it — the first version of this test did exactly that, and reverting the
  // gate to `snapshot()` left it green.
  const status = require('./engine/status');
  let captures = 0;
  status.setPaneSource(() => 'zeta-discord\t0.0\t2.1.212\t0\tx');
  status.setPaneCapture(() => { captures += 1; return 'Worked for 1m\n> \n'; });
  try {
    captures = 0;
    await req('/api/agent/zeta/avatar');
    assert.equal(captures, 0,
      'an avatar request captured every pane, so the board shells out once per '
      + 'agent per card on a five-second polling path');

    captures = 0;
    await req('/api/agent/zeta/commitments');
    assert.equal(captures, 0, 'a commitments read captured every pane');

    // The comparison is meaningless if nothing captures at all.
    captures = 0;
    status.snapshot();
    assert.ok(captures > 0, 'snapshot captured nothing, so the assertions above prove nothing');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('a live agent is not taken offline by a stranger holding an alias of its name', async () => {
  // ⚠️ The alias fix corrected the LEAK direction and left the AVAILABILITY
  // direction wrong. `.find()` returned whichever card sorted first, so with
  // the real `angel-discord` up AND a colleague's `tmux new -s Angel` open for
  // unrelated work, "Angel" sorted before "Angel Bridge" and the live agent's
  // avatar and commitment record went offline — and the restart dialog this
  // gate exists for would have shown "no agent by that name" as the cost of
  // clearing a healthy agent.
  //
  // The predicate is "some untied card claims this key AND no tied card does",
  // not "the first card claiming it is untied".
  const status = require('./engine/status');
  status.setPaneSource(() => [
    'Angel\t0.0\t2.1.212\t0\tunrelated work',
    'angel-discord\t0.0\t2.1.212\t0\tthe real one',
  ].join('\n'));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const res = await req('/api/agent/angel/commitments');
    assert.equal(res.status, 200,
      'a healthy agent lost its own record because a stranger held an alias '
      + 'spelling of its name');

    const put = await req('/api/agent/angel/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'still editable' }),
    });
    assert.equal(put.status, 200, 'a healthy agent became uneditable for the same reason');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('/api/status reads the store for a tied agent and not for an untied one', async () => {
  // ⚠️ Hermetic, because both halves of this were unpinned by accident of this
  // machine. The tied half passed only because `commitments.read` for an
  // unseeded name returns `{state:'unknown', commitments:[]}`, which is
  // byte-identical to what the gate substitutes — so deleting the gate changed
  // nothing observable. The untied half looped over the live board, which has
  // zero untied agents here, so its body never ran.
  //
  // A stubbed roster gives one of each, and a stub value that cannot be
  // confused with the gate's substitute.
  const commitments = require('./engine/commitments');
  const status = require('./engine/status');
  const real = commitments.read;
  const seen = [];
  commitments.read = (name) => {
    seen.push(name);
    return { state: 'holding', commitments: [{ id: 'x', what: `pending for ${name}` }], reportedAt: new Date().toISOString(), because: 'stubbed for this test' };
  };
  status.setPaneSource(() => [
    'tied-discord\t0.0\t2.1.212\t0\tworking',
    'untied\t0.0\t2.1.212\t0\tworking',
  ].join('\n'));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const agents = JSON.parse((await req('/api/status')).body).agents || [];
    const tied = agents.find((a) => a.sessionName === 'tied');
    const untied = agents.find((a) => a.sessionName === 'untied');
    assert.ok(tied && untied, 'the stubbed roster did not produce both shapes');

    assert.equal(tied.commitments.because, 'stubbed for this test',
      'the tied agent did not get the store value');
    assert.ok(seen.includes('tied'), 'read() was never called for the tied agent');

    assert.notEqual(untied.commitments.because, 'stubbed for this test',
      'the untied agent was handed the real store value for the name it borrowed');
    assert.ok(!seen.includes('untied'),
      'read() was called for an untied agent, so the gate is not at the call site');
  } finally {
    commitments.read = real;
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('a stranger cannot fetch the real agent’s picture under the stranger’s own spelling', async () => {
  // ⚠️ The leak reopened by the availability fix, and the URL that matters: a
  // consumer building a request from the UNTIED card uses that card's OWN
  // sessionName. Asking per-KEY ("does any tied card claim `angel`?") answered
  // yes — the real agent does — so the gate allowed it, and `avatarPath`
  // sanitised `Angel` straight back down to the real agent's file.
  //
  // Three directions wrong on one predicate: leak, then availability, then leak
  // again under a different spelling. The question is per-CARD.
  const status = require('./engine/status');
  const fsx = require('node:fs');
  const nodePathx = require('node:path');
  const avatarDir = nodePathx.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce', 'avatars');
  fsx.mkdirSync(avatarDir, { recursive: true });
  fsx.writeFileSync(nodePathx.join(avatarDir, 'angel.png'), 'seeded', 'utf8');

  status.setPaneSource(() => [
    'Angel\t0.0\t2.1.212\t0\tunrelated work',
    'angel-discord\t0.0\t2.1.212\t0\tthe real one',
  ].join('\n'));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    // The stranger's own spelling must be refused...
    const leak = await req('/api/agent/Angel/avatar');
    assert.equal(leak.status, 404,
      'the real agent’s picture was served under the stranger’s own session name');

    // ...while the real agent stays reachable under its own.
    const ok = await req('/api/agent/angel/avatar');
    assert.equal(ok.status, 200,
      'the fix took the healthy agent offline again, which is the direction the '
      + 'previous version broke');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('tmux being unreachable refuses the name-keyed reads rather than serving them', async () => {
  // ⚠️ The catch in `borrowedName` was documented as failing closed, and the
  // only input that reached it was an injected throw. The REALISTIC failure —
  // tmux dead, tmux not installed, the five-second timeout expiring — goes
  // through `sh()`, which swallows it and returns null, so the roster came back
  // EMPTY and the gate read that as "nobody is claiming this name" and served.
  //
  // A guard whose closed path production cannot take is not a guard. This drives
  // the production shape: the source returns null, not a throw.
  const status = require('./engine/status');
  status.setPaneSource(() => null);
  try {
    for (const route of ['commitments', 'avatar']) {
      const res = await req(`/api/agent/angel/${route}`);
      assert.equal(res.status, 404,
        `GET /${route} served the record when tmux could not be asked at all`);
    }
  } finally {
    status.setPaneSource(null);
  }
});

test('the detail panel withdraws the writes it cannot perform, and clears what it cannot show', () => {
  // ⚠️ BEHAVIOURAL, not source-shape. The first version asserted that
  // `openDetail` mentions `isNamedOurs`, that the load line contains `if`, and
  // that a withdrawing function exists and is called. All four held while the
  // instruction editor stayed live holding the PREVIOUS agent's boot file —
  // it pinned the incomplete fix rather than the behaviour.
  //
  // So: run the real function against a fake DOM and look at what it leaves.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];

  const ids = ['d-file', 'd-remove', 'd-save', 'd-role', 'd-instr', 'd-instr-save',
    'd-instr-foot', 'd-instr-stale', 'd-instr-outdated', 'd-instr-prev', 'd-instr-msg', 'd-untied'];
  const els = {};
  for (const id of ids) els[id] = { id, disabled: false, hidden: false, value: '', textContent: '' };
  const document = { getElementById: (id) => els[id] || null };

  // ⚠️ Brace-matched, not "up to the next function". The first version sliced
  // to the next `function` keyword and swept up the real `let INSTR_VERSION`
  // declaration sitting between them, which collided with the prelude — a
  // reminder that a source-extracting test is itself code that can be wrong.
  const start = script.indexOf('function setWritesOffered');
  assert.ok(start > -1, 'setWritesOffered vanished');
  let depth = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of setWritesOffered');

  // eslint-disable-next-line no-new-func
  const run = new Function('document', `let INSTR_READY = true; let INSTR_VERSION = 'v1';
    ${script.slice(start, end)}
    return (a, tied) => { setWritesOffered(a, tied); return { INSTR_READY, INSTR_VERSION }; };`)(document);

  // Simulate the dangerous sequence: a tied agent's file is on screen, then an
  // untied card is opened.
  els['d-instr'].value = "the real agent's boot file";
  els['d-instr-foot'].hidden = false;
  const after = run({ sessionName: 'Angel', name: 'Angel Bridge' }, false);

  assert.equal(els['d-instr'].value, '',
    "the previous agent's instruction text was left on screen for a card we "
    + 'cannot tie to that name');
  assert.equal(els['d-instr'].disabled, true, 'the instruction editor stayed live');
  assert.equal(els['d-instr-save'].disabled, true, 'Save stayed live');
  assert.equal(els['d-instr-foot'].hidden, true, "the real agent's file path stayed on screen");
  assert.equal(after.INSTR_READY, false, 'the editor still believes it holds a loaded file');
  assert.equal(after.INSTR_VERSION, null, "the previous agent's version stamp survived");

  for (const id of ['d-file', 'd-remove', 'd-save', 'd-role']) {
    assert.equal(els[id].disabled, true, `${id} was still offered`);
  }
  assert.equal(els['d-untied'].hidden, false, 'nothing explained why the writes are gone');
  // ⚠️ And the sentence must not be a tautology. For an untied card the display
  // name is FORCED to the raw session name, so a message built from both read
  // "we found a session called research, but not the one research's own session
  // runs in" — the only message the legitimate non-Discord agent this branch
  // most affects would ever see.
  assert.match(els['d-untied'].textContent, /-discord/,
    'the explanation does not say what session it expected, so it reads as a '
    + 'tautology for exactly the agents it is shown to');

  // ⚠️ AND the call site, which this test stopped pinning when it replaced the
  // source-shape version. Driving `setWritesOffered` in isolation proves the
  // function is right and says nothing about whether anyone calls it — deleting
  // `openDetail`'s three gate lines left the whole UI half of this branch
  // reverted with the suite fully green. The behavioural test was the right
  // move and it removed the only assertions holding the call site down.
  //
  // Both are needed: one proves the function does the right thing, the other
  // proves it runs.
  const code = script
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  const openStart = code.indexOf('function openDetail');
  assert.ok(openStart > -1, 'openDetail vanished');
  const openBody = code.slice(openStart, code.indexOf('\nfunction ', openStart + 10));
  assert.match(openBody, /setWritesOffered\s*\(/,
    'openDetail no longer calls setWritesOffered, so the panel offers writes the '
    + 'routes refuse and nothing here notices');
  const loadLine = openBody.split('\n').find((l) => l.includes('loadInstructions('));
  assert.ok(loadLine, 'openDetail no longer loads instructions at all');
  assert.match(loadLine, /\bif\b[^\n]*\btied\b/,
    'the instruction load runs unconditionally again, so opening an untied card '
    + 'fetches and paints the real agent’s file');

  // ⚠️ And the POLL must re-apply it, not just the open. The gate ran once at
  // open, so leaving the panel up while the real session died and a stranger
  // took the name left that agent's boot file on screen on a card that had
  // become somebody else's — reachable by simply not closing the panel.
  const tickStart = code.indexOf('function tick');
  assert.ok(tickStart > -1, 'tick vanished');
  const tickBody = code.slice(tickStart, code.indexOf('\nfunction ', tickStart + 10));
  assert.match(tickBody, /setWritesOffered\s*\(/,
    'the poll never re-applies the tie check, so an agent that dies while its '
    + 'panel is open keeps offering writes for a card that is now a stranger’s');

  // And a tied card gets everything back.
  run({ sessionName: 'zeta', name: 'Zeta' }, true);
  for (const id of ['d-file', 'd-remove', 'd-save', 'd-role', 'd-instr', 'd-instr-save']) {
    assert.equal(els[id].disabled, false, `${id} stayed withdrawn for a tied agent`);
  }
  assert.equal(els['d-untied'].hidden, true, 'the explanation stayed up for a tied agent');
});

test('every write route refuses the untied card’s own spelling while the real agent is up', async () => {
  // ⚠️ THE defect this whole branch is about, reopened on its most dangerous
  // half. `borrowedName` was corrected three times until it asked which CARD
  // answers for the spelling requested; `knownAgent` was left on the old
  // per-key form. So with the real `angel-discord` up AND a bystander's
  // `tmux new -s Angel` open, the reads refused correctly while the writes
  // accepted: PUT /instructions rewrote the real agent's BOOT FILE, PUT /profile
  // overwrote its role, DELETE /avatar deleted its picture, GET /instructions
  // handed back its full text and path.
  //
  // Both gates are wrappers over one predicate now, and this test exercises the
  // write half under the untied spelling — the case no test covered.
  const status = require('./engine/status');
  status.setPaneSource(() => [
    'Angel\t0.0\t2.1.212\t0\tunrelated work',
    'angel-discord\t0.0\t2.1.212\t0\tthe real one',
  ].join('\n'));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const refused = [
      ['GET', '/api/agent/Angel/instructions', null],
      ['PUT', '/api/agent/Angel/instructions', { text: 'rewritten by a bystander' }],
      ['PUT', '/api/agent/Angel/profile', { role: 'overwritten' }],
      ['DELETE', '/api/agent/Angel/avatar', null],
    ];
    for (const [method, path, body] of refused) {
      const res = await req(path, body === null
        ? (method === 'GET' ? undefined : { method })
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(res.status, 404,
        `${method} ${path} was accepted under the untied card's own spelling, so a `
        + 'bystander can act on the real agent');
    }

    // ⚠️ And the real agent stays writable under its own name, or the fix has
    // simply broken the feature — the direction a previous version of this
    // predicate got wrong.
    const ok = await req('/api/agent/angel/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'still editable' }),
    });
    assert.equal(ok.status, 200, 'the real agent became uneditable under its own name');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('the board SAYS part of the fleet could not be read, in words on the screen', () => {
  // ⚠️ BEHAVIOURAL, not source-shape, and the first version of this test was
  // the latter: it asserted that `c.unreadableLines` appears in the script.
  // Mutation-proved that this was worthless -- emptying the `if` body, or
  // trimming the notice back off the joined summary, left the suite green while
  // removing the half of this change that the fourteen-hour outage is about.
  // This file already carries that lesson 150 lines above, with the harness to
  // avoid it.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];

  // The summary block, run against a fake element, for a counts object that
  // says one line was unreadable.
  const summarise = (counts) => {
    const el = { textContent: '' };
    const document = { getElementById: () => el };
    // ⚠️ The slice INCLUDES the line that writes the summary. The first version
    // stopped just before it and re-implemented the join in the harness -- so a
    // mutation that trimmed the notice back off that very line stayed green,
    // because the harness was joining its own way. A test harness that
    // reconstructs the behaviour it is testing is the same defect as a
    // source-shape assertion, one level in.
    const from = script.indexOf('const bits = [');
    const write = script.indexOf("document.getElementById('summary').textContent");
    const body = script.slice(from, script.indexOf('\n', write) + 1);
    // eslint-disable-next-line no-new-func
    new Function('document', 'c', body)(document, counts);
    return el.textContent;
  };

  // ⚠️ Every other count is non-zero on purpose. With them at zero the notice is
  // one of only two entries, so a mutation that trims the summary to its first
  // few parts keeps it by accident and this test passes without meaning to. The
  // notice has to be pinned where it actually sits: LAST, after everything else
  // the line can carry.
  const partial = summarise({ total: 12, needsYou: 2, unknown: 1, unknownFullness: 3, unreadableLines: 1 });
  assert.match(partial, /could not read/,
    'the board shows what it managed to parse as the whole machine, with nothing '
    + 'on screen saying agents are missing from it');
  assert.match(partial, /1 /, 'the notice does not say how many lines were lost');

  // ⚠️ THE CONTROL. A clean answer must carry NO such notice: a warning that is
  // always on screen is one nobody reads, which is how the other counts on this
  // line are written.
  const clean = summarise({ total: 12, needsYou: 0, unknown: 0, unknownFullness: 0, unreadableLines: 0 });
  assert.doesNotMatch(clean, /could not read/,
    'a healthy board carries a permanent warning about unreadable lines');
  assert.match(clean, /12 agents/, 'the summary does not render at all, so this proves nothing');
});
