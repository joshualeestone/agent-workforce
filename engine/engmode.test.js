'use strict';

const os = require('node:os');
const SANDBOX = require('node:path').join(os.tmpdir(), 'kosmos-engmode-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const engmode = require('./engmode');

test.beforeEach(() => { try { fs.rmSync(engmode.FILE, { force: true }); } catch { /* fresh */ } });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('no file is OFF and reads ok; a bad file fails toward OFF and says ok:false', () => {
  assert.deepEqual(engmode.read(), { on: false, ok: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  for (const bad of ['{not json', '"str"', '{"on":"yes"}', 'null', '[]']) {
    fs.writeFileSync(engmode.FILE, bad);
    const r = engmode.read();
    assert.equal(r.on, false, 'a bad file revealed a surface the person never chose to show: ' + bad);
    assert.equal(r.ok, false, 'a bad file read as a clean default: ' + bad);
  }
});

test('write validates in words and round-trips', () => {
  assert.match(engmode.write({ on: 'yes' }).because, /on or off/);
  assert.equal(engmode.write({ on: true }).ok, true);
  assert.deepEqual(engmode.read(), { on: true, ok: true });
  assert.equal(engmode.write({ on: false }).ok, true);
  assert.deepEqual(engmode.read(), { on: false, ok: true });
});
