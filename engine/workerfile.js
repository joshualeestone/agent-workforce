'use strict';

/**
 * Reading a file out of the workers directory, safely, in ONE place.
 *
 * ⚠️ This module exists because the same defect shipped six times on one
 * branch, and every instance had the same shape: one reader of
 * `~/work/workers/` was guarded and a second reader of the same files was not.
 *
 *   1. `write` refused a file the read path had hidden; `read` did not refuse
 *      to show it.
 *   2. `write` refused a symlinked worker directory; `read` followed it.
 *   3. `read` applied four refusals; `staleness` applied one, so an unreadable
 *      file rendered as a confident `current` on the card.
 *   4. `instructions.js` refused a linked worker folder; `status.readIdentity`
 *      followed it and served a name parsed from outside the root.
 *   5. The engine answered "can this be edited" structurally; the browser
 *      re-derived it by regex over English prose.
 *   6. `readIdentity` was then given the DIRECTORY check and still had no FILE
 *      check, so it followed a symlinked CLAUDE.md out of the root and blocked
 *      forever on a FIFO, wedging every route through `snapshot()`.
 *
 * The pattern is not carelessness, it is that "can we safely read this worker
 * file" was answered independently in each caller. So it is answered here, once,
 * and both callers import it. A seventh instance now requires editing this
 * file rather than forgetting to.
 *
 * No dependency on the rest of the engine, deliberately: `instructions.js`
 * already requires `status.js`, so anything shared between them has to sit
 * below both or the require becomes a cycle.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Ceiling on a worker file we will read into memory.
 *
 * Generous next to a real instruction file (the largest on this machine is
 * ~7KB), so it only ever catches something that was never one.
 */
const MAX_BYTES = 256 * 1024;

/**
 * Is the containing directory a real directory rather than a link?
 *
 * The containment checks callers apply to the NAME only ever see the final
 * component, so a symlinked `<root>/<agent>` walks straight out of the root
 * without any of them noticing.
 *
 * A directory that does not exist is not an escape. It is an agent with no
 * files yet, which callers handle separately.
 */
function dirEscapes(file) {
  let stat;
  try {
    stat = fs.lstatSync(path.dirname(file));
  } catch {
    return false;
  }
  return !stat.isDirectory();
}

/**
 * Read a worker file, or say why not.
 *
 * Never blocks, and never throws ABOUT A FILE: any file it is asked about gets
 * an answer rather than an exception, because the callers run inside a request
 * handler and a throw there answers 500 for the whole board. A missing `root`
 * is the one exception and is not about a file at all: it is a programming
 * error at the call site, and failing loudly is the point.
 *
 * `root` is REQUIRED. It was optional, justified as "usable for a bare path in
 * a test", and that was the wrong call in the one module whose entire purpose
 * is that a guard cannot be forgotten: an optional containment check is a
 * containment check some future caller omits. No test wanted it either.
 *
 * "Never blocks" is a real claim, and holding it took more than a type check:
 * see the open-then-fstat note below for why lstat-then-read is not enough.
 *
 * Returns `{ ok: true, stat, buf }`, or `{ ok: false, because, missing? }`.
 * `because` is always safe to show a person: no absolute path, no errno.
 *
 * The three refusals, and why each one is not optional:
 *
 *   - **A linked directory** walks out of the root entirely.
 *   - **A non-regular file** is the FIFO case. `readFileSync` on a fifo blocks
 *     forever inside a synchronous request handler, so the route never answers
 *     and nothing crashes to tell you why. Measured: `readIdentity` on a fifo
 *     never returned, and because `knownAgent` also calls `snapshot()`, every
 *     other route hung with it.
 *   - **An oversized file** is pulled entirely into memory before any caller
 *     gets a chance to slice it.
 *
 * `lstat`, not `stat`, throughout: `stat` follows a link and reports on its
 * target, which is the thing being guarded against.
 */
function readWorkerFile(file, root) {
  // Not reachable from either caller today (`inspect` returns before calling
  // when `fileFor` is null, and `readIdentity` always passes a joined path), and
  // kept as a total function rather than a partial one: this is the module every
  // reader of the workers directory now goes through, so it should answer any
  // input rather than assume its callers stay careful.
  if (!file) return { ok: false, because: 'that is not a name we can look up' };

  // ⚠️ Containment, asserted HERE rather than left to each caller.
  //
  // Extracting the file checks into this module did NOT close containment for
  // its second caller, and the module docstring read as though it had.
  // `instructions.fileFor` sanitises the name and asserts `startsWith(ROOT)`;
  // `status.readIdentity` joins the tmux session name verbatim and did neither,
  // so `readIdentity('../victim')` returned a name and role parsed out of a file
  // outside the root while the instructions route for the same name refused.
  // Measured. Latent rather than live, because tmux will not accept a session
  // name containing a dot, but a guard that depends on tmux's naming rules is
  // not a guard.
  if (!root) throw new Error('readWorkerFile needs the root it must stay inside');
  if (!path.resolve(file).startsWith(path.resolve(root) + path.sep)) {
    return { ok: false, because: 'that file is not inside the workers folder' };
  }

  // ⚠️ And again on the CANONICAL path, because the check above is a string
  // prefix and a string prefix believes symlinks.
  //
  // `dirEscapes` only ever lstats the IMMEDIATE parent, so an intermediate
  // component could still be a link: with `<root>/sub` linked elsewhere,
  // `<root>/sub/victim/CLAUDE.md` passed the prefix test AND the parent test,
  // and `readIdentity('sub/victim')` served a name and role parsed out of a
  // file outside the root. Measured. This is the same escape as the immediate
  // parent, one level up, in the module written so it could not happen again.
  //
  // `realpath` resolves every component, so one call replaces walking the path.
  // The ROOT is canonicalised too: on macOS `/tmp` is itself a link to
  // `/private/tmp`, so comparing a resolved child against an unresolved root
  // would refuse perfectly good files.
  //
  // A directory that does not exist yet is not an escape; the existence check
  // below is what answers that case.
  try {
    const realRoot = fs.realpathSync(root);
    const realDir = fs.realpathSync(path.dirname(file));
    if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
      return { ok: false, because: 'that file is not inside the workers folder' };
    }
  } catch { /* something on the path does not exist; handled below */ }

  if (dirEscapes(file)) {
    // Says which it actually is. A plain file where the worker folder should be
    // is not a link, and naming the wrong cause on a surface whose whole point
    // is that the stated reason is the real one is its own small lie.
    let what = 'is not a folder';
    try {
      what = fs.lstatSync(path.dirname(file)).isSymbolicLink()
        ? 'is a link, so we do not read through it'
        : 'is not a folder';
    } catch { /* keep the general wording */ }
    return { ok: false, because: `its worker folder ${what}` };
  }

  if (!fs.existsSync(path.dirname(file))) {
    return { ok: false, because: 'it has no folder of its own on this computer yet' };
  }

  // ⚠️ Open FIRST, then ask the descriptor what it is, then read from that same
  // descriptor. Never lstat-a-path-then-read-that-path.
  //
  // The obvious shape is `lstatSync(file)` followed by `readFileSync(file)`,
  // and it is check-then-use across two separate resolutions of one name. Swap
  // the file for a fifo between them and the read blocks forever anyway, which
  // is the precise failure the check exists to prevent. Measured: a probe that
  // swapped the path inside that window never returned and had to be killed.
  //
  // `O_NONBLOCK` is what makes opening a fifo return instead of waiting for a
  // writer, and `fstat` on the resulting descriptor describes the object we
  // actually hold rather than whatever the name points at by the time we look
  // again. `O_SYMLINK`-free open would follow a link, so the link is refused by
  // the `lstat` below BEFORE we open anything.
  //
  // ⚠️ The type check is pinned by a named test. The RACE WINDOW is not, and
  // that is declared rather than implied: provoking it needs the path swapped
  // between two synchronous calls, and a test that could do that reliably would
  // be testing its own scheduling rather than this code. Same treatment as the
  // file-mode window and the `fileFor` containment assertion.
  //
  // An earlier version of this note said reverting to lstat-then-read "leaves
  // every deterministic test green". That is false and was measured so: the
  // revert reddens `an mtime we cannot use is unknown`, because that test
  // injects into `fs.fstatSync` and the revert stops calling it. The failure is
  // incidental rather than a test of the window, but the sentence was wrong,
  // and a comment overstating what is UNTESTED is the same defect as one
  // overstating what is tested.
  let linkStat;
  try {
    linkStat = fs.lstatSync(file);
  } catch (err) {
    // ⚠️ ENOENT only. Every other failure means the file may well be there and
    // we simply could not look, which is a different answer.
    //
    // This mattered: `missing` becomes `editable` upstream, so an unsearchable
    // worker directory (mode 000) holding real instructions was reported as
    // "there is no instruction file for this one yet" with an enabled, empty
    // editor offered over the top of it. A positive false claim about the most
    // sensitive file in the product, from the one branch that is not ENOENT.
    if (err && err.code === 'ENOENT') {
      return { ok: false, missing: true, because: 'it has no instruction file yet' };
    }
    return { ok: false, because: 'we cannot get at its instruction file to read it' };
  }
  if (!linkStat.isFile()) {
    return { ok: false, stat: linkStat, because: 'its instruction file is not one we can read' };
  }

  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch {
    return { ok: false, stat: linkStat, because: 'its instruction file could not be read' };
  }

  try {
    const stat = fs.fstatSync(fd);
    // Re-asked of the DESCRIPTOR, so a swap between the lstat above and this
    // point cannot get us reading something else.
    if (!stat.isFile() || stat.size > MAX_BYTES) {
      return { ok: false, stat, because: 'its instruction file is not one we can read' };
    }
    return { ok: true, stat, buf: fs.readFileSync(fd) };
  } catch {
    return { ok: false, stat: linkStat, because: 'its instruction file could not be read' };
  } finally {
    try { fs.closeSync(fd); } catch { /* already gone */ }
  }
}

module.exports = { MAX_BYTES, dirEscapes, readWorkerFile };
