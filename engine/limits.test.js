'use strict';

const os = require('node:os');
const SANDBOX = require('node:path').join(os.tmpdir(), 'kosmos-limits-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const limits = require('./limits');

test.beforeEach(() => { try { fs.rmSync(limits.FILE, { force: true }); } catch { /* fresh */ } });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('no file is the true default, ON at the shipped tier, and reads ok', () => {
  assert.deepEqual(limits.read(), { on: true, perHour: 20, ok: true });
  const caps = limits.caps();
  assert.equal(caps.on, true);
  assert.equal(caps.pairPerWindow, 20);
  assert.equal(caps.roomArrivalsPerWindow, 80);
  assert.equal(caps.windowMs, 60 * 60 * 1000);
});

test('the shipped default equals the previously hard-coded rate: nothing changes for existing fleets', () => {
  // 10 exchanges per 30 minutes == 20 per hour; 40 arrivals per 30
  // minutes == 80 per hour. Josh's ship-on ruling depends on this row.
  assert.equal(limits.DEFAULTS.perHour, 20);
  assert.equal(limits.DEFAULTS.perHour * limits.ROOM_FACTOR, 80);
});

test('an unreadable or malformed file fails toward ON at the default, and says ok:false', () => {
  fs.mkdirSync(SANDBOX, { recursive: true });
  for (const bad of ['{not json', '"a string"', '{"on":"yes","perHour":20}', '{"on":true,"perHour":33}', 'null']) {
    fs.writeFileSync(limits.FILE, bad);
    const r = limits.read();
    assert.equal(r.on, true, 'a bad file turned the brake OFF: ' + bad);
    assert.equal(r.perHour, 20);
    assert.equal(r.ok, false, 'a bad file read as a clean default: ' + bad);
  }
});

test('write validates in words and round-trips, and caps derive from the dial', () => {
  assert.match(limits.write({ on: 'yes', perHour: 20 }).because, /on or off/);
  assert.match(limits.write({ on: true, perHour: 15 }).because, /listed amounts/);
  assert.equal(limits.write({ on: false, perHour: 100 }).ok, true);
  assert.deepEqual(limits.read(), { on: false, perHour: 100, ok: true });
  const caps = limits.caps();
  assert.equal(caps.on, false);
  assert.equal(caps.pairPerWindow, 100);
  assert.equal(caps.roomArrivalsPerWindow, 400);
});
