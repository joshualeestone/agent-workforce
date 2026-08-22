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

/** The page's one inline script, which is where all of this lives. */
function scriptOf(pageText) {
  const m = String(pageText).match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'the page has no inline script, so there is nothing to lift from');
  return m[1];
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
  const at = script.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');

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
