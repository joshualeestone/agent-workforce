'use strict';

/**
 * What each agent has agreed to do, kept somewhere a restart cannot reach.
 *
 * Restarting an agent kills whatever it had in flight, and the fresh session
 * reports a confident all-clear. Restart-on-boot and auto-update both do this
 * unattended, so a 3am reboot hits every agent at once with nobody watching.
 *
 * The point of this file is not to hold a list. It is to make the restart
 * confirmation incapable of lying, and there is exactly one way a simpler
 * version still lies:
 *
 *   **An empty list is not evidence of nothing pending.** A missing file, an
 *   agent that has never reported, and an agent genuinely holding nothing all
 *   produce the same empty array. Render that as "nothing to lose" and you have
 *   rebuilt the bug this whole codebase is built against -- a check that cannot
 *   tell "fine" from "I can't see it", showing green.
 *
 * So an empty list only counts when it is an *assertion*, not an absence. The
 * agent has to say "I am holding nothing", and it has to have said it recently.
 * Everything below follows from that.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/**
 * Where records live. `AGENT_WORKFORCE_DATA` relocates the whole store, which
 * is what lets the tests run against a temp directory instead of writing into
 * the real app data of whoever is running them. Read once at load, so a test
 * sets it before requiring this module.
 */
const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const DIR = path.join(BASE, 'commitments');

/**
 * Three states, never two. `unknown` is the default for anything we have not
 * positively verified, and it must never render as safe.
 */
const STATE = {
  HOLDING: 'holding',
  CLEAR: 'clear',
  UNKNOWN: 'unknown',
};

/**
 * How long an assertion of "nothing pending" stays believable.
 *
 * A "nothing pending" from three hours ago is not evidence about now -- the
 * agent has been working since. Short enough that a stale assertion cannot
 * survive a work session, long enough that `unknown` is not the normal state.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function recordPath(agent) {
  return path.join(DIR, store.safeKey(agent) + '.json');
}

function unknown(because) {
  return { state: STATE.UNKNOWN, commitments: [], reportedAt: null, because };
}

/**
 * Read one agent's commitments.
 *
 * Every failure path returns `unknown`. None of them return an empty list,
 * because an empty list is the one answer that would let the caller say "safe
 * to proceed" on the strength of a file it could not read.
 */
function read(agent) {
  let key;
  try {
    key = store.safeKey(agent);
  } catch {
    return unknown('that is not a name we can look up');
  }

  let raw;
  try {
    raw = fs.readFileSync(path.join(DIR, key + '.json'), 'utf8');
  } catch {
    // No file at all. This agent has never told us anything, which is not the
    // same as having nothing to tell.
    return unknown('this agent has never reported what it is holding');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A truncated or corrupt file. Falling back to empty here would turn a
    // storage fault into a confident "nothing to lose".
    return unknown('its record could not be read');
  }

  const reportedAt = typeof parsed.reportedAt === 'string' ? parsed.reportedAt : null;
  const at = reportedAt ? Date.parse(reportedAt) : NaN;
  if (!reportedAt || Number.isNaN(at)) {
    return unknown('its record does not say when it was written');
  }

  const ageMs = Date.now() - at;
  if (ageMs > STALE_AFTER_MS) {
    // Deliberately decays rather than persisting. The agent has been running
    // since it last spoke, so the old answer is not about now.
    const mins = Math.round(ageMs / 60000);
    return { ...unknown(`it last reported ${mins} minutes ago, too long to still be true`), reportedAt };
  }

  const commitments = Array.isArray(parsed.commitments) ? parsed.commitments : null;
  if (!commitments) {
    return unknown('its record is not in a shape we understand');
  }

  return {
    state: commitments.length ? STATE.HOLDING : STATE.CLEAR,
    commitments,
    reportedAt,
    because: commitments.length
      ? 'it reported these itself'
      : 'it reported that it is holding nothing',
  };
}

/**
 * Replace an agent's commitments wholesale.
 *
 * Replace rather than append, deliberately. An append-only API cannot express
 * *nothing*, and "I am holding nothing" is the single most important sentence
 * this store has to be able to record.
 */
function report(agent, commitments) {
  const key = store.safeKey(agent);
  if (!Array.isArray(commitments)) throw new Error('commitments must be a list');

  const clean = commitments.map((c) => {
    const what = String((c && c.what) || '').trim();
    if (!what) throw new Error('every commitment needs a description');
    return {
      id: String((c && c.id) || crypto.randomUUID()),
      what: what.slice(0, 300),
      createdAt: (c && c.createdAt) || new Date().toISOString(),
      source: String((c && c.source) || 'agent').slice(0, 40),
    };
  });

  ensure(DIR);
  const next = { agent: key, reportedAt: new Date().toISOString(), commitments: clean };

  // Write-then-rename. Up to thirteen agents write concurrently on this
  // machine, and a half-written file that parses as an empty array is exactly
  // the silent loss this store exists to prevent.
  const dest = path.join(DIR, key + '.json');
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, dest);
  return next;
}

/** Convenience: record one more thing, keeping what is already there. */
function add(agent, what) {
  const current = read(agent);
  // Starting from `unknown` would silently discard commitments we simply could
  // not read, so only extend a list we actually managed to load.
  const base = current.state === STATE.UNKNOWN ? [] : current.commitments;
  return report(agent, [...base, { what }]);
}

/** Convenience: mark one done. */
function resolve(agent, id) {
  const current = read(agent);
  if (current.state === STATE.UNKNOWN) {
    throw new Error('cannot resolve a commitment for an agent whose record we cannot read');
  }
  return report(agent, current.commitments.filter((c) => c.id !== id));
}

/** Every agent we hold a record for, keyed by agent. */
function readAll() {
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(DIR);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const key = f.slice(0, -'.json'.length);
    out[key] = read(key);
  }
  return out;
}

module.exports = { DIR, STATE, STALE_AFTER_MS, read, report, add, resolve, readAll, recordPath };
