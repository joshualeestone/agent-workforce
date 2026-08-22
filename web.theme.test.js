'use strict';

/**
 * The appearance switch (#40) and the generated half of the theme.
 *
 * 🔑 THE THING THIS FILE REALLY GUARDS is a two-copy problem. A manual switch
 * cannot be a media query, so every dark rule has to exist twice: once for
 * "this Mac is dark" and once for "this person chose dark". Two copies of
 * anything drift, and this pair drifts INVISIBLY -- the app looks right in
 * whichever mode the author happened to be in.
 *
 * So the second copy is generated (`tools/sync-forced-theme.js`) and these
 * tests fail the moment the checked-in file stops matching what the generator
 * would produce.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const FILE = nodePath.join(__dirname, 'web', 'index.html');
const PAGE = fs.readFileSync(FILE, 'utf8');
const sync = require('./tools/sync-forced-theme.js');

test('the forced theme is in step with the system theme', () => {
  /* If this fails: run `node tools/sync-forced-theme.js` and commit the diff.
     It is not a test to relax; it is the whole mechanism. */
  assert.equal(sync.build(PAGE), PAGE,
    'a dark rule was edited without regenerating the forced-theme section');
});

test('every system dark rule has a forced twin', () => {
  const blocks = sync.darkBlocks(PAGE);
  assert.ok(blocks.length >= 5, 'the dark blocks vanished, so this test proves nothing');
  const generated = PAGE.slice(PAGE.indexOf(sync.START));
  for (const b of blocks) {
    for (const r of sync.rulesIn(PAGE.slice(b.open + 1, b.close))) {
      if (r.sel.startsWith('@')) continue;
      /* Compared by DECLARATIONS rather than by selector text: the twin's
         selector is deliberately different, and only its body has to match. */
      const body = r.body.replace(/\s+/g, ' ').trim();
      assert.ok(generated.replace(/\s+/g, ' ').includes(body),
        'a dark rule has no forced twin: ' + r.sel);
    }
  }
});

test('choosing Light beats a dark Mac', () => {
  /**
   * 🛑 THE HALF-BUILT VERSION OF THIS FEATURE. Generating the forced-dark
   * rules alone makes the switch work in ONE direction: a person on a light Mac
   * can choose dark, and a person on a dark Mac choosing Light gets nothing,
   * because the media query still matches and still wins. That is easy to ship
   * and hard to notice, because you test it on your own machine.
   */
  for (const b of sync.darkBlocks(PAGE)) {
    for (const r of sync.rulesIn(PAGE.slice(b.open + 1, b.close))) {
      if (r.sel.startsWith('@')) continue;
      assert.match(r.sel, /:root:not\(\[data-theme="light"\]\)/,
        'this system-dark rule still applies when the person has chosen Light: ' + r.sel);
    }
  }
});

test('the stored choice is applied before the page is drawn', () => {
  /* A theme applied by the app's own script paints the page in the system
     theme first and then flips it: a white flash on every load for somebody
     who chose dark, which reads as the app being broken. */
  const boot = PAGE.indexOf('id="theme-boot"');
  assert.ok(boot > -1, 'the boot script is gone, so a saved theme arrives late');
  assert.ok(boot < PAGE.indexOf('<body'), 'the boot script no longer runs before the body');
  assert.ok(boot < PAGE.indexOf('class="apphead"'), 'the boot script runs after the header is drawn');
});

test('the boot script and the picker agree about the key and the values', () => {
  /* Two readers of one preference. If they ever disagree, the page applies one
     thing and shows another, and the way that announces itself is a flash. */
  const bootBlock = PAGE.slice(PAGE.indexOf('id="theme-boot"'), PAGE.indexOf('</script>', PAGE.indexOf('id="theme-boot"')));
  assert.match(bootBlock, /'kosmos-theme'/);
  assert.match(PAGE, /const THEME_KEY = 'kosmos-theme';/);
  for (const v of ['dark', 'light']) {
    assert.ok(bootBlock.includes("'" + v + "'"), 'the boot script does not know about ' + v);
  }
});

test('never touched means no attribute, so the Mac keeps deciding', () => {
  /* ⚠️ Kosmos must not record a preference on somebody's behalf just because
     they opened it, and "system" is the default rather than a third stored
     value: choosing it REMOVES the key. */
  assert.match(PAGE, /localStorage\.removeItem\(THEME_KEY\)/);
  assert.match(PAGE, /document\.documentElement\.removeAttribute\('data-theme'\)/);
});

test('the control offers three states, because two would have to guess', () => {
  for (const v of ['system', 'light', 'dark']) {
    assert.ok(PAGE.includes('data-theme-set="' + v + '"'), 'the ' + v + ' option is gone');
  }
  // A radiogroup, not a switch: a switch cannot show three states.
  assert.match(PAGE, /class="themepick" role="radiogroup"/);
});

test('a script this file adds does not capture the page-source extractor', () => {
  /**
   * 🛑 THE FAILURE THIS PINS ALREADY HAPPENED, TWICE, WHILE WRITING IT. Every
   * page test lifts the app's source with a regex for an attribute-less script
   * tag. Adding a second attribute-less one earlier in the file made eleven
   * tests fail with "vanished from the page" about code sitting right there --
   * and then the COMMENT explaining that, which quoted the tag, became the
   * first match and did it again.
   */
  const bare = [...PAGE.matchAll(/<script>/g)];
  assert.equal(bare.length, 1,
    'a second attribute-less script tag exists (in markup or quoted in a comment), '
    + 'so every page test now extracts the wrong block');
});
