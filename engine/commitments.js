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

/**
 * Ceiling on how many commitments one agent may hold.
 *
 * Without it a single local PUT can write hundreds of thousands of entries,
 * which then serialise into every /api/status poll. A person cannot act on a
 * list that long anyway, and the restart dialog has to render it.
 */
const MAX_COMMITMENTS = 200;

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function recordPath(agent) {
  return path.join(DIR, store.safeKey(agent) + '.json');
}

// ⚠️ Residual risk inherited from store.safeKey(): it STRIPS unsafe characters
// rather than rejecting, so `worker.2` and `worker2` collapse to one key and
// share a record. For avatars a collision costs a picture. Here it costs the
// answer the restart dialog depends on -- one agent can be rendered `clear` on
// the strength of a different agent's assertion. Recorded rather than fixed,
// because changing the key derivation would orphan every existing avatar and
// profile too; it wants solving once, across all three stores.

function unknown(because) {
  return { state: STATE.UNKNOWN, commitments: [], reportedAt: null, because };
}

/**
 * How far a `reportedAt` may sit in the future before we stop believing it.
 *
 * A timestamp ahead of now is not a fresh assertion, it is an unreadable one.
 * The staleness check used to be one-sided, so a future date produced a
 * negative age, sailed under the ceiling, and read as `clear` **forever** --
 * the exact "empty list treated as safe" failure this file exists to prevent.
 * It is not exotic: `reportedAt` comes from the local clock, so an NTP
 * correction, a machine that booted fast, or a record copied from a machine
 * ahead all produce one. A small tolerance absorbs ordinary jitter; beyond it
 * we say we cannot tell.
 */
const FUTURE_TOLERANCE_MS = 60 * 1000;

/**
 * Read and validate one record, separating "could not read it" from "read it
 * fine, but it is old".
 *
 * Those are different answers and collapsing them destroyed data: `add()` used
 * to treat every `unknown` as "nothing to preserve", so an agent holding three
 * real commitments whose record had merely aged past the window lost all three
 * on the next `add()`, and then read `clear`. A genuinely-holding agent became
 * "nothing in flight" through two ordinary calls.
 *
 * Returns `{ ok: false, because }` when the record cannot be trusted as data at
 * all, or `{ ok: true, commitments, reportedAt, ageMs }` when it parsed.
 */
function parseRecord(agent) {
  let key;
  try {
    key = store.safeKey(agent);
  } catch {
    return { ok: false, absent: false, because: 'that is not a name we can look up' };
  }

  let raw;
  try {
    raw = fs.readFileSync(path.join(DIR, key + '.json'), 'utf8');
  } catch (err) {
    // ENOENT is the only read failure that means "there is nothing here". Every
    // other one -- EACCES, EISDIR, EMFILE, ENAMETOOLONG -- means a record may
    // well exist and we simply could not open it.
    //
    // These used to share one message, and `add()` decided whether to preserve
    // the existing list by MATCHING THAT PROSE. So an unreadable record looked
    // identical to a missing one and `add()` overwrote it: an agent holding two
    // real commitments behind a permissions error lost both. `absent` is a
    // field, not a sentence, precisely so a caller cannot get this wrong again.
    const absent = err && err.code === 'ENOENT';
    return {
      ok: false,
      absent,
      because: absent
        ? 'this agent has never reported what it is holding'
        : 'its record exists but could not be opened',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, absent: false, because: 'its record could not be read' };
  }

  // `JSON.parse` happily returns null, a number, or an array, and reaching for
  // `.reportedAt` on null throws -- which, from inside the request handler,
  // exits the process. A single file containing `null` was enough.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, absent: false, because: 'its record is not in a shape we understand' };
  }

  const reportedAt = typeof parsed.reportedAt === 'string' ? parsed.reportedAt : null;
  const at = reportedAt ? Date.parse(reportedAt) : NaN;
  if (!reportedAt || Number.isNaN(at)) {
    return { ok: false, absent: false, because: 'its record does not say when it was written' };
  }

  if (!Array.isArray(parsed.commitments)) {
    return { ok: false, absent: false, because: 'its record is not in a shape we understand' };
  }

  // Guard the key collision described above. Records written before this field
  // existed have no `name`, and are accepted rather than invalidated.
  if (typeof parsed.name === 'string' && parsed.name !== String(agent)) {
    return {
      ok: false,
      absent: false,
      because: `that record belongs to ${parsed.name}, not this agent`,
    };
  }

  return { ok: true, commitments: parsed.commitments, reportedAt, ageMs: Date.now() - at };
}

/**
 * Read one agent's commitments.
 *
 * Every failure path returns `unknown`. None of them return an empty list,
 * because an empty list is the one answer that would let the caller say "safe
 * to proceed" on the strength of a file it could not read.
 */
function read(agent) {
  const rec = parseRecord(agent);
  if (!rec.ok) return unknown(rec.because);

  if (rec.ageMs < -FUTURE_TOLERANCE_MS) {
    return {
      ...unknown('its record is dated in the future, so we cannot tell when it was true'),
      reportedAt: rec.reportedAt,
      commitments: rec.commitments,
    };
  }

  if (rec.ageMs > STALE_AFTER_MS) {
    // Decays rather than persisting: the agent has been running since it last
    // spoke, so the old answer is not about now. The list still comes back --
    // "these three were pending 40 minutes ago" is far more useful at 3am than
    // an empty array, as long as the state says we cannot vouch for it.
    const mins = Math.round(rec.ageMs / 60000);
    return {
      ...unknown(`it last reported ${mins} minutes ago, too long to still be true`),
      reportedAt: rec.reportedAt,
      commitments: rec.commitments,
    };
  }

  return {
    state: rec.commitments.length ? STATE.HOLDING : STATE.CLEAR,
    commitments: rec.commitments,
    reportedAt: rec.reportedAt,
    because: rec.commitments.length
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
  if (commitments.length > MAX_COMMITMENTS) {
    throw new Error(`an agent cannot hold more than ${MAX_COMMITMENTS} commitments`);
  }

  const clean = commitments.map((c) => {
    const what = String((c && c.what) || '').trim();
    if (!what) throw new Error('every commitment needs a description');
    // Every field is coerced and capped. An uncoerced `createdAt` was stored
    // and re-served verbatim on every /api/status poll.
    // Capped AND validated. It was previously the one field passing through
    // whole, so a 25,000-character value rode along in every /api/status poll
    // on the board's continuous-read path -- while the comment above claimed
    // every field was capped.
    const supplied = c && typeof c.createdAt === 'string' ? c.createdAt.slice(0, 40) : null;
    const createdAt = supplied && !Number.isNaN(Date.parse(supplied))
      ? supplied
      : new Date().toISOString();
    return {
      id: String((c && c.id) || crypto.randomUUID()).slice(0, 80),
      what: what.slice(0, 300),
      createdAt,
      source: String((c && c.source) || 'agent').slice(0, 40),
    };
  });

  ensure(DIR);
  // `name` is the RAW agent name, `agent` the sanitised key. Both are stored so
  // a read can tell whether this record actually belongs to the agent being
  // asked about: safeKey STRIPS rather than rejects, so `worker.2` and `worker2`
  // collapse to one key. Without this check, one agent's "I hold nothing" is
  // served as `clear` for a different agent that has never reported.
  const next = {
    agent: key,
    name: String(agent),
    reportedAt: new Date().toISOString(),
    commitments: clean,
  };

  // Write-then-rename. Up to thirteen agents write concurrently on this
  // machine, and a half-written file that parses as an empty array is exactly
  // the silent loss this store exists to prevent. The temp name carries the pid
  // so two processes cannot collide on it.
  const dest = path.join(DIR, key + '.json');
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, dest);
  return next;
}

/**
 * Convenience: record one more thing, keeping what is already there.
 *
 * Refuses when the record could not be read, rather than starting a fresh list.
 * Starting fresh is what destroyed data: an unreadable record is not an empty
 * one, and overwriting it converts "I cannot tell" into a confident answer.
 *
 * A *stale* record is different and is carried forward: it parsed, so the list
 * is known, it is only the freshness that lapsed. Adding to it is exactly right
 * and re-stamps it as current.
 */
function add(agent, what) {
  const rec = parseRecord(agent);
  if (!rec.ok) {
    // Only a genuinely absent record may start a list. Anything else means a
    // record may exist that we could not read, and writing over it loses
    // whatever it held. Branching on `absent` rather than on the message text
    // is deliberate: the prose version of this guard silently matched every
    // read error and destroyed data.
    if (!rec.absent) {
      throw new Error(`cannot add to a record we cannot read: ${rec.because}`);
    }
    return report(agent, [{ what }]);
  }
  return report(agent, [...rec.commitments, { what }]);
}

/** Convenience: mark one done. */
function resolve(agent, id) {
  const rec = parseRecord(agent);
  if (!rec.ok) {
    throw new Error(`cannot resolve a commitment for a record we cannot read: ${rec.because}`);
  }
  // A stale record resolves fine: it parsed, so the list is known.
  return report(agent, rec.commitments.filter((c) => c.id !== id));
}

/**
 * Every agent we hold a RECORD for, keyed by agent.
 *
 * ⚠️ This is not a roster and must not be used as one. An agent that has never
 * reported has no file, so it is simply absent from the result -- and a caller
 * iterating this sees no holdings, which is indistinguishable from every agent
 * asserting clear. That is the precise failure the rest of this file exists to
 * prevent, so the board does NOT use this: `/api/status` maps over the roster
 * from the status engine and calls `read()` per agent, which yields an explicit
 * `unknown` for the silent ones.
 *
 * Use this only when you want "what records exist", never "what is everyone
 * holding".
 */
function readAll() {
  // Null-prototype: a record file named `__proto__.json` would otherwise
  // mutate the returned object instead of appearing as a key.
  const out = Object.create(null);
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

module.exports = { DIR, STATE, STALE_AFTER_MS, FUTURE_TOLERANCE_MS, MAX_COMMITMENTS, read, report, add, resolve, readAll, recordPath };
