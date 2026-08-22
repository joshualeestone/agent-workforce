'use strict';

/**
 * The top-left toast, in the state where an update landed behind an open tab.
 *
 * 🛑 JOSH ASKED FOR THIS IN HIS OWN WORDS, 2026-08-22: "maybe if we push an
 * update we still pop the message at the top left to say, Kosmos has been
 * updated. Refresh your browser to install it". The wording moved because by
 * then it IS installed and only the window is behind: "install" sends somebody
 * hunting a problem that does not exist.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function toast({ baked, served, offer, updating = false, later = null }) {
  const slot = { dataset: {}, innerHTML: '' };
  const listeners = [];
  const doc = {
    getElementById: (id) => (id === 'utoast-slot' ? slot : { addEventListener: (_, f) => listeners.push(f), focus() {}, hidden: true }),
    querySelector: () => (baked === undefined ? null : { getAttribute: () => baked }),
  };
  new Function('document', 'esc', 'UPDATING_NOW', 'SERVED_VERSION', 'updateLaterVersion', 'UPD_CONFIRM_OPENER', 'OFFER',
    page.liftAll(SCRIPT, ['bakedVersion', 'pageIsStale', 'renderUpdateToast'])
    + '\nrenderUpdateToast(OFFER);')(doc, (x) => String(x), updating, served, () => later, null, offer);
  return { html: slot.innerHTML, v: slot.dataset.v, listeners };
}

test('a page older than the running Kosmos says so, and offers the one thing that fixes it', () => {
  const t = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.match(t.html, /Kosmos updated/);
  assert.match(t.html, /You are looking at the previous version/);
  assert.match(t.html, /ut-reload/);
});

test('it does not say install, and it does not say refresh your browser', () => {
  /* ⚠️ THE UPDATE ALREADY HAPPENED. The agents are on the new version and only
     this window is behind, so "install" describes work that is done and sends
     the person looking for a failure that did not occur. */
  const t = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.ok(!/Install/i.test(t.html), 'it tells them to install something that is already installed');
});

test('one action: no Later and nothing to close', () => {
  /* Later on the shipped toast defers an install, a real change to the machine.
     Here there is nothing to defer: dismissing would not make the page current,
     so the button would lie about what it did. */
  const t = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.ok(!/ut-later|Later|Dismiss|aria-label="Close"/i.test(t.html));
  assert.equal((t.html.match(/<button/g) || []).length, 1);
});

test('it carries no version number, and the shipped toast still does', () => {
  /* 📌 "You are looking at the previous version" is true and actionable without
     one, and both numbers are on the Settings line for anybody who wants them. */
  const stale = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.ok(!/0\.2\.7[56]/.test(stale.html));
  const offer = toast({ baked: '0.2.76', served: '0.2.76', offer: { version: '0.2.77' } });
  assert.match(offer.html, /Kosmos 0\.2\.77/, 'the offer stopped naming the version it is offering');
});

test('the two states are one component in two tones', () => {
  const stale = toast({ baked: '0.2.75', served: '0.2.76' });
  const offer = toast({ baked: '0.2.76', served: '0.2.76', offer: { version: '0.2.77' } });
  assert.match(stale.html, /class="utoast stale"/);
  assert.match(offer.html, /class="utoast"/);
  /* The tone is a variable on the component, not a second component. */
  assert.match(PAGE, /\.utoast\.stale \{ --utone: var\(--label-2\); \}/);
  assert.match(PAGE, /:root:not\(\[data-theme="light"\]\) \.utoast\.stale \{ --utone: var\(--label-2\); \}/);
  assert.match(PAGE, /:root\[data-theme="dark"\] \.utoast\.stale \{ --utone: var\(--label-2\); \}/);
});

test('when both are true, the reload state wins', () => {
  /* 🛑 THE CASE THAT ONLY APPEARED WHEN IT WAS DRAWN (Mona Lisa): page 0.2.75,
     server 0.2.76, and 0.2.77 published. Installing 0.2.77 from a 0.2.75 page
     compounds the staleness rather than resolving it, and the person would be
     acting on a screen already wrong about what it is. */
  const t = toast({ baked: '0.2.75', served: '0.2.76', offer: { version: '0.2.77' } });
  assert.match(t.html, /Kosmos updated/);
  assert.ok(!/Update available/.test(t.html), 'it offered an install from a page that is already behind');
});

test('an install in flight owns the slot', () => {
  const t = toast({ baked: '0.2.75', served: '0.2.76', updating: true });
  assert.equal(t.html, '', 'the reload state interrupted an update that is running');
});

test('agreement, a failed poll, and a source checkout are all quiet', () => {
  assert.equal(toast({ baked: '0.2.76', served: '0.2.76' }).html, '');
  /* ⚠️ Both numbers or nothing: announcing a reload against a version we do not
     have would be inventing a newer one. */
  assert.equal(toast({ baked: '0.2.76', served: null }).html, '');
  assert.equal(toast({ baked: '__KOSMOS_VERSION__', served: '0.2.76' }).html, '');
  assert.equal(toast({ baked: undefined, served: '0.2.76' }).html, '');
});

test('the same page is not repainted every five seconds', () => {
  /* The slot is a role="status" live region and the poll runs every five
     seconds; rewriting an identical node re-announces it on some screen
     readers. Same guard the offer state already had. */
  const slot = { dataset: {}, innerHTML: '' };
  const doc = {
    getElementById: (id) => (id === 'utoast-slot' ? slot : { addEventListener() {}, focus() {}, hidden: true }),
    querySelector: () => ({ getAttribute: () => '0.2.75' }),
  };
  const run = new Function('document', 'esc', 'UPDATING_NOW', 'SERVED_VERSION', 'updateLaterVersion',
    page.liftAll(SCRIPT, ['bakedVersion', 'pageIsStale', 'renderUpdateToast'])
    + '\nreturn renderUpdateToast;')(doc, (x) => String(x), false, '0.2.76', () => null);
  run(null);
  slot.innerHTML = 'MARKED';
  run(null);
  assert.equal(slot.innerHTML, 'MARKED', 'the toast repainted itself over an unchanged state');
});
