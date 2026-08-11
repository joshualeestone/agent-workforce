'use strict';

/**
 * Is a Claude subscription connected on this machine?
 *
 * ⚠️ THIS IS THE FIRST QUESTION FIRST RUN ASKS, AND THE ONE MOST LIKELY TO BE
 * ANSWERED WRONG.
 *
 * The obvious field is `hasAvailableSubscription`. It is a trap. Measured on
 * this machine, on a working Claude Max 20x account, right now:
 *
 *     hasAvailableSubscription   false      <-- the obvious check
 *     organizationType           claude_max
 *     billingType                stripe_subscription
 *     organizationRateLimitTier  default_claude_max_20x
 *
 * So a naive check tells a PAYING CUSTOMER they are not subscribed, on the
 * screen that decides whether they keep the product. There is no recovering
 * from that: they either go and buy a second subscription or they close it.
 *
 * ⚠️ AND `subscriptionType` APPEARS TWICE with different values in some
 * configs — the same field name in two places, one of them `null`. Any check
 * has to say WHICH one it read. This module reads neither.
 *
 * ⚠️ THE RULE THIS MODULE IS BUILT ON, and it is this codebase's rule applied
 * to the highest-stakes screen: **there are three answers, not two.** Connected,
 * not connected, and *we cannot tell* — and "we cannot tell" must never be
 * rendered as "not connected", because the cost of those two mistakes is wildly
 * asymmetric. Telling somebody who has no subscription that we are unsure costs
 * them one extra click. Telling somebody who pays that they do not pay loses
 * them.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();

/**
 * ⚠️ Overridable, so the tests never read the operator's real account — and so
 * this can be pointed at a fixture rather than mocked. `create` and `remove`
 * take their roots the same way.
 */
const CONFIG = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG
  || path.join(HOME, '.claude.json');

const STATE = { CONNECTED: 'connected', NONE: 'none', UNKNOWN: 'unknown' };

/**
 * The positive signals, in the order we trust them.
 *
 * ⚠️ A LIST, not a single field, because any one of them can be absent in a
 * config shape we have not seen. `authMethod` and `apiProvider` are documented
 * in the requirements as evidence and are NOT present in the current config on
 * this machine — so a check that required them would answer `none` for a live
 * Max account today. Absence of a signal is not a negative signal.
 */
const SUBSCRIBED_ORG_TYPES = ['claude_max', 'claude_pro', 'claude_team', 'claude_enterprise'];

/**
 * The plans we positively recognise as NOT subscribed.
 *
 * ⚠️ A SECOND LIST, and it exists so that `none` is something we assert rather
 * than something we fall through to. Anything named that is on neither list is
 * a plan we have not seen, and the honest answer for that is `unknown`.
 */
const UNSUBSCRIBED_ORG_TYPES = ['claude_free', 'free'];

function readConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG, 'utf8');
  } catch (err) {
    // ⚠️ NO FILE is a real answer: Claude Code has never run here, so there is
    // nothing connected. Anything else — a permissions error, an unreadable
    // disk — is us being unable to look, which is not the same thing.
    if (err && err.code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unreadable', because: 'we could not read the Claude settings on this computer' };
  }
  try {
    return { kind: 'ok', data: JSON.parse(raw) };
  } catch {
    return { kind: 'unreadable', because: 'the Claude settings on this computer are not readable as JSON' };
  }
}

/**
 * @returns {{state: string, plan: string|null, because: string}}
 */
function check() {
  const got = readConfig();

  if (got.kind === 'absent') {
    return {
      state: STATE.NONE,
      plan: null,
      because: 'Claude has not been set up on this computer yet.',
    };
  }
  if (got.kind === 'unreadable') {
    return { state: STATE.UNKNOWN, plan: null, because: got.because };
  }

  const acct = got.data && got.data.oauthAccount;
  // ⚠️ `Array.isArray` too: `typeof [] === 'object'`, so an array slipped past
  // this guard and fell all the way through to the flat negative.
  if (!acct || typeof acct !== 'object' || Array.isArray(acct)) {
    /**
     * ⚠️ UNKNOWN, NOT NONE. A config with no account block might mean nobody
     * has signed in — or it might mean a shape we have not seen. The first is
     * likely and the second is possible, and only one of them is safe to
     * assert. The screen offers to connect either way; it just does not tell
     * them they have nothing.
     */
    return {
      state: STATE.UNKNOWN,
      plan: null,
      because: 'we could not find a Claude account in the settings on this computer',
    };
  }

  const org = typeof acct.organizationType === 'string' ? acct.organizationType : null;
  const billing = typeof acct.billingType === 'string' ? acct.billingType : null;

  if (org && SUBSCRIBED_ORG_TYPES.includes(org)) {
    return {
      state: STATE.CONNECTED,
      plan: planName(org, acct.organizationRateLimitTier),
      because: 'a Claude subscription is connected on this computer',
    };
  }

  /**
   * ⚠️ A SUBSCRIPTION WE DO NOT RECOGNISE IS NOT THE ABSENCE OF ONE — AND THAT
   * RULE WAS GATED ON THE ONE FIELD THIS MODULE DECIDED NOT TO DEPEND ON.
   *
   * The first version only reached `unknown` when `billingType` was present.
   * So an account whose `organizationType` we had never seen, with no billing
   * field in that config shape, fell straight through to "no Claude
   * subscription is connected on this computer yet" — the exact sentence the
   * header at the top of this file says loses us a paying customer, reached
   * through the exact gap the header warns about four lines further down
   * ("any one of them can be absent in a config shape we have not seen…
   * absence of a signal is not a negative signal").
   *
   * So the DEFAULT for a named-but-unrecognised plan is now `unknown`,
   * whatever `billingType` says, and `none` is asserted only for plans we
   * positively recognise as unsubscribed, or for an account naming no plan at
   * all. This list will still go out of date; it now goes out of date in the
   * direction that costs one click instead of a customer.
   */
  if (org && !UNSUBSCRIBED_ORG_TYPES.includes(org)) {
    return {
      state: STATE.UNKNOWN,
      plan: null,
      because: `this computer has a Claude account we do not recognise the plan of (${org})`,
    };
  }

  if (billing) {
    return {
      state: STATE.UNKNOWN,
      plan: null,
      because: 'this computer has a Claude account we do not recognise the plan of (no plan named)',
    };
  }

  return {
    state: STATE.NONE,
    plan: null,
    because: 'no Claude subscription is connected on this computer yet.',
  };
}

/** What to call the plan on screen. Never a raw enum. */
function planName(org, tier) {
  const base = {
    claude_max: 'Claude Max',
    claude_pro: 'Claude Pro',
    claude_team: 'Claude Team',
    claude_enterprise: 'Claude Enterprise',
  }[org] || null;
  if (!base) return null;
  // `default_claude_max_20x` -> "20x". Cosmetic, and skipped rather than
  // guessed when the tier is a shape we do not recognise.
  const m = typeof tier === 'string' ? tier.match(/_(\d+x)$/) : null;
  return m ? `${base} ${m[1]}` : base;
}

module.exports = { check, planName, STATE, CONFIG_PATH: CONFIG };
