'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Every test gets its own data root BEFORE the module is required, because the
   file path is resolved at load time (same shape as engmode.test.js). */
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-auto-'));
  process.env.AGENT_WORKFORCE_DATA = dir;
  delete require.cache[require.resolve('./autoupdate')];
  return { dir, mod: require('./autoupdate') };
}

test('nobody has chosen yet, so Kosmos keeps itself current', () => {
  const { mod } = fresh();
  assert.deepEqual(mod.read(), { on: true, ok: true },
    'a fresh install must default to updating itself');
});

test('a choice we cannot read does NOT install software', () => {
  const { dir, mod } = fresh();
  fs.writeFileSync(path.join(dir, 'autoupdate.json'), '{ this is not json');
  const r = mod.read();
  assert.equal(r.on, false,
    'an unreadable preference was read as consent to install');
  assert.equal(r.ok, false, 'and the screen is not told it could not be read');

  /* 🔑 THE CONTROL FOR THIS TEST is the one above: absent means ON, corrupt
     means OFF. If both directions ever collapse into one default, exactly one
     of these two tests goes red, which is the whole reason they are a pair. */
});

test('a file that parses but is the wrong shape is also a choice we cannot read', () => {
  const { dir, mod } = fresh();
  fs.writeFileSync(path.join(dir, 'autoupdate.json'), JSON.stringify({ on: 'yes' }));
  assert.deepEqual(mod.read(), { on: false, ok: false });
});

test('turning it off survives a read', () => {
  const { mod } = fresh();
  assert.deepEqual(mod.write({ on: false }), { ok: true });
  assert.deepEqual(mod.read(), { on: false, ok: true },
    'off is a real stored state, not the unreadable one');
  assert.deepEqual(mod.write({ on: true }), { ok: true });
  assert.deepEqual(mod.read(), { on: true, ok: true });
});

test('a switch can only be on or off', () => {
  const { mod } = fresh();
  const r = mod.write({ on: 'true' });
  assert.equal(r.ok, false);
  assert.match(r.because, /on or off/);
});
