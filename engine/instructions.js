'use strict';

/**
 * The file an agent reads to know what it is for.
 *
 * Every agent has one, at `~/work/workers/<agent>/CLAUDE.md`. It is the first
 * thing the agent reads when it starts, and it is how you tell it what its job
 * is. Today those files exist and are effectively invisible: they live on the
 * machine and nothing surfaces them.
 *
 * ⚠️ **This is the most powerful write in the product.** It is not an avatar.
 * It changes how a live agent behaves the next time it starts, so every write
 * here is guarded harder than anything else in the codebase.
 *
 * ⚠️ **And it comes with a trap.** The file is read ONCE, at session start.
 * Editing it does not change a running agent -- only a restart re-reads it
 * (compact and clear do not). So a screen that saves the text and shows it back
 * is asserting something untrue: the agent is still running on what it read at
 * boot.
 *
 * A toast on save does not fix that. It is gone the moment you navigate away,
 * and it says nothing when the file is edited outside the app. So staleness is
 * derived as a STATE, from the file's modification time against the session's
 * start time, and it stays true no matter how the edit happened.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');
const { transcriptFor } = require('./status');

/**
 * Where worker instruction files live. Every path is asserted to be inside it.
 *
 * `AGENT_WORKFORCE_WORKERS` relocates it, which is what lets the tests exercise
 * the real read and write paths against a temp directory instead of an actual
 * agent's instructions. Read once at load, so a test sets it before requiring.
 */
const ROOT = process.env.AGENT_WORKFORCE_WORKERS || path.join(os.homedir(), 'work', 'workers');

const FILENAME = 'CLAUDE.md';

/**
 * Ceiling on an instruction file we will write.
 *
 * Generous next to a real one (the largest on this machine is ~7KB), so it only
 * ever catches a paste that was never meant to be an instruction file.
 */
const MAX_BYTES = 256 * 1024;

/**
 * Floor, because an EMPTY instruction file is an agent with no idea what it is
 * for. Refusing is better than saving one: an agent that boots with nothing is
 * a worse outcome than an edit that did not take.
 */
const MIN_CHARS = 20;

const STALENESS = {
  CURRENT: 'current',
  STALE: 'stale',
  UNKNOWN: 'unknown',
};

/**
 * The instruction file for one agent, or null if the name is unusable.
 *
 * ONE derivation, used by both the read and the write path. The commitment
 * store shipped three separate `path.join` calls for its record path, which let
 * a traversal test pass against a build whose real read and write used
 * something else entirely. Every caller here goes through this function, and
 * the containment assertion below is the only thing that decides.
 */
function fileFor(agent) {
  let key;
  try {
    key = store.safeKey(agent);
  } catch {
    return null;
  }
  const file = path.join(ROOT, key, FILENAME);

  // Belt to safeKey's braces, and NOT load-bearing today: safeKey already
  // strips separators, so this cannot currently fail and removing it leaves the
  // suite green. It stays because the consequence of safeKey ever changing is a
  // path-traversal WRITE to an arbitrary file, and that is worth a line.
  // Declared as untested rather than left to look like coverage.
  if (!file.startsWith(ROOT + path.sep)) return null;
  return file;
}

/**
 * When this agent's current session started.
 *
 * Taken from the transcript file's birth time, which was checked against the
 * first entry's own timestamp and matches it exactly. Resolved through the
 * status engine's `transcriptFor`, which keys on session id rather than
 * guessing a directory from the agent's name.
 *
 * Returns null when it cannot be determined, and callers must treat null as
 * "cannot tell" rather than "not stale".
 */
function sessionStartedAt(agent) {
  let file;
  try {
    file = transcriptFor(store.safeKey(agent));
  } catch {
    return null;
  }
  if (!file) return null;

  try {
    const { birthtime } = fs.statSync(file);
    // ⚠️ `birthtime` is reliable on macOS and can come back as the epoch on
    // some Linux filesystems. Treat a zero as unknown rather than as 1970,
    // which would make every agent look freshly started and every file look
    // stale.
    const at = birthtime && birthtime.getTime();
    return at && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/**
 * Is this agent running on instructions that have since been edited?
 *
 * Three states, and `unknown` is the default for anything not positively
 * established. The rule this codebase is built on applies here as much as
 * anywhere: **an agent we cannot assess must not render as fine.**
 */
function staleness(agent) {
  const file = fileFor(agent);
  if (!file) {
    return { state: STALENESS.UNKNOWN, because: 'that is not a name we can look up' };
  }

  let editedAt = null;
  try {
    editedAt = fs.statSync(file).mtime.getTime();
  } catch {
    return { state: STALENESS.UNKNOWN, because: 'it has no instruction file yet' };
  }

  const startedAt = sessionStartedAt(agent);
  if (!startedAt) {
    return {
      state: STALENESS.UNKNOWN,
      editedAt: new Date(editedAt).toISOString(),
      because: 'we cannot tell when this agent last started',
    };
  }

  return {
    ...compare(editedAt, startedAt),
    editedAt: new Date(editedAt).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
  };
}

/**
 * The whole decision, as a pure function of two timestamps.
 *
 * Separated so it can be tested exhaustively without a live fleet, a real
 * transcript, or touching an actual agent's instructions. The interesting cases
 * are the ones that are not a simple greater-than: a missing timestamp on
 * either side has to be `unknown`, never `current`, or an agent we cannot
 * assess renders as fine.
 */
function compare(editedAt, startedAt) {
  if (!editedAt || !startedAt) {
    return { state: STALENESS.UNKNOWN, because: 'we cannot tell when this agent last started' };
  }
  return editedAt > startedAt
    ? {
      state: STALENESS.STALE,
      because: 'the file has been edited since this agent started, and only a restart re-reads it',
    }
    : {
      state: STALENESS.CURRENT,
      because: 'this agent started after the file was last edited',
    };
}

/**
 * Read an agent's instructions.
 *
 * Never throws. This is called per agent from the status route, so a throw here
 * would answer 500 for the whole board.
 */
function read(agent) {
  const file = fileFor(agent);
  if (!file) {
    return { exists: false, path: null, text: '', staleness: staleness(agent) };
  }

  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { exists: false, path: file, text: '', staleness: staleness(agent) };
  }

  // Regular files only, and `lstat` so a symlink cannot point the read out of
  // the worker directory. Reading a FIFO here would block forever inside the
  // request handler, which is a wedge with no crash to notice.
  if (!stat.isFile() || stat.size > MAX_BYTES) {
    return {
      exists: false,
      path: file,
      text: '',
      staleness: { state: STALENESS.UNKNOWN, because: 'its instruction file is not one we can read' },
    };
  }

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {
      exists: false,
      path: file,
      text: '',
      staleness: { state: STALENESS.UNKNOWN, because: 'its instruction file could not be read' },
    };
  }

  return { exists: true, path: file, text, staleness: staleness(agent) };
}

/**
 * Replace an agent's instructions.
 *
 * Refuses rather than creates: an agent with no worker directory is not an
 * agent this app knows about, and writing one into existence invents it.
 */
function write(agent, text) {
  const file = fileFor(agent);
  if (!file) throw new Error('that is not a name we can look up');

  const body = String(text == null ? '' : text);
  if (body.trim().length < MIN_CHARS) {
    // An empty instruction file is an agent with no idea what it is for, and it
    // is a far worse outcome than an edit that did not take.
    throw new Error('instructions cannot be empty, say what this agent is for');
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
    throw new Error('that is larger than an instruction file should be');
  }

  const dir = path.dirname(file);
  try {
    if (!fs.statSync(dir).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('there is no agent by that name to write to');
  }

  // Write-then-rename. A half-written CLAUDE.md is an agent that boots with
  // truncated instructions, which is worse than one that boots with the old
  // ones. The temp name carries the pid so two writers cannot collide.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  } catch {
    // Any failure between the write and the rename otherwise leaves the temp
    // file beside the real one forever.
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to do */ }
    // Never surface the raw errno: it carries the absolute home path.
    throw new Error('those instructions could not be saved');
  }

  return read(agent);
}

module.exports = { ROOT, MAX_BYTES, MIN_CHARS, STALENESS, fileFor, sessionStartedAt, staleness, compare, read, write };
