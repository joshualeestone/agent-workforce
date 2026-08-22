const test = require('node:test');
const assert = require('node:assert/strict');
const update = require('./update');
const { version: RUNNING } = require('../package.json');

test.beforeEach(() => { update.resetCache(); update.setFetcher(null); update.setBase(null); });

test('newer(): strictly numeric dotted-triple, and unknown loses', () => {
  assert.equal(update.newer('0.1.1', '0.1.0'), true);
  assert.equal(update.newer('0.2.0', '0.1.9'), true);
  assert.equal(update.newer('1.0.0', '0.9.9'), true);
  assert.equal(update.newer('0.1.0', '0.1.0'), false);
  assert.equal(update.newer('0.1.0', '0.1.1'), false);
  // ⚠️ Unknown NEVER wins: a corrupted manifest cannot pop a toast.
  assert.equal(update.newer('banana', '0.0.0'), false);
  assert.equal(update.newer('0.2', '0.1.0'), false);
  assert.equal(update.newer('0.1.1-rc1', '0.1.0'), false);
  assert.equal(update.newer('', '0.1.0'), false);
  assert.equal(update.newer('1e3.0.0', '0.1.0'), false);
});

test('available() reports a newer published version, and only a newer one', async () => {
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  await update.refresh();
  assert.deepEqual(update.available(), { version: '99.0.0' });

  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.available(), null, 'the running version showed as an update');

  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '0.0.1' }) }));
  await update.refresh();
  assert.equal(update.available(), null, 'an OLDER published version showed as an update');
});

test('every failure is soft: no network, bad status, bad JSON, bad shape', async () => {
  for (const [label, f] of [
    ['a thrown fetch', async () => { throw new Error('offline'); }],
    ['a non-ok response', async () => ({ ok: false, json: async () => ({}) })],
    ['unparseable JSON', async () => ({ ok: true, json: async () => { throw new Error('nope'); } })],
    ['a version that is not a string', async () => ({ ok: true, json: async () => ({ version: 42 }) })],
    ['a malformed version string', async () => ({ ok: true, json: async () => ({ version: 'latest' }) })],
  ]) {
    update.resetCache();
    update.setFetcher(f);
    await update.refresh().catch(() => { /* the thrown-fetch case */ });
    assert.equal(update.available(), null, `${label} produced an update notice`);
  }
});

test('a down host is asked once per cache window, not once per status tick', async () => {
  let calls = 0;
  update.setFetcher(async () => { calls += 1; return { ok: false, json: async () => ({}) }; });
  await update.refresh();
  // poke() must see the fresh (miss) cache and not fetch again.
  update.poke();
  update.poke();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 1, 'poke() re-fetched inside the cache window');

  // ⚠️ And a host that THROWS (offline, DNS, abort), not just one that
  // answers badly: the attempt stamp used to sit after the await, so a
  // rejecting fetch never stamped and the five-second status poll asked a
  // dead host forever.
  update.resetCache();
  let throws = 0;
  update.setFetcher(async () => { throws += 1; throw new Error('offline'); });
  await update.refresh().catch(() => { });
  update.poke();
  update.poke();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(throws, 1, 'a throwing fetch is retried inside the cache window');
});

/* ---------------------------------------------------------------------------
 * update-control: reachability, checkNow, and the 15-minute TTL.
 * ------------------------------------------------------------------------ */

test('reachability is its own fact: could-not-reach never reads as up-to-date', async () => {
  // Never looked: not reached, and LOOKED false -- the boot contract the
  // card's Checking arm renders (asserted against what lastLook actually
  // emits, not a hand-built literal).
  assert.deepEqual(update.lastLook(), { reached: false, readable: false, at: 0, looked: false });
  // A look that got an answer (even "nothing newer") is reached.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  const after = update.lastLook();
  assert.equal(after.reached, true, 'a successful look did not read as reached');
  assert.equal(after.looked, true, 'a completed look still reads as first-look-in-flight');
  assert.ok(after.at > 0, 'the look left no timestamp');
  assert.equal(update.available(), null, 'CONTROL: no offer, which is exactly the up-to-date case');
  // The next look fails: reached flips false even though a cached answer exists.
  update.setFetcher(async () => { throw new Error('offline'); });
  await update.refresh().catch(() => {});
  assert.equal(update.lastLook().reached, false,
    'an unreachable host still read as reached (would render "up to date" while offline)');
});

test('checkNow bypasses the TTL and answers fresh, with reachability', async () => {
  // Prime the cache with a fresh successful look...
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.lastLook().reached, true);
  // ...then change the world: poke() would sit on the TTL, checkNow asks anyway.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.poke();
  // Settled first: poke's refresh is async, and an unsettled assertion
  // would pass even with the TTL gate deleted (the control could not fail).
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(update.available(), null,
    'CONTROL: poke inside the TTL refreshed anyway, so checkNow proves nothing');
  const out = await update.checkNow();
  assert.deepEqual(out, { running: RUNNING, latest: '99.0.0', reached: true, readable: true });
  assert.deepEqual(update.available(), { version: '99.0.0' },
    'the fresh answer did not land in the cache the toast reads');
  // And a checkNow that cannot reach says so rather than throwing.
  update.setFetcher(async () => { throw new Error('offline'); });
  const down = await update.checkNow();
  assert.equal(down.reached, false);
  assert.equal(down.running, RUNNING, 'the running version vanished from an unreachable answer');
});

test('a reachable host with an unusable answer is readable:false, never up-to-date material', async () => {
  // The captive-portal shape: 200 with a splash page (unparseable body).
  update.setFetcher(async () => ({ ok: true, json: async () => { throw new Error('html'); } }));
  await update.refresh();
  const look = update.lastLook();
  assert.equal(look.reached, true, 'a host that answered read as unreached');
  assert.equal(look.readable, false, 'an unusable answer read as usable');
  // And a non-ok answer (CDN 404/500): the host WAS reached; blaming the
  // network would name the wrong leg.
  update.setFetcher(async () => ({ ok: false, json: async () => ({}) }));
  await update.refresh();
  assert.equal(update.lastLook().reached, true, 'an errored answer read as could-not-reach');
  assert.equal(update.lastLook().readable, false, 'an errored answer read as usable');
  assert.equal(update.available(), null, 'CONTROL: no offer, the exact case the card maps');
  // And a good answer flips readable back.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.lastLook().readable, true);
});

test('the fifteen-minute promise, asserted on the exported value', () => {
  assert.equal(update.TTL, 15 * 60 * 1000, 'the check interval drifted from the promised fifteen minutes');
});

/* ---- the automatic half of the update switch --------------------------
   Josh, 2026-08-22: "the switch should be on the updates to be automatically
   update Kosmos". These fix WHEN it fires, and the three refusals matter more
   than the fire: this is the one path in the product that runs software with
   nobody watching. */

function autoSetup({ latest, pref, root }) {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: latest }) }));
  update.setInstalledRoot(() => root);
  update.setAutoPref(() => pref);
  let started = 0;
  update.setInstallRunner(() => { started += 1; });
  return () => started;
}

test.afterEach(() => {
  update.setInstalledRoot(null);
  update.setAutoPref(null);
  update.setInstallRunner(null);
});

test('a look that finds a newer version installs it when the switch is on', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 1, 'the switch is on and a newer version went uninstalled');
});

test('the switch off means the same look installs nothing', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: false, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 0, 'software installed itself against the person\'s choice');
  // and the offer is still THERE -- off means "do not install", not "do not tell me".
  assert.deepEqual(update.available(), { version: '99.0.0' },
    'turning off automatic updates also silenced the notice, which is a different setting');
});

test('an unreadable preference installs nothing', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: false, ok: false }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 0);
});

test('a from-source checkout is never auto-installed over', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: null });
  await update.refresh();
  assert.equal(started(), 0, 'the installer was pointed at a working tree');
});

test('nothing newer, nothing installed', async () => {
  const started = autoSetup({ latest: RUNNING, pref: { on: true, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 0);
});

test('a preference that throws costs the update notice nothing', async () => {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => { throw new Error('bad mount'); });
  update.setInstallRunner(() => {});
  await update.refresh();
  assert.deepEqual(update.available(), { version: '99.0.0' },
    'a preference we could not read broke the notice that does not depend on it');
});

test('repeated looks cannot stack installers', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  await update.refresh();
  await update.refresh();
  assert.equal(started(), 1, 'three looks ran three installers over each other');
});

test('an automatic install that keeps failing does not retry every look', async () => {
  /**
   * 🛑 THE LOOP THIS CLOSES IS UNATTENDED, WHICH IS WHAT MAKES IT BAD. A
   * machine that cannot install -- no write permission, a full disk, a blocked
   * release host -- would spawn a fresh `curl | sh` on every fifteen-minute
   * look, forever, with nobody watching. `beginInstall` releases its
   * single-flight flag on a non-zero exit so a PERSON can press Install again,
   * and that release is exactly what handed the automatic path an unbounded
   * retry.
   */
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => ({ on: true, ok: true }));
  let started = 0;
  /* A runner that FAILS the way a real one does: the spawn succeeds and the
     child exits non-zero, which is what releases the flag. */
  update.setInstallRunner(() => {
    started += 1;
    return { on: (evt, fn) => { if (evt === 'exit') setTimeout(() => fn(1), 0); }, unref() {} };
  });

  await update.refresh();
  assert.equal(started, 1, 'the premise: the first look does try');
  await new Promise((r) => setTimeout(r, 5));   // let the exit handler run

  /* ⚠️ NOT `resetCache()` BETWEEN LOOKS, which is what the first version of
     this test did -- and `resetCache` clears the backoff stamp, so the test
     wiped the very state it was asserting about and read the result as the
     code failing. `refresh()` called directly is the real second look: it
     bypasses the TTL the same way the background poll eventually does, and
     touches nothing else. */
  await update.refresh();
  assert.equal(started, 1, 'a failed automatic install retried on the very next look');

  update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null);
});

test('a PERSON whose install fails does not suppress the next automatic one', async () => {
  /**
   * 🔑 THE OBSERVABLE HARM OF STAMPING THE BACKOFF ON BOTH PATHS is not that
   * the button stops working -- `beginInstall` never consults the stamp -- it
   * is that ONE failed press by a person would silence the unattended path for
   * an hour on a machine that could have installed perfectly well a minute
   * later. So the test has to be about the AUTO attempt that follows a MANUAL
   * failure, which is where the difference shows.
   */
  update.resetCache();
  let started = 0;
  const failing = () => {
    started += 1;
    return { on: (evt, fn) => { if (evt === 'exit') setTimeout(() => fn(1), 0); }, unref() {} };
  };
  update.setInstallRunner(failing);

  update.beginInstall();                       // as the route calls it: no `auto`
  assert.equal(started, 1, 'the premise: the press tried');
  await new Promise((r) => setTimeout(r, 5));  // its exit releases the flag

  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => ({ on: true, ok: true }));
  await update.refresh();
  assert.equal(started, 2,
    'a person\'s failed press put the UNATTENDED path into a backoff it never earned');

  update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null);
});

/**
 * The one command in this product that ends in `| sh`.
 *
 * 🛑 NOTHING EXERCISED OR CHECKED IT. Every test that reaches `beginInstall`
 * injects `installRunner`, which replaces the spawn entirely, so the real
 * command was never built, never run and never asserted. That is the highest
 * consequence line in the codebase and it had the least coverage of any line
 * near it.
 *
 * 🔑 THE PROPERTY IS SYNTACTIC, so the check reads the source rather than
 * running it. "This value must not be interpolated into a shell string" is a
 * fact about the TEXT, and the only way to observe it at runtime would be to
 * actually execute a hostile URL. The URL travels as a positional parameter
 * (`sh -c '... "$1"' sh <url>`), which is what makes a base containing
 * `; rm -rf ~` an argument rather than a command.
 *
 * ⚠️ AND THE BASE IS OVERRIDABLE. `setBase` and `KOSMOS_RELEASE_BASE` exist for
 * staging, so the URL is not a constant this file controls. That is exactly why
 * the shape matters rather than being belt-and-braces.
 */
const SRC = require('node:fs').readFileSync(require('node:path').join(__dirname, 'update.js'), 'utf8');

test('the installer URL is a positional parameter, never interpolated into the shell string', () => {
  const at = SRC.indexOf("spawn('/bin/sh'");
  assert.ok(at > -1, 'the installer spawn is gone or no longer uses /bin/sh directly');
  const call = SRC.slice(at, SRC.indexOf(')', SRC.indexOf('setupUrl()', at)) + 1);

  /* The safe shape, asserted positively first: the command references `$1` and
     the URL rides as its own argv element after the `sh` argv[0] filler. */
  assert.match(call, /'-c',\s*'curl -fsSL "\$1" \| sh',\s*'sh',\s*setupUrl\(\)/,
    'the installer command is no longer the reviewed shape: ' + call);

  /* And the unsafe shapes, by name. A template literal or a concatenation
     inside the `-c` string is the whole failure: it turns a release base into
     shell. */
  const dashC = call.slice(call.indexOf("'-c'"), call.indexOf("'sh',"));
  assert.ok(!/\$\{/.test(dashC), 'the command string interpolates: ' + dashC);
  assert.ok(!/\+/.test(dashC), 'the command string concatenates: ' + dashC);
  assert.ok(!/setupUrl/.test(dashC), 'the URL is inside the command string rather than beside it');
});

test('a hostile release base cannot become a command', () => {
  /* 🔑 THE CONTROL, and it exercises the real builder rather than restating it.
     `setupUrl()` is what feeds that positional parameter, so a base carrying
     shell metacharacters must come back as a URL string and nothing else. What
     makes it harmless is its POSITION, which the test above pins; this pins
     that nothing sanitises it into looking harmless while the position changes
     underneath. */
  update.setBase('https://example.com/dist"; rm -rf ~; echo "');
  const url = update.setupUrl();
  assert.match(url, /rm -rf ~/, 'the base was silently rewritten, so this test no longer proves anything');
  assert.ok(!url.includes('\n'), 'the URL carries a newline, which no positional parameter should');
  update.setBase(null);
});
