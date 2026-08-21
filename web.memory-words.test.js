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

  /* ⚠️ THE OLD VERSION OF THIS BLOCK CHECKED THAT THREE STRINGS EXIST IN THE
     PAGE and never related any of them to `memUnknown`. It would have passed
     with all five surfaces hardcoding literals. The count above is what holds
     that line, so the anchors are gone rather than left looking like coverage. */
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
  /* ⚠️ THE FUNCTION'S BODY, matched by braces, not "everything up to the next
     function". The first version sliced from `memUnknown` to `pctOf` — so any
     function somebody inserted between the two would have been silently exempt
     from this check, while the control below still passed because the
     derivation was still inside the slice. There is a brace matcher in this
     file already; it is used. */
  const at = PAGE.indexOf('function memUnknown(');
  assert.notEqual(at, -1, 'the derivation is not where this check expects it');
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  const end = i + 1;
  const elsewhere = PAGE.slice(0, at) + PAGE.slice(end);

  /* ⚠️ BLOCK COMMENTS REMOVED FIRST, and this is the third shape this check has
     taken. Counting the raw page failed on comments that legitimately QUOTE the
     word ("the visible word \"Unknown\"", "reports 62px for \"Unknown\""), which
     is prose, not a rendered literal. An earlier attempt filtered comment LINES
     by prefix and did not work: block comments here have unmarked continuation
     lines. Removing whole block-comment spans does work, because that is the shape
     the comments actually have.
     ⚠️ Only block comments. Stripping `//` would eat the `https://` in real
     code, and over-stripping buys a FALSE PASS, which is the direction a check
     must never fail in. */
  const codeOnly = elsewhere.replace(/\/\*[\s\S]*?\*\//g, ' ');
  /* ⚠️ BOTH WORDS, not just the old one. Pinning only "Unknown" left the new
     word free to be hardcoded on a surface, which is the same drift with a
     different string. */
  for (const literal of ['>Unknown<', "'Unknown'", '"Unknown"',
                         '>Not yet read<', "'Not yet read'", '"Not yet read"']) {
    const hits = codeOnly.split(literal).length - 1;
    assert.equal(hits, 0, `${literal} is still rendered somewhere instead of memUnknown().word`);
  }

  /* ⚠️ AND THE STRIPPER ITSELF NEEDS A CONTROL, or a regex that matched the
     whole file would make every literal above unfindable and this test green
     forever. */
  assert.ok(codeOnly.includes('function pctOf('), 'the comment stripper removed code');
  assert.ok(codeOnly.length > PAGE.length / 3, 'the comment stripper removed most of the page');

  // ⚠️ THE CONTROL: the same search INSIDE the derivation must find it, or the
  // slice above is cutting out more than it should and the zero means nothing.
  const owned = PAGE.slice(at, end);
  /* ⚠️ AND THE CONTROL COVERS BOTH LITERALS, so a zero count for either one is
     provably findable rather than provably absent from a badly-cut slice. */
  assert.equal(owned.split("'Unknown'").length - 1, 1, 'the derivation no longer holds the word, so the exclusion above is hiding it');
  assert.equal(owned.split("'Not yet read'").length - 1, 1, 'the derivation no longer holds the new word either');
});

test('the Memory box sentence reads as English after the name it follows', () => {
  /**
   * 🛑 THE BUG THIS CATCHES SHIPPED PAST SIX TESTS AND A BLIND REVIEW OF THE
   * ENGINE, because every one of them checked `word` and `aria` and nothing
   * ever composed `lead`. The Memory box writes "<name>'s " + lead, and the
   * new branch read: "Dan's has not written anything to read yet."
   *
   * ⚠️ So this asserts the SENTENCE, built the way the page builds it, rather
   * than the fragment. A test on the fragment cannot see a grammar bug.
   */
  for (const notYet of [true, false]) {
    const u = memUnknown({ notYet });
    const sentence = 'Dan\u2019s ' + u.lead;
    /* ⚠️ THE NOUN, NOT "a lowercase word". The first version read
       `/^Dan\u2019s (memory|[a-z]+ )/`, and `[a-z]+ ` matches "has " — so the
       exact string in the docblock above, the bug this test was written for,
       PASSED it. All the work was being done by a five-verb denylist, which
       "Dan's shows nothing yet" walks straight past. A possessive needs a noun
       after it, and the noun here is always the same one. */
    assert.match(sentence, /^Dan\u2019s memory\b/, `reads wrong after a possessive: "${sentence}"`);
    assert.match(u.lead, /\.$/, 'the lead is a sentence and must end like one');
    assert.match(u.note, /\.$/);
  }
});

test('the note never claims how OLD an agent is, because the engine refused to know', () => {
  /**
   * ⚠️ `notYet` is decided on what the code already distinguishes, never on the
   * agent's age — that was the threshold this whole change refused. The copy
   * then said "That is normal for an agent this new. There is nothing wrong
   * with it and nothing to do", which asserts both an age and a diagnosis, and
   * is reachable for agents that are neither new nor fine.
   *
   * The normality belongs to the CLASS ("normal for a new agent"), which is
   * true, not to this one, which we cannot see.
   */
  const u = memUnknown({ notYet: true });
  assert.doesNotMatch(u.note, /this new|nothing wrong|nothing to do/,
    'the note makes a claim about this agent that the engine deliberately does not support');
});

test('every field belongs to its own branch, so the two cannot be swapped', () => {
  /**
   * 🛑 SWAPPING `lead` AND `note` PASSED EVERY OTHER TEST IN THIS FILE. Nothing
   * asserted WHICH lead belongs to `notYet: true` — the grammar test passes
   * (both start with "memory"), the verb denylist passes, the ends-with-period
   * assertions pass — and the result would be the Memory box telling somebody
   * whose agent has nothing recorded that we could not read it. That is the
   * exact sentence this whole change exists to remove, reachable by moving two
   * lines.
   *
   * ⚠️ So each branch is pinned to a phrase only it can honestly carry: the
   * admission says we FAILED, the "not yet" says there is NOTHING THERE.
   */
  const yet = memUnknown({ notYet: true });
  const unk = memUnknown({ notYet: false });

  assert.match(yet.lead, /nothing recorded/, 'the not-yet lead no longer says nothing is there');
  assert.doesNotMatch(yet.lead, /could not|cannot|failed/, 'the not-yet lead claims we failed at something');
  assert.doesNotMatch(yet.note, /could not|cannot|failed/, 'the not-yet note claims we failed at something');

  assert.match(unk.lead, /could not be read/, 'the admission no longer says we could not read it');
  assert.doesNotMatch(unk.lead, /nothing recorded|not yet|has not/, 'the admission claims to know the agent is new');
  assert.doesNotMatch(unk.note, /just started|new agent/, 'the admission claims to know the agent is new');

  // ⚠️ AND EVERY FIELD DIFFERS BETWEEN THE BRANCHES, or one of them is not
  // carrying a distinction at all.
  for (const k of ['word', 'aria', 'lead', 'note']) {
    assert.notEqual(yet[k], unk[k], `${k} is the same in both branches, so it says nothing`);
  }
});

test('an agent whose memory we READ is never told we could not read it', () => {
  /**
   * 🛑 A FALSE SENTENCE ON THE SURFACE THIS CHANGE REWRITES. When the engine
   * takes a reading but does not know the model's limit, it returns tokens with
   * a null percent — and every surface said "memory could not be read" about a
   * reading it had successfully taken. The engine's own `because` said the
   * truth on the next line: "measured, but we do not know how much X can hold".
   *
   * ⚠️ Reachable without an exotic model: the model name is read from the last
   * 64KB of a transcript and the usage from the last 256KB, so a busy agent
   * whose recent tail happens to carry no model name lands here.
   */
  /* ⚠️ `noCeiling`, the engine’s own flag, NOT "tokens present and no
     percent". The first version of this arm used that shape and claimed "no
     limit known" about a card whose percent was merely UNREADABLE — a security
     fixture feeding a garbage percent with tokens intact. The suite caught it
     within the hour. */
  const measured = memUnknown({ tokens: 42000, percent: null, noCeiling: true, notYet: false });
  assert.doesNotMatch(measured.lead, /could not be read/, 'we told them we failed at a reading we took');
  assert.doesNotMatch(measured.aria, /could not be read/);
  assert.match(measured.lead, /was read/);
  assert.equal(measured.notYet, false);

  // ⚠️ AND IT IS ITS OWN CASE, not a relabelling of one of the other two.
  const unk = memUnknown({ tokens: null, percent: null, notYet: false });
  const yet = memUnknown({ tokens: null, percent: null, notYet: true });
  for (const k of ['word', 'aria', 'lead', 'note']) {
    assert.notEqual(measured[k], unk[k], `${k} is the same as the admission`);
    assert.notEqual(measured[k], yet[k], `${k} is the same as the not-yet branch`);
  }

  // ⚠️ THE CONTROL: tokens absent must still reach the other two branches, or
  // this new arm has swallowed them.
  assert.equal(unk.word, 'Unknown');
  assert.equal(yet.word, 'Not yet read');
});

test('a percent we could not read is not reported as a limit we do not know', () => {
  /**
   * ⚠️ THE TWO STATES THE FLAG SEPARATES, and the reason it is a flag. A card
   * can carry tokens with no usable percent for two different reasons: the
   * engine measured the memory and does not know the model's size, or the
   * percent itself was unreadable. Only the first is "no limit known".
   *
   * The suite found this within an hour of the arm being added, through a
   * fixture that feeds a garbage percent with tokens intact.
   */
  const unreadable = memUnknown({ tokens: 1, percent: null, notYet: false });
  assert.equal(unreadable.word, 'Unknown', 'an unreadable percent was reported as a model we do not know the size of');
  const noLimit = memUnknown({ tokens: 1, percent: null, noCeiling: true, notYet: false });
  assert.equal(noLimit.word, 'No limit known');
});
