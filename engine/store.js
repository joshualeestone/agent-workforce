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

function saveAvatar(name, contentType, buffer) {
  const ext = ALLOWED_IMAGES[contentType];
  // Refusing an unknown type beats saving something the page then cannot
  // render, which would look like the upload silently failed.
  if (!ext) throw new Error(`unsupported image type: ${contentType || 'unknown'}`);
  if (!buffer || !buffer.length) throw new Error('empty file');
  if (buffer.length > 5 * 1024 * 1024) throw new Error('image is larger than 5MB');

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
module.exports = { ROOT, AVATARS, PROFILES, safeKey, ALLOWED_IMAGES, avatarPath, saveAvatar, removeAvatar, readProfile, writeProfile };
