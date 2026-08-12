'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ Sandbox BEFORE requiring: the module reads its path at load, and the real
// file is the operator's own Claude account.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sub-test-'));
const CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = CONFIG;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const sub = require('./subscription');

const write = (obj) => fs.writeFileSync(CONFIG, JSON.stringify(obj, null, 2), 'utf8');
const clear = () => { try { fs.rmSync(CONFIG, { force: true }); } catch { /* fine */ } };

test('a paying customer is never told they have no subscription', () => {
  /**
   * ⚠️ THE WHOLE REASON THIS MODULE EXISTS, and the fixture is not invented —
   * it is this machine's real config shape, measured on a working Claude Max
   * 20x account:
   *
   *     hasAvailableSubscription   false      <-- the obvious field
   *     organizationType           claude_max
   *     billingType                stripe_subscription
   *
   * A check keyed on the obvious field tells somebody who pays that they do
   * not, on the screen that decides whether they keep the product.
   */
  write({
    hasAvailableSubscription: false,
    oauthAccount: {
      organizationType: 'claude_max',
      billingType: 'stripe_subscription',
      organizationRateLimitTier: 'default_claude_max_20x',
    },
  });

  const r = sub.check();
  assert.equal(r.state, sub.STATE.CONNECTED,
    'a live Max account was reported as not connected, which is the defect this module exists to prevent');
  assert.equal(r.plan, 'Claude Max 20x', 'the plan is not named, or named as a raw enum');

  // ⚠️ CONTROL: the trap field really is false in this fixture, or the test
  // passes against a config that never posed the problem.
  assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).hasAvailableSubscription, false,
    'the fixture does not contain the trap, so this proves nothing');
});

test('no Claude on the machine at all is a real answer', () => {
  clear();
  const r = sub.check();
  assert.equal(r.state, sub.STATE.NONE);
  assert.match(r.because, /has not been set up/);
});

test('an account with no subscription is told so plainly', () => {
  write({ oauthAccount: { organizationType: 'claude_free' } });
  const r = sub.check();
  assert.equal(r.state, sub.STATE.NONE);
  assert.match(r.because, /no Claude subscription is connected/);
});

test('a plan we do not recognise is UNKNOWN, not "you have nothing"', () => {
  /**
   * ⚠️ THE LIST WILL GO OUT OF DATE. A new plan name, or a rename, and this
   * module stops recognising a real subscriber. The question is which way it
   * fails when that happens — and `billingType` is the evidence that somebody
   * is paying even when the plan name means nothing to us.
   */
  write({ oauthAccount: { organizationType: 'claude_something_new', billingType: 'stripe_subscription' } });
  const r = sub.check();
  assert.equal(r.state, sub.STATE.UNKNOWN,
    'an unrecognised paid plan was reported as having no subscription');
  assert.match(r.because, /do not recognise/);
});

test('settings we cannot read are UNKNOWN, never "no subscription"', () => {
  write({ oauthAccount: { organizationType: 'claude_max' } });
  fs.writeFileSync(CONFIG, '{ this is not json', 'utf8');
  const r = sub.check();
  assert.equal(r.state, sub.STATE.UNKNOWN,
    'an unreadable config was reported as a definite answer about somebody\'s account');
  assert.match(r.because, /damaged/);
});

test('a config with no account block is UNKNOWN rather than an assertion', () => {
  // Likely means nobody has signed in; possibly means a shape we have not seen.
  // Only one of those is safe to assert, and the screen offers to connect either way.
  write({ someOtherThing: true });
  assert.equal(sub.check().state, sub.STATE.UNKNOWN);
});

test('the plan is named for a person, and skipped rather than guessed', () => {
  assert.equal(sub.planName('claude_max', 'default_claude_max_20x'), 'Claude Max 20x');
  assert.equal(sub.planName('claude_pro', undefined), 'Claude Pro');
  // ⚠️ A tier shape we do not recognise drops the suffix rather than printing
  // it raw. "Claude Max default_claude_max_5x_beta" is worse than "Claude Max".
  assert.equal(sub.planName('claude_max', 'something_unexpected'), 'Claude Max');
  assert.equal(sub.planName('not_a_plan', 'x'), null);
});

test('an unrecognised plan with NO billing field is still unknown', () => {
  /**
   * ⚠️ THE FIXTURE ABOVE CARRIES `billingType`, WHICH IS THE ONE FIELD THIS FIX
   * DELIBERATELY STOPPED DEPENDING ON — so it reaches `unknown` through the
   * older fall-through and would go on passing with the guard deleted.
   * Measured: disabling the unrecognised-plan branch left the whole suite green
   * while this shape went back to "no Claude subscription is connected".
   *
   * `authMethod` and `apiProvider` are documented as evidence and are absent
   * from the config on this machine, so "a field we expected is not in this
   * shape" is the normal case here, not the exotic one.
   */
  write({ oauthAccount: { organizationType: 'claude_something_new' } });
  const r = sub.check();
  assert.equal(r.state, sub.STATE.UNKNOWN,
    'an unrecognised plan with no billing field was reported as having no subscription');
});

test('an account that names no plan at all is unknown, not "you have nothing"', () => {
  /**
   * ⚠️ REACHABLE, AND MEASURED ON A REAL CONFIG SHAPE: an `oauthAccount` with
   * `accountUuid` / `emailAddress` / `organizationUuid` and none of the profile
   * fields. This answered `none`, so somebody SIGNED IN was shown "Get a
   * subscription at claude.ai, then sign in to Claude on this computer."
   *
   * ⚠️ And the asymmetry was backwards: the no-account-block branch already
   * answered `unknown` for strictly weaker evidence, so HAVING an account was
   * treated as more damning than having none.
   */
  write({ oauthAccount: { accountUuid: 'x', emailAddress: 'a@b.c', organizationUuid: 'y' } });
  const r = sub.check();
  assert.equal(r.state, sub.STATE.UNKNOWN,
    'a signed-in account with no plan named was told it has no subscription');
  assert.ok(!/no Claude subscription is connected/.test(r.because),
    'the customer-losing sentence is still reachable');

  // The control: a plan we DO recognise as unsubscribed still says so plainly,
  // or the assertions above have simply removed the negative answer entirely.
  write({ oauthAccount: { organizationType: 'claude_free' } });
  assert.equal(sub.check().state, sub.STATE.NONE,
    'nothing produces the negative any more, so the assertions above prove nothing');
});

/* ---- the cached read ------------------------------------------------------
   ⚠️ These test the cache's LYING failure mode, not its speed. A stale cache
   here keeps reporting `connected` after the connection breaks, which is the
   one case the whole feature exists to catch, so every invalidation path gets a
   test and the "did not re-read" claim is MEASURED rather than assumed. */

const MAX = {
  oauthAccount: { organizationType: 'claude_max', billingType: 'stripe_subscription' },
};

test('the cache re-reads when the file actually changes', () => {
  sub.resetCache();
  write(MAX);
  assert.equal(sub.checkCached().state, sub.STATE.CONNECTED);

  write({ oauthAccount: { organizationType: 'claude_free', billingType: null } });
  assert.equal(sub.checkCached().state, sub.STATE.NONE,
    'a downgrade on disk must be seen, or the board reports a connection that is gone');
});

test('CONTROL: an unchanged file is not parsed again', () => {
  sub.resetCache();
  write(MAX);

  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (...args) => { if (String(args[0]) === CONFIG) reads++; return real(...args); };
  try {
    sub.checkCached();
    const afterFirst = reads;
    sub.checkCached();
    sub.checkCached();
    sub.checkCached();
    // ⚠️ The control half: prove a read HAPPENED before proving one did not.
    assert.equal(afterFirst, 1, 'the first call must actually read the file');
    assert.equal(reads, 1, 'three further calls on an unchanged file must not re-parse it');
  } finally {
    fs.readFileSync = real;
  }
});

test('a DELETED config invalidates rather than serving a stale connection', () => {
  sub.resetCache();
  write(MAX);
  assert.equal(sub.checkCached().state, sub.STATE.CONNECTED);

  clear();
  const after = sub.checkCached();
  assert.notEqual(after.state, sub.STATE.CONNECTED,
    'signing out must not keep reporting a live subscription');
  assert.equal(after.state, sub.STATE.NONE);
});

test('an UNREADABLE config becomes unknown, and does not stay connected', () => {
  sub.resetCache();
  write(MAX);
  assert.equal(sub.checkCached().state, sub.STATE.CONNECTED);

  fs.writeFileSync(CONFIG, '{ this is not json', 'utf8');
  const after = sub.checkCached();
  assert.equal(after.state, sub.STATE.UNKNOWN,
    'a corrupt config is us being unable to look, not a confident verdict either way');
  assert.notEqual(after.state, sub.STATE.CONNECTED);
});

test('an ATOMIC REPLACE is caught at byte-identical size AND mtime', () => {
  /**
   * ⚠️ THE INODE ARM OF THE CACHE KEY, and the first version of this test did
   * not test it. It wrote the replacement, copied the old mtime with
   * `utimesSync`, and asserted. That looked right and proved nothing:
   * `utimesSync` does not preserve sub-millisecond precision, so
   *
   *     before  mtimeMs 1786542542019.6838
   *     after   mtimeMs 1786542542020
   *
   * The timestamps DIFFERED, so an mtime-only key caught the swap and the test
   * passed with the inode guard deleted. Measured, after the mutation run said
   * the test was theatre.
   *
   * So both nuisance variables are pinned by force here: the mtime is set to a
   * whole second on BOTH files so `mtimeMs` is exactly equal, and the two
   * payloads are padded to identical byte length. What is left is the inode,
   * which is the only thing that can distinguish them.
   */
  sub.resetCache();

  const connected = JSON.stringify({ oauthAccount: { organizationType: 'claude_max', billingType: 'stripe_subscription' } });
  let free = JSON.stringify({ oauthAccount: { organizationType: 'claude_free', billingType: null } });
  // JSON tolerates trailing whitespace, so pad to an identical byte count.
  assert.ok(free.length <= connected.length, 'pad the shorter payload, not the longer');
  free += ' '.repeat(connected.length - free.length);
  assert.equal(Buffer.byteLength(free), Buffer.byteLength(connected), 'sizes must match for this test to mean anything');

  const STAMP = new Date(Math.floor(Date.now() / 1000) * 1000);   // whole second

  fs.writeFileSync(CONFIG, connected, 'utf8');
  fs.utimesSync(CONFIG, STAMP, STAMP);
  const before = fs.statSync(CONFIG);
  assert.equal(sub.checkCached().state, sub.STATE.CONNECTED);

  const tmp = CONFIG + '.tmp';
  fs.writeFileSync(tmp, free, 'utf8');
  fs.utimesSync(tmp, STAMP, STAMP);
  fs.renameSync(tmp, CONFIG);
  const after = fs.statSync(CONFIG);

  // ⚠️ Assert the SETUP before asserting the behaviour. If these drift, the test
  // silently stops testing the inode and starts passing for the wrong reason,
  // which is exactly what happened the first time.
  assert.equal(after.mtimeMs, before.mtimeMs, 'setup failed: mtime must be identical');
  assert.equal(after.size, before.size, 'setup failed: size must be identical');
  assert.notEqual(after.ino, before.ino, 'setup failed: the inode must have changed');

  assert.equal(sub.checkCached().state, sub.STATE.NONE,
    'a replaced file must be re-read even when size and timestamp are byte-identical');
});

test('an IN-PLACE rewrite of different length is caught at an identical mtime', () => {
  /**
   * ⚠️ THE SIZE ARM, which the mutation run showed was covered by nothing. With
   * the inode arm tested and this one not, `size` was untested defensive code,
   * and untested defensive code is the thing this repo keeps finding in its own
   * guards. So it is either tested or it should not be there.
   *
   * The case it alone catches: a rewrite IN PLACE (same inode, so no rename)
   * whose mtime lands in the same tick, but whose length changes. Rare, and
   * cheap to pin, so it is pinned.
   */
  sub.resetCache();

  const STAMP = new Date(Math.floor(Date.now() / 1000) * 1000);
  const connected = JSON.stringify({ oauthAccount: { organizationType: 'claude_max', billingType: 'stripe_subscription' } });
  const free = JSON.stringify({ oauthAccount: { organizationType: 'claude_free' } });
  assert.notEqual(Buffer.byteLength(free), Buffer.byteLength(connected), 'this test needs the lengths to differ');

  fs.writeFileSync(CONFIG, connected, 'utf8');
  fs.utimesSync(CONFIG, STAMP, STAMP);
  const before = fs.statSync(CONFIG);
  assert.equal(sub.checkCached().state, sub.STATE.CONNECTED);

  fs.writeFileSync(CONFIG, free, 'utf8');        // same path, same inode
  fs.utimesSync(CONFIG, STAMP, STAMP);           // put the clock back
  const after = fs.statSync(CONFIG);

  assert.equal(after.mtimeMs, before.mtimeMs, 'setup failed: mtime must be identical');
  assert.equal(after.ino, before.ino, 'setup failed: the inode must NOT have changed');
  assert.notEqual(after.size, before.size, 'setup failed: the size must differ');

  assert.equal(sub.checkCached().state, sub.STATE.NONE,
    'a same-inode rewrite at the same mtime must still be seen');
});


test('no user-facing sentence uses developer jargon', () => {
  /**
   * ⚠️ A MECHANISM, NOT A ONE-OFF FIX. Josh caught "the Claude settings on this
   * computer are not readable as JSON" reaching a user, 2026-08-12: "the
   * warnings can't talk about JSON for non-technical people."
   *
   * These strings surface on the first-run screen and the board's connection
   * notice, which are the two screens that decide whether a non-technical
   * person keeps the product. The fix for one string is worth little; what stops
   * the next one is a check that reads every sentence this module can produce.
   *
   * Deliberately a blocklist of words a person would have to be a developer to
   * understand, not a readability score. The bar is "would somebody in the
   * training room know what this means".
   */
  const JARGON = /\b(json|parse[sd]?|null|undefined|oauth|api|token|schema|enum|uuid|stderr|stdout|exit code|regex|config file|stack trace)\b/i;

  const sentences = [];
  const collect = () => { const r = sub.check(); if (r && r.because) sentences.push(r.because); };

  write(MAX); collect();                                             // connected
  write({ oauthAccount: { organizationType: 'claude_free' } }); collect();   // none
  write({ someOtherThing: true }); collect();                        // no account block
  write({ oauthAccount: { organizationType: 'claude_unheard_of' } }); collect();
  write({ oauthAccount: { accountUuid: 'x' } }); collect();
  fs.writeFileSync(CONFIG, '{ broken', 'utf8'); collect();           // damaged
  clear(); collect();                                                // absent

  // CONTROL: the sweep actually produced the sentences it claims to check, or
  // an empty list would pass this test for the wrong reason.
  assert.ok(sentences.length >= 6, `only collected ${sentences.length} sentences`);
  assert.ok(sentences.some((t) => /damaged/.test(t)), 'the damaged-settings case was not reached');

  for (const t of sentences) {
    assert.ok(!JARGON.test(t), `user-facing sentence uses jargon: "${t}"`);
  }
});
