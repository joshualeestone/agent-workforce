'use strict';

/**
 * Lift a function out of the shipped page, so a test runs the real thing.
 *
 * 🛑 THERE WERE FOUR COPIES OF THIS AND THREE OF THEM WERE SUBTLY WRONG. Each
 * started its brace walk at `SCRIPT.indexOf('{', at)`, which is the first brace
 * after the function's NAME. For `loadRemoval(sessionName, { fromPoll = false }
 * = {})` that brace opens a DESTRUCTURED PARAMETER, so the walk closed on the
 * parameter and returned a signature. Every assertion about the body then
 * failed, and failed in the shape of the product being broken rather than the
 * extractor being broken.
 *
 * 🔑 IT IS THE QUIET DIRECTION THAT MATTERS. A truncated lift fails loudly when
 * the test asserts a presence. It passes SILENTLY when the test asserts an
 * absence, because a signature contains none of the things a body would, and
 * "the bad string is not in here" is true of a string that is not the function.
 * At the time this was written exactly one function in the page had a braced
 * parameter list, so there were no live victims; the point is that the next one
 * would have had no warning.
 *
 * So: walk the parameter parens first, then take the brace after them.
 */

const assert = require('node:assert/strict');

/**
 * EVERY inline script in the page, joined.
 *
 * 🛑 THE PAGE HAS TWO AND THE OBVIOUS REGEX PICKS ONE. `<script id="theme-boot">`
 * runs in the head; the app is the bare `<script>` further down. A pattern
 * matching only a bare tag lands on the app **by the accident that the other one
 * carries an attribute**, and it would silently take the wrong block the day
 * somebody adds an attribute to the app's tag or a bare `<script>` above it.
 *
 * ⚠️ A GREEDY PATTERN IS WORSE AND THE FAILURE IS THE INTERESTING ONE. Mona Lisa
 * hit it the same night in her own checker: `<script>([\s\S]*)<\/script>` on a
 * two-block page captures from the FIRST opening tag to the LAST closing one and
 * swallows the HTML between, so the extracted text is not JavaScript at all. Hers
 * reported `RUNTIME FAIL, SyntaxError` rather than reporting that it could not
 * look, which is the worse of the two ways for a checker to be wrong.
 *
 * 📌 MEASURED ON THIS PAGE, 2026-08-22, rather than argued: give the app's tag
 * an attribute and the bare-tag pattern returns ZERO characters, so every lift
 * fails with "vanished from the page", which is loud but names the wrong thing.
 * And a greedy pattern on the page as it stands returns 710,788 characters
 * containing `</div>`, which is HTML being handed to a JavaScript parser.
 *
 * 🔑 Joining every block removes the choice. A function is liftable wherever it
 * lives, nothing is skipped, and there is no heuristic about which block is the
 * "real" one to be wrong about later.
 */
function scriptOf(pageText) {
  const blocks = [...String(pageText).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  assert.ok(blocks.length, 'the page has no inline script, so there is nothing to lift from');
  return blocks.join('\n');
}

/**
 * @param {string} script  from `scriptOf`
 * @param {string} name    a top-level `function <name>(` in it
 * @returns {string} the whole declaration, signature and body
 */
function lift(script, name) {
  /* ⚠️ Boundary-anchored on `function <name>(`, for the reason server.test.js
     records: a sibling whose name merely STARTS with the wanted one silently
     captures the extractor. The trailing paren is what makes `tick` not match
     `tickLine`. */
  let at = script.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  /* 🛑 `async` IS PART OF THE DECLARATION AND WAS BEING SLICED OFF. The anchor
     is `function <name>(`, so lifting an async page function returned a plain
     one — and `new Function` then threw "await is only valid in async
     functions", which reads like a mistake in the TEST rather than in the
     extractor. Every await-using function on this page is unliftable until
     this line exists. */
  if (script.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;

  let parens = 0; let bodyAt = -1;
  for (let k = script.indexOf('(', at); k < script.length; k += 1) {
    if (script[k] === '(') parens += 1;
    else if (script[k] === ')') {
      parens -= 1;
      if (parens === 0) { bodyAt = script.indexOf('{', k); break; }
    }
  }
  assert.ok(bodyAt > -1, name + ' has no body');

  let depth = 0; let end = -1;
  for (let k = bodyAt; k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, name + ' is unbalanced, so the walk ran off the end');

  const got = script.slice(at, end);
  /* 🔑 THE GUARD THAT MAKES THE SILENT FAILURE LOUD. A truncated lift is a
     signature: it ends at the parameter list and carries no statements. This
     cannot be a length threshold, because a genuinely tiny function is legal;
     it asks whether what came back actually closes a BODY after the params. */
  assert.ok(got.indexOf('{', got.indexOf(')')) > -1,
    name + ' lifted as a signature rather than a body: ' + got.slice(0, 120));
  return got;
}

/** Several at once, in order, for tests that need a function and its callees. */
function liftAll(script, names) {
  return names.map((n) => lift(script, n)).join('\n');
}

/**
 * ⚠️ IT COUNTS BRACE CHARACTERS AND DOES NOT KNOW ABOUT STRINGS, which is a
 * real limit rather than a hidden one. A page function containing an unmatched
 * `{` or `}` inside a string literal or a regex will close the walk early.
 *
 * 🔑 It is stated here because the script that rewired the four call sites to
 * this file HIT EXACTLY THAT, on the old `lift` bodies themselves: they are
 * full of `'{'` and `'}'` literals, so a naive counter reading them
 * unbalanced immediately. The mitigation is the signature guard above, which
 * turns the quiet version of this failure into a loud one. If a page function
 * ever trips it, match on structure instead of counting.
 */
module.exports = { scriptOf, lift, liftAll };
