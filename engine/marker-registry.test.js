'use strict';

/**
 * Every managed-block marker the engine defines is in the registry.
 *
 * 🛑 THE FAILURE THIS EXISTS FOR IS SILENT AND HAS HAPPENED THREE TIMES. Each
 * new managed block had to remember to join two separate hand-written lists,
 * one in projects.js and one in you.js, and the comments beside them record the
 * count going up: "same lesson, third sibling", "same lesson, fourth writer".
 * A block that forgets does not fail. It becomes the injection path into itself
 * and every sibling: a marker smuggled through a typed project name or a typed
 * about-you answer fabricates a tight pair, which ends a block early,
 * ambiguates a sibling into silently disabling its own heal, or hands a writer
 * a span to replace inside somebody else's words.
 *
 * 🔑 IT READS THE SOURCE, WHICH IS THE ONLY PLACE THE ANSWER IS COMPLETE.
 * Asking the registry what it contains is asking a list to confirm itself. The
 * question is whether anything in the engine defines a marker the registry has
 * never heard of, and only the files can answer that.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;

/* The shape a marker literal takes, keyed on the CONVENTION rather than on the
   three names we happen to have. Anything matching this is a managed-block
   marker by construction, whatever it is called. */
const MARKER = /<!--\s*kosmos:[a-z-]+:(?:start|end)\s*-->/g;

test('every marker literal in the engine is in the registry', () => {
  const projects = require('./projects');
  const known = new Set(projects.ALL_MARKERS());
  assert.ok(known.size >= 6, 'the registry is suspiciously small: ' + known.size);

  const found = new Map();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.match(MARKER) || []) {
      if (!found.has(m)) found.set(m, f);
    }
  }
  assert.ok(found.size >= 6, 'the scan found ' + found.size + ' markers, so it is not reading the source');

  const missing = [...found].filter(([m]) => !known.has(m));
  assert.deepEqual(missing.map(([m, f]) => m + ' (' + f + ')'), [],
    'defined in the engine and unknown to the registry, so nothing neutralises it');

  /* And the other direction: a registry entry nothing defines is a marker that
     was renamed or deleted, which leaves the neutralisers guarding a string
     that no longer bounds any block. */
  const stale = [...known].filter((m) => !found.has(m));
  assert.deepEqual(stale, [], 'in the registry and defined nowhere');
});

test('both neutralisers refuse every marker in the registry', () => {
  const projects = require('./projects');
  /* ⚠️ THE TWO CALLERS, NOT THE SHARED FUNCTION. `neutralise` passing its own
     markers proves nothing about whether `oneLine` and `you.clean` still call
     it: either could go back to a hand-written list and this file would stay
     green if it tested the helper alone. These are the two entry points a
     typed value actually arrives through. */
  const you = require('./you');
  for (const m of projects.ALL_MARKERS()) {
    const typed = 'before ' + m + ' after';
    /* Through the project block's real body builder, which is where a typed
       project name and folder path reach `oneLine`. `oneLine` itself is not
       exported, and reaching past the export to test it would be testing a
       different function from the one a person's typing arrives at. */
    const body = projects.blockBody([{ id: 'x', name: typed, folder: '/tmp/' + typed }]);
    assert.ok(!body.includes(m),
      'the projects block let ' + m + ' through, so a typed project name can fabricate a pair');
    const spliced = you.blockBody({ name: typed, does: typed, know: typed });
    assert.ok(!spliced.includes(m),
      'the about-you block let ' + m + ' through, so a typed answer can fabricate a pair');
  }
});

test('the scan recognises a marker the registry does not know', () => {
  /* POSITIVE CONTROL. An empty `missing` list is the pass condition, and an
     empty list is also what a broken regex produces. This proves the pattern
     matches a well-formed marker it has never seen, so the zero above means
     the engine is clean rather than the scan being dead. */
  const invented = '<!-- kosmos:policy:start -->';
  assert.match(invented, new RegExp(MARKER.source), 'the pattern does not match a valid new marker');
  const known = new Set(require('./projects').ALL_MARKERS());
  assert.ok(!known.has(invented), 'the invented marker is somehow already registered');
});
