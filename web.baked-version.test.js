'use strict';

/**
 * The version is readable when nothing else is (#269).
 *
 * 🛑 IT USED TO COME ONLY FROM THE STATUS POLL, so it was unknown for exactly
 * the same reason everything else was. Josh restarted a Mac, the board did not
 * come back, and every panel could honestly say it could not look while the one
 * fact that would have told him what he was running came from the thing that
 * had failed. A fact about the BUNDLE must not require the bundle's API
 * (Mona Lisa).
 *
 * 🔑 BAKED AT BUILD TIME, NOT SERVED. Serving it would still need the server,
 * and in the case this was written for the page was open from before the
 * restart and nothing was being served at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const MARKER = '__KOSMOS_VERSION__';

function baked(content) {
  const doc = {
    querySelector: () => (content === undefined ? null
      : { getAttribute: () => content }),
  };
  // eslint-disable-next-line no-new-func
  return new Function('document', page.lift(SCRIPT, 'bakedVersion') + '\nreturn bakedVersion();')(doc);
}

test('the marker is in the page, in the head, for the build to replace', () => {
  const head = PAGE.slice(0, PAGE.indexOf('</head>'));
  assert.match(head, /<meta name="kosmos-version" content="__KOSMOS_VERSION__">/,
    'the marker is missing from the head, so the build has nothing to substitute');
  /* ⚠️ A `<meta>` IN THE BODY IS INVALID, and the first version put it there,
     beside the line it describes. */
  assert.ok(PAGE.indexOf('name="kosmos-version"') < PAGE.indexOf('</head>'));
});

test('an untouched marker is not an answer', () => {
  /* A source checkout has no build step. Printing the marker would put
     "version __KOSMOS_VERSION__" on a developer's screen; returning null keeps
     them on the polled value, which is what existed before. */
  assert.equal(baked(MARKER), null);
  assert.equal(baked('0.2.74'), '0.2.74');
});

test('it survives whatever the document hands it', () => {
  /* 🛑 THIS RUNS AT LOAD, BEFORE ANY POLL, in a page scope every headless
     harness evaluates. One of them stubs `getAttribute` to return an OBJECT,
     and an unguarded `.indexOf` threw there and took the whole script down at
     load. A boot-time read has to survive a document that is not a browser's. */
  for (const odd of [undefined, null, {}, 42, '']) {
    assert.equal(baked(odd), null, 'a content of ' + JSON.stringify(odd) + ' was treated as a version');
  }
});

test('the build line is painted on load, not only after a poll', () => {
  /* The whole point is to be readable when no poll will ever succeed, so
     painting it from `tick()` alone keeps the empty line on the one machine
     this was written for. */
  assert.match(SCRIPT, /paintBuildLine\(null\);\s*\ntick\(\);/,
    'the build line is no longer painted before the first poll');
  assert.match(SCRIPT, /paintBuildLine\(data\.version\)/,
    'the poll no longer refines it');
});

test('the build bakes it, and fails rather than shipping the marker', () => {
  const build = fs.readFileSync(nodePath.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
  assert.match(build, /__KOSMOS_VERSION__/, 'the build no longer substitutes the marker');
  /* 🔑 AND IT CHECKS ITS OWN WORK. A silent no-op sed would ship the marker
     verbatim to a person's screen, which is worse than the empty line this
     replaces. Both directions: the marker must be gone AND the real version
     must be present. */
  /* ⚠️ ANCHORED ON THE PARTS, not on a character window. The first version
     allowed 40 characters between the grep and its `exit 1` and the real line
     has a message in between, so it failed on a build script that was correct.
     A window is a guess about formatting. */
  const survived = build.slice(build.indexOf('grep -q "__KOSMOS_VERSION__"'));
  assert.ok(survived.startsWith('grep -q "__KOSMOS_VERSION__"'), 'the marker check is gone');
  assert.match(survived.slice(0, 220), /exit 1/, 'the build does not fail when the marker survives');
  const landed = build.slice(build.indexOf('grep -q "content='));
  assert.ok(landed.startsWith('grep -q "content='), 'the did-it-land check is gone');
  assert.match(landed.slice(0, 220), /exit 1/, 'the build does not fail when the version did not land');
});

test('the logo is rounded, and matches the ring that draws around it (#183)', () => {
  /* 🔑 THE NUMBER IS NOT A CHOICE. `.klink:focus-visible` already sets an 8px
     radius, and an outline follows the element's radius, so a square image
     under a rounded ring is a mismatch a keyboard user meets every time they
     tab to it. Asserted as the PAIR, because either number alone is arbitrary
     and the two drifting apart is the actual defect. */
  const img = PAGE.match(/\.klink img \{([^}]*)\}/);
  const ring = PAGE.match(/\.klink:focus-visible \{([^}]*)\}/);
  assert.ok(img && ring, 'the logo rules moved');
  const radius = (r) => (r[1].match(/border-radius:\s*([\d.]+)px/) || [])[1];
  assert.ok(radius(img), 'the logo image has no radius, so it is square under a rounded ring');
  assert.equal(radius(img), radius(ring),
    'the image and its focus ring round by different amounts: ' + radius(img) + ' vs ' + radius(ring));
  /* ⚠️ ON THE IMAGE, NOT THE PARENT. The mark is an opaque tile, so a radius on
     `.klink` is overpainted by the square PNG and changes nothing on screen. */
  const parent = PAGE.match(/\n\.klink \{([^}]*)\}/);
  assert.ok(parent && !/border-radius/.test(parent[1]),
    'the radius moved to .klink, where an opaque image paints straight over it');
});
