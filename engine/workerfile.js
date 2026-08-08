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
 * Read a worker file, or say why not. Never throws, and never blocks.
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
function readWorkerFile(file) {
  if (!file) return { ok: false, because: 'that is not a name we can look up' };

  if (dirEscapes(file)) {
    return { ok: false, because: 'its worker folder is a link, so we do not read through it' };
  }

  if (!fs.existsSync(path.dirname(file))) {
    return { ok: false, because: 'this agent has no folder on this computer yet' };
  }

  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { ok: false, missing: true, because: 'it has no instruction file yet' };
  }

  if (!stat.isFile() || stat.size > MAX_BYTES) {
    return { ok: false, stat, because: 'its instruction file is not one we can read' };
  }

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return { ok: false, stat, because: 'its instruction file could not be read' };
  }

  return { ok: true, stat, buf };
}

module.exports = { MAX_BYTES, dirEscapes, readWorkerFile };
