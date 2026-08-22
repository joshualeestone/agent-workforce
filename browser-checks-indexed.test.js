'use strict';

/**
 * Every browser check is listed in the README that describes them.
 *
 * 🛑 TEN OF TWENTY-ONE WERE NOT, including three written the same day. The
 * README explains what the directory is for and how to run it, and half the
 * directory was invisible to somebody reading it to find out what exists. A
 * check nobody knows about is a check nobody runs, which is the same as not
 * having written it.
 *
 * 🔑 IT GUARDS THE DIRECTION THAT ROTS. A README goes stale by the code moving
 * on without it, so the assertion is that every SCRIPT is named, not that every
 * name has a script. The reverse is checked too, because a listed script that
 * has been deleted sends the next person looking for a file that is not there.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const DIR = nodePath.join(__dirname, 'docs', 'browser-checks');

test('the browser-checks README names every script, and no script it does not have', () => {
  const readme = fs.readFileSync(nodePath.join(DIR, 'README.md'), 'utf8');
  const scripts = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  assert.ok(scripts.length > 10, 'found ' + scripts.length + ' scripts, so this test is looking in the wrong place');

  const missing = scripts.filter((f) => !readme.includes(f));
  assert.deepEqual(missing, [], 'browser checks that exist and are not in the README');

  /* The other direction: a name in the table with no file behind it. */
  const named = [...readme.matchAll(/`([a-z0-9-]+\.js)`/g)].map((m) => m[1]);
  const ghosts = [...new Set(named)].filter((n) => !scripts.includes(n));
  assert.deepEqual(ghosts, [], 'the README names scripts that are not there');
});
