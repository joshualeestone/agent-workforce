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

/* Anchored on `function <name>(` and walked by braces: the same shape every
   page test here uses, kept local because this file had no lifter. */
function lift(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  let depth = 0;
  let end = -1;
  for (let k = PAGE.indexOf('{', PAGE.indexOf(')', at)); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, name + ' is unbalanced');
  return PAGE.slice(at, end);
}

test('two options, and the third behaviour survives without a button', () => {
  /* 🔑 Josh, 2026-08-22: "I don't want auto. Let's take auto off of it so we
     have just the sun and the moon." The argument that put `Auto` there is
     still true and is answered without a control: nothing is stored until
     somebody picks, so an untouched machine follows itself. What went is the
     third BUTTON, not the third BEHAVIOUR, and the test above this one is what
     holds the behaviour. */
  for (const v of ['light', 'dark']) {
    assert.ok(PAGE.includes('data-theme-set="' + v + '"'), 'the ' + v + ' option is gone');
  }
  assert.ok(!PAGE.includes('data-theme-set="system"'), 'the Auto button came back');
  assert.match(PAGE, /class="themepick" role="radiogroup"/);
});

test('the highlight is what is SHOWING, not what is stored', () => {
  /* 🛑 THE DEFECT THE MISSING BUTTON WOULD OTHERWISE CREATE. With `Auto` gone,
     a control painted from storage lights NEITHER half on every machine that
     has never chosen, which is every machine on its first run. It reads the
     rendered truth instead: the stored choice when there is one, and the Mac
     otherwise. */
  const showing = (stored, prefersDark) => {
    let media = null;
    const win = {
      matchMedia: (q) => { media = q; return { matches: prefersDark }; },
    };
    /* ⚠️ THE KEY IS TAKEN FROM THE PAGE, not retyped. `themeStored` reads
       `THEME_KEY`, which is declared outside both functions, and a lifted
       pair without it throws a ReferenceError INSIDE ITS OWN try/catch and
       returns the fallback. The test then reads as "a stored choice lost to
       the Mac" and blames the page for the harness. */
    const keyLine = /const THEME_KEY = '[^']+';/.exec(PAGE);
    assert.ok(keyLine, 'THEME_KEY is gone or has been renamed');
    const fn = new Function('localStorage', 'window',
      keyLine[0] + '\n' + lift('themeStored') + '\n' + lift('themeShowing') + '\nreturn themeShowing();');
    const got = fn({ getItem: () => stored }, win);
    return { got, media };
  };
  assert.equal(showing('dark', false).got, 'dark', 'a stored choice lost to the Mac');
  assert.equal(showing('light', true).got, 'light');
  /* Untouched: the Mac decides, and it is asked the same question the CSS asks. */
  const dark = showing(null, true);
  assert.equal(dark.got, 'dark');
  assert.match(dark.media, /prefers-color-scheme: dark/);
  assert.equal(showing(null, false).got, 'light');
  /* ⚠️ A junk value is not a choice. Same rule `themeStored` already applies. */
  assert.equal(showing('purple', false).got, 'light');
});

test('the painter asks what is showing, not what is stored', () => {
  /* 🛑 THE TEST ABOVE PROVES THE HELPER AND NOT THE CALLER, and pointing
     `paintThemePicker` back at `themeStored` went unnoticed by all twelve.
     This drives the painter itself against a machine that has chosen nothing,
     which is the state the whole change turns on: with `Auto` gone, storage
     answers "system" there and neither half would light. */
  const keyLine = /const THEME_KEY = '[^']+';/.exec(PAGE);
  const buttons = ['light', 'dark'].map((v) => ({
    dataset: { themeSet: v },
    checked: null,
    setAttribute(_, val) { this.checked = val; },
  }));
  const doc = { querySelectorAll: () => buttons };
  const win = { matchMedia: () => ({ matches: true }) };
  new Function('localStorage', 'window', 'document',
    keyLine[0] + '\n' + lift('themeStored') + '\n' + lift('themeShowing') + '\n'
    + lift('paintThemePicker') + '\npaintThemePicker();')({ getItem: () => null }, win, doc);
  assert.equal(buttons[1].checked, 'true', 'nothing is stored and the Mac is dark, so the moon must be lit');
  assert.equal(buttons[0].checked, 'false');
});

test('the active half is gold, the same ruling as the view toggle', () => {
  /* Ink flips between themes and inverts what selected means; gold reads as
     chosen on both grounds (Josh, twice, on the view toggle). The theme picker
     was the one control on this screen not following it. */
  assert.match(PAGE, /\.themeopt\[aria-checked="true"\] \{ background: var\(--gold-bright\); color: #14161a; \}/);
});

test('it is the same shape and height as the grid, list and org group', () => {
  /* Josh, 2026-08-22: "same height as the grid, list, and org chart viewers as
     well. Same shape and design. We need all this to have the same standard
     visual language sizing." Asserted as the same NUMBERS rather than by
     eye. */
  const geom = (sel) => {
    const at = PAGE.indexOf(sel);
    assert.ok(at > -1, sel + ' is gone');
    const block = PAGE.slice(at, at + 400);
    return {
      w: /width: (\d+)px/.exec(block),
      h: /height: (\d+)px/.exec(block),
      radius: /border-radius: (var\(--radius-control\)|[^;]+);/.exec(block),
    };
  };
  const vt = geom('.vt { border: 0;');
  const opt = geom('.themeopt { border: 0;');
  assert.equal(opt.w[1], vt.w[1], 'the halves are a different width from the view toggle');
  assert.equal(opt.h[1], vt.h[1], 'the halves are a different height from the view toggle');
  assert.equal(geom('.themepick {').radius[1], geom('.viewtoggle {').radius[1]);
});

test('the stamp sits to the LEFT of the light and dark control', () => {
  /* Josh, 2026-08-22: "take note that the light/dark mode is to the far right
     and the agent status is to the left of it. Right now we're showing it in
     the reverse way." Order in the markup is order on the screen here. */
  /* ⚠️ BOTH ARE PROVED PRESENT FIRST. A missing element gives `indexOf` -1,
     and -1 is less than every real index, so deleting the stamp outright made
     this assertion pass. Measured by deleting it. */
  const stampAt = PAGE.indexOf('id="checked"');
  const pickAt = PAGE.indexOf('class="themepick"');
  assert.ok(stampAt > -1, 'the agent-status stamp is gone from the page');
  assert.ok(pickAt > -1, 'the light and dark control is gone from the page');
  assert.ok(stampAt < pickAt, 'the control is drawn before the stamp again');
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
