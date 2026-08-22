'use strict';

/**
 * A picture is whatever its bytes say it is (#12).
 *
 * 🛑 THE TYPE USED TO COME FROM THE BROWSER, and that failed in both
 * directions. The page sends `file.type`, which a browser derives from the
 * FILENAME. So a perfectly good PNG with no extension, or one the OS does not
 * recognise, arrived with an empty content-type and was REFUSED with
 * "unsupported image type: unknown" on a file that would have rendered fine.
 * That is what makes setting your own picture look broken the first time (#181).
 *
 * ⚠️ AND THE OTHER DIRECTION WAS OPEN: anything at all could be stored as a
 * `.png` by saying so in a header. The served content-type is derived from the
 * stored extension rather than from the upload, so this was never an execution
 * hole, which is why it reads as a usability bug rather than a breach. It is
 * still storing a file we have not looked at under a name that claims we did.
 *
 * 🔑 One sniffer, in store.js, used by both the agent avatar and the person's
 * own picture. Two copies of four signatures is two places for a format to be
 * added to one of them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'imgtype-'));
const store = require('./store');
const you = require('./you');

/* Real signatures, the shortest form each format is recognisable in. Not
   pictures: this module reads the first bytes and says so, and a decoder is
   deliberately not what it is. */
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const GIF = Buffer.from('GIF89a');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

test('the bytes decide, and the four we accept are recognised', () => {
  assert.equal(store.imageTypeOf(PNG), 'image/png');
  assert.equal(store.imageTypeOf(JPEG), 'image/jpeg');
  assert.equal(store.imageTypeOf(GIF), 'image/gif');
  assert.equal(store.imageTypeOf(WEBP), 'image/webp');
  /* Every one of them is shorter than the longest signature. A single blanket
     minimum length refused the 8-byte PNG, which is what the suite's own
     fixtures are and what a truncated upload looks like. */
  for (const b of [PNG, JPEG, GIF]) assert.ok(b.length < WEBP.length);
});

test('a file that is not one of them is refused, whatever it claims', () => {
  for (const [what, b] of [
    ['html', Buffer.from('<html><script>alert(1)</script></html>')],
    ['a RIFF that is not WEBP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')])],
    ['text', Buffer.from('this is not a picture')],
    ['empty', Buffer.alloc(0)],
    ['nothing at all', null],
  ]) {
    assert.equal(store.imageTypeOf(b), null, what + ' was accepted as an image');
  }
});

test('a valid PNG is saved even when the browser could not name it', () => {
  /* 🔑 THE DEFECT ITSELF. An empty content-type is what a browser sends for a
     file whose extension it does not know, and it used to be a refusal. */
  for (const claimed of ['', undefined, 'application/octet-stream', 'text/plain']) {
    const dest = store.saveAvatar('bytesagent', claimed, PNG);
    assert.match(dest, /\.png$/, 'saved with the wrong extension for content-type ' + JSON.stringify(claimed));
  }
  assert.equal(you.savePicture('', PNG).ok, true, 'the person could not set a PNG the browser did not name');
});

test('a lie in the header does not get a file stored under it', () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.throws(() => store.saveAvatar('liar', 'image/png', html), /PNG, JPEG, WebP or GIF/,
    'HTML claiming to be a PNG was stored');
  assert.equal(you.savePicture('image/png', html).ok, false);
  /* And the extension follows the BYTES, not the claim: a JPEG announced as a
     PNG lands as .jpg, or the served content-type (derived from the extension)
     would describe it wrongly. */
  const dest = store.saveAvatar('mislabelled', 'image/png', JPEG);
  assert.match(dest, /\.jpg$/, 'the stored extension followed the header rather than the bytes');
});

test('the cheap refusals come first, so their sentences survive', () => {
  /* ⚠️ ORDER IS THE MESSAGE. Sniffing before checking the size tells somebody
     with a large photo that it is not a PNG, which is false and sends them
     looking for the wrong problem. Both were reordered once during this change
     and the suite caught it, which is the only reason the sentences are right. */
  const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
  assert.throws(() => store.saveAvatar('big', 'image/png', big), /larger than 5MB/);
  assert.match(you.savePicture('image/png', big).because, /larger than 5MB/);
  assert.throws(() => store.saveAvatar('none', 'image/png', Buffer.alloc(0)), /empty/);
  assert.match(you.savePicture('image/png', Buffer.alloc(0)).because, /empty/);
});

test('the refusal says what to do, and names what we think it got', () => {
  /* "unsupported image type: unknown" told somebody nothing. */
  try {
    store.saveAvatar('sayer', 'image/heic', Buffer.from('not a picture at all'));
    assert.fail('a HEIC was accepted');
  } catch (err) {
    assert.match(err.message, /PNG, JPEG, WebP or GIF/, err.message);
    assert.match(err.message, /image\/heic/, 'the sentence does not say what it looked like: ' + err.message);
  }
});
