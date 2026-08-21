'use strict';

/**
 * The words the five memory surfaces use when there is no percentage.
 *
 * ⚠️ THIS FILE EXECUTES THE FUNCTION RATHER THAN GREPPING FOR ITS TEXT. A test
 * that reads index.html as a string can only prove a sentence is present
 * somewhere in a 15,000-line file; it cannot tell whether the branch that
 * produces it is reachable, and this repo has shipped a fully transparent
 * modal past 316 such tests. So `memUnknown` is extracted and CALLED.
 *
 * The second half is structural on purpose: the fact has five renderers, and
 * this file's neighbours record them drifting apart twice. Pinning that each
 * renderer CALLS the shared derivation is what stops a sixth from being added
 * with a literal.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** Pull one top-level function out of the page and make it callable. */
function extract(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  const from = i;
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = PAGE.slice(at, i + 1);
  assert.ok(body.length > 40 && from > at, `${name} extracted as something too small to be it`);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return ${name};`)();
}

const memUnknown = extract('memUnknown');

test('an agent with nothing recorded yet is not told it is unreadable', () => {
  const u = memUnknown({ tokens: null, percent: null, notYet: true });
  assert.equal(u.word, 'Not yet read');
  assert.match(u.aria, /Nothing has been recorded/);
  assert.equal(u.notYet, true);
});

test('an agent we genuinely could not read still says so', () => {
  const u = memUnknown({ tokens: null, percent: null, notYet: false });
  assert.equal(u.word, 'Unknown');
  assert.equal(u.aria, 'Memory could not be read.');
});

test('a reading with no notYet field at all resolves to the ADMISSION, not the claim', () => {
  /**
   * ⚠️ THE DIRECTION OF THE DEFAULT, and it is the whole safety property. An
   * older engine, a cached payload or a shape we have not seen yet arrives
   * with no `notYet`. Defaulting that to "not yet" would state a fact about
   * an agent's life on no evidence; defaulting to "unknown" admits what we
   * do not know. The guard fails toward the admission.
   */
  for (const ctx of [undefined, null, {}, { percent: null }, { notYet: undefined }]) {
    assert.equal(memUnknown(ctx).word, 'Unknown', `${JSON.stringify(ctx)} claimed the agent was new`);
  }
});

test('the two strings stay disjoint, so an assertion about one cannot be satisfied by the other', () => {
  /**
   * The property the ring's own docblock relies on. It held for
   * "Unknown" / "Memory could not be read." by luck of wording; the new pair
   * shares the words "not", "read" and "yet", so it is pinned here rather than
   * left to be noticed when a test starts passing for the wrong reason.
   */
  for (const notYet of [true, false]) {
    const u = memUnknown({ notYet });
    assert.equal(u.aria.includes(u.word), false, `the aria label contains the badge word (notYet: ${notYet})`);
    assert.equal(u.word.includes(u.aria), false, `the badge word contains the aria label (notYet: ${notYet})`);
  }
});

test('every one of the five surfaces goes through the shared derivation', () => {
  /**
   * ⚠️ COUNTED, not spot-checked. The card badge, the ring's aria-label, the
   * list row, the Memory box and the detail header all state this one fact,
   * and the comments beside them record two occasions where somebody updated
   * the surfaces they could see and left the others behind.
   */
  /* ⚠️ THE WHOLE FILE, comments included, and that is deliberate after two
     attempts at being cleverer. Filtering comment lines does not work here —
     this file's block comments have unmarked continuation lines, so no prefix
     rule can find them. So the count is over everything, and the rule is that
     the NAME does not appear in prose. That trades a false pass for a false
     failure: a comment that mentions it breaks this test loudly, rather than a
     surface quietly slipping past a filter. */
  const calls = PAGE.split('memUnknown(').length - 1;
  // one definition + five call sites
  assert.equal(calls, 6, `expected five callers of memUnknown and found ${calls - 1}`);

  for (const [surface, near] of [
    ['card badge', 'membadge unk'],
    ['list row', 'bar unknown'],
    ['detail header', 'dbadge.textContent'],
  ]) {
    const at = PAGE.indexOf(near);
    assert.notEqual(at, -1, `${surface}: anchor "${near}" is gone, so this check is aimed at nothing`);
  }
});

test('no surface still hardcodes the old word, ANYWHERE EXCEPT the one place that owns it', () => {
  /**
   * ⚠️ AND THIS ONE HAD TO BE AIMED, TWICE. Written first as "the page contains
   * no rendered 'Unknown'", it failed — on `memUnknown`'s own definition, which
   * is the single place that word is supposed to live. A check that a correct
   * implementation cannot satisfy is not a check.
   *
   * ⚠️ It also cannot be a grep for the bare word: "Unknown" appears in prose
   * and in a dozen comments here, so a count of zero is unreachable and the
   * test would pass forever. What is pinned is the RENDERED literals, in the
   * page MINUS the derivation that owns them.
   */
  const at = PAGE.indexOf('function memUnknown(');
  const end = PAGE.indexOf('\nfunction pctOf(', at);
  assert.ok(at !== -1 && end > at, 'the derivation is not where this check expects it');
  const elsewhere = PAGE.slice(0, at) + PAGE.slice(end);

  for (const literal of ['>Unknown<', "'Unknown'", '"Unknown"']) {
    const hits = elsewhere.split(literal).length - 1;
    assert.equal(hits, 0, `${literal} is still rendered somewhere instead of memUnknown().word`);
  }

  // ⚠️ THE CONTROL: the same search INSIDE the derivation must find it, or the
  // slice above is cutting out more than it should and the zero means nothing.
  const owned = PAGE.slice(at, end);
  assert.equal(owned.split("'Unknown'").length - 1, 1, 'the derivation no longer holds the word, so the exclusion above is hiding it');
});
