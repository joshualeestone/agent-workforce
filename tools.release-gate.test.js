'use strict';

/**
 * After 0.2.99 comes 0.3.0, and the release script refuses anything else.
 *
 * 🔑 Josh, 2026-08-22: "since we are getting close, when we get to 0.2.99 then
 * lets roll to 0.3.00". A rule in a card depends on whoever is awake at 0.2.99
 * having read it, and at the current rate that is three weeks and several
 * people from now. The version is a bare argument to the script, so nothing
 * else stops `0.2.100` being typed at the one moment nobody is thinking about
 * it, and by then it is published and polled by every install.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'tools', 'release.sh');

test('a version past the end of the 0.2 line is refused, actually run', () => {
  /* ⚠️ RUN RATHER THAN READ, and it is safe to run because the guard is the
     first thing after the usage line: it exits before the script fetches,
     bumps, builds or touches the site. */
  const r = spawnSync('bash', [SCRIPT, '0.2.100'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /past the end of the 0\.2 line/);
});

test('an ordinary next version is not refused by the gate', () => {
  /* 🔑 THE POSITIVE CONTROL, and without it the test above passes on a script
     that refuses everything. This one gets PAST the gate and stops at the first
     real step, which is what "not blocked by the gate" looks like from here. */
  const r = spawnSync('bash', [SCRIPT, '0.2.79'], { encoding: 'utf8' });
  const said = r.stdout + r.stderr;
  assert.ok(!/end of the 0\.2 line|last of the 0\.2 line/.test(said),
    'the gate refused an ordinary version: ' + said.slice(0, 200));
  assert.match(said, /main, clean, and carrying what you mean to ship/);
});

test('standing at 0.2.99, only 0.3.0 is accepted', () => {
  /* ⚠️ TEXT, NOT BEHAVIOUR, and the reason is worth stating rather than
     hiding: exercising this arm means writing 0.2.99 into package.json, and a
     test that edits the file every release reads is a worse risk than the one
     it covers. The arm was driven by hand at both values when it was written
     (0.2.100 refused, 0.3.0 passed through). What this pins is that it is still
     there and still names the only accepted successor. */
  const s = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(s, /\[ "\$_prev" = "0\.2\.99" \] && \[ "\$V" != "0\.3\.0" \]/);
  /* ⚠️ AND IT REFUSES RATHER THAN CORRECTING. Silently shipping 0.3.0 when
     somebody asked for 0.2.100 is a release nobody named, and the entry they
     already wrote on the versions page is stamped with what they typed. */
  assert.match(s, /exit 1/);
  assert.ok(!/V="0\.3\.0"/.test(s), 'the gate rewrites the version instead of refusing it');
});
