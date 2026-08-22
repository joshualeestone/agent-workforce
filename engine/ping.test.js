'use strict';

/**
 * #238: telling the Kosmos team an agent was created.
 *
 * 🔑 THE THIRD TEST IN THIS FILE IS THE ONE THAT MATTERS MOST, and it exists
 * because of a copy decision. Josh ruled the IP out of what the screen says, so
 * a reader can no longer check the payload against the words -- which means the
 * only thing keeping those sentences honest as the payload changes is a test
 * that fails when a field is added. (Mona Lisa's rule 3.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-ping-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const ping = require('./ping');

function fresh() { try { fs.unlinkSync(ping.FILE); } catch { /* none */ } }

test('nobody has been asked yet, so it is on', () => {
  fresh();
  assert.equal(ping.read().on, true);
});

test('a preference we cannot read sends NOTHING', () => {
  fresh();
  fs.writeFileSync(ping.FILE, '{ not json');
  const r = ping.read();
  /* ⚠️ THE OPPOSITE DIRECTION FROM THE SHIPPED DEFAULT, deliberately. Absent
     means nobody has chosen; corrupt means somebody may have turned it off and
     we cannot see which. The only act gated here sends something off the
     machine, so an unreadable answer is not consent. */
  assert.equal(r.on, false);
  assert.equal(r.ok, false);
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 0, 'an unreadable preference was read as permission to send');
});

test('what leaves is the event and never its contents', () => {
  fresh();
  const body = ping.payload();
  /**
   * 🛑 PINNED BY EXACT KEY SET. Adding a field makes this fail, and that is the
   * mechanism rather than a nuisance: the screen no longer enumerates what is
   * sent, so nothing else can notice a change. Whoever adds a key has to come
   * here, and coming here is the prompt to go and re-read the welcome line and
   * the checkbox label.
   */
  assert.deepEqual(Object.keys(body).sort(), ['at', 'event', 'installId', 'os', 'version']);
  const flat = JSON.stringify(body).toLowerCase();
  for (const forbidden of ['name', 'role', 'instruction', 'model', 'project', 'prompt', 'email']) {
    assert.ok(!flat.includes('"' + forbidden), 'the payload carries a ' + forbidden);
  }
});

test('the install id is random, kept, and not derived from the machine', () => {
  fresh();
  const a = ping.installId();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(ping.installId(), a, 'a second call made a second install');
  /* ⚠️ It must not be a fingerprint. A hash of the hostname would be just as
     stable and would also identify this COMPUTER across reinstalls and across
     products; random identifies an install and nothing else. */
  const host = require('node:crypto').createHash('sha256').update(os.hostname()).digest('hex');
  assert.ok(!host.startsWith(a.replace(/-/g, '').slice(0, 8)), 'the id looks derived from the hostname');
});

test('unticking the box sends nothing, and does not change the standing setting', () => {
  fresh();
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: false });
  assert.equal(sent, 0, 'an unticked box still sent');
  assert.equal(ping.read().on, true, 'unticking one box turned the whole thing off');
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 1, 'the next one, with the box ticked, did not send');
});

test('turning it off in Settings beats a ticked box', () => {
  fresh();
  assert.deepEqual(ping.setOn(false), { ok: true });
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 0, 'the standing setting was overridden by a box somebody did not think about');
});

test('a network failure is invisible to the caller', async () => {
  fresh();
  ping.setSender(() => Promise.reject(new Error('no such host')));
  /* 🛑 THE PERSON ASKED FOR AN AGENT, NOT FOR A REPORT. This returns nothing at
     all, so no future edit can make a creation await it, and a rejection has
     nowhere to surface. */
  assert.equal(ping.agentCreated({ wanted: true }), undefined);
  ping.setSender(() => { throw new Error('synchronous boom'); });
  assert.equal(ping.agentCreated({ wanted: true }), undefined, 'a synchronous throw reached the caller');
  await new Promise((r) => setTimeout(r, 20));   // let any unhandled rejection surface
});

test('it posts to the Kosmos endpoint, as JSON', () => {
  fresh();
  let seen = null;
  ping.setSender((url, init) => { seen = { url, init }; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(seen.url, ping.DEFAULT_ENDPOINT);
  assert.equal(seen.init.method, 'POST');
  assert.match(seen.init.headers['content-type'], /application\/json/);
  assert.deepEqual(Object.keys(JSON.parse(seen.init.body)).sort(),
    ['at', 'event', 'installId', 'os', 'version']);
  /* A hung host must not hold a socket open forever on somebody's machine. */
  assert.ok(seen.init.signal, 'the request has no timeout');
});

test('a test run never reaches the real network', () => {
  /**
   * 🛑 THE DEFECT THIS PINS ALREADY HAPPENED. `server.test.js` creates agents
   * through the real route, so the moment this feature was wired the suite
   * began POSTing to installkosmos.com on every run -- putting fake installs
   * into the number Josh reads off the homepage. Caught because the live
   * counter said 2 after one deliberate ping.
   */
  fresh();
  assert.equal(ping.underTest(), true, 'the runner signal is gone, so this test proves nothing');
  ping.setSender(null);
  let reached = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { reached += 1; return Promise.resolve(); };
  try {
    ping.agentCreated({ wanted: true });
    assert.equal(reached, 0, 'a test run reached the network');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the welcome screen names this as an outbound destination, and agrees with the payload', () => {
  /**
   * 🛑 MONA LISA'S RULE 3, AND THE ONLY MECHANISM LEFT THAT CAN ENFORCE IT.
   * Josh ruled the word IP off every screen, so a reader can no longer check
   * what is sent against what is written. The welcome screen's own guardian
   * comment says that paragraph "goes wrong when a FEATURE changes what is
   * true" -- this feature is that, and this test is what notices next time.
   *
   * ⚠️ IT ASSERTS A RELATIONSHIP, NOT A SENTENCE. Pinning the wording would
   * turn every copy edit into a failing test and teach people to update the
   * test rather than re-read the screen. What it pins is that the screen SAYS
   * something leaves, and that the payload has not grown a field the screen
   * does not cover.
   */
  const fs2 = require('node:fs');
  const page = fs2.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const pane = page.slice(page.indexOf('id="fr-pane-2"'), page.indexOf('<!-- 4. The machine checks'));
  const words = pane.replace(/<!--[\s\S]*?-->/g, '');

  assert.match(words, /we're told that it happened/,
    'the welcome screen no longer says anything leaves when an agent is made');
  assert.match(words, /you can turn it off/,
    'it names the sending without naming the way out');

  /* The payload's shape, restated as a relationship: every key it carries is
     either the event itself, the install identity, or something the screen's
     "roughly where from" and version-neutral wording already covers. A NEW
     kind of field -- anything about the agent or the person -- has no cover
     and this list is where somebody has to come and say so. */
  const covered = ['event', 'installId', 'at', 'version', 'os'];
  assert.deepEqual(Object.keys(ping.payload()).sort(), covered.slice().sort(),
    'the payload grew a field the welcome screen does not cover; change the screen or drop the field');
});
