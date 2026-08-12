'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const nodePath = require('node:path');

/**
 * ⚠️ Sandbox BEFORE requiring: `store` fixes its root at load, `subscription`
 * fixes its config path at load, and the real ones are the operator's live
 * app data and live Claude account.
 */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'connect-test-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const connect = require('./connect');
const subscription = require('./subscription');

/* ── fixture pane text ─────────────────────────────────────────────────────
   ⚠️ FIXTURE-DISCIPLINE: every screen below is CAPTURED text from a real
   `tmux capture-pane` of claude v2.1.229 driven in a sandboxed
   CLAUDE_CONFIG_DIR on 2026-08-12 -- not typed from memory. If the CLI's
   wording changes, re-capture; do not hand-edit these into what the new
   version "probably" says. */

const SCREEN_THEME = ` Let's get started.
 Choose the text style that looks best with your terminal
 To change this later, run /theme
   1. Auto (match terminal)
 ❯ 2. Dark mode ✔
   3. Light mode
   4. Dark mode (colorblind-friendly)
   5. Light mode (colorblind-friendly)
   6. Dark mode (ANSI colors only)
   7. Light mode (ANSI colors only)`;

const SCREEN_LOGIN_METHOD = ` Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.
 Select login method:
 ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise
   2. Anthropic Console account · API usage billing
   3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI`;

const SCREEN_SPINNER = `Welcome to Claude Code v2.1.229
 ✳ Opening browser to sign in…`;

// The URL as the pane actually renders it: wrapped across lines by width.
const SCREEN_PASTE = ` Browser didn't open? Use the url below to sign in (c to copy)
https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3
Ainference&code_challenge=rBQJOjK7flitOKUq_aSgfXvWglfl-x0siAN6vQIBDwA&code_challenge_method=S256&state=Fm9qWztZHDP1s7Hquwdb2xijzGuvcNOk5GiLpHrX4s
U
 Paste code here if prompted >`;

// Synthesised from the CLI's known post-login line; marked as such. The
// completion verdict never depends on this text (the config flip decides), so
// a wording drift here cannot produce a false "connected".
const SCREEN_LOGIN_DONE = ` Login successful. Press Enter to continue…`;

const CONNECTED_CONFIG = {
  hasAvailableSubscription: false,
  oauthAccount: {
    organizationType: 'claude_max',
    billingType: 'stripe_subscription',
    organizationRateLimitTier: 'default_claude_max_20x',
  },
};

const writeClaudeConfig = (obj) => fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(obj));
const clearClaudeConfig = () => { try { fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true }); } catch { /* fine */ } };

function until(fn, ms) {
  const deadline = Date.now() + (ms || 3000);
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      let v;
      try { v = fn(); } catch (e) { clearInterval(t); reject(e); return; }
      if (v) { clearInterval(t); resolve(v); return; }
      if (Date.now() > deadline) { clearInterval(t); reject(new Error('condition never became true')); }
    }, 10);
  });
}

/* ── recognisers ─────────────────────────────────────────────────────────── */

test('every captured screen is recognised as itself', () => {
  assert.equal(connect.classifyPane(SCREEN_THEME).kind, 'theme');
  assert.equal(connect.classifyPane(SCREEN_LOGIN_METHOD).kind, 'login-method');
  assert.equal(connect.classifyPane(SCREEN_SPINNER).kind, 'browser-open');
  assert.equal(connect.classifyPane(SCREEN_PASTE).kind, 'awaiting-code');
  assert.equal(connect.classifyPane(SCREEN_LOGIN_DONE).kind, 'login-done');
});

test('an accumulated pane reads as the FURTHEST screen, not the first match', () => {
  /**
   * ⚠️ The pane accumulates: by the paste prompt, earlier text may still be
   * on screen. A classifier that returns the first sentence it recognises
   * would call this "login-method" and press Enter into the paste prompt.
   */
  const accumulated = `${SCREEN_LOGIN_METHOD}\n${SCREEN_PASTE}`;
  assert.equal(connect.classifyPane(accumulated).kind, 'awaiting-code');
});

test('a screen we do not recognise is unknown, and carries what it said', () => {
  const got = connect.classifyPane('Something entirely new\nthat no version has shown before');
  assert.equal(got.kind, 'unknown');
  assert.match(got.tail, /entirely new/);
});

test('the wrapped OAuth URL is reassembled whole', () => {
  const url = connect.extractOauthUrl(SCREEN_PASTE);
  assert.ok(url.startsWith('https://claude.com/cai/oauth/authorize?'), url);
  // The parts that lived on continuation lines are back in one piece, and the
  // prompt line under them did not get glued on.
  assert.match(url, /scope=user%3Ainference/);
  assert.match(url, /state=Fm9qWztZHDP1s7Hquwdb2xijzGuvcNOk5GiLpHrX4sU$/);
  assert.doesNotMatch(url, /Paste/);
});

test('codes are one clean token or they are refused', () => {
  assert.equal(connect.validCode('abCD1234#efGH5678'), true);
  assert.equal(connect.validCode('ac_9-Zz.~/+='.repeat(2)), true);
  assert.equal(connect.validCode('has space'), false);
  assert.equal(connect.validCode('semi;colon'), false);
  assert.equal(connect.validCode('short'), false);
  assert.equal(connect.validCode(''), false);
  assert.equal(connect.validCode(null), false);
  assert.equal(connect.validCode('back`tick'.padEnd(10, 'a')), false);
  assert.equal(connect.validCode('dollar$sign'.padEnd(10, 'a')), false);
});

/* ── the download ────────────────────────────────────────────────────────── */

function serveRelease(t, { version, binary, checksum }) {
  const paths = {
    '/latest': () => version,
    [`/${version}/manifest.json`]: () => JSON.stringify({
      platforms: { [connect.platformKey()]: { checksum } },
    }),
    [`/${version}/${connect.platformKey()}/claude`]: () => binary,
  };
  const server = http.createServer((req, res) => {
    const answer = paths[req.url];
    if (!answer) { res.writeHead(404); res.end(); return; }
    // Content-Length, like the real service: it is what progress totals
    // come from, and chunked answers are the degraded case, not the norm.
    const body = Buffer.isBuffer(answer()) ? answer() : Buffer.from(answer());
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

test('a verified download lands executable, with progress that adds up', async (t) => {
  const binary = crypto.randomBytes(300 * 1024);
  const checksum = crypto.createHash('sha256').update(binary).digest('hex');
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = await serveRelease(t, { version: '9.9.9', binary, checksum });
  t.after(() => { delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE; });

  const seen = [];
  const got = await connect.download((g, total) => seen.push([g, total]));

  assert.equal(got.version, '9.9.9');
  const onDisk = fs.readFileSync(got.path);
  assert.equal(crypto.createHash('sha256').update(onDisk).digest('hex'), checksum,
    'what landed is not what was served');
  assert.ok(fs.statSync(got.path).mode & 0o100, 'the binary is not executable');
  assert.ok(seen.length > 0, 'no progress was ever reported');
  const [lastGot, lastTotal] = seen[seen.length - 1];
  assert.equal(lastGot, binary.length, 'progress never reached the full size');
  assert.equal(lastTotal, binary.length, 'the total did not come from Content-Length');
});

test('a checksum mismatch is refused, and nothing runnable is kept', async (t) => {
  const binary = crypto.randomBytes(64 * 1024);
  const wrong = crypto.createHash('sha256').update('not the payload').digest('hex');
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = await serveRelease(t, { version: '9.9.8', binary, checksum: wrong });
  t.after(() => { delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE; });

  await assert.rejects(() => connect.download(), /did not match its checksum/);

  const dir = nodePath.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce', 'downloads');
  const leftovers = (() => { try { return fs.readdirSync(dir); } catch { return []; } })()
    .filter((f) => f.includes('9.9.8'));
  assert.deepEqual(leftovers, [], `the unverified download survived: ${leftovers.join(', ')}`);
});

test('a download service answering nonsense is an error, not a hang', async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('<html>maintenance</html>'); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  t.after(() => server.close());
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE; });

  await assert.rejects(() => connect.download(), /did not answer with a version/);
});

/* ── the driver, against a scripted terminal ─────────────────────────────── */

/**
 * A fake tmux that behaves like the real CLI did when probed: Enter on the
 * theme screen advances to login method, Enter there brings the browser/paste
 * screen, and a pasted code "logs in" by flipping the sandboxed Claude config
 * -- which is exactly the side effect a real login has, and the only signal
 * the driver is allowed to trust.
 */
function fakeTerminal() {
  const f = {
    screen: SCREEN_THEME,
    sent: [],        // every send-keys, in order
    all: [],         // every tmux command verbatim, for target auditing
    killed: 0,
    made: 0,
    onCode: () => { writeClaudeConfig(CONNECTED_CONFIG); f.screen = SCREEN_LOGIN_DONE; },
    runner(file, args) {
      f.all.push(args.slice());
      const cmd = args[0];
      if (cmd === 'new-session') { f.made += 1; return { ok: true, stdout: '' }; }
      if (cmd === 'kill-session') { f.killed += 1; return { ok: true, stdout: '' }; }
      if (cmd === 'capture-pane') return { ok: true, stdout: f.screen };
      if (cmd === 'send-keys') {
        f.sent.push(args.slice(2));
        const literal = args.includes('-l');
        if (literal) { f.onCode(args[args.length - 1]); return { ok: true, stdout: '' }; }
        // An Enter: advance the way the real CLI was measured to.
        if (f.screen === SCREEN_THEME) f.screen = SCREEN_LOGIN_METHOD;
        else if (f.screen === SCREEN_LOGIN_METHOD) f.screen = SCREEN_PASTE;
        return { ok: true, stdout: '' };
      }
      return { ok: true, stdout: '' };
    },
  };
  return f;
}

function driverTest(name, fn) {
  test(name, async (t) => {
    connect.resetForTests();
    clearClaudeConfig();
    subscription.resetCache();
    connect.setTickInterval(15);
    connect.setUnknownGrace(300);
    // The node binary exists and is executable, which is all "already
    // installed" means to `start` -- no download in these tests.
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = process.execPath;
    t.after(async () => {
      await connect.cancel().catch(() => {});
      connect.resetForTests();
      connect.setRunner(null);
      connect.setTickInterval(700);
      connect.setUnknownGrace(10000);
      delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
      clearClaudeConfig();
      subscription.resetCache();
    });
    await fn(t);
  });
}

driverTest('the driver walks the measured flow end to end', async () => {
  const term = fakeTerminal();
  connect.setRunner(term.runner);
  connect.setDryRun(false);

  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_AWAITING_CODE);

  const st = connect.state();
  assert.ok(st.url && st.url.includes('oauth'), 'the OAuth URL was on screen and was not captured');

  // Exactly one Enter per choosing screen, counted BEFORE any code is typed:
  // a second Enter on the theme screen would land on the next screen and pick
  // whatever was under the cursor.
  const entersSoFar = term.sent.filter((s) => s[s.length - 1] === 'Enter' && !s.includes('-l'));
  assert.equal(entersSoFar.length, 2, `expected one Enter for theme + one for login method, saw ${term.sent.map((s) => s.join(' ')).join(' | ')}`);

  const put = connect.submitCode('abCD1234#efGH5678');
  assert.equal(put.ok, true, put.because);

  await until(() => connect.state().phase === connect.PHASE.CONNECTED, 5000);
  const done = connect.state();
  assert.equal(done.plan, 'Claude Max 20x', 'the plan the login produced is not reported');

  const literal = term.sent.find((s) => s.includes('-l'));
  assert.ok(literal && literal.includes('abCD1234#efGH5678'), 'the code was accepted but never typed');
  assert.ok(term.killed >= 1, 'the sign-in window was left running after success');
});

driverTest('a rejected code is not a dead end: the screen asks again and a second code works', async () => {
  /**
   * ⚠️ THE FIRST VERSION SAT AT "signin-completing" FOREVER after a bad code:
   * the CLI re-showed the paste prompt, the phase never moved, submitCode
   * refused a corrected code while the terminal literally asked for one, and
   * the acted-guard meant a second code could never be typed anyway.
   */
  const term = fakeTerminal();
  let codes = 0;
  term.onCode = () => {
    codes += 1;
    if (codes === 1) { term.screen = SCREEN_PASTE; return; }   // rejected: prompt again
    writeClaudeConfig(CONNECTED_CONFIG);
    term.screen = SCREEN_LOGIN_DONE;
  };
  connect.setRunner(term.runner);
  connect.setDryRun(false);

  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_AWAITING_CODE);
  assert.equal(connect.submitCode('firstCode#111111').ok, true);

  // The rejection surfaces: back to awaiting-code, with the reason carried.
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_AWAITING_CODE
    && /did not work/.test(connect.state().because || ''), 15000);

  // And a corrected code is ACCEPTED and completes the flow.
  const second = connect.submitCode('secondCode#22222');
  assert.equal(second.ok, true, second.because);
  await until(() => connect.state().phase === connect.PHASE.CONNECTED, 10000);
  assert.equal(codes, 2, 'the second code was accepted but never typed into the terminal');
});

driverTest('a code that starts with a dash is typed literally, not read as tmux flags', async () => {
  const term = fakeTerminal();
  connect.setRunner(term.runner);
  connect.setDryRun(false);
  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_AWAITING_CODE);

  const put = connect.submitCode('-abCD1234#efGH567');
  assert.equal(put.ok, true, put.because);
  await until(() => term.sent.some((s) => s.includes('-l')), 3000);
  const literal = term.sent.find((s) => s.includes('-l'));
  const dashIdx = literal.indexOf('--');
  assert.ok(dashIdx > -1 && literal[dashIdx + 1] === '-abCD1234#efGH567',
    `send-keys must end option parsing before the code: ${JSON.stringify(literal)}`);
});

driverTest('cancel beats a failure that lands after it, in either order', async () => {
  /**
   * ⚠️ Every stuck-path crosses an await, and cancel can run during it. The
   * defect: cancel destroyed the in-flight work, the aborted work rejected,
   * and the rejection wrote STUCK over the person's deliberate IDLE.
   */
  const term = fakeTerminal();
  let releaseCapture = null;
  const gate = new Promise((r) => { releaseCapture = r; });
  const baseRunner = term.runner.bind(term);
  connect.setRunner((file, args) => {
    if (args[0] === 'capture-pane') return gate.then(() => ({ ok: false, stdout: '', stderr: 'no server running' }));
    return baseRunner(file, args);
  });
  connect.setDryRun(false);

  await connect.start();
  await new Promise((r) => setTimeout(r, 60));   // a tick is now parked on the gate
  await connect.cancel();
  releaseCapture();                              // the aborted capture now fails
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(connect.state().phase, connect.PHASE.IDLE,
    'a failure from work the cancel itself aborted overwrote the cancel');
});

driverTest('a REPL with an unreadable subscription is an answer, not a forever-wait', async () => {
  /**
   * ⚠️ A machine whose CLI signs in fine but whose config names a plan we do
   * not recognise would have looped at "will notice when it is done" forever,
   * noticing nothing. A live REPL means Claude already wrote what it was
   * going to write.
   */
  const term = fakeTerminal();
  term.onCode = () => {
    // Signed in as far as the CLI is concerned; the config stays unreadable.
    writeClaudeConfig({ oauthAccount: { organizationType: 'claude_shiny_new_plan' } });
    term.screen = ' > try "help"\n ? for shortcuts';
  };
  connect.setRunner(term.runner);
  connect.setDryRun(false);

  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_AWAITING_CODE);
  assert.equal(connect.submitCode('someCode#123456').ok, true);

  await until(() => connect.state().phase === connect.PHASE.STUCK, 20000);
  const st = connect.state();
  assert.match(st.because, /could not confirm a subscription/,
    'the honest sentence is missing; whatever is there instead: ' + st.because);
  assert.ok(term.killed >= 1, 'the session was left running');
});

driverTest('a login that completes in the browser, with no code ever pasted, still connects', async () => {
  /**
   * ⚠️ PINS THE ANY-PHASE ARM. The browser flow can finish on its own; the
   * first version had no arm for "Login successful" arriving while the phase
   * was still awaiting-code, so the driver looped at "will notice when it is
   * done", noticing nothing. Reverting that arm must fail THIS test.
   */
  const term = fakeTerminal();
  connect.setRunner(term.runner);
  connect.setDryRun(false);

  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_AWAITING_CODE);

  // The browser completes; no code is ever submitted here. The config does
  // not flip yet, so the transition must come from the pane text alone.
  term.screen = SCREEN_LOGIN_DONE;
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_COMPLETING, 5000);

  // Now the CLI writes the config, and the flow finishes from evidence.
  writeClaudeConfig(CONNECTED_CONFIG);
  await until(() => connect.state().phase === connect.PHASE.CONNECTED, 10000);
});

test('a secure fetch never follows a redirect down to plain http', () => {
  /**
   * The manifest carries the checksum everything is verified against; an
   * https→http hop would make "verified" mean "verified against whatever a
   * network attacker wrote". The rule is a pure function so it is testable
   * without standing up a TLS server; both fetchers route through it.
   */
  assert.equal(connect.redirectDowngrades('https://downloads.claude.ai/x', 'http://evil.example/x'), true);
  assert.equal(connect.redirectDowngrades('https://downloads.claude.ai/x', '//evil.example/x'), false,
    'a scheme-relative redirect from https stays https and is fine');
  assert.equal(connect.redirectDowngrades('https://downloads.claude.ai/x', 'https://cdn.claude.ai/x'), false);
  assert.equal(connect.redirectDowngrades('http://127.0.0.1:4000/x', 'http://127.0.0.1:4000/y'), false,
    'a test fixture served over http may redirect within http');
  assert.equal(connect.redirectDowngrades('https://downloads.claude.ai/x', '::junk::'), false,
    'garbage without a scheme resolves RELATIVE to the https base (it will just 404) -- '
    + 'measured: new URL treats it as a path, so it is not a downgrade');
  assert.equal(connect.redirectDowngrades('https://downloads.claude.ai/x', 'http://['), true,
    'a target that cannot parse at all is refused, not followed');

  // ⚠️ CONTROL that the rule is actually WIRED into the fetchers, not just
  // exported: both call sites reference it by name.
  const src = fs.readFileSync(nodePath.join(__dirname, 'connect.js'), 'utf8');
  const wired = (src.match(/redirectDowngrades\(/g) || []).length;
  assert.ok(wired >= 3, `redirectDowngrades is defined but wired into ${wired - 1} call sites`);
});

driverTest('every tmux target is pinned exact, so a near-name agent can never be hit', async () => {
  /**
   * ⚠️ tmux resolves `-t` by PREFIX when no exact session matches. After our
   * session dies, an unpinned kill/capture/send aimed at `kosmos-connect`
   * could land on an agent somebody named `kosmos-connect2` -- typing keys
   * into a Claude running with permissions bypassed. `=` makes the target
   * exact-or-nothing.
   */
  const term = fakeTerminal();
  connect.setRunner(term.runner);
  connect.setDryRun(false);
  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.SIGNIN_AWAITING_CODE);
  connect.submitCode('abCD1234#efGH5678');
  await until(() => connect.state().phase === connect.PHASE.CONNECTED, 5000);

  // Recorded from the seam: every -t across the whole flow, including kills.
  const targets = term.all.filter((a) => a.includes('-t')).map((a) => a[a.indexOf('-t') + 1]);
  assert.ok(targets.length >= 5, `expected a flow's worth of targeted commands, saw ${targets.length}`);
  for (const t of targets) {
    assert.equal(t, '=' + connect.SESSION, `an unpinned target went out: ${t}`);
  }
  // And session CREATION uses the bare name (a -s arg is a name, not a target).
  const made = term.all.find((a) => a[0] === 'new-session');
  assert.equal(made[made.indexOf('-s') + 1], connect.SESSION);
});

test('the connect session name is reserved: no agent can be created with it', () => {
  const create = require('./create');
  assert.match(String(create.nameProblem('kosmos-connect')), /reserved/,
    'create accepts the sign-in session name, so an agent and the driver would share a pane');
  // Control: a NEAR name stays allowed -- exact-match pins make it safe, and
  // over-reserving would refuse names people legitimately want.
  assert.equal(create.nameProblem('kosmos-connect2'), null);
});

driverTest('a stale failure cannot tear down the fresh flow that replaced it', async () => {
  /**
   * ⚠️ THE REPLACED CASE, which `!driver` cannot see: flow A parks on a
   * capture, cancel runs, flow B starts, and THEN A's aborted capture fails.
   * Existence says "a driver is there"; only identity knows it is not A's.
   */
  const term = fakeTerminal();
  let releaseA = null;
  let captures = 0;
  const gate = new Promise((r) => { releaseA = r; });
  const baseRunner = term.runner.bind(term);
  connect.setRunner((file, args) => {
    if (args[0] === 'capture-pane') {
      captures += 1;
      if (captures === 1) return gate.then(() => ({ ok: false, stdout: '', stderr: 'no server running' }));
    }
    return baseRunner(file, args);
  });
  connect.setDryRun(false);

  await connect.start();                       // flow A; its first capture parks
  await new Promise((r) => setTimeout(r, 40));
  await connect.cancel();
  await connect.start();                       // flow B, healthy
  await until(() => {
    const p = connect.state().phase;
    return p !== connect.PHASE.IDLE && p !== connect.PHASE.STUCK;
  });
  releaseA();                                  // A's aborted capture now fails
  await new Promise((r) => setTimeout(r, 120));
  const st = connect.state();
  assert.notEqual(st.phase, connect.PHASE.STUCK,
    'flow A\'s corpse wrote STUCK over flow B: ' + JSON.stringify(st));
});

driverTest('a pane that stays blank forever becomes stuck, not eternal progress', async () => {
  /**
   * ⚠️ The never-drawing screen used to get ETERNITY while the unrecognised
   * screen got 10 seconds -- "Getting the sign-in ready" painted forever over
   * a hung Claude. The blank grace is 4.5x the unknown grace (45s real),
   * shrunk here through the same knob the unknown grace tests use.
   */
  const term = fakeTerminal();
  term.screen = '';
  connect.setRunner(term.runner);
  connect.setDryRun(false);

  await connect.start();
  // Well inside the grace: a briefly blank pane is NOT a failure.
  await new Promise((r) => setTimeout(r, 300));
  assert.notEqual(connect.state().phase, connect.PHASE.STUCK,
    'a briefly blank pane was treated as a failure');

  await until(() => connect.state().phase === connect.PHASE.STUCK, 15000);
  assert.match(connect.state().because, /never drew/,
    'the blank hang went stuck for the wrong reason: ' + connect.state().because);
});

test('a version answer that tries to steer the file path is refused', async (t) => {
  const server = http.createServer((req, res) => {
    const body = Buffer.from('9.9.9/../../escape');
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  t.after(() => server.close());
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE; });
  await assert.rejects(() => connect.download(), /did not answer with a version/,
    'a path-traversal version string was accepted into the download path');
});

driverTest('a code is refused while nothing is asking for one', async () => {
  const refusedCold = connect.submitCode('abCD1234#efGH5678');
  assert.equal(refusedCold.ok, false);
  assert.match(refusedCold.because, /not running/);

  const term = fakeTerminal();
  connect.setRunner(term.runner);
  connect.setDryRun(false);
  await connect.start();
  // Still on the theme screen: the terminal is not asking for a code.
  const refusedEarly = connect.submitCode('abCD1234#efGH5678');
  assert.equal(refusedEarly.ok, false);
  assert.match(refusedEarly.because, /not asking/);
});

driverTest('a screen nobody recognises becomes stuck, with the screen attached', async () => {
  const term = fakeTerminal();
  term.screen = 'A WHOLE NEW ONBOARDING\nnothing here matches any recogniser';
  connect.setRunner(term.runner);
  connect.setDryRun(false);

  await connect.start();
  await until(() => connect.state().phase === connect.PHASE.STUCK, 5000);
  const st = connect.state();
  assert.match(st.because, /do not recognise/);
  assert.match(st.tail, /WHOLE NEW ONBOARDING/, 'the pane content is not carried, so nobody can see what happened');
  assert.ok(term.killed >= 1, 'the session was left running after getting stuck');
});

driverTest('already connected means connected, without touching anything', async () => {
  writeClaudeConfig(CONNECTED_CONFIG);
  const term = fakeTerminal();
  connect.setRunner(term.runner);
  connect.setDryRun(false);

  const st = await connect.start();
  assert.equal(st.phase, connect.PHASE.CONNECTED);
  assert.equal(term.made, 0, 'a sign-in session was opened for somebody already signed in');
});

driverTest('cancel stops the flow and reports idle', async () => {
  const term = fakeTerminal();
  connect.setRunner(term.runner);
  connect.setDryRun(false);
  await connect.start();
  await until(() => connect.state().phase !== connect.PHASE.IDLE);

  const st = await connect.cancel();
  assert.equal(st.phase, connect.PHASE.IDLE);
  assert.ok(term.killed >= 1, 'cancel did not close the sign-in window');
});

/* ── interruption ────────────────────────────────────────────────────────── */

test('a mid-flight record from a dead process reads as interrupted, not as progress', () => {
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    phase: connect.PHASE.DOWNLOADING,
    progress: { got: 12345, total: 99999 },
    pid: 999999999,
    updatedAt: new Date().toISOString(),
  }));

  const st = connect.state();
  assert.equal(st.phase, connect.PHASE.INTERRUPTED,
    'a progress bar nobody is moving would have been shown');
  assert.equal(st.before, connect.PHASE.DOWNLOADING);
  fs.rmSync(file, { force: true });
});
