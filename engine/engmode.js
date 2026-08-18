'use strict';

/**
 * Engineering mode: whether the raw session is shown at all.
 *
 * The clean rendering is the product (the conversation surfaces read
 * the record, never the pane); this switch only decides whether the
 * window underneath is ALSO shown -- on the project page's viewport and
 * the agent page's window box. Off is the default and hiding is the
 * point: the raw pane is the thing the person called "garbage nonsense
 * to me as a business person", and the setting exists to put it away
 * (Mona Lisa's spec, 2026-08-18).
 *
 * ⚠️ An unreadable or malformed file fails toward OFF: an unreadable
 * PREFERENCE must not reveal a surface the person never chose to show.
 * (limits.js fails the other way for the same reason stated there:
 * each fails toward its shipped default, which is each one's safe
 * direction.)
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'engmode.json');

const DEFAULTS = { on: false };

function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ...DEFAULTS, ok: true };
    return { ...DEFAULTS, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ...DEFAULTS, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.on !== 'boolean') {
    return { ...DEFAULTS, ok: false };
  }
  return { on: parsed.on, ok: true };
}

function write({ on }) {
  if (typeof on !== 'boolean') {
    return { ok: false, because: 'the switch must be on or off' };
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    // Same single-process tmp-rename shape as limits.js, same scope note.
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ on }) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

module.exports = { FILE, DEFAULTS, read, write };
