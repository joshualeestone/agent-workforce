'use strict';

/**
 * The conversation limit, the person's control (2026-08-18 in-channel:
 * Josh's shape, Mona Lisa's copy and split, Splinter's convergence
 * catch).
 *
 * The model: the counter ALWAYS tells the person; this setting decides
 * only whether Kosmos also STOPS the conversation. Telling is not
 * configurable -- the valve's original job was convergence, cost was
 * borrowed onto it, and "two of your agents are circling" is true and
 * useful on a free model with nothing to bill.
 *
 * The dial is PER CONVERSATION, not global: each PAIR gets `perHour`
 * exchanges an hour; each ROOM gets four times that in arrivals (the
 * recorded 4x allowance: the room is the visible collaboration
 * surface). The default equals the previously hard-coded rate exactly,
 * so shipping this On changes nothing for existing fleets.
 *
 * ⚠️ An unreadable or malformed file fails toward ON at the default:
 * between "we could not read your setting so we spent your money" and
 * "we could not read your setting so we kept the brake on", the
 * bounded direction is the safe one, and the screens read the same
 * verdict so the card can say the file could not be read.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'limits.json');

const TIERS = [10, 20, 40, 100];
const DEFAULTS = { on: true, perHour: 20 };

/* The room's multiplier over the pair budget, the #75 allowance. */
const ROOM_FACTOR = 4;

/* One window, and it is an HOUR because the screen's unit is an hour:
   the number on screen must be the number they get (a person picking
   40 an hour must not silently get 40 per half hour). */
const WINDOW_MS = 60 * 60 * 1000;

function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ...DEFAULTS, ok: true };
    return { ...DEFAULTS, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ...DEFAULTS, ok: false }; }
  if (!parsed || typeof parsed !== 'object'
    || typeof parsed.on !== 'boolean' || !TIERS.includes(parsed.perHour)) {
    return { ...DEFAULTS, ok: false };
  }
  return { on: parsed.on, perHour: parsed.perHour, ok: true };
}

function write({ on, perHour }) {
  if (typeof on !== 'boolean') {
    return { ok: false, because: 'the switch must be on or off' };
  }
  if (!TIERS.includes(perHour)) {
    return { ok: false, because: 'pick one of the listed amounts' };
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    // A fixed tmp path serializes fine inside one process (sync writes);
    // two PROCESSES writing at once could interleave renames, a
    // multi-instance setup this app does not run. The rename keeps the
    // file itself untearable either way.
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ on, perHour }) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

/** The caps the messaging engine enforces, derived from one dial. */
function caps() {
  const r = read();
  return {
    on: r.on,
    ok: r.ok,
    pairPerWindow: r.perHour,
    roomArrivalsPerWindow: r.perHour * ROOM_FACTOR,
    windowMs: WINDOW_MS,
  };
}

module.exports = { FILE, TIERS, DEFAULTS, ROOM_FACTOR, WINDOW_MS, read, write, caps };
