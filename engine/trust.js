'use strict';

/**
 * Answer Claude Code's trust-this-folder question for a workspace Kosmos
 * itself just made.
 *
 * ⚠️ THE PROBLEM IS NOT THE PROMPT, IT IS WHAT THE PROMPT COSTS US. Every new
 * agent stopped on it before its person had touched anything, so the card said
 * `Needs you` at birth. If EVERY new agent needs you, the badge stops
 * separating an agent that genuinely needs an answer from one that was merely
 * born, and that is the same failure as a success message that says everyone
 * received it: a true signal made useless by firing when nothing is wrong.
 * (Splinter's framing, #164.)
 *
 * 🔑 AND THE FOLDER IS OURS. Kosmos creates `~/work/workers/<name>`, writes the
 * agent's instructions into it, and then asks the person to vouch for it. There
 * is nothing for them to review that we did not put there a second earlier.
 *
 * ⚠️ THIS IS ANOTHER TOOL'S CONFIG FILE, so every rule below is about touching
 * as little of it as possible. The write itself is not a guess: Claude Code
 * prints this remedy in its own words when it refuses an untrusted workspace —
 *
 *     this workspace has not been trusted. Run Claude Code interactively here
 *     once and accept the trust dialog, or set
 *     projects[<path>].hasTrustDialogAccepted: true in <config>
 *
 * — so the key, the location and the value are the ones the tool documents,
 * verified in the shipped 2.1.238 binary rather than remembered. It is still
 * treated as fragile: nothing here throws, and every refusal leaves the file
 * exactly as it was, which returns the person to today's behaviour.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();

/**
 * ⚠️ The SAME override `subscription.js` uses, deliberately — both read the one
 * file, and a test that pointed only one of them at a fixture would read the
 * operator's real account through the other.
 */
const CONFIG = () => process.env.AGENT_WORKFORCE_CLAUDE_CONFIG
  || path.join(HOME, '.claude.json');

const KEY = 'hasTrustDialogAccepted';

/**
 * @param {string} dir absolute path of a folder KOSMOS CREATED. The caller
 *   proves that; this function does not guess it, because the two cases are
 *   not distinguishable from the folder afterwards and only one of them is
 *   ours to answer for. A folder the person chose themselves is a case where
 *   the prompt is doing its job.
 * @returns {{ok: true, already: boolean} | {ok: false, because: string}}
 */
function trustFolder(dir) {
  const target = CONFIG();

  if (!dir || !path.isAbsolute(dir)) {
    return { ok: false, because: 'that is not an absolute folder path' };
  }

  // The key is the path Claude Code will use, and it uses the resolved one:
  // every one of the 22 entries on this machine is its own realpath. Writing
  // the unresolved spelling on a Mac where `~/work` is a symlink would leave a
  // trusted entry nothing ever reads.
  let key;
  try { key = fs.realpathSync(dir); }
  catch { return { ok: false, because: 'that folder is not there' }; }

  // ⚠️ A SYMLINKED CONFIG IS SOMEBODY'S ARRANGEMENT. Renaming over it replaces
  // the link with a file — the same severing the installer refuses for
  // settings.json, for the same reason.
  try { if (fs.lstatSync(target).isSymbolicLink()) return { ok: false, because: 'their config file is a symlink' }; }
  catch { /* absent is handled below, on its own terms */ }

  let data;
  let prevMode = null;
  try {
    const st = fs.statSync(target);
    prevMode = st.mode & 0o7777;
    // ⚠️ ABSENT AND EMPTY BOTH REFUSE, and that direction is chosen rather than
    // fallen into. No file means Claude Code has never run on this Mac, so
    // there is no shape here to merge into and we would be CREATING another
    // tool's config from nothing. The cost of refusing is one prompt the
    // person answers once. The cost of writing is a file we invented on a
    // machine we have never seen the tool run on. Those are not comparable.
    if (st.size === 0) return { ok: false, because: 'their config file is empty' };
    data = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, because: 'Claude Code has not run on this Mac yet' };
    if (err instanceof SyntaxError) return { ok: false, because: 'we could not read their config file' };
    return { ok: false, because: 'we could not read their config file' };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, because: 'their config file is not shaped the way we expect' };
  }

  const projects = data.projects;
  if (projects !== undefined
      && (projects === null || typeof projects !== 'object' || Array.isArray(projects))) {
    return { ok: false, because: 'their config file is not shaped the way we expect' };
  }

  const existing = (projects && projects[key]);
  if (existing !== undefined
      && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
    return { ok: false, because: 'their config file is not shaped the way we expect' };
  }

  // Already true is a SUCCESS, not a no-op we hide: the folder is trusted,
  // which is the whole outcome this function exists for. Saying so lets the
  // caller distinguish "we did it" from "it was already done" without either
  // one reading as a failure.
  if (existing && existing[KEY] === true) return { ok: true, already: true };

  if (!data.projects) data.projects = {};
  // ⚠️ MERGE INTO the entry rather than replace it. An entry can carry a
  // person's allowedTools and their MCP servers; a fresh object with one key
  // would delete those and look like Claude Code lost them.
  data.projects[key] = Object.assign({}, existing || {}, { [KEY]: true });

  // ⚠️ THE ONE HAZARD WE CANNOT DESIGN AWAY, stated rather than buried: this is
  // read-modify-write on a file a running Claude Code also writes. A session
  // that saves between our read and our rename loses that save. The window is
  // milliseconds and the rename is atomic, so the file is never half-written —
  // but "never corrupt" is not "never lost", and the honest version of this
  // comment says which one we bought.
  const tmp = target + '.kosmos.new';
  try {
    // Born at the preserved mode rather than chmodded into it: this file holds
    // account details and sits at 600. A window where it is world-readable is
    // not acceptable even if the chmod that follows would close it.
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', prevMode !== null ? { mode: prevMode } : {});
    if (prevMode !== null) fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return { ok: false, because: 'we could not write to their config file' };
  }

  return { ok: true, already: false };
}

module.exports = { trustFolder, KEY };
