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
  assert.match(r.because, /not readable as JSON/);
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
