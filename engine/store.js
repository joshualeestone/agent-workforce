'use strict';

/**
 * Where the platform keeps what it creates.
 *
 * The rule from the storage split: **the user's project folder holds their
 * work and nothing of ours.** Everything the platform generates lives in app
 * data, keyed by agent. That is what makes it safe to point an agent at a
 * folder someone already has — including one under version control — without
 * quietly adding our files to their repo.
 *
 * macOS convention, so backup, Time Machine and cleanup behave the way people
 * already expect.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = 'AgentWorkforce';
// ⚠️ Honours `AGENT_WORKFORCE_DATA` so tests can sandbox it, which they could
// not before: `status.test.js` set that variable, commented that it stopped
// `readProfile` and `avatarPath` reaching the operator's real store, and was
// wrong — this module read no environment at all, so those calls went to the
// live store and the gates that depend on them could not be pinned against
// seeded data. `engine/commitments.js` already honours the same variable, so
// this makes two modules agree rather than introducing a new convention.
const ROOT = process.env.AGENT_WORKFORCE_DATA
  ? path.join(process.env.AGENT_WORKFORCE_DATA, APP)
  : path.join(os.homedir(), 'Library', 'Application Support', APP);
const AVATARS = path.join(ROOT, 'avatars');
const PROFILES = path.join(ROOT, 'profiles');

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Agent names come from tmux session names and end up in file paths, so they
 * are treated as untrusted. A name containing `../` would otherwise write
 * outside the store entirely.
 */
function safeKey(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!key) throw new Error('invalid agent name');
  return key;
}

const ALLOWED_IMAGES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function avatarPath(name) {
  const key = safeKey(name);
  try {
    for (const f of fs.readdirSync(AVATARS)) {
      if (f.startsWith(key + '.')) return path.join(AVATARS, f);
    }
  } catch { /* no avatars yet */ }
  return null;
}

/**
 * What an image ACTUALLY is, read from its first bytes.
 *
 * 🛑 THE TYPE USED TO COME FROM THE BROWSER AND THAT FAILED BOTH WAYS. The page
 * sends `file.type`, which a browser derives from the FILENAME, so a perfectly
 * good PNG with no extension or one the OS does not recognise arrives with an
 * empty content-type and was refused: "unsupported image type: unknown", on a
 * file that would have rendered fine. That is the whole of #12, and it is what
 * makes #181 look broken the first time somebody sets their own picture.
 *
 * 🔑 AND IT IS THE SAME RULE AS EVERY OTHER TRUST DECISION IN HERE: prefer the
 * thing over a claim about the thing. The bytes cannot be wrong about what they
 * are; a header supplied by the caller can be wrong in either direction, and
 * one of those directions is refusing something valid while the other is
 * accepting something that is not an image at all.
 *
 * ⚠️ SIGNATURES ONLY, NOT A DECODER. This says "these bytes begin like a PNG",
 * which is exactly enough to choose a file extension and to refuse a text file
 * claiming to be one. It does not say the image is well formed, and it is not
 * trying to: a truncated PNG is still a PNG, and the page showing a broken
 * image is a better outcome than this file pretending to validate one.
 *
 * @returns {string|null} one of the ALLOWED_IMAGES keys, or null
 */
function imageTypeOf(buffer) {
  if (!buffer || !buffer.length) return null;
  const b = buffer;
  /* ⚠️ EACH FORMAT IS GUARDED BY THE LENGTH IT ACTUALLY NEEDS. A blanket
     minimum of 12 (WEBP's, the longest) refused an 8-byte PNG signature, which
     is a real thing to be handed: the suite's own fixtures are exactly that,
     and a truncated upload is too. Refusing it is not wrong about the file, it
     is wrong about WHY, and "that has to be a PNG" is a bad sentence to show
     somebody holding a PNG. */
  // PNG: the 8-byte signature, which includes the CRLF/EOF pair that exists to
  // catch exactly the transfer corruption we would otherwise store.
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  // JPEG: SOI, then any marker.
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // GIF87a / GIF89a.
  if (b.length >= 6 && (b.slice(0, 6).toString('latin1') === 'GIF87a' || b.slice(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  // WEBP is a RIFF container: "RIFF" then four size bytes then "WEBP". The
  // size bytes are skipped rather than checked, because a wrong length is a
  // broken file rather than a different format.
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function saveAvatar(name, contentType, buffer) {
  if (!buffer || !buffer.length) throw new Error('empty file');
  /* ⚠️ EMPTY AND OVERSIZE FIRST, and the order is the message. Sniffing a 6MB
     PNG says "not an image" only if you sniff junk; sniffing FIRST would tell
     somebody with a large photo that it is not a PNG, which is false and sends
     them looking for the wrong problem. */
  if (buffer.length > 5 * 1024 * 1024) throw new Error('image is larger than 5MB');
  /* 🔑 THE BYTES DECIDE, and `contentType` is now only a hint for the sentence.
     It used to decide, which refused a valid PNG whose browser-guessed type
     was empty and accepted anything at all that claimed to be one. */
  const sniffed = imageTypeOf(buffer);
  const ext = ALLOWED_IMAGES[sniffed];
  if (!ext) {
    /* The message names what we got where we can, because "unsupported image
       type: unknown" tells somebody nothing about what to do next. */
    throw new Error(contentType && !ALLOWED_IMAGES[contentType]
      ? `that has to be a PNG, JPEG, WebP or GIF, and this looks like ${contentType}`
      : 'that has to be a PNG, JPEG, WebP or GIF');
  }

  const key = safeKey(name);
  ensure(AVATARS);
  // Replace rather than accumulate: one avatar per agent, and an old .png
  // left beside a new .jpg would win or lose by directory order.
  const existing = avatarPath(name);
  if (existing) fs.unlinkSync(existing);

  const dest = path.join(AVATARS, key + ext);
  fs.writeFileSync(dest, buffer);
  return dest;
}

function removeAvatar(name) {
  const existing = avatarPath(name);
  if (existing) fs.unlinkSync(existing);
  return Boolean(existing);
}

/**
 * Profile: the things a person sets that the machine cannot derive.
 *
 * Role is the clearest example — nothing on this machine records what an agent
 * *is*. It is new metadata the user supplies, and it is what makes "Project
 * Manager" mean something the product can act on later.
 */
function profilePath(name) {
  return path.join(PROFILES, safeKey(name) + '.json');
}

function readProfile(name) {
  try {
    return JSON.parse(fs.readFileSync(profilePath(name), 'utf8'));
  } catch {
    return {};
  }
}

function writeProfile(name, patch) {
  ensure(PROFILES);
  const next = { ...readProfile(name), ...patch, updatedAt: new Date().toISOString() };
  // Write-then-rename, so an interrupted write cannot leave a half-written
  // file that parses as an empty profile and silently loses someone's edits.
  const tmp = profilePath(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, profilePath(name));
  return next;
}

/**
 * ⚠️ `profilePath` is NOT exported, and the reason belongs here because this
 * branch exported it and then justified it by saying it had no caller.
 *
 * It was needed for an earlier design in which removing an agent DELETED what
 * this module remembers about it. That design is gone: removing an agent now
 * deletes nothing at all, on purpose, which is what makes it reversible — so a
 * profile deliberately survives its agent's removal and is there again when the
 * agent is restored. Nothing outside this file needs the path, so nothing gets
 * it. A symbol whose only justification is symmetry is a symbol somebody will
 * eventually use for the deletion this feature exists not to do.
 */
module.exports = { ROOT, AVATARS, PROFILES, safeKey, ALLOWED_IMAGES, imageTypeOf, avatarPath, saveAvatar, removeAvatar, readProfile, writeProfile };
