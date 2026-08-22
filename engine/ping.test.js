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
