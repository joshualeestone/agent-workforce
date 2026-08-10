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
 * A SYNTHETIC roster, installed for the whole file.
 *
 * ⚠️ Every test of this feature's safety surface used to source its agent from
 * the LIVE roster, and an earlier version of this comment argued that was
 * unavoidable ("`server.js` destructures `snapshot()` at import, so the roster
 * cannot be stubbed from here"). That was wrong: the seam is INSIDE
 * `engine/status.js`, below the import boundary, so a destructured reference
 * goes through it too. Verified, not assumed.
 *
 * The cost of believing it was unavoidable: measured on a machine with the
 * roster forced empty, `node --test server.test.js` reported 41 passed, 0
 * failed, 19 SKIPPED — and the nineteen were the cross-site guard, the
 * confirmation token, the alias guard, the `mayTypeInto` call site and the
 * tombstone. A suite that goes green on a laptop with no agents while testing
 * none of the dangerous paths is worse than one that fails, because it reports
 * success for work it did not do.
 *
 * ⚠️ Synthetic names, deliberately. Pointing these at a real agent meant every
 * run wrote commitment records and instruction files keyed to a colleague's
 * name, and left the roster's real names in temp directories. `zeta` and `yara`
 * exist nowhere on this machine.
 *
 * Both halves are needed: a pane list alone yields agents whose panes cannot be
 * captured, so they classify `unknown` and the action routes correctly refuse
 * them, which would leave the interesting tests skipping for a new reason.
 */
const status = require('./engine/status');

const FAKE_PANES = [
  'zeta-discord\t0.0\t2.1.212\t0\tSummarising the quarterly quotes',
  'yara-discord\t0.0\tnode\t0\tReconciling the July statements',
  // ⚠️ An agent in a REFUSING state, present on purpose. Without one, the test
  // that pins the route's `mayTypeInto` call site — the single line stopping a
  // bare Enter from confirming a permission prompt — skipped for a new reason
  // even after the roster became ours. A synthetic fleet made entirely of
  // healthy agents cannot exercise the guard that exists for unhealthy ones.
  'xander-discord\t0.0\tclaude\t0\tWaiting on you',
  // ⚠️ An agent we only INFERRED: a Claude process in a session whose name
  // carries no suffix, so nothing ties this pane to the fleet's record for the
  // name `wren`. Present on purpose — without it, the guard that stops us
  // tombstoning a record we cannot tie to the pane has nothing to refuse, and a
  // roster made entirely of properly-named agents cannot exercise it.
  'wren\t0.0\t2.1.212\t0\tDrafting the supplier email',
  // ⚠️ A session whose name has a character `safeKey` strips. It appears on the
  // board and must NOT be offered any action, because the route cannot address
  // it by a name that is exactly its own. Present on purpose: without it, the
  // clause making `may` agree with `findAgent` has nothing to refuse and a test
  // asserting they agree passes with the clause deleted.
  'my.bot-discord\t0.0\t2.1.212\t0\tIndexing the archive',
].join('\n');

const FAKE_CAPTURE = {
  // "Worked for" is what the classifier reads as finished-and-waiting.
  'zeta-discord:0.0': 'Worked for 2m 14s\n> \n',
  // A spinner in the title is what reads as working; the tail just has to not
  // contain a question or a rate-limit marker.
  'yara-discord:0.0': 'esc to interrupt\n',
  // A permission prompt: the exact pane where a stray Enter would confirm Yes.
  'xander-discord:0.0': 'Do you want to proceed?\n\u276f 1. Yes\n  2. No\n',
  'wren:0.0': 'Worked for 1m 02s\n> \n',
  'my.bot-discord:0.0': 'Worked for 3m 30s\n> \n',
};

test.before(() => {
  status.setPaneSource(() => FAKE_PANES);
  status.setPaneCapture((target) => FAKE_CAPTURE[target] || '');
});
test.after(() => {
  status.setPaneSource(null);
  status.setPaneCapture(null);
});

/**
 * An agent name the write routes will accept, and that the ACTION routes will
 * act on rather than refuse.
 *
 * ⚠️ It returns an ACTIONABLE agent, and that is load-bearing, not tidiness.
 *
 * This used to return `agents[0]`. Once the roster became synthetic, `agents[0]`
 * sorted to `xander` — the agent deliberately parked on a permission prompt so
 * the refusal path had something to refuse. Every guard test then got its 409
 * from `mayTypeInto` rather than from the guard under test, and since those
 * tests asserted only `status === 409`, three of them passed with the guard they
 * were named for deleted: the alias-spelling guard and both halves of the
 * confirmation token.
 *
 * That is the second time on this branch that a fix for a coverage problem
 * created a coverage problem. The synthetic roster removed 19 skips and quietly
 * hollowed out three of the tests it recovered.
 *
 * So: actionable agent here, `refusingAgent()` where a refusal is the point, and
 * the tests assert on the BODY as well as the status, because 409 is now a
 * value two different mechanisms can produce.
 */
/**
 * The agent OBJECT the routes will act on, from `may` rather than a predicate.
 *
 * ⚠️ Exists because four separate tests re-derived this inline, and each time a
 * gate was added to the product (isNamedOurs, then addressability) every one of
 * them silently began selecting an agent the routes refuse — so they failed, or
 * worse passed, for reasons unrelated to their names. Narrowing them by hand
 * worked twice and was wrong twice. `may` is computed from the same engine the
 * routes use, so this cannot drift when the next gate lands.
 */
async function actionableAgent() {
  const board = JSON.parse((await req('/api/status')).body);
  // ⚠️ Actionable AND tied. `may.clear.ok` alone is not enough and the
  // difference is deliberate: clearing an INFERRED pane is allowed — it is the
  // pane the operator clicked — while its commitment record is deliberately not
  // tombstoned, because the record belongs to the name and the pane has not
  // been tied to it. So `may.clear.ok` is true for `wren`, and a tombstone test
  // selecting it fails for a reason that has nothing to do with tombstones.
  // Tests that specifically want the untied case call `inferredAgent()`.
  const found = (board.agents || []).find((a) =>
    a.may && a.may.clear && a.may.clear.ok && a.isNamedOurs);
  assert.ok(found, 'the synthetic roster has no ordinary agent the routes would act on');
  return found;
}

async function anyAgent(t) {
  const board = await req('/api/status');
  if (!board.type.includes('application/json')) {
    t.skip('the status engine did not return a board at all');
    return null;
  }
  const agents = JSON.parse(board.body).agents || [];
  assert.ok(agents.length, 'the synthetic roster did not reach the server');
  // ⚠️ `isNamedOurs` too, and this is the THIRD time on this branch that a
  // roster change silently redirected a guard test at the wrong agent. The
  // roster now contains an inferred-only agent (`wren`) so the tombstone gate
  // has something to refuse — and without this clause `anyAgent` could hand it
  // back, so `a destructive action tombstones what it destroyed` would get its
  // failure from the gate rather than from the behaviour it is named for. The
  // test would then pass with the tombstone code deleted.
  // ⚠️ `may.clear.ok`, not a hand-rolled predicate. This is the FOURTH gate to
  // land on this helper (state, isNamedOurs, and now addressability), and each
  // of the first three silently redirected tests at the wrong agent until it
  // was added by hand. `may` is computed from the same engine the routes use, so
  // deriving from it cannot drift when the next gate arrives.
  const actionable = agents.find((a) => a.may && a.may.clear && a.may.clear.ok);
  assert.ok(actionable,
    'the synthetic roster has no actionable agent we can tie to its record, so '
    + 'every guard test would be refused before reaching the guard it is named for');
  return encodeURIComponent(actionable.sessionName);
}

/**
 * An agent we only INFERRED is an agent: a Claude process in a session whose
 * name does not tie it to the fleet's record for that name.
 *
 * The dangerous case it stands for: the real agent is dead, and an unrelated
 * session has taken over its name by being the only candidate left.
 */
async function inferredAgent() {
  const board = await req('/api/status');
  const agents = JSON.parse(board.body).agents || [];
  const inferred = agents.find((a) => a.isNamedOurs === false && a.isAgentPane);
  assert.ok(inferred, 'the roster lost its inferred-only agent, so the tombstone gate is untested');
  return encodeURIComponent(inferred.sessionName);
}

/**
 * An agent the action routes will REFUSE, for the tests where that is the point.
 *
 * ⚠️ Actually called. The first version of this helper was defined, credited in
 * `anyAgent`'s comment with enforcing the file's discipline, and never used —
 * while the tests that needed it each re-derived it inline with their own,
 * narrower predicate. A helper that a comment says enforces a rule it does not
 * enforce is worse than no helper: it reads as covered.
 */
async function refusingAgent() {
  const board = JSON.parse((await req('/api/status')).body);
  const found = (board.agents || []).find((a) => a.state !== 'idle' && a.state !== 'working');
  assert.ok(found, 'the synthetic roster has no refusing agent');
  return found;
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

  // ⚠️ BOTH aliases are now refused at RESOLUTION, and this assertion has been
  // rewritten twice as the rule tightened — worth recording, because each step
  // was driven by a concrete failure rather than by taste.
  //
  //   v1: both refused by the confirmation token (409).
  //   v2: stripping refused at resolution (404), case still resolved (409),
  //       because `MyBot` reads as unambiguous.
  //   v3: case refused too (404). `findAgent` matches `a.sessionName === key`
  //       with `key` lower-cased, so a session genuinely named `Mikey-discord`
  //       was published with `may.*.ok = true` and then 404'd on POST. The
  //       generous clause reintroduced exactly the disagreement it sat beside.
  //
  // A refusal that happens BEFORE we resolve a name to an agent is the stronger
  // one: nothing downstream has to be correct for it to hold.
  for (const alias of [plain.toUpperCase(), plain.split('').join('.')]) {
    const res = await req(`/api/agent/${encodeURIComponent(alias)}/clear`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holding: emptyToken }),
    });
    assert.equal(res.status, 404,
      `${alias} resolved to an agent whose name it is not, which is how one name `
      + 'becomes another and a destructive action lands on the wrong agent');
  }
});

test('a name whose characters get stripped never resolves to a different agent', async (t) => {
  // ⚠️ The failure this closes, which the confirmation token does NOT: sessions
  // `mybot` and `my.bot` both reduce to the key `mybot`, so a request naming one
  // resolved to the other. The token looks like it covers this and does not —
  // when neither agent has ever reported, both read `unknown` with an empty
  // list, so both produce the IDENTICAL token and the action proceeds.
  //
  // Deleting the stripping check in `findAgent` fails here.
  const name = await anyAgent(t);
  if (!name) return;
  const plain = decodeURIComponent(name);

  for (const spelling of [`${plain}.`, `my.${plain}`, `${plain}!`]) {
    const res = await req(`/api/agent/${encodeURIComponent(spelling)}/clear`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(res.status, 404,
      `${spelling} resolved to an agent whose name it is not`);
  }

  // And the legitimate spelling still works, or the fix is just a denial.
  const board = JSON.parse((await req('/api/status')).body);
  assert.ok((board.agents || []).some((a) => a.sessionName === plain),
    'the exact name stopped resolving, so the guard is refusing real agents too');
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
  assert.match(JSON.parse(res.body).error || '', /changed since you were shown/,
    'refused, but not by the confirmation check this test is named for');

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
  assert.match(JSON.parse(idOnlyRes.body).error || '', /changed since you were shown/,
    'refused, but not by the token check this half of the test exists to prove');

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
  const waiting = await refusingAgent();
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

  // Through the shared helper. Re-deriving this inline is what broke this test
  // twice, each time a new gate landed in the product.
  const target = await actionableAgent();
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

test('a NON-destructive action leaves the commitment record alone', () => {
  // ⚠️ The other half of the tombstone guard, and it was unpinned: only the
  // `true` case had a test. Replacing `invalidatesCommitments(action, result)`
  // with `true` — so a COMPACT, a refusal, or a dry-run tombstones a live
  // record — failed nothing. The one route test that reaches a 200 with
  // compact asserts nothing about the record, and the next test to touch that
  // agent reseeds it through `report()`, which clears the tombstone.
  //
  // Compact is the gentlest action and the visually primary button. Having it
  // silently mark an agent's commitments as destroyed would turn the safest
  // thing on the screen into the most damaging.
  const lifecycle = require('./engine/lifecycle');

  // Unit half: the decision itself.
  const asked = { outcome: lifecycle.OUTCOME.ASKED, mayHaveLanded: true };
  assert.equal(lifecycle.invalidatesCommitments('compact', asked), false,
    'compact was treated as destroying the conversation');
  assert.equal(lifecycle.invalidatesCommitments('clear', asked), true);
});

test('compact does not tombstone what the agent is holding', async (t) => {
  // The CALL SITE half, driven through the real route with dry-run off and an
  // injected runner, the same containment the clear test uses.
  const lifecycle = require('./engine/lifecycle');
  const commitments = require('./engine/commitments');

  const board = JSON.parse((await req('/api/status')).body);
  // ⚠️ `isNamedOurs`, the FOURTH inline re-derivation of this predicate in this
  // file. Un-narrowed it resolves to the inferred-only agent, and the test still
  // passes — but for the wrong reason: `invalidatesCommitments('compact', …)` is
  // false, so the tombstone block is never entered at all and `reconciled` is
  // null by compact's exclusion rather than by anything this test is named for.
  // A green test measuring the wrong mechanism is how three guards on this
  // branch stayed unpinned.
  const target = await actionableAgent();
  if (!target) { t.skip('no actionable agent on the synthetic roster'); return; }

  lifecycle.setRunner(() => '');
  try {
    lifecycle.setDryRun(false);
    commitments.report(target.sessionName, [{ what: 'work that must survive a compact' }]);

    const fresh = JSON.parse((await req('/api/status')).body);
    const now = fresh.agents.find((a) => a.sessionName === target.sessionName);
    const res = await req(`/api/agent/${encodeURIComponent(target.sessionName)}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holding: now.commitments.token }),
    });
    assert.equal(res.status, 200, JSON.parse(res.body).because || res.body);
    assert.equal(JSON.parse(res.body).reconciled, null,
      'compact reported reconciling a record it should not have touched');

    const after = commitments.read(target.sessionName);
    assert.equal(after.state, commitments.STATE.HOLDING,
      'a compact marked the agent\'s commitments as destroyed');
    assert.equal(after.commitments.length, 1);
    assert.ok(!after.commitments[0].destroyed, 'the surviving item was marked destroyed');
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

test('restoring the real runner re-arms dry-run', () => {
  // ⚠️ The guard whose own comment says "a guard that depends on everyone
  // remembering the order is not a guard" — and it had no test, so deleting the
  // one line it consists of left all 250 green.
  //
  // It exists because `setDryRun` refuses only in ONE direction: it will not
  // leave dry-run while the real runner is installed, but nothing stopped
  // `setDryRun(false)` followed by `setRunner(null)`, which re-arms
  // `execFileSync` with the fleet-wide protection off, on a machine running
  // thirteen agents. The only test doing this happens to order its `finally`
  // correctly, which is exactly the reliance the guard was written to remove.
  const lifecycle = require('./engine/lifecycle');
  try {
    lifecycle.setRunner(() => '');
    lifecycle.setDryRun(false);
    assert.equal(lifecycle.DRY_RUN, false, 'dry-run did not come off at all');

    // The dangerous order, the one no test was doing.
    lifecycle.setRunner(null);
    assert.equal(lifecycle.DRY_RUN, true,
      'the real runner was restored with dry-run still off');

    // And it is really armed, not just reporting so.
    assert.equal(lifecycle.compact('nobody', 'nobody-discord:0.0').outcome, 'dry-run');
  } finally {
    lifecycle.setRunner(null);
  }
});

test('the browser fallback descriptions match the engine word for word', async () => {
  // ⚠️ `web/index.html` carries a copy of the action copy for the window before
  // `/api/actions` resolves. The engine's own comment says the costs live there
  // "so the screen cannot describe an action differently from the thing that
  // performs it", and this fallback re-creates exactly that drift channel. It
  // has already drifted once: the first version said compact "loses nothing",
  // which is the one claim the engine was reworded to stop making.
  const engine = JSON.parse((await req('/api/actions')).body);

  // ⚠️ EVALUATE the fallback, do not grep for its strings.
  //
  // This asserted `page.includes(engine[id].what)` — a substring match anywhere
  // in an 1,800-line, comment-dense file. Proved by mutation: replacing the
  // fallback with `let ACTIONS = {};` and moving the original object into a
  // block comment left this test, and every other test in the file, green —
  // while every `?fresh=` deep link and every render before `/api/actions`
  // resolves would throw in `optionBlock` reading `act.gentlest` of undefined.
  //
  // A test that passes because the values it wants appear SOMEWHERE in the file
  // is not testing the code, it is testing the comments.
  const fallback = pageValue('ACTIONS');

  for (const id of ['compact', 'clear', 'restart']) {
    assert.ok(fallback[id], `the page has no fallback for ${id} at all`);
    assert.equal(fallback[id].what, engine[id].what, `the page's fallback "what" for ${id} has drifted`);
    assert.equal(fallback[id].loses, engine[id].loses, `the page's fallback "loses" for ${id} has drifted`);
    assert.equal(fallback[id].label, engine[id].label, `the page's fallback label for ${id} has drifted`);
    // `gentlest` decides which button is visually primary. If the engine moved
    // it, a fallback still marking Compact primary would put the wrong
    // recommendation on the most destructive screen in the product, and no
    // assertion on wording would notice.
    assert.equal(fallback[id].gentlest, engine[id].gentlest,
      `the page marks ${id} differently from the engine`);
  }
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
/**
 * Read a top-level `let <name> = { … };` out of the page and return the value.
 *
 * Same reasoning as `pageFunction`: there is no build step and no module
 * system, so the alternative to evaluating the real text is grepping for
 * strings — which passes when the code is gone as long as the strings survive
 * in a comment.
 */
function pageValue(name) {
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const start = page.search(new RegExp(`^(?:let|const|var)\\s+${name}\\s*=\\s*\\{`, 'm'));
  if (start === -1) throw new Error(`web/index.html no longer defines ${name}`);

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
  if (end === -1) throw new Error(`could not find the end of ${name}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${page.slice(open, end)});`)();
}

function pageFunction(name, scope = {}) {
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
  // ⚠️ `scope` lets a caller inject the page helpers a function depends on
  // (`esc`, say) rather than re-implementing them in the test — a
  // re-implementation would mean asserting against the test's own copy instead
  // of the product's, which is the whole failure this helper exists to avoid.
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `${page.slice(start, end)}; return ${name};`)(
    ...names.map((k) => scope[k]),
  );
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

test('the DOING NOW badge errs toward over-warning, never toward under-warning', () => {
  // ⚠️ This decides the wireframe's central callout and had no test at all.
  //
  // The two states are NOT symmetric, which is the whole reason the rule is
  // strict. `promised` is what the dialog calls dangerous, so a false DOING NOW
  // SUPPRESSES the warning ("Angel is not visibly working on any of these") and
  // quietly removes an item from the count of dangerous ones. A false PROMISED
  // merely over-warns. One direction loses commitments; the other annoys.
  const visiblyDoing = pageFunction('visiblyDoing');

  // The real case: the task line describes the same work.
  assert.equal(visiblyDoing({ what: 'Reconciling the July supplier statements' },
    'Reconciling the July supplier statements'), true);

  // ⚠️ The measured false positive that motivated the rule. A pane's task line
  // is often a BRANCH NAME, not a description of work, and two shared words was
  // enough for `add-editable-agent-detail` to match an unrelated commitment on
  // "detail" and "agent", badge it DOING NOW, and drop it from the count.
  assert.equal(visiblyDoing({ what: 'Detail the agent handover notes' },
    'add-editable-agent-detail'), false,
    'a branch name matched an unrelated commitment and suppressed the warning');

  // ⚠️ Distinct words, not a count. Counting duplicates let a task line of
  // "Detail: detail" satisfy ">= 2" on a single real match.
  assert.equal(visiblyDoing({ what: 'Detail the handover' }, 'Detail: detail'), false,
    'a repeated word was counted twice and re-opened the false DOING NOW');

  // Every word of the task must appear, not merely most of them.
  assert.equal(visiblyDoing({ what: 'Draft the supplier note' },
    'Draft the supplier invoice'), false);

  // A single shared long word is never enough.
  assert.equal(visiblyDoing({ what: 'Reconciling the statements' }, 'Reconciling'), false);

  // No task line at all is not evidence of doing anything.
  assert.equal(visiblyDoing({ what: 'anything at all here' }, ''), false);
  assert.equal(visiblyDoing({ what: 'anything at all here' }, null), false);

  // An empty commitment cannot match either.
  assert.equal(visiblyDoing({ what: '' }, 'Reconciling the July statements'), false);

  // Short words are noise and are dropped, so a task made only of them cannot
  // match anything.
  assert.equal(visiblyDoing({ what: 'do the a of it' }, 'do the a of it'), false);
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

test('a session with ten panes still targets the lowest, not the lexicographic first', () => {
  // ⚠️ `String('0.10') < String('0.2')` is true. The pane this picks becomes
  // the card's `target`, which is where `/clear` and `/compact` keystrokes are
  // sent — so a string compare here is a targeting decision for destructive
  // input. Restoring the lexicographic compare fails this.
  const status = require('./engine/status');
  const lines = [];
  for (let i = 0; i < 12; i += 1) lines.push(`zeta-discord\t0.${i}\t2.1.212\t0\tIdle`);
  const roster = status.onePanePerSession(status.parsePanes(lines.join('\n')));
  assert.equal(roster.length, 1);
  assert.equal(roster[0].target, 'zeta-discord:0.0');

  // And across windows, not just panes.
  const across = status.onePanePerSession(status.parsePanes([
    'zeta-discord\t10.0\t2.1.212\t0\tIdle',
    'zeta-discord\t9.0\t2.1.212\t0\tIdle',
  ].join('\n')));
  assert.equal(across[0].target, 'zeta-discord:9.0');
});

test('the status payload says which actions would be refused', async () => {
  // ⚠️ Pins the `may` block, which had NO test: deleting it from /api/status
  // left 247 green, and the browser then reads `may.ok === false` as false for
  // all three and re-enables every option — the "offer an action that cannot
  // work" state the block exists to remove.
  const board = JSON.parse((await req('/api/status')).body);
  const asking = await refusingAgent();
  // ⚠️ NOT `actionableAgent()` here: this test is about the `may` block itself,
  // so it needs an agent chosen without consulting `may` — otherwise it asserts
  // that `may` agrees with `may`.
  const ready = (board.agents || []).find((a) =>
    (a.state === 'idle' || a.state === 'working') && a.isNamedOurs && a.sessionName.indexOf('.') === -1);
  assert.ok(ready, 'the synthetic roster has no ordinary actionable agent');

  for (const action of ['compact', 'clear', 'restart']) {
    assert.ok(ready.may && ready.may[action], `no verdict for ${action} on a ready agent`);
    assert.equal(ready.may[action].ok, true, `${action} was refused for a ready agent`);
  }

  // ⚠️ And the inferred-only agent carries the refusal all the way to the
  // BROWSER, not just to the route. Without this the card would offer a Restart
  // button that the route then refuses — the "offer an action that cannot work"
  // state this whole block exists to remove.
  const inferred = (board.agents || []).find((a) => a.isNamedOurs === false && a.isAgentPane);
  assert.ok(inferred, 'the roster lost its inferred-only agent');
  assert.equal(inferred.may.restart.ok, false,
    'the board offered Restart for a name whose own session is not the pane shown');
  assert.match(inferred.may.restart.because, /not the one this agent/);
  assert.equal(inferred.may.clear.ok, true,
    'typing into the pane on the card is still fine — it is the pane the operator clicked');

  // An agent on a permission prompt: typing is refused, restart is not, because
  // restart sends no keystrokes.
  assert.equal(asking.may.clear.ok, false, 'clear was offered to an agent showing a question');
  assert.equal(asking.may.compact.ok, false, 'compact was offered to an agent showing a question');
  assert.match(asking.may.clear.because, /waiting on an answer|cannot see clearly enough/);
  assert.equal(asking.may.restart.ok, true, 'restart was refused for an agent that can be restarted');

  // ⚠️ And it must agree with what the ROUTE does, or the screen disables a
  // button the server would have allowed (or worse, the reverse). Same
  // function, asserted to give the same answer through both surfaces.
  const res = await req(`/api/agent/${encodeURIComponent(asking.sessionName)}/clear`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ holding: asking.commitments.token }),
  });
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(res.body).because, asking.may.clear.because,
    'the screen and the route disagree about why this is refused');
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

// ---------------------------------------------------------------------------
// The screenshot fixture
// ---------------------------------------------------------------------------

test('the screenshot fixture roster is a shape the product actually produces', () => {
  // ⚠️ The fixture roster is a HAND-WRITTEN copy of the snapshot shape, and
  // nothing required it to stay in step with the engine — the whole file had
  // zero test coverage.
  //
  // The cost, measured: splitting `isAgentSession` into three tiers added
  // `isFleetSession`, which is what `mayTypeInto('restart', …)` reads. The
  // fixture was not updated, so every committed screenshot of this branch's
  // headline feature showed **Restart greyed out under a false refusal**, on
  // the card whose entire subject is Restart. The fixture calls the real
  // `mayTypeInto` specifically so it cannot claim the product allows something
  // it does not — and it spent a release claiming the exact reverse.
  //
  // So this asserts the property rather than the field: every fixture agent
  // must get the verdicts the product would really give it.
  const lifecycle = require('./engine/lifecycle');
  const fixture = require('./tools/screenshot-fixture');

  assert.ok(fixture.AGENTS.length >= 3, 'the fixture no longer covers enough states');

  // ⚠️ Per-agent, not "every agent must be actionable". The blanket form
  // forbade the roster from containing a REFUSING agent — which meant the
  // refused-option UI, the newest thing on the most dangerous screen, was the
  // one state the fixture was structurally unable to render, and so had no
  // screenshot. An assertion that makes a state unphotographable is worse than
  // the drift it was guarding against.
  //
  // What still has to hold is that each agent's verdicts follow from its own
  // state, so the fixture cannot depict a permission the product would not
  // grant.
  for (const agent of fixture.AGENTS) {
    const actionable = agent.state === 'idle' || agent.state === 'working';
    for (const action of ['compact', 'clear', 'restart']) {
      const verdict = lifecycle.mayTypeInto(action, agent);
      const expected = action === 'restart' ? true : actionable;
      assert.equal(verdict.ok, expected,
        `the fixture's ${agent.sessionName} (${agent.state}) got ${verdict.ok} for `
        + `${action} but the product gives ${expected}, so a screenshot of it `
        + 'shows a state the product does not produce');
    }
  }

  // And at least one of each, so both the offered and refused renderings can be
  // photographed at all.
  assert.ok(fixture.AGENTS.some((a) => a.state === 'idle' || a.state === 'working'),
    'no fixture agent is actionable');
  assert.ok(fixture.AGENTS.some((a) => a.state !== 'idle' && a.state !== 'working'),
    'no fixture agent is refused, so the refused UI cannot be screenshotted');

  // ⚠️ And the states the SCREENSHOTS are supposed to demonstrate are all
  // present. Plan item 5.4 asks for every dialog state; a roster that quietly
  // lost one would satisfy the loop above while shipping a gap.
  const states = new Set(fixture.AGENTS.map((a) => a.commitments.state));
  for (const needed of ['holding', 'clear', 'unknown']) {
    assert.ok(states.has(needed), `no fixture agent is in the ${needed} state`);
  }
});

test('every await in the destructive handler is followed by a still-my-dialog check', () => {
  // ⚠️ The most serious defect found on this branch, and the one the test
  // suite cannot drive directly: it is browser async control flow, and there is
  // no DOM here.
  //
  // The sequence: open the dialog for A, click Restart (the script sleeps about
  // eight seconds), press Escape, open the dialog for B. A's response lands and
  // reassigns `FRESH_FOR`/`FRESH_TOKEN` to A and repaints the options with A's
  // data, while the heading still reads "Give B a fresh start" because only
  // `openFresh` writes it. The next click destroys A's conversation from a
  // dialog that names B. On the one screen whose thesis is that you saw the
  // cost before you paid it.
  //
  // Every other async handler on this page re-checks after its awaits that the
  // panel still belongs to the agent it started on. This one, the only one that
  // destroys something, did not.
  //
  // So this pins the PROPERTY that regresses — an `await` whose continuation
  // touches dialog state without re-checking — rather than the behaviour, which
  // is honest about what it can and cannot reach. Plan item 5.3 asks for
  // anything unpinnable to be declared; this is the closest to pinning it gets.
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

  const start = page.indexOf("document.getElementById('fresh-options').addEventListener('click'");
  assert.notEqual(start, -1, 'the fresh-start action handler has been renamed or removed');
  const end = page.indexOf('\n});', start);
  assert.notEqual(end, -1, 'could not find the end of the action handler');
  // ⚠️ COMMENTS STRIPPED FIRST. The first version of this test matched the word
  // "awaits" inside its own explanatory comment and failed against correct
  // code. A source-level assertion that cannot tell code from prose is the
  // brittle-test failure this file has already been burned by once.
  const handler = page.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  // The guard exists and is defined before the first await.
  assert.match(handler, /const stillMine = \(\) =>/, 'the stillMine guard is gone');
  assert.ok(handler.indexOf('const stillMine') < handler.search(/\bawait\b/),
    'the guard is defined after the first await, so the first continuation is unguarded');

  // ⚠️ Counted, not merely present. One `stillMine()` somewhere would satisfy a
  // naive check while three other continuations stayed open — which is exactly
  // the shape of the original bug, where the 409 path was guarded and the
  // success path was not.
  const awaits = (handler.match(/\bawait\b/g) || []).length;
  const checks = (handler.match(/stillMine\(\)/g) || []).length;
  assert.ok(awaits >= 3, `expected several awaits in this handler, found ${awaits}`);
  // ⚠️ `>= awaits`, not `>= awaits - 1`. The looser form was measured to let a
  // guard be deleted without failing: five awaits, five checks, and removing
  // one still satisfied `4 >= 4`. A threshold with slack in it is not a
  // threshold, and this is the assertion that stands in for a behaviour test
  // the suite cannot run.
  // ⚠️ EVERY guard, counted exactly, not "at least as many as the awaits".
  //
  // The threshold has now drifted back into slack twice. There are five awaits
  // and six checks — the sixth being the `finally`'s, which stops a stale
  // response re-enabling another agent's buttons — so `checks >= awaits`
  // tolerated deleting one and the suite stayed green. That is the same defect
  // as `awaits - 1`, arrived at from the other direction: the count of guards
  // grew and the floor did not.
  //
  // Pinned to the exact number, so ADDING an await without a guard fails, and
  // so does removing a guard. A change to either has to come here and say so.
  assert.equal(checks, 6,
    `expected exactly 6 still-my-dialog checks (one per await, plus the finally) `
    + `but found ${checks} against ${awaits} awaits: either a continuation can `
    + 'repaint a dialog that now belongs to another agent, or this count needs '
    + 'updating deliberately');

  // ⚠️ The CATCH block specifically, because counting is positional-blind and
  // missed a real hole: two rejection paths throw before the first in-try
  // check, and the catch wrote its message into whatever dialog was open.
  const catchAt = handler.indexOf('} catch (err) {');
  assert.notEqual(catchAt, -1, 'the catch block has been restructured');
  const firstStatement = handler.slice(catchAt + '} catch (err) {'.length).trim();
  assert.ok(firstStatement.startsWith('if (!stillMine()) return;'),
    'the catch block writes to the dialog before checking it is still ours');

  // And the epoch is bumped where a new decision begins, so reopening the
  // dialog for the SAME agent also invalidates an in-flight response.
  assert.match(page, /FRESH_EPOCH \+= 1;[\s\S]{0,400}?const forEpoch = FRESH_EPOCH;/,
    'the action does not take an epoch, so it cannot tell one decision from the next');
  const openFresh = page.slice(page.indexOf('function openFresh('));
  assert.match(openFresh.slice(0, 600), /FRESH_EPOCH \+= 1;/,
    'reopening the dialog does not invalidate an in-flight response');
});

test('clearing a pane we only INFERRED is an agent does not tombstone the record for that name', async () => {
  // ⚠️ The case no tie-break can reach, and the one the `rank` fix does not
  // cover: when the real agent is DEAD there is no competing pane to outrank.
  // `mikey-discord` is gone, someone runs `tmux new -s mikey` with Claude in
  // it, and that pane becomes the only candidate for the name `mikey`. It wins
  // by default and every is-this-an-agent check passes.
  //
  // Typing into that pane is defensible — it is the pane on the card the
  // operator clicked. Tombstoning is not: the commitment record belongs to
  // whoever owns the NAME, and this pane has not proven it is them. Marking it
  // produces the worst output this board can produce — a confident, FALSE claim
  // that an agent's commitments were destroyed while that agent is untouched
  // and still holding them. `unknown` would at least be honest; `destroyed` is
  // an assertion about work that still exists.
  const lifecycle = require('./engine/lifecycle');
  const commitments = require('./engine/commitments');

  const name = decodeURIComponent(await inferredAgent());
  commitments.report(name, [
    { what: 'Send the supplier email before 5pm' },
  ]);
  const before = commitments.read(name);
  assert.equal(before.commitments.length, 1, 'the record did not land');

  const calls = [];
  let sawBecause = '';
  let sawUntied;
  lifecycle.setRunner((cmd, args) => { calls.push([cmd, args]); return { ok: true, stdout: '', stderr: '' }; });
  try {
    lifecycle.setDryRun(false);
    const fresh = JSON.parse((await req('/api/status')).body);
    const now = fresh.agents.find((a) => a.sessionName === name);
    const res = await req(`/api/agent/${encodeURIComponent(name)}/clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holding: now.commitments.token }),
    });
    assert.ok([200, 409].includes(res.status), `unexpected status ${res.status}: ${res.body}`);
    // The clear itself must actually have happened, or this proves nothing.
    assert.notEqual(JSON.parse(res.body).outcome, 'dry-run',
      'the action was still dry-run, so the tombstone block never ran');
    sawBecause = JSON.parse(res.body).because || '';
    sawUntied = JSON.parse(res.body).untied;
  } finally {
    lifecycle.setRunner(null);
  }

  // ⚠️ Assert the record is INTACT, not merely "not destroyed". The first
  // version of this test asserted `state !== 'destroyed'`, which passes either
  // way: a successful tombstone leaves the record `unknown`, never `destroyed`.
  // Mutation-testing caught it — removing the gate entirely left this green, so
  // the test named for the guard was pinning nothing at all. That is the third
  // time on this branch a test written for a guard did not exercise it.
  const after = commitments.read(name);
  assert.equal(
    after.state, 'holding',
    'the record for this name was tombstoned by clearing a pane that was never '
    + 'tied to it — the real agent may be untouched and still holding this work',
  );
  assert.equal(after.commitments.length, 1, 'the commitment itself was dropped');

  // And the operator is told what we did in terms of a DECISION rather than a
  // failure. "We could not update our record" would be untrue here: we did not
  // try, on purpose, because the record is not this pane's to speak for.
  assert.match(sawBecause, /not the one that agent/);

  // ⚠️ And on the FIELD, not only the prose. Keying this solely on the sentence
  // means rewording the sentence silently unpins the guard — the exact
  // anti-pattern several comments in this diff condemn. `untied` is in the
  // response body so the browser can render it and a test can assert it.
  assert.equal(sawUntied, true,
    'the deliberate refusal to tombstone was not reported as a distinct outcome, '
    + 'so it exists only inside an English sentence');
});


test('an action still running is not fired twice by reopening its dialog', () => {
  // ⚠️ `FRESH_BUSY` is about the DIALOG and `closeFresh` must clear it, or the
  // next dialog opens frozen. But the ACTION does not stop when the dialog
  // closes — `restart-bot.sh` sleeps about eight seconds. So: click Restart on
  // A, press Escape, reopen A. `renderFresh` paints freshly enabled buttons and
  // a second Restart fires two overlapping `launchctl stop`/`start` cycles at
  // one service; the first script's has-session check then races the second's
  // restart and a healthy agent is reported as "it has not come back yet".
  //
  // ⚠️ Comments are STRIPPED before analysing. A source-level test that does not
  // strip them matches its own explanation and passes against code with the
  // guard deleted — this file has shipped that mistake before.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

  assert.match(code, /let FRESH_INFLIGHT/,
    'the in-flight marker is gone, so a reopened dialog can fire a second action');

  // It must NOT be cleared by closeFresh: that is the whole difference between
  // it and FRESH_BUSY.
  const closeStart = code.indexOf('function closeFresh(');
  assert.ok(closeStart > -1, 'closeFresh vanished');
  const closeBody = code.slice(closeStart, code.indexOf('\n}', closeStart));
  assert.doesNotMatch(closeBody, /FRESH_INFLIGHT\s*=/,
    'closeFresh cleared the in-flight marker, which is exactly the bug: the '
    + 'action outlives the dialog, so closing it must not mark the action done');

  // And the click handler must consult it before starting anything.
  const handlerStart = code.indexOf("getElementById('fresh-options').addEventListener('click'");
  assert.ok(handlerStart > -1, 'the options click handler vanished');
  const handler = code.slice(handlerStart, handlerStart + 4000);
  const checkAt = handler.indexOf('FRESH_INFLIGHT');
  const sendAt = handler.indexOf('FRESH_BUSY = true');
  assert.ok(checkAt > -1, 'the click handler never consults the in-flight marker');
  assert.ok(checkAt < sendAt,
    'the in-flight check runs after the action is already under way, so it '
    + 'cannot prevent the second submit');
});


test('an untied pane warns BEFORE the action, not in the response afterwards', () => {
  // ⚠️ The server refuses to tombstone an untied pane's record and reports
  // `untied` — but in the RESPONSE, after the clear has already been sent. The
  // card meanwhile is dressed as the real agent all the way down: `readIdentity`
  // reads that NAME's own files, so the title, role, avatar and the listed
  // commitments are the real agent's. An operator would read one agent's cost
  // and pay it with a stranger's conversation, which is the single failure this
  // screen exists to prevent.
  //
  // Comments are stripped first: a source test that does not strip them matches
  // its own explanation and passes against code with the guard deleted.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

  const start = code.indexOf('function holdingBlock');
  assert.ok(start > -1, 'holdingBlock vanished');
  const body = code.slice(start, code.indexOf('\nfunction ', start + 10));

  assert.match(body, /isNamedOurs/,
    'the dialog never consults isNamedOurs, so it shows the real agent’s '
    + 'commitments as the cost of clearing a pane that may not be theirs');

  // And it must be checked BEFORE the ordinary state branches, or the warning
  // renders only for some states.
  const guardAt = body.indexOf('isNamedOurs');
  const stateAt = body.indexOf("state === 'unknown'");
  assert.ok(guardAt > -1 && stateAt > -1 && guardAt < stateAt,
    'the untied check runs after the state branches, so the warning is skipped '
    + 'for whichever state returns first');
});

test('the DESTROYED badge sets its own ink rather than inheriting one that fails AA', () => {
  // ⚠️ Computed, not eyeballed. Inheriting the sibling badge's ink measured
  // 2.65:1 in light and 3.16:1 in dark on #6b6b66, against 4.5:1 for 11px
  // caption text with no large-text exemption. CLAUDE.md makes a contrast
  // failure reaching main a hard rule, and this is the one badge whose job is
  // telling the operator an item is already gone.
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const rule = raw.match(/\.holding \.badge\.gone \{[^}]*\}/);
  assert.ok(rule, 'the .badge.gone rule vanished');
  assert.match(rule[0], /color:/,
    'the destroyed badge inherits its ink again, which measured 2.65:1 on its '
    + 'own background');
});

test('may never offers an action the route would refuse for the same name', async () => {
  // ⚠️ One fact — is this agent actionable — derived in two places that
  // disagreed. `findAgent` refuses a name whose characters `safeKey` would
  // strip, but `may` was computed from `mayTypeInto` alone, so the board
  // published ok:true for an agent whose POST answered 404. That is precisely
  // the offer-an-action-that-cannot-work state `may` was added to remove.
  const board = JSON.parse((await req('/api/status')).body);
  for (const a of board.agents || []) {
    for (const action of ['compact', 'clear', 'restart']) {
      if (!a.may || !a.may[action] || !a.may[action].ok) continue;
      const res = await req(`/api/agent/${encodeURIComponent(a.sessionName)}/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.notEqual(res.status, 404,
        `${a.sessionName}.may.${action} said ok, but the route cannot address that name`);
    }
  }
});


test('a half-sent clear still tombstones, driven through the ROUTE not the unit', async () => {
  // ⚠️ `invalidatesCommitments` is pinned as a unit and its `true` branch is
  // pinned at the route, but the REFUSED-with-mayHaveLanded branch was pinned
  // nowhere above the unit: replacing that return with `false` at the call site
  // left the suite green.
  //
  // It is the branch that matters most for honesty. `sendCommand` returns
  // REFUSED when the text landed and the Enter did not — the command may be
  // sitting in the composer and may still be applied at the end of the turn. So
  // the conversation may already be gone while the board still asserts its
  // commitments at full confidence.
  const lifecycle = require('./engine/lifecycle');
  const commitments = require('./engine/commitments');

  const target = await actionableAgent();
  commitments.report(target.sessionName, [{ what: 'work that may already be gone' }]);
  assert.equal(commitments.read(target.sessionName).state, 'holding');

  // ⚠️ The runner must THROW on the second call, not return a failure value.
  // `sendCommand` only reaches REFUSED-with-mayHaveLanded from its `catch`, so a
  // runner that RETURNS `{ok:false}` produces OUTCOME.ASKED instead — and the
  // first version of this test did exactly that. It was named for the half-sent
  // path, exercised the ordinary one, and `assert.ok([200,409].includes(...))`
  // hid the difference because ASKED answers 200 and half-sent answers 409.
  //
  // A test that does not enter the branch it is named for is worse than no
  // test: it is a claim of coverage. This is the fourth on this branch.
  let call = 0;
  lifecycle.setRunner(() => {
    call += 1;
    if (call === 1) return { ok: true, stdout: '', stderr: '' };
    throw new Error('send-keys: no such pane');
  });
  try {
    lifecycle.setDryRun(false);
    const fresh = JSON.parse((await req('/api/status')).body);
    const now = fresh.agents.find((a) => a.sessionName === target.sessionName);
    const res = await req(`/api/agent/${encodeURIComponent(target.sessionName)}/clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holding: now.commitments.token }),
    });
    // ⚠️ EXACTLY 409, not "either". The half-sent path answers 409 and the
    // ordinary ASKED path answers 200, so accepting both is what let this test
    // pass while never entering the branch it exists for.
    assert.equal(res.status, 409, `expected the half-sent refusal: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.outcome, 'refused', 'this is not the half-sent path');
    assert.match(body.because, /sitting in its composer/,
      'the response did not describe a command that may be unsent');
  } finally {
    lifecycle.setRunner(null);
  }

  assert.notEqual(commitments.read(target.sessionName).state, 'holding',
    'a half-sent clear left the board asserting these at full confidence, about '
    + 'work the agent may already have forgotten');
});

test('the option block survives a payload with no verdict, rather than throwing', () => {
  // ⚠️ The round-7 fix made an absent `may` render as REFUSED — correct — and
  // then the refused branch read `may.because`, so it threw a TypeError on the
  // exact case the comment above it says it handles. `renderFresh` calls this
  // AFTER writing the holding block and BEFORE unhiding the dialog, so the
  // throw meant the ↺ button did nothing at all, silently, with no message:
  // strictly worse than the enabled-buttons bug it was fixing.
  //
  // ⚠️ Evaluated out of the real page, so it cannot pass against a copy — and
  // `esc` comes out of the page too rather than being re-implemented here, or
  // the test would be asserting against its own escaping rather than the
  // product's.
  const esc = pageFunction('esc');
  const optionBlock = pageFunction('optionBlock', { esc });
  const act = { label: 'Clear', what: 'Starts it over.', cost: 'Loses everything' };

  for (const verdict of [undefined, null, {}, { ok: false }]) {
    const html = optionBlock('clear', act, '.', verdict);
    assert.match(html, /Not available/,
      `a payload with may=${JSON.stringify(verdict)} did not render as refused`);
    assert.match(html, /disabled/, 'the button was left enabled');
  }

  // And a real verdict still renders its own sentence rather than the fallback.
  const withReason = optionBlock('clear', act, '.', { ok: false, because: 'it is waiting on an answer' });
  assert.match(withReason, /waiting on an answer/);
});

test('may never promises an action perform could not form a command for', async () => {
  // ⚠️ `safeKey` preserves a leading `_` or `-`, while `safeServiceName` and
  // `safeTarget` both require the first character to be alphanumeric. So an
  // agent in a session called `_bot-discord` passed `addressable`, passed
  // `mayTypeInto`, and was published with all three buttons enabled — and every
  // POST answered 409. Third time on this branch that "is this agent
  // actionable" was derived in two places that disagreed.
  const lifecycle = require('./engine/lifecycle');

  // Straight at the containment rules, so this holds for any future caller.
  assert.equal(lifecycle.canReach('restart', { sessionName: '_bot' }), false);
  assert.equal(lifecycle.canReach('clear', { target: '_bot:0.0' }), false);
  assert.equal(lifecycle.canReach('restart', { sessionName: 'bot' }), true);
  assert.equal(lifecycle.canReach('clear', { target: 'bot:0.0' }), true);

  // And end to end: nothing the board offers may 409 on a formation failure.
  const board = JSON.parse((await req('/api/status')).body);
  for (const a of board.agents || []) {
    for (const action of ['compact', 'clear', 'restart']) {
      if (!a.may || !a.may[action] || !a.may[action].ok) continue;
      assert.ok(lifecycle.canReach(action, a),
        `${a.sessionName}.may.${action} said ok, but perform cannot form a command for it`);
    }
  }
});
