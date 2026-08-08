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
const crypto = require('node:crypto');
const store = require('./store');
const { transcriptFor } = require('./status');

/**
 * Where worker instruction files live.
 *
 * Containment is asserted on the name (`fileFor`), on the worker directory
 * (`dirEscapes`) and on the file itself (`lstat` in `read`), because each one
 * alone leaves a route out: the assertion in `fileFor` only ever sees the final
 * component, so a linked DIRECTORY escaped it for a while.
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
 * Does the worker DIRECTORY lead out of the root?
 *
 * ⚠️ `fileFor`'s containment assertion, and the `lstat` in `read`, both only
 * ever look at the FINAL component. A symlinked worker directory therefore led
 * a read straight out of ROOT: with `<ROOT>/angel` linked elsewhere, `read`
 * returned `exists: true` and the contents of a file outside the root, under a
 * `path` the content had not come from, and `staleness` disclosed that file's
 * mtime. `write` already refused, so the two surfaces disagreed: the editor
 * served a foreign file as editable and Save answered "there is no agent by
 * that name to write to".
 *
 * Shared by all three paths so they cannot drift apart again. A directory that
 * does not exist is not an escape, it is simply an agent with no files yet, and
 * the callers already handle that.
 */
function dirEscapes(file) {
  let stat;
  try {
    stat = fs.lstatSync(path.dirname(file));
  } catch {
    return false; // no directory at all; not an escape
  }
  return !stat.isDirectory();
}

/**
 * The name as the session REGISTRY knows it.
 *
 * Deliberately not `safeKey`, and the difference matters. `safeKey` exists to
 * make a name safe to use as a path segment under a directory we own, and it
 * does that by TRANSFORMING: lowercasing, then dropping every character outside
 * `[a-z0-9_-]`. The registry is not a path we own. It is an identity lookup
 * keyed on the tmux session name verbatim (`status.js` builds
 * `<name>-discord_0.0.json` straight from it), so transforming the name asks
 * for a file that does not exist, `sessionStartedAt` returns null, and
 * staleness reads `unknown` forever for any agent whose session name carries a
 * capital, a dot or a space. Fail-safe, and silently wrong.
 *
 * So this VALIDATES instead of transforming: anything that could walk out of
 * the registry directory is refused outright, and everything else passes
 * through byte for byte. Two derivations of "the name" is the shape that hides
 * bugs, so the reason they differ is written down rather than left to be
 * rediscovered.
 */
function registryKey(agent) {
  const name = String(agent == null ? '' : agent);
  if (!name || name === '.' || name === '..') return null;
  if (/[/\\\0]/.test(name) || name.includes('..')) return null;
  return name;
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
  const name = registryKey(agent);
  if (!name) return null;

  let file;
  try {
    file = transcriptFor(name);
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
 * A timestamp as an ISO string, or null if it is not one we can render.
 *
 * `new Date(NaN).toISOString()` throws a RangeError, and `staleness` runs once
 * per agent inside the status handler, so one throw answers 500 for the whole
 * board.
 *
 * Belt to the caller's braces, and NOT load-bearing today: `staleness` refuses
 * an unusable `editedAt` before it gets here, and `sessionStartedAt` only ever
 * returns null or a positive number, so no NaN can currently reach this and
 * replacing the body with a bare `toISOString()` leaves the suite green.
 * Declared as untested rather than left to look like coverage, the same as the
 * containment assertion in `fileFor`.
 */
function iso(ms) {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Everything the FILE itself can tell us, decided exactly once.
 *
 * ⚠️ This exists because the same question was being answered in three places
 * and they drifted. `read` refused a file for four separate reasons (a linked
 * worker folder, not a regular file or over the ceiling, unopenable, not valid
 * UTF-8); `staleness` checked only the second of those. So an agent whose
 * instruction file the app had decided it could not read at all still got a
 * confident verdict on its card, and with a back-dated file that verdict was
 * `current`: a positive claim of health, plus a disclosed timestamp, about a
 * file we cannot read. Measured, not theorised.
 *
 * The rule this codebase is built on is that something we cannot assess must
 * not render as fine, and a second derivation of "can we read this" is how that
 * rule got broken while every individual guard looked right.
 *
 * `ok: false` always carries a `because` that is safe to show a person.
 */
function inspect(agent) {
  const file = fileFor(agent);
  if (!file) return { file: null, ok: false, because: 'that is not a name we can look up' };

  // The worker directory, before the file inside it. `fileFor` only asserts on
  // the final component, so a linked directory escaped it entirely.
  if (dirEscapes(file)) {
    return { file, ok: false, because: 'its worker folder is a link, so we do not read through it' };
  }

  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    // No folder at all is not the same as no file: there is nowhere to save to,
    // and the screen needs to know the difference before offering an editor.
    return { file, ok: false, noDir: true, because: 'this agent has no folder on this computer yet' };
  }

  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { file, ok: false, missing: true, because: 'it has no instruction file yet' };
  }

  // Regular files only, and `lstat` so a symlink cannot point the read out of
  // the worker directory. Reading a FIFO here would block forever inside the
  // request handler, which is a wedge with no crash to notice.
  if (!isShowable(stat)) {
    return { file, stat, ok: false, because: 'its instruction file is not one we can read' };
  }

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return { file, stat, ok: false, because: 'its instruction file could not be read' };
  }

  // ⚠️ Refuse anything that would not survive being handed back. The editor
  // round-trips through a UTF-8 string, so a file containing invalid bytes came
  // back with every one replaced by U+FFFD: opening it and pressing Save
  // rewrote it lossily and reported "Saved." Measured at 50 bytes in, 52 out.
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) {
    return {
      file,
      stat,
      ok: false,
      because: 'its instruction file is not UTF-8 text, so editing it here would corrupt it',
    };
  }

  return { file, stat, buf, text, ok: true };
}

/**
 * Is this agent running on instructions that have since been edited?
 *
 * Three states, and `unknown` is the default for anything not positively
 * established. The rule this codebase is built on applies here as much as
 * anywhere: **an agent we cannot assess must not render as fine.**
 *
 * ⚠️ Never throws, and that is load-bearing rather than incidental: the status
 * route calls this once per agent, so a single throw answers 500 for the entire
 * board. There is a test named for it.
 *
 * `seen` lets a caller that has already inspected the file pass it in, so `read`
 * does not do the work twice.
 */
function staleness(agent, seen) {
  const file = seen || inspect(agent);
  if (!file.ok) return { state: STALENESS.UNKNOWN, because: file.because };

  const editedAt = file.stat.mtime.getTime();

  // An mtime can arrive as NaN, and on some filesystems as the epoch. Both stop
  // here so the answer says which kind of not-knowing it is, and so we do not
  // report `editedAt: 1970-01-01` as though it were a real edit time.
  //
  // ⚠️ What this does NOT do, corrected after a reviewer checked it: neither
  // value would otherwise resolve to `current`. `compare` tests `!editedAt`
  // first and both NaN and 0 are falsy, so both already land on `unknown` by a
  // different route. An earlier version of this comment claimed the guard
  // prevented an agent being shown as running on instructions we could not
  // date. It does not, and a guard documented as preventing a failure it cannot
  // prevent is the same defect as a test that pins nothing.
  if (!Number.isFinite(editedAt) || editedAt <= 0) {
    return {
      state: STALENESS.UNKNOWN,
      because: 'we cannot tell when its instruction file was last edited',
    };
  }

  const startedAt = sessionStartedAt(agent);
  if (!startedAt) {
    return {
      state: STALENESS.UNKNOWN,
      editedAt: iso(editedAt),
      because: 'we cannot tell when this agent last started',
    };
  }

  return {
    ...compare(editedAt, startedAt),
    editedAt: iso(editedAt),
    startedAt: iso(startedAt),
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
 * Which version of the file the editor was shown.
 *
 * ⚠️ A hash of the BYTES, deliberately not the mtime. The first version of the
 * changed-since-read guard compared mtimes, and that was wrong twice over:
 *
 *   1. **It had nothing to compare on the create path.** A file that did not
 *      exist when the panel opened has no mtime, so a save carried no version,
 *      the guard skipped itself, and a CLAUDE.md the agent wrote in the
 *      meantime was destroyed without warning. That is the exact failure the
 *      guard was added to prevent, still live for the one case where the panel
 *      says "there is no instruction file for this one yet".
 *   2. **An mtime is not a version.** Anything that restores timestamps
 *      (`rsync --times`, `git checkout`, a Time Machine restore) changes the
 *      bytes while leaving the mtime alone, and a volume with one-second
 *      granularity loses the distinction on its own.
 *
 * A hash has neither problem, and `absent` is a real version rather than the
 * absence of one, so "there was no file and now there is" compares unequal like
 * any other change. `sha256` from the standard library: no dependency.
 *
 * ⚠️ Hashes the raw BYTES, not the decoded string. Decoding first maps every
 * invalid byte to U+FFFD, so two genuinely different files hashed the SAME:
 * `You are Ren\xE9` and `You are Ren\xFF` produced one hash, and a save against
 * the first overwrote the second. Measured before the fix.
 *
 * NOT load-bearing today, and declared rather than implied: `read` now refuses
 * to show any file that does not round-trip through UTF-8, so everything that
 * reaches here is byte-identical to its own decoding and hashing the string
 * instead leaves the suite green. It stays because the two guards protect
 * against different mistakes, and the one that is currently redundant is the
 * one that would matter if the other were ever relaxed.
 */
const ABSENT = 'absent';

function versionOf(exists, buf) {
  if (!exists) return ABSENT;
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

/**
 * Is this something the read path is willing to show as the instruction file?
 *
 * A regular file, within the ceiling. Shared by `read` and `write` so the two
 * cannot disagree about what counts, which is what let a save destroy a file
 * the editor had just refused to display.
 */
function isShowable(stat) {
  return stat.isFile() && stat.size <= MAX_BYTES;
}

/**
 * Read an agent's instructions.
 *
 * Never throws. `staleness` is what the status route calls once per agent, and
 * this is reached from the single-agent GET and from `write`. Both have to hold
 * the guarantee, because a throw from either answers 500 rather than showing
 * one agent as unreadable.
 *
 * Every refusal comes from `inspect`, so this and `staleness` cannot disagree
 * about whether a file can be read. They did, and the card claimed an agent was
 * `current` while the panel said it could not read the file at all.
 */
function read(agent) {
  const seen = inspect(agent);

  if (!seen.ok) {
    return {
      exists: false,
      // ⚠️ `editable` is a STRUCTURED answer to "can this be saved", because the
      // screen was deciding it by regex-matching this module's English prose.
      // Rewording a sentence would silently have removed the ability to write a
      // first instruction file, which is the same two-derivations-of-one-fact
      // problem as the blocker above, moved into the browser.
      //
      // NOT pinned by a test, and declared rather than implied: the whole value
      // of the structured field is robustness to FUTURE rewording, and swapping
      // it back to a regex over `because` produces identical answers for every
      // case that exists today, so no mutation can tell them apart. What a test
      // can catch is a reword breaking it, and that test would have to do the
      // rewording. Listed green in the plan's table for the same reason.
      editable: seen.missing === true,
      path: seen.file,
      text: '',
      version: ABSENT,
      because: seen.because,
      staleness: staleness(agent, seen),
    };
  }

  return {
    exists: true,
    editable: true,
    path: seen.file,
    text: seen.text,
    version: versionOf(true, seen.buf),
    // `editedAt` is reported for display only. The changed-since-read guard
    // keys on `version` above, NOT on this: an mtime is not a version.
    editedAt: iso(seen.stat.mtime.getTime()),
    staleness: staleness(agent, seen),
  };
}

/**
 * Replace an agent's instructions.
 *
 * Refuses rather than creates: an agent with no worker directory is not an
 * agent this app knows about, and writing one into existence invents it.
 *
 * `expectedVersion` is the `version` the caller was last shown. When given, a
 * file whose contents differ from that version is refused rather than
 * overwritten. `absent` is a version like any other, so "there was no file when
 * I opened this and there is one now" is a conflict, not a free pass.
 */
function write(agent, text, expectedVersion) {
  const file = fileFor(agent);
  if (!file) throw new Error('that is not a name we can look up');

  const body = String(text == null ? '' : text);
  if (body.trim().length < MIN_CHARS) {
    // An empty instruction file is an agent with no idea what it is for, and it
    // is a far worse outcome than an edit that did not take.
    throw new Error(`instructions cannot be this short, say what this agent is for in at least ${MIN_CHARS} characters`);
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
    throw new Error('that is larger than an instruction file should be');
  }

  // The same directory check the read path uses, through the same helper, so
  // the two cannot drift apart. They already had: the write refused a linked
  // worker directory while the read followed it.
  if (dirEscapes(file)) throw new Error('there is no agent by that name to write to');
  try {
    if (!fs.statSync(path.dirname(file)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('there is no agent by that name to write to');
  }

  // ⚠️ Refuse to replace anything the READ path would not have shown.
  //
  // Without this the two paths disagree about what the instruction file is, and
  // the disagreement destroys data silently: a file `read` rejects comes back
  // as `{ exists: false, text: '' }`, the editor renders an empty box captioned
  // "there is no instruction file for this one yet", and the first Save
  // overwrites the real file with whatever was typed into that box. The screen
  // has to be describing the same file that Save replaces, or it is inviting
  // someone to destroy a file they were told was not there.
  //
  // ⚠️ And it asks `read` ITSELF rather than re-deriving the condition. A
  // parallel predicate here was the bug: it checked `isShowable` alone, which
  // covers a symlink and an oversized file but NOT a file that exists and
  // simply cannot be opened (mode 000, a bad mount, a permissions change).
  // `read` returned "no instruction file yet" for that, the guard saw a
  // perfectly ordinary regular file, and the save destroyed it. Two derivations
  // of one question drift; one cannot.
  let before = null;
  try { before = fs.lstatSync(file); } catch { before = null; }
  const shown = before ? read(agent) : null;
  if (before && !shown.exists) {
    throw new Error('there is already a file there that this editor cannot safely replace, open it by hand');
  }

  // ⚠️ Refuse to overwrite an edit that happened while this editor was open.
  //
  // The file is read once, when the panel opens, and nothing re-reads it after
  // that. So an agent rewriting its own instructions, or the operator editing
  // the file by hand, is invisible to a panel that has been sitting open, and
  // an unconditional save destroys that work with no warning. Refusing is the
  // only honest answer: we cannot merge two versions, and picking the one that
  // happens to be in the textarea is picking silently.
  //
  // Compared against a HASH of the current bytes rather than a timestamp, and
  // `absent` counts, so the create path is covered too. Skipped only when the
  // caller supplies no version at all, which is a script or a deliberate
  // unconditional write, never the editor.
  if (expectedVersion) {
    const now = shown ? shown.version : ABSENT;
    if (now !== expectedVersion) {
      throw new Error('these instructions changed since you opened them, reload before saving so you do not overwrite that edit');
    }
  }

  // Write-then-rename. A half-written CLAUDE.md is an agent that boots with
  // truncated instructions, which is worse than one that boots with the old
  // ones. The temp name carries the pid so a second PROCESS writing the same
  // agent cannot land on the same temp path. Two concurrent writes inside THIS
  // process share the name, and are serialised only because these calls are
  // synchronous, which is worth knowing before either one grows an await.
  //
  // ⚠️ The version check above is NOT a lock, and across processes it is not
  // even atomic: two servers, or a server and a script, can both read the same
  // version, both pass, and both rename, and the later one silently discards
  // the earlier edit. In-process that cannot happen because `write` is
  // synchronous end to end. Between processes it can, and closing it needs a
  // lock file rather than a comment. Stated so the guarantee is not read as
  // stronger than it is.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    // ⚠️ `wx`, not the default `w`. The temp name is predictable, and the
    // default flag FOLLOWS a symlink, so planting a link at
    // `<agent>/CLAUDE.md.<pid>.tmp` pointing anywhere on disk turns this write
    // into a write to that target. It is the third symlink route into the most
    // powerful write in the product, after the file itself and the worker
    // directory, and unlike those two it bypasses every guard above because it
    // is not the path any of them check. `wx` fails rather than follows.
    // ⚠️ Carry the original file's permissions across, and set them AT CREATE
    // rather than afterwards.
    //
    // A fresh temp file is created at 0666 minus the umask, and the rename
    // carries that mode onto the target, so a CLAUDE.md the operator had
    // deliberately locked to 0600 came out world-readable after one save.
    // Chmod-ing after the write fixed the final mode but left the complete new
    // contents of that file world-readable on disk for the window between the
    // write and the rename, which for the most sensitive file this product
    // writes is most of the point. `mode` at create can only be narrowed by the
    // umask, never widened, so there is no window. Masked to 0o777: the
    // permission bits only, deliberately not setuid/setgid/sticky, which have
    // no business on an instruction file and which an earlier 0o7777 carried
    // across without saying so.
    //
    // ⚠️ The WINDOW is not pinned by a test, only the final mode is. Catching a
    // mode that exists between two synchronous calls needs a probe inside the
    // write, and a test that reached in that far would be pinning the
    // implementation rather than the property. Said out loud rather than left
    // to look covered: moving this back to a post-hoc chmod leaves the suite
    // green.
    const mode = before ? (before.mode & 0o777) : 0o644;
    fs.writeFileSync(tmp, body, { flag: 'wx', mode });
    // And restore exactly, because the umask may have narrowed it. A failure
    // here is a real failure, not a best effort: silently handing back
    // permissions other than the ones the file had is the bug above.
    if (before) fs.chmodSync(tmp, mode);
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

module.exports = {
  ROOT, FILENAME, MAX_BYTES, MIN_CHARS, STALENESS, ABSENT,
  fileFor, registryKey, sessionStartedAt, staleness, compare, versionOf, read, write,
};
