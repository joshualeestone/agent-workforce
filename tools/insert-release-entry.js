'use strict';

/**
 * Put a release entry on the versions page, stamped with the minute it went out.
 *
 *   node tools/insert-release-entry.js <entry.html> [--site <path>]
 *
 * ⚠️ THE COPY IS NOT GENERATED, and that split is deliberate: entry wording is
 * ruled, and a script that wrote it would be a script inventing claims about
 * what a release does. What IS mechanical is the timestamp (the one field that
 * cannot be written in advance) and the placement (above the newest entry,
 * never inside or over an existing one).
 *
 * ⚠️ AND THE PAGE'S OWN RULE IS NEVER TO EDIT AN EXISTING ENTRY. This only ever
 * INSERTS: it refuses if the version is already on the page rather than
 * replacing it, so a re-run cannot quietly rewrite history.
 *
 * The entry file carries `TIMESTAMP` where the time goes.
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const entryFile = args.find((a) => !a.startsWith('--'));
const siteIdx = args.indexOf('--site');
const SITE = siteIdx >= 0 ? args[siteIdx + 1]
  : (process.env.KOSMOS_SITE || path.join(process.env.HOME, 'work', 'chaoskosmos-site'));

if (!entryFile) {
  console.error('usage: node tools/insert-release-entry.js <entry.html> [--site <path>]');
  process.exit(2);
}

const page = path.join(SITE, 'versions.html');
const entry = fs.readFileSync(entryFile, 'utf8');
let html = fs.readFileSync(page, 'utf8');

const idMatch = entry.match(/id="(v[0-9-]+)"/);
if (!idMatch) { console.error('the entry has no id="v0-0-0" anchor'); process.exit(1); }
const id = idMatch[1];

if (html.includes(`id="${id}"`)) {
  console.log(`   ${id} is already on the page; nothing written`);
  process.exit(0);
}
if (!entry.includes('TIMESTAMP')) {
  console.error('the entry has no TIMESTAMP placeholder, so it would go out undated');
  process.exit(1);
}

/* ⚠️ CENTRAL, because that is the clock every other entry on this page is
   stamped in and the one Josh reads. A release stamped in the machine's
   timezone would be a different fact wearing the same format. */
const when = new Date().toLocaleString('en-US', {
  timeZone: 'America/Chicago',
  month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).replace(' at ', ', ');
const stamped = entry.replace('TIMESTAMP', `${when} CDT`);

/* Above the newest entry, and above its comment if it has one: the comment
   belongs to the entry below it, so inserting between them would orphan it. */
const anchor = html.search(/ {4}<article class="rel" id="v[0-9-]+"/);
if (anchor < 0) { console.error('no existing entry found to insert above'); process.exit(1); }
const commentAt = html.lastIndexOf('    <!--', anchor);
const at = (commentAt > 0 && anchor - commentAt < 2000) ? commentAt : anchor;

fs.writeFileSync(page, html.slice(0, at) + stamped + '\n' + html.slice(at));
console.log(`   inserted ${id}, stamped ${when} CDT`);
