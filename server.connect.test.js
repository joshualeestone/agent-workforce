'use strict';

/**
 * The connect routes, driven against the real server.
 *
 * A separate file from `server.test.js` for the same reason as
 * `server.projects.test.js`: that file's blocks are a standing merge hazard,
 * and this feature can add a file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE, plus one this feature adds: the
 * Claude config. `subscription` fixes its path at load and the real file is
 * the operator's live account -- and `connect.start()` DECIDES things by
 * reading it, so an unsandboxed run would decide from the operator's reality.
 * DRY_RUN is armed so nothing here can run a real program.
 *
 *   node --test server.connect.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
// `/bin/echo` exists and is executable, which is all "Claude is installed"
// means to `start` -- so no test here ever reaches the download path.
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const connect = require('./engine/connect');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await connect.cancel().catch(() => {});
  connect.resetForTests();
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function req(p, options) {
  const res = await fetch(base + p, options);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}
const json = (r) => JSON.parse(r.body);

async function post(p, body, origin) {
  return req(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: origin || base },
    body: JSON.stringify(body || {}),
  });
}

const CONNECTED_CONFIG = {
  oauthAccount: {
    organizationType: 'claude_max',
    billingType: 'stripe_subscription',
    organizationRateLimitTier: 'default_claude_max_20x',
  },
};

test('the state route answers idle before anything has happened', async () => {
  const got = await req('/api/connect');
  assert.match(got.type, /application\/json/);
  assert.equal(got.status, 200);
  assert.equal(json(got).phase, 'idle');
});

test('the state route never 500s, even when the engine itself throws', async () => {
  /**
   * ⚠️ Same contract as /api/machine: a state question always gets an answer.
   * Proven by making the engine throw, not by trusting the catch to be there.
   */
  const real = connect.state;
  connect.state = () => { throw new Error('engine on fire'); };
  try {
    const got = await req('/api/connect');
    assert.equal(got.status, 200, 'a state question was answered with an error status');
    assert.equal(json(got).phase, 'stuck');
    assert.match(json(got).tail, /engine on fire/, 'the reason was swallowed');
  } finally {
    connect.state = real;
  }
});

test('every connect write is a POST behind the cross-site guard', async () => {
  // ⚠️ /start DOWNLOADS AND RUNS SOFTWARE. Without the guard, any website you
  // visit could make this machine fetch and execute a binary.
  for (const p of ['/api/connect/start', '/api/connect/code', '/api/connect/cancel']) {
    const cross = await post(p, {}, 'https://example.com');
    assert.equal(cross.status, 403, `${p} accepted a cross-site POST`);
  }
});

test('a code with no flow running is refused with the reason', async () => {
  const got = await post('/api/connect/code', { code: 'abCD1234#efGH5678' });
  assert.equal(got.status, 409);
  assert.match(json(got).error, /not running/);
});

test('a body that is not JSON is a 400, not a crash', async () => {
  const got = await req('/api/connect/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: 'not json {',
  });
  assert.equal(got.status, 400);
  assert.match(json(got).error, /could not read/);
});

test('start on an already-connected machine answers connected and runs nothing', async () => {
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  try {
    const got = await post('/api/connect/start');
    assert.equal(got.status, 200, got.body);
    assert.equal(json(got).phase, 'connected');
    assert.equal(json(got).plan, 'Claude Max 20x');
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    connect.resetForTests();
  }
});

test('start, poll, cancel: the flow is drivable through the routes alone', async () => {
  /**
   * DRY_RUN makes every subprocess a no-op that reports ok, so the driver
   * launches and then sits looking at a blank pane -- which is exactly enough
   * to prove the routes drive the engine: start answers with a live phase,
   * the poll sees it, cancel ends it.
   */
  connect.setTickInterval(15);
  try {
    const started = await post('/api/connect/start');
    assert.equal(started.status, 200, started.body);
    assert.notEqual(json(started).phase, 'idle', 'start answered but nothing started');

    const polled = await req('/api/connect');
    assert.ok(String(json(polled).phase).startsWith('signin'),
      `expected a sign-in phase mid-flight, got ${json(polled).phase}`);

    const cancelled = await post('/api/connect/cancel');
    assert.equal(cancelled.status, 200);
    assert.equal(json(cancelled).phase, 'idle');
    assert.equal(json(await req('/api/connect')).phase, 'idle',
      'cancel answered idle but the state route still shows a flow');
  } finally {
    await connect.cancel().catch(() => {});
    connect.setTickInterval(700);
    connect.resetForTests();
  }
});
