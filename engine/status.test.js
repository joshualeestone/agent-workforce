'use strict';

/**
 * Tests for the status engine.
 *
 * Every case here pins a bug that actually shipped. The engine produced three
 * confidently wrong answers on its first day, and each was wrong in the same
 * direction: it reported something plausible instead of admitting it did not
 * know. These tests exist to stop that specific failure returning.
 *
 * Node's built-in runner, no dependencies:  node --test engine/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classify,
  modelDisplayName,
  readIdentity,
  STATE,
  CONFIDENCE,
  CONTEXT_LIMITS,
} = require('./status');

// A pane as the engine sees it. `command` is a version string when Claude Code
// is running and a shell name when it is not.
const pane = (over = {}) => ({ name: 'test', target: 'test:0.0', command: '2.1.222', title: '', ...over });

// ---------------------------------------------------------------------------
// The rule the whole engine exists to enforce
// ---------------------------------------------------------------------------

test('an unreadable pane is unknown, never something healthy', () => {
  const r = classify(pane(), null);
  assert.equal(r.state, STATE.UNKNOWN);
  assert.equal(r.confidence, CONFIDENCE.NONE);
});

test('a pane saying nothing recognisable is unknown, not idle', () => {
  // The dangerous default. "Nothing matched" must not fall through to a benign
  // state -- idle and unreadable look identical and mean opposite things.
  const r = classify(pane(), 'some output that matches no rule at all\n');
  assert.equal(r.state, STATE.UNKNOWN);
  assert.notEqual(r.state, STATE.IDLE);
});

test('every classification explains itself', () => {
  for (const text of [null, '', 'Worked for 1m 2s', 'Do you want to proceed?']) {
    const r = classify(pane(), text);
    assert.ok(r.because && r.because.length > 0, `no reason given for ${JSON.stringify(text)}`);
    assert.ok(Object.values(CONFIDENCE).includes(r.confidence));
  }
});

// ---------------------------------------------------------------------------
// State detection
// ---------------------------------------------------------------------------

test('a shell in the pane means stopped, and that is structurally known', () => {
  const r = classify(pane({ command: 'zsh' }), 'anything');
  assert.equal(r.state, STATE.STOPPED);
  assert.equal(r.confidence, CONFIDENCE.STRUCTURED);
});

test('a version string in the pane is not mistaken for a shell', () => {
  // pane_current_command reports "2.1.222" while Claude Code runs. Treating an
  // unrecognised command as "not running" would report the whole fleet stopped.
  const r = classify(pane({ command: '2.1.222' }), 'Worked for 1m 2s');
  assert.notEqual(r.state, STATE.STOPPED);
});

test('a waiting question outranks a finished-work line', () => {
  // Panes often contain both. "Needs you" must win: a blocked agent shown as
  // idle is the single most expensive misread in the product.
  const text = 'Worked for 2m 10s\nDo you want to proceed?\n';
  assert.equal(classify(pane(), text).state, STATE.NEEDS_YOU);
});

test('a usage limit outranks everything else', () => {
  const text = 'Do you want to proceed?\nusage limit reached, try again later\n';
  assert.equal(classify(pane(), text).state, STATE.RATE_LIMITED);
});

test('scraped states are labelled scraped, never structured', () => {
  // Terminal text can be stale, truncated or reformatted. Anything read off a
  // pane must carry the weaker confidence so the UI can decline to trust it.
  const r = classify(pane(), 'Worked for 1m 2s\n');
  assert.equal(r.confidence, CONFIDENCE.SCRAPED);
});

// ---------------------------------------------------------------------------
// Context limits -- the bug that shipped
// ---------------------------------------------------------------------------

test('no context limit is invented for a model we have not measured', () => {
  // The original code hardcoded 200,000, inferred from the largest number seen
  // at the time. The real window is 1,000,000, and a ring calibrated to the
  // wrong figure put a real agent at 406%.
  for (const model of Object.keys(CONTEXT_LIMITS)) {
    assert.equal(CONTEXT_LIMITS[model], 1000000,
      `${model} has a limit that is not the evidenced 1M figure`);
  }
});

test('limits are per-model, not a single global constant', () => {
  // A Haiku agent genuinely has a 200k window. One global number would be
  // wrong in the other direction.
  assert.equal(typeof CONTEXT_LIMITS, 'object');
  assert.ok(!Object.values(CONTEXT_LIMITS).includes(200000),
    '200000 is back as a hardcoded limit');
});

// ---------------------------------------------------------------------------
// Model names
// ---------------------------------------------------------------------------

test('version numbers are not split into words', () => {
  // A dash-to-space transform reads fine on claude-opus-5 and then ships
  // "Haiku 4 5" -- the last two segments are a decimal, not two words.
  assert.equal(modelDisplayName('claude-haiku-4-5'), 'Claude Haiku 4.5');
  assert.equal(modelDisplayName('claude-opus-4-8'), 'Claude Opus 4.8');
});

test('a dated model id resolves to the same display name', () => {
  assert.equal(modelDisplayName('claude-haiku-4-5-20251001'), 'Claude Haiku 4.5');
});

test('an unrecognised model renders raw rather than guessed', () => {
  // New models ship often. An unfamiliar accurate name beats a confident
  // wrong one -- the same rule the status board follows.
  assert.equal(modelDisplayName('claude-something-new-9'), 'claude-something-new-9');
  assert.equal(modelDisplayName(null), null);
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('an agent whose name cannot be derived is flagged, not invented', () => {
  const id = readIdentity('no-such-agent-anywhere');
  assert.equal(id.displayName, 'no-such-agent-anywhere');
  assert.equal(id.derived, false);
});

test('claudebot resolves to Splinter via explicit override', () => {
  // Five identifiers for one agent and none of them is "splinter". Deriving
  // from any single layer gives a confident wrong answer -- the config dir
  // alone would name it "discord".
  const id = readIdentity('claudebot');
  assert.equal(id.displayName, 'Splinter');
  assert.equal(id.derived, true);
});
