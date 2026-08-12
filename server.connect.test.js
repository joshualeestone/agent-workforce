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

test('the page and the engine agree on which phases are active', () => {
  /**
   * ⚠️ `frConnActive` is a hand copy of the engine's ACTIVE_PHASES (one-file
   * page, no imports). The drift consequence is named in both comments: a
   * phase added to the engine and missed in the page becomes a panel-less
   * state whose watcher stops polling -- a frozen screen. This is the test
   * those comments ask for.
   */
  const raw = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const m = raw.match(/function frConnActive[\s\S]*?return \[([\s\S]*?)\]\.includes/);
  assert.ok(m, 'frConnActive (or its list) vanished from the page');
  const pageList = m[1].match(/'[^']+'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(pageList, [...connect.ACTIVE_PHASES].sort(),
    'the page and the engine disagree about which phases are live');
});

test('a live record from ANOTHER process is reported as it stands, not as interrupted', () => {
  /**
   * ⚠️ "Another pid" is not "a dead pid". pid 1 (launchd) is definitionally
   * alive, so a mid-flight record carrying it must keep its phase; only a
   * pid the kernel says is gone earns the interrupted verdict.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({
      phase: 'downloading', progress: { got: 5, total: 10 }, pid: 1,
      updatedAt: new Date().toISOString(),
    }));
    assert.equal(connect.state().phase, 'downloading',
      'a live flow in another process was declared interrupted from pid inequality alone');

    // ⚠️ But a live pid with an HOUR-stale record is a recycled pid, not a
    // flow: without the freshness bound, that record renders as live progress
    // nobody is moving, forever.
    fs.writeFileSync(file, JSON.stringify({
      phase: 'downloading', progress: { got: 5, total: 10 }, pid: 1,
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }));
    assert.equal(connect.state().phase, 'interrupted',
      'an hour-dead record with a recycled pid was reported as live progress');

    fs.writeFileSync(file, JSON.stringify({
      phase: 'downloading', progress: { got: 5, total: 10 }, pid: 999999999,
      updatedAt: new Date().toISOString(),
    }));
    // CONTROL: the dead-pid case still earns the verdict.
    assert.equal(connect.state().phase, 'interrupted');
  } finally {
    fs.rmSync(file, { force: true });
    connect.resetForTests();
  }
});

test('cancel refuses to destroy a LIVE flow belonging to another process', () => {
  /**
   * ⚠️ `state()` deliberately reports a second server's live flow as it
   * stands; a cancel posted to the WRONG server must then refuse to kill
   * that flow's session and clobber its record -- the reporting side and the
   * destructive side must agree about whose flow it is. pid 1 is
   * definitionally alive; the fresh timestamp makes it a live flow.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    phase: 'downloading', progress: { got: 5, total: 10 }, pid: 1,
    updatedAt: new Date().toISOString(),
  };
  return (async () => {
    try {
      fs.writeFileSync(file, JSON.stringify(record));
      const st = await connect.cancel();
      assert.equal(st.phase, 'downloading',
        'cancel on the non-owning server reported it had cancelled a flow it does not own');
      const after = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(after.phase, 'downloading',
        'cancel on the non-owning server clobbered the owner\'s live record');

      // CONTROL: the same record from a DEAD pid is the orphan case, and
      // cancel must clean that one.
      fs.writeFileSync(file, JSON.stringify({ ...record, pid: 999999999 }));
      const st2 = await connect.cancel();
      assert.equal(st2.phase, 'idle', 'the orphan case stopped being cleanable');
    } finally {
      // the second cancel rewrote the file to idle; remove it for later tests
      fs.rmSync(file, { force: true });
      connect.resetForTests();
    }
  })();
});

test('start also refuses to clobber a LIVE flow belonging to another process', async () => {
  /**
   * ⚠️ Start is a write path too: without the same refusal cancel carries, a
   * start on the non-owning server wrote IDLE over the owner's live record
   * and then killed the shared-named session out from under it.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    phase: 'signin-awaiting-code', url: 'https://claude.com/oauth?x=1', pid: 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(file, JSON.stringify(record));
    const st = await connect.start();
    assert.equal(st.phase, 'signin-awaiting-code',
      'start on the non-owning server did not report the owner\'s flow');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.phase, 'signin-awaiting-code',
      'start on the non-owning server clobbered the owner\'s live record');
    assert.equal(after.pid, 1, 'the record changed hands');
  } finally {
    fs.rmSync(file, { force: true });
    connect.resetForTests();
  }
});

test('a code posted to the non-owning server is refused with the TRUE sentence', () => {
  /**
   * ⚠️ state() on this server reports the other server's live paste prompt,
   * so the UI renders a paste box here -- and "the sign-in is not running"
   * would then be a false sentence. The refusal must say where the code
   * actually goes.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({
      phase: 'signin-awaiting-code', url: 'https://claude.com/oauth?x=1', pid: 1,
      updatedAt: new Date().toISOString(),
    }));
    const put = connect.submitCode('abCD1234#efGH5678');
    assert.equal(put.ok, false);
    assert.match(put.because, /another Kosmos window/,
      'the refusal claims the sign-in is not running while state() reports it running');
    // CONTROL: with no record at all, the plain not-running sentence returns.
    fs.rmSync(file, { force: true });
    assert.match(connect.submitCode('abCD1234#efGH5678').because, /not running/);
  } finally {
    fs.rmSync(file, { force: true });
    connect.resetForTests();
  }
});

test('a malformed code is a 400; asking at the wrong moment stays a 409', async () => {
  // The state conflict, through the real engine: nothing is running.
  const conflict = await post('/api/connect/code', { code: 'abCD1234#efGH5678' });
  assert.equal(conflict.status, 409);

  // The format refusal is only reachable with a flow parked at awaiting-code,
  // which the DRY_RUN harness cannot reach -- so the ROUTE MAPPING is tested
  // by handing it the engine's format verdict directly. The verdict itself
  // (bad charset => kind: 'format') is pinned in engine/connect.test.js.
  const real = connect.submitCode;
  connect.submitCode = () => ({ ok: false, kind: 'format', because: 'that does not look like a sign-in code' });
  try {
    const bad = await post('/api/connect/code', { code: 'nope;`$(x)`' });
    assert.equal(bad.status, 400, 'a malformed code was answered as a state conflict');
    assert.match(json(bad).error, /does not look like/);
  } finally {
    connect.submitCode = real;
  }
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

/* --------------------------------------------------------------------------
   The connect painter, RUN rather than grepped -- same harness discipline as
   server.test.js's first-run render tests.
   -------------------------------------------------------------------------- */

function pageFunction(name, prelude = '') {
  const raw = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('function ' + name);
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  // eslint-disable-next-line no-new-func
  return new Function(`${prelude}\n${script.slice(start, end)}\nreturn ${name};`)();
}

function connectHarness(st) {
  const raw = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tables = ['FR_SAY', 'FR_GLYPH', 'FR_CONN_SAY'].map((n) => {
    const m = script.match(new RegExp('const ' + n + ' = \\{[^}]*\\};'));
    assert.ok(m, n + ' vanished from the page');
    return m[0];
  }).join('\n');
  const realEsc = pageFunction('esc');
  const realRow = pageFunction('frCheckRow', 'const esc = ' + realEsc.toString() + ';\n' + tables);
  const realMB = pageFunction('frMB');
  const realBefore = pageFunction('frConnBefore');
  const realProgress = pageFunction('frConnPaintProgress',
    'const frMB = ' + realMB.toString() + ';\n'
    + 'const document = { getElementById: () => null };');

  const prelude = `
    const esc = ${realEsc.toString()};
    ${tables}
    const frCheckRow = ${realRow.toString()};
    const frMB = ${realMB.toString()};
    const frConnBefore = ${realBefore.toString()};
    let FR_CONN_LAST = null;
    let FR_STEP = 3;
    const __els = {};
    const document = { getElementById: (id) => (__els[id] = __els[id] || { innerHTML: '', textContent: '', style: {}, onclick: null, onkeydown: null }) };
    const frConnPaintProgress = ${realProgress.toString()};
    let __actions = null;
    function frActions(primary, alt) { __actions = { primary: primary.label, alt: alt && alt.label }; }
    function frGo() {}
    function frRecheck() {}
    function frConnectStart() {}
    function frConnCancel() {}
    function frConnSubmitCode() {}
    globalThis.__els = __els;
    globalThis.__actions = () => __actions;
  `;
  const paint = pageFunction('frPaintConnect', prelude);
  paint(st);
  return { paint, els: globalThis.__els, actions: globalThis.__actions() };
}

test('every phase the server can answer renders a panel with a way onward', () => {
  const phases = {
    downloading: /Downloading Claude/,
    installing: /Setting Claude up/,
    'signin-launching': /Getting the sign-in ready/,
    'signin-browser-open': /Your browser has opened/,
    'signin-awaiting-code': /put it here/,
    'signin-completing': /Finishing the sign-in/,
    stuck: /could not finish connecting/,
    interrupted: /interrupted/,
  };
  for (const [phase, wants] of Object.entries(phases)) {
    const { els, actions } = connectHarness({ phase, because: 'x', progress: { got: 0, total: null } });
    assert.match(els['fr-sub'].innerHTML, wants, `phase ${phase} did not render its panel`);
    assert.ok(actions && actions.primary && actions.alt,
      `phase ${phase} left the person short of a way onward`);
  }
});

test('what the terminal said is shown escaped, never executed', () => {
  /**
   * ⚠️ The tail is CAPTURED TERMINAL OUTPUT -- whatever the CLI printed,
   * including anything an error message quotes back. It goes to innerHTML, so
   * an unescaped tail is script injection into the page that manages every
   * agent on the machine.
   */
  const { els } = connectHarness({
    phase: 'stuck',
    because: 'a <b>reason</b> with markup',
    tail: '<script>alert(1)</script> & <img src=x onerror=y>',
  });
  const out = els['fr-sub'].innerHTML;
  assert.ok(!out.includes('<script>alert'), 'the pane tail reached the page unescaped');
  assert.ok(!out.includes('<img src=x'), 'the pane tail reached the page unescaped');
  assert.ok(out.includes('&lt;script&gt;'), 'the tail is not shown at all, which hides what happened');
  assert.ok(!out.includes('<b>reason</b>'), 'the because sentence reached the page unescaped');
});

test('the sign-in URL lands in the href escaped', () => {
  const { els } = connectHarness({
    phase: 'signin-awaiting-code',
    url: 'https://claude.com/oauth?a=1&state="><script>x</script>',
  });
  const out = els['fr-sub'].innerHTML;
  assert.ok(out.includes('href="https://claude.com/oauth?a=1&amp;state=&quot;&gt;'),
    'the URL was not escaped into the href');
  assert.ok(!out.includes('"><script>'), 'the URL broke out of its attribute');
});

test('a repaint on the same phase does not rebuild the screen under the person', () => {
  /**
   * ⚠️ The poll runs every second and a person may be halfway through typing
   * the code -- an innerHTML rebuild empties the input under their cursor.
   */
  const h = connectHarness({ phase: 'signin-awaiting-code', url: null });
  h.els['fr-sub'].innerHTML = 'SENTINEL: unchanged means untouched';
  h.paint({ phase: 'signin-awaiting-code', url: null });
  assert.equal(h.els['fr-sub'].innerHTML, 'SENTINEL: unchanged means untouched',
    'polling the same phase rebuilt the panel, which empties the code input mid-typing');
});

test('download progress is honest: a real total gets a bar, no total gets a count', () => {
  const h = connectHarness({ phase: 'downloading', progress: { got: 52428800, total: 104857600 } });
  assert.equal(h.els['fr-conn-fill'].style.width, '50%');
  assert.match(h.els['fr-conn-prog'].textContent, /50MB of 100MB/);

  const bare = connectHarness({ phase: 'downloading', progress: { got: 52428800, total: null } });
  assert.equal(bare.els['fr-conn-fill'].style.width, '0%',
    'with no Content-Length the bar pretended to know how far along it is');
  assert.match(bare.els['fr-conn-prog'].textContent, /50MB so far/);
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
