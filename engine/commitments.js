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
// ⚠️ This moves the COMMITMENT store only. `store.ROOT` still governs avatars
// and profiles, so a test or local server that sets this is only partly
// sandboxed. That is a trap in a variable named for the whole data directory,
// and it is why the tests here also avoid the avatar and profile write routes
// entirely. Moving the override onto `store.ROOT` so all three travel together
// is tracked separately.
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

/**
 * Ceiling on the size of one record file, checked before it is opened.
 *
 * Generous next to what report() can produce (200 commitments of 300 characters
 * is well under 100KB), so it only ever catches a file we did not write.
 */
const MAX_RECORD_BYTES = 512 * 1024;

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function recordPath(agent) {
  return path.join(DIR, store.safeKey(agent) + '.json');
}

// ⚠️ store.safeKey() STRIPS unsafe characters rather than rejecting, so
// `worker.2` and `worker2` collapse to one key. For avatars a collision costs a
// picture; here it would cost the answer the restart dialog depends on, so it
// is guarded twice: report() refuses a name that is not already its own key,
// and read() refuses a record whose stored name does not match. The underlying
// key derivation is shared with avatars and profiles and still wants solving
// once across all three.

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
  // The result is unused; this is a validity check, and safeKey throws on a
  // name that sanitises to nothing.
  try {
    store.safeKey(agent);
  } catch {
    return { ok: false, absent: false, because: 'that is not a name we can look up' };
  }

  const file = recordPath(agent);

  // Must be a regular file before we open it. `readFileSync` on a FIFO blocks
  // FOREVER, and read() runs synchronously per agent inside the request
  // handler, so a single named pipe in the store wedges the entire server with
  // no crash and nothing to notice. The avatar route learned this same lesson
  // against a directory; the fix belongs here too. `lstat` rather than `stat`
  // so a symlink cannot point the read outside the store.
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    const absent = err && err.code === 'ENOENT';
    return {
      ok: false,
      absent,
      because: absent
        ? 'this agent has never reported what it is holding'
        : 'its record could not be examined',
    };
  }
  if (!stat.isFile()) {
    return { ok: false, absent: false, because: 'its record is not a file we can read' };
  }

  // Size is checked BEFORE the read, from the stat we already have. The entry
  // cap counts commitments and only applies after the file is parsed, which is
  // far too late: a 200 MB record measured 232ms per read, 1.1 GB resident, and
  // a 209 MB status payload, serialised synchronously inside the request
  // handler on a board that polls continuously. Same shape as the FIFO above.
  if (stat.size > MAX_RECORD_BYTES) {
    return { ok: false, absent: false, because: 'its record is far larger than we can read' };
  }

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
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

  // Elements are validated on the way OUT as well as in. report() sanitises
  // what it writes, but a record can be edited by hand, and an element of
  // `null` made resolve() throw on `.id` from inside the request handler. A
  // record we cannot fully understand is one we cannot vouch for.
  const usable = parsed.commitments.every(
    (c) => c && typeof c === 'object' && !Array.isArray(c)
      && typeof c.what === 'string' && c.what.trim() !== '',
  );
  if (!usable) {
    return { ok: false, absent: false, because: 'its record lists something we cannot read' };
  }

  // Guard the key collision described above. A record with no `name` is refused
  // rather than trusted: this module has never shipped a version that omitted
  // it, so a record missing it was not written by us, and the carve-out that
  // used to accept those reopened the exact hole this closes.
  if (parsed.name !== String(agent)) {
    return {
      ok: false,
      absent: false,
      // Capped: the name comes from a file, and this string is echoed into
      // every /api/status response.
      because: `that record belongs to ${String(parsed.name).slice(0, 60)}, not this agent`,
    };
  }

  // Capped on the way OUT as well as in. The write path bounds what it stores,
  // but a record can be hand-edited, and read() feeds straight into every
  // /api/status poll -- 5,000 entries measured at 12.6 MB per agent, serialised
  // synchronously inside the request handler.
  if (parsed.commitments.length > MAX_COMMITMENTS) {
    return { ok: false, absent: false, because: 'its record lists more than we can show' };
  }

  const clean = safeSanitise(parsed.commitments);
  if (!clean) {
    return { ok: false, absent: false, because: 'its record lists something we cannot read' };
  }

  return {
    ok: true,
    // Sanitised on the way OUT with the same function used on the way in.
    // Capping only `what` here re-served `id`, `createdAt`, `source` and any
    // extra key verbatim, which is the exact createdAt bug the write path
    // records as fixed, still reachable through a hand-edited record.
    //
    // `usable` above already rejects everything sanitise() would throw on. The
    // try is here anyway because read() must NEVER throw: it is called
    // synchronously inside the request handler, once per agent, so a throw
    // exits the process on a GET and 500s the whole board on /api/status. This
    // exact combination shipped for one round -- a whitespace-only `what`
    // passed the usability check and then threw inside sanitise.
    commitments: clean,
    reportedAt,
    ageMs: Date.now() - at,
  };
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
  // The supplied name must already BE the key. safeKey strips rather than
  // rejects, so `ANGEL`, `angel.` and `angel` all sanitise to `angel` -- and a
  // write under any of those spellings landed in the same file. The previous
  // version detected that on a later read, by which point the real record had
  // already been overwritten and the writer told it succeeded. Refusing an
  // aliased spelling is the only version that protects the data rather than
  // reporting on its loss afterwards.
  if (String(agent) !== key) {
    throw new Error(`report under the agent's exact name: "${key}", not "${agent}"`);
  }
  if (!Array.isArray(commitments)) throw new Error('commitments must be a list');
  if (commitments.length > MAX_COMMITMENTS) {
    throw new Error(`an agent cannot hold more than ${MAX_COMMITMENTS} commitments`);
  }

  return writeRecord(key, agent, sanitise(commitments), new Date().toISOString());
}

/** Coerce and cap every field of every commitment. */
function sanitise(commitments) {
  return commitments.map((c) => {
    const what = String((c && c.what) || '').trim();
    if (!what) throw new Error('every commitment needs a description');
    // Every field is coerced AND capped. `createdAt` was once the exception,
    // passing through whole, so a 25,000-character value rode along in every
    // /api/status poll on the board's continuous-read path. The cap comes
    // first: `Date.parse` accepts arbitrarily long strings through its legacy
    // parenthesised-comment syntax, so validating without capping would not
    // have stopped it.
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
}

/**
 * Write a record with an explicit assertion time.
 *
 * Separated from `report()` because **the timestamp is a claim about when the
 * agent last told us its whole state**, and a derived change is not that claim.
 * `add()` and `resolve()` used to route through `report()`, which stamped
 * `now`, so mutating a 31-minute-stale record re-published it as current: a
 * no-op `resolve()` on a stale record turned "we cannot tell" into a confident
 * answer. That is the exact failure this module exists to prevent, reached
 * through the module's own convenience API.
 */
function writeRecord(key, rawName, clean, reportedAt) {
  // Capped HERE rather than only in report(). add() and resolve() call this
  // directly on a stale record, and because that branch deliberately preserves
  // the old timestamp the record stays stale, so every later add() takes the
  // same branch. The cap was defeated through the module's own convenience API.
  if (clean.length > MAX_COMMITMENTS) {
    throw new Error(`an agent cannot hold more than ${MAX_COMMITMENTS} commitments`);
  }

  // `name` is the RAW agent name, `agent` the sanitised key. Both are stored so
  // a read can tell whether this record actually belongs to the agent being
  // asked about: safeKey STRIPS rather than rejects, so `worker.2` and `worker2`
  // collapse to one key.
  const next = { agent: key, name: String(rawName), reportedAt, commitments: clean };

  // Write-then-rename. Up to thirteen agents write concurrently on this
  // machine, and a half-written file that parses as an empty array is exactly
  // the silent loss this store exists to prevent. The temp name carries the pid
  // so two processes cannot collide on it.
  // Derived by the same function the read path uses. These were three
  // separate `path.join` calls, so the traversal test could pass against
  // recordPath() while the code that actually reads and writes used something
  // else. One derivation, one place to get it wrong.
  const dest = recordPath(rawName);
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    // Inside the try: mkdir has its own errno, and it carries the absolute
    // store path. Leaving it outside meant the comment below about never
    // surfacing a raw errno was false for the most likely failure of the two.
    ensure(DIR);
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, dest);
  } catch {
    // Any failure between the write and the rename otherwise leaves the temp
    // file behind forever, accumulating one per failed attempt.
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to do */ }
    // Never surface the raw errno: it carries the absolute store path, and the
    // house rule for this catch is to say what to do rather than name an
    // exception.
    throw new Error('that could not be saved');
  }
  return next;
}

/**
 * `sanitise()` for the read path, which must never throw.
 *
 * Returns null rather than raising, so a record we cannot normalise becomes
 * `unknown` instead of an uncaught exception in the request handler.
 */
function safeSanitise(commitments) {
  try {
    return sanitise(commitments);
  } catch {
    return null;
  }
}

/** True when a parsed record is too old, or dated too far ahead, to vouch for. */
function isStale(rec) {
  return rec.ageMs > STALE_AFTER_MS || rec.ageMs < -FUTURE_TOLERANCE_MS;
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

  // A stale base keeps its original timestamp. The agent has told us about ONE
  // new thing; it has not re-asserted everything else, so the record must go on
  // reading `unknown` until it does. Re-stamping here would launder "we cannot
  // tell" into "nothing else pending", which is the whole failure mode.
  if (isStale(rec)) {
    return writeRecord(store.safeKey(agent), agent, sanitise([...rec.commitments, { what }]), rec.reportedAt);
  }
  return report(agent, [...rec.commitments, { what }]);
}

/** Convenience: mark one done. */
function resolve(agent, id) {
  const rec = parseRecord(agent);
  if (!rec.ok) {
    throw new Error(`cannot resolve a commitment for a record we cannot read: ${rec.because}`);
  }
  const remaining = rec.commitments.filter((c) => c.id !== id);

  // Same rule as `add()`. What parsed is the list **as of `reportedAt`**, and
  // nothing is known about what the agent took on since, so a stale record
  // keeps its original timestamp and goes on reading `unknown`. The comment
  // that used to sit here said "a stale record resolves fine: it parsed, so the
  // list is known", which is what made the laundering read as intentional.
  if (isStale(rec)) {
    return writeRecord(store.safeKey(agent), agent, sanitise(remaining), rec.reportedAt);
  }
  return report(agent, remaining);
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

module.exports = { DIR, STATE, STALE_AFTER_MS, FUTURE_TOLERANCE_MS, MAX_COMMITMENTS, MAX_RECORD_BYTES, read, report, add, resolve, readAll, recordPath };
