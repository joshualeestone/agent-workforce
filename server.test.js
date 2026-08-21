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
// ⚠️ AND THE CLAUDE CONFIG ROOT, which this file's own header said it did not
// set and should. Until now /api/status read the operator's real `~/.claude` on
// every run here -- reads only, but it also meant no test could give a fixture
// agent a MODEL, because a model comes from a registry entry plus the transcript
// that entry names. That is why the stopped-agent clause below had no test that
// could exercise it: every fixture arrived with `modelName` null, so the branch
// the clause guards was never reached.
const CONFIG_ROOT = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-config-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;

/**
 * Give a fixture agent a readable model: a registry entry naming a session, and
 * the transcript that session names. `readModel` needs both — seeding only the
 * registry leaves it null, which is one layer of vacuity further down.
 */
function seedTranscript(name, model) {
  const dir = nodePath.join(CONFIG_ROOT, 'agent-registry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, `${name}-discord_0.0.json`),
    JSON.stringify({ session_id: `sess-${name}`, model }), 'utf8');
  const projects = nodePath.join(CONFIG_ROOT, 'projects', 'seeded');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(nodePath.join(projects, `sess-${name}.jsonl`),
    JSON.stringify({ message: { model, usage: { input_tokens: 1000, output_tokens: 10 } } }) + '\n', 'utf8');
}
// ⚠️ AND THE LAUNCH AGENTS DIRECTORY, which this file did not sandbox while it
// now drives the create route. Both cases here are refused before anything is
// written, so nothing has leaked — but the first happy-path route test somebody
// adds would install a REAL launchd job in the operator's `~/Library/
// LaunchAgents`, and it would then start an agent on their next login. The
// sandbox has to be in place before the hazard arrives, not after.
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-launch-'));
// ⚠️ AND THE PROJECTS ROOT (round 37), for the same reason as LAUNCH above:
// this server now requires `engine/projects`, whose root defaults to
// `~/Kosmos/Projects` and whose create path calls `makeFolder` -- a real
// mkdir under the operator's home. No test in this file drives a
// `/api/project*` or `/api/folders` route today, which is exactly the state
// LAUNCH was in when its warning was written: the sandbox has to be in place
// before the hazard arrives, not after. `server.projects.test.js` and the
// thread fixture both already do this.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-projects-'));
// HOME too: `/api/folders` browses from the home directory when asked for
// its default start, so an unsandboxed HOME would list the operator's real
// home into a test. Directories only, nothing written -- but a listing is
// still a read of somebody's disk that no test here means to make.
process.env.HOME = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-srv-home-'));
// ⚠️ AND THE RELEASE HOST. Every /api/status request pokes the update check;
// without this override the unit suite fires real HTTPS requests at the
// production release host on every status test. Port 9 (discard) on loopback
// refuses instantly; the module fails soft, so everything still passes --
// offline, and without phoning home. Must be set before server.js is
// required, because engine/update reads it at load.
process.env.AGENT_WORKFORCE_RELEASE_BASE = 'http://127.0.0.1:9/dist';
// And the two programs an agent is made of, so a route test does not depend on
// whether the machine running the suite happens to have Claude installed where
// this one does.
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
// ⚠️ Belt AND braces for the CHAT engine too (round 26): this branch made
// `require('./server')` pull in engine/chat, which arms itself from this
// variable at load. Without it, the only thing between a stray thread-route
// test and a live agent's composer is the TMUX_BIN stub above, whose stated
// in-file purpose is create.js and remove.js. Both sibling suites carry
// this line.
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// ⚠️ ARM DRY-RUN FOR THE REMOVAL ENGINE, at load, before `server.js` requires
// it. `remove` defaults to NOT dry-run (it must, or the product removes nothing
// while reporting success), so what keeps `launchctl` off this machine during a
// route test is otherwise only the ownership gate refusing before it runs and
// the injected runner inside one try block. That is a correct outcome resting on
// call ordering, and the next removal test somebody adds outside that block
// would execute the real thing. `setRunner(null)` re-arms dry-run.
require('./engine/remove').setRunner(null);

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, pathOf, decodeSegment } = require('./server');
const fleet = require('./test-support/fleet');

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
  status.setPaneSource(() => fleet.line({ session: 'angel', title: 'stranger' }));
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
  const create = require('./engine/create');
  // ⚠️ A REAL JOB FILE, so the planned-model assertion below is testing the
  // GATE and not an empty sandbox. Written with the product's own writer rather
  // than typed out here: a hand-built plist would be a second definition of a
  // format whose reader takes an argument by position, and the two would drift
  // apart the first time an argument moved.
  //
  // ⚠️ `fixtureborrowed`, NOT `angel`, and this suite's sibling records why in
  // its own header: a fixture that names a REAL agent means the day the sandbox
  // slips, the test overwrites that agent's boot file instead of failing. This
  // one WRITES AND DELETES a launchd job, and `angel` is a live agent on this
  // machine — an unset AGENT_WORKFORCE_LAUNCH would have turned the cleanup
  // below into removing its real job. The gate under test does not care what
  // the name is, only that a pane borrowed it.
  fs.writeFileSync(create.plistPath('fixtureborrowed'),
    create.plistFor('fixtureborrowed', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'), 'utf8');
  assert.equal(create.plannedModelArg('fixtureborrowed'), 'claude-opus-5',
    'the fixture job does not carry a model, so the gate assertion below would '
    + 'pass whether or not the gate exists');
  status.setPaneSource(() => fleet.line({ session: 'fixtureborrowed', title: 'stranger' }));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const board = JSON.parse((await req('/api/status')).body);
    const card = (board.agents || []).find((a) => a.sessionName === 'fixtureborrowed');
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

    // ⚠️ THE FOURTH NAME-KEYED FIELD, added long after this gate was written.
    // `plannedModelName` reads the launchd job filed under the NAME, so without
    // the same `isNamedOurs` gate a stranger's pane reports the REAL agent's
    // model — the identical leak the three assertions above already close. A
    // new field does not inherit a guard by being written beside the ones that
    // have it, and this suite has been caught by that exact shape before.
    //
    // The positive control is its own test below: without one, this assertion
    // passes for an agent that simply has no job file, which is the state every
    // agent in a fresh sandbox is in.
    assert.equal(card.plannedModelName, null,
      'the untied card carried the real agent’s planned model, read out of a '
      + 'launchd job filed under the name it merely borrowed');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
    // The sandbox is shared across this file, so the fixture job must not
    // outlive the test that needed it.
    fs.rmSync(create.plistPath('fixtureborrowed'), { force: true });
  }
});

/**
 * ⚠️ THE POSITIVE CONTROL for the planned-model gate above, and it is not
 * optional. Every agent in a fresh sandbox has no job file, so `null` is what
 * the gate assertion would see whether the gate existed or not. This proves the
 * value is reachable at all — that a card entitled to it gets it.
 *
 * It also pins the FALLBACK ORDER, which is the behaviour Josh actually asked
 * about: a live model always wins, and the job is consulted only when there is
 * no live reading. The other way round would let a job file edited by hand
 * contradict the model an agent is demonstrably running.
 */
test('a tied card reports the model its job will start it on, and only when no live model was read', async () => {
  const status = require('./engine/status');
  const create = require('./engine/create');
  // ⚠️ A fixture name no real agent has — see the note in the gate test above.
  // This one writes and deletes a launchd job.
  fs.writeFileSync(create.plistPath('fixturetied'),
    create.plistFor('fixturetied', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'), 'utf8');
  // `-discord` is what ties a pane to the name: the same suffix `isNamedOurs`
  // requires before this server will read anything filed under it.
  status.setPaneSource(() => fleet.line({ session: 'fixturetied-discord', title: 'fixturetied' }));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const board = JSON.parse((await req('/api/status')).body);
    const card = (board.agents || []).find((a) => a.sessionName === 'fixturetied');
    assert.ok(card, 'the fixture did not produce a card');
    assert.equal(card.isNamedOurs, true, 'the fixture is not exercising the tied case');
    // No transcript in the sandbox, so there is no live model: exactly Josh's
    // freshly created agent, which reported "Unknown Model" while its own job
    // file said otherwise.
    assert.ok(!card.modelName, 'the fixture unexpectedly produced a live model');
    assert.equal(card.plannedModelName, 'Claude Opus 5',
      'a tied card did not report the model written into its own launchd job, '
      + 'which is the whole defect this field exists to close');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
    fs.rmSync(create.plistPath('fixturetied'), { force: true });
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
  status.setPaneSource(() => fleet.line({ session: 'angel', title: 'stranger' }));
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
  status.setPaneSource(() => fleet.line({ session: 'someone-else-discord' }));
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
  status0.setPaneSource(() => fleet.line({ session: 'someone-else-discord' }));
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
    // ⚠️ `stranger` is the TITLE. Typed as a tab-separated line it sat in the
    // CLAIM column, which is the one field that ties a session to a name — so
    // this fixture was one string away from tying the stranger it exists to
    // prove is untied. Named columns cannot make that mistake.
    status.setPaneSource(() => fleet.line({ session: strangerSession, title: 'stranger' }));
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
  status.setPaneSource(() => fleet.line({ session: 'zeta-discord', title: 'x' }));
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
    fleet.line({ session: 'Angel', title: 'unrelated work' }),
    fleet.line({ session: 'angel-discord', title: 'the real one' }),
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
    fleet.line({ session: 'tied-discord', title: 'working' }),
    fleet.line({ session: 'untied', title: 'working' }),
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
    fleet.line({ session: 'Angel', title: 'unrelated work' }),
    fleet.line({ session: 'angel-discord', title: 'the real one' }),
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

test('the detail panel withdraws the writes it cannot perform, and clears what it cannot show', async () => {
  // ⚠️ BEHAVIOURAL, not source-shape. The first version asserted that
  // `openDetail` mentions `isNamedOurs`, that the load line contains `if`, and
  // that a withdrawing function exists and is called. All four held while the
  // instruction editor stayed live holding the PREVIOUS agent's boot file —
  // it pinned the incomplete fix rather than the behaviour.
  //
  // So: run the real function against a fake DOM and look at what it leaves.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];

  const ids = ['d-file', 'd-remove', 'd-save', 'd-role', 'd-rename', 'd-instr', 'd-instr-save',
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

  // ⚠️ REAL CARDS, from the route the page actually reads. These were object
  // literals, and an object literal is free to carry fields `/api/status` does
  // not return — which is exactly how a whole feature shipped describing
  // members against a shape nothing produces. `test-support/fleet` arranges the
  // panes; the card comes back from the server.
  const board = fleet.install([
    fleet.stranger('Angel', { state: 'idle' }),
    fleet.agent('zeta', { state: 'idle' }),
  ]);
  let untiedCard;
  let tiedCard;
  try {
    const cards = JSON.parse((await req('/api/status')).body).agents;
    untiedCard = cards.find((a) => a.sessionName === 'Angel');
    tiedCard = cards.find((a) => a.sessionName === 'zeta');
  } finally {
    board.restore();
  }
  assert.ok(untiedCard && tiedCard, 'the control: the fixture really put both cards on the board');
  assert.equal(untiedCard.isNamedOurs, false, 'the control: the untied card is really untied');
  assert.equal(tiedCard.isNamedOurs, true, 'the control: the tied card is really tied');

  // Simulate the dangerous sequence: a tied agent's file is on screen, then an
  // untied card is opened.
  els['d-instr'].value = "the real agent's boot file";
  els['d-instr-foot'].hidden = false;
  const after = run(untiedCard, untiedCard.isNamedOurs);

  assert.equal(els['d-instr'].value, '',
    "the previous agent's instruction text was left on screen for a card we "
    + 'cannot tie to that name');
  assert.equal(els['d-instr'].disabled, true, 'the instruction editor stayed live');
  assert.equal(els['d-instr-save'].disabled, true, 'Save stayed live');
  assert.equal(els['d-instr-foot'].hidden, true, "the real agent's file path stayed on screen");
  assert.equal(after.INSTR_READY, false, 'the editor still believes it holds a loaded file');
  assert.equal(after.INSTR_VERSION, null, "the previous agent's version stamp survived");

  // `d-name` joined this list WITH the control, not after it: a new sibling
  // does not inherit its neighbours' guard just by sitting beside them.
  for (const id of ['d-file', 'd-remove', 'd-save', 'd-role', 'd-rename']) {
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
  run(tiedCard, tiedCard.isNamedOurs);
  for (const id of ['d-file', 'd-remove', 'd-save', 'd-role', 'd-rename', 'd-instr', 'd-instr-save']) {
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
    fleet.line({ session: 'Angel', title: 'unrelated work' }),
    fleet.line({ session: 'angel-discord', title: 'the real one' }),
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

    /**
     * ⚠️ THE REMOVAL ROUTES, which were added to this server after the gate was
     * built and were never brought under it.
     *
     * They are the most dangerous members of this list, because they do not
     * merely write a file: `jobFor('Angel')` resolves to the REAL agent's
     * `com.angel.discord.plist`, and a removal disables and boots it out. So a
     * bystander's `tmux new -s Angel` would have taken the operator's actual
     * agent off the air, permanently at the next login, from a screen that
     * offered them a live button to do it.
     *
     * ⚠️ Asserted through the ROUTE rather than only on the engine. An engine
     * test does not prove a route is wired, and this whole finding is that a
     * route was never wired to a gate that already existed.
     */
    for (const [method, path] of [['GET', '/api/agent/Angel/removal'], ['DELETE', '/api/agent/Angel/removal']]) {
      const res = await req(path, method === 'GET' ? undefined : { method });
      assert.notEqual(res.status, 200,
        `${method} ${path} was accepted under the untied card's own spelling, so a bystander `
        + "can disable the real agent's startup job");
      const body = JSON.parse(res.body);
      assert.ok(!body.ok, 'the removal was offered for a name the board will not vouch for');
      assert.match(body.because || body.error || '', /cannot confirm it is this agent/,
        'it refused without saying why, so the refusal reads as a bug rather than a guard');
    }

    // ⚠️ And the real agent stays writable under its own name, or the fix has
    // simply broken the feature — the direction a previous version of this
    // predicate got wrong.
    const ok = await req('/api/agent/angel/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'still editable' }),
    });
    assert.equal(ok.status, 200, 'the real agent became uneditable under its own name');

    // ⚠️ And removal still WORKS for the real agent under its own name, or the
    // gate has quietly deleted the feature instead of protecting it.
    const offered = await req('/api/agent/angel/removal');
    assert.equal(offered.status, 200, 'the gate refuses the real agent too, which removes the feature');
    assert.equal(JSON.parse(offered.body).ok, true, 'the real agent can no longer be removed under its own name');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('the create route refuses a name it could not address, and answers a bad body cleanly', async () => {
  // ⚠️ Driven through the ROUTE, because engine tests do not prove a route is
  // wired — and this route's catch path called a function from a different
  // branch, which would have thrown at runtime while the suite stayed green.
  const create = require('./engine/create');
  const calls = [];
  create.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  try {
    create.setDryRun(false);

    const bad = await req('/api/agents', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '_nope', role: 'pm' }),
    });
    assert.equal(bad.status, 400, 'a name the routes cannot address was accepted');
    assert.match(JSON.parse(bad.body).because, /letters, numbers/);
    assert.equal(calls.length, 0, 'a refused name still ran a command');

    // ⚠️ And the ERROR path, which is the one that would have thrown.
    const broken = await req('/api/agents', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(broken.status, 400, 'a malformed body did not answer cleanly');
    assert.ok(JSON.parse(broken.body).error, 'no readable error came back');
  } finally {
    create.setRunner(null);
  }
});

test('the roles route carries the copy the creation actually uses', async () => {
  // ⚠️ The screen must not invent its own blurb or first action. The words
  // someone reads while choosing have to be the words the agent is created
  // from, or the picker is describing something the product does not build.
  const roles = require('./engine/roles');
  const res = await req('/api/roles');
  assert.equal(res.status, 200);
  const got = JSON.parse(res.body).roles;

  // MENU roles only: `own` (menu: false) prefills the third radio and is
  // served whole in its own field, never in the grouped list (catalogue
  // 0ef34cc: 27 entries, 26 pickable).
  const menu = roles.ROLES.filter((r) => r.menu !== false);
  assert.equal(got.length, menu.length, 'the route drops or invents roles');
  assert.ok(!got.some((r) => r.key === 'own'), 'own leaked into the pickable menu');
  const ownServed = JSON.parse(res.body).own;
  assert.ok(ownServed && ownServed.instructions === roles.byKey('own').instructions,
    "the third radio's prefill is not the engine's own example, so the words a person reads are not the words the agent boots from");
  for (const r of got) {
    const real = roles.byKey(r.key);
    assert.ok(real, `the route served a role '${r.key}' that cannot be created`);
    assert.equal(r.blurb, real.blurb);
    assert.equal(r.firstAction, real.firstAction, 'the picker would show a first action the agent never gets');
    // ⚠️ And the CAUTION, which is the whole condition of Legal shipping: the
    // limit has to be readable at the moment of choosing, so it has to survive
    // the route. Served as null rather than omitted, so the screen never has to
    // guess whether a role has one.
    assert.equal(r.caution, real.caution || null,
      `the picker would show a different limit for ${r.key} than the role carries`);
  }
  const legal = got.find((r) => r.key === 'legal');
  assert.ok(legal, 'Legal is not being offered at all');
  assert.match(legal.caution, /not a lawyer|not legal advice/i,
    'Legal is offered without the sentence that made it shippable');
});

/**
 * Pull one brace-matched function out of the page's script and make it callable.
 *
 * The same trick the detail-panel test above uses, and for the same reason: the
 * page is a single file with no build step, so the only way to test its
 * behaviour is to run its real source. `prelude` supplies whatever the extracted
 * function closes over.
 */
function pageFnSource(name) {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  let start = script.indexOf('function ' + name);
  assert.ok(start > -1, name + ' vanished from the page');
  // An `async function` must keep its keyword: sliced off, the body's awaits
  // are a SyntaxError inside new Function and the extraction dies confusingly.
  if (script.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return script.slice(start, end);
}

/**
 * The source of a top-level `const NAME = { … };` table on the page.
 *
 * ⚠️ A sibling to `pageFnSource` rather than a second copy of the brace-matching
 * idea: the page's shared derivations live in const OBJECTS (`CARD_ST`,
 * `STATE_COPY`, `GLYPH`) as well as in functions, and a test that restated one
 * of those tables would be asserting its own copy rather than the product's.
 */
/* ⚠️ OBJECT **OR** ARRAY. This only matched `const NAME = {`, so lifting
   `DISC_TINTS` (an array) failed with "DISC_TINTS vanished from the page" --
   a message that describes a deletion when the const was sitting right there.
   Widened rather than worked around, because the misleading sentence was the
   real defect: the previous behaviour on an array const was to assert an
   untruth. Purely additive; every caller that worked before still matches the
   object arm first. */
function pageConstSource(name) {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  /* ⚠️ A REGEX, NOT indexOf, AND THAT IS THE SECOND HALF OF THE SAME BUG.
     After the array arm was added, `DISC_INKS` still "vanished" -- because it
     is written `const DISC_INKS  = [` with TWO spaces, and a fixed string
     cannot see that. A matcher that depends on incidental whitespace reports a
     deletion when the thing is sitting on the line it names. */
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*([{\\[])').exec(script);
  assert.ok(m, name + ' was not found on the page as an object or array const');
  const start = m.index;
  const open = m[1];
  const close = open === '{' ? '}' : ']';
  let depth = 0; let end = -1;
  for (let k = script.indexOf(open, start); k < script.length; k += 1) {
    if (script[k] === open) depth += 1;
    else if (script[k] === close) { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return script.slice(start, end) + ';';
}

function pageFunction(name, prelude = '') {
  // eslint-disable-next-line no-new-func
  return new Function(`${prelude}\n${pageFnSource(name)}\nreturn ${name};`)();
}

test('the creation screen only calls an agent made when the board can see it running', async () => {
  const boardCanSeeIt = pageFunction('boardCanSeeIt');

  // ⚠️ THE CONTROL, and it is the assertion that makes the rest mean anything.
  // A brand-new agent at its first prompt has nothing on screen saying what it
  // is doing, so it comes back `unknown` — the honest classification, and the
  // NORMAL state of a healthy thirty-second-old agent. A predicate that
  // rejected it would fail every successful creation while every negative case
  // below still passed, which is precisely the shape of a gate test that
  // passes for the wrong reason.
  // ⚠️ A REAL CARD for the brand-new agent, not a literal describing one. The
  // whole point of the control is that this is what the board really returns
  // thirty seconds after a creation, and only the board can say that.
  const board = fleet.install([fleet.agent('casey', { state: 'unknown' })]);
  let fresh;
  try {
    fresh = JSON.parse((await req('/api/status')).body).agents.find((a) => a.sessionName === 'casey');
  } finally {
    board.restore();
  }
  assert.ok(fresh, 'the control: the fixture really put the new agent on the board');
  assert.equal(fresh.state, 'unknown', 'the control: a new agent at its first prompt really does read unknown');
  assert.equal(fresh.isAgentSession, true);
  assert.equal(fresh.isNamedOurs, true);
  assert.equal(boardCanSeeIt(fresh), true,
    'a healthy new agent sitting at its first prompt is reported as not running');
  assert.equal(boardCanSeeIt({ ...fresh, state: 'idle' }), true);

  // Each field flipped in turn: a predicate that ignored any one of these would
  // still pass the control above.
  // ⚠️ `isAgentSession`, NOT `isFleetSession`. This asserted the latter, which
  // `status.isFleetSession` returns true for whenever `isNamedOurs` is true —
  // so the combination being pinned here (named ours, not a fleet session) is
  // one the API cannot produce, and this assertion controlled for NOTHING while
  // reading as coverage of the died-immediately case. `isAgentSession`
  // additionally requires a live Claude process, which is the real question,
  // and a claimed pane whose command tmux could not report does reach it.
  assert.equal(boardCanSeeIt({ ...fresh, isAgentSession: false }), false,
    'a session whose Claude is not running was reported as a working agent');
  assert.equal(boardCanSeeIt({ ...fresh, isNamedOurs: false }), false,
    'an agent the board cannot tie to this name was reported as made — that is '
    + 'the anonymous, unwritable card this branch exists to prevent');
  assert.equal(boardCanSeeIt({ ...fresh, state: 'stopped' }), false,
    'nothing is running in it and the screen said it was up');
  assert.equal(boardCanSeeIt(undefined), false,
    'an agent absent from the board entirely was reported as made');

  // ⚠️ And the CALL SITE. Proving the predicate is right says nothing about
  // whether the watch uses it: inlining a looser condition there would leave
  // every assertion above green with the screen lying again.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  // Brace-matched, like `pageFunction` above: slicing to a comment further down
  // the file meant that inserting any function between the two silently widened
  // the slice and weakened both assertions without failing anything.
  const watchStart = script.indexOf('async function watchForAgent');
  assert.ok(watchStart > -1, 'watchForAgent vanished');
  let d = 0; let watchEnd = -1;
  for (let k = script.indexOf('{', watchStart); k < script.length; k += 1) {
    if (script[k] === '{') d += 1;
    else if (script[k] === '}') { d -= 1; if (d === 0) { watchEnd = k + 1; break; } }
  }
  assert.ok(watchEnd > -1, 'could not find the end of watchForAgent');
  const body = script.slice(watchStart, watchEnd);
  assert.match(body, /boardCanSeeIt\s*\(/,
    'watchForAgent no longer asks boardCanSeeIt, so the definition of "it is '
    + 'running" has been forked');
  assert.ok(!/isNamedOurs/.test(body),
    'watchForAgent tests the tie itself again — one definition, or the two drift');
});

test('the creation screen reports a failed step as failed', () => {
  // ⚠️ A half-made agent is a real outcome, and the step list is the only place
  // a person can see WHICH half. A renderer that drew every reported step the
  // same way would turn `PARTIAL` into a screen full of ticks.
  // ⚠️ The REAL `tickLine`, not a stub. Stubbing it meant the words it adds for
  // a screen reader ("done: " / "failed: ") -- which exist precisely because the
  // glyph is aria-hidden and both states render in the same colour -- were
  // asserted nowhere, on the one screen whose job is showing WHICH half failed.
  const realTickLine = pageFunction('tickLine', 'function esc(s) { return String(s); }');
  const paintMade = pageFunction('paintMade', `
    const el = { innerHTML: '', textContent: '' };
    const document = { getElementById: () => el };
    function esc(s) { return String(s); }
    const tickLine = ${realTickLine.toString()};
    globalThis.__el = el;
  `);
  paintMade([
    { label: 'made its folder', ok: true },
    { label: 'started it', ok: false },
  ], { state: 'waiting', text: 'Waiting for the board to see it running' });

  const out = globalThis.__el.innerHTML;
  assert.match(out, /class="tick done".*made its folder/,
    'a step that worked was not shown as done');
  assert.match(out, /class="tick fail".*started it/,
    'a step the engine reported as FAILED was drawn as a success, which is the '
    + 'whole failure mode the step list exists to prevent');
  assert.match(out, /class="tick waiting".*Waiting for the board/,
    'the one line that is about the agent rather than about us went missing');

  // ⚠️ And in WORDS. The tick and the cross are aria-hidden and both states use
  // the same colour, so without these a screen reader hears "made its folder"
  // and "started it" identically whether or not they worked.
  assert.match(out, /done: <\/span>made its folder/, 'a successful step says nothing aloud');
  assert.match(out, /failed: <\/span>started it/,
    'a FAILED step is indistinguishable from a successful one to a screen reader');
});

test('a write another website could send is refused, whatever route it names', async () => {
  // ⚠️ MEASURED, not theorised. Before this guard, a page on any site could run
  //
  //     fetch('http://127.0.0.1:4317/api/agents', { method: 'POST',
  //       headers: { 'content-type': 'text/plain' },
  //       body: '{"name":"theirs","role":"pm"}' })
  //
  // and it worked: a POST with a text/plain body is a CORS *simple request*, so
  // no preflight is involved, and `Host` is the loopback address a legitimate
  // request also carries. Running exactly that against the real server created a
  // worker directory and installed a launchd job on this machine — an agent that
  // starts on every reboot with --dangerously-skip-permissions, planted by a
  // page the user merely visited.
  //
  // The create route's own comment claimed it "does not cross a new line"
  // because the server already had writes. It was wrong: every other write is
  // PUT or DELETE, which a browser always preflights, and this server answers
  // the preflight with a 404 carrying no CORS headers. POST was the first route
  // a stranger's page could reach.
  const create = require('./engine/create');
  const calls = [];
  create.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  try {
    for (const [label, headers] of [
      ['a form content type', { 'content-type': 'text/plain' }],
      ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }],
      ['a multipart form', { 'content-type': 'multipart/form-data' }],
      ['another site as its origin', { 'content-type': 'application/json', origin: 'https://evil.example' }],
      ['a sandboxed page', { 'content-type': 'application/json', origin: 'null' }],
    ]) {
      const res = await req('/api/agents', {
        method: 'POST', headers, body: JSON.stringify({ name: 'csrf-fixture', role: 'pm' }),
      });
      assert.equal(res.status, 403, `${label}: the write was accepted`);
      assert.equal(calls.length, 0, `${label}: a command ran for a request from another website`);
    }

    // ⚠️ AND ON A ROUTE THAT IS NOT THE NEW ONE. This test is named "whatever
    // route it names", and every case above targets /api/agents — so a
    // regression scoping the guard to that one path would leave it green.
    const otherRoute = await req('/api/agent/angel/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ role: 'theirs' }),
    });
    assert.equal(otherRoute.status, 403, 'the guard only covers the route it was written for');

    // ⚠️ ANOTHER PROGRAM ON THIS COMPUTER is not this board. Comparing the
    // hostname alone made every other loopback port same-site: a dev server
    // rendering somebody else's content, or an XSS in any other local app,
    // could have installed a launchd job from 127.0.0.1:3000.
    const otherPort = await req('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
      body: JSON.stringify({ name: 'csrf-fixture', role: 'pm' }),
    });
    assert.equal(otherPort.status, 403, 'a page on another local port was treated as this board');
    assert.equal(calls.length, 0, 'a command ran for a page on another local port');

    // ⚠️ THE CONTROL, in three parts, because a guard that refuses everything
    // passes every assertion above while breaking the product.
    //
    // The board's own write still goes through. The origin is built from the
    // ACTUAL base, not a hardcoded port: this server binds wherever it is told,
    // and a guard compared against a configured default would refuse every
    // legitimate write on every other port.
    const ours = await req('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(base).origin },
      body: JSON.stringify({ name: 'BAD NAME', role: 'pm' }),
    });
    assert.equal(ours.status, 400,
      'the board can no longer write to itself, so this guard has broken the product');

    // ...and so does the one write that is NOT JSON. The avatar upload PUTs an
    // IMAGE, and `saveAvatar` reads that content type to know the format, so a
    // guard written as "must be application/json" would have refused every
    // picture in the product while reading in review like the safer choice.
    const avatar = await req('/api/agent/angel/avatar', {
      method: 'PUT', headers: { 'content-type': 'image/png' }, body: 'not-a-real-png',
    });
    assert.notEqual(avatar.status, 403,
      'the avatar upload is refused as cross-site, so the guard is stricter than the threat');

    // ...and so does a client that is not a browser at all: `curl` and the
    // board's own tooling send no Origin. What covers THAT case is the Origin
    // arm being absent, not the content type -- this used to be commented as
    // though the content-type arm were doing the work.
    const plain = await req('/api/agents', {
      method: 'POST', body: JSON.stringify({ name: 'BAD NAME', role: 'pm' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.notEqual(plain.status, 403,
      'a request with no Origin was refused, which breaks every non-browser caller');

    // ⚠️ And a SAME-ORIGIN post with a form content type is allowed, which is
    // the early return the guard makes for a request whose origin it has
    // already recognised. Nothing sends one today; without this the line can be
    // deleted with the suite green, and it is exactly the "trap for the next
    // route somebody adds" its own comment names.
    const sameOriginForm = await req('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: new URL(base).origin },
      body: JSON.stringify({ name: 'BAD NAME', role: 'pm' }),
    });
    assert.notEqual(sameOriginForm.status, 403,
      'the board is refused its own write for a content type, which the Origin has already cleared');
  } finally {
    create.setRunner(null);
  }
});

test('the create route answers a real creation with the record the screen is built on', async () => {
  // ⚠️ The route test beside this one is named "makes an agent" and never makes
  // one — both its cases assert 400. So the 200 answer, which is the ENTIRE
  // contract the creation screen consumes (`outcome`, the ordered `steps` list
  // it draws, and the `firstAction` it offers), had no end-to-end coverage at
  // all. It was unsafe to write until this file sandboxed the LaunchAgents
  // directory; it is safe now, so it exists.
  const create = require('./engine/create');
  const status = require('./engine/status');
  const roles = require('./engine/roles');
  const calls = [];
  create.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  // ⚠️ LEAVE DRY-RUN, or this proves less than it says. `setRunner(null)` in the
  // previous test's `finally` re-arms it, so without this every write is
  // suppressed, every step reports ok unconditionally, and the test would stay
  // green with every filesystem write in `createAgent` broken -- while its own
  // comment claims the sandbox exists so the writes can happen.
  create.setDryRun(false);
  status.setPaneSource(() => '');
  try {
    const res = await req('/api/agents', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // ⚠️ `claudeBin` here is a probe: the route must IGNORE it. If it were
      // passed through, this creation would be refused for a missing program,
      // so the 200 below is what proves a caller cannot choose the executable
      // that launchd will run on every reboot.
      body: JSON.stringify({ name: 'route-made', role: 'writer', claudeBin: '/nope/claude' }),
    });
    assert.equal(res.status, 200, 'a legitimate creation was refused');
    const body = JSON.parse(res.body);
    assert.equal(body.outcome, 'created', body.because);

    // The screen draws exactly this list, in this order, and marks each one.
    assert.ok(Array.isArray(body.steps) && body.steps.length >= 4, 'no step record came back');
    for (const s of body.steps) {
      assert.equal(typeof s.label, 'string', 'a step with no label would draw as a blank line');
      assert.equal(typeof s.ok, 'boolean', 'a step with no verdict cannot be drawn as done or failed');
    }
    assert.ok(body.steps.some((s) => /keep running/.test(s.label)), 'the job step is missing from the record');

    // ⚠️ And the first action is the ROLE's own words, not something the screen
    // invented — the whole point of serving it from the same library the agent
    // is created from.
    assert.equal(body.firstAction, roles.byKey('writer').firstAction,
      'the screen would offer a first action this agent was not created with');

    // ⚠️ The route must NOT let a caller choose the programs. `claudeBin` in the
    // body above is ignored: honouring it would let any local page name any
    // executable to be launched under launchd forever.
    const started = calls.find((c) => /launchctl$/.test(c[0]));
    assert.ok(started, 'the job was never loaded, so nothing would start');

    // And the files are really there, in the sandbox this file sets up.
    assert.ok(fs.existsSync(create.instructionFile('route-made')), 'no instruction file was written');
    assert.ok(fs.existsSync(create.supervisorPath()), 'the shared supervisor was not installed');
    assert.ok(fs.existsSync(create.plistPath('route-made')), 'no launchd job was written');
  } finally {
    create.setRunner(null);
    status.setPaneSource(null);
  }
});

test('a creation with projects picked really lands on those projects, and the response says so', async () => {
  // ⚠️ This test exists because its absence hid a dead feature: the attach
  // block read `result.sessionName`, a field the CREATED result has never
  // carried, so every attach refused with "choose an agent" while 775 tests
  // stayed green -- nothing drove POST /api/agents with a `projects` body.
  // The assertions here go through the wire AND then read the membership
  // back from the engine, so a wrong field name (or a wrong key shape) can
  // never again fail silently.
  const create = require('./engine/create');
  const status = require('./engine/status');
  const projects = require('./engine/projects');
  const calls = [];
  create.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  create.setDryRun(false);
  status.setPaneSource(() => '');
  try {
    const made = projects.create({ name: 'Attach Fixture' });
    const res = await req('/api/agents', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // The typed name carries a capital ON PURPOSE: the board files agents
      // under the slug, so an attach keyed on anything but `result.name`
      // (say, the typed form) would record a member no roster will ever
      // match.
      body: JSON.stringify({ name: 'Route-Attached', role: 'writer', projects: [made.id] }),
    });
    assert.equal(res.status, 200, 'a legitimate creation with projects was refused');
    const body = JSON.parse(res.body);
    assert.equal(body.outcome, 'created', body.because);
    assert.ok(Array.isArray(body.projects), 'the attach outcomes never came back to the screen');
    assert.equal(body.projects.length, 1, 'one project was asked for, a different count came back');
    assert.equal(body.projects[0].added, true,
      'the attach refused: ' + (body.projects[0].because || '(no reason given)'));
    // And the membership is REALLY recorded, under the slug the board uses.
    // readAll, not get: get() enriches members into described objects, and
    // this assertion is about what was PERSISTED.
    const after = projects.readAll().find((p) => p.id === made.id);
    assert.ok((after.agents || []).includes('route-attached'),
      'the response said added but the project does not list the agent');
    // The told verdict is honestly NOT_TRIED at create time: the session
    // launchd will start does not exist yet, so a sync here would store
    // could_not against every create-with-project (the race this route's
    // comment documents). The creation screen re-fires the tell through the
    // member route once the board can see the agent.
    assert.equal(body.projects[0].told && body.projects[0].told.state, 'not_tried',
      'the create-time verdict should be not_tried, not a stored failure');
  } finally {
    create.setRunner(null);
    status.setPaneSource(null);
  }
});

test('a create naming an unknown or malformed project refuses BEFORE any write', async () => {
  // The route's loudest claim ("validated HERE, BEFORE the engine writes
  // anything") held only by comment: moving the validation below createAgent
  // would have kept the suite green. These cases pin the ordering to the
  // filesystem the same way the engine's refusals-leave-no-trace tests do.
  const create = require('./engine/create');
  const status = require('./engine/status');
  const calls = [];
  create.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  create.setDryRun(false);
  status.setPaneSource(() => '');
  try {
    for (const [label, projects] of [
      ['an unknown id', ['no-such-project']],
      ['a non-array', 'oops'],
      ['a non-string entry', [42]],
      ['a blank entry', ['   ']],
    ]) {
      const res = await req('/api/agents', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'never-made', role: 'writer', projects }),
      });
      assert.equal(res.status, 400, `${label}: the create was not refused`);
      assert.ok(!fs.existsSync(create.workerDir('never-made')),
        `${label}: the refusal left a worker folder behind`);
      assert.equal(calls.length, 0, `${label}: a command ran for a refused create`);
    }
  } finally {
    create.setRunner(null);
    status.setPaneSource(null);
  }
});

test('the roles payload serves the models list, and the mark family map is whole-name seeded', async () => {
  // Route half: the model select is built from this payload, and until now
  // nothing asserted it -- a route that stopped serving `models` would strand
  // the select empty with the suite green.
  const rolesRes = await req('/api/roles', {});
  assert.equal(rolesRes.status, 200);
  const payload = JSON.parse(rolesRes.body);
  assert.ok(Array.isArray(payload.models) && payload.models.length >= 3, 'no models list came back');
  const defaults = payload.models.filter((m) => m.default);
  assert.equal(defaults.length, 1, 'exactly one model must be preselected');
  assert.equal(defaults[0].key, 'sonnet', 'the preselected model is not the documented default');
  for (const m of payload.models) {
    // key/label/default ONLY: the payload deliberately does not carry the
    // model args -- the client sends a key and the engine owns the mapping,
    // so a page can never name the executable-facing id itself.
    assert.deepEqual(Object.keys(m).sort(), ['default', 'key', 'label'],
      `model ${m.key} serves fields the screen must not receive`);
    assert.equal(typeof m.label, 'string');
  }
  // The full model ids live in the ENGINE list the route maps from.
  const engineModels = require('./engine/create').MODELS;
  for (const m of payload.models) {
    const src = engineModels.find((x) => x.key === m.key);
    assert.ok(src && /^claude-/.test(src.arg), `engine model ${m.key} lacks a full model id`);
  }

  // Extraction half, same harness as the other page-logic tests: the mark
  // family function is pulled out of the page source and exercised directly,
  // because the last dead-code defect on this screen lived in exactly this
  // "only reachable through the browser" layer.
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const famsAt = page.indexOf('const MARK_FAMS');
  const famForAt = page.indexOf('function markFamFor');
  assert.ok(famsAt > -1 && famForAt > -1, 'the mark generator moved; re-anchor this test');
  const sliceEnd = (start) => {
    let depth = 0;
    for (let k = page.indexOf('{', start); k < page.length; k += 1) {
      if (page[k] === '{') depth += 1;
      else if (page[k] === '}') { depth -= 1; if (depth === 0) return k + 1; }
    }
    return -1;
  };
  const famsEnd = page.indexOf('];', famsAt);
  const famForEnd = sliceEnd(famForAt);
  assert.ok(famsEnd > -1 && famForEnd > -1, 'could not slice the mark generator');
  // eslint-disable-next-line no-new-func
  const markFamFor = new Function(
    `${page.slice(famsAt, famsEnd + 2)}\n${page.slice(famForAt, famForEnd)}\nreturn markFamFor;`)();

  const fams = markFamFor('leo');
  assert.ok(Array.isArray(fams) && fams.length >= 3, 'a family is a palette, not a colour');
  assert.deepEqual(markFamFor('leo'), markFamFor('leo'), 'the family map is not deterministic');
  // ⚠️ leo vs LAURA, not leo vs lucy: measured first, leo and lucy genuinely
  // collide under whole-name FNV (both bucket 10 of 14), so pinning them
  // unequal would fail on correct code. laura differs, and letter-only
  // seeding (the original bug: every l-name one image) would collide it.
  assert.notDeepEqual(markFamFor('leo'), markFamFor('laura'),
    'two different l-names share a family: the letter-only seeding bug is back');
  assert.notDeepEqual(markFamFor('casey'), markFamFor('Casey'),
    'case-differing names measured to different buckets; sameness means the seed changed');
});

test('the suggested default role is the project manager, by name and not by position', () => {
  // ⚠️ The plan says "Project manager is the suggested default", and the screen
  // implemented it POSITIONALLY: the first row, and `ROLES[0]` on a second
  // visit. Reordering `engine/roles.js` -- an edit nobody would connect to a
  // product decision -- silently changes what a person accepts by pressing
  // Continue, and could make it Legal or Finance: the two roles whose limits
  // are carefully stated in two places are exactly the two that must never be
  // the silent default.
  const roles = require('./engine/roles');
  assert.ok(roles.byKey('pm'),
    'the catalogue no longer carries pm, so the recommended radio preselects '
    + 'whatever the fallback finds');

  // The 2026-08-16 picker chooses BY NAME (`roleByKey('pm')`), which is what
  // this test's title always wanted: the old positional pin
  // (`pickRole(ROLES[0].key)`) kept the decision safe only as long as nobody
  // reordered engine/roles.js. Now reordering the catalogue cannot change
  // what a person accepts by pressing Continue.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  // ⚠️ Anchored to the ASSIGNMENT and to the default MODE, not to any
  // occurrence of the helper: `roleByKey('pm')` also appears in buildPicker,
  // so a bare substring match stayed green under both mutations it exists to
  // stop (review round 1 proved it: a positional PICKED assignment and a
  // pickMode('list') default each passed the loose pin).
  assert.match(script, /PICKED = \(roleByKey\('pm'\)/,
    'the default assignment no longer picks by name; a positional default '
    + 'silently changes what Continue accepts when the catalogue reorders');
  assert.match(script, /pickMode\('pm'\)/,
    'nothing arms the recommended mode by default any more, so the screen '
    + 'opens on whatever mode survived the last edit');
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
  const summarise = (counts, onAgents = true) => {
    const el = { textContent: '' };
    const document = { getElementById: () => el };
    // ⚠️ The slice INCLUDES the line that writes the summary. The first version
    // stopped just before it and re-implemented the join in the harness -- so a
    // mutation that trimmed the notice back off that very line stayed green,
    // because the harness was joining its own way. A test harness that
    // reconstructs the behaviour it is testing is the same defect as a
    // source-shape assertion, one level in.
    const from = script.indexOf('const bits = [');
    /* stage 2 of the pack rebuild routed the write through `sumEl` (the
       residual summary hides itself when empty), so the end anchor follows:
       the slice still INCLUDES the write and the join, per the lesson above. */
    const write = script.indexOf('sumEl.textContent = bits.join');
    const end = script.indexOf('\n', script.indexOf('sumEl.hidden')) + 1;
    // The write must sit INSIDE the slice: this is the guard the old end
    // anchor gave for free, and without it a slice that stops short would
    // re-create the reconstructed-join defect the comment above records.
    assert.ok(write > from && write < end, 'the summary write fell outside the extracted slice');
    const body = script.slice(from, end);
    // eslint-disable-next-line no-new-func
    // onAgentsTab is injectable: the write is tab-gated (the residual
    // notice must not float beside Settings on the poll), so the harness
    // drives both sides of that gate.
    new Function('document', 'c', 'onAgentsTab', body)(document, counts, () => onAgents);
    return el;
  };

  // ⚠️ Every other count is non-zero on purpose. With them at zero the notice is
  // one of only two entries, so a mutation that trims the summary to its first
  // few parts keeps it by accident and this test passes without meaning to. The
  // notice has to be pinned where it actually sits: LAST, after everything else
  // the line can carry.
  // ⚠️ THIS PROTECTION IS NOW WEAKER THAN IT READS: the summary lost its
  // unknown-memory clause on this branch, so only two bits remain and the notice
  // cannot be placed anywhere but last. The `unknownFullness: 3` below is inert.
  // Left rather than deleted because the engine still computes and ships the
  // count; if a clause for it returns, the fixture is ready and so is the
  // protection.
  const partial = summarise({ total: 12, needsYou: 2, unknown: 1, unknownFullness: 3, unreadableLines: 1 });
  assert.match(partial.textContent, /could not read/,
    'the board shows what it managed to parse as the whole machine, with nothing '
    + 'on screen saying agents are missing from it');
  assert.match(partial.textContent, /1 /, 'the notice does not say how many lines were lost');
  // The harness-proof (assert presence before absence) rides HERE now: a
  // rendered notice above proves the extracted block really ran.
  assert.equal(partial.hidden, false, 'a summary with residual notices must show itself');

  // ⚠️ THE TAB GATE, both sides. The poll runs on every tab; without the
  // gate a residual notice floats beside Settings within five seconds of
  // leaving the board (found live on the stage-3 build). Same shape as
  // paintRemoved's gate, and asserted with the same bits that just proved
  // the notice renders -- so this cannot pass vacuously.
  const elsewhere = summarise({ total: 12, needsYou: 2, unknown: 1, unknownFullness: 3, unreadableLines: 1 }, false);
  assert.equal(elsewhere.hidden, true,
    'the residual summary leaks onto other tabs: the poll re-reveals it off the agents tab');

  /* ⚠️ THE CONTROL, updated with the stage-2 pack rebuild: the headline
     counts moved to the stats tiles, so #summary is RESIDUAL-ONLY -- on a
     clean board its correct output is EMPTY and it hides itself. The old
     control asserted "12 agents" appears, which pinned the retired
     sentence; the positive claim now is emptiness PLUS the self-hide, so a
     mutation that leaves a permanent warning (or a permanently visible
     empty box) still fails. */
  const clean = summarise({ total: 12, needsYou: 0, unknown: 0, unknownFullness: 0, unreadableLines: 0 });
  assert.doesNotMatch(clean.textContent, /could not read/,
    'a healthy board carries a permanent warning about unreadable lines');
  assert.equal(clean.textContent, '', 'the residual-only summary invented copy on a clean board');
  assert.equal(clean.hidden, true, 'an empty summary must hide itself, not sit as a blank line');
});

test('the stats tiles count the real fleet, and the alert tile hides at zero', () => {
  /* ⚠️ BEHAVIOURAL, same harness discipline as the summary test above: the
     tile writes are tick-level wiring no other test reads -- the
     working/idle filters and the alert tile's hide-at-zero were computed in
     code nothing drove, which is the exact condition the renderer test
     names as the reason it exists. */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];

  const drive = (agents, counts) => {
    const el = () => ({ textContent: '', hidden: undefined });
    const els = {
      'st-agents': el(), 'st-working': el(), 'st-idle': el(),
      'st-attn': el(), 'st-attn-tile': el(),
    };
    // The slice INCLUDES every tile write (the summary test's lesson: a
    // harness that stops short of the write reconstructs the behaviour).
    const from = script.indexOf('const c = data.counts;');
    const write = script.indexOf("document.getElementById('st-attn-tile').hidden = !c.needsYou;");
    const end = script.indexOf('\n', write) + 1;
    assert.ok(from > -1 && write > from && write < end,
      'the tile writes fell outside the extracted slice');
    // eslint-disable-next-line no-new-func
    new Function('document', 'data', script.slice(from, end))(
      { getElementById: (id) => els[id] }, { agents, counts });
    return els;
  };

  // ⚠️ Mixed states on purpose: needs_you and unknown agents sit in the
  // fleet so a filter that counts "not working" as idle (or vice versa)
  // cannot agree with these pins by accident.
  const fleet = [
    { state: 'working' }, { state: 'working' }, { state: 'working' },
    { state: 'idle' }, { state: 'idle' },
    { state: 'needs_you' }, { state: 'unknown' },
  ];
  const live = drive(fleet, { total: 7, needsYou: 1 });
  assert.equal(live['st-agents'].textContent, '7', 'the agents tile stopped carrying the full-fleet total');
  assert.equal(live['st-working'].textContent, '3', 'the working tile does not count exactly the working agents');
  assert.equal(live['st-idle'].textContent, '2', 'the idle tile does not count exactly the idle agents');
  assert.equal(live['st-attn'].textContent, '1', 'the needs-you tile lost its count');
  assert.equal(live['st-attn-tile'].hidden, false, 'a nonzero needs-you must show the alert tile');

  const calm = drive(fleet.filter((a) => a.state !== 'needs_you'), { total: 6, needsYou: 0 });
  assert.equal(calm['st-attn-tile'].hidden, true,
    'the alert tile must hide at zero: a red-bordered zero teaches people to ignore red');
});

test('a failed poll blanks the stats tiles instead of asserting the last fleet it saw', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];

  // ⚠️ Seeded with a LAST-SUCCESS picture first (presence before absence):
  // the defect this pins is precisely stale numbers surviving the failure,
  // so the tiles must demonstrably hold numbers before the catch runs.
  const el = (t) => ({ textContent: t, hidden: undefined, innerHTML: '' });
  const els = {
    grid: el(''), alist: el(''),
    'st-agents': el('14'), 'st-working': el('9'), 'st-idle': el('4'), 'st-attn': el('1'),
    'st-attn-tile': { textContent: '', hidden: false, innerHTML: '' },
    // The residual summary is seeded with a last-tick claim too: it sits
    // directly under the tiles and carries the same kind of number.
    summary: { textContent: '2 we could not read at all, so some agents may be missing', hidden: false },
  };
  const from = script.indexOf("checked.className = 'checked stamp stale';");
  const write = script.indexOf('sumFail.hidden = true;');
  const end = script.indexOf('\n', write) + 1;
  assert.ok(from > -1 && write > from && write < end,
    'the failure-path tile blanking fell outside the extracted slice');
  const checked = { className: '', innerHTML: '' };
  // eslint-disable-next-line no-new-func
  new Function('document', 'checked', 'esc', 'err', script.slice(from, end))(
    { getElementById: (id) => els[id] }, checked, (s) => String(s), { message: 'boom' });

  // The rendered failure card proves the extracted block really ran.
  assert.match(els.grid.innerHTML, /cannot read the agents/,
    'the failure card never painted, so nothing below can mean anything');
  assert.match(els.alist.innerHTML, /cannot read the agents/,
    'the failure card must reach both containers, whichever layout is up');
  for (const id of ['st-agents', 'st-working', 'st-idle', 'st-attn']) {
    assert.equal(els[id].textContent, '?',
      `${id} still asserts a count beside "we cannot see them" -- a headline number the failed poll cannot stand behind`);
  }
  assert.equal(els['st-attn-tile'].hidden, true,
    'the alert tile must hide on a blind poll: red is reserved for a known alarm');
  assert.equal(els.summary.textContent, '',
    'the residual summary still asserts last-tick counts beside the failure card');
  assert.equal(els.summary.hidden, true,
    'a blanked summary must also hide, not sit as an empty line under the tiles');
});

test('the detail panel carries the explanation the card gave up', () => {
  /* ⚠️ The pack split moved the why-line off the card ("the card carries
     signals, the panel carries explanation") -- so the panel MUST carry it,
     or `because`, the board's stated reason for its belief about an agent,
     appears nowhere in the UI at all while the server still ships it. */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const drive = (because) => {
    // Seeded shown-and-full (presence before absence): the empty case must
    // demonstrably CLEAR and HIDE a line that was carrying a sentence.
    const el = { textContent: 'seeded', hidden: false };
    const from = script.indexOf("const why = document.getElementById('d-why');");
    const write = script.indexOf('why.hidden = !why.textContent;');
    const end = script.indexOf('\n', write) + 1;
    assert.ok(from > -1 && write > from && write < end,
      'the why write fell outside the extracted slice');
    // eslint-disable-next-line no-new-func
    new Function('document', 'a', script.slice(from, end))(
      { getElementById: () => el }, { because });
    return el;
  };
  const told = drive('we could not read the pane');
  assert.equal(told.textContent, 'we could not read the pane',
    'the panel does not show the reason the board holds for its belief');
  assert.equal(told.hidden, false, 'a present explanation must be visible');
  const healthy = drive(undefined);
  assert.equal(healthy.textContent, '', 'a missing because must clear the seeded text, not keep it');
  assert.equal(healthy.hidden, true, 'an empty explanation must hide its line, not sit as a grey gap');
});

test('the settings screen renders the engine\'s three answers, and offers only what can work', () => {
  /* Scrappy-pass pin (pack view K): the settings renderers are pure
     functions like card()/lrow(), driven here without a server. Three
     claims: the three-answer rule survives the trip to CSS classes, engine
     text cannot break out of the markup, and the account row keeps
     not-connected and could-not-check apart (different claims, per the
     engine's own design). */
  // ⚠️ The const maps come from the PAGE, not a copy in this prelude: a
  // check containing a copy cannot fail when the page's mapping drifts
  // (the repo's own recorded lesson).
  const rawPage = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const pageScript = rawPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const constLine = (name) => {
    const at = pageScript.indexOf('const ' + name + ' = ');
    assert.ok(at > -1, name + ' vanished from the page');
    return pageScript.slice(at, pageScript.indexOf('\n', at) + 1);
  };
  const escSlice = (() => {
    const at = pageScript.indexOf('function esc(');
    let depth = 0; let end = -1;
    for (let k = pageScript.indexOf('{', at); k < pageScript.length; k += 1) {
      if (pageScript[k] === '{') depth += 1;
      else if (pageScript[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
    }
    return pageScript.slice(at, end);
  })();
  const chkRow = pageFunction('chkRow', constLine('CHK_CLASS') + constLine('CHK_MARK') + escSlice);
  assert.match(chkRow({ state: 'ok', title: 'T', detail: 'D' }), /class="chk ok"/);
  assert.match(chkRow({ state: 'attention', title: 'T', detail: 'D' }), /class="chk att"/);
  assert.match(chkRow({ state: 'unknown', title: 'T', detail: 'D' }), /class="chk unk"/);
  assert.match(chkRow({ state: 'martian', title: 'T', detail: 'D' }), /class="chk unk"/,
    'an unrecognised check state must degrade to could-not-check, never to fine');
  const hostile = chkRow({ state: 'ok', title: '<img src=x onerror=1>', detail: 'D' });
  assert.doesNotMatch(hostile, /<img src=x/, 'an engine title reached the settings DOM as a live tag');
  assert.match(hostile, /&lt;img/, 'CONTROL: the escaped title is absent, so the tag assertion proves nothing');

  // accountRow closes over chkRow and esc; hand it their REAL page sources
  // via the prelude (a stub would reconstruct the grammar under test).
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const slice = (name) => {
    let start = script.indexOf('function ' + name);
    assert.ok(start > -1, name + ' vanished from the page');
    let depth = 0; let end = -1;
    for (let k = script.indexOf('{', start); k < script.length; k += 1) {
      if (script[k] === '{') depth += 1;
      else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
    }
    return script.slice(start, end);
  };
  const accountRow = pageFunction('accountRow',
    constLine('CHK_CLASS') + constLine('CHK_MARK')
    + slice('esc') + '\n' + slice('chkRow'));
  assert.match(accountRow({ state: 'connected', plan: 'Claude Max 20x' }), /Claude Max 20x · connected/,
    'a connected account does not show its plan');
  assert.match(accountRow({ state: 'unknown', because: 'we could not read the file' }), /class="chk unk"/,
    'could-not-check rendered as a definite not-connected, which is a different claim');
  // `none` is the engine's real not-connected state (subscription.js STATE).
  assert.match(accountRow({ state: 'none', because: 'no subscription found' }), /class="chk att"/,
    'a real not-connected must draw attention, not the could-not-look grey');
  // The null leg is the CATCH path (the /api/status fetch failed) and the
  // one place a definite "not connected" would be a lie about a failed read.
  const failed = accountRow(null);
  assert.match(failed, /class="chk unk"/,
    'a failed status read renders as a definite not-connected, which sends someone to buy a subscription they have');
  assert.match(failed, /could not check the connection/i,
    'CONTROL: the failed-read row lost its could-not-check sentence');
});

test('the detail memory box reads the same derivations as the board, and stays honest at unknown', () => {
  /* Scrappy-pass pin (pack view B): memoryBox is a READING off memBand/
     pctOf -- the same functions the grid and list read -- so this page
     cannot disagree with the board about how full an agent is. */
  /* ⚠️ The derivations come from the PAGE (a prelude copy cannot fail when
     the page's memBand drifts). NEARLY_FULL..pctOf is one contiguous block
     in the page, sliced whole with an anchors-landed guard. */
  const rawPage = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const pageScript = rawPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const from = pageScript.indexOf('const NEARLY_FULL');
  const end = pageScript.indexOf('\n}', pageScript.indexOf('function pctOf(')) + 2;
  assert.ok(from > -1 && end > from, 'the shared memory derivations fell outside the extracted slice');
  const escAt = pageScript.indexOf('function esc(');
  const escEnd = pageScript.indexOf('\n}', escAt) + 2;
  const memoryBox = pageFunction('memoryBox',
    pageScript.slice(from, end) + '\n' + pageScript.slice(escAt, escEnd));
  const at80 = memoryBox({ name: 'leo', context: { percent: 80 } });
  assert.match(at80, /<i class="high" style="width:80%"/, 'the box bar disagrees with the board at the shared threshold');
  assert.match(at80, /nearly full/i, 'a nearly-full agent is not told what happens next');
  assert.match(memoryBox({ name: 'leo', context: { percent: 79 } }), /Room to spare/,
    'below the threshold the sentence must not warn');
  const unk = memoryBox({ name: 'leo', context: { percent: null } });
  assert.match(unk, /bar unknown/, 'an unknown percent must draw the dashed unknown, never a guessed bar');
  assert.match(unk, /not the same as it being empty/, 'the unknown sentence lost its honesty clause');
  assert.doesNotMatch(memoryBox({ name: '<img src=x>', context: { percent: null } }), /<img src=x/,
    'an agent name reached the memory box as a live tag');
});

test('the detail meta line keeps the machine-name disclosure the card gave up', () => {
  /* ⚠️ The SECOND instance of the removal pattern in one branch (Mona
     Lisa's check, 2026-08-17): a removal is two changes, and only one of
     them is visible where you made it. The machine-name chip left the
     cards on Josh's audience ruling with the fact promised to the detail
     meta line; the code kept that promise, but nothing held it -- a quiet
     revert of the meta-line half would have passed the whole suite, which
     is exactly how the because sentence vanished. */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  // The REAL modelLine, because the meta line routes through it: a stub
  // here would reconstruct the derivation this line exists to share.
  const modelLine = pageFunction('modelLine', pageConstSource('CARD_ST') + '\n' + pageFnSource('cardStOf'));
  // ⚠️ THE REAL roleLine TOO, and for a stronger reason than modelLine's. This
  // line used to inline `a.profile && a.profile.role || a.role`, which was
  // roleLine's body BEFORE roleLine learned to sentence-case a parsed role — so
  // the card read "Archive worker" and the panel you reached by clicking it
  // read "archive worker". A stub here would let that divergence back in
  // silently, which is precisely what a shared derivation is for.
  const roleLine = pageFunction('roleLine');
  // ⚠️ And the REAL runsOnLine, for the strongest reason of the three: the meta
  // line and the Runs on box below it must name the SAME model. This line used
  // to call `modelLine` directly, which prefers the transcript reading, while
  // the box prefers the job's — so a stopped agent whose two readings disagreed
  // had two elements naming one fact differently, six lines apart.
  const runsOnLine = pageFunction('runsOnLine',
    pageFnSource('modelLine') + '\n' + pageConstSource('CARD_ST') + '\n' + pageFnSource('cardStOf'));
  const drive = (card) => {
    const el = { textContent: 'seeded' };
    // `runs` is hoisted above the meta line so the meta line and the Runs on box
    // read ONE evaluation; the slice has to start there or `runs` is undefined.
    const metaAt = script.indexOf("document.getElementById('d-meta').textContent =");
    const from = script.lastIndexOf('const runs = runsOnLine(a);', metaAt);
    const write = script.indexOf(".filter(Boolean).join(' · ');", from);
    const end = script.indexOf('\n', write) + 1;
    assert.ok(from > -1 && write > from && write < end,
      'the meta-line write fell outside the extracted slice');
    // eslint-disable-next-line no-new-func
    new Function('document', 'a', 'modelLine', 'roleLine', 'runsOnLine', script.slice(from, end))(
      { getElementById: () => el }, card, modelLine, roleLine, runsOnLine);
    return el.textContent;
  };
  const surfaced = drive({ role: 'archive worker', modelName: 'Claude Opus 5', nameDerived: false, state: 'working' });
  assert.match(surfaced, /shown by its machine name/,
    'a display name that IS the machine name carries no disclosure on the panel');
  assert.match(surfaced, /Archive worker · Claude Opus 5 · /,
    'CONTROL: the meta line lost its role and model, so the disclosure assertion floats free');
  // ⚠️ CAPITAL A, and that is the assertion rather than an incidental. The
  // fixture role is lower-case `archive worker`; the panel must render it the
  // way the CARD does, which is sentence-cased through roleLine. Written as its
  // own assertion so the reason survives if the control line above is ever
  // reworded.
  assert.match(surfaced, /^Archive worker/,
    'the panel rendered a parsed role in different capitals from the card that '
    + 'links to it, which is the second-definition drift roleLine exists to end');
  const named = drive({ role: 'archive worker', modelName: 'Claude Opus 5', nameDerived: true, state: 'working' });
  assert.doesNotMatch(named, /machine name/,
    'an agent with a real display name is told it is shown by its machine name');
  // The panel reads the SAME model derivation as both board renderers: a
  // provider-less name gets the same provider-first treatment everywhere,
  // and a missing name is the card's honest "Unknown Model", not an
  // omission.
  // `R`, not `r`: a one-character parsed role is sentence-cased like any other,
  // which is the boundary case for a `charAt(0).toUpperCase()` on a length-1
  // string and is worth having land here rather than nowhere.
  assert.match(drive({ role: 'r', modelName: 'Fable 5', nameDerived: true, state: 'working' }), /R · Claude Fable 5/,
    'the panel model line diverged from the card on a provider-less name');
  assert.match(drive({ role: 'r', modelName: null, nameDerived: true, state: 'unknown' }), /R · Unknown Model/,
    'a missing model is silently omitted on the panel while the card says Unknown Model');
});

test('the narrow-screen menu keeps the keyboard: forward in on open, back to the burger on choose and Escape', () => {
  /* ⚠️ The menu precedes its trigger in the DOM (pack order, surfaced to the
     pack rather than reordered here), and it display:none's on close -- two
     shapes that each strand a keyboard. These are DRIVEN, not shape-asserted:
     the listeners run against a stub DOM and the assertions read where focus
     actually landed. */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const from = script.indexOf("document.getElementById('tabs').addEventListener('click'");
  const chooseGuard = script.indexOf('if (wasOpen) b.focus();');
  const escGuard = script.indexOf('b.focus();', script.indexOf('drops to <body>'));
  const end = script.indexOf('});', escGuard) + 3;
  assert.ok(from > -1 && chooseGuard > from && escGuard > chooseGuard && end > escGuard,
    'the burger listener block was not found where expected');

  const mkBtn = (dataset = {}) => {
    const n = {
      attrs: {}, focused: 0, dataset, listeners: {},
      addEventListener(t, fn) { n.listeners[t] = fn; },
      setAttribute(k, v) { n.attrs[k] = v; },
      getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
      focus() { n.focused += 1; },
      getClientRects: () => [{}],
    };
    return n;
  };
  const classes = new Set(['closed']);
  const tabs = {
    listeners: {},
    addEventListener(t, fn) { tabs.listeners[t] = fn; },
    classList: {
      add: (c) => classes.add(c),
      toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
    },
  };
  const burger = mkBtn();
  burger.attrs['aria-expanded'] = 'false';
  const firstTab = mkBtn({ tab: 'agents' });
  const docListeners = {};
  const doc = {
    getElementById: (id) => ({ tabs, burger }[id]),
    querySelector: (sel) => (sel === '#tabs .tab' ? firstTab : null),
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('document',
    // ⚠️ `topLevelReset` is stubbed for the same reason `showTab` is: this test
    // is about the FOCUS behaviour of the menu, and the real one reaches
    // projects state that has nothing to do with it. It is recorded rather than
    // ignored so a handler that stopped calling it would still be visible here.
    'let WATCH = 0; const SHOWN = []; const RESET = [];\n'
    + 'const showTab = (t) => SHOWN.push(t);\n'
    + 'const topLevelReset = (t) => RESET.push(t);\n'
    + script.slice(from, end)
    + '\n; return { SHOWN, RESET };')(doc);
  const chooseTab = () => tabs.listeners.click({ target: { closest: (s) => (s === '.tab' ? firstTab : null) } });

  // ⚠️ THE CONTROL: on a wide screen the menu is closed and the tabs are
  // plainly visible, so a tab click must keep its natural focus -- a guard
  // that fires unconditionally would steal focus on every desktop click.
  chooseTab();
  assert.equal(api.SHOWN[0], 'agents', 'the tab click never reached showTab, so nothing below means anything');
  assert.deepEqual(api.RESET, ['agents'],
    'the tab click never reached topLevelReset, so a person clicking a tab '
    + 'would land back inside whatever they had open in that section');
  assert.equal(burger.focused, 0, 'a wide-screen tab click had its focus stolen by the burger guard');

  // Open: aria flips, the class comes off, and focus moves INTO the menu --
  // the forward path the inverted DOM order otherwise denies.
  burger.listeners.click();
  assert.equal(burger.attrs['aria-expanded'], 'true');
  assert.ok(!classes.has('closed'), 'opening the burger did not reveal the menu');
  assert.equal(firstTab.focused, 1,
    'opening the burger leaves the menu reachable only backwards: the menu precedes its trigger in the DOM');

  // Choose from the OPEN menu: the common path. The menu display:none's
  // under the focused element, so focus must land back on the burger.
  chooseTab();
  assert.ok(classes.has('closed'), 'choosing a tab did not close the menu');
  assert.equal(burger.attrs['aria-expanded'], 'false');
  assert.equal(burger.focused, 1,
    'choosing from the open menu display:none\'d the element under focus and dropped the keyboard to <body>');

  // Escape closes and refocuses the burger; a non-Escape key does nothing.
  burger.listeners.click();
  for (const fn of docListeners.keydown) fn({ key: 'a' });
  assert.ok(!classes.has('closed'), 'a non-Escape key must not close the menu');
  for (const fn of docListeners.keydown) fn({ key: 'Escape' });
  assert.ok(classes.has('closed'), 'Escape did not close the menu');
  assert.equal(burger.focused, 2, 'Escape must hand focus back to the burger');

  // A click landing outside both the menu and the burger closes it.
  burger.listeners.click();
  for (const fn of docListeners.click) fn({ target: { closest: () => null } });
  assert.ok(classes.has('closed'), 'an outside click did not close the menu');
  assert.equal(burger.attrs['aria-expanded'], 'false');
});

test('the board renderers hold the pack grammar: thresholds, states, parity, escaping', async () => {
  /* ⚠️ BEHAVIOURAL, like the summary test above: the renderer block is
     extracted from the page and DRIVEN, because the pack rebuild moved the
     board's whole state grammar into card()/lrow() and no render drive
     reads most of it -- flipping the membadge threshold, scrambling the
     state map, or dropping the presence dot would otherwise go green.
     ⚠️ The cards come from the REAL producers via test-support/fleet (the
     fixture-discipline rule: a hand-built card is free to carry fields the
     producer does not emit). The axes fleet cannot arrange -- an exact
     memory percent, a stale instruction finding, and the untied-needs_you
     shape the pipeline itself refuses -- are SPREAD onto a real card, so
     every other field keeps the producer's shape. */
  // The hostile-named agent's avatar, seeded BEFORE install so the clip
  // branch below is real: safeKey() strips the hostile characters, so an
  // avatar stored under the stripped key is reachable from the hostile
  // name (the collision path -- another agent whose name strips the same).
  const avatarsDir = nodePath.join(SANDBOX, 'AgentWorkforce', 'avatars');
  fs.mkdirSync(avatarsDir, { recursive: true });
  fs.writeFileSync(nodePath.join(avatarsDir, 'xonloadalert1.png'), 'not-a-real-png', 'utf8');
  const board = fleet.install([
    fleet.agent('leo', { state: 'working', role: 'Project Manager' }),
    fleet.agent('mara', { state: 'needs_you' }),
    fleet.agent('rook', { state: 'rate_limited' }),
    fleet.agent('nils', { state: 'stopped' }),
    fleet.agent('vex', { state: 'unknown' }),
    fleet.agent('x" onload="alert(1)', { state: 'idle' }),
  ]);
  try {
    const cards = JSON.parse((await req('/api/status')).body).agents;
    const by = (n) => cards.find((a) => a.name === n);
    const leo = by('leo'), mara = by('mara'), rook = by('rook'), nils = by('nils'), vex = by('vex');
    assert.ok(leo && mara && rook && nils && vex, 'the fixture board is missing an agent');

    const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
    const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
    const from = script.indexOf('const STATE_COPY = {');
    const lrowAt = script.indexOf('function lrow(a)');
    const end = script.indexOf('\n}', script.indexOf('</div>`;', lrowAt)) + 2;
    assert.ok(from > -1 && lrowAt > from && end > lrowAt, 'renderer block not found');
    // eslint-disable-next-line no-new-func
    const api = new Function(script.slice(from, end) + '\n; return { card, lrow };')();
    const withPct = (a, pct) => ({ ...a, context: { ...a.context, percent: pct, tokens: 1 } });

    // The membadge fires AT 80, not around it, and the heat wash yields to red.
    assert.match(api.card(withPct(leo, 80)), /membadge/,
      'the memory badge does not fire at its own threshold');
    assert.doesNotMatch(api.card(withPct(leo, 79)), /membadge/,
      'the memory badge fires below its threshold');
    // The list bar reads the SAME band derivation (memBand), held here at its
    // boundaries on the LIST side -- the four hand-written thresholds are one
    // function now, and this is what keeps the views from drifting one number
    // apart if that ever un-shares.
    assert.match(api.lrow(withPct(leo, 80)), /<i class="high" style="width:80%"/,
      'the list bar does not go high at the shared threshold');
    assert.match(api.lrow(withPct(leo, 79)), /<i class="warn" style="width:79%"/,
      'the list bar band disagrees with the card at 79');
    assert.match(api.lrow(withPct(leo, 59)), /<i class="ok" style="width:59%"/,
      'the list bar warms below the shared amber threshold');

    // A NON-NUMERIC percent (for the day upstream changes) degrades to the
    // honest unknown through the one pctOf coercion, and never lands raw in
    // the membadge text, the bar's width style, or the ring's aria-label.
    const spoofed = withPct(leo, '88" onmouseover="x');
    for (const html of [api.card(spoofed), api.lrow(spoofed)]) {
      assert.doesNotMatch(html, /onmouseover/, 'a non-numeric percent reached the DOM raw');
    }
    // ⚠️ ANCHORED ON THE RING'S LABEL, which is what "degraded to the unknown
    // ring" actually means. This used to read /Memory unknown/, a string that
    // matched the ring's aria-label AND the visible badge, so it never had to
    // choose which it was testing -- and that ambiguity is exactly why a
    // separate assertion about the BADGE could pass with the badge deleted.
    // The two strings are now deliberately disjoint, so an assertion has to
    // name the one it means.
    assert.match(api.card(spoofed), /Memory could not be read/,
      'CONTROL: the spoofed percent did not degrade to the unknown ring, so the raw assertion proves nothing');

    // ⚠️ ANCHORED ON THE ELEMENT, NOT THE WORDS. The line above matches the
    // ring's `aria-label="… Memory unknown: we could not read how full it is."`
    // and was satisfied by it long before a visible caption existed — so it
    // stayed green with the whole badge deleted. The words are in the markup
    // twice for two different audiences; only one of them is the sighted one.
    assert.match(api.card(spoofed), /class="membadge unk"/,
      'the visible unknown-memory caption is gone, leaving a dashed ring whose '
      + 'meaning is stated only in an aria-label');
    // ⚠️ And it must NOT appear when the memory IS known — otherwise the
    // assertion above passes for a badge that is always on.
    assert.doesNotMatch(api.card(withPct(leo, 40)), /membadge unk/,
      'a card with a readable memory claimed its memory was unknown');
    // ⚠️ The severity badge must be unreachable at an unknown percent. Red on
    // that badge means "nearly full", a measured fact; an unknown must never
    // borrow a severity it has not measured.
    assert.doesNotMatch(api.card(spoofed), /class="membadge">/,
      'an unknown memory rendered the nearly-full severity badge');
    assert.match(api.lrow(spoofed), /bar unknown/,
      'CONTROL: the spoofed percent did not degrade to the unknown bar');

    // An UNRECOGNISED server state gets the unknown treatment's WHOLE
    // honesty payload, note included: the gate reads the treatment
    // (cardStOf's fallback), not the state's spelling.
    assert.match(api.card({ ...vex, state: 'martian' }), /not telling you it is fine/,
      'a future server state renders as Can’t-tell without the note that makes it honest');
    const attn88 = api.card(withPct(mara, 88));
    assert.match(attn88, /acard attn/, 'needs_you lost its red card treatment');
    assert.doesNotMatch(attn88, /\bhot\b/,
      'the heat wash stacked onto an attn card (the pack renders 88%-attn without hot)');
    assert.match(api.card(withPct(leo, 94)), /acard hot/,
      'a nearly-full working card lost the heat wash');

    // The state grammar: presence is not status, unknown is not idle.
    const unk = api.card(vex);
    assert.match(unk, /acard unk/, 'unknown lost its dashed card');
    assert.match(unk, /pres unsure/, 'unknown presence collapsed into on/off');
    assert.match(unk, /st-unknown/, 'unknown lost its own pill');
    assert.match(unk, /could not check/, 'the unknown pill lost its screen-reader words');
    assert.match(unk, /not telling you it is fine/, 'the unknown card lost its note');
    const off = api.card(nils);
    assert.match(off, /acard off/, 'stopped lost its off treatment');
    assert.match(off, /pres off/, 'a stopped agent shows a live presence dot');
    assert.match(api.card(leo), /pres on/, 'a working agent lost its presence dot');
    assert.match(api.card({ ...rook, task: null }), /Waiting out a usage limit/,
      'the paused card lost its reason line');
    assert.match(api.card({ ...rook, task: 'Drafting' }), /Drafting/,
      'a paused agent with a real task shows the canned line instead');

    // Grid/list parity on the shared facts, including the stale badge.
    const staleLeo = { ...leo, instructions: { state: 'stale' } };
    assert.match(api.card(staleLeo), /card-stale/, 'the stale badge left the card');
    assert.match(api.lrow(staleLeo), /card-stale/, 'the stale badge is missing from the list view');
    assert.match(api.lrow(vex), /bar unknown/, 'unknown memory in the list invented a bar value');
    for (const piece of ['lav', 'lname', 'lstate', 'ltask', 'lmem']) {
      assert.match(api.lrow(leo), new RegExp(piece), 'the list row lost its ' + piece + ' column');
    }

    // The answer route: gated on the tie, labelled with its visible word.
    const ask = api.card(mara);
    assert.match(ask, /ansgo/, 'the needs_you card lost its answer route');
    assert.match(ask, /aria-label="Answer /, 'the answer button accessible name lost its visible word');
    // The untied-needs_you shape cannot come through real routes (the
    // pipeline forces untied panes to unknown; that refusal is its own
    // tested fact elsewhere) -- so the gate's negative is driven by
    // perturbing the one field the gate reads, on an otherwise-real card.
    assert.doesNotMatch(api.card({ ...mara, isNamedOurs: false }), /ansgo/,
      'a borrowed-name card offers a button into a thread that will refuse it');

    // Hostile names render inert in both views. The controls aim at the two
    // real failure modes: a live tag in text position, and a quote breaking
    // out of an attribute value. (The inert ESCAPED text still contains the
    // attack's letters; asserting their absence fails a correct renderer,
    // which the first cut of this control did.)
    const hostile = { ...leo, name: '<img src=x onerror=alert(1)>"' };
    for (const html of [api.card(hostile), api.lrow(hostile)]) {
      assert.doesNotMatch(html, /<img src=x/, 'an agent name reached the DOM as a live tag');
      assert.match(html, /&lt;img/, 'CONTROL: the escaped name is absent, so the tag assertions prove nothing');
      assert.doesNotMatch(html, /aria-label="Open <img/, 'a hostile name terminated the aria-label attribute');
    }

    // The clip id is a THIRD context (an id attribute plus a url()
    // reference), and the slug is its guard: a quote in a SESSION name must
    // not terminate the attribute the way the aria-label control above
    // proves for display names. esc() would be wrong here -- entities
    // decode in the attribute but not in the CSS reference. The agent is a
    // REAL card (hostile session name through the real producer) and its
    // seeded avatar is what makes the clip branch render at all.
    const spiky = by('x" onload="alert(1)');
    assert.ok(spiky, 'the fixture board is missing the hostile-named agent');
    assert.equal(spiky.hasAvatar, true,
      'CONTROL: the seeded avatar was not found, so the clip branch never renders');
    const spikyCard = api.card(spiky);
    assert.match(spikyCard, /id="clip-x__onload__alert_1_"/,
      'CONTROL: the slugged clip id is absent, so the attribute assertion proves nothing');
    assert.doesNotMatch(spikyCard, /id="clip-x" /,
      'a hostile session name terminated the clipPath id attribute');
  } finally {
    board.restore();
  }
});

test('update awareness: the status tick carries the verdict, and the install route refuses honestly', async () => {
  const updates = require('./engine/update');
  try {
    // A newer published version reaches the screen through the payload it
    // already polls.
    updates.resetCache();
    updates.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
    await updates.refresh();
    const st = await req('/api/status', {});
    assert.equal(st.status, 200);
    assert.deepEqual(JSON.parse(st.body).update, { version: '99.0.0' },
      'the status payload does not carry the published update');

    // ⚠️ The new POST inherits the cross-site guard. Asserted rather than
    // assumed, because a new sibling does not inherit a guard by being
    // adjacent to guarded routes -- only by the guard actually covering it.
    const cross = await req('/api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    assert.equal(cross.status, 403, 'a cross-site page can start a software download');

    // From-source runs are refused with the git sentence, and the installer
    // is never spawned (this checkout has no private runtime beside it).
    let ran = 0;
    updates.setInstallRunner(() => { ran += 1; });
    const src = await req('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(src.status, 409);
    assert.match(JSON.parse(src.body).error, /source code/, 'the from-source refusal lost its reason');
    assert.equal(ran, 0, 'the installer ran against a working tree');

    // An installed copy with an update: 200, and the runner fires with the
    // canonical setup URL.
    let url = null;
    updates.setInstalledRoot(() => '/tmp/fake-kosmos-home');
    updates.setInstallRunner((u) => { ran += 1; url = u; });
    const go = await req('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(go.status, 200, JSON.parse(go.body).error || '');
    assert.equal(JSON.parse(go.body).updating, '99.0.0');
    assert.equal(ran, 1, 'the installer did not run');
    assert.match(String(url), /\/setup$/, 'the runner was not handed the setup URL');

    // And with nothing newer published, a stray POST changes nothing.
    updates.resetCache();
    updates.setFetcher(async () => ({ ok: true, json: async () => ({ version: updates.RUNNING }) }));
    await updates.refresh();
    const idle = await req('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(idle.status, 409, 'a no-op update was accepted');
    assert.equal(ran, 1, 'the installer ran with nothing to install');
  } finally {
    updates.resetCache();
    updates.setFetcher(null);
    updates.setInstallRunner(null);
    updates.setInstalledRoot(null);
  }
});

test('the open-sleep-settings route: guard-inherited, honest 409, and the engine speaks', async () => {
  const machine = require('./engine/machine');
  const real = machine.openSleepSettings;
  try {
    // ⚠️ The stub is installed BEFORE the cross-site request: if the guard
    // ever regressed, this test must fail by count, not launch System
    // Settings on whoever runs the suite as a side effect of failing.
    let crossOpened = 0;
    machine.openSleepSettings = () => { crossOpened += 1; return { ok: true }; };
    const cross = await req('/api/open-sleep-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    assert.equal(cross.status, 403, 'a cross-site page can open System Settings');
    assert.equal(crossOpened, 0, 'the guard answered 403 but the route ran anyway');

    // No pane on this machine: the route answers 409 with the engine's own
    // sentence and never claims success.
    machine.openSleepSettings = () => ({ ok: false, because: 'we could not find the sleep settings screen on this Mac' });
    const none = await req('/api/open-sleep-settings', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(none.status, 409);
    assert.match(JSON.parse(none.body).error, /sleep settings screen/);

    // With the pane found, 200 and the engine did the opening.
    let openedCount = 0;
    machine.openSleepSettings = () => { openedCount += 1; return { ok: true }; };
    const ok = await req('/api/open-sleep-settings', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(ok.status, 200);
    assert.equal(openedCount, 1, 'the route answered ok without opening anything');
  } finally {
    machine.openSleepSettings = real;
  }
});

test('the removal routes ask, remove, and put back, over the wire', async () => {
  // ⚠️ The engine was well covered and the surface a browser talks to was not.
  // These routes are how the fleet is managed, and the restore route is what
  // makes the removal safe to offer.
  const create = require('./engine/create');
  const status = require('./engine/status');
  const removal = require('./engine/remove');

  // An agent that exists, made the way the product makes them.
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  status.setPaneSource(() => '');
  try {
    const made = create.createAgent({ name: 'route-removable', role: 'pm' });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  } finally {
    create.setRunner(null);
    status.setPaneSource(null);
  }

  // ⚠️ THE QUESTION, which is what the confirmation renders. It is fetched
  // rather than composed in the browser so the words a person is asked cannot
  // drift from what the engine will actually do.
  const asked = await req('/api/agent/route-removable/removal');
  assert.equal(asked.status, 200);
  const body = JSON.parse(asked.body);
  assert.equal(body.ok, true);
  assert.match(body.question, /route-removable/,
    'the confirmation does not name the agent, so a misclick reads the same as the right click');
  assert.match(body.reassurance, /not be deleted/i,
    'the screen never tells them their files are safe, which is the one thing they want to know');
  /**
   * ⚠️ Was `assert.equal(body.steps, undefined, …)`, which could not fail:
   * `plan` has never returned `steps` in any revision, so it asserted the
   * absence of something that was never there. An absence assertion needs a
   * presence to be measured against -- the removal ITSELF returns `steps`, so
   * that is the control, and the point becomes the real one: the step list is
   * for the outcome, and the QUESTION must not recite it.
   */
  /**
   * ⚠️ Stub the roster before ACTING, not only before asserting. This ran with
   * `setPaneSource(null)`, so `plan()` shelled out to the operator's real tmux
   * and the branch this assertion depends on was decided by whatever the live
   * fleet happened to be doing -- a real session under this name would change
   * the outcome. Dry-run, so nothing was stopped; machine-dependent all the
   * same, in a file that spends two paragraphs elsewhere insisting on exactly
   * this.
   */
  status.setPaneSource(() => fleet.line({ session: 'route-removable', claim: 'route-removable', title: '✳ Claude Code' }));
  status.setPaneCapture(() => null);
  const acted = removal.remove('route-removable');
  status.setPaneSource(null);
  status.setPaneCapture(null);
  assert.ok(Array.isArray(acted.steps) && acted.steps.length > 0,
    'the control failed: nothing produces a step list, so hiding it from the question proves nothing');
  assert.equal(body.steps, undefined,
    'the route is back to reciting launchd steps at a person who does not want them');
  for (const s of acted.steps) {
    assert.doesNotMatch(String(body.question) + String(body.reassurance), new RegExp(s.label),
      'the confirmation recites what the removal will do, which Josh cut for describing our implementation');
  }

  /**
   * ⚠️ AN AGENT ANOTHER TOOL CREATED — now REMOVABLE, reversing an earlier
   * design that refused these. Josh: managing the fleet you actually have is
   * the point, so an agent Kosmos cannot remove is a hole rather than a
   * safeguard. Built as one rather than named as one, so the fixture differs
   * from an owned agent in exactly the property that matters: its job is
   * another tool's label, not ours.
   */
  const foreignName = 'route-foreign';
  fs.mkdirSync(create.workerDir(foreignName), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(foreignName), 'CLAUDE.md'), 'You are **Foreign**.\n', 'utf8');
  const foreignPlist = nodePath.join(nodePath.dirname(create.plistPath(foreignName)), `com.${foreignName}.discord.plist`);
  fs.writeFileSync(foreignPlist, '<plist/>', 'utf8');

  const foreign = await req(`/api/agent/${foreignName}/removal`);
  assert.equal(foreign.status, 200,
    'the route refused an agent another tool created, which this rebuild exists to support');

  /**
   * ⚠️ IT IS ASKED ABOUT BY THE NAME ON ITS CARD, NOT ITS NAME ON THE MACHINE.
   *
   * This fixture has both, on purpose: the session is `route-foreign` and its
   * instruction file calls it `Foreign`. They are the same string for every
   * agent Kosmos creates, so only a pre-existing agent — the kind this rebuild
   * exists to support — can tell the two apart at all. On the real fleet the
   * pair is `claudebot` / `Splinter`, and the confirmation asked about
   * `claudebot`: a name the person has never seen on the board they clicked
   * from. Josh asked for the confirmation to be named so somebody *understands
   * what they are doing*, and a name they do not recognise does the opposite.
   *
   * The `doesNotMatch` is the half that would have caught it. Asserting only
   * that "Foreign" appears passes just as happily against a sentence carrying
   * both names.
   */
  const foreignAsk = JSON.parse(foreign.body);
  assert.match(foreignAsk.question, /Foreign/,
    'the confirmation does not call the agent what the board calls it');
  assert.doesNotMatch(foreignAsk.question, /route-foreign/,
    'the confirmation names the session rather than the agent, so it asks about a name nobody has seen');
  assert.equal(foreignAsk.label, 'Foreign',
    'the buttons have no display name to use, so they fall back to naming the session');
  assert.equal(foreignAsk.name, foreignName,
    'the display name reached the field the removal is ACTED on, which would remove the wrong thing or nothing');

  // A malformed name answers rather than crashing the process.
  const bad = await req('/api/agent/%/removal', { method: 'DELETE' });
  assert.equal(bad.status, 400);
  const alive = await req('/api/status');
  assert.match(alive.type, /application\/json/, 'the server died on a malformed name');

  const seenRemoved = [];
  removal.setRunner((f, a) => { seenRemoved.push([f, a]); return a && a[0] === 'has-session' ? { ok: false, code: 1 } : { ok: true, stdout: '' }; });
  removal.setDryRun(false);
  // ⚠️ THE AGENT HAS TO BE ON THE BOARD BEFORE ANY OF THIS MEANS ANYTHING. An
  // earlier version of this test asserted "it is gone from the board" without
  // it ever having been there — which passes against a board that never
  // filtered anything, and passed against one that filtered everything. The
  // control below is the assertion that gives the two after it their meaning.
  /**
   * ⚠️ Stub the pane CAPTURE as well as the pane SOURCE.
   *
   * Overriding only the source makes the roster synthetic and then lets
   * `/api/status` run real `tmux capture-pane` against every fixture name --
   * which printed `can't find session: route-removable` to stderr on each run, and made this
   * test depend on the machine's tmux (it would read differently on a box with
   * no tmux server, or one where a session happened to share the fixture's
   * name). `null` is exactly what real tmux answered for a session that does
   * not exist, so nothing else about the test changes.
   *
   * ⚠️ Deliberately per-test rather than at file load: several older tests call
   * `setPaneCapture(null)` in their own `finally`, which would clear a
   * file-level stub for everything running after it. And a few of them let the
   * roster fall through to the REAL fleet on purpose, so a global stub would
   * quietly change what those are measuring.
   */
  status.setPaneSource(() => fleet.line({ session: 'route-removable', claim: 'route-removable', title: '✳ Claude Code' }));
  status.setPaneCapture(() => null);
  try {
    const before = JSON.parse((await req('/api/status')).body).agents.map((a) => a.name);
    assert.ok(before.includes('route-removable'),
      'the agent is not on the board to begin with, so nothing below about removing it from the board can fail');

    const gone = await req('/api/agent/route-removable/removal', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
    });
    assert.equal(gone.status, 200, 'a legitimate removal was refused: ' + gone.body);
    assert.equal(JSON.parse(gone.body).outcome, 'removed');

    // ⚠️ REMOVE IS NOT DELETE, asserted at the route rather than only in the
    // engine: this is the layer the browser reaches, and a route that passed a
    // wipe flag through would satisfy every engine test.
    assert.ok(fs.existsSync(create.plistPath('route-removable')), 'the route deleted the startup job');
    assert.ok(fs.existsSync(create.instructionFile('route-removable')),
      "the route deleted the agent's instructions");

    // ⚠️ AND IT COMES OFF THE BOARD. The engine cannot assert this — the board
    // is assembled here — and it is the only part of a removal the person who
    // asked for it can actually see.
    const listed = JSON.parse((await req('/api/status')).body).agents.map((a) => a.name);
    assert.ok(!listed.includes('route-removable'),
      'a removed agent is still on the board, so nothing appeared to happen');

    const removedList = JSON.parse((await req('/api/removed')).body).agents.map((a) => a.name);
    assert.ok(removedList.includes('route-removable'),
      'a removed agent is on no list at all, so it is stopped, invisible, and unrecoverable');

    // ⚠️ THE ROUND TRIP. Restore must genuinely put it back — this route is the
    // reason the confirmation is allowed to be a single light question.
    const back = await req('/api/agent/route-removable/restore', {
      method: 'POST', headers: { 'content-type': 'application/json' },
    });
    assert.equal(back.status, 200, 'restore was refused: ' + back.body);
    assert.equal(JSON.parse(back.body).outcome, 'restored');
    assert.ok(seenRemoved.some(([, a]) => a && a[0] === 'enable'),
      'nothing was re-enabled, so the agent is "restored" but will not start again');
    const after = JSON.parse((await req('/api/status')).body).agents.map((a) => a.name);
    assert.ok(after.includes('route-removable'), 'a restored agent never came back to the board');
  } finally {
    removal.setRunner(null);
    create.setRunner(null);
    status.setPaneSource(null);
    // ⚠️ Put the capture back too, or this test's stub leaks onto every test
    // that runs after it -- including the ones that read the real fleet.
    status.setPaneCapture(null);
  }

  // ⚠️ AND BOTH WRITES ARE COVERED BY THE CROSS-SITE GUARD. They are
  // state-changing methods that stop and start real jobs; a page on another
  // site must not be able to reach either one.
  const crossSite = await req('/api/agent/route-removable/removal', {
    method: 'DELETE', headers: { origin: 'https://evil.example' },
  });
  assert.equal(crossSite.status, 403, 'another website can remove an agent');
  const crossSiteBack = await req('/api/agent/route-removable/restore', {
    method: 'POST', headers: { origin: 'https://evil.example' },
  });
  assert.equal(crossSiteBack.status, 403, 'another website can restore an agent');
});

test('the confirmation asks by name, defaults to keeping, and never writes its own words', () => {
  /**
   * ⚠️ THIS IS A SOURCE TEST AND SOURCE TESTS ARE WEAK. There is no DOM here —
   * the product ships zero dependencies, so nothing in this suite can click the
   * button. What follows checks that the browser file is WIRED the stated way;
   * it cannot prove the modal behaves that way when a person uses it, and a
   * mutation that moves one of these lines inside a conditional keeps it green.
   *
   * It is worth having anyway for one property no other test can reach: that
   * this file does not COMPOSE the confirmation. Everything the person is asked
   * comes from the engine, which IS executed, and is covered by the route test
   * above. The live round trip in the proof file is what checks the behaviour.
   */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

  // The words come from the engine's answer, not from here.
  assert.match(raw, /rm-title'\)\.textContent = ask\.question/,
    'the browser writes its own confirmation heading, so it can drift from what removal actually does');
  assert.match(raw, /rm-small'\)\.textContent = ask\.reassurance/,
    'the reassurance is composed in the browser rather than served with the question');
  assert.doesNotMatch(raw, /Are you sure you want to remove/,
    'the confirmation sentence is hardcoded in the page, which is the drift this split exists to prevent');

  // ⚠️ BOTH buttons name the agent. A bare "Yes"/"No" beside a half-read
  // heading is how the wrong agent gets removed.
  /**
   * ⚠️ Named from the ENGINE's label, the same source as the heading — not from
   * the session name the page happens to be holding. Those differ for exactly
   * the pre-existing agents this feature was rebuilt for, and using both put a
   * button reading "Remove claudebot" under a heading asking about Splinter.
   */
  assert.match(raw, /const shown = ask\.label \|\| name/,
    'the buttons name the agent from something other than the engine, so they can disagree with the heading');
  assert.match(raw, /'Remove ' \+ shown/, 'the destructive button does not name the agent');
  assert.match(raw, /'Keep ' \+ shown/, 'the safe button does not name the agent');
  // ⚠️ And the removal is still SENT as the session name. Speaking the display
  // name is only safe while nothing acts on it.
  assert.match(raw, /RM_FOR = name;/,
    'the modal remembers the display name as the thing to remove, which removes the wrong agent or none');

  // Keeping it is the default answer to every accident.
  assert.match(raw, /keep\.focus\(\)/, 'the modal opens with the destructive button reachable by Enter');
  /**
   * ⚠️ ANCHORED TO THE HANDLER, because the bare `/Escape/` this replaced could
   * not fail: the word appears in the modal's own HTML comment a thousand lines
   * away, so deleting the entire keydown handler left the assertion green. A
   * test that cannot fail is not a weak test, it is a decoration that reads as
   * coverage -- and this one guarded the gesture that ANSWERS the confirmation
   * safely.
   */
  // Anchored to the rm-modal backdrop handler and the first keydown AFTER
  // it, not the first keydown in the file: the update confirm now registers
  // its own Escape handler earlier in the source, and the file-position
  // anchor silently retargeted this assertion onto the wrong dialog.
  const afterBackdrop = raw.slice(raw.indexOf("rm-modal').addEventListener('click'"));
  const esc = afterBackdrop.slice(afterBackdrop.indexOf("document.addEventListener('keydown'"));
  const escBody = esc.slice(0, esc.indexOf('\n});'));
  assert.ok(escBody.includes("'Escape'"),
    'the keydown handler does not look at Escape, so it does not dismiss the modal');
  assert.ok(escBody.includes('closeRemoveModal'),
    'Escape is read but does not close the modal, so the safe answer has no keyboard route');
  assert.match(raw, /aria-modal="true"/, 'the dialog is not announced as modal');

  // A partial must not close it — see the engine tests for what partial means.
  /**
   * ⚠️ SCOPED TO THE MODAL'S OWN HANDLER, not matched against the whole file.
   *
   * The earlier form was `/partial[\s\S]{0,400}?return;/` against the entire
   * page, which binds happily to the CREATE flow's partial handler several
   * hundred lines away — it passed against a copy of this file with the removal
   * modal's partial branch deleted outright. Cutting the handler out first is
   * what makes the two assertions below about THIS code.
   */
  const handler = raw.slice(raw.indexOf("getElementById('rm-go').addEventListener"));
  const body = handler.slice(0, handler.indexOf('\n});'));
  assert.ok(body.includes("done.outcome === 'partial'"),
    'the confirmation does not handle a half-finished removal at all');
  const partialBranch = body.slice(body.indexOf("done.outcome === 'partial'"));
  assert.ok(!partialBranch.slice(0, partialBranch.indexOf('return;')).includes('closeRemoveModal'),
    'a half-finished removal closes the confirmation, so nobody reads that the agent is still running');
});


/**
 * Every `var(--x)` with no fallback names a property `:root` actually defines.
 *
 * ⚠️ THIS IS THE ONE FAILURE THE WHOLE SUITE COULD NOT SEE, and it shipped.
 *
 * The removal modal's CSS invented four properties that do not exist
 * (`--card`, `--ink`, `--line`, `--text-h2`). CSS does not warn: an undefined
 * custom property with no fallback makes the ENTIRE declaration invalid and it
 * is dropped. So `background: var(--card)` produced a transparent confirmation
 * box, `border: 1px solid var(--line)` produced no border, and
 * `font: var(--text-h2) …` left the heading at 13px normal weight -- a
 * see-through dialog with the page readable through its own question.
 *
 * It survived two review rounds and 316 passing tests because **every existing
 * assertion about this screen reads its text**, and the text was right. Nothing
 * in the repo rendered a page. The defect is invisible to the kind of test this
 * codebase is made of, which is exactly why it needs its own.
 *
 * Deliberately whole-file rather than scoped to the modal: the same mistake was
 * already sitting on `main` in `#d-untied`, unnoticed since it shipped.
 */
test('the removed list gives the browser only what it draws', async () => {
  /**
   * ⚠️ Pins an ALLOWLIST, which is the only shape that can catch the regression
   * that matters. The stored record carries the launchd label, the absolute
   * plist path and whether the job is ours; the screen draws a name and a date.
   * Spreading the record straight through would pass every other assertion here
   * -- the fields the browser reads would all still be present -- while putting
   * machine detail on the wire that this product's vocabulary rule says a
   * person is never shown, from a server with no login.
   */
  const removal = require('./engine/remove');
  const create = require('./engine/create');
  const status = require('./engine/status');
  const name = 'payload-shape';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'You are **Payload**.\n', 'utf8');
  // A startup job on disk, or there is no label and no plist to withhold and
  // the control below would be true of nothing.
  const plistDir = nodePath.dirname(create.plistPath(name));
  fs.mkdirSync(plistDir, { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>', 'utf8');
  status.setPaneSource(() => fleet.line({ session: name, claim: name, title: '✳ Claude Code' }));
  status.setPaneCapture(() => null);
  // ⚠️ `has-session` must answer "gone" (exit 1) or the look-again after the
  // kill reads as a session that survived, and the removal is a PARTIAL.
  removal.setRunner((file, args) => (args && args[0] === 'has-session'
    ? { ok: false, code: 1 }
    : { ok: true, stdout: '' }));
  removal.setDryRun(false);
  try {
    assert.equal(removal.remove(name).outcome, removal.OUTCOME.REMOVED);

    // ⚠️ CONTROL: the stored record really does carry the fields being excluded,
    // or "they are absent from the response" is true of nothing.
    const stored = removal.removedAgents().find((r) => r.name === name);
    assert.ok(stored.label && stored.plist, 'the fixture has no machine detail to withhold');

    const res = await req('/api/removed');
    const row = JSON.parse(res.body).agents.find((a) => a.name === name);
    assert.deepEqual(Object.keys(row).sort(), ['name', 'removedAt', 'shownAs', 'stopped'],
      'the removed list ships fields the screen does not draw');
    assert.equal(row.shownAs, 'Payload', 'the row has nothing recognisable to show');
  } finally {
    removal.setRunner(null);
    status.setPaneSource(null);
    status.setPaneCapture(null);
    try { fs.rmSync(removal.REMOVED_FILE, { force: true }); } catch { /* best effort */ }
  }
});


/**
 * The six browser-layer fixes on this branch, pinned so they cannot regress
 * silently.
 *
 * ⚠️ THIS IS A WEAKER INSTRUMENT THAN IT LOOKS, and saying so is the point.
 * These assert the SHAPE OF THE SOURCE, not behaviour: nothing here runs the
 * page. A rewrite that keeps the shape and loses the behaviour passes, and the
 * transparent-modal defect earlier on this branch is proof that source
 * assertions can be green while the screen is broken.
 *
 * It is here because the alternative was nothing. Every one of these is a
 * defect this branch measured, fixed, and could not otherwise notice being
 * undone -- all of them were reverted in a sandbox and the whole suite stayed
 * green. Making them fail noisily is worth more than the purity of admitting
 * the repo has no DOM, and the honesty lives in this comment rather than in
 * skipping the test.
 *
 * ⚠️ The real fix is rendering the page in the suite, which this repo cannot
 * do without taking a dependency it has deliberately never taken. That is a
 * decision for somebody, not something to sneak in here.
 */
test('a throwing removal engine answers an error instead of killing the board', async () => {
  /**
   * ⚠️ NONE OF THE FOUR REMOVAL ROUTES' try/catch GUARDS WAS HELD. Deleting any
   * one of them individually left the suite green, despite each carrying a
   * paragraph explaining that an uncaught throw does not fail the request -- it
   * EXITS THE PROCESS. The board goes down at the moment somebody is halfway
   * through removing an agent, with nothing on screen to say what happened.
   *
   * Driven through the real server with the engine made to throw, because a
   * unit test on the engine cannot show that a route survives it.
   */
  const removal = require('./engine/remove');
  const realPlan = removal.plan;
  const realRemove = removal.remove;
  const realRestore = removal.restore;
  const realList = removal.removedAgents;

  const boom = () => { throw new Error('the engine exploded'); };
  try {
    removal.plan = boom;
    removal.remove = boom;
    removal.restore = boom;
    removal.removedAgents = boom;

    for (const [method, path] of [
      ['GET', '/api/agent/anything/removal'],
      ['DELETE', '/api/agent/anything/removal'],
      ['POST', '/api/agent/anything/restore'],
      ['GET', '/api/removed'],
    ]) {
      const res = await req(path, method === 'GET' ? undefined : { method });
      assert.equal(res.status, 500, `${method} ${path} did not answer at all, which means it took the process with it`);
      assert.match(res.type, /application\/json/, `${method} ${path} answered but not as JSON`);
      const body = JSON.parse(res.body);
      assert.ok(body.error, `${method} ${path} answered 500 with nothing to say`);
    }

    // ⚠️ CONTROL: the server is still up and still serving everything else. If
    // it had died, every assertion above would have failed on the request
    // rather than on the status -- but this makes the property explicit.
    const alive = await req('/api/status');
    assert.match(alive.type, /application\/json/, 'the board died despite the routes answering');
  } finally {
    removal.plan = realPlan;
    removal.remove = realRemove;
    removal.restore = realRestore;
    removal.removedAgents = realList;
  }
});


test('a half-finished removal answers 200, because it is a state and not an error', async () => {
  /**
   * ⚠️ A DELIBERATE DECISION THAT NOTHING HELD. Inverting it to
   * `outcome === REMOVED ? 200 : 400` passed 346/346 -- and that inversion
   * routes a PARTIAL into the browser's failure branch, which skips the
   * `paintRemoved()` refresh the partial path performs and shows a generic
   * failure instead of the sentence saying the agent may still be running.
   *
   * The request was understood and acted on. What happened is in the body,
   * which is where a removal's outcome has to be read anyway.
   */
  const removal = require('./engine/remove');
  const create = require('./engine/create');
  const status = require('./engine/status');
  const name = 'partial-status';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'You are **Partial**.\n', 'utf8');
  fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>', 'utf8');
  status.setPaneSource(() => fleet.line({ session: name, claim: name, title: '✳ Claude Code' }));
  status.setPaneCapture(() => null);
  // bootout refuses: disabled but not stopped, which is a partial.
  removal.setRunner((file, args) => (args && args[0] === 'bootout'
    ? { ok: false, code: 2 }
    : { ok: true, stdout: '' }));
  removal.setDryRun(false);
  try {
    const res = await req(`/api/agent/${name}/removal`, { method: 'DELETE' });
    const body = JSON.parse(res.body);
    // ⚠️ CONTROL: it really is a partial, or "partials answer 200" is being
    // asserted about a clean removal.
    assert.equal(body.outcome, 'partial', `this is a ${body.outcome}, so the status code proves nothing`);
    assert.equal(res.status, 200,
      'a half-finished removal answers as an error, so the screen shows a generic failure instead of what happened');
    assert.match(body.because, /still running|still be going|could not/,
      'the body does not say what half-happened, which is the only reason 200 is defensible');
  } finally {
    removal.setRunner(null);
    status.setPaneSource(null);
    status.setPaneCapture(null);
    try { fs.rmSync(removal.REMOVED_FILE, { force: true }); } catch { /* best effort */ }
  }
});


test('the browser-layer fixes on this branch cannot be undone silently', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

  const pins = [
    /* ---- first run -------------------------------------------------------
       ⚠️ These are here because NOTHING ELSE CAN CATCH THEM. Reverting either
       one leaves the page working, every other test green, and the browser
       checks silent -- which is precisely why they need a pin rather than a
       check. Until they were added, this list held only the previous branch's
       fixes while its own comment implied it covered the current one. */

    // The flagship "found only by rendering" defect. Written `.fr-next` it
    // loses to `.fr-body p` on specificity and the rule does NOTHING -- and the
    // render check cannot see it, because the fallback it lands on happens to
    // pass AA. Silent in every layer we have.
    [/\.fr-body p\.fr-next/, 'the first-run caption rule is back to a bare class, which loses to '
      + '.fr-body p on specificity and applies to nothing at all'],
    // Without the guard, `AbortSignal.timeout` throws synchronously on Safari
    // < 16, every completion lands in the could-not-remember path, and first
    // run reappears on every launch forever. Chromium always satisfies it, so
    // no browser check on this machine will ever fail.
    [/typeof AbortSignal !== 'undefined' && AbortSignal\.timeout/,
      'the AbortSignal.timeout feature guard is gone, so on an engine without it every '
      + 'completion throws, lands in the could-not-remember path, and onboarding never stops '
      + 'reappearing'],

    /* ---- the removal flow, from the previous branch ---------------------- */
    // A record written by an older version has no timestamp, and this read the
    // wrong field, so the date never appeared for anybody.
    [/a\.removedAt/, 'the removed-list date reads a field the engine does not write'],
    // The change guard, whose absence wipes a "Restore failed" row every five
    // seconds and drops keyboard focus with it.
    [/if \(html !== REMOVED_HTML\)/, 'the removed list repaints unconditionally on every poll'],
    // Cleared when the list empties, or a stale "Restoring…" row comes back.
    [/REMOVED_HTML = null;/, 'the change-guard cache is never cleared, so a stale row can return'],
    // A server failure is not "nothing has been removed".
    [/if \(!res\.ok\) return;/, 'a failed /api/removed read renders as an empty removed list'],
    // A 5xx is not a fact about this agent.
    [/res\.status >= 500/, 'a server error is reported as "we cannot remove this agent"'],
    // Shift+Tab into the modal must not land on the destructive button.
    // (Re-anchored when the trap was fixed to intercept at the LAST element
    // in the traversal direction: arriving from outside is now its own arm,
    // and it still lands on Keep.)
    [/if \(!inside\) \{ e\.preventDefault\(\); keep\.focus\(\); return; \}/, 'tabbing into the modal backwards lands on Remove'],
    // And the wrap intercepts at the last tab stop, not the first: the first
    // is the one natural tabbing never exits by, and intercepting only there
    // leaked one keystroke onto the board behind the backdrop.
    [/document\.activeElement === order\[order\.length - 1\]/, 'the focus trap wraps at the wrong end and leaks a keystroke behind the modal'],
    // The removed list is part of the board, so it refreshes with it.
    [/if \(onAgentsTab\(\)\) paintRemoved\(\)/,
     'the removed list no longer refreshes on the poll, so its count goes stale'],

    /* ---- project chat, this branch ---------------------------------------
       ⚠️ Round 13 measured that every one of these reverts with all 707
       tests green: render-thread.js and render-projects.js hold some of
       them, but neither runs under `yarn test`, so this list is what CI
       actually enforces. Same rule as above: a pin is for a fix nothing
       else can catch. */

    // The gold selected state on the view toggle is Josh's ruling twice
    // over (ink flips in dark and inverts the meaning); a quiet revert to
    // an ink fill would pass every behavioural check.
    [/\.vt\.on \{ background: var\(--gold-bright\); color: #14161a; \}/,
     'the selected view-toggle state lost its gold (an ink fill inverts meaning in dark)'],
    // The Answer control is the ONE card control whose function nothing
    // else on the card duplicates (the card body opens detail, not the
    // thread), so the undersized-target exceptions do not apply to it and
    // it carries the retired .card-answer's SC 2.5.8 floor itself.
    [/\.ansgo \{[^}]*min-height: 24px/,
     'the Answer control lost its 24px minimum target (SC 2.5.8), shrinking back to a text-height target'],
    // The removed list's reassurance line is the sentence that makes the
    // light Remove confirmation honest; it rides inside paintRemoved's
    // generated html where no render drive currently reads it.
    [/Nothing was deleted\. Their folders and everything you wrote for them/,
     'the removed list lost the nothing-was-deleted reassurance that keeps Remove honest'],
    // The tie half of the answer-button gate (the pack renamed its visible
    // label from "See the question" to "Answer") -- defence-in-depth, and
    // this pin is its ONLY enforcement: the pipeline currently forces an
    // untied pane's state to unknown upstream, so no fixture can produce the
    // untied-needs_you shape and no render check can hold the gate. If the
    // upstream refusal ever changes, this gate is what stops a borrowed-name
    // pane offering a button into a thread that will refuse it silently.
    [/a\.state === 'needs_you' && a\.isNamedOurs/,
     'the answer button lost its tie gate, so a borrowed-name pane promises a question '
     + 'the thread cannot show'],
    // Without the IME guard, Enter mid-composition sends a half-composed
    // first word to a live agent on every Japanese, Chinese or Korean send.
    [/e\.isComposing \|\| e\.keyCode === 229/,
     'the IME composition guard is gone, so Enter mid-composition sends half a word'],
    // "We could not look" is not "it is on none": without this branch a failed
    // projects read renders a definite "not on a project yet, add it to one".
    [/if \(PJ_READ_FAILED\)/,
     'pjAnswerFrom filters a list that a failed read never refreshed, and states the result as fact'],
    [/PJ_READ_FAILED = true;/,
     'the failed-read flag is never raised, so the honest branch above is dead code'],
    // The unconfirmed-and-unrecorded case: the box is the ONLY copy of the
    // person's words, and clearing it loses them under a sentence promising
    // they were kept.
    // ⚠️ The pin holds the FACT'S SOURCE, not just the guard line: round 16
    // set `inThread = true` one line above the guard and the old pin
    // (/if \(inThread\) box\.value/) matched on while the defect returned.
    // Same widening on the two pins below, for the same measured reason.
    [/const inThread = body\.recorded === true;/,
     'inThread no longer derives from recorded, so an unrecorded unconfirmed send wipes the only copy'],
    // The park handler itself: typed words are filed per project at the
    // keystroke, which is what makes every navigation order draft-safe
    // (round 34: the switch-time park read PJ_CURRENT after Back had
    // nulled it, and this exact sequence deleted typed words).
    [/PJ_DRAFTS\[PJ_CURRENT\] = v;/,
     'the input-handler park is gone, so a navigation order can delete typed words again'],
    // Round 37 moved the clear into `clearSent`, keyed on the TAKEOFF
    // project: the box only when the flight has not moved and still shows
    // the sent text, the parked draft under sentProject only when it still
    // holds exactly that text.
    [/if \(inThread\) clearSent\(\);/,
     'the unconfirmed clear must still be gated on recorded (rounds 29/34/37)'],
    [/if \(PJ_CURRENT === sentProject && box\.value\.trim\(\) === text\) box\.value = '';/,
     'the box clear must key on the takeoff PROJECT (not the full flight gate) plus the sent text: too narrow deletes another project\u2019s words, too wide leaves delivered words armed for a duplicate send (rounds 29/37/38)'],
    [/if \(\(PJ_DRAFTS\[sentProject\] \|\| ''\)\.trim\(\) === text\) delete PJ_DRAFTS\[sentProject\];/,
     'the parked-draft clear must key on the TAKEOFF project and the exact sent text (rounds 34/37: a programmatic clear fires no input event, so the map kept the sent text)'],
    // The description renders escaped in BOTH places or not at all: a
    // project named by the person carries their words onto a card and a
    // heading, and either an unescaped render or a dropped arm would be
    // invisible to node tests (project-description branch).
    // (class renamed pj-desc -> pjdesc -> pc-t with the pack-card restyle;
    // the pin follows the arm it protects, not the spelling. pc-t is the
    // pack's own card-sentence class, and the pack spends .pjdesc on the
    // detail page.)
    [/p\.description \? '<span class="pc-t">' \+ esc\(p\.description\)/,
     'the card row lost its escaped description arm'],
    [/desc\.textContent = p\.description \|\| '';/,
     'the detail description must be written through textContent -- innerHTML here is the injection the card arm escapes against, and no node test can see the swap'],
    [/desc\.hidden = !p\.description;/,
     'the detail description lost its hidden-when-absent toggle (an empty grey line under every undescribed project)'],
    // The pick toggle must keep setLive's memory in step with its in-place
    // aria-checked flip, or the next poll rebuilds the list under the
    // focused button (round 39).
    [/__lastLive = addAgentsHtml\(\)/,
     'the pick toggle no longer refreshes setLive\u2019s stored string, so the poll repaints over keyboard focus'],
    // The transport branch returns before pjSend's finally, so it carries
    // its own focus rescue (round 39).
    [/const sbtn = document\.getElementById\('pj-send'\);/,
     'the connection-failure branch lost its focus rescue, stranding keyboard users on <body>'],
    /* ⚠️ The page branches on the bare literals 'placed'/'unconfirmed'
       (round 39): it cannot import chat.DELIVERY, and any state the page
       does not recognise falls into the failed arm -- "Could not deliver",
       the one reading that invites a re-send into a live composer. Two
       halves hold the pact: the pins here prove the page still compares
       those exact literals, and the assertions in the test body below
       prove the ENGINE still spells its states that way, so renaming a
       DELIVERY value without updating the page turns this test red. */
    [/d\.state === 'placed'/,
     "the row renderer no longer compares the engine's exact 'placed' literal"],
    [/state === 'unconfirmed'/,
     "the page no longer compares the engine's exact 'unconfirmed' literal"],
    // A bare clock time is only true today; a thread keeps a thousand rows.
    [/then\.toDateString\(\) !== now\.toDateString\(\)/,
     'pjWhen dropped the calendar-day qualifier, so a three-day-old row reads as this afternoon'],
    [/return 'at ' \+ time \+ ' on '/,
     'the calendar-day branch no longer returns a dated form, so its condition decides nothing'],
  ];

  /**
   * ⚠️ CONTROL, and it is not decoration: every pattern is checked against a
   * string that CANNOT contain it, so a pattern matching nothing anywhere -- a
   * typo, an over-escaped regex -- is caught here rather than passing as
   * coverage forever.
   */
  for (const [re] of pins) {
    assert.doesNotMatch('nothing at all', re, `pattern ${re} matches empty prose, so it asserts nothing`);
  }

  for (const [re, why] of pins) {
    assert.match(raw, re, why);
  }

  // The engine half of the literal pact (round 39; see the delivery pins
  // above): if either value is renamed, this fails and names the page as
  // the other place to change.
  const chatEngine = require('./engine/chat');
  assert.equal(chatEngine.DELIVERY.PLACED, 'placed',
    "chat.DELIVERY.PLACED moved; web/index.html compares the literal 'placed' and must move with it");
  assert.equal(chatEngine.DELIVERY.UNCONFIRMED, 'unconfirmed',
    "chat.DELIVERY.UNCONFIRMED moved; web/index.html compares the literal 'unconfirmed' and must move with it");
});


test('no style rule depends on a custom property that is never defined', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

  /**
   * ⚠️ Returns the UNDEFINED ones, so the check can be pointed at a mutated
   * copy below. A checker that can only run against the real file cannot be
   * shown to fail, and a test that has never failed is a claim, not a control.
   */
  const undefinedTokens = (html) => {
    /**
     * ⚠️ COMMENTS ARE STRIPPED FIRST, and the first draft of this test did not.
     * The prose above quotes `var(--text-h2)` as the example of the bug, so the
     * check reported the comment describing the defect as the defect. Caught by
     * the control below, which is the entire reason it is there.
     */
    const live = html.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const css = live.slice(live.indexOf('<style'), live.indexOf('</style>'));
    /**
     * ⚠️ EVERY declaration in the stylesheet, not only the ones inside `:root`
     * -- and the comment here used to claim the narrower thing while the regex
     * did the wider one.
     *
     * Latent today (checked: every custom property in this file IS declared in
     * a `:root` block), and it matters the day one is not: a property defined
     * only inside `.foo {}` would count as globally defined here, so a `var()`
     * on it elsewhere would pass this check while still resolving to nothing --
     * exactly the failure the test exists to catch. Said accurately rather than
     * left as a guard whose comment is stronger than its code.
     */
    const defined = new Set();
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    /**
     * Scanned over the WHOLE document, not just the stylesheet: this page also
     * carries `var()` in inline `style=` attributes, and those fail the same
     * silent way. A `var(--x, fallback)` is safe by construction, so only bare
     * uses count.
     */
    const bad = new Set();
    for (const m of live.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
      if (!defined.has(m[1])) bad.add(m[1]);
    }
    return [...bad].sort();
  };

  /**
   * ⚠️ THE CONTROL, and it is not decoration.
   *
   * "No undefined tokens" passes just as happily against a checker whose regex
   * matches nothing at all -- which is how a green suite hid this in the first
   * place. Proving the check FIRES on a token that is definitely missing is
   * what makes the empty result below mean something.
   */
  const found = undefinedTokens(raw);

  const mutated = raw.replace('.rm-acts {', '.rm-acts { outline-color: var(--nope-not-a-token);');
  assert.notEqual(mutated, raw, 'the mutation did not apply, so the control proves nothing');
  /**
   * ⚠️ Stated as "one MORE than the real file has", not as "exactly this one".
   * The stricter form looks tighter and is worse: the day the real assertion
   * below has something to say, the control fails first and reports "the check
   * does not notice a plainly undefined property" -- blaming the instrument for
   * the reading. Measured, by reintroducing the original bug.
   */
  assert.deepEqual(undefinedTokens(mutated), [...found, '--nope-not-a-token'].sort(),
    'the check does not notice a custom property that is plainly undefined');

  assert.deepEqual(found, [],
    'a style rule names a custom property nothing defines, so the whole declaration is dropped');
});


test('an agent whose card shows a different name than its session still leaves the board', async () => {
  /**
   * ⚠️ THE TEST THE FIRST VERSION OF THIS FEATURE DID NOT HAVE, and its absence
   * is why the board filter shipped keyed on the wrong field.
   *
   * A card carries TWO names: `name` is the DISPLAY name, read out of "You are
   * **X**" in the agent's own instructions, and `sessionName` is what tmux and
   * launchd know it as. For an agent this app created they are identical —
   * which is the only kind of agent the earlier tests used, so filtering on
   * either one passed. They differ for every pre-existing fleet agent
   * (`claudebot` displays as "Splinter"), which is exactly the population this
   * rebuild added support for. Removing one of those left it on the board AND
   * in the removed list at the same time.
   *
   * The fixture below differs from the others in one deliberate way: its
   * instructions name it something its session is not.
   */
  const create = require('./engine/create');
  const status = require('./engine/status');
  const removal = require('./engine/remove');

  const session = 'two-named';
  fs.mkdirSync(create.workerDir(session), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(session), 'CLAUDE.md'),
    'You are **Bartholomew**.\n', 'utf8');
  fs.writeFileSync(nodePath.join(nodePath.dirname(create.plistPath(session)), `com.${session}.discord.plist`), '<plist/>', 'utf8');
  // The `-discord` session is how a real legacy agent appears: the board files
  // it under the bare name and reads its display name from its instructions.
  /**
   * ⚠️ Stub the pane CAPTURE as well as the pane SOURCE.
   *
   * Overriding only the source makes the roster synthetic and then lets
   * `/api/status` run real `tmux capture-pane` against every fixture name --
   * which printed `can't find session: two-named-discord` to stderr on each run, and made this
   * test depend on the machine's tmux (it would read differently on a box with
   * no tmux server, or one where a session happened to share the fixture's
   * name). `null` is exactly what real tmux answered for a session that does
   * not exist, so nothing else about the test changes.
   *
   * ⚠️ Deliberately per-test rather than at file load: several older tests call
   * `setPaneCapture(null)` in their own `finally`, which would clear a
   * file-level stub for everything running after it. And a few of them let the
   * roster fall through to the REAL fleet on purpose, so a global stub would
   * quietly change what those are measuring.
   */
  status.setPaneSource(() => fleet.line({ session: `${session}-discord`, title: '✳ Claude Code' }));
  status.setPaneCapture(() => null);
  removal.setRunner((f, a) => (a && a[0] === 'has-session' ? { ok: false, code: 1 } : { ok: true, stdout: '' }));
  removal.setDryRun(false);
  try {
    // ⚠️ THE CONTROL, twice over: it is on the board, and the two names really
    // do differ. Without the second check this test would pass against a
    // fixture whose names coincide, which is the hole it exists to close.
    const before = JSON.parse((await req('/api/status')).body).agents.find((a) => a.sessionName === session);
    assert.ok(before, 'the fixture is not on the board, so nothing below can fail');
    assert.notEqual(before.name, before.sessionName,
      'the fixture displays under its own session name, so it cannot distinguish the two fields');

    const gone = await req(`/api/agent/${session}/removal`, { method: 'DELETE' });
    assert.equal(gone.status, 200, gone.body);
    assert.equal(JSON.parse(gone.body).outcome, 'removed');

    const after = JSON.parse((await req('/api/status')).body).agents.map((a) => a.sessionName);
    assert.ok(!after.includes(session),
      'a removed agent whose display name differs from its session is still on the board');

    // ⚠️ AND THE COUNT AGREES WITH THE CARDS. A summary reading one more than
    // the board shows is how somebody hunts for an agent that is not there.
    const body = JSON.parse((await req('/api/status')).body);
    assert.equal(body.counts.total, body.agents.length,
      'the summary counts an agent the board no longer shows');
  } finally {
    // ⚠️ RESTORE BEFORE CLEARING THE RUNNER, not after. `setRunner(null)`
    // re-arms dry-run, and a dry-run restore answers `restored` while never
    // rewriting the file — so this ran, reported success, and left the record
    // in place, quietly filtering this name off `/api/status` for every test
    // added after it. Cleanup that cannot fail and does nothing is worse than
    // no cleanup, because it looks handled.
    await req(`/api/agent/${session}/restore`, { method: 'POST' }).catch(() => {});
    removal.setRunner(null);
    status.setPaneSource(null);
    // ⚠️ Put the capture back too, or this test's stub leaks onto every test
    // that runs after it -- including the ones that read the real fleet.
    status.setPaneCapture(null);
  }
});

test('a half-removed agent is on the removed list AND still on the board', async () => {
  /**
   * ⚠️ THE ONE PREDICATE THAT KEEPS A POSSIBLY-RUNNING AGENT VISIBLE, and until
   * this test nothing held it: deleting `stopped !== false` from the board
   * filter (so every removed record hides its card) left the whole suite green.
   *
   * That filter is the entire reason `isRemoved` and `isHidden` are separate
   * questions. A removal that half worked is recorded — so there is a Restore
   * button — and its agent may still be going, so its card must stay. Hiding a
   * running agent is the one thing this board must never do.
   *
   * The nearest existing test asserts the partial appears in `/api/removed` and
   * stops there, which is exactly half of the property.
   */
  const removal = require('./engine/remove');
  const create = require('./engine/create');
  const status = require('./engine/status');
  const name = 'half-visible';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'You are **Half**.\n', 'utf8');
  fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>', 'utf8');
  status.setPaneSource(() => fleet.line({ session: name, claim: name, title: '✳ Claude Code' }));
  status.setPaneCapture(() => null);
  // `bootout` refuses: disabled, but not stopped. The half-removal.
  removal.setRunner((file, args) => (args && args[0] === 'bootout'
    ? { ok: false, code: 2 }
    : { ok: true, stdout: '' }));
  removal.setDryRun(false);
  try {
    // ⚠️ CONTROL: it is on the board BEFORE the removal, or "it is still there
    // afterwards" is true of a board that never had it.
    const before = JSON.parse((await req('/api/status')).body).agents;
    assert.ok(before.some((a) => a.sessionName === name), 'the control failed: it was never on the board');

    const gone = removal.remove(name);
    assert.equal(gone.outcome, removal.OUTCOME.PARTIAL, gone.because);

    const listed = JSON.parse((await req('/api/removed')).body).agents.find((a) => a.name === name);
    assert.ok(listed, 'a half-removal is on no list, so it has no Restore button and no way back');
    assert.equal(listed.stopped, false, 'a half-removal was recorded as stopped');

    const after = JSON.parse((await req('/api/status')).body).agents;
    assert.ok(after.some((a) => a.sessionName === name),
      'an agent that may still be running was hidden from the board, which is the one thing it must never do');
  } finally {
    removal.setRunner(null);
    status.setPaneSource(null);
    status.setPaneCapture(null);
    try { fs.rmSync(removal.REMOVED_FILE, { force: true }); } catch { /* best effort */ }
  }
});


test('a job that is disabled but will not unload is recorded, not reported as untouched', async () => {
  /**
   * ⚠️ THE WORST STATE THIS MODULE CAN REACH, and it used to be invisible.
   *
   * `disable` and `bootout` were one step. When the first succeeded and the
   * second failed, the answer was "we have left it alone. Nothing has changed"
   * — while the job WAS disabled and would not start at the next login — and it
   * returned before writing the record. No record means no row in the removed
   * list, no Restore button, and the only way back is the manual launchctl
   * recipe this product exists to spare people.
   */
  const create = require('./engine/create');
  const status = require('./engine/status');
  const removal = require('./engine/remove');

  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  status.setPaneSource(() => '');
  try {
    const made = create.createAgent({ name: 'wont-unload', role: 'pm' });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  } finally {
    create.setRunner(null);
    status.setPaneSource(null);
  }

  removal.setRunner((f, a) => {
    const cmd = a && a[0];
    if (cmd === 'bootout') return { ok: false, code: 9 };   // the failure under test
    if (cmd === 'has-session') return { ok: false, code: 1 };
    return { ok: true, stdout: '' };
  });
  removal.setDryRun(false);
  try {
    const res = await req('/api/agent/wont-unload/removal', { method: 'DELETE' });
    const done = JSON.parse(res.body);
    assert.equal(done.outcome, 'partial',
      'a job that would not unload was reported as a completed removal');
    assert.doesNotMatch(done.because, /Nothing has changed/,
      'it says nothing changed while the job is disabled and will not start at the next login');
    assert.match(done.because, /still running/,
      'nothing tells the person the agent they removed is still going');

    // ⚠️ AND THERE IS A WAY BACK. This is the half that made the old behaviour
    // unrecoverable rather than merely mis-worded.
    const listed = JSON.parse((await req('/api/removed')).body).agents.map((a) => a.name);
    assert.ok(listed.includes('wont-unload'),
      'a half-removed agent is on no list, so there is no Restore button and no way back');
  } finally {
    // Same ordering rule as above: undo while the runner is still armed.
    await req('/api/agent/wont-unload/restore', { method: 'POST' }).catch(() => {});
    removal.setRunner(null);
  }
});

/* ===========================================================================
   First run — the screens

   ⚠️ WHAT THESE TESTS CANNOT DO IS SEE THE PAGE, and on this branch that is
   not a theoretical limit. A rule written `.fr-next` instead of `p.fr-next`
   lost to `.fr-body p` on specificity and did nothing at all; every assertion
   in this file passed over it, and fixing it revealed a 3.04:1 contrast failure
   that had been invisible because the rule was inert. Both were found by
   rendering the page in a browser and measuring it — `docs/browser-checks/`,
   run outside this suite because it needs a browser and this repo has no
   dependencies. Neither could have been found here. Do not treat what follows
   as coverage of how it looks.
   =========================================================================== */

test('the machine route always answers, with renderable checks and never an error', async () => {
  // ⚠️ The bound is `>= 1`, not `=== 3`, and deliberately: the route's own catch
  // path legitimately answers with a single "we could not check this computer"
  // row. Asserting three would make the honest degraded answer a test failure.
  const res = await req('/api/machine');
  assert.match(res.type, /application\/json/);
  assert.equal(res.status, 200,
    'the check screen has no branch for a failed route, because the route is written not to fail');
  const got = JSON.parse(res.body);
  assert.ok(Array.isArray(got.checks) && got.checks.length >= 1);
  for (const c of got.checks) {
    assert.ok(['ok', 'attention', 'unknown'].includes(c.state), 'unrenderable state: ' + c.state);
    assert.ok(c.title && c.detail, 'a check with nothing to say renders as an empty box');
  }
  assert.equal(typeof got.attention, 'number');
  assert.equal(typeof got.unknown, 'number');
  // The wire pin for the return step: engine tests exercise check() directly and the
  // render harness stubs this route, so without this line a route that
  // dropped the field would render an honest-looking "we could not check"
  // forever and no test anywhere would notice.
  assert.equal(got.appLocation && got.appLocation.key, 'app-location',
    'the /api/machine response must carry the appLocation field beside the rows');
});

test('leaving the return step really retires its pane (the bumps exist in production code)', () => {
  // The leave scenarios move the counter through t5.leave(), so they pin
  // the GUARD; these pins hold the TRIGGERS -- round 7 deleted both
  // production bumps and the suite stayed green, which silently restores
  // the round-6 state (a guard no production path ever moves).
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(raw, /if \(step > FR_STEPS\) step = FR_STEPS;[\s\S]{0,600}?if \(step !== FR_STEP_RETURN\) FR_RETURN_GEN \+= 1;/,
    'frGo no longer bumps the return generation AFTER both clamps (a text-only pin could not see the placement, and the round-7 record claimed a position the code did not have)');
  const closeFn = raw.slice(raw.indexOf('function frClose'), raw.indexOf('function frClose') + 400);
  assert.match(closeFn, /FR_RETURN_GEN \+= 1;/,
    'frClose no longer bumps the return generation on the way out');
});

test('the return-step live region is static markup with its announcement attributes', () => {
  // The unit harness's DOM stub auto-creates any id, so without this pin
  // the region (and both its ARIA attributes) could be deleted from the
  // page while every return-step test stayed green -- and the announcement,
  // the whole reason the region was restructured, would silently stop.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(raw, /<div id="fr-return-row" role="status" aria-live="polite"><\/div>/,
    'the return-step live region must exist in the STATIC markup, before anything fills it');
  assert.match(raw, /<div id="fr-return-dock" role="status" aria-live="polite"><\/div>/,
    'the dock is a live region too: its instruction changes with the answer, and the correction must be heard');
});

test('the degraded machine answer publishes the ENGINE\u2019S could-not-look row', () => {
  // The catch path cannot be forced over HTTP on a healthy machine, so two
  // pins hold it: the shared row renders through the row grammar (shape),
  // and the route SOURCE references the engine's function rather than a
  // hand-copied literal (reference).
  const row = require('./engine/machine').appLocationUnknown();
  assert.equal(row.key, 'app-location');
  assert.equal(row.state, 'unknown');
  assert.ok(row.title && row.detail, 'a row with nothing to say renders as an empty box');
  const src = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /appLocation: machine\.appLocationUnknown\(\)/,
    'the degraded catch hand-writes its appLocation again (a copied literal goes stale the moment the wording moves)');
});

test('a check row carries its state in a WORD, not only in a glyph and a colour', () => {
  /**
   * ⚠️ Three findings, and two of the three glyphs are punctuation. `!` and `?`
   * are aria-hidden decoration; without the visually-hidden word beside them a
   * screen reader hears three sentences and cannot tell which one is the
   * problem — on the screen whose entire job is saying which one is.
   *
   * Same defect `tickLine` fixed on the creation screen, arriving on a new one.
   */
  // ⚠️ The two lookup tables are LIFTED FROM THE PAGE, not retyped here. A
  // copy of "ready" / "needs your attention" / "could not check" in this file
  // is a second set of the exact words under test, and it would go on passing
  // after the page's own set drifted away from it.
  const raw0 = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script0 = raw0.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tables = ['FR_SAY', 'FR_GLYPH', 'FR_SAY_LOCAL', 'FR_GLYPH_LOCAL'].map((n) => {
    const m = script0.match(new RegExp('const ' + n + ' = \\{[^}]*\\};'));
    assert.ok(m, n + ' vanished from the page');
    return m[0];
  }).join('\n');
  // ⚠️ The REAL `esc`, lifted from the page, not a `String(s)` stub. With the
  // stub this test would have gone on passing after `esc()` was removed from
  // `frCheckRow` entirely -- and what flows through it is engine prose today,
  // but the whole point of the machine checks is that they quote paths and
  // error strings from the machine.
  const realEsc = pageFunction('esc');
  const frCheckRow = pageFunction('frCheckRow',
    'const esc = ' + realEsc.toString() + ';\n' + tables);

  const good = frCheckRow({ state: 'ok', title: 'Everything is installed', detail: 'Nothing to do.' });
  const bad = frCheckRow({ state: 'attention', title: 'This Mac sleeps', detail: 'They stop.' });
  const dunno = frCheckRow({ state: 'unknown', title: 'We could not tell', detail: 'We could not look.' });

  assert.match(good, /class="vh">ready: <\/span>/, 'a passing check says nothing aloud');
  assert.match(bad, /class="vh">needs your attention: <\/span>/,
    'a FINDING is indistinguishable from a pass to a screen reader');
  assert.match(dunno, /class="vh">could not check: <\/span>/,
    'a check we could not run sounds exactly like one that passed');

  // And the three are visually distinct too, by class rather than by hue alone.
  assert.match(good, /class="fr-check ok"/);
  assert.match(bad, /class="fr-check attention"/);
  assert.match(dunno, /class="fr-check unknown"/);

  // ⚠️ A state the screen has no branch for must not render as a pass. It falls
  // to `unknown`, which is the only safe direction for an answer we do not
  // understand — the same rule the engine below it is built on.
  const weird = frCheckRow({ state: 'probably-fine', title: 'Hmm', detail: 'Hmm.' });
  assert.match(weird, /class="fr-check unknown"/,
    'a state this screen does not know was drawn as a tick');

  assert.match(bad, /aria-hidden="true">!</, 'the glyph is announced as well as shown');

  // ⚠️ And it actually escapes. The machine checks quote real paths and real
  // error strings back at the person; a title carrying a `<` must not become
  // markup on the screen that is meant to be telling them the truth.
  const nasty = frCheckRow({
    state: 'attention',
    title: 'tmux is not at </div><script>x</script>',
    detail: 'We looked for it at /opt/<b>homebrew</b>/bin/tmux.',
  });
  assert.ok(!/<script>/.test(nasty), 'a check title carrying markup reached the page as markup');
  assert.match(nasty, /&lt;script&gt;|&lt;\/div&gt;/, 'nothing was escaped at all');
});

test('first run fails CLOSED: an unreadable answer shows no onboarding at all', () => {
  /**
   * ⚠️ THE DIRECTION MATTERS AND IT IS THE OPPOSITE OF THE USUAL ONE. Putting a
   * welcome screen over somebody's working board because one fetch failed is
   * worse than never showing it — `engine/firstrun.seen()` makes exactly this
   * call one layer down, and the front door has to make it too or the engine's
   * care is undone by the page.
   */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('async function firstRunBoot');
  assert.ok(start > -1, 'firstRunBoot vanished');
  let d = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') d += 1;
    else if (script[k] === '}') { d -= 1; if (d === 0) { end = k + 1; break; } }
  }
  const body = script.slice(start, end);
  assert.match(body, /catch\s*(\([^)]*\))?\s*\{\s*return;?\s*\}/,
    'the fetch failure path no longer returns without opening anything');
  assert.ok(body.indexOf('catch') < body.indexOf('frOpen'),
    'frOpen is now reachable before the failure has been ruled out');
  assert.match(body, /state\.done\s*&&\s*!force/,
    'the done flag no longer decides whether to show this, so it shows every launch');
});

test('the first-run buttons are ASSIGNED, not accumulated', () => {
  /**
   * ⚠️ Continue means a different thing on each of the six steps, and the
   * one-of-three fork lives on step 6 now. `addEventListener` on a button whose meaning changes
   * leaves every previous meaning still bound, so Back-then-Continue fires two
   * of them — measured as "advanced two steps at once" the first time it was
   * clicked through.
   */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('function frActions');
  assert.ok(start > -1, 'frActions vanished');
  let d = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') d += 1;
    else if (script[k] === '}') { d -= 1; if (d === 0) { end = k + 1; break; } }
  }
  const body = script.slice(start, end);
  assert.match(body, /\.onclick\s*=/, 'frActions no longer assigns the handler');
  assert.ok(!/addEventListener/.test(body),
    'frActions adds listeners to buttons whose meaning changes on every step');
});

test('the fleet screen shows no name chips, and the fork is guarded (static pins)', () => {
  /**
   * ⚠️ The chips DIED at Josh's word (2026-08-17): a person can arrive with
   * hundreds of agents, and the heading's count is the claim. The old
   * count-vs-names reconciliation died with them; what must now be pinned
   * is that the list stays gone (a chip list quietly returning re-creates
   * the 600-chip screen he vetoed) and the fork stays guarded.
   */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('function frPaintFleet');
  assert.ok(start > -1, 'frPaintFleet vanished');
  let d = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') d += 1;
    else if (script[k] === '}') { d -= 1; if (d === 0) { end = k + 1; break; } }
  }
  const body = script.slice(start, end);
  assert.ok(!/fr-name/.test(body), 'the name-chip list came back to the fleet screen');
  assert.ok(!/fleetNames/.test(body), 'the painter reads the names again, so a list is a one-line regression away');

  // And the fork is only offered when the engine could actually count.
  assert.match(body, /path === 'adopt'/);
  assert.match(body, /path === 'create'/);
  assert.ok(body.indexOf('could not see what is on this computer') > -1,
    'the unknown path no longer says why it is not choosing, so it quietly picks one');
});

test('the "we could not remember that" message lives outside the step panes', () => {
  /**
   * ⚠️ Skip is on EVERY step, and this message started inside the fork
   * pane (fr-pane-5 since About-you landed at 4)
   * — so somebody who skipped from the welcome screen, on a machine where the
   * flag would not stick, was told nothing at all: the sentence was written into
   * a hidden div. Found by clicking Skip from step 1 rather than by reading it.
   */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const forgot = raw.indexOf('id="fr-forgot"');
  assert.ok(forgot > -1, 'the element the failure message is written into vanished');

  /**
   * ⚠️ TAG-DEPTH SCANNED, NOT INDEX-COMPARED. The first version of this
   * assertion took the first `</div>` after `id="fr-fleet"` as the end of the
   * pane -- but that tag closes `fr-fleet` itself, so anything placed after it
   * and still inside the pane scored as "outside". Mutation-tested by genuinely
   * moving the element back in: the check passed, which is the whole failure
   * mode this file keeps finding. It now walks the tags.
   */
  const endOf = (openIdx) => {
    let depth = 0;
    const tag = /<(\/?)div\b|\/>/g;
    tag.lastIndex = raw.lastIndexOf('<div', openIdx);
    let m;
    while ((m = tag.exec(raw))) {
      if (m[0] === '/>') continue;
      depth += m[1] ? -1 : 1;
      if (depth === 0) return m.index;
    }
    return -1;
  };
  const pane5 = raw.indexOf('id="fr-pane-5"');
  const pane5End = endOf(pane5);
  assert.ok(pane5End > pane5, 'could not find the end of the fork pane');
  assert.ok(forgot < pane5 || forgot > pane5End,
    'the completion-failure message is back inside a pane that is hidden on '
    + 'every other step, so skipping from step 1 says nothing at all');

  // ⚠️ And it is inside the body it has to be visible in, not floating loose
  // after the action bar where no step would show it either.
  const bodyStart = raw.indexOf('class="fr-body"');
  assert.ok(forgot > bodyStart && forgot < endOf(bodyStart),
    'the failure message left the panel body');
  assert.match(raw.slice(forgot - 200, forgot + 200), /role="alert"/,
    'the one message somebody must not miss is no longer announced');

  /**
   * ⚠️ MATCHED AGAINST `frFinish`, NOT AGAINST THE WHOLE SCRIPT. The first
   * version searched the entire `<script>` body -- and `frGo` also touches
   * `fr-forgot` (it clears it on every step change), so deleting the write from
   * `frFinish` outright left this green. Every other assertion in this block
   * brace-matches the function first; this one did not, which is exactly how a
   * test ends up guarding nothing.
   */
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const fStart = script.indexOf('async function frFinish');
  assert.ok(fStart > -1, 'frFinish vanished');
  let fd = 0; let fEnd = -1;
  for (let k = script.indexOf('{', fStart); k < script.length; k += 1) {
    if (script[k] === '{') fd += 1;
    else if (script[k] === '}') { fd -= 1; if (fd === 0) { fEnd = k + 1; break; } }
  }
  assert.ok(fEnd > -1, 'could not find the end of frFinish');
  assert.match(script.slice(fStart, fEnd), /getElementById\('fr-forgot'\)/,
    'frFinish no longer writes the failure anywhere');
});

/* ---------------------------------------------------------------------------
   The two first-run render functions, RUN rather than grepped.

   ⚠️ The plan for this branch promised `pageFunction` tests on the render
   functions and only `frCheckRow` got one; the rest were regex-over-source
   assertions, which this file's own header says are not coverage of behaviour.
   These run the real functions against real payload shapes.
--------------------------------------------------------------------------- */

/** A fake DOM just big enough for the two painters. */
function firstRunHarness(name, state, opts = {}) {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tables = ['FR_SAY', 'FR_GLYPH', 'FR_SAY_LOCAL', 'FR_GLYPH_LOCAL'].map((n) => {
    const m = script.match(new RegExp('const ' + n + ' = \\{[^}]*\\};'));
    assert.ok(m, n + ' vanished from the page');
    return m[0];
  }).join('\n');
  const realEsc = pageFunction('esc');
  const realRow = pageFunction('frCheckRow',
    'const esc = ' + realEsc.toString() + ';\n' + tables);
  // The REAL fork, not a stub: the endings live on the fleet screen now, and
  // a painter calling a stubbed fork would let the pairs drift untested. Its
  // free names (FR, frActions, frFinish, ...) rebind to the harness scope.
  const realFork = pageFunction('frForkActions',
    'let FR = null; function frActions() {} function frFinish() {} function openCreate() {} function showTab() {}');

  const els = {};
  const prelude = `
    const esc = ${realEsc.toString()};
    ${tables}
    const frCheckRow = ${realRow.toString()};
    const __els = {};
    const document = { getElementById: (id) => (__els[id] = __els[id] || { innerHTML: '', textContent: '' }) };
    let FR = ${JSON.stringify(state.FR)};
    let FR_MACHINE = ${JSON.stringify(state.FR_MACHINE === undefined ? null : state.FR_MACHINE)};
    let __actions = null;
    function frActions(primary, alt) { __actions = { primary: primary.label, alt: alt && alt.label }; }
    ${name === 'frForkActions' ? '' : 'const frForkActions = ' + realFork.toString() + ';'}
    function frGo() {}
    function frFinish() {}
    function frRecheck() {}
    function openCreate() {}
    function showTab() {}
    globalThis.__els = __els;
    globalThis.__actions = () => __actions;
    ${opts.prelude || ''}
  `;
  const fn = pageFunction(name, prelude);
  // An async painter returns a promise; `done` lets the caller await the
  // post-fetch writes while still reading the pre-paint synchronously (the
  // element stubs are live references, so reads after `await done` see the
  // upgraded content).
  const out = fn();
  return { els: globalThis.__els, actions: globalThis.__actions(), done: Promise.resolve(out) };
}

test('an unrecognised subscription answer never renders as "you have none"', () => {
  /**
   * ⚠️ THE ONE SENTENCE `engine/subscription.js` SAYS MUST NOT BE SHOWN TO
   * SOMEBODY WE COULD NOT READ. The dispatcher's first version fell through to
   * the negative for anything it did not recognise -- a fourth state, a
   * truncated response, a typo -- which tells a paying customer to go and buy a
   * second subscription, on the screen that decides whether they keep this.
   */
  for (const sub of [
    { state: 'unknown', because: 'a plan we do not recognise' },
    { state: 'something-new' },
    { state: '' },
    null,
    undefined,
  ]) {
    const { els } = firstRunHarness('frPaintSubscription', { FR: { subscription: sub } });
    const out = els['fr-sub'].innerHTML;
    assert.ok(!/No Claude subscription is connected/.test(out),
      `subscription state ${JSON.stringify(sub)} rendered as the flat negative`);
    assert.match(out, /fr-check unknown/,
      `subscription state ${JSON.stringify(sub)} did not render as "we could not tell"`);
  }

  // ⚠️ THE CONTROL. If nothing can produce the negative any more, the assertions
  // above are vacuous — so the one state that SHOULD produce it must.
  const { els } = firstRunHarness('frPaintSubscription', { FR: { subscription: { state: 'none' } } });
  assert.match(els['fr-sub'].innerHTML, /No Claude subscription is connected/,
    'nothing renders the negative any more, so the assertions above prove nothing');
});

test('the fleet screen renders every path, and a broken payload lands on "we could not see"', () => {
  const adopt = firstRunHarness('frPaintFleet', {
    FR: { path: 'adopt', fleetCount: 13, fleetNames: ['Splinter', 'Angel'] },
  });
  assert.match(adopt.els['fr-title'].textContent, /13 agents/);
  // No name chips, at Josh's word (2026-08-17): the heading's count is the
  // claim, and a 600-agent fleet must not become a 600-chip screen.
  assert.ok(!/fr-name/.test(adopt.els['fr-fleet'].innerHTML), 'the chip list came back');
  assert.match(adopt.els['fr-fleet'].innerHTML, /nothing to import/i);

  const create = firstRunHarness('frPaintFleet', {
    FR: { path: 'create', fleetCount: 0, fleetNames: [] },
  });
  assert.match(create.els['fr-title'].textContent, /Create your first agent/i);
  // The endings ARE this screen's actions now, buttons verbatim from the
  // pack (spec ed29b78): adopt and create carry ONE action each; only the
  // unknown ending gets two, asserted in the broken-payload loop below.
  assert.equal(adopt.actions.primary, 'Take me to my agents', JSON.stringify(adopt.actions));
  assert.equal(adopt.actions.alt, undefined, 'the adopt ending grew a second button');
  assert.equal(create.actions.primary, 'Create my first agent', JSON.stringify(create.actions));
  assert.equal(create.actions.alt, undefined, 'the create ending grew a second button');

  /**
   * ⚠️ EVERY MALFORMED SHAPE LANDS ON "we could not see", never on a fork. The
   * board is built from `tmux`, and guessing "make your first agent" at somebody
   * with a running fleet is the version of this mistake that looks broken.
   */
  for (const FR of [
    null,
    {},
    { path: 'unknown', fleetCount: null, fleetNames: [] },
    { path: 'adopt' },                                   // names the path, but no count
    { path: 'adopt', fleetCount: 'lots', fleetNames: [] },
    { path: 'nonsense', fleetCount: 3, fleetNames: [] },
  ]) {
    const got = firstRunHarness('frPaintFleet', { FR });
    const title = got.els['fr-title'].textContent;
    const body = got.els['fr-fleet'].innerHTML;
    /**
     * ⚠️ THE ASSERTION THE COMMENT ALWAYS CLAIMED. This loop used to check only
     * that SOMETHING rendered -- a non-empty heading, a non-empty body, a
     * button -- and `{ path: 'adopt' }` satisfied all three while rendering
     * "You already have undefined agents here". The comment above said every
     * malformed shape lands on "we could not see"; nothing tested it, and one
     * of the shapes in its own list did not.
     */
    assert.match(title, /could not see/i,
      `payload ${JSON.stringify(FR)} rendered a fork rather than "we could not see": "${title}"`);
    assert.ok(!/undefined|NaN|null/.test(title + body),
      `payload ${JSON.stringify(FR)} put a placeholder on screen: "${title}"`);
    assert.ok(body.length > 0, `payload ${JSON.stringify(FR)} rendered an empty screen`);
    // Every malformed shape lands on the pack's ending C, the one screen
    // in the flow with TWO actions -- it refuses to choose because either
    // single guess would be a lie (spec ed29b78, pack ENDINGS verbatim).
    assert.equal(got.actions && got.actions.primary, 'Show me my agents',
      `payload ${JSON.stringify(FR)} left the person short of a way onward: ${JSON.stringify(got.actions)}`);
    assert.equal(got.actions.alt, 'Create an agent',
      `payload ${JSON.stringify(FR)} lost ending C's second door: ${JSON.stringify(got.actions)}`);
  }

  // The pack's endings' buttons, per path: adopt and create carry ONE,
  // the unknown ending two. frForkActions is the single holder.
  for (const [path, primary, alt] of [
    ['adopt', 'Take me to my agents', undefined],
    ['create', 'Create my first agent', undefined],
    ['unknown', 'Show me my agents', 'Create an agent'],
  ]) {
    const got = firstRunHarness('frForkActions', { FR: { path, fleetCount: 1, fleetNames: ['x'] } });
    assert.equal(got.actions && got.actions.primary, primary, `the ${path} ending primary drifted`);
    assert.equal(got.actions.alt, alt, `the ${path} ending's second door drifted`);
  }

  // ⚠️ The fork guards its payload with the SAME predicate as the fleet
  // screen, or the pairs drift from the path logic (they did, when the fork
  // moved to the orientation step): an adopt payload whose fleet could not
  // be counted had the fleet screen honestly refuse to guess while the
  // orientation step's button read "Take me to my agents" -- the fleet we
  // could not count asserted as one that exists.
  // Every uncountable-adopt shape lands on the neutral pair, which promises
  // only the board.
  for (const FR of [
    { path: 'adopt' },
    { path: 'adopt', fleetCount: 'lots', fleetNames: [] },
    { path: 'adopt', fleetCount: 0, fleetNames: [] },
    { path: 'adopt', fleetCount: null, fleetNames: [] },
  ]) {
    const got = firstRunHarness('frForkActions', { FR });
    assert.equal(got.actions.primary, 'Show me my agents',
      `payload ${JSON.stringify(FR)} claimed a fleet nobody counted: ${JSON.stringify(got.actions)}`);
    assert.equal(got.actions.alt, 'Create an agent',
      `payload ${JSON.stringify(FR)} lost the neutral second door`);
  }
});

test('the return step paints a look in progress, then the engine answer, and could-not-ask on failure', async () => {
  // The Success screen's ruled dock line (first-run spec, pack copy) names
  // no folder, so ONE sentence is true in every app-location state -- the
  // per-state variants died with the redesign, and every case asserts the
  // same ruled line.
  const cases = [
    [{ key: 'app-location', state: 'ok', title: 'You will find it in your Applications folder', detail: 'Open it from there.' },
      /Drag Kosmos onto the Dock, the strip of icons/],
    [{ key: 'app-location', state: 'attention', title: 'We could not find the Kosmos icon', detail: 'Not the same as it not being there.' },
      /Drag Kosmos onto the Dock, the strip of icons/],
    [{ key: 'app-location', state: 'unknown', title: 'We could not check where the Kosmos icon is', detail: 'Nothing is wrong.' },
      /Drag Kosmos onto the Dock, the strip of icons/],
  ];
  const PRELUDE_VARS = `
    let FR_RETURN_GEN = 0;
    let FR_MACHINE_LOOK = null;
  `;
  for (const [row, dockRe] of cases) {
    const h = firstRunHarness('frPaintReturn', { FR: {} }, {
      prelude: PRELUDE_VARS + `
        const fetch = async () => ({ ok: true, json: async () => ({ appLocation: ${JSON.stringify(row)} }) });
      `,
    });
    // The pre-paint is a look IN PROGRESS -- not the completed "could not
    // check" it used to claim before any look had happened, and not
    // byte-identical to the engine's real unknown row. Asserted on the ROW
    // itself: the region is static markup now and the placeholder is written
    // straight into it, so this stub really is overwritten by the upgrade
    // (the old wrapper-level assertion could not fail).
    assert.match(h.els['fr-return-row'].innerHTML, /fr-check checking/);
    assert.match(h.els['fr-return-row'].innerHTML, /Checking where the Kosmos icon is/);
    await h.done;
    assert.match(h.els['fr-return-row'].innerHTML, new RegExp(row.title));
    assert.match(h.els['fr-return-row'].innerHTML, new RegExp('fr-check ' + row.state));
    assert.match(h.els['fr-return-dock'].innerHTML, dockRe);
    assert.ok(!/Checking where the Kosmos icon is/.test(h.els['fr-return-row'].innerHTML),
      'the placeholder survived the fetch');
  }

  // Could not ASK: its own wording ("right now"), distinct from the engine's
  // own could-not-check row -- and the DOCK moves with the row, so a
  // folder-pointing instruction cannot outlive the answer that named it.
  const broken = firstRunHarness('frPaintReturn', { FR: {} }, {
    prelude: PRELUDE_VARS + `
      const fetch = async () => { throw new Error('down'); };
    `,
  });
  await broken.done;
  assert.match(broken.els['fr-return-row'].innerHTML, /could not check where the Kosmos icon is right now/);
  assert.match(broken.els['fr-return-row'].innerHTML, /fr-check unknown/);
  assert.match(broken.els['fr-return-dock'].innerHTML, /Drag Kosmos onto the Dock, the strip of icons/,
    'the failure path lost the ruled dock line');

  // A payload WITHOUT the appLocation field (an old server, a shape drift)
  // lands on could-not-ask too, never on the placeholder forever.
  const shapeless = firstRunHarness('frPaintReturn', { FR: {} }, {
    prelude: PRELUDE_VARS + `
      const fetch = async () => ({ ok: true, json: async () => ({ checks: [] }) });
    `,
  });
  await shapeless.done;
  assert.match(shapeless.els['fr-return-row'].innerHTML, /right now/);

  // An answer with nothing to SAY is not an answer: {state:'ok'} with no
  // title rendered a confident tick over a blank box, above a dock pointing
  // at a folder the screen never named.
  const blank = firstRunHarness('frPaintReturn', { FR: {} }, {
    prelude: PRELUDE_VARS + `
      const fetch = async () => ({ ok: true, json: async () => ({ appLocation: { key: 'app-location', state: 'ok' } }) });
    `,
  });
  await blank.done;
  assert.match(blank.els['fr-return-row'].innerHTML, /right now/,
    'a contentless ok payload rendered as a confident blank tick');
  assert.ok(!/out of that folder/.test(blank.els['fr-return-dock'].innerHTML),
    'the dock pointed at a folder no row named');

  // A wire row claiming the LOCAL state renders as unknown, never as a
  // permanent look-in-progress.
  for (const sneaky of [
    { key: 'app-location', state: 'checking', title: 'sneaky', detail: 'x' },
    // The row claiming local-ness ITSELF: trust is the caller's argument,
    // never a field the wire can set.
    { key: 'app-location', state: 'checking', local: true, title: 'sneakier', detail: 'x' },
  ]) {
    const wireChecking = firstRunHarness('frPaintReturn', { FR: {} }, {
      prelude: PRELUDE_VARS + `
        const fetch = async () => ({ ok: true, json: async () => ({ appLocation: ${JSON.stringify(sneaky)} }) });
      `,
    });
    await wireChecking.done;
    assert.match(wireChecking.els['fr-return-row'].innerHTML, /fr-check unknown/,
      `a wire state of "checking" (${JSON.stringify(sneaky)}) must fall back to unknown`);
  }
});

test('the return step: entries share one in-flight look, and a stale look cannot repaint a newer entry', async () => {
  // One module state, two overlapping entries, a fetch we resolve by hand.
  const realEsc = pageFunction('esc');
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tables = ['FR_SAY', 'FR_GLYPH', 'FR_SAY_LOCAL', 'FR_GLYPH_LOCAL'].map((n) => {
    const m = script.match(new RegExp('const ' + n + ' = \\{[^}]*\\};'));
    assert.ok(m, n + ' vanished from the page');
    return m[0];
  }).join('\n');
  const realRow = pageFunction('frCheckRow', 'const esc = ' + realEsc.toString() + ';\n' + tables);
  const prelude = `
    const esc = ${realEsc.toString()};
    ${tables}
    const frCheckRow = ${realRow.toString()};
    const __els = {};
    const document = { getElementById: (id) => (__els[id] = __els[id] || { innerHTML: '', textContent: '' }) };
    let FR_RETURN_GEN = 0;
    let FR_MACHINE_LOOK = null;
    let __calls = 0; let __resolve = null;
    const fetch = () => { __calls += 1; return new Promise((res) => { __resolve = res; }); };
    globalThis.__t5 = { els: __els, calls: () => __calls, resolve: (v) => __resolve(v), leave: () => { FR_RETURN_GEN += 1; } };
  `;
  const fn = pageFunction('frPaintReturn', prelude);
  const t5 = globalThis.__t5;
  const e1 = fn();
  const e2 = fn();
  assert.equal(t5.calls(), 1,
    'the second entry re-fired the route instead of joining the in-flight look');
  t5.resolve({ ok: true, json: async () => ({ appLocation: { key: 'app-location', state: 'ok', title: 'You will find it in your Applications folder', detail: 'Open it.' } }) });
  await e1; await e2;
  // The NEWEST entry's paint is what stands; the stale continuation returned
  // without touching the pane (both write the same answer here, so the
  // observable pin is: the answer landed exactly, and the dock matches it).
  assert.match(t5.els['fr-return-row'].innerHTML, /You will find it in your Applications folder/);
  assert.match(t5.els['fr-return-dock'].innerHTML, /Drag Kosmos onto the Dock, the strip of icons/);

  // Second scenario: entries 3 and 4 SHARE one look (asserted by call
  // count), the shared look fails, and both continuations paint the same
  // could-not-ask -- what this proves is the failure path repaints the dock
  // alongside the row, and that a settled look really cleared for a fresh
  // entry. (It deliberately does NOT prove the generation guard: shared
  // looks mean live entries always paint identical content. The guard's
  // one reachable job is tested in the LEAVE scenario below.)
  const e3 = fn();
  assert.equal(t5.calls(), 2, 'the settled look was not cleared for the next entry');
  const e4 = fn();
  assert.equal(t5.calls(), 2, 'entry 4 should join entry 3\u2019s in-flight look');
  t5.resolve({ ok: false });
  await e3; await e4;
  assert.match(t5.els['fr-return-row'].innerHTML, /right now/,
    'the failure path did not paint could-not-ask');
  assert.match(t5.els['fr-return-dock'].innerHTML, /Drag Kosmos onto the Dock, the strip of icons/,
    'the failure repaint lost the ruled dock line');

  // ⚠️ THE GUARD'S JOB, and the scenarios that red when the guard lines are
  // deleted (round 5 proved the shared-look scenarios above pass without
  // them): the person LEAVES the return step while the look is in flight, and the
  // late settlement must not repaint the pane. In production the bump IS
  // performed by frGo(step !== FR_STEP_RETURN) and frClose (round 6 made the premise
  // real); here t5.leave() performs the same mutation those perform.
  // Success copy of the guard:
  const e5 = fn();
  assert.equal(t5.calls(), 3);
  const before = t5.els['fr-return-row'].innerHTML; // this entry's placeholder
  t5.leave();
  t5.resolve({ ok: true, json: async () => ({ appLocation: { key: 'app-location', state: 'ok', title: 'You will find it in your Applications folder', detail: 'Open it.' } }) });
  await e5;
  assert.equal(t5.els['fr-return-row'].innerHTML, before,
    'a look resolving after the person left the step repainted the pane');
  // Failure copy of the guard (the catch's own gen check, which the
  // shared-look failure scenario cannot exercise):
  const e6 = fn();
  assert.equal(t5.calls(), 4);
  const before6 = t5.els['fr-return-row'].innerHTML;
  const dock6 = t5.els['fr-return-dock'].innerHTML;
  t5.leave();
  t5.resolve({ ok: false });
  await e6;
  assert.equal(t5.els['fr-return-row'].innerHTML, before6,
    'a look FAILING after the person left the step repainted the pane');
  assert.equal(t5.els['fr-return-dock'].innerHTML, dock6,
    'the stale failure rewrote the dock of a pane the person left');
});

test('the fork step does not promise a working agent over a check screen that disagreed', () => {
  /**
   * ⚠️ THREE CASES, and the first version of this collapsed them to two. "We
   * never checked" is not "we checked and it was fine", and an `unknown` row is
   * not a clean one — filtering only `attention` dropped three "we could not
   * check" findings and made the promise anyway.
   */
  const clean = firstRunHarness('frPaintFleet', {
    FR: { path: 'create', fleetCount: 0, fleetNames: [] },
    FR_MACHINE: { checks: [{ key: 'sleep', state: 'ok', title: 'fine', detail: 'fine' }], attention: 0, unknown: 0 },
  });
  assert.ok(!/still outstanding|did not get to look/.test(clean.els['fr-fleet'].innerHTML),
    'warned about a machine that checked out clean');

  const snagged = firstRunHarness('frPaintFleet', {
    FR: { path: 'create', fleetCount: 0, fleetNames: [] },
    FR_MACHINE: {
      checks: [
        { key: 'installed', state: 'attention', title: 'Claude Code is not where we expected it', detail: 'x' },
        { key: 'restart', state: 'unknown', title: 'We could not tell whether your agents will start themselves', detail: 'x' },
      ],
      attention: 1,
      unknown: 1,
    },
  });
  const out = snagged.els['fr-fleet'].innerHTML;
  assert.match(out, /still outstanding/, 'made the promise over the top of a real finding');
  assert.match(out, /Claude Code is not where we expected it/);
  assert.match(out, /We could not tell whether your agents/,
    'the "we could not check" rows were dropped, so only two of the three states are honoured');

  const never = firstRunHarness('frPaintFleet', {
    FR: { path: 'create', fleetCount: 0, fleetNames: [] },
    FR_MACHINE: null,
  });
  assert.match(never.els['fr-fleet'].innerHTML, /did not get to look/,
    'a person who never saw the check screen was told everything is in place');
});

test('the first-run routes answer, and the completion route reports what stuck', async () => {
  /**
   * ⚠️ THE ONLY NEW ROUTE THAT WRITES HAD NO SERVER TEST. The browser harness
   * stubs `/api/first-run/complete`, so the server's own `ok ? 200 : 500`
   * read-back decision -- the thing that turns "we wrote it" into "it is
   * actually there" -- was exercised nowhere at all.
   */
  const firstrun = require('./engine/firstrun');
  const fsExists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

  const got = await req('/api/first-run');
  assert.match(got.type, /application\/json/);
  const state = JSON.parse(got.body);
  for (const field of ['done', 'fleetKnown', 'path', 'subscription']) {
    assert.ok(field in state, `/api/first-run stopped answering ${field}, which the screen reads`);
  }
  assert.ok(['adopt', 'create', 'unknown'].includes(state.path),
    `the screen has no branch for path "${state.path}"`);
  assert.ok(['connected', 'none', 'unknown'].includes(state.subscription.state),
    `the screen has no branch for subscription "${state.subscription.state}"`);

  /**
   * ⚠️ A GET MUST NOT WRITE THE FLAG, and the first version of this could not
   * tell. It read `done` on one GET and compared a later GET to it — but never
   * established that `done` started FALSE. If reading wrote the flag, the very
   * first GET in this test had already flipped it, so every subsequent read was
   * `true` and the comparison passed.
   *
   * Proven, not argued: with the route changed to call `firstrun.complete()` on
   * every read — i.e. loading the page switches off onboarding, the exact
   * failure this comment names — the whole file stayed green.
   *
   * So it asserts the control, and it asks the DISK rather than the route.
   */
  assert.equal(state.done, false,
    'this machine has already been through first run, so this test cannot tell whether a '
    + 'GET writes the flag — the control is gone and everything below it is vacuous');
  assert.ok(!fsExists(firstrun.FLAG), 'the flag file exists before any write was asked for');

  await req('/api/first-run');
  await req('/api/first-run');
  assert.ok(!fsExists(firstrun.FLAG),
    'reading the first-run state WROTE the completion flag, so loading the page switches '
    + 'off onboarding');
  assert.equal(JSON.parse((await req('/api/first-run')).body).done, false,
    'reading the first-run state changed it');

  // The write, through the real route, against the sandboxed store.
  const wrote = await req('/api/first-run/complete', {
    method: 'POST',
    headers: { origin: base.replace(/\/$/, '') },
  });
  assert.match(wrote.type, /application\/json/);
  assert.equal(wrote.status, 200, `the completion route refused: ${wrote.body}`);
  assert.equal(JSON.parse(wrote.body).done, true);

  // ⚠️ AND IT STUCK, asked of the route rather than of the write. This is the
  // whole point of the read-back: a flag that did not persist means onboarding
  // returns on the next launch over a board somebody has already set up.
  assert.equal(JSON.parse((await req('/api/first-run')).body).done, true,
    'the completion route answered 200 for a flag that is not there when you ask again');
});

test('the completion route is a write, so another website cannot fire it', async () => {
  // ⚠️ Inherits the cross-site guard by being a POST. Without it, any page you
  // visit could switch off somebody's onboarding on their own machine.
  const cross = await req('/api/first-run/complete', {
    method: 'POST',
    headers: { origin: 'https://example.com' },
  });
  assert.equal(cross.status, 403, 'a cross-site POST was accepted');
  assert.match(cross.type, /application\/json/);
});

test('the display name is writable through the profile route, and a blank cannot erase it', async () => {
  // ⚠️ Round 32: the record WINS over the instruction file, creation was
  // the only writer, and the PUT whitelisted role only -- so a
  // Kosmos-created agent had a permanently unchangeable name, and the old
  // rename path (editing the identity line) silently stopped working.
  const status = require('./engine/status');
  const store = require('./engine/store');
  status.setPaneSource(() => fleet.line({ session: 'angel-discord', title: 'working' }));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    const put = await req('/api/agent/angel/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '  Seraph  ' }),
    });
    assert.equal(put.status, 200);
    assert.equal(store.readProfile('angel').displayName, 'Seraph', 'trimmed and stored');
    // A blank is dropped rather than stored: a person cannot un-name an
    // agent by accident, and the record keeps the last real name.
    const blank = await req('/api/agent/angel/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '   ' }),
    });
    assert.equal(blank.status, 200);
    assert.equal(store.readProfile('angel').displayName, 'Seraph', 'a blank overwrote the name');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('renaming through the identity line updates the record; mangling it cannot un-name', async () => {
  // ⚠️ Round 33: the record wins over the file, so the in-product edit of
  // `You are **X**` -- the one rename path a person had -- was a silent
  // no-op that still said "Saved." A PARSEABLE new name is a deliberate
  // act and the record follows it; an unparseable line updates nothing,
  // which is the accident the record exists to survive.
  const status = require('./engine/status');
  const store = require('./engine/store');
  status.setPaneSource(() => fleet.line({ session: 'angel-discord', title: 'working' }));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    store.writeProfile('angel', { displayName: 'Angel' });
    const cur = await req('/api/agent/angel/instructions');
    const version = JSON.parse(cur.body).version;
    const renamed = await req('/api/agent/angel/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'You are **Seraphina**, a tester.\n', version }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(store.readProfile('angel').displayName, 'Seraphina',
      'a deliberate rename through the identity line did not reach the record');
    // The accident control: a save whose line no longer parses leaves the
    // name alone rather than blanking it.
    const v2 = JSON.parse((await req('/api/agent/angel/instructions')).body).version;
    const mangled = await req('/api/agent/angel/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'no identity line at all\n', version: v2 }),
    });
    assert.equal(mangled.status, 200);
    assert.equal(store.readProfile('angel').displayName, 'Seraphina',
      'an unparseable line must not un-name the agent');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('an unrelated instructions save does not revert a profile-route rename', async () => {
  // ⚠️ Round 37: the rename-follow used to key on "the line PARSES to a name
  // that differs from the record", which is also true when the person renamed
  // through the PROFILE route and then saved a paragraph edit -- the untouched
  // identity line still reads the old name, and following it silently undid
  // the rename. The follow now keys on the LINE ITSELF changing.
  const status = require('./engine/status');
  const store = require('./engine/store');
  status.setPaneSource(() => fleet.line({ session: 'angel-discord', title: 'working' }));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    // The file says Seraphina; the person then renames to Sera via the
    // profile route.
    const v0 = JSON.parse((await req('/api/agent/angel/instructions')).body).version;
    await req('/api/agent/angel/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'You are **Seraphina**, a tester.\nParagraph.\n', version: v0 }),
    });
    await req('/api/agent/angel/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Sera' }),
    });
    assert.equal(store.readProfile('angel').displayName, 'Sera', 'control: the profile rename landed');
    // An edit that leaves the identity line ALONE must leave the name alone.
    const v1 = JSON.parse((await req('/api/agent/angel/instructions')).body).version;
    const unrelated = await req('/api/agent/angel/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'You are **Seraphina**, a tester.\nA DIFFERENT paragraph.\n', version: v1 }),
    });
    assert.equal(unrelated.status, 200);
    assert.equal(store.readProfile('angel').displayName, 'Sera',
      'a paragraph edit reverted a rename made through the profile route');
    // The control that keeps the follow alive: editing the LINE still renames.
    const v2 = JSON.parse((await req('/api/agent/angel/instructions')).body).version;
    await req('/api/agent/angel/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'You are **Serafina**, a tester.\nA DIFFERENT paragraph.\n', version: v2 }),
    });
    assert.equal(store.readProfile('angel').displayName, 'Serafina',
      'control: a deliberate line edit must still reach the record');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('a profile store that cannot be written does not un-save the instructions', async () => {
  // ⚠️ Round 40 blocker: the rename-follow's writeProfile ran unguarded
  // AFTER instructions.write had committed, so a store failure fell to the
  // route's .catch -- a landed save answered 400 with a raw errno and an
  // internal temp path in the message. The store is broken FOR REAL here
  // (profiles dir read-only, so readProfile succeeds and writeProfile
  // throws), and the save must still answer 200 with no errno anywhere.
  const status = require('./engine/status');
  const store = require('./engine/store');
  status.setPaneSource(() => fleet.line({ session: 'angel-discord', title: 'working' }));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    store.writeProfile('angel', { displayName: 'Guarded' });
    const v = JSON.parse((await req('/api/agent/angel/instructions')).body).version;
    fs.chmodSync(store.PROFILES, 0o555);
    try {
      const put = await req('/api/agent/angel/instructions', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'You are **Renamed-under-failure**, a tester.\n', version: v }),
      });
      assert.equal(put.status, 200,
        'a committed save was reported as failed because the follow could not be recorded');
      assert.ok(!/EACCES|EROFS|errno|\.tmp/.test(put.body),
        'an errno or internal path reached the response: ' + put.body.slice(0, 200));
    } finally {
      fs.chmodSync(store.PROFILES, 0o755);
    }
    // Control: with the store healthy again, the follow still works.
    const v2 = JSON.parse((await req('/api/agent/angel/instructions')).body).version;
    await req('/api/agent/angel/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'You are **Healthy**, a tester.\n', version: v2 }),
    });
    assert.equal(store.readProfile('angel').displayName, 'Healthy',
      'control: the follow must still work when the store is writable');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('the 80-character cap holds on BOTH display-name writers, and no record is conjured', async () => {
  // ⚠️ Round 37: the cap at each writer records a measured defect (an
  // identity line can carry ~3,900 characters into the capture) and neither
  // site was held by a test -- removing either `.slice(0, 80)` was green.
  const status = require('./engine/status');
  const store = require('./engine/store');
  const long = 'N'.repeat(200);
  status.setPaneSource(() => fleet.line({ session: 'angel-discord', title: 'working' })
    + '\n' + fleet.line({ session: 'newbie-discord', title: 'working' }));
  status.setPaneCapture(() => 'Worked for 1m\n> \n');
  try {
    // Writer 1: the profile route.
    await req('/api/agent/angel/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: long }),
    });
    assert.equal(store.readProfile('angel').displayName, 'N'.repeat(80),
      'the profile route stored an uncapped name');
    // Writer 2: the rename-follow on the instructions route.
    const v = JSON.parse((await req('/api/agent/angel/instructions')).body).version;
    await req('/api/agent/angel/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'You are **' + long + 'X**, a tester.\n', version: v }),
    });
    assert.equal(store.readProfile('angel').displayName, 'N'.repeat(80),
      'the rename-follow stored an uncapped name');
    // ⚠️ The precondition is behaviour, not decoration: an agent with no
    // displayName on record keeps having none after an identity-line save.
    // The record-wins rule exists for agents Kosmos CREATED; for the
    // pre-existing fleet the file line IS the name, and a follow that
    // conjured a record would freeze every legacy agent's name at whatever
    // the line said the day someone saved an edit.
    fs.mkdirSync(nodePath.join(WORKERS, 'newbie'), { recursive: true });
    const nv = JSON.parse((await req('/api/agent/newbie/instructions')).body).version;
    const put = await req('/api/agent/newbie/instructions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'You are **Newbie**, a tester.\n', version: nv }),
    });
    assert.equal(put.status, 200);
    const rec = store.readProfile('newbie');
    assert.ok(!rec || typeof rec.displayName === 'undefined',
      'an identity-line save conjured a display-name record for a legacy agent');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('the person record: absent, refused, saved-and-told, prefill round trip', async () => {
  // Absent is the wizard's normal starting state: a 200 with the state, never
  // a 404 the screen has to special-case.
  const empty = JSON.parse((await req('/api/you')).body);
  assert.equal(empty.state, 'absent');

  // Refusals speak the field's own sentence at 400 and save nothing.
  const bad = await req('/api/you', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '  ', does: 'x' }),
  });
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(bad.body).error, /call you/);
  assert.equal(JSON.parse((await req('/api/you')).body).state, 'absent', 'a refusal wrote a record');

  // A good save answers the record AND the tell verdicts (never invented:
  // an array, whatever this machine's roster held at the time).
  const put = await req('/api/you', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Josh', does: 'Runs a company', know: 'No em dashes.' }),
  });
  assert.equal(put.status, 200);
  const saved = JSON.parse(put.body);
  assert.equal(saved.you.name, 'Josh');
  assert.ok(Array.isArray(saved.told), 'the tell verdicts are carried, not implied');

  const back = JSON.parse((await req('/api/you')).body);
  assert.equal(back.state, 'saved');
  assert.equal(back.you.know, 'No em dashes.');
});

test('the About-you gate exists in production code (static pins)', () => {
  // The gate IS the design (Josh removed the skip button; Continue waits on
  // the two required answers) and the save lands BEFORE the step advances.
  // Only the Playwright drive exercises this live, and the drive is not in
  // `node --test` -- so without these pins the gate, the pane, or the
  // save-before-advance could be deleted and this suite would stay green.
  // Same culture as the return-step pins: hold the TRIGGERS in source.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(raw, /<div class="fr-pane" id="fr-pane-4" hidden>/,
    'the About-you pane left the static markup');
  const fn = raw.slice(raw.indexOf('async function frPaintYou'));
  assert.ok(fn.length > 100, 'frPaintYou vanished');
  assert.match(fn.slice(0, 4000), /nameEl\.value\.trim\(\) !== '' && doEl\.value\.trim\(\) !== ''/,
    'the two-answer gate is gone: Continue no longer waits');
  const put = fn.indexOf("fetch('/api/you'");
  const advance = fn.indexOf('frGo(FR_STEP_YOU + 1)');
  assert.ok(put > -1 && advance > -1 && put < advance,
    'the save no longer happens before the advance (or either vanished)');
  assert.match(fn.slice(0, 4000), /aria-required="true"/,
    'the required fields lost their programmatic marking');
});

test('the reveal-app route opens Finder through the engine and honours nothing from the request', async () => {
  const machine = require('./engine/machine');
  // A real bundle under the SANDBOXED home's Applications, so the found
  // branch is deterministic on any machine; the injected runner proves the
  // route cannot open anything itself.
  const appsDir = nodePath.join(os.homedir(), 'Applications');
  fs.mkdirSync(nodePath.join(appsDir, 'Kosmos.app'), { recursive: true });
  let ran = null;
  machine.setAppRevealRunner((cmd, a) => { ran = [cmd, a]; });
  try {
    const res = await req('/api/reveal-app', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    assert.ok(ran && ran[0] === '/usr/bin/open' && ran[1][0] === '-R', 'the engine did not drive the reveal');
    assert.match(ran[1][1], /Kosmos\.app$/, 'the revealed path is not the engine-derived bundle');
  } finally {
    machine.setAppRevealRunner(null);
    fs.rmSync(nodePath.join(appsDir, 'Kosmos.app'), { recursive: true, force: true });
  }
});

test('the tab icons are served as images, and a wrong icon path cannot fall through to the page', async () => {
  // The page fallthrough serves HTML for every unmatched path, so without
  // the explicit route an icon URL would answer HTML at 200 -- a browser
  // shows a broken tab icon while the server reports success. The four
  // shipped sizes answer as PNGs; anything else under /icons/ is a JSON
  // 404, never the page dressed as an image.
  for (const size of [16, 32, 48, 180]) {
    const res = await req(`/icons/kosmos-${size}.png`);
    assert.equal(res.status, 200, `kosmos-${size}.png`);
    assert.equal(res.type, 'image/png');
    assert.ok(res.body.length > 200, 'a real image, not an empty file');
    assert.ok(!/^<!doctype/i.test(String(res.body).slice(0, 20)), 'the page leaked through as an icon');
  }
  const miss = await req('/icons/kosmos-64.png');
  assert.equal(miss.status, 404);
  assert.match(JSON.parse(miss.body).error, /no such icon/);
  const stray = await req('/icons/anything-else.txt');
  assert.equal(stray.status, 404);
  const cased = await req('/Icons/kosmos-32.png');
  assert.equal(cased.status, 404, 'the cased spelling leaked through to the page');
  // The encoded spelling must not reach the page (the /api/ guard's own
  // documented lesson, applied to this sibling).
  const encoded = await req('/icons%2fanything');
  assert.equal(encoded.status, 404, 'the encoded spelling leaked through to the page');
  // The doubled-slash spelling is refused upstream by pathOf (400,
  // protocol-relative shape); the invariant that matters is that no
  // spelling gets the PAGE dressed as an icon.
  const doubled = await req('//icons/anything');
  assert.ok(doubled.status === 400 || doubled.status === 404, `unexpected ${doubled.status}`);
  assert.match(doubled.type, /application\/json/, 'the doubled-slash spelling got the page');
  // HEAD answers like GET, headers only.
  const head = await req('/icons/kosmos-32.png', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.type, 'image/png');
  // /favicon.ico 404s by design (matching the site); never the page at 200.
  const ico = await req('/favicon.ico');
  assert.equal(ico.status, 404, 'favicon.ico got the page dressed as an icon');
  // And the head really declares them: all four links plus the apple one,
  // no favicon.ico anywhere (the site 404s it by design; we match).
  const page = await req('/');
  for (const size of [16, 32, 48]) {
    assert.ok(page.body.includes(`/icons/kosmos-${size}.png`), `link for ${size}`);
  }
  assert.ok(page.body.includes('apple-touch-icon'), 'the 180 link');
  // The head COMMENT names favicon.ico to document its deliberate absence,
  // so the pin matches an actual link href, not the string.
  assert.ok(!/href="[^"]*favicon\.ico/.test(page.body), 'no .ico link: the explicit-PNG shape');
});

test('the reveal-app route keeps refusals and programming errors apart', async () => {
  // The mapping under test lives in the ROUTE, so the engine is patched
  // directly (same module instance the server holds): an honest refusal is
  // a 409 wearing the engine's own sentence, a programming error is a 500
  // in the sibling routes' shape -- never a refusal in the dock.
  const machine = require('./engine/machine');
  const real = machine.revealApp;
  try {
    machine.revealApp = () => { throw new Error('we could not look just now, so we cannot say where the icon is'); };
    const refused = await req('/api/reveal-app', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(refused.status, 409);
    assert.match(JSON.parse(refused.body).error, /could not look just now/);

    machine.revealApp = () => { throw new TypeError('x is not a function'); };
    const bug = await req('/api/reveal-app', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(bug.status, 500, 'a programming error answered as an honest refusal');
    const body = JSON.parse(bug.body);
    assert.match(body.error, /our side/, 'the 500 sentence leaked internals or vanished');
    assert.ok(!/not a function/.test(body.error), 'the raw internal sentence reached the refusal slot');
  } finally {
    machine.revealApp = real;
  }
});

test('the msg route derives the sender from the pane, ignores any typed claim, and the record answers on /api/messages', async () => {
  /* The route's one job beyond the engine: sender identity NEVER comes
     from the body. A body that claims from:'mara' still logs as leo,
     because the pane is the fact and the claim is just typing. */
  const messagesEngine = require('./engine/messages');
  const chatEngine = require('./engine/chat');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  try {
    messagesEngine.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const sends = [];
    chatEngine.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chatEngine.setDryRun(false);

    const r = await req('/api/msg', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'mara', text: 'route test', from: 'mara', from_pane: '%3' }),
    });
    assert.equal(r.status, 200);
    const verdict = JSON.parse(r.body).delivery;
    assert.equal(verdict.state, 'placed', 'the route did not deliver: ' + (verdict.because || ''));
    const typed = sends.filter((a) => a[0] === 'send-keys');
    assert.match(typed[0][5], /^\[message from your colleague leo · m\d+\] route test$/,
      'the envelope does not carry the derived sender');

    const rec = await req('/api/messages?agent=mara');
    assert.equal(rec.status, 200);
    const listed = JSON.parse(rec.body).messages.filter((m) => m.kind === 'message');
    const last = listed[listed.length - 1];
    assert.equal(last.text, 'route test');
    assert.equal(last.from, 'leo', "a typed from: claim outranked the pane-derived identity");
    assert.equal(last.to, 'mara');
  } finally {
    messagesEngine.resetForTests();
    chatEngine.resetForTests();
    board.restore();
  }
});

test('the post route resolves the project, derives the member list, and fans out with the marking', async () => {
  /* The route's own derivations, none of them the engine's: project
     resolution (with the no-project sentence), the member list read off
     the project record, and judgment handed to the engine whole. */
  const messagesEngine = require('./engine/messages');
  const chatEngine = require('./engine/chat');
  const projectsEngine = require('./engine/projects');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' }),
    fleet.agent('april', { state: 'idle' })]);
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-post-route-'));
  try {
    messagesEngine.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const sends = [];
    chatEngine.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chatEngine.setDryRun(false);

    const missing = await req('/api/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'no-such-room', text: 'hello', from_pane: '%3' }),
    });
    assert.equal(missing.status, 200);
    assert.match(JSON.parse(missing.body).delivery.because, /no project by that name/,
      'an unknown project did not get the route\u2019s own sentence');

    const made = await req('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Route room', folder: dir, agents: ['leo', 'mara', 'april'] }),
    });
    assert.equal(made.status, 200);
    sends.length = 0;

    const r = await req('/api/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'routeroom', text: 'room route test @mara', from_pane: '%3' }),
    });
    assert.equal(r.status, 200);
    const verdict = JSON.parse(r.body).delivery;
    assert.equal(verdict.state, 'placed', 'the route did not deliver: ' + (verdict.because || ''));
    assert.deepEqual(verdict.outcomes, { mara: 'placed', april: 'placed' },
      'the member list was not derived off the project record');
    const typed = sends.filter((a) => a[0] === 'send-keys' && typeof a[5] === 'string' && a[5].startsWith('['));
    assert.equal(typed.length, 2);
    assert.match(typed.map((a) => a[5]).find((t) => t.startsWith('[message')), /project routeroom\]/,
      'the addressed envelope lost its project');
    const rec = messagesEngine.record().rows.filter((m) => m.kind === 'post');
    assert.equal(rec.length, 1);
    assert.equal(rec[0].project, 'routeroom');

    // Ripple 5 at the wire: the post reaches each member's conversation
    // feed AS a post, carrying its project and THAT member's outcome.
    const feed = await req('/api/agent/mara/conversation');
    assert.equal(feed.status, 200);
    const post = JSON.parse(feed.body).rows.find((m) => m.kind === 'post');
    assert.ok(post, 'the room post vanished from the member\u2019s feed');
    assert.equal(post.project, 'routeroom');
    assert.equal(post.state, 'placed');
    assert.equal(post.operator, false);
  } finally {
    messagesEngine.resetForTests();
    chatEngine.resetForTests();
    board.restore();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    void projectsEngine;
  }
});

test('the room routes: the operator flag is minted only here, and the thread filters by project alone', async () => {
  const messagesEngine = require('./engine/messages');
  const chatEngine = require('./engine/chat');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-room-route-'));
  try {
    const sends = [];
    chatEngine.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chatEngine.setDryRun(false);

    const missing = await req('/api/project/no-such-room/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.match(JSON.parse(missing.body).delivery.because, /no project by that name/);

    await req('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ops room', folder: dir, agents: ['leo', 'mara'] }),
    });
    sends.length = 0;

    // The MINT: no pane in the body, and the row carries the flag. A
    // body claiming operator-adjacent fields changes nothing because the
    // route forwards only text.
    const posted = await req('/api/project/opsroom/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '@leo take the runway', operator: false, from_pane: '%9' }),
    });
    const verdict = JSON.parse(posted.body).delivery;
    assert.equal(verdict.state, 'placed', verdict.because || '');
    // Scoped to THIS room: the suite's sandbox record is shared across
    // route tests, and an earlier test's agent post would be found first.
    const row = messagesEngine.record().rows.find((m) => m.kind === 'post' && m.project === 'opsroom');
    assert.ok(row, 'the operator post never reached the record');
    assert.equal(row.operator, true, 'the operator route did not mint the flag');
    assert.equal(row.from, 'you');
    const typed = sends.filter((a) => a[0] === 'send-keys' && typeof a[5] === 'string' && a[5].startsWith('['));
    assert.match(typed.map((a) => a[5]).find((t) => t.includes('· project opsroom')) || '', /from your operator/,
      'an operator arrival did not carry the operator marker');

    // The THREAD, filtered by project alone: a foreign project's post and
    // a room valve row seeded straight into the record.
    fs.appendFileSync(messagesEngine.LOG, JSON.stringify({
      kind: 'post', id: 'm900', project: 'otherroom', from: 'leo', to: ['mara'],
      text: 'foreign', at: new Date().toISOString(), outcomes: { mara: 'placed' },
    }) + '\n');
    fs.appendFileSync(messagesEngine.LOG, JSON.stringify({
      kind: 'valve', from: 'leo', to: 'opsroom', project: 'opsroom',
      because: 'stopped', at: new Date().toISOString(),
    }) + '\n');
    const thread = await req('/api/project/opsroom/room');
    assert.equal(thread.status, 200);
    const bodyT = JSON.parse(thread.body);
    assert.equal(bodyT.ok, true);
    const kinds = bodyT.rows.map((m) => m.kind);
    assert.deepEqual(kinds.sort(), ['post', 'valve'], 'the thread is not the record filtered by project alone: ' + JSON.stringify(kinds));
    assert.ok(!bodyT.rows.some((m) => m.text === 'foreign'), 'another project\u2019s post leaked into this room');
  } finally {
    messagesEngine.resetForTests();
    chatEngine.resetForTests();
    board.restore();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

test('the limits routes round-trip the person\u2019s control, and the valve rows render the Off truth', async () => {
  const limitsEngine = require('./engine/limits');
  try {
    const got = await req('/api/limits');
    assert.equal(got.status, 200);
    const r = JSON.parse(got.body);
    assert.equal(r.on, true);
    assert.equal(r.perHour, 20);
    assert.deepEqual(r.tiers, [10, 20, 40, 100]);

    const bad = await req('/api/limits', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: true, perHour: 33 }),
    });
    assert.equal(bad.status, 400);
    assert.match(JSON.parse(bad.body).error, /listed amounts/);

    const put = await req('/api/limits', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: false, perHour: 40 }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual(JSON.parse(put.body).on, false);
    assert.equal(JSON.parse((await req('/api/limits')).body).perHour, 40);
  } finally {
    fs.rmSync(limitsEngine.FILE, { force: true });
  }

  // The rows: a told-only valve names the reason on both arms (did not
  // step in, because the limit is turned off), and rows that PREDATE the
  // field render as the stops they were.
  const escSrc = (() => {
    const raw2 = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
    const sc = raw2.match(/<script>([\s\S]*?)<\/script>/)[1];
    const at = sc.indexOf('function esc(');
    return sc.slice(at, sc.indexOf('\n}', at) + 2);
  })();
  const convoRow = pageFunction('convoRow', escSrc);
  const toldPair = convoRow({ kind: 'valve', from: 'leo', to: 'mara', stopped: false, at: 'x' }, 'mara');
  assert.match(toldPair, /did not step in, because you have the limit turned off/);
  assert.doesNotMatch(toldPair, /stopped them/, 'a told-only pair row claims Kosmos stopped them');
  const toldRoom = convoRow({ kind: 'valve', from: 'leo', to: 'p1', project: 'p1', stopped: false, at: 'x' }, 'mara');
  assert.match(toldRoom, /did not step in, because you have the limit turned off/);
  const legacyPair = convoRow({ kind: 'valve', from: 'leo', to: 'mara', at: 'x' }, 'mara');
  assert.match(legacyPair, /stopped them and asked leo/, 'a pre-field row lost its refusal history');
  // The ROUTE's own pre-field default, not only the renderer's: a
  // stopped-less row in the record must reach the feed as the stop it
  // was. The renderer and the mapping happen to default the same
  // direction, and only asserting one lets the other regress silently.
  const messagesEngine2 = require('./engine/messages');
  fs.mkdirSync(nodePath.dirname(messagesEngine2.LOG), { recursive: true });
  fs.appendFileSync(messagesEngine2.LOG, JSON.stringify({
    kind: 'valve', from: 'routeleo', to: 'routemara', because: 'old stop', at: new Date().toISOString(),
  }) + '\n');
  const feed = await req('/api/agent/routemara/conversation');
  const row = JSON.parse(feed.body).rows.find((m) => m.kind === 'valve' && m.from === 'routeleo');
  assert.ok(row, 'the legacy valve row vanished from the feed');
  assert.equal(row.stopped, true, 'the route mapped a pre-field refusal as told-only (history rewritten)');
  const stoppedRoom = convoRow({ kind: 'valve', from: 'leo', to: 'p1', project: 'p1', stopped: true, at: 'x' }, 'mara');
  assert.match(stoppedRoom, /stopped it and asked everyone/);
});

test('the limit card shows each caution only when it matters (her always-on-screen rule, driven)', () => {
  /* paintLimitsFrom drives real element state; a DOM stub records it, so
     the claim is about the WRITES, not the arithmetic. */
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, hidden: undefined, value: '', innerHTML: '', attrs: {}, classes: new Set(),
    classList: { toggle(c, v) { if (v) { this._s.add(c); } else { this._s.delete(c); } }, _s: null },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  });
  for (const id of ['lim-toggle', 'lim-tier', 'lim-tier-row', 'lim-off-note', 'lim-high-note']) {
    const e = el(id); e.classList._s = e.classes;
  }
  const raw2 = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const sc = raw2.match(/<script>([\s\S]*?)<\/script>/)[1];
  const at = sc.indexOf('function paintLimitsFrom');
  let depth = 0; let end = -1;
  for (let k = sc.indexOf('{', at); k < sc.length; k += 1) {
    if (sc[k] === '{') depth += 1;
    else if (sc[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  // eslint-disable-next-line no-new-func
  const painter = new Function('document', sc.slice(at, end) + '\nreturn paintLimitsFrom;')({ getElementById: el });

  painter({ on: true, perHour: 20, tiers: [10, 20, 40, 100] });
  assert.equal(el('lim-tier-row').hidden, false);
  assert.equal(el('lim-off-note').hidden, true, 'the Off sentence is on screen while On');
  assert.equal(el('lim-high-note').hidden, true, 'the cost line is on screen at a middle tier');
  painter({ on: true, perHour: 100, tiers: [10, 20, 40, 100] });
  assert.equal(el('lim-high-note').hidden, false, 'the top tier does not carry its cost line');
  painter({ on: false, perHour: 100, tiers: [10, 20, 40, 100] });
  assert.equal(el('lim-off-note').hidden, false, 'Off does not say what Off means');
  assert.equal(el('lim-tier-row').hidden, true, 'the tier dropdown is offered while Off');
  assert.equal(el('lim-high-note').hidden, true);
  assert.equal(el('lim-toggle').attrs['aria-checked'], 'false');

  // The HANDLERS, against the same stub: a click before the first paint
  // (empty tier list) must never save -- Number('') would rewrite a
  // stored 40 or 100 to a fallback -- and the tier handler reads the
  // toggle's state rather than hardcoding On.
  const saves = [];
  const handlerSrc = (name) => {
    const at2 = sc.indexOf('function ' + name);
    let d = 0; let e = -1;
    for (let k = sc.indexOf('{', at2); k < sc.length; k += 1) {
      if (sc[k] === '{') d += 1;
      else if (sc[k] === '}') { d -= 1; if (d === 0) { e = k + 1; break; } }
    }
    return sc.slice(at2, e);
  };
  // eslint-disable-next-line no-new-func
  const handlers = new Function('document', 'saveLimits', 'paintLimits',
    handlerSrc('limToggleClick') + '\n' + handlerSrc('limTierChange')
    + '\nreturn { limToggleClick, limTierChange };')(
    { getElementById: el }, (next) => saves.push(next), () => saves.push('repaint'));

  el('lim-tier').options = [];
  handlers.limToggleClick();
  assert.deepEqual(saves, ['repaint'], 'a pre-paint click saved (or did nothing at all)');
  saves.length = 0;
  el('lim-tier').options = [1, 2, 3, 4];
  el('lim-tier').value = '40';
  el('lim-toggle').attrs['aria-checked'] = 'false';
  handlers.limToggleClick();
  assert.deepEqual(saves, [{ on: true, perHour: 40 }], 'the toggle did not negate aria-checked at the stored tier');
  saves.length = 0;
  handlers.limTierChange();
  assert.deepEqual(saves, [{ on: false, perHour: 40 }],
    'the tier handler hardcoded On instead of reading the toggle');
});

test('engineering mode round-trips, and the agent window route sits behind the knownAgent gate', async () => {
  const engmodeEngine = require('./engine/engmode');
  const chatEngine = require('./engine/chat');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  try {
    const got = JSON.parse((await req('/api/engmode')).body);
    assert.equal(got.on, false, 'engineering mode does not default Off');

    // The Off serving, pinned BEFORE the mode is turned on below: a
    // known agent's window answers the truth in words and never the
    // capture -- the stale-client path, deletable-green without this.
    const offWin = await req('/api/agent/leo/window');
    assert.equal(offWin.status, 200);
    assert.equal(JSON.parse(offWin.body).text, null);
    assert.match(JSON.parse(offWin.body).because, /engineering mode is off/);

    const bad = await req('/api/engmode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: 'yes' }),
    });
    assert.equal(bad.status, 400);
    const put = await req('/api/engmode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: true }),
    });
    assert.equal(JSON.parse(put.body).on, true);

    // The window: an unknown name 404s (no which-panes-exist oracle),
    // a real one carries the engine's own answer through.
    const ghost = await req('/api/agent/ghost/window');
    assert.equal(ghost.status, 404);
    // The malformed leg, per the sibling routes' convention (a stray %
    // once took the process down): decodeSegment null answers 404, never
    // a throw.
    const malformed = await req('/api/agent/%/window');
    assert.equal(malformed.status, 404);
    chatEngine.setRunner((args) => {
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: 'the raw pane text\n\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    const win = await req('/api/agent/leo/window');
    assert.equal(win.status, 200);
    assert.equal(JSON.parse(win.body).text, 'the raw pane text', 'the viewport did not pass through (or kept its padding)');
  } finally {
    chatEngine.resetForTests();
    board.restore();
    fs.rmSync(engmodeEngine.FILE, { force: true });
  }
});

test('a room post renders as a room post everywhere: the agent page names the project, the room draws the receipt', () => {
  /* View D ripple 5 on the agent page, and the receipt grammar on the
     room itself, extracted from the page so a rename cannot leave these
     asserting a copy. */
  const escSrc = (() => {
    const raw2 = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
    const sc = raw2.match(/<script>([\s\S]*?)<\/script>/)[1];
    const at = sc.indexOf('function esc(');
    return sc.slice(at, sc.indexOf('\n}', at) + 2);
  })();
  const convoRow = pageFunction('convoRow', escSrc);

  const agentPost = convoRow({ kind: 'post', from: 'mara', to: ['leo', 'april'], project: 'hendersonlease',
    operator: false, text: 'the draft is up', at: new Date().toISOString(), state: 'placed' }, 'leo');
  assert.match(agentPost, /mara · to everyone on hendersonlease/,
    'a remark to a group reads as a message to one (ripple 5)');
  assert.match(agentPost, /class="cvrow peer"/);

  const opPost = convoRow({ kind: 'post', from: 'you', to: ['leo'], project: 'hendersonlease',
    operator: true, text: 'status?', at: new Date().toISOString(), state: 'could_not' }, 'leo');
  assert.match(opPost, /You · to everyone on hendersonlease/);
  assert.match(opPost, /class="cvrow you"/, 'the person\u2019s room post did not get their own treatment');
  assert.match(opPost, /Not delivered to leo/, 'a failed delivery to this agent rendered as silence');

  // An agent literally named "you" must NOT be promoted to the person:
  // the flag is the distinction, never the name.
  const trickPost = convoRow({ kind: 'post', from: 'you', to: ['leo'], project: 'p',
    operator: false, text: 'hi', at: new Date().toISOString(), state: 'placed' }, 'leo');
  assert.match(trickPost, /class="cvrow peer"/,
    'an agent named "you" was promoted to operator by a name match');

  const roomValve = convoRow({ kind: 'valve', from: 'leo', to: 'hendersonlease', project: 'hendersonlease',
    at: new Date().toISOString() }, 'leo');
  assert.match(roomValve, /conversation on hendersonlease/,
    'the room valve rendered with the pair sentence');
  assert.match(roomValve, /asked everyone to bring you in/);
  // The control: the PAIR valve keeps its named-sender sentence.
  const pairValve = convoRow({ kind: 'valve', from: 'leo', to: 'mara', at: new Date().toISOString() }, 'mara');
  assert.match(pairValve, /asked leo to bring you in/);

  // The receipt grammar, one clause per real state.
  const pjJoinNames = pageFunction('pjJoinNames');
  const receipt = pageFunction('pjReceiptSentence',
    'const pjNameOf = (p, n) => n;\nconst pjJoinNames = ' + pjJoinNames.toString() + ';');
  assert.equal(receipt({ leo: 'placed', mara: 'placed' }, {}), 'Placed with leo and mara.');
  assert.equal(receipt({ leo: 'placed', mara: 'unconfirmed', april: 'could_not' }, {}),
    'Placed with leo. mara may have it; not confirmed, so it is not re-sent. april could not be reached.');
  // An unknown state lands in the NOT-CONFIRMED clause, never vanishes
  // and never claims a definite failure: "could not be reached" licenses
  // a free re-send an unknown state does not, and the pill weighs the
  // same post as unsure -- one send must not carry two verdicts.
  assert.match(receipt({ leo: 'something-new' }, {}), /leo may have it; not confirmed/);
});

test('the conversation rows hold the spec grammar: attributed peers, verbatim refusals, the valve as reassurance', () => {
  /* Mona Lisa's messaging-screens spec, driven: a colleague's row reads
     differently from yours, no delivery state renders as silence, the
     because sentence ships verbatim, replies indent one level, and the
     valve row is the product doing its job rather than an error. */
  const convoRow = pageFunction('convoRow',
    (() => {
      const raw2 = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
      const sc = raw2.match(/<script>([\s\S]*?)<\/script>/)[1];
      const at = sc.indexOf('function esc(');
      return sc.slice(at, sc.indexOf('\n}', at) + 2);
    })());

  const you = convoRow({ kind: 'operator', text: 'have a look at the lease', project: 'Vendor Review', state: 'placed' }, 'leo');
  assert.match(you, /class="cvrow you"/, 'the operator row lost its own treatment');
  assert.match(you, /You · on Vendor Review/);
  assert.doesNotMatch(you, /cv-state/, 'a placed message grew a state line it does not need');

  const peer = convoRow({ kind: 'colleague', from: 'mara', to: 'leo', text: 'the numbers are in', state: 'placed', in_reply_to: null }, 'leo');
  assert.match(peer, /class="cvrow peer"/, 'a colleague reads like the operator, the distinction the spec exists for');
  assert.match(peer, /mara · to leo/);

  const reply = convoRow({ kind: 'colleague', from: 'leo', to: 'mara', text: 'thanks', state: 'placed', in_reply_to: 'm1' }, 'leo');
  assert.match(reply, /peer indent/, 'a reply does not indent under what it answers');

  const maybe = convoRow({ kind: 'colleague', from: 'leo', to: 'mara', text: 'ping', state: 'unconfirmed', in_reply_to: null }, 'leo');
  assert.match(maybe, /Sent to mara\. We could not confirm it arrived\./, 'unconfirmed rendered as silence or as failure');

  const no = convoRow({ kind: 'operator', text: 'x', project: 'P', state: 'could_not', because: 'the pane was in copy-mode' }, 'leo');
  assert.match(no, /<b>Not sent\.<\/b> the pane was in copy-mode/, "the engine's own sentence did not ship verbatim");

  const valve = convoRow({ kind: 'valve', from: 'leo', to: 'mara' }, 'leo');
  assert.match(valve, /leo and mara were going back and forth, so Kosmos stopped them and asked leo to bring you in\./,
    'the valve row lost the sentence that makes it reassurance rather than error');
  assert.doesNotMatch(valve, /err|Not sent/, 'the valve row dressed as an error');

  const hostile = convoRow({ kind: 'colleague', from: 'mara', to: 'leo', text: '<img src=x onerror=1>', state: 'placed', in_reply_to: null }, 'leo');
  assert.doesNotMatch(hostile, /<img src=x/, 'a message body reached the conversation as a live tag');
  assert.match(hostile, /&lt;img/, 'CONTROL: the escaped body is absent, so the tag assertion proves nothing');
});

test('the conversation route merges the project threads and the a2a record into one honest, ordered tail', async () => {
  const messagesEngine = require('./engine/messages');
  const chatEngine = require('./engine/chat');
  const projectsEngine = require('./engine/projects');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const pdir = nodePath.join(SANDBOX, 'convo-proj');
  fs.mkdirSync(pdir, { recursive: true });
  try {
    // A real project with leo on it, one operator message in its thread.
    projectsEngine.create({ name: 'Convo Proof', folder: pdir, agents: ['leo'], roster: board.agents });
    const proj = projectsEngine.list(board.agents).find((x) => x.name === 'Convo Proof');
    assert.ok(proj, 'the fixture project was not created');
    chatEngine.appendMessage(proj.id, 'leo',
      { text: 'from your operator', at: '2026-08-18T13:00:01Z', delivery: { state: 'placed', because: null, at: '2026-08-18T13:00:01Z' } },
      proj.createdAt);
    // The a2a record: a colleague message BEFORE it and a valve entry after.
    fs.mkdirSync(nodePath.dirname(messagesEngine.LOG), { recursive: true });
    fs.appendFileSync(messagesEngine.LOG, JSON.stringify({ kind: 'message', id: 'm900', from: 'mara', to: 'leo', text: 'from a colleague', in_reply_to: null, at: '2026-08-18T13:00:00Z', state: 'placed' }) + '\n');
    fs.appendFileSync(messagesEngine.LOG, JSON.stringify({ kind: 'valve', from: 'leo', to: 'mara', at: '2026-08-18T13:00:02Z', because: 'x' }) + '\n');

    const r = await req('/api/agent/leo/conversation');
    assert.equal(r.status, 200);
    const data = JSON.parse(r.body);
    const kinds = data.rows.map((x) => x.kind + ':' + (x.at || ''));
    const colleagueAt = kinds.findIndex((k) => k.startsWith('colleague'));
    const operatorAt = kinds.findIndex((k) => k.startsWith('operator'));
    const valveAt = kinds.findIndex((k) => k.startsWith('valve'));
    assert.ok(colleagueAt > -1 && operatorAt > -1 && valveAt > -1,
      'a source is missing from the merge: ' + kinds.join(' '));
    assert.ok(colleagueAt < operatorAt && operatorAt < valveAt,
      'the merge is not in time order: ' + kinds.join(' '));
    const op = data.rows[operatorAt];
    assert.equal(op.project, 'Convo Proof', 'the operator row lost which project it was said on');
    assert.ok(data.total >= 3, 'the total does not carry what the tail may have dropped');
  } finally {
    try { fs.rmSync(messagesEngine.LOG, { force: true }); } catch { /* clean */ }
    board.restore();
  }
});

test('the gap sentence never speaks about a file nobody could read', () => {
  /* The §5 gate, driven on the route's own answer shapes: an
     unreadable-but-existing file (200, exists:false, editable:false)
     must keep the sentence HIDDEN -- asserting what an agent does not
     know off a file we could not look at is the claim the whole screen
     refuses -- while a genuinely absent boot file (exists:false,
     editable:true) truly lacks the block and shows it. */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const drive = (data) => {
    const el = { hidden: 'untouched' };
    const from = script.indexOf("const gapEl = document.getElementById('d-convo-gap');");
    const write = script.indexOf(': !data.editable;');
    const end = script.indexOf('\n', script.indexOf('}', write)) + 1;
    assert.ok(from > -1 && write > from && write < end, 'the gap gate fell outside the extracted slice');
    // eslint-disable-next-line no-new-func
    new Function('document', 'data', script.slice(from, end))({ getElementById: () => el }, data);
    return el.hidden;
  };
  assert.equal(drive({ exists: true, editable: true, text: 'x <!-- kosmos:colleagues:start --> y' }), true,
    'an agent that HOLDS the block is told it cannot message');
  assert.equal(drive({ exists: true, editable: true, text: 'their own words, no block' }), false,
    'an agent without the block gets no sentence, the gap invisible again');
  assert.equal(drive({ exists: false, editable: false, text: '' }), true,
    'the sentence spoke about a file nobody could read');
  assert.equal(drive({ exists: false, editable: true, text: '' }), false,
    'a genuinely absent boot file truly lacks the block and must say so');
});

test('the conversation tail cap is said, and an unreadable record rides ahead of it, never dropped', async () => {
  const messagesEngine = require('./engine/messages');
  // ⚠️ An agent name NOTHING ELSE in this suite uses: the sandbox's project
  // threads persist across tests, and a shared name (leo) merged another
  // test's operator rows into this one's carefully counted tail.
  const board = fleet.install([fleet.agent('convocap', { state: 'idle' })]);
  try {
    // (a) past the cap: the tail serves, the total says what was dropped.
    fs.mkdirSync(nodePath.dirname(messagesEngine.LOG), { recursive: true });
    fs.rmSync(messagesEngine.LOG, { force: true });
    const many = [];
    for (let i = 0; i < 205; i += 1) {
      many.push(JSON.stringify({ kind: 'message', id: 'm' + (i + 1), from: 'mara', to: 'convocap', text: 'row ' + i, in_reply_to: null, at: new Date(1755500000000 + i * 1000).toISOString(), state: 'placed' }));
    }
    fs.writeFileSync(messagesEngine.LOG, many.join('\n') + '\n');
    const capped = JSON.parse((await req('/api/agent/convocap/conversation')).body);
    assert.equal(capped.rows.length, 200, 'the tail cap moved');
    assert.equal(capped.total, 205, 'the total stopped saying what the tail dropped');
    assert.equal(capped.rows[199].text, 'row 204', 'the tail is not the LATEST rows');

    // (b) the record unreadable (a directory where the log should be):
    // could-not-look is a ROW, first in the served slice, never silence.
    fs.rmSync(messagesEngine.LOG, { force: true });
    fs.mkdirSync(messagesEngine.LOG);
    const blind = JSON.parse((await req('/api/agent/convocap/conversation')).body);
    assert.ok(blind.rows.length >= 1 && blind.rows[0].kind === 'unreadable',
      'an unreadable message record rendered as an agent no colleague ever wrote to');
    assert.match(blind.rows[0].what, /messages/, 'the could-not-look row does not say what it could not read');
  } finally {
    try { fs.rmSync(messagesEngine.LOG, { recursive: true, force: true }); } catch { /* clean */ }
    board.restore();
  }
});

test('an attributed refusal is an event: logged once per window with its because, drawn with her copy, and the anonymous knock still is not', () => {
  const messagesEngine = require('./engine/messages');
  const chatEngine = require('./engine/chat');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  try {
    fs.rmSync(messagesEngine.LOG, { recursive: true, force: true });
    messagesEngine.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    chatEngine.setRunner(() => ({ ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }));
    chatEngine.setDryRun(false);
    // A self-send: post-resolution, attributed, refused.
    messagesEngine.send({ fromPane: '%7', to: 'leo', text: 'note to self' }, board.agents);
    let refused = messagesEngine.record().rows.filter((m) => m.kind === 'refused');
    assert.equal(refused.length, 1, 'an attributed refusal did not become an event');
    assert.match(refused[0].because, /your own name/, 'the event lost its verbatim because');
    // The retries are chrome: the same refusal inside the window logs once.
    messagesEngine.send({ fromPane: '%7', to: 'leo', text: 'note to self again' }, board.agents);
    refused = messagesEngine.record().rows.filter((m) => m.kind === 'refused');
    assert.equal(refused.length, 1, 'a retry-looping agent grew the record');
    // A DIFFERENT because is a different event.
    messagesEngine.send({ fromPane: '%7', to: 'april', text: {} }, board.agents);
    refused = messagesEngine.record().rows.filter((m) => m.kind === 'refused');
    assert.equal(refused.length, 2, 'a distinct refusal was deduped into the first');
    // The one unattributed exit stays out of the record.
    messagesEngine.setRunner(() => ({ ok: true, session: 'nobody-we-know' }));
    messagesEngine.send({ fromPane: '%9', to: 'leo', text: 'knock' }, board.agents);
    assert.equal(messagesEngine.record().rows.filter((m) => m.kind === 'refused').length, 2,
      'an anonymous knock appended to the record');

    // The row draws with her copy, because verbatim.
    const raw2 = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
    const sc = raw2.match(/<script>([\s\S]*?)<\/script>/)[1];
    const escAt = sc.indexOf('function esc(');
    const convoRow = pageFunction('convoRow', sc.slice(escAt, sc.indexOf('\n}', escAt) + 2));
    const drawn = convoRow({ kind: 'refused', from: 'leo', to: 'april', because: 'that agent’s pane is a shell' }, 'leo');
    assert.match(drawn, /leo tried to message april\./, 'the refusal row lost her sentence');
    assert.match(drawn, /<b>Not sent:<\/b> that agent’s pane is a shell/, 'the because did not ship verbatim');
  } finally {
    try { fs.rmSync(messagesEngine.LOG, { force: true }); } catch { /* clean */ }
    messagesEngine.resetForTests();
    chatEngine.resetForTests();
    board.restore();
  }
});

test('the project pill claims only what the counts support', () => {
  /* Pack view C's state pill, driven at its honesty boundaries: "Nothing
     running" is a CLAIM made only when every member was actually seen; a
     blind roster or unseen members get the unsure treatment, never a
     reassurance. */
  const pjPillOf = pageFunction('pjPillOf');
  assert.equal(pjPillOf({ summary: { total: 3, needsYou: 1, working: 1 } }, false).label, 'Needs you');
  assert.equal(pjPillOf({ summary: { total: 3, working: 2 } }, false).label, 'Working');
  assert.equal(pjPillOf({ summary: { total: 2 } }, false).label, 'Nothing running');
  assert.equal(pjPillOf({ summary: { total: 0 } }, false).label, 'No agents yet');
  assert.equal(pjPillOf({ summary: { total: 2, unseen: 1 } }, false).label, 'Can’t tell',
    'an unseen member let the card claim nothing is running');
  assert.equal(pjPillOf({ summary: { total: 2, working: 1 } }, true).label, 'Can’t tell',
    'a blind roster let the card keep claiming Working');
  assert.equal(pjPillOf({ summary: { total: 2, needsYou: 1 } }, true).label, 'Can’t tell',
    'a blind roster let the card keep claiming Needs you, the strongest reassurance it could leak');
});

test('the projects tiles DRAW, not just compute: present at non-zero, hidden at zero and blind', () => {
  /* Splinter's boundary: a count test answers does-the-number-come-out;
     this drives the WRITE, so a tile that computes correctly and never
     draws cannot pass. Slice includes the writes (the summary test's
     lesson). */
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const drive = (projects, unreadable) => {
    const els = { 'st-pj': { textContent: '' }, 'st-pjattn': { textContent: '' }, 'st-pjattn-tile': { hidden: 'untouched' } };
    const from = script.indexOf('const attnProjects = PJ_AGENTS_UNREADABLE');
    const write = script.indexOf("document.getElementById('st-pjattn-tile').hidden = !attnProjects;");
    const end = script.indexOf('\n', write) + 1;
    assert.ok(from > -1 && write > from && write < end, 'the tile writes fell outside the extracted slice');
    // eslint-disable-next-line no-new-func
    new Function('document', 'active', 'PJ_AGENTS_UNREADABLE', script.slice(from, end))(
      { getElementById: (id) => els[id] }, projects, unreadable);
    return els;
  };
  const hot = drive([{ summary: { needsYou: 2 } }, { summary: {} }], false);
  assert.equal(hot['st-pjattn-tile'].hidden, false, 'a project needs you and the tile never drew');
  assert.equal(hot['st-pjattn'].textContent, '1', 'the tile counts members, not projects (or nothing)');
  assert.equal(hot['st-pj'].textContent, '2');
  const calm = drive([{ summary: {} }], false);
  assert.equal(calm['st-pjattn-tile'].hidden, true, 'the alert tile shows a zero');
  const blind = drive([{ summary: { needsYou: 3 } }], true);
  assert.equal(blind['st-pjattn-tile'].hidden, true,
    'a blind roster drew a needs-you claim it cannot make');
});

test('the disc hash spreads: the pack seven-bucket system, order-sensitive, all buckets reachable', () => {
  /* Distribution and structure, NOT distinctness (seven buckets is a
     birthday problem and the pack says so where it defines the
     families): a name corpus must reach every bucket without gross
     clustering, and anagram pairs must be separable -- the property
     char-sum failed structurally. */
  // The palette comes from the PAGE, not a stand-in: a copied bucket
  // count would keep certifying spread at mod 7 after the palette moved.
  const rawPage = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const pageScript = rawPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tintsLine = pageScript.slice(pageScript.indexOf('const DISC_TINTS'), pageScript.indexOf('\n', pageScript.indexOf('const DISC_TINTS')) + 1);
  const inksLine = pageScript.slice(pageScript.indexOf('const DISC_INKS'), pageScript.indexOf('\n', pageScript.indexOf('const DISC_INKS')) + 1);
  assert.ok(tintsLine.includes('[') && inksLine.includes('['), 'the palette lines vanished from the page');
  // The pair lengths must match: discIndex mods by TINTS.length and
  // discInk indexes INKS with it, so an unbalanced edit emits undefined.
  // eslint-disable-next-line no-new-func
  const lens = new Function(tintsLine + inksLine + 'return [DISC_TINTS.length, DISC_INKS.length];')();
  assert.equal(lens[0], lens[1], 'DISC_TINTS and DISC_INKS diverged; discInk would emit undefined');
  const discIndex = pageFunction('discIndex', tintsLine);
  const corpus = ['leo','mara','rook','nils','vex','angel','april','donnie','mikey','casey','raph','splinter','krang','jennika','shredder','tom','ana','ben','cleo','dora','eli','fern','gus','hana','ivan','june','kira','liam','nora','omar','pia','quinn','rosa','sam','tara','uma','vic','wren','xena','yuri','zed'];
  const seen = new Map();
  for (const n of corpus) seen.set(discIndex(n), (seen.get(discIndex(n)) || 0) + 1);
  assert.equal(seen.size, lens[0], 'a 41-name corpus left buckets unreached: hit '
    + seen.size + ' of ' + lens[0]);
  const max = Math.max(...seen.values());
  assert.ok(max <= Math.ceil((corpus.length / lens[0]) * 2), 'gross clustering: one bucket took ' + max + ' of ' + corpus.length);
  /* ⚠️ Order sensitivity as a STATISTICAL property, not a pair list: the
     claim is "anagrams are no more likely to collide than any other
     pair" -- an order-INDEPENDENT hash collides on every single pair
     (char-sum: 40/40 by construction), a good hash collides at roughly
     chance (~1/7). The bound sits far above chance and far below
     catastrophe, so it cannot go red on a correct hash that got
     ordinarily unlucky, and it survives a bucket-count change. A
     fixed-small-list assertion here would be the seven-distinct-tints
     mistake in another costume. */
  const words = corpus.filter((w) => w.length >= 3 && w !== [...w].reverse().join(''));
  const anagramPairs = words.map((w) => [w, [...w].reverse().join('')]);
  const collisions = anagramPairs.filter(([a, b]) => discIndex(a) === discIndex(b)).length;
  assert.ok(anagramPairs.length >= 30, 'the corpus shrank under the anagram test');
  assert.ok(collisions <= Math.ceil(anagramPairs.length / 3),
    'anagrams collide ' + collisions + '/' + anagramPairs.length
    + ' -- far above chance, the hash is order-independent or near it');
});

test('a borrowed-name pane cannot lend a project card its photograph', () => {
  /* The hasAvatar tied-gate is defence-in-depth (snapshot already zeroes
     hasAvatar on untied cards), so this test holds it LIVE the way the
     role gate's own flipped-card test does: a produced card with the tie
     flag deliberately flipped and an avatar claimed. */
  const projectsEngine = require('./engine/projects');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  const pdir = nodePath.join(SANDBOX, 'face-gate-proj');
  fs.mkdirSync(pdir, { recursive: true });
  try {
    projectsEngine.create({ name: 'Face Gate', folder: pdir, agents: ['leo'], roster: board.agents });
    const real = board.agents.find((a) => a.sessionName === 'leo');
    const flipped = [{ ...real, isNamedOurs: false, hasAvatar: true }];
    const row = projectsEngine.list(flipped).find((x) => x.name === 'Face Gate');
    assert.equal(row.agents[0].hasAvatar, false,
      'a pane we cannot tie to the name lent the card a photograph');
    // CONTROL: the tied card with an avatar passes the face through, so
    // the refusal above is the gate and not a dropped field.
    const tied = [{ ...real, hasAvatar: true }];
    assert.equal(projectsEngine.list(tied).find((x) => x.name === 'Face Gate').agents[0].hasAvatar, true,
      'CONTROL: a tied avatar did not reach the row, so the gate assertion proves nothing');
  } finally {
    board.restore();
  }
});

/* ---------------------------------------------------------------------------
 * room-polish: one verdict for an identical roster + the receipt pill's
 * dark borders. The told-line collapse is real page source via pageFunction;
 * the CSS pin is text-level because 7b-theme-flip watches surfaces, not
 * borders, and this exact trio already slipped past it once (#75 landed
 * after the #71 dark pass and never met it).
 * ------------------------------------------------------------------------ */

// The prelude the told-line family closes over: the page's own esc, not a
// hand copy of it (a copied producer drifts; the real one cannot -- the
// first cut of this line copied esc and got the null-handling wrong).
const TOLD_PRELUDE = pageFnSource('esc') + '\n';

test('the SINGULAR frame is pinned too, and composes every reason cleanly', () => {
  /**
   * 🛑 THE SINGULAR FRAME WAS PINNED BY NOTHING. Its plural twin got a verbatim
   * frame pin and a "must not name `instructions`" assertion; this one appeared
   * only in `web/index.html`, so restoring the withdrawn frame would have left
   * the whole suite green while all nine singulars composed against exactly the
   * wording the ruling exists to remove.
   *
   * ⚠️ And the singular is the COMMON path: the group line needs two or more
   * members with identical verdicts, so the hardened arm was the rarer one.
   *
   * The frame must not name `instructions`, because naming it makes that word
   * the antecedent for every pronoun after it and asserts a file some of these
   * reasons say does not exist.
   */
  const toldLine = pageFunction('pjToldLine', TOLD_PRELUDE);
  const line = (because) => toldLine({ state: 'could_not', because });

  const frame = line('a reason');
  assert.match(frame, /^We could not update this agent about this folder: /,
    'the singular frame changed; re-render all nine reasons against it before trusting this test');
  assert.doesNotMatch(frame.split(': ')[0], /instructions/,
    'the frame names `instructions` again, which makes it the antecedent for every pronoun after it');

  // Every mapped singular composed through it, read out of the engine's own
  // map rather than restated here.
  const projSrc2 = fs.readFileSync(nodePath.join(__dirname, 'engine', 'projects.js'), 'utf8');
  const ms = projSrc2.indexOf('const GROUP_BECAUSE = new Map([');
  const me = projSrc2.indexOf(']);', ms);
  const singulars2 = [...projSrc2.slice(ms, me).matchAll(/^\s*\['([^']+)',$/gm)].map((m) => m[1]);
  assert.ok(singulars2.length >= 9,
    'CONTROL: parsed ' + singulars2.length + ' singulars; the scan is not reading the map');
  for (const because of singulars2) {
    const composed = line(because);
    assert.ok((composed.match(/instructions/g) || []).length <= 1,
      'the singular line says "instructions" more than once: ' + composed);
    assert.doesNotMatch(composed, /so nothing was written|we left them alone/,
      'the reason re-states an outcome the frame already carries: ' + composed);
    assert.doesNotMatch(composed, /was not added|were not added/,
      'the frame or the reason names ADD, and the reason set spans add and remove: ' + composed);
  }
});

test('identical roster verdicts collapse to one group line, and only then', () => {
  const shared = pageFunction('pjSharedTold',
    TOLD_PRELUDE + pageFnSource('pjToldLine') + '\n' + pageFnSource('pjToldGroupLine'));

  const cn = (because, becauseGroup) => ({ told: { state: 'could_not', because, becauseGroup } });
  const told = () => ({ told: { state: 'told' } });

  // Collapses: same state, same because, 2+ members. The reason in the
  // group line is the ENGINE'S PLURAL SIBLING (becauseGroup), never the
  // singular spliced into a plural frame -- "any of them … this agent"
  // read as a contradiction (her ruling).
  const g = shared([
    cn('it has no folder of its own on this computer yet', 'none of them has a folder of its own on this computer yet'),
    cn('it has no folder of its own on this computer yet', 'none of them has a folder of its own on this computer yet'),
    cn('it has no folder of its own on this computer yet', 'none of them has a folder of its own on this computer yet')]);
  assert.ok(g.startsWith('We could not update these agents about this folder'),
    'three identical could_not verdicts did not collapse: ' + g);
  assert.ok(g.includes('none of them has a folder of its own on this computer yet'),
    'the group sentence did not carry the plural sibling: ' + g);
  /* ⚠️ RE-POINTED. This read /this agent has no folder/, which the frame
     ruling deleted from the tree, so it could not have failed even if the
     singular did leak. Its two neighbours above were re-pointed in that commit
     and this one was not. The singular for this row is the literal below. */
  assert.ok(!g.includes('it has no folder of its own on this computer yet'),
    'the singular because leaked into the plural frame: ' + g);

  // No plural sibling (unmapped because): NO collapse at all. Collapsing
  // suppresses the per-member rows, and a group line that names no reason
  // would then have LOST the reason entirely (iteration 3) -- repeated
  // sentences are weight, a vanished reason is a lie of omission.
  const gf = shared([cn('some unmapped sentence'), cn('some unmapped sentence')]);
  assert.equal(gf, '',
    'unmapped-identical reasons collapsed and lost their per-member rows: ' + gf);

  // The reasonless sentence itself stays as pjToldGroupLine's defensive
  // arm for a razed could_not (no because at all) reached directly.
  const gline = pageFunction('pjToldGroupLine', TOLD_PRELUDE);
  assert.equal(gline({ state: 'could_not' }),
    'We could not update these agents about this folder.',
    'the defensive reasonless arm changed or vanished');

  /**
   * 🛑 EVERY PLURAL COMPOSED THROUGH THE FRAME, not one of them. Eight of the
   * nine were defective when only one had been rendered, which is why this
   * asserts the whole set rather than a sample: a frame naming ADD made a
   * REMOVE reason false outright, and a frame naming a noun made every value
   * carrying that noun say it twice.
   *
   * ⚠️ The rule INVERTED when the frame changed, and an earlier version of
   * this comment survived the inversion and sat directly above the new one
   * stating the opposite. See the block below for what the properties are
   * now; there is one comment here, not two, on purpose.
   */
  /* ⚠️ THE PAIRS COME FROM THE ENGINE'S MAP, read out of its source, not from
     a list written here. A copy of the map in this file would compose the
     copy through the frame and pass while the real map said something else
     (a check containing a copy cannot fail). The keys are parsed and the
     values come back from `groupBecause` itself. */
  const projSrc = fs.readFileSync(nodePath.join(__dirname, 'engine', 'projects.js'), 'utf8');
  const mapBody = projSrc.slice(projSrc.indexOf('const GROUP_BECAUSE = new Map(['),
    projSrc.indexOf(']);', projSrc.indexOf('const GROUP_BECAUSE = new Map([')));
  const singulars = [...mapBody.matchAll(/^\s*\['([^']+)',$/gm)].map((m) => m[1]);
  /* ⚠️ THE PROPERTY INVERTED WHEN THE FRAME CHANGED, and the inversion is the
     lesson. The frame used to name `instructions`, so the rule was "exactly
     once" and the values were trimmed to satisfy it. That trim removed the
     only noun telling a reader what `them` meant, and the frame ALSO asserted
     a file some reasons deny exists. The frame names the AGENTS now, which is
     the one thing true in every arm, and `instructions` lives in the values
     where it has a referent. So the rule is AT MOST once, and the frame itself
     is pinned, because "at most once" alone would pass a frame that named the
     noun again while every value happened to omit it. */
  const FRAME_NOUN = /instructions/g;
  const frame = shared([cn('x', 'a plural'), cn('x', 'a plural')]);
  assert.match(frame, /^We could not update these agents about this folder: /,
    'the group frame changed; re-render all nine values against it before trusting this test');
  assert.doesNotMatch(frame.split(': ')[0], /instructions/,
    'the frame names `instructions` again, which makes it the antecedent for every pronoun after it');
  for (const singular of singulars) {
    const plural = require('./engine/projects').groupBecause(singular);
    assert.ok(plural, 'a key parsed out of GROUP_BECAUSE does not map: ' + singular);
    const line = shared([cn(singular, plural), cn(singular, plural)]);
    assert.ok(line, 'two identical verdicts did not collapse for: ' + singular);
    assert.ok((line.match(FRAME_NOUN) || []).length <= 1,
      'the group line says "instructions" more than once: ' + line);
    assert.doesNotMatch(line, /so nothing was written|we left them alone/,
      'the value re-states an outcome the frame already carries: ' + line);
    /* ⚠️ AIMED AT THE VALUE, NOT THE LINE. Against the line this could never
       fail: the `startsWith` above pins the frame verbatim, so a frame naming
       ADD is already caught before this runs. Measured by putting the old
       frame back -- the startsWith fired and this did not. Against the VALUE
       it holds something nothing else does: a reason that names the operation
       it belongs to, when one of them is a removal and the frame cannot know
       which. */
    assert.doesNotMatch(plural, /was not added|were not added|added to/,
      'a plural reason names ADD, and the reason set spans add and remove: ' + plural);
  }
  // CONTROL: the loop above ran over a non-empty set. An empty expectPlural
  // would satisfy all three assertions vacuously, which is the failure this
  // whole test exists to prevent, one level down.
  assert.ok(singulars.length >= 9,
    'CONTROL: only ' + singulars.length + ' pairs parsed out of GROUP_BECAUSE; the scan is not seeing the whole map');

  // The group line lands in the page as raw HTML (paintOneProject), so a
  // markup-carrying plural form must arrive ESCAPED, not verbatim-dangerous.
  const gx = shared([cn('x', 'a <b>note</b> & more'), cn('x', 'a <b>note</b> & more')]);
  assert.ok(gx.includes('a &lt;b&gt;note&lt;/b&gt; &amp; more'),
    'the group reason was not escaped: ' + gx);
  assert.ok(!gx.includes('<b>note</b>'),
    'raw markup from a group reason survived into the group line');

  // Success says NOTHING (ruled 2026-08-18): an all-told roster has no
  // sentence to say and nothing to collapse.
  assert.equal(shared([told(), told()]), '',
    'an all-told roster grew a group sentence; success is silent now');

  // Does NOT collapse: mixed states.
  assert.equal(shared([told(), cn('x')]), '', 'mixed states collapsed');
  // Does NOT collapse: same state, different because (the string-equality
  // key is what keeps the group claim exactly as true as the rows).
  assert.equal(shared([cn('disk full'), cn('permission denied')]), '',
    'different becauses collapsed into one sentence');
  // Does NOT collapse: singleton (its line belongs on its row).
  assert.equal(shared([cn('x')]), '', 'a singleton roster grew a group line');
  // Does NOT collapse: nothing to say.
  assert.equal(shared([{ told: {} }, { told: {} }]), '', 'empty verdicts collapsed');
});

test('pjMember suppressTold removes the per-member verdict span, and only with it', () => {
  // STATE_COPY here is a DELIBERATELY partial stand-in (two of six keys):
  // it only feeds the state caption, which no assertion below reads, and
  // the real const is not a `function` pageFnSource can lift.
  // ⚠️ `discTint`, `discInk` and `initials` are lifted from the REAL page
  // rather than stubbed. pjMember grew a face on 2026-08-19 and this test went
  // red with "discTint is not defined" -- which is the extraction harness
  // working exactly as intended: it runs the real function, so a new
  // dependency has to be a real one. Stubbing them would keep the test green
  // while quietly no longer exercising the branch that draws the face.
  const prelude = TOLD_PRELUDE
    + 'const STATE_COPY = { idle: { label: "Idle" }, unknown: { label: "Can\'t tell" } };\n'
    + pageConstSource('DISC_TINTS') + '\n'
    + pageConstSource('DISC_INKS') + '\n'
    + pageFnSource('discIndex') + '\n'
    + pageFnSource('discTint') + '\n'
    + pageFnSource('discInk') + '\n'
    + pageFnSource('initials') + '\n'
    + pageFnSource('pjToldLine') + '\n';
  const member = pageFunction('pjMember', prelude);
  const toldLine = pageFunction('pjToldLine', TOLD_PRELUDE);

  // The member is a REAL row from the producer (fleet board -> create ->
  // list), not a hand-built stand-in, so it carries exactly the fields the
  // screen actually receives -- fixture discipline, same as the face-gate
  // test above.
  const projectsEngine = require('./engine/projects');
  const board = fleet.install([
    fleet.agent('leo', { state: 'idle' }),
    fleet.agent('mikey', { state: 'idle' }),
  ]);
  const pdir = nodePath.join(SANDBOX, 'suppress-told-proj');
  fs.mkdirSync(pdir, { recursive: true });
  let m; let roster;
  try {
    projectsEngine.create({ name: 'Suppress Told', folder: pdir, agents: ['leo', 'mikey'], roster: board.agents });
    // The verdict is written by the sync pass, not by create; without it
    // every member sits at not_tried and there is nothing to suppress.
    projectsEngine.syncAgent('leo', board.agents);
    projectsEngine.syncAgent('mikey', board.agents);
    roster = projectsEngine.list(board.agents).find((x) => x.name === 'Suppress Told').agents;
    m = roster[0];
    // ⚠️ DETERMINISM GUARD: with success now SILENT, this test only means
    // something when the produced verdict is a FAILURE (told renders
    // nothing, so there would be no span to suppress). The sandbox
    // produces could_not (no instruction files exist for these agents);
    // assert that so an environment where the sync succeeds fails loudly
    // here instead of in the pre-control below with a vaguer message.
    assert.equal((m.told || {}).state, 'could_not',
      'the sandbox produced a non-failure verdict; this test needs a could_not roster (state: '
      + (m.told || {}).state + ')');
  } finally {
    board.restore();
  }

  // The positive collapse, on PRODUCED rows: two members synced the same
  // way carry the identical verdict, so the real field shapes (not the
  // hand-built negatives above) exercise the group line too.
  const sharedOnProduced = pageFunction('pjSharedTold',
    TOLD_PRELUDE + pageFnSource('pjToldLine') + '\n' + pageFnSource('pjToldGroupLine'))(roster);
  assert.ok(sharedOnProduced,
    'two identically-synced produced members did not collapse (told states: '
    + roster.map((r) => (r.told || {}).state).join(', ') + ')');

  // Pre-control: the real row must have a verdict to suppress, whichever
  // state the sandbox create produced, or both assertions below are vacuous.
  assert.ok(toldLine(m.told || {}),
    'PRE-CONTROL: the produced member carries no told verdict at all (state: '
    + ((m.told || {}).state || '<none>') + ')');

  // CONTROL first: without the flag the span is there, so the absence
  // below is the suppression and not a dropped field.
  assert.ok(member(m).includes('pj-told'),
    'CONTROL: the per-member verdict span is gone even unsuppressed');
  assert.ok(!member(m, true).includes('pj-told'),
    'suppressTold left the per-member verdict span in place');

  // The removal action left these rows entirely (Josh's ruling: it lives
  // in Project settings now). Asserted as absence WITH the settings
  // painter's presence below as the control, so this cannot pass because
  // the feature vanished.
  assert.ok(!member(m).includes('data-drop'),
    'a removal control survived on the member rows');

  // The SETTINGS painter carries the action now: rows with the name, the
  // visible label, the label-leading accessible name (WCAG 2.5.3), and
  // the data-drop wiring the relocated handler keys on.
  const paintMembers = pageFunction('paintSettingsMembers',
    TOLD_PRELUDE
    + 'const STATE_COPY = { idle: { label: "Idle" }, unknown: { label: "Can\'t tell" } };\n'
    + 'const setIfChanged = (el, html) => { el.innerHTML = html; };\n');
  const box = { innerHTML: '' };
  global.document = { getElementById: (id) => (id === 'pjs-members' ? box : null) };
  try {
    paintMembers({ agents: roster });
    const VISIBLE = 'Remove from project';
    assert.ok(box.innerHTML.includes('>' + VISIBLE + '</button>'),
      'CONTROL: the settings rows lack the removal action, so the absence above proves loss, not relocation');
    const aria = (box.innerHTML.match(/aria-label="([^"]*)"/) || [])[1] || '';
    assert.ok(aria.indexOf(VISIBLE) === 0,
      'the accessible name does not lead with the visible label: ' + aria);
    // N buttons all visibly read the same; the interpolated name is the
    // ONLY thing distinguishing their accessible names.
    assert.ok(aria.includes(roster[0].name),
      'the accessible name lost the agent name: ' + aria);
    assert.ok(box.innerHTML.includes('data-drop="' + roster[0].sessionName + '"'),
      'the settings rows lost the data-drop wiring the handler keys on');
    paintMembers({ agents: [] });
    assert.ok(box.innerHTML.includes('No agents on this project yet'),
      'an empty roster rendered as nothing rather than saying so');
    // The unseen arm, through the real producer: a member the board has
    // never seen renders its reason, never a healthy-looking bare row.
    const projectsEngine2 = require('./engine/projects');
    const gdir = nodePath.join(SANDBOX, 'ghost-member-proj');
    fs.mkdirSync(gdir, { recursive: true });
    projectsEngine2.create({ name: 'Ghost Member', folder: gdir, agents: ['nobody-here'], roster: [] });
    const ghost = projectsEngine2.list([]).find((x) => x.name === 'Ghost Member').agents;
    paintMembers({ agents: ghost });
    assert.ok(box.innerHTML.includes('unseen'),
      'a never-seen member did not wear the unseen treatment');
    // The ENGINE's specific reason, not the painter's generic fallback:
    // the fallback alternative made this pin unable to catch a lost
    // engine because (the row would degrade generic and still pass).
    assert.ok(box.innerHTML.includes('never seen an agent by this name'),
      'a never-seen member lost the engine\'s specific reason');
  } finally {
    delete global.document;
  }
});

test('the settings members wiring is real, not just extractable', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const facts = pageFnSource('paintSettingsFacts');
  assert.ok(facts.includes('paintSettingsMembers(p)'),
    'paintSettingsFacts no longer paints the members rows');
  assert.ok(raw.includes("document.getElementById('pjs-members').addEventListener('click'"),
    'the relocated removal handler no longer listens on the settings rows');
  assert.ok(raw.includes('id="pjs-members"'),
    'CONTROL: the settings rows element is gone, so the listener pin above is vacuous');
  // The guard trio, pinned at source level (the say-box precedent):
  // these were fixes to fixes, the least-proven lines on the branch,
  // and the stubbed unit test cannot see any of them.
  const handlerSrc = raw.slice(raw.indexOf("document.getElementById('pjs-members').addEventListener"));
  // The terminator is the listener's own close at column 0: an inner
  // `});` (the fetch options literal) cut the first version of this
  // slice short and the pins below never saw the guard.
  const handler = handlerSrc.slice(0, handlerSrc.indexOf('\n});') + 4);
  assert.ok(handler.includes('const sentProject = PJ_CURRENT;'),
    'the in-flight cross-project guard lost its capture');
  assert.ok(handler.includes('if (PJ_CURRENT !== sentProject) return;'),
    'the in-flight cross-project guard lost its check');
  // BOTH arms: the success path and the catch path each carry the
  // visible-view targeting; a first-occurrence pin let either one revert
  // alone.
  assert.ok(handler.split("document.getElementById('pj-settings-view').hidden").length >= 3,
    'an arm of the handler lost its visible-view targeting');
  assert.ok(pageFnSource('paintProjectSettings').includes("getElementById('pjs-members-msg').textContent = ''"),
    'the entry-clear for the members verdict is gone (the persisted-half misattribution returns)');

  // The explanatory sentence is CUT (Josh, 2026-08-18 10:07 PM): the
  // survival reassurance lives in the removal announcement at act time.
  const flat = raw.replace(/\s+/g, ' ');
  // Presence control first: the section this absence speaks about must
  // exist, or a typo in the needle passes vacuously forever.
  assert.ok(flat.includes('Project members'),
    'CONTROL: the members section is gone; the absence below proves nothing');
  assert.ok(!flat.includes('Who is on this project. Removing an agent takes it off'),
    'the cut members hint came back');
  // The painter must repaint through setIfChanged: the unit test stubs
  // it, so only a source pin catches a regression to bare innerHTML
  // (which would steal keyboard focus from the rows every five seconds).
  assert.ok(pageFnSource('paintSettingsMembers').includes('setIfChanged('),
    'paintSettingsMembers no longer repaints through setIfChanged');
  // The unknown-says-why arm exists in the painter (its behavioral twin
  // in pjMember records the bare-caption form as a shipped defect).
  assert.ok(pageFnSource('paintSettingsMembers').includes("m.state === 'unknown' && m.because"),
    'the settings rows lost the unknown-says-why arm');
});

test('the receipt pill borders have dark twins (the trio that missed the #71 pass)', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  // Presence control: the light rules this test claims get overridden.
  const lightFailed = raw.indexOf('.delivery.failed { border-color: rgba(179,38,30,.5); }');
  const lightPlaced = raw.indexOf('.delivery.placed { border-color: rgba(47,125,90,.5); }');
  assert.ok(lightFailed > -1 && lightPlaced > -1,
    'CONTROL: the light receipt borders moved; re-point this pin');
  const darkFailed = raw.indexOf('.delivery.failed { border-color: rgba(255,140,130,.5); }');
  const darkPlaced = raw.indexOf('.delivery.placed { border-color: rgba(121,197,157,.5); }');
  assert.ok(darkFailed > -1, 'the failed receipt border has no dark twin');
  assert.ok(darkPlaced > -1, 'the placed receipt border has no dark twin');
  // Both dark rules sit INSIDE a dark block (a twin pasted into the light
  // sheet passes a bare presence check and ships the wrong color in both
  // schemes). "Inside" is measured, not inferred from marker order: the
  // stylesheet has several dark blocks, so we brace-match the one whose
  // opener precedes each rule and require the rule to land before it closes.
  const insideDark = (at) => {
    const marker = raw.lastIndexOf('@media (prefers-color-scheme: dark)', at);
    if (marker === -1) return false;
    const open = raw.indexOf('{', marker);
    if (open === -1) return false;
    let depth = 0;
    for (let k = open; k < raw.length; k += 1) {
      if (raw[k] === '{') depth += 1;
      else if (raw[k] === '}') { depth -= 1; if (depth === 0) return at < k; }
    }
    return false;
  };
  assert.ok(insideDark(darkFailed), 'the dark failed rule is not inside a dark block');
  assert.ok(insideDark(darkPlaced), 'the dark placed rule is not inside a dark block');
  // Presence control for the measurer itself: a light rule must NOT read
  // as inside a dark block, or insideDark answers yes to everything.
  assert.ok(!insideDark(lightFailed),
    'CONTROL: insideDark claims the light rule is in a dark block; the measurer is broken');
});

test('the group line is wired into paintOneProject, not just extractable', () => {
  // The function-level tests stay green if the append is dropped, which
  // would leave every verdict suppressed and stated NOWHERE -- the
  // merge-only wiring class. Pin the wiring at source level, with a
  // control that the CSS the literal targets still exists.
  const src = pageFnSource('paintOneProject');
  assert.ok(src.includes('pjSharedTold('), 'paintOneProject no longer consults pjSharedTold');
  assert.ok(src.includes('pj-told-group'), 'paintOneProject no longer emits the pj-told-group line');
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.ok(raw.includes('.pj-members .pj-told-group {'),
    'CONTROL: the .pj-told-group CSS rule is gone, so the emitted class styles nothing');
});

/* ---------------------------------------------------------------------------
 * update-control: Check now, reachability on the wire, the card's four
 * states, and the finish line that names what landed.
 * ------------------------------------------------------------------------ */

test('the check route asks fresh, carries reachability, and rides the cross-site guard', async () => {
  const updates = require('./engine/update');
  try {
    updates.resetCache();
    // Prime a fresh look so the TTL would normally sit on it...
    updates.setFetcher(async () => ({ ok: true, json: async () => ({ version: updates.RUNNING }) }));
    await updates.refresh();
    // ...then publish something newer behind the TTL's back.
    updates.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
    const out = await req('/api/update/check', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(body.latest, '99.0.0', 'the check served the TTL cache instead of asking fresh');
    assert.equal(body.reached, true);
    assert.deepEqual(body.offer, { version: '99.0.0' }, 'the check does not carry the ready-to-install offer');

    // Unreachable says so, and the status payload agrees (could-not-reach
    // must never render as up-to-date anywhere).
    updates.setFetcher(async () => { throw new Error('offline'); });
    const down = JSON.parse((await req('/api/update/check', { method: 'POST', headers: { 'content-type': 'application/json' } })).body);
    assert.equal(down.reached, false);
    const st = JSON.parse((await req('/api/status', {})).body);
    assert.equal(st.updateLook.reached, false, 'the status payload does not carry reachability');

    // The guard, asserted rather than assumed (a new sibling does not
    // inherit one by adjacency).
    const cross = await req('/api/update/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    assert.equal(cross.status, 403, 'a cross-site origin reached the check route');
  } finally {
    updates.resetCache();
    updates.setFetcher(null);
  }
});

test("the update card's states are mutually exclusive and the line is never blank", () => {
  const paint = pageFunction('paintUpdateCard', 'let UPD_CHECKING = false;\n');
  const mk = () => {
    const els = {
      'upd-line': { textContent: '' },
      'upd-btn': { textContent: '', hidden: true, disabled: false, dataset: {} },
    };
    global.document = { getElementById: (id) => els[id] };
    return els;
  };
  try {
    // Newer exists.
    let els = mk();
    paint('0.1.8', { version: '0.1.9' }, { reached: true, readable: true });
    assert.equal(els['upd-line'].textContent, 'Kosmos 0.1.8. Version 0.1.9 is ready.');
    assert.equal(els['upd-btn'].textContent, 'Update');
    // Current: up-to-date needs BOTH reached and readable.
    els = mk();
    paint('0.1.9', null, { reached: true, readable: true });
    assert.equal(els['upd-line'].textContent, 'Kosmos 0.1.9. Up to date.');
    assert.equal(els['upd-btn'].textContent, 'Check now');
    // Reached but unreadable (the captive-portal shape): NEVER up-to-date.
    els = mk();
    paint('0.1.9', null, { reached: true, readable: false, looked: true });
    assert.equal(els['upd-line'].textContent, "Kosmos 0.1.9. Could not read the update server's answer.");
    assert.equal(els['upd-btn'].textContent, 'Try again');
    // Could not look: NEVER "up to date".
    els = mk();
    paint('0.1.9', null, { reached: false });
    assert.equal(els['upd-line'].textContent, 'Kosmos 0.1.9. Could not reach the update server.');
    assert.equal(els['upd-btn'].textContent, 'Try again');
    // The first look still in flight: Checking, never a failure that has
    // not happened (boot rendered "could not reach" before the first
    // answer landed; measured on the render sandbox).
    els = mk();
    paint('0.1.9', null, { reached: false, looked: false });
    assert.equal(els['upd-line'].textContent, 'Kosmos 0.1.9. Checking.');
    assert.equal(els['upd-btn'].disabled, true, 'the button was pressable mid-first-look');
    // The line is never blank, even before the first status.
    els = mk();
    paint(null, null, null);
    assert.ok(els['upd-line'].textContent.length > 0, 'the line rendered blank');
    assert.ok(!els['upd-line'].textContent.includes('Up to date'),
      'an unknown look claimed up-to-date');
  } finally {
    delete global.document;
  }
});

test('the finish line names what actually landed, and only when something did', () => {
  const src = pageFnSource('updatedNoteOnce');
  const run = (stored, nowVersion) => {
    const slot = { innerHTML: '' };
    const store = { v: stored };
    const clicks = {};
    const sandbox = {
      sessionStorage: {
        getItem: () => store.v,
        removeItem: () => { store.v = null; },
      },
      document: {
        getElementById: (id) => (id === 'unote-slot' ? slot
          : { addEventListener: (ev, fn) => { clicks[id] = fn; } }),
      },
      esc: (x) => String(x),
    };
    // eslint-disable-next-line no-new-func
    new Function('sessionStorage', 'document', 'esc',
      'let UPDATED_NOTE_DONE = false;\n' + src + '\nupdatedNoteOnce(arguments[3]);')(
      sandbox.sessionStorage, sandbox.document, sandbox.esc, nowVersion);
    return { slot, store };
  };
  // Version changed: the note names the version now installed.
  const changed = run('0.1.8', '0.1.9');
  assert.ok(changed.slot.innerHTML.includes('You are on Kosmos 0.1.9.'),
    'the finish line does not name the landed version');
  assert.ok(changed.slot.innerHTML.includes('Updated.'));
  // No change: an installer that found nothing to do did not update
  // anything, and saying so would be the stale label at the finish line.
  const same = run('0.1.9', '0.1.9');
  assert.equal(same.slot.innerHTML, '', 'an unchanged version still claimed Updated');
  // No note stored: nothing renders.
  const none = run(null, '0.1.9');
  assert.equal(none.slot.innerHTML, '', 'a reload with no install note grew a toast');
  // The note is consumed either way (no repeat on the next reload).
  assert.equal(changed.store.v, null, 'the note survived its own rendering');
});

test('the check route is POST-only, and Check now clears the Later note before asking', async () => {
  // POST-only, asserted rather than assumed: a GET must fall through.
  const got = await req('/api/update/check', {});
  assert.notEqual(got.status, 200, 'a GET reached the check route');

  // The named handler, driven with stubs: the Later note is cleared
  // BEFORE the host is asked (the spec's order), and the card leaves the
  // Checking state with the answer painted.
  const src = pageFnSource('updCheckNowClick');
  const calls = [];
  const els = {
    'upd-line': { textContent: '' },
    'upd-btn': { textContent: '', hidden: false, disabled: false, dataset: { act: 'check' }, focus: () => { calls.push('focus'); } },
  };
  const sandbox = {
    localStorage: { removeItem: (k) => { calls.push('clear:' + k); } },
    fetch: async () => { calls.push('fetch'); return { ok: true, json: async () => ({ running: '0.1.9', latest: '0.1.9', reached: true, readable: true, offer: null }) }; },
    document: { getElementById: (id) => els[id] },
    renderUpdateToast: () => { calls.push('toast'); },
  };
  // eslint-disable-next-line no-new-func
  const run = new Function('localStorage', 'fetch', 'document', 'renderUpdateToast', 'LAST_VERSION',
    'let UPD_CHECKING = false; let UPD_CONFIRM_OPENER = null;\n'
    + pageFnSource('paintUpdateCard') + '\n' + src + '\nreturn updCheckNowClick();');
  await run(sandbox.localStorage, sandbox.fetch, sandbox.document, sandbox.renderUpdateToast, '0.1.9');
  assert.ok(calls.indexOf('clear:kosmos-update-later') > -1, 'Check now never cleared the Later note');
  assert.ok(calls.indexOf('clear:kosmos-update-later') < calls.indexOf('fetch'),
    'the Later note was cleared AFTER the ask, not before (the spec\'s order)');
  assert.equal(els['upd-line'].textContent, 'Kosmos 0.1.9. Up to date.',
    'the answer did not land on the line');
  assert.ok(calls.includes('focus'), 'the keyboard was not returned to the button');

  // The client-failure arm: the BOARD did not answer. The sentence names
  // the check (not the release host), and the toast is NEVER touched --
  // clearing it on our own failure could eat a valid offer. The arm's
  // whole value is what it does NOT do, which is exactly what a refactor
  // silently breaks.
  const calls2 = [];
  const els2 = {
    'upd-line': { textContent: '' },
    'upd-btn': { textContent: '', hidden: false, disabled: false, dataset: { act: 'check' }, focus: () => { calls2.push('focus'); } },
  };
  const run2 = new Function('localStorage', 'fetch', 'document', 'renderUpdateToast', 'LAST_VERSION',
    'let UPD_CHECKING = false; let UPD_CONFIRM_OPENER = null;\n'
    + pageFnSource('paintUpdateCard') + '\n' + pageFnSource('updCheckNowClick') + '\nreturn updCheckNowClick();');
  await run2(
    { removeItem: () => { calls2.push('clear'); } },
    async () => { throw new Error('board down'); },
    { getElementById: (id) => els2[id] },
    () => { calls2.push('toast'); },
    '0.1.9');
  assert.equal(els2['upd-line'].textContent, 'Kosmos 0.1.9. Could not check just now.',
    'a board-side failure blamed the wrong leg');
  assert.equal(els2['upd-btn'].textContent, 'Try again');
  assert.ok(!calls2.includes('toast'),
    'a board-side failure cleared the toast (could eat a valid offer)');
  assert.ok(calls2.includes('focus'), 'the keyboard was not returned after the failed check');
});

test('the card standoff, the confirm focus fallback, and the identical-write guard hold', () => {
  try {
  // (a) UPD_CHECKING owns the card: a poll paint during a check changes nothing.
  const paintBusy = pageFunction('paintUpdateCard', 'let UPD_CHECKING = true;\n');
  const busy = { 'upd-line': { textContent: 'held' }, 'upd-btn': { textContent: 'held', hidden: true, disabled: true, dataset: {} } };
  global.document = { getElementById: (id) => busy[id] };
  paintBusy('9.9.9', { version: '9.9.9' }, { reached: true, readable: true });
  assert.equal(busy['upd-line'].textContent, 'held', 'a poll repainted the card mid-check');
  assert.equal(busy['upd-btn'].hidden, true, 'a poll unhid the button mid-check');

  // (b) closeUpdConfirm falls back to a live control when the opener is gone.
  const focused = [];
  const els = {
    updconfirm: { hidden: false },
    'ut-install': null,
    'upd-btn': { focus: () => focused.push('upd-btn') },
  };
  global.document = { getElementById: (id) => els[id], contains: () => false };
  const close = new Function('document',
    "let UPD_CONFIRM_OPENER = { focus: () => { throw new Error('focused a removed node'); } };\n"
    + pageFnSource('closeUpdConfirm') + '\ncloseUpdConfirm();\nreturn UPD_CONFIRM_OPENER;');
  const cleared = close(global.document);
  assert.deepEqual(focused, ['upd-btn'], 'focus did not fall back to a live control');
  assert.equal(cleared, null, 'the stale opener was kept for the next close');
  assert.equal(els.updconfirm.hidden, true);

  // (c) put() suppression: an identical repaint writes NOTHING to the
  // role="status" region (screen readers re-announce on any mutation).
  let writes = 0;
  const line = { _t: '', get textContent() { return this._t; }, set textContent(v) { this._t = v; writes += 1; } };
  const quiet = { 'upd-line': line, 'upd-btn': { textContent: '', hidden: false, disabled: false, dataset: {} } };
  global.document = { getElementById: (id) => quiet[id] };
  const paint = pageFunction('paintUpdateCard', 'let UPD_CHECKING = false;\n');
  paint('0.1.9', null, { reached: true, readable: true });
  const after = writes;
  paint('0.1.9', null, { reached: true, readable: true });
  assert.equal(writes, after, 'an identical repaint rewrote the live region');
  assert.ok(after > 0, 'CONTROL: the first paint never wrote, so the suppression assert proves nothing');
  } finally {
    // The stub must not outlive a FAILED assertion either, or it leaks
    // into every later test in the file (the sibling test's pattern).
    delete global.document;
  }
});

test("the card's Update arm opens the one shared confirm and records itself as opener", async () => {
  const calls = [];
  const els = {
    'upd-btn': { textContent: 'Update', hidden: false, disabled: false, dataset: { act: 'update' }, focus: () => calls.push('btn-focus') },
    'upd-line': { textContent: '' },
    'uc-err': { hidden: false },
    updconfirm: { hidden: true },
    'uc-no': { focus: () => calls.push('uc-no-focus') },
  };
  const doc = { getElementById: (id) => els[id] };
  // eslint-disable-next-line no-new-func
  const opener = await new Function('document', 'localStorage', 'fetch', 'renderUpdateToast', 'LAST_VERSION',
    'let UPD_CHECKING = false; let UPD_CONFIRM_OPENER = null;\n'
    + pageFnSource('paintUpdateCard') + '\n' + pageFnSource('updCheckNowClick')
    + '\nreturn updCheckNowClick().then(() => UPD_CONFIRM_OPENER);')(
    doc,
    { removeItem: () => calls.push('clear') },
    async () => { calls.push('fetch'); throw new Error('must not be called'); },
    () => calls.push('toast'),
    '0.1.9');
  assert.equal(els.updconfirm.hidden, false, 'the shared confirm did not open');
  assert.equal(els['uc-err'].hidden, true, 'a stale error survived into the confirm');
  assert.deepEqual(calls, ['uc-no-focus'],
    'the Update arm did something besides opening the confirm on the safe answer: ' + JSON.stringify(calls));
  assert.equal(opener, els['upd-btn'], 'the card button was not recorded as the opener');
});

test('the centred quiet button is the pack rule, pinned', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  // 18e:173 -- inline-flex left-packs at full width without this, which
  // is the New task / Add member gap Josh saw.
  const at = raw.indexOf('.btn-quiet {');
  assert.ok(at > -1, 'the btn-quiet rule moved; re-point this pin');
  const rule = raw.slice(at, raw.indexOf('}', at));
  assert.ok(rule.includes('justify-content: center'),
    'btn-quiet lost its centring; labels left-pack at full width again');
});

/* ---------------------------------------------------------------------------
 * room-search: the conversation filter, its wiring, and the removal
 * announcement.
 * ------------------------------------------------------------------------ */

test('the conversation filter matches what a row shows, and only that', () => {
  // The prelude carries the REAL shared fallback constant, lifted from
  // the page (a copy here would be the check-containing-a-copy class).
  const rawPage = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const fbAt = rawPage.indexOf('const PJ_VALVE_FALLBACK');
  assert.ok(fbAt > -1, 'the shared valve fallback constant vanished');
  const fallbackDecl = rawPage.slice(fbAt, rawPage.indexOf(';', fbAt) + 1);
  // The stub keeps the PAGE's data shape (agents[] keyed on sessionName)
  // so the fixture cannot teach a future reader a schema that does not
  // exist in the product.
  const filter = pageFunction('pjRoomFilterRows',
    'const pjNameOf = (p, from) => { const a = (p.agents || []).find((x) => x.sessionName === from); return (a && a.name) || from; };\n'
    + fallbackDecl + '\n');
  // Discriminating probes (review): the display name DIVERGES from the
  // session key and the operator row's from is NOT 'you', so an
  // implementation matching raw m.from cannot pass these. The project
  // row comes from the REAL producer (fleet identity -> create -> list),
  // never a hand-built roster shape (fixture discipline).
  const projectsEngine3 = require('./engine/projects');
  const board3 = fleet.install([fleet.agent('leo', { state: 'idle', displayName: 'Leonardo' })]);
  const fdir = nodePath.join(SANDBOX, 'filter-names-proj');
  fs.mkdirSync(fdir, { recursive: true });
  let p;
  try {
    projectsEngine3.create({ name: 'Filter Names', folder: fdir, agents: ['leo'], roster: board3.agents });
    p = projectsEngine3.list(board3.agents).find((x) => x.name === 'Filter Names');
    assert.equal((p.agents[0] || {}).name, 'Leonardo',
      'PRE-CONTROL: the producer did not resolve the divergent display name');
  } finally {
    board3.restore();
  }
  const rows = [
    { id: 'm1', from: 'leo', text: 'The link is stable now.' },
    { id: 'm2', operator: true, from: 'op-key', text: 'Cut it to four emails.' },
    { kind: 'valve', because: 'mikey has been going back and forth without landing.' },
  ];
  // Empty query: the SAME array back (identity, not a copy -- this is
  // the per-keystroke hot path, and deepEqual could not tell a slice()
  // regression from the fast path).
  assert.strictEqual(filter(rows, p, ''), rows);
  assert.strictEqual(filter(rows, p, '   '), rows);
  // Text match, case-folded.
  assert.deepEqual(filter(rows, p, 'STABLE').map((r) => r.id), ['m1']);
  // Sender display-name match: the RESOLVED name, provably (only the
  // display form contains 'nardo'; the key does not).
  assert.deepEqual(filter(rows, p, 'nardo').map((r) => r.id), ['m1']);
  // And the raw key must NOT match once a display name exists, or the
  // filter is matching what the row does not show.
  assert.deepEqual(filter(rows, p, 'op-key'), [],
    'the filter matched a session key the row never displays');
  // The operator's rows answer to "you".
  assert.deepEqual(filter(rows, p, 'you').map((r) => r.id), ['m2']);
  // Valve bands match on their sentence.
  assert.equal(filter(rows, p, 'without landing').length, 1);
  // A valve carrying a stray from (the a2a record shape) is still never
  // matched by it: the band displays no sender, and the guarantee is
  // local, not the route's row shape.
  assert.deepEqual(filter([{ kind: 'valve', from: 'leo', because: 'quiet words' }], p, 'leonardo'), [],
    'a valve band was found by a sender it does not display');
  // A valve with NO because displays the shared fallback and must be
  // findable by its words (the filter matches what a row SHOWS).
  const bare = [{ kind: 'valve' }];
  assert.equal(filter(bare, p, 'bring you in').length, 1,
    'the fallback valve sentence is displayed but unsearchable');
  // No match: empty, never a throw.
  assert.deepEqual(filter(rows, p, 'zzz-not-here'), []);
});

test('the search is wired: pack markup verbatim, instant repaint, reset on switch, no scroll while filtering', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  // The pack's control (18e), placeholder and aria pair verbatim.
  assert.ok(raw.includes('placeholder="Search this conversation" aria-label="Search this conversation"'),
    "the search input lost the pack's words");
  assert.ok(raw.includes('.tsearch { display: flex; align-items: center; gap: 6px; flex: 0 1 15rem; min-width: 0;'),
    "the tsearch rule drifted from the pack's values");
  // The wiring: input handler repaints from the cached body; the query
  // resets on project open; a filtered paint never scrolls.
  assert.ok(raw.includes("document.getElementById('pj-room-search').addEventListener('input'"),
    'the search input drives nothing');
  // The LISTENER BODY, not just its existence: an emptied listener passes
  // an attachment pin while typing does nothing. Sliced at the column-0
  // close (the members-handler technique).
  const lsrc = raw.slice(raw.indexOf("document.getElementById('pj-room-search').addEventListener"));
  const listener = lsrc.slice(0, lsrc.indexOf('\n});') + 4);
  assert.ok(listener.includes('PJ_ROOM_QUERY = document'), 'the listener no longer reads the query');
  assert.ok(listener.includes('paintRoom(box.__lastBody)'), 'the listener no longer repaints from the cached body');
  assert.ok(listener.includes('pjRoomAnnounce(pjNoMatchSentence('),
    'the spoken no-match copy no longer shares the shown sentence');
  assert.ok(listener.includes('__lastBody.ok !== false'),
    'the announcer claims nothing-matches against a partially unreadable record');
  // The cache lifecycle: loadRoom stores the body; openProject invalidates
  // it AND resets the query (both lines pinned INSIDE their functions --
  // a whole-file pin matched the variable declaration and could not fail).
  assert.ok(pageFnSource('loadRoom').includes('__lastBody = body'),
    'loadRoom no longer caches the body the listener repaints from');
  const open_ = pageFnSource('openProject');
  assert.ok(open_.includes("PJ_ROOM_QUERY = '';"), 'the query does not reset on project switch');
  assert.ok(open_.includes("getElementById('pj-room-search').value = ''"),
    'stale query text survives in the box across a project switch');
  assert.ok(open_.includes('__lastBody = undefined'),
    'a stale body survives a project switch (the filter would search another room)');
  assert.ok(open_.includes('PJ_SEARCH_WAS_EMPTY = false;'),
    "project B's first no-match announce would be skipped against A's stale flag");
  const paint = pageFnSource('paintRoom');
  assert.ok(paint.includes('pjRoomFilterRows('), 'paintRoom no longer filters');
  assert.ok(paint.includes('if (!filtering) box.scrollTop'), 'a filtered paint scrolls the reader to the tail');
  // The no-match state is HER sentence (ruled 10:16 PM): names the
  // query, says the way out.
  assert.ok(paint.includes('esc(pjNoMatchSentence(PJ_ROOM_QUERY))'),
    'the shown no-match state stopped using the shared, escaped sentence');
  const sentence = pageFunction('pjNoMatchSentence');
  assert.equal(sentence('trial length'),
    'Nothing here matches "trial length". Clearing the search brings the conversation back.',
    'her ruled sentence drifted');
});

test("the removal announcement is her sentence, on both verdict arms", () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const handlerSrc = raw.slice(raw.indexOf("document.getElementById('pjs-members').addEventListener"));
  const handler = handlerSrc.slice(0, handlerSrc.indexOf('\n});') + 4);
  // Success speaks her sentence; could_not opens with it then warns.
  assert.ok(handler.split("is off this project and still on your computer.").length >= 3,
    "an arm of the handler lost her ruled sentence");
  assert.ok(!handler.includes('Taken off'),
    'the struck phrase returned to the announcement');
  // The name is captured BEFORE the awaits (the success repaint removes
  // the row; reading it later reads a detached node).
  assert.ok(handler.indexOf('const who =') < handler.indexOf('await fetch'),
    'the display name is read after the repaint could detach it');
});

/* ---------------------------------------------------------------------------
 * answer-panel: the agent page's own thread, its composer, and the buttons
 * above it. Text pins only -- these catch a DELETION, not a rendering. The
 * render itself is checked by `docs/browser-checks/render-talk.js`, which draws
 * every state this branch defines in both themes and measures in the page
 * (the count is deliberately not quoted here: it said "eight" while the file
 * drew eleven and then thirteen, which is one moving fact written in two
 * places, and this directory's own README explains why not to) (scrollWidth/clientWidth for overflow, computed
 * background for the transparent-panel class, elementFromPoint for what is
 * actually on top). Checks were green through three broken layouts on 18e;
 * text cannot see that class of defect and these do not claim to.
 * ------------------------------------------------------------------------ */

test('the option button carries BOTH the digit and the words, and sends both', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  // The button holds the two facts apart...
  assert.match(raw, /data-n="' \+ esc\(String\(o\.n\)\)/,
    'the option button lost the digit the agent’s prompt is waiting for');
  assert.match(raw, /data-label="' \+ esc\(o\.label\)/,
    'the option button lost the option’s own words');
  // ...and the send passes both, in that order: text=digit, chose=words.
  assert.match(raw, /sendTalk\(btn\.dataset\.n, btn\.dataset\.label\)/,
    'the option send stopped carrying one of the two, so the record misdescribes '
    + 'either the mechanism or the answer');
});

test('the option listener is DELEGATED, because the buttons are rebuilt by every poll', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = raw.indexOf("getElementById('d-qopts').addEventListener('click'");
  assert.ok(at > -1, 'the option buttons lost their listener, or it moved onto the buttons '
    + 'themselves -- where it is attached to elements the next poll destroys');
  assert.ok(raw.slice(at, at + 300).includes("closest('.qopt')"),
    'the delegated listener stopped matching the button it is delegating for');
});

test('talkKey reads the option run exactly where optionsIn does, decoys included', () => {
  /**
   * ⚠️ TWO DERIVATIONS OF ONE FACT, and the engine is not reachable from the
   * page, so the page carries a COPY of `optionsIn`'s line handling. A copy
   * that is nearly the same is the dangerous kind: four separate drifts have
   * been found in it, and every one could only disagree DOWNWARD -- matching a
   * line the engine refuses, moving `first` up, and shortening the `above`
   * that gives the answered-hold its identity. A shorter `above` is how two
   * different questions collide on one key and a live question is suppressed.
   *
   * So this asks BOTH sides about the same text: the engine must see exactly
   * the real menu, and the page must leave every decoy in `above`.
   */
  const talkKey = pageFunction('talkKey');
  const chatEngine = require('./engine/chat');
  const MENU = '❯ 1. Yes\n  2. No';
  const above = (text) => {
    const key = talkKey({
      asking: true,
      options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }],
      question: { text },
    });
    assert.ok(key, 'talkKey refused a body it should key');
    return key.split('\u0000')[1];
  };

  /* ⚠️ AND WHEN THE RUN STARTS AT LINE 0. A short capture leaves nothing above
     the menu, and an empty `above` keys the hold on the OPTIONS ALONE --
     which is the collision this key exists to prevent, because the
     edit-permission menu draws the same labels for every file. Two different
     questions, same buttons, no preamble: the keys must still differ. */
  const menuFirstA = talkKey({
    asking: true,
    options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }],
    question: { text: MENU + '\nEdit src/a.js?' },
  });
  const menuFirstB = talkKey({
    asking: true,
    options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }],
    question: { text: MENU + '\nEdit src/b.js?' },
  });
  assert.ok(menuFirstA && menuFirstB, 'talkKey refused a body it should key');
  assert.notEqual(menuFirstA, menuFirstB,
    'two different questions with identical buttons collapsed to one key, so the second is suppressed');

  // CONTROL: with no decoy at all, `above` is the preamble and the menu is not
  // in it. Without this the decoy cases below pass on a function that returns
  // the whole capture every time.
  const plain = above('Which one?\n' + MENU);
  assert.equal(plain, 'Which one?');

  /* ⚠️ AND THE `above` HALF AGREES WITH THE ENGINE'S TWIN, which is now a
     THIRD place this one fact is computed: `talkKey` on the page, and
     `chat.questionAbove` on the server, which the 409 screen-check compares
     against what the client sends. Two spellings of "which question is this"
     that can disagree is how a button answers a prompt nobody saw, so they are
     asked the same thing here rather than trusted to match. */
  const engineAbove = chatEngine.questionAbove;
  for (const text of [
    'Which one?\n' + MENU,
    'Edit file src/a.js?\n❯ 1. Yes\n  2. No',
    '│ boxed and framed\n│ ❯ 1. Yes\n│   2. No',
    MENU,
  ]) {
    const key = talkKey({
      asking: true,
      options: chatEngine.optionsIn(text),
      question: { text },
    });
    assert.ok(key, 'talkKey refused a body the engine parses: ' + JSON.stringify(text));
    /* `slice(1).join`, not `[1]`: an identity containing the separator would be
       truncated by the index form, which is the correction `sendTalk` already
       carries and this test did not. */
    const pageAbove = key.split('\u0000').slice(1).join('\u0000');
    const engine = engineAbove(text);
    if (engine === null) {
      /* ⚠️ THE DELIBERATE DIVERGENCE, asserted rather than skipped. When the
         rule yields nothing the engine refuses to guess (a wrong match types a
         digit into a live terminal) and the page falls back to the whole slice
         (a wrong match suppresses a question for thirty seconds). */
      assert.ok(pageAbove, 'the page must still key something when the engine declines to');
    } else {
      assert.equal(pageAbove, engine,
        'the page and the engine disagree about which question this is: ' + JSON.stringify(text));
    }
  }

  for (const decoy of [
    '10. leftover from the last prompt',   // two digits: never an option
    '││ 1. doubled frame',                 // a RUN of frame characters
    '│ 1. │',                              // a label that is only frame
    '| 1. see the lease',                  // an ASCII pipe is not frame
  ]) {
    const text = 'Which one?\n' + decoy + '\n' + MENU;
    // The ENGINE's half: the decoy produces no option, so the menu it parses
    // is the two real ones.
    const parsed = chatEngine.optionsIn(text);
    assert.deepEqual(parsed, [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }],
      'the engine read the decoy as part of the menu: ' + JSON.stringify(decoy));
    // The PAGE's half: the decoy is above the run, so it stays in the identity.
    assert.ok(above(text).includes(decoy),
      'the page started the run at the decoy, shortening the hold\u2019s identity: '
      + JSON.stringify(decoy) + ' -> ' + JSON.stringify(above(text)));
  }
});

test('--k-sunk is DEFINED, in both themes, not merely defended with a fallback', () => {
  // ⚠️ THE DEFECT THIS PINS was found in Mona Lisa's drawings on 2026-08-19:
  // the pack writes `var(--k-sunk, rgba(20,22,26,.05))` everywhere and defines
  // the token NOWHERE. On a background that fails INVISIBLY (transparent); on
  // an SVG fill it fails LOUDLY (undefined resolves to black). The invisible
  // instances are what let three drawings pass while the token was dead.
  //
  // Here it decides the QUESTION BOX. (An earlier version of this comment said
  // "and every message bubble", which is false: `.dm.mine .dm-b` overrides it
  // and `dmRow` emits `dm mine` unconditionally, as the rule's own note in the
  // stylesheet says.) The light fallback on the dark ground is a 5%-black wash
  // on #17191c, which is not a sunk panel, it is a missing one. So the token is
  // defined per theme.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  /* ⚠️ SCOPED PER THEME, because "defined twice" is not what this test's own
     name claims. A whole-file count is satisfied by two declarations sitting
     in the SAME `:root` -- one shadowing the other -- while the dark block has
     none at all, which is precisely the defect being pinned. So the file is
     cut at the first dark media block and each side is asked separately.
     ⚠️ AND THE VALUES, NOT THE DECLARATION TEXT: comparing the matched strings
     compares their indentation too, so the old form passed on spacing alone
     and would have kept passing with both themes set to the same colour. */
  const valuesIn = (text) => (text.match(/--k-sunk:\s*([^;]+);/g) || [])
    .map((d) => d.replace(/^--k-sunk:\s*/, '').replace(/;$/, '').trim());
  const darkAt = raw.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(darkAt > 0, 'CONTROL: no dark media block in the page at all, so this test cannot mean anything');
  const light = valuesIn(raw.slice(0, darkAt));
  const dark = valuesIn(raw.slice(darkAt));
  assert.equal(light.length, 1,
    `--k-sunk is defined ${light.length} time(s) before the first dark block; the light theme needs exactly one`);
  assert.ok(dark.length >= 1,
    'the dark theme defines no --k-sunk at all, so its question box wears a 5%-black wash on #17191c: '
    + 'not a sunk panel, a missing one');
  assert.notEqual(light[0], dark[0],
    `both --k-sunk definitions are the same value (${light[0]}), so one theme is wearing the other’s wash`);
});

test('a composer that cannot send looks like it cannot send', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = raw.indexOf('.dmbar .btn[disabled]');
  assert.ok(at > -1, 'the disabled composer lost its dimming, so a Send that cannot send '
    + 'renders identically to one that can -- under a sentence saying the agent cannot '
    + 'be handed a message');
  const rule = raw.slice(at, raw.indexOf('}', at));
  assert.ok(/opacity:\s*\.5/.test(rule), 'the dimming is no longer dimming anything');
});

test('the buttons die with the composer: an option is never offered over a closed box', () => {
  // Mona Lisa's state 6. A live option above a box that cannot send promises a
  // route that is shut, which is the same lie as a composer that swallows text.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  // ⚠️ The GATE's terms, not the whole expression: pinning the line verbatim
  // made this test fail the next time a term was ADDED to it, which is the
  // check-contains-a-copy shape — it can only pass against one spelling and
  // says nothing about the property.
  const at = raw.indexOf('const opts = ');
  assert.ok(at > -1, 'the options gate vanished');
  const gate = raw.slice(at, raw.indexOf(';', at));
  assert.ok(/\blive\b/.test(gate), 'the options stopped being gated on the agent being reachable');
  assert.ok(/body\.asking/.test(gate), 'the options stopped being gated on the board saying it is asking');
  assert.match(raw, /const live = body\.presence === 'on';/,
    'the reachability the options are gated on stopped being the route’s own answer');
});

test('the agent page composer holds the room’s IME rule, because Enter sends', () => {
  // Without it the Enter that CONFIRMS a Japanese, Chinese or Korean candidate
  // sends the first word half-composed, every time.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = raw.indexOf("getElementById('d-say').addEventListener('keydown'");
  assert.ok(at > -1, 'the agent page composer lost its keydown handler');
  const body = raw.slice(at, at + 700);
  assert.ok(body.includes('e.isComposing') && body.includes('229'),
    'the IME guard is gone from the agent page’s composer (the room still has it, '
    + 'so the two boxes now behave differently for the same keystroke)');
});

test('a parsed role is sentence-cased and an acronym survives it', () => {
  // ⚠️ TWO KINDS OF VALUE IN ONE SLOT. `profile.role` is a label chosen off a
  // menu and carries its own capitals; `a.role` is a line parsed out of the
  // agent's instruction file, which is arbitrary lower-case prose. Measured
  // when this landed: 14 agents on the dev machine, ZERO with a profile role,
  // all 14 falling back. So the fallback is the board, not an edge case.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = raw.indexOf('function roleLine(a)');
  assert.ok(at > -1, 'roleLine moved; re-point this test');
  // eslint-disable-next-line no-new-func
  const roleLine = new Function(raw.slice(at, raw.indexOf('\n}\n', at) + 3) + '\nreturn roleLine;')();

  assert.equal(roleLine({ role: 'web-properties worker' }), 'Web-properties worker');
  assert.equal(roleLine({ role: 'executive assistant' }), 'Executive assistant');
  // ⚠️ THE ACRONYM IS THE REASON THIS IS NOT TITLE CASE. Title case turns
  // "SEO specialist" into "Seo Specialist", which is the exact problem whose
  // carve-out this branch deleted from the create heading; a transform here
  // would bring that carve-out back with it.
  assert.equal(roleLine({ role: 'SEO specialist' }), 'SEO specialist');
  // A chosen label is never touched: it already carries its own capitals.
  assert.equal(roleLine({ profile: { role: 'Executive Assistant' }, role: 'prose' }), 'Executive Assistant');
  assert.equal(roleLine({}), '', 'and nothing invents a role for an agent with none');
});

/**
 * The Runs on line's three states, and the one the server test cannot reach.
 *
 * ⚠️ THIS EXISTS BECAUSE A MUTATION SURVIVED. Letting the server consult the
 * job file even when a live model was read passed every test in this suite: the
 * positive control over there runs with NO live model, so it never exercises
 * which of the two wins. The precedence is a claim the code comments make, and
 * a claim nothing can fail is not a tested one.
 *
 * It is pinned HERE rather than on the route because this is where it becomes
 * visible: whatever the payload carries, what a person reads is what this
 * function returns.
 */
test('the Runs on line says which tense it is in, and a live model always wins', () => {
  const tables = pageFnSource('modelLine') + '\n' + pageConstSource('CARD_ST') + '\n' + pageFnSource('cardStOf');
  const runsOnLine = pageFunction('runsOnLine', tables);
  // The REAL cardStOf, so the coherence check below compares the product's two
  // answers rather than one product answer and one restatement.
  const cardStOf = pageFunction('cardStOf', pageConstSource('CARD_ST'));

  assert.deepEqual(runsOnLine({ modelName: 'Claude Sonnet 5', state: 'working' }),
    { lead: 'Right now: ', name: 'Claude Sonnet 5' },
    'a running agent stopped saying it is running');

  // ⚠️ THE THIRD FALSE TENSE, and the one the suite could not see. `readModel`
  // reads a TRANSCRIPT, not a process, so a STOPPED agent that has ever run
  // still has a model — and this said "Right now: Claude Opus 5" beside a card
  // badge reading "Not running". Every earlier version of this test passed
  // `modelName` with `state` ABSENT, which is a state the product never
  // produces, so the case was invisible rather than passing.
  // ⚠️ A STOPPED AGENT'S FUTURE COMES FROM ITS JOB, NOT ITS TRANSCRIPT. The
  // transcript says what it RAN as, in a session that has ended; only the
  // launchd job says what it will START on, and the two can differ.
  assert.deepEqual(runsOnLine({ modelName: 'Claude Haiku 4.5', plannedModelName: 'Claude Opus 5', state: 'stopped' }),
    { lead: 'Will start on ', name: 'Claude Opus 5' },
    'a stopped agent was told it will start on the model it last RAN on, rather '
    + 'than the one its job actually carries');

  // ⚠️ AND WHEN THE JOB SAYS NOTHING, NO FUTURE IS CLAIMED. Every agent created
  // before the model picker existed has a job with no --model argument, so
  // `plannedModelArg` answers null = "we do not know". Stating a specific
  // future model there would invent one out of a past reading.
  assert.deepEqual(runsOnLine({ modelName: 'Claude Opus 5', state: 'stopped' }),
    { lead: '', name: 'Claude Opus 5' },
    'a stopped agent whose job carries no model still made a future-tense claim');

  // ⚠️ THE TENSE FOLLOWS `pres`, WHICH HAS THREE VALUES, NOT TWO. Every state
  // whose presence reads `on` keeps the present tense when a live model was
  // read; `unknown` reads `unsure` and gets NO tense, because a panel saying
  // "Right now: Claude Opus 5" beside a badge reading "Can't tell" is the same
  // contradiction as the three this function already produced.
  for (const state of ['working', 'idle', 'needs_you', 'rate_limited']) {
    assert.equal(runsOnLine({ modelName: 'Claude Opus 5', state }).lead, 'Right now: ',
      `a ${state} agent with a readable model stopped saying it is running`);
  }
  assert.equal(runsOnLine({ modelName: 'Claude Opus 5', state: 'unknown' }).lead, '',
    'a pane we could not classify was described in the present tense anyway, '
    + 'contradicting the badge beside it');

  // ⚠️ COHERENCE: the lead and the badge must never disagree, because they are
  // one fact. Driven across EVERY state the engine can emit plus an
  // unrecognised one, asserting the pairing rather than each half. This is the
  // check that would have caught all three of this function's false tenses.
  for (const state of ['working', 'idle', 'needs_you', 'rate_limited', 'stopped', 'unknown', 'martian']) {
    // Carries BOTH readings, so the `off` arm has a job to quote.
    const lead = runsOnLine({ modelName: 'Claude Opus 5', plannedModelName: 'Claude Opus 5', state }).lead;
    const pres = cardStOf({ state }).pres;
    const want = pres === 'on' ? 'Right now: ' : pres === 'off' ? 'Will start on ' : '';
    assert.equal(lead, want,
      `the Runs on lead and the presence dot disagree for state "${state}": the `
      + `dot says ${pres} and the line says ${JSON.stringify(lead)}`);
  }

  assert.deepEqual(runsOnLine({ modelName: null, plannedModelName: 'Claude Sonnet 5', state: 'stopped' }),
    { lead: 'Will start on ', name: 'Claude Sonnet 5' },
    'a created-but-never-run agent did not say what it will start on, which is '
    + 'the whole defect Josh reported');

  // ⚠️ THE MIRROR OF THAT BUG, and the reason the future tense is keyed on
  // `state` rather than on "we could not read a model". `readModel` returns
  // null whenever there is no transcript, and an agent in its FIRST, CURRENTLY
  // ACTIVE session has none yet. Gated on `!modelName`, a running agent was
  // told "Will start on Claude Opus 5" while it was running on it.
  for (const state of ['working', 'idle', 'needs_you', 'rate_limited', 'unknown']) {
    const r = runsOnLine({ modelName: null, plannedModelName: 'Claude Opus 5', state });
    assert.equal(r.lead, '',
      `a ${state} agent was described in the future tense; it is running now, we `
      + 'just could not read what on');
    assert.equal(r.name, 'Claude Opus 5',
      'the name we do hold was dropped along with the tense');
  }

  // ⚠️ NO LEAD, not "Right now". Nothing is running in this case either, so a
  // present tense is exactly as false here as it was on a planned model.
  assert.deepEqual(runsOnLine({ state: 'unknown' }), { lead: '', name: 'Unknown Model' },
    'an unknowable model asserted a present tense about an agent that may '
    + 'never have started');

  // ⚠️ THE CONTROL THE ROUTE CANNOT PROVIDE. A job file can be edited by hand
  // after an agent starts, so the two sources can disagree; the live reading is
  // what the agent IS running and must win. Both wrong answers are named, so
  // this cannot pass by returning the right string for the wrong reason.
  // ⚠️ `state` ON EVERY FIXTURE from here down. A card carrying a model with no
  // state is a shape the product never emits, and fixtures that cannot occur
  // are how all three of this function's false tenses stayed invisible.
  const both = runsOnLine({ modelName: 'Claude Opus 5', plannedModelName: 'Claude Haiku 4.5', state: 'working' });
  assert.equal(both.name, 'Claude Opus 5',
    'the job file overruled the model the agent is demonstrably running');
  assert.equal(both.lead, 'Right now: ',
    'a running agent was described in the future tense');

  // The provider prefix reaches the planned name too, or the same model reads
  // two different ways depending on which source answered.
  assert.equal(runsOnLine({ plannedModelName: 'Opus 5', state: 'stopped' }).name, 'Claude Opus 5');
  assert.equal(runsOnLine({ plannedModelName: 'Claude Opus 5', state: 'stopped' }).name, 'Claude Opus 5',
    'the guard against "Claude Claude" did not reach the planned branch');
});

/**
 * A top-level tab click lands at the top of that section.
 *
 * Josh: "if I'm somewhere on some other page and I hit a top-level page (like
 * Projects), it'll jump me back inside of whatever project I was previously in
 * … If I click Agents it should take me back to the main Agents top-level
 * page. Same with Projects."
 *
 * ⚠️ THE CONTROL IS THE OTHER HALF OF THE FEATURE, not decoration. `showTab`
 * restores `PJ_CURRENT` on purpose, because the "which projects is this agent
 * on" flow calls `showTab('projects')` in order to land INSIDE one. A reset
 * that fired on every arrival would break that flow while every assertion about
 * the tab click still passed.
 */
test('a Projects tab click forgets the project you were in, and nothing else does', () => {
  const make = (current) => new Function(
    `let PJ_CURRENT = ${JSON.stringify(current)}; let closed = 0;\n`
    + 'function pjCloseConfirm() { closed += 1; }\n'
    + pageFnSource('topLevelReset')
    + '\nreturn { topLevelReset, get current() { return PJ_CURRENT; },'
    + ' get closed() { return closed; } };')();

  const proj = make('proj-7');
  proj.topLevelReset('projects');
  assert.equal(proj.current, null,
    'clicking Projects left you inside the project you last opened');
  assert.equal(proj.closed, 1,
    'arriving by the tab left a confirmation open that arriving by Back closes');

  // ⚠️ EVERY OTHER TAB LEAVES IT ALONE. Without this, `topLevelReset` could
  // clear unconditionally and the test above would still pass, taking the
  // agent-to-project flow with it.
  for (const tab of ['agents', 'settings', 'detail', 'create']) {
    const other = make('proj-7');
    other.topLevelReset(tab);
    assert.equal(other.current, 'proj-7',
      `the ${tab} tab cleared the project the agent-to-project flow needs kept`);
    assert.equal(other.closed, 0, `the ${tab} tab closed a projects confirmation`);
  }
});

/**
 * ⚠️ AND THE WIRING, because the function above is inert if nothing calls it.
 * A passing unit test on a function no handler invokes is the shape that let a
 * removed Back button take every listener after it down with it earlier today.
 */
test('the tab click handler actually calls the top-level reset, before showTab', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const at = script.indexOf("getElementById('tabs').addEventListener");
  assert.ok(at > -1, 'the tab click handler vanished from the page');
  const body = script.slice(at, at + 1600);
  const reset = body.indexOf('topLevelReset(btn.dataset.tab)');
  const show = body.indexOf('showTab(btn.dataset.tab)');
  assert.ok(reset > -1, 'the tab handler no longer resets to the top of the section');
  assert.ok(show > -1, 'the tab handler no longer changes tab');
  assert.ok(reset < show,
    'the reset runs AFTER showTab, so showTab still painted the old project '
    + 'before it was forgotten');
});

/**
 * The compact surfaces name the model with no tense attached.
 *
 * ⚠️ THE PAIR THAT MATTERS: `modelLine` must accept a planned model, and
 * `runsOnLine` must still put the right LEAD on it. Testing either alone lets
 * the other regress — a modelLine that ignored the planned name would leave
 * three cards saying "Unknown Model" about an agent whose model we hold, and a
 * runsOnLine reading modelLine's fallback directly would print "Right now"
 * about an agent that has never started.
 */
test('a card names a planned model plainly, while the detail panel keeps its tense', () => {
  const tbl = pageConstSource('CARD_ST') + '\n' + pageFnSource('cardStOf');
  const modelLine = pageFunction('modelLine', tbl);
  const runsOnLine = pageFunction('runsOnLine', pageFnSource('modelLine') + '\n' + tbl);

  assert.equal(modelLine({ plannedModelName: 'Claude Sonnet 5' }), 'Claude Sonnet 5',
    'a card said "Unknown Model" about an agent whose model is in its own job file');
  assert.equal(modelLine({ modelName: 'Claude Opus 5', plannedModelName: 'Claude Haiku 4.5' }),
    'Claude Opus 5', 'a job file overruled the model the agent is running');
  assert.equal(modelLine({}), 'Unknown Model',
    'a genuinely unknown model stopped saying so');
  assert.equal(modelLine({ plannedModelName: 'Opus 5' }), 'Claude Opus 5',
    'the provider prefix did not reach the planned name');

  // ⚠️ The detail panel must NOT inherit the flattening: same card, and it
  // still has to say which tense it is in.
  assert.deepEqual(runsOnLine({ plannedModelName: 'Claude Sonnet 5', state: 'stopped' }),
    { lead: 'Will start on ', name: 'Claude Sonnet 5' },
    'the detail panel lost its tense when modelLine gained the fallback');
});

/**
 * The detail page's box order, pinned.
 *
 * ⚠️ THIS IS A GUARD, NOT A RE-VERIFICATION. The order was checked by rendering
 * the page and sorting the boxes by geometry, which proved it correct on one
 * afternoon and proves nothing afterwards: a verification is a timestamp. The
 * next person to insert a `.dbox` shifts every pair below it silently, and this
 * exact order is the thing Josh reported as wrong.
 *
 * ⚠️ SOURCE ORDER IS THE RIGHT THING TO PIN HERE even though it is NOT the
 * reading order. `.dgrid` is two columns, so the rendered sequence is the source
 * sequence read in pairs — a stable function of it. Pinning source order pins
 * reading order for as long as the grid stays two-wide, and a change to the
 * column count is exactly the kind of change that should have to come here and
 * say so.
 */
test('the agent detail boxes stay in the order Josh asked for', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const panel = raw.slice(raw.indexOf('<section class="detail" id="panel-detail"'));
  const grid = panel.slice(panel.indexOf('<div class="dgrid">'));
  const labels = [...grid.matchAll(/<section class="dbox"[^>]*>[\s\S]*?<(?:h3 class="dlab"[^>]*|label class="flabel"[^>]*)>([^<]+)</g)]
    .map((m) => m[1].trim());
  assert.deepEqual(labels.slice(0, 4), ['Runs on', 'Memory', 'Conversation', 'Instructions'],
    'the detail boxes moved. Two columns means these four render as '
    + 'Runs on | Memory then Conversation | Instructions, which is what Josh '
    + 'asked for and what the pack draws');
  // ⚠️ The control: if the extraction silently matched nothing, slice(0,4) would
  // be [] and deepEqual against a 4-element array would fail — but if it matched
  // the WRONG four (a different grid on the page) it would not. Anchor it.
  assert.ok(labels.length >= 5,
    'the box extraction found fewer sections than the panel has, so it is '
    + 'reading the wrong markup and the assertion above is meaningless');
});

/**
 * The detail header's badge is the CARD's badge, and the task sits beside it.
 *
 * ⚠️ THIS HAD NO TEST AT ALL. The stated point of the change is that the panel
 * reads `cardStOf` / `GLYPH` / `STATE_COPY` instead of keeping a second copy of
 * them — and a regression to the old `copy.label + (a.task ? ': ' + a.task : '')`
 * passed all 919 other tests, because nothing looked at this.
 *
 * ⚠️ The three tables are read OUT OF THE PAGE rather than restated here. A stub
 * would let the panel and the card drift apart, which is the exact thing under
 * test: restating them would make this pass while they disagreed on screen.
 */
test('the detail badge reads the card’s own derivations, and the task is a separate element', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];

  const tablesFrom = script.indexOf('const STATE_COPY = {');
  const cardStAt = script.indexOf('function cardStOf(a)');
  assert.ok(tablesFrom > -1 && cardStAt > tablesFrom, 'the shared state tables moved');
  const tables = script.slice(tablesFrom, script.indexOf('\n', cardStAt) + 1);

  const dmAt = script.indexOf('  const dm = cardStOf(a);');
  assert.ok(dmAt > -1,
    'the detail badge no longer derives its state from cardStOf, so the panel '
    + 'and the card can disagree about what an agent is doing');
  // `copy` is declared just above the badge lines. Searched BACKWARDS from the
  // badge rather than forwards from the top: `card()` declares a `copy` of its
  // own earlier in the file, and a forward search finds that one.
  const from = script.lastIndexOf('  const copy = STATE_COPY[a.state]', dmAt);
  assert.ok(from > -1 && from < dmAt, 'the state copy lookup moved away from the badge');
  const TAIL = 'dtask.hidden = !dtask.textContent;';
  const end = script.indexOf(TAIL, from);
  assert.ok(end > from, 'the detail task line vanished');
  const body = script.slice(from, end + TAIL.length);

  const els = {};
  const doc = {
    getElementById: (id) => {
      if (!els[id]) els[id] = { className: '', innerHTML: '', textContent: '', hidden: false };
      return els[id];
    },
  };
  const drive = (card) => {
    for (const k of Object.keys(els)) delete els[k];
    // eslint-disable-next-line no-new-func
    new Function('document', 'a', 'esc', `${tables}\n${body}`)(doc, card, (x) => String(x));
    return { state: els['d-state'], task: els['d-task'] };
  };

  const needs = drive({ state: 'needs_you', task: 'Mac' });
  assert.match(needs.state.className, /\bastate\b/,
    'the detail state is not rendered as the card badge');
  assert.match(needs.state.className, /\bst-attn\b/,
    'the badge class does not track the state, so its colour cannot');
  assert.match(needs.state.innerHTML, /Needs you/, 'the badge lost its word');
  assert.equal(needs.task.textContent, 'Mac', 'the task did not reach its own element');
  assert.equal(needs.task.hidden, false, 'a real task was hidden');
  // ⚠️ The regression this change exists to prevent: the badge must NOT swallow
  // the task. "Needs you: Mac" as one string is what Josh marked up.
  assert.doesNotMatch(needs.state.innerHTML, /Mac/,
    'the badge swallowed the task again, so the state and the thing it is about '
    + 'are one unstyleable run');

  const working = drive({ state: 'working', task: 'Building the campaign calendar' });
  assert.match(working.state.className, /\bst-working\b/);
  assert.match(working.state.innerHTML, /Working/);

  // ⚠️ CONTROL: no task means no line, not an empty one. Without this, a task
  // element that never hides would satisfy every assertion above.
  const idle = drive({ state: 'idle' });
  assert.match(idle.state.className, /\bst-idle\b/);
  assert.equal(idle.task.hidden, true, 'an agent with no task showed an empty task line');

  // ⚠️ An unrecognised state must still draw a badge, by the same rule the card
  // holds: cardStOf maps anything it does not know to the unknown treatment.
  const martian = drive({ state: 'martian' });
  assert.match(martian.state.className, /\bst-unknown\b/,
    'an unrecognised state drew no badge treatment at all');
});

/**
 * "No agents have been removed" and "we could not ask" are different screens.
 *
 * ⚠️ Every failure arm of `paintRemoved` returns without touching the section,
 * which is correct on a POLL — emptying a drawn list because one request failed
 * would tell somebody their removed agents are gone. But `#removed-wrap` starts
 * `hidden` in the markup, so on the FIRST load "leave what is on screen alone"
 * leaves nothing on screen, and the honest fix for the poll was the same
 * inversion one moment earlier.
 *
 * ⚠️ This section is the way back from a removal, and the Remove confirmation is
 * deliberately light BECAUSE removal is recoverable. A way back that can be
 * invisible for a reason other than "there is nothing to go back to" turns that
 * confirmation into a trapdoor.
 */
test('a removed-agents section that could not be read says so, and only before it has ever been read', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  // The sentence is read out of the page, not restated here: the retraction
  // below compares against it exactly, and a test carrying its own copy could
  // not catch the two drifting apart.
  const sayAt = script.indexOf('const REMOVED_UNREADABLE_SAY');
  assert.ok(sayAt > -1, 'the could-not-check sentence lost its sentinel');
  const saySrc = script.slice(sayAt, script.indexOf(';', script.indexOf("having been.'", sayAt)) + 1);
  const src = saySrc + '\n' + pageFnSource('removedUnreadable');
  const make = (everRead, existing, onBoard = true) => {
    const msg = { textContent: existing || '' };
    // eslint-disable-next-line no-new-func
    const fn = new Function('document', 'REMOVED_EVER_READ', 'onAgentsTab',
      src + '\nreturn removedUnreadable;')({ getElementById: () => msg }, everRead, () => onBoard);
    fn();
    return msg.textContent;
  };
  // eslint-disable-next-line no-new-func
  const SAY = new Function(saySrc + '\nreturn REMOVED_UNREADABLE_SAY;')();

  assert.match(make(false, ''), /could not check/,
    'a first load that could not reach /api/removed showed the same empty screen '
    + 'as a machine with nothing removed');
  assert.match(make(false, ''), /not the same as none having been/,
    'the sentence states the absence without distinguishing the two causes');

  // ⚠️ CONTROL ONE: once an answer has arrived, absence is measured, not
  // unknown — and a later failed poll must not overwrite a correct list.
  assert.equal(make(true, ''), '',
    'a failed poll spoke over a section that had already been read successfully');

  // ⚠️ CONTROL TWO: it must not clobber a message already on that surface.
  // `#removed-msg` is where a partial removal reports what it could not reach,
  // and that is the more specific fact.
  assert.equal(make(false, 'Kosmos could not stop it.'), 'Kosmos could not stop it.',
    'the could-not-check line overwrote a more specific message about a removal');

  // ⚠️ CONTROL THREE: not while the person is somewhere else. This is called
  // from paintRemoved's failure arms BEFORE its own onAgentsTab() gate, and
  // paintRemoved runs unawaited — so a request in flight when someone switches
  // to Settings would otherwise write this sentence onto a screen that shows no
  // removed-agents list, on the one element that lives outside every panel and
  // is only cleared on the way OUT of the board.
  assert.equal(make(false, '', false), '',
    'the could-not-check line leaked onto another tab, describing a list that '
    + 'screen does not show');

  /**
   * ⚠️ AND IT MUST COME DOWN when a read finally succeeds. It was written on a
   * first-load failure and never retracted, so one transient failure left "we
   * could not check" standing indefinitely UNDER a correctly painted list — the
   * same could-not-look versus is-not-there inversion, pointed the other way.
   * ⚠️ The previous test asserted only that the sentence is not written TWICE.
   * That passes with the defect live: silence on the second call is not the same
   * as taking the first one down.
   */
  const script2 = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)[1];
  const at = script2.indexOf('REMOVED_EVER_READ = true;');
  assert.ok(at > -1, 'the success path lost its ever-read flag');
  const retraction = script2.slice(at, at + 900);
  assert.match(retraction, /removed-msg/,
    'the success path never touches #removed-msg, so a stale "we could not '
    + 'check" sentence outlives the answer that disproves it');
  assert.match(retraction, /REMOVED_UNREADABLE_SAY/,
    'the retraction does not compare against the sentinel, so it either clears '
    + 'the wrong message or fails to recognise its own');

  // ⚠️ AND ONLY OURS. #removed-msg also carries what a partial removal could not
  // reach, which is the more specific fact and must survive a later success.
  const clearOurs = new Function('text', 'SAY',
    'const stale = { textContent: text };'
    + 'if (stale && stale.textContent === SAY) stale.textContent = "";'
    + 'return stale.textContent;');
  assert.equal(clearOurs(SAY, SAY), '', 'the retraction did not recognise its own sentence');
  assert.equal(clearOurs('Kosmos could not stop it.', SAY), 'Kosmos could not stop it.',
    'the retraction cleared a partial-removal message that had nothing to do with it');
});

/**
 * No declaration sits outside a selector.
 *
 * ⚠️ A REAL BLOCKER THIS BRANCH SHIPPED AND ALMOST MERGED. Inserting an
 * `@media` block into the middle of `#firstrun {}` left `background:
 * var(--k-bg)` at the media block's TOP LEVEL — a parse error, silently
 * discarded, so the first screen anyone sees lost its background and fell
 * through to the page-surround colour.
 *
 * ⚠️ IT IS INVISIBLE TO EVERY OTHER INSTRUMENT HERE. The declaration is still
 * present in the file, so a text search finds it; the diff shows a plausible
 * brace move; the render check walks up from a field and stops at the first
 * opaque ancestor, never reaching the element that lost its paint. Only a
 * brace-aware scan sees it, and it is nine lines.
 */
test('every CSS declaration in the page sits inside a selector', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const style = raw.slice(raw.indexOf('<style>') + 7, raw.indexOf('</style>'));

  /**
   * ⚠️ ONE WALK, USED BY BOTH THE FILE SCAN AND THE CONTROL. The first version
   * hand-copied the algorithm into its control, so the control could not see the
   * scanner drift — and it did drift: the `@media` branch returned BEFORE
   * counting the braces on its own line, so every single-line
   * `@media (…) { .x { … } }` inflated the depth permanently. This stylesheet
   * has six of them, the walk ended at depth 6 instead of 0, and the flag
   * condition was unreachable after line 453. The guard written for the
   * orphaned-declaration blocker was silent over four fifths of the file,
   * including the region the blocker was in.
   *
   * A check containing a copy of the thing it checks cannot fail.
   */
  const scan = (css) => {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
    let depth = 0;
    let atRuleDepth = -1;
    const stray = [];
    src.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (!t) return;
      const opens = (t.match(/\{/g) || []).length;
      const closes = (t.match(/\}/g) || []).length;
      if (/^@[a-z-]+[^{]*\{/.test(t)) {
        atRuleDepth = depth;
        depth += opens - closes;      // ⚠️ NOT `depth += 1; return;`
        if (atRuleDepth >= 0 && depth <= atRuleDepth) atRuleDepth = -1;
        return;
      }
      // A declaration is `prop: value` with no brace on the line. Custom
      // properties contain digits (`--label-2`), which an earlier `[-a-z]+`
      // filter silently rejected — most of this stylesheet.
      if (!opens && !closes && /^-{0,2}[a-z][-a-z0-9]*\s*:/i.test(t)) {
        if (depth <= Math.max(atRuleDepth + 1, 0) && depth <= 1) {
          stray.push(`${i + 1}: ${t.slice(0, 60)}`);
        }
      }
      depth += opens - closes;
      if (atRuleDepth >= 0 && depth <= atRuleDepth) atRuleDepth = -1;
    });
    return { stray, depth };
  };

  const real = scan(style);
  // ⚠️ THE WALK MUST BALANCE. A drifting depth is how the first version went
  // silent, and it reported nothing while doing so — so the imbalance is
  // asserted directly rather than inferred from an empty result.
  assert.equal(real.depth, 0,
    `the brace walk ended at depth ${real.depth}, so it lost track of nesting and `
    + 'every verdict below it is over the wrong scope');
  assert.deepEqual(real.stray, [],
    'declaration(s) outside any selector — the browser discards these silently, '
    + 'so the rule they belonged to lost that property:\n  ' + real.stray.join('\n  '));

  // ⚠️ THE CONTROL, run through THE SAME `scan`. Two orphans: one ordinary
  // property and one custom property carrying a digit. And a single-line
  // `@media` above them, which is what defeated the first version.
  const broken = [
    '@media (max-width: 720px) { html { scroll-padding-top: 165px; } }',
    '#x {',
    '  color: red;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  #x { --a: 1; }',
    '  background: var(--k-bg);',
    '  --label-2: #4a4f57;',
    '}',
  ].join('\n');
  const ctl = scan(broken);
  assert.equal(ctl.depth, 0, 'the control fixture is unbalanced, so it tests the wrong thing');
  assert.deepEqual(ctl.stray.map((x) => x.split(': ').slice(1).join(': ')),
    ['background: var(--k-bg);', '--label-2: #4a4f57;'],
    'the scanner cannot see the defect it exists for, so its silence above '
    + 'proves nothing. If neither is found, a single-line @media has broken the '
    + 'depth count; if only the first, the property filter rejects custom '
    + 'properties containing a digit.');
});


/**
 * Every surface names the SAME model for one agent.
 *
 * ⚠️ THIS DISAGREEMENT HAS NOW BEEN OPENED TWICE BY CLOSING IT ONCE. The detail
 * meta line and the Runs on box disagreed; routing the meta line through
 * `runsOnLine` fixed that and opened a CARD-versus-meta gap instead, because
 * `card()` and `lrow()` still preferred the transcript while the panel preferred
 * the job. The card said one model and the page you reached by clicking it said
 * another.
 *
 * ⚠️ The fixture carries BOTH readings, disagreeing, for a STOPPED agent —
 * exactly the state the server now populates on purpose. Every earlier test of
 * these functions passed one reading or the other, so no fixture could ever
 * expose a preference difference between them.
 */
test('the card, the list row and the detail meta line never name two different models', () => {
  const tables = pageFnSource('modelLine') + '\n' + pageConstSource('CARD_ST') + '\n' + pageFnSource('cardStOf');
  const modelLine = pageFunction('modelLine', pageConstSource('CARD_ST') + '\n' + pageFnSource('cardStOf'));
  const runsOnLine = pageFunction('runsOnLine', tables);

  // A stopped agent whose transcript and job disagree: it RAN as Haiku, its job
  // will START it on Opus.
  const stopped = { state: 'stopped', modelName: 'Claude Haiku 4.5', plannedModelName: 'Claude Opus 5' };
  assert.equal(modelLine(stopped), 'Claude Opus 5',
    'the card and list row name the model a stopped agent last RAN as, while the '
    + 'detail page names the one its job will start it on');
  assert.equal(runsOnLine(stopped).name, 'Claude Opus 5');
  assert.equal(modelLine(stopped), runsOnLine(stopped).name,
    'two surfaces name one agent’s model differently');

  // ⚠️ CONTROL: a RUNNING agent still prefers the live reading everywhere. If
  // the job simply won always, the assertions above would pass and the product
  // would report a stale job value over a measured one.
  const running = { state: 'working', modelName: 'Claude Haiku 4.5', plannedModelName: 'Claude Opus 5' };
  assert.equal(modelLine(running), 'Claude Haiku 4.5',
    'a running agent was described by its job file instead of what it is running');
  assert.equal(runsOnLine(running).name, 'Claude Haiku 4.5');

  // ⚠️ CONTROL: a stopped agent whose job says nothing keeps the transcript
  // reading rather than falling to "Unknown Model".
  const noJob = { state: 'stopped', modelName: 'Claude Haiku 4.5' };
  assert.equal(modelLine(noJob), 'Claude Haiku 4.5');
  assert.equal(runsOnLine(noJob).name, 'Claude Haiku 4.5');

  /**
   * ⚠️ EVERY STATE, not just `stopped`. Both functions answer "is this agent
   * running" and they used to answer it two ways — `modelLine` from the literal
   * `state === 'stopped'`, `runsOnLine` from `cardStOf(a).pres`. They agreed
   * only because `stopped` is currently the single CARD_ST entry mapping to
   * `pres: 'off'`; adding another would have split them, and a test that
   * exercises one state cannot see that.
   */
  const CARD_ST = new Function(pageConstSource('CARD_ST') + '\nreturn CARD_ST;')();
  for (const state of [...Object.keys(CARD_ST), 'martian']) {
    const both = { state, modelName: 'Claude Haiku 4.5', plannedModelName: 'Claude Opus 5' };
    assert.equal(modelLine(both), runsOnLine(both).name,
      `the card and the detail panel name different models for a "${state}" agent`);
  }
});

/**
 * No visible caption is contained in a hidden label beside it.
 *
 * ⚠️ THE PROPERTY THAT MAKES EVERY OTHER ASSERTION IN THIS AREA MEAN ANYTHING.
 * The unknown-memory badge said "Memory unknown" while the ring's `aria-label`
 * began "Memory unknown: …", so a test asserting the visible badge was satisfied
 * by the hidden label and stayed green with the badge deleted — and the browser
 * check passed a blank list cell for the same reason. The words were in the
 * markup twice for two audiences, and writing the short one as a PREFIX of the
 * long one is the most natural thing to do and the one thing that makes them
 * indistinguishable.
 *
 * ⚠️ CASE-INSENSITIVE ON PURPOSE. "Unknown" is not inside "Memory unknown" only
 * if you compare case-sensitively, and instruments get written both ways without
 * anyone deciding to. The strings are chosen to survive the stricter test so
 * this can be the obvious comparison rather than a subtle one.
 */
test('a visible caption is never a substring of the hidden text beside it', () => {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];

  // The pairs this rule exists for: a caption a person reads, and the hidden
  // sentence covering the same fact for a screen reader.
  const VISIBLE = ['Unknown'];
  const hidden = [];
  for (const m of script.matchAll(/aria-label="([^"]*)"/g)) hidden.push(m[1]);
  for (const m of script.matchAll(/class="vh"[^>]*>([^<]*)</g)) hidden.push(m[1]);
  for (const m of raw.matchAll(/class="vh"[^>]*>([^<]*)</g)) hidden.push(m[1]);
  // Template placeholders are not text a person or a screen reader ever hears.
  const real = hidden.map((h) => h.replace(/\$\{[^}]*\}/g, '').trim()).filter(Boolean);

  assert.ok(real.length >= 5,
    `only ${real.length} hidden strings found — the extraction is not reading the `
    + 'page, so the assertion below passes over almost nothing');

  const clashes = [];
  for (const v of VISIBLE) {
    for (const h of real) {
      if (h.toLowerCase().includes(v.toLowerCase())) clashes.push(`"${v}" is inside "${h}"`);
    }
  }
  assert.deepEqual(clashes, [],
    'a visible caption also appears in hidden text, so any check asserting the '
    + 'visible one can be satisfied by the hidden one and will pass with the '
    + 'visible element deleted:\n  ' + clashes.join('\n  '));

  // ⚠️ THE CONTROL. Fed the exact shape of the original defect, the comparison
  // must report it — otherwise the empty result above proves only that the
  // matcher never matches.
  const wouldClash = ['Memory unknown: we could not read how full it is.']
    .filter((h) => h.toLowerCase().includes('memory unknown'.toLowerCase()));
  assert.equal(wouldClash.length, 1,
    'the substring comparison cannot detect the defect it exists for');
});

/**
 * The client and the server answer "is this agent running" separately, and the
 * only thing keeping them in step is that `stopped` is the single `CARD_ST`
 * entry mapping to `pres: 'off'`.
 *
 * ⚠️ THEY CANNOT SHARE THE DERIVATION: `web/index.html` cannot import `STATE`
 * and `server.js` cannot import `CARD_ST`. So the coincidence is pinned here.
 * Add a second state mapping to `off` and the page would prefer the job's model
 * for it while `/api/status` never populated `plannedModelName`, so "Will start
 * on …" would silently stop appearing — a degradation with nothing to catch it.
 */
test('exactly one agent state means "not running", and both sides name the same one', () => {
  const CARD_ST = new Function(pageConstSource('CARD_ST') + '\nreturn CARD_ST;')();
  const off = Object.entries(CARD_ST).filter(([, v]) => v.pres === 'off').map(([k]) => k);
  assert.deepEqual(off, ['stopped'],
    'the client now treats ' + JSON.stringify(off) + ' as not-running, but '
    + 'server.js gates plannedModelName on `a.state !== STATE.STOPPED` alone. '
    + 'Either give the server the same set or share one derivation — as it '
    + 'stands the new state gets no plannedModelName and its "Will start on" '
    + 'line silently disappears');

  const status = require('./engine/status');
  assert.equal(status.STATE.STOPPED, 'stopped',
    'the server’s STATE.STOPPED and the client’s CARD_ST key have drifted apart');
});

/**
 * ⚠️ THE STOPPED-AGENT CLAUSE HAD NO ROUTE-LEVEL TEST. Both existing
 * `/api/status` tests run with no `modelName`, so the branch that says "a
 * stopped agent needs this EVEN THOUGH it has a modelName" was asserted only by
 * its own comment — and a mutation deleting `&& a.state !== STATE.STOPPED`
 * passed the whole suite.
 */
test('a stopped agent with a readable model still gets the model its job will start it on', async () => {
  const status = require('./engine/status');
  const create = require('./engine/create');
  // The JOB says Opus; the TRANSCRIPT says Haiku. Two readings that disagree,
  // which is the only shape that can tell the two branches apart.
  fs.writeFileSync(create.plistPath('fixturestopped'),
    create.plistFor('fixturestopped', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'), 'utf8');
  seedTranscript('fixturestopped', 'claude-haiku-4-5');
  // A pane whose Claude process is gone: `classify` returns STOPPED, and the
  // transcript (if any) is what it RAN as.
  // ⚠️ `command: 'zsh'` is what makes this STOPPED. `classify` decides it from
  // the pane's COMMAND (no Claude process), not from its text — the first
  // version of this fixture set the capture and got `unknown`, which the
  // precondition below caught. A fixture in a state the product never produces
  // proves nothing, and that is the failure this whole suite keeps finding.
  status.setPaneSource(() => fleet.line({ session: 'fixturestopped-discord', title: 'fixturestopped', command: 'zsh' }));
  status.setPaneCapture(() => '');
  try {
    const board = JSON.parse((await req('/api/status')).body);
    const card = (board.agents || []).find((a) => a.sessionName === 'fixturestopped');
    assert.ok(card, 'the fixture did not produce a card');
    assert.equal(card.state, 'stopped', 'the fixture is not exercising the stopped case');
    // ⚠️ THE PRECONDITION THAT MAKES THE ASSERTION BELOW MEAN ANYTHING. Without
    // a live model the clause `a.modelName && a.state !== STATE.STOPPED` is
    // never reached, and deleting it passes — which is exactly what happened the
    // first time this test was written.
    assert.equal(card.modelName, 'Claude Haiku 4.5',
      'the fixture has no live model, so the stopped-agent clause is not being '
      + 'exercised and this test would pass with it deleted');
    assert.equal(card.plannedModelName, 'Claude Opus 5',
      'a stopped agent was not given the model its job will start it on, so the '
      + 'panel would quote a transcript from a session that has ended');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
    fs.rmSync(create.plistPath('fixturestopped'), { force: true });
  }
});

/* ===========================================================================
   A PROJECT'S DOCUMENTS, AND OPENING ONE
   ---------------------------------------------------------------------------
   🛑 `open` LAUNCHES THINGS, so the route tests that matter here are the
   refusals, not the happy path. The engine's own gates are tested in
   engine/projects.test.js; these pin the HTTP surface around them.
   =========================================================================== */

test('the documents list reads, and opening one is a POST behind the cross-site guard', async () => {
  const projects = require('./engine/projects');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-docs-'));
  const away = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-docs-away-'));
  fs.writeFileSync(nodePath.join(dir, 'brief.md'), 'x');
  fs.writeFileSync(nodePath.join(away, 'secret.txt'), 'x');
  fs.symlinkSync(nodePath.join(away, 'secret.txt'), nodePath.join(dir, 'escape.txt'));

  const made = await req('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Docs Fixture', folder: dir, agents: [] }),
  });
  assert.equal(made.status, 200, 'the fixture project was not created');
  const id = JSON.parse(made.body).project.id;

  // --- the list ---
  const listed = await req('/api/project/' + encodeURIComponent(id) + '/documents');
  assert.equal(listed.status, 200);
  const list = JSON.parse(listed.body);
  assert.equal(list.ok, true);
  const names = list.files.map((f) => f.name);
  assert.ok(names.includes('brief.md'), 'CONTROL: the real file was not listed');
  assert.ok(!names.includes('escape.txt'), 'the list offered a symlink out of the project');

  // --- the list is read-only ---
  const posted = await req('/api/project/' + encodeURIComponent(id) + '/documents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(posted.status, 405);

  const calls = [];
  projects.setRevealRunner((file, args) => { calls.push([file, args]); return { ok: true }; });
  try {
    // --- 🛑 THE GUARD, and it is the reason this route is a POST at all. A
    //     page on another site must not be able to make this machine open a
    //     file by embedding a form.
    for (const [label, headers] of [
      ['a form content type', { 'content-type': 'text/plain' }],
      ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }],
      ['another site as its origin', { 'content-type': 'application/json', origin: 'https://evil.example' }],
      ['a sandboxed page', { 'content-type': 'application/json', origin: 'null' }],
    ]) {
      const res = await req('/api/project/' + encodeURIComponent(id) + '/open-file', {
        method: 'POST', headers, body: JSON.stringify({ name: 'brief.md' }),
      });
      assert.equal(res.status, 403, `${label}: the open was accepted`);
      assert.equal(calls.length, 0, `${label}: a file opened for a request from another website`);
    }

    // --- the escape, same-origin, still refused by the engine's third gate ---
    const escaped = await req('/api/project/' + encodeURIComponent(id) + '/open-file', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'escape.txt' }),
    });
    assert.equal(escaped.status, 409);
    assert.match(JSON.parse(escaped.body).error, /outside this project/);
    assert.equal(calls.length, 0, 'a symlink out of the project reached the opener');

    // --- CONTROL: the same runner, same route, a legitimate file. Without
    //     this every assertion above could be passing because nothing was
    //     ever wired up.
    const ok = await req('/api/project/' + encodeURIComponent(id) + '/open-file', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'brief.md' }),
    });
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1, 'the legitimate open never reached the opener');
    assert.equal(calls[0][1].length, 1, 'reveal-style -R leaked into the open path');
  } finally {
    projects.setRevealRunner(null);
  }
});

test('a project with no folder any more still answers the documents list, with a reason', async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-docs-gone-'));
  const made = await req('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Docs Gone', folder: dir, agents: [] }),
  });
  const id = JSON.parse(made.body).project.id;
  fs.rmSync(dir, { recursive: true, force: true });

  const listed = await req('/api/project/' + encodeURIComponent(id) + '/documents');
  // ⚠️ 200, NOT a 4xx. A missing folder is a state this screen must DRAW.
  // A 4xx would render as a failed request rather than as "we could not look",
  // and those are different sentences: one is about the project, one is about us.
  assert.equal(listed.status, 200);
  const body = JSON.parse(listed.body);
  assert.equal(body.ok, false);
  assert.ok(body.because && body.because.length > 0, 'no sentence explained the empty list');
  assert.deepEqual(body.files, []);
});

test('the documents list of a project that does not exist is a 404', async () => {
  const listed = await req('/api/project/no-such-project/documents');
  assert.equal(listed.status, 404);
});

/* ===========================================================================
   PATH CITATIONS IN MESSAGE BODIES
   ---------------------------------------------------------------------------
   🛑 THE ONLY PLACE IN THIS APP WHERE A MESSAGE BODY BECOMES MARKUP. Every
   test below exists because the previous line was `esc(m.text)` and nothing
   else, and the one thing that must survive this change is that a message can
   never inject anything.
   =========================================================================== */

test('a body with no citation is byte-for-byte what esc() produced before', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  const esc = pageFunction('esc');
  const names = new Set(['brief.md']);
  for (const body of [
    'nothing here',
    'a <b>bold</b> claim & an ampersand',
    '<script>alert(1)</script>',
    '"quotes" and \'apostrophes\'',
    'notes.mdx is not notes.md',
    '',
  ]) {
    assert.equal(link(body, names), esc(body), JSON.stringify(body) + ' changed with no citation in it');
  }
});

/* ⚠️ THIS TEST AND THE ONE ABOVE COVER DIFFERENT ESCAPES, which is not obvious
   and was measured rather than assumed. `pjLinkPaths` escapes in two places: a
   whole-body `esc(raw)` on the no-match path, and a per-token `esc()` on the
   matching path. Deleting the per-token escapes leaves the byte-for-byte test
   above GREEN -- it never reaches that code, because its bodies contain no
   citation -- and turns THIS one red with "a script tag beside a citation was
   not escaped". Verified by doing exactly that. Neither test covers the other's
   escape, so removing either would open an injection with a green suite. */
test('a citation becomes a chip and everything around it stays escaped', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  const out = link('see brief.md and <script>alert(1)</script>', new Set(['brief.md']));
  assert.match(out, /<span class="ref">brief\.md<button class="refgo"/,
    'the cited file did not become a chip');
  assert.ok(out.includes('&lt;script&gt;'), 'a script tag beside a citation was not escaped');
  assert.ok(!out.includes('<script>'), 'RAW SCRIPT TAG SURVIVED into message markup');
});

test('the chip carries the BASENAME, because that is what the opener takes', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  const out = link('look at docs/brief.md', new Set(['brief.md']));
  // The person sees the path they wrote; the button carries what open-file
  // accepts, which is a bare filename and nothing else.
  assert.ok(out.includes('>docs/brief.md<'), 'the chip stopped showing the path as written');
  assert.match(out, /data-ref="brief\.md"/, 'the button lost the basename the route needs');
});

test('a token containing .. is never dressed as a citation, even when its basename matches', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  const esc = pageFunction('esc');
  for (const body of ['../brief.md', 'a/../../brief.md', '..\\brief.md']) {
    const out = link(body, new Set(['brief.md']));
    assert.equal(out, esc(body), JSON.stringify(body) + ' was offered as a chip');
    assert.ok(!out.includes('refgo'), 'a walking-up path got a Show me button');
  }
});

test('trailing punctuation is stripped for the lookup and put back after', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  const out = link('it is in brief.md.', new Set(['brief.md']));
  assert.match(out, /<span class="ref">brief\.md<button/, 'the full stop blocked the match');
  assert.ok(out.endsWith('.'), 'the sentence lost its full stop');
});

test('whitespace the agent typed survives the reassembly', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  // Agents paste columns. Collapsing runs would edit what they said.
  const out = link('a    b\n\tbrief.md', new Set(['brief.md']));
  assert.ok(out.includes('a    b'), 'a run of spaces was collapsed');
  assert.ok(out.includes('\n\t'), 'a newline and tab were lost');
});

test('an empty or absent name list leaves every body untouched', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  const esc = pageFunction('esc');
  // CONTROL: the same body DOES become a chip when the list has the name, so
  // "untouched" here is the list being empty rather than the matcher being dead.
  assert.equal(link('brief.md', new Set()), esc('brief.md'));
  assert.equal(link('brief.md', null), esc('brief.md'));
  assert.match(link('brief.md', new Set(['brief.md'])), /refgo/);
});

/* ===========================================================================
   EXTERNAL LINKS IN MESSAGE BODIES
   ---------------------------------------------------------------------------
   🛑 THE ONE PLACE A CLICK LEAVES THE MACHINE in a local-first product, and
   the second place a message body becomes markup.
   =========================================================================== */

test('an http token becomes a link and carries noreferrer noopener', () => {
  const inline = pageFunction('pjInline', pageFnSource('esc') + '\n');
  const out = inline('see https://example.test/a for details');
  assert.match(out, /<a class="xlink" href="https:\/\/example\.test\/a"/, 'the URL did not become a link');
  assert.ok(out.includes('rel="noreferrer noopener"'),
    'the one click that leaves this machine told the destination where it came from');
  assert.ok(out.includes('target="_blank"'), 'the link replaced the board');
});

test('a scheme that is not http(s) is never linked, and that includes the dangerous ones', () => {
  const inline = pageFunction('pjInline', pageFnSource('esc') + '\n');
  const esc = pageFunction('esc');
  // ⚠️ The test is a literal `http://`/`https://` PREFIX rather than a URL
  // parse, so there is no scheme for it to be tricked about. These come back
  // as plain escaped text, not as links with a refused scheme.
  for (const body of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'HTTPS://SHOUTING.test',
  ]) {
    const out = inline(body);
    assert.ok(!out.includes('<a '), JSON.stringify(body) + ' became a link');
    assert.equal(out, esc(body), JSON.stringify(body) + ' was not returned as plain escaped text');
  }
  // CONTROL: the same function DOES link a real one, so the assertions above
  // are not passing because the linker is dead.
  assert.match(inline('https://ok.test'), /<a class="xlink"/);
});

test('a body with no URL in it is byte-for-byte what esc() produced', () => {
  const inline = pageFunction('pjInline', pageFnSource('esc') + '\n');
  const esc = pageFunction('esc');
  for (const body of ['plain words', 'a <b>tag</b> & an amp', '<script>alert(1)</script>', '']) {
    assert.equal(inline(body), esc(body), JSON.stringify(body) + ' changed with no URL in it');
  }
});

test('trailing punctuation is not swallowed into the href', () => {
  const inline = pageFunction('pjInline', pageFnSource('esc') + '\n');
  const out = inline('go to https://example.test/page.');
  assert.match(out, /href="https:\/\/example\.test\/page"/, 'the full stop went into the link');
  assert.ok(out.endsWith('.'), 'the sentence lost its full stop');
});

test('a URL inside a message that also cites a file gets both treatments', () => {
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  const out = link('brief.md and https://example.test', new Set(['brief.md']));
  assert.match(out, /<span class="ref">brief\.md/, 'the citation was lost when a URL was present');
  assert.match(out, /<a class="xlink"/, 'the URL was lost when a citation was present');
});

/* ===========================================================================
   FENCED BLOCKS IN MESSAGE BODIES
   ---------------------------------------------------------------------------
   The third and last place a message body becomes markup without an explicit
   engine marker. The fence is a DELIMITER; everything below tests that an
   uncertain reading falls back to the flat paragraph rather than guessing.
   =========================================================================== */

function bodyFn() {
  return pageFunction('pjBody', pageFnSource('esc') + '\n'
    + pageFnSource('pjInline') + '\n' + pageFnSource('pjLinkPaths') + '\n');
}

test('a closed fence becomes a block and its contents are escaped, not linked', () => {
  const body = bodyFn();
  const out = body('before\n```\n<script>alert(1)</script>\nbrief.md\nhttps://example.test\n```\nafter',
    new Set(['brief.md']));
  assert.match(out, /<figure class="codeb"><pre>/, 'the fenced block did not become a block');
  assert.ok(out.includes('&lt;script&gt;'), 'a script tag inside a block was not escaped');
  assert.ok(!out.includes('<script>'), 'RAW SCRIPT TAG survived inside a block');
  // ⚠️ The important half: quoted content is not a citation.
  const inBlock = out.slice(out.indexOf('<pre>'), out.indexOf('</pre>'));
  assert.ok(!inBlock.includes('refgo'), 'a path INSIDE a quoted block was offered as a citation');
  assert.ok(!inBlock.includes('xlink'), 'a URL INSIDE a quoted block was turned into a link');
});

test('an UNCLOSED fence is prose, not half a block', () => {
  const body = bodyFn();
  const out = body('here is the start\n```\nsome lines that never close', new Set());
  assert.ok(!out.includes('codeb'), 'an unclosed fence was rendered as a block');
  assert.ok(out.includes('```'), 'the fence characters vanished from a body that was left as prose');
});

test('outside the fence, citations and links still work', () => {
  const body = bodyFn();
  const out = body('see brief.md\n```\nquoted\n```\nand https://example.test', new Set(['brief.md']));
  assert.match(out, /<span class="ref">brief\.md/, 'a citation before the block was lost');
  assert.match(out, /<a class="xlink"/, 'a URL after the block was lost');
});

test('a body with no fence is exactly what it was before pjBody existed', () => {
  const body = bodyFn();
  const link = pageFunction('pjLinkPaths', pageFnSource('esc') + '\n' + pageFnSource('pjInline') + '\n');
  for (const t of ['plain', 'brief.md here', '<script>alert(1)</script>', 'https://example.test']) {
    assert.equal(body(t, new Set(['brief.md'])), link(t, new Set(['brief.md'])),
      JSON.stringify(t) + ' changed when it contains no fence');
  }
});

test('no figcaption is emitted, because nothing can name a source yet', () => {
  const body = bodyFn();
  const out = body('```\nx\n```', new Set());
  assert.ok(out.includes('<figure class="codeb">'), 'CONTROL: the block did not render at all');
  assert.ok(!out.includes('figcaption'),
    'a caption was invented; the pack draws one naming file and line, and nothing in this '
    + 'product can produce that, so shipping it would assert what nobody computed');
});
