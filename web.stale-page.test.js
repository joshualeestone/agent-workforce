'use strict';

/**
 * An update actually arrives, and a window that predates it says so (#271).
 *
 * 🛑 THE PAGE WAS SERVED WITH NO CACHE HEADERS AT ALL. Not "cache it", not "do
 * not": nothing, which leaves the browser to decide, and browsers keep HTML.
 * The whole app is one file, so a cached page is cached markup, CSS and script
 * together. An update landed, the server restarted on the new bundle, the
 * version line reported the new number, and the person went on looking at the
 * previous build with no signal anywhere. Josh hit exactly that.
 *
 * 🔑 AND THE VERSION LINE PREFERRED THE SERVER'S VERSION over the page's own,
 * so it reported what was RUNNING rather than what he was LOOKING AT. The
 * number that would have told him the truth was already there as the fallback.
 * The question a version line answers is "what am I looking at", and only the
 * baked value knows that (Mona Lisa).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function built(baked, polled) {
  let html = null;
  const doc = {
    getElementById: () => ({ set innerHTML(v) { html = v; } }),
    querySelector: () => (baked === undefined ? null : { getAttribute: () => baked }),
  };
  // eslint-disable-next-line no-new-func
  new Function('document', 'esc', 'POLLED',
    page.liftAll(SCRIPT, ['bakedVersion', 'pageIsStale', 'paintBuildLine'])
    + '\npaintBuildLine(POLLED);')(doc, (x) => String(x), polled);
  return html;
}

test('the page is served with the same do-not-cache the API already had', () => {
  const srv = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const line = srv.match(/res\.writeHead\(200, \{ 'content-type': 'text\/html[^}]*\}/);
  assert.ok(line, 'the page response moved');
  assert.match(line[0], /'cache-control': 'no-store'/,
    'the page is served with no cache instruction, so the browser decides and keeps it');
});

test('the line reports the page you are looking at, not the server', () => {
  /* 🛑 THE DEFECT ITSELF: server on the new version, window on the old one. */
  assert.match(built('0.2.74', '0.2.75'), /version 0\.2\.74/,
    'the line reports the server version, which is not what is on screen');
});

test('a disagreement is said, because it is the only state worth reporting', () => {
  const s = built('0.2.74', '0.2.75');
  assert.match(s, /reload for 0\.2\.75/, 'the page is stale and the line does not say so');
  /* And agreement stays quiet: a reload prompt on every load is furniture. */
  assert.ok(!/reload for/.test(built('0.2.75', '0.2.75')), 'it asks for a reload when nothing has changed');
});

test('a source checkout, where nothing is baked, behaves as it did before', () => {
  /* The marker is untouched without a build step, and the polled value is all
     there is. Printing the marker would be worse than the empty line. */
  assert.match(built('__KOSMOS_VERSION__', '0.2.75'), /version 0\.2\.75/);
  assert.ok(!/reload for/.test(built('__KOSMOS_VERSION__', '0.2.75')),
    'a dev checkout is told to reload on every load');
  assert.ok(!/KOSMOS_VERSION/.test(built('__KOSMOS_VERSION__', '0.2.75')),
    'the marker reached the screen');
});

test('neither one known is not a disagreement', () => {
  /* ⚠️ THE FAILURE DIRECTION. With the API down there is no polled version, and
     announcing a reload against a version we do not have would be inventing a
     newer one. */
  assert.ok(!/reload for/.test(built('0.2.75', null)), 'a failed poll produced a reload prompt');
  assert.ok(!/reload for/.test(built('0.2.75', undefined)));
  assert.match(built('0.2.75', null), /version 0\.2\.75/, 'the baked version stopped showing with the API down');
});
