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
 *
 * 🛑 EVERY RUN HERE IS AGAINST A COPY, AND THE FIRST VERSION OF THIS FILE WAS
 * NOT. It spawned `tools/release.sh` out of the repo the tests live in, and
 * `release.sh` derives its repo from its own path — so during `yarn release
 * 0.2.80`, step 3 ran the suite, this file ran the real release script with the
 * version in its argument, and that run bumped package.json, committed
 * "v0279 -- version" and PUSHED it, on top of the 0.2.80 bump made ninety
 * seconds earlier. The outer build then stamped the wrong version and the
 * release refused itself.
 *
 * ⚠️ THE LESSON IS NOT "BE CAREFUL WITH THE ARGUMENT". A test that invokes a
 * tool which acts on the tree it lives in has no safe argument: the guard has
 * to be that the tool cannot see that tree at all. So the script is copied into
 * a temp directory with a package.json beside it, which is everything the gate
 * reads, and HOME and KOSMOS_SITE point there too — so the first thing the
 * script needs after the gate, a site checkout, is not there and it stops dead.
 * Before any bump, commit, push, build or deploy, and before it can even reach
 * the operator''s real repository or their real site.
 *
 * ⚠️ AND EVERY CASE ASSERTS THE COPY WAS NOT MODIFIED, because "it exited early"
 * is a claim about behaviour and the file is the evidence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REAL = path.join(__dirname, 'tools', 'release.sh');

/**
 * A disposable repo-shaped directory holding only what the gate reads.
 *
 * `release.sh` resolves its repo as `dirname($0)/..`, so a copy at
 * `<tmp>/tools/release.sh` sees `<tmp>` and nothing of ours.
 */
function sandbox(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gate-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(REAL, path.join(dir, 'tools', 'release.sh'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sandbox', version }, null, 2));
  return dir;
}

function run(dir, version) {
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  /* ⚠️ HOME and the site path are pointed at the sandbox too. The script reads
     `KOSMOS_SITE` and falls back to `$HOME/work/chaoskosmos-site`; a run that
     got further than expected must not find the operator's real site checkout
     sitting where it looks. */
  const r = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), version], {
    encoding: 'utf8',
    cwd: dir,
    env: { ...process.env, HOME: dir, KOSMOS_SITE: path.join(dir, 'nowhere') },
  });
  const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  return { said: (r.stdout || '') + (r.stderr || ''), status: r.status, touched: before !== after };
}

test('a version past the end of the 0.2 line is refused', () => {
  const dir = sandbox('0.2.78');
  const r = run(dir, '0.2.100');
  assert.equal(r.status, 1);
  assert.match(r.said, /past the end of the 0\.2 line/);
  assert.equal(r.touched, false, 'it edited the version before refusing it');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.2.99, anything but 0.3.0 is refused', () => {
  /* The arm that matters, and it is exercised rather than read: the sandbox is
     what makes standing at 0.2.99 free. */
  const dir = sandbox('0.2.99');
  const r = run(dir, '0.2.100');
  assert.equal(r.status, 1);
  assert.match(r.said, /last of the 0\.2 line/);
  assert.match(r.said, /0\.3\.0/, 'the refusal does not name the version it wants');
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.2.99, 0.3.0 gets through', () => {
  /* 🔑 THE POSITIVE CONTROL, and without it every test above passes on a script
     that refuses everything. "Through" means it reached the first thing the
     script needs and stopped there, on a site checkout the sandbox does not
     have — which is one line further than the gate and still before anything
     is read, written or fetched. */
  const dir = sandbox('0.2.99');
  const r = run(dir, '0.3.0');
  assert.ok(!/line/.test(r.said.split('\n')[0] || ''), 'the gate refused the successor it names');
  assert.match(r.said, /no site checkout at/);
  assert.equal(r.touched, false, 'it got far enough to edit the version, which this must never do');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an ordinary next version is not refused', () => {
  const dir = sandbox('0.2.78');
  const r = run(dir, '0.2.79');
  assert.ok(!/end of the 0\.2 line|last of the 0\.2 line/.test(r.said), r.said.slice(0, 200));
  assert.match(r.said, /no site checkout at/);
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('it refuses rather than correcting', () => {
  /* ⚠️ Silently shipping 0.3.0 when somebody asked for 0.2.100 is a release
     nobody named, and the entry they already wrote on the versions page is
     stamped with what they typed. */
  const s = fs.readFileSync(REAL, 'utf8');
  assert.ok(!/V="0\.3\.0"/.test(s), 'the gate rewrites the version instead of refusing it');
});
