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
  // ⚠️ measured rather than assumed — every entry on this machine whose folder
  // still exists equals its own realpath, and NONE differ. (Stated as the
  // property, not as a count: the first version of this comment said "all 22",
  // and the number was stale within a day while the claim it supported stayed
  // true.) Writing the unresolved spelling on a Mac where `~/work` is a symlink
  // would leave a trusted entry nothing ever reads, and nothing would report a
  // failure.
  let key;
  try { key = fs.realpathSync(dir); }
  catch { return { ok: false, because: 'that folder is not there' }; }

  // ⚠️ A SYMLINKED CONFIG IS SOMEBODY'S ARRANGEMENT. Renaming over it replaces
  // the link with a file — the same severing the installer refuses for
  // settings.json, for the same reason.
  try { if (fs.lstatSync(target).isSymbolicLink()) return { ok: false, because: 'their config file is a symlink' }; }
  catch { /* absent is handled below, on its own terms */ }

  let data;
  // ⚠️ Never stays null past the try below: every path out of it returns, so
  // reaching the write means `statSync` succeeded. An earlier version carried
  // `prevMode !== null` guards at the write, copied from the installer — where
  // they ARE live, because there an absent file is the clean case that proceeds.
  // This function refuses on absent, so those guards implied a mode-less path
  // that does not exist.
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

  // 🛑 AND A RECORDED `false` IS AN ANSWER, NOT AN ABSENCE. Claude Code writes
  // that value when somebody chose "No, exit" with this exact path in front of
  // them — it is live, not vestigial: 19 of 115 entries on this machine carry
  // it. The case is narrow (only a name whose folder was removed and remade can
  // reach here) but the direction is the whole argument of this file: we are
  // writing into somebody else's config, so a decision they made about this
  // path outranks our convenience. Remaking a folder at that path does not
  // un-say it. The cost of respecting it is the prompt, once.
  if (existing && existing[KEY] === false) return { ok: false, because: 'they have already answered no for that folder' };

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
  //
  // ⚠️ AND IT RUNS THE OTHER WAY TOO, which is the likelier direction and the
  // one that silently kills the feature: a Claude Code session already holding
  // its own in-memory copy will, on ITS next whole-file save, drop the entry we
  // just added. Nothing errors. The write succeeded, the agent asks the prompt
  // anyway, and the only symptom is the thing this change exists to remove.
  // Nothing here detects that; it is written down rather than guessed at later.
  const tmp = target + '.kosmos.new';
  try {
    // Born at the preserved mode rather than chmodded into it: this file holds
    // account details and sits at 600. A window where it is world-readable is
    // not acceptable even if the chmod that follows would close it.
    // ⚠️ `wx`, and this repo has already paid for learning why. The temp name
    // is predictable, and the DEFAULT flag FOLLOWS A SYMLINK: a link sitting at
    // `~/.claude.json.kosmos.new` would receive the whole config — account
    // details included — at a path somebody else chose, and the rename would
    // then make the config itself that link. `wx` fails instead of following.
    // Same fix, same reasoning, as `engine/instructions.js`'s boot-file write.
    // ⚠️ A stale temp file from a crash therefore refuses ONCE and is cleared by
    // the catch below, so the next creation succeeds. That is the right way
    // round: one prompt, versus a write through a link.
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: prevMode });
    // ⚠️ AND THE CHMOD AFTER STILL RUNS, for umask exactness — `mode` on the
    // create is masked by the umask, so a file that must come back at 600 on a
    // machine with a loose umask needs this line. It is not belt and braces.
    fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return { ok: false, because: 'we could not write to their config file' };
  }

  return { ok: true, already: false };
}

/**
 * Take back a trust entry we wrote, for a folder that is being rolled back.
 *
 * ⚠️ IT EXISTS BECAUSE OF A SENTENCE. When `bootstrap` fails, creation tells
 * the person "we have taken it back off your computer rather than leave
 * something half installed" — and without this, a `projects[…]` entry for a
 * folder that no longer exists stays in another tool's config forever, which
 * makes that sentence false in exactly the case that produces it.
 *
 * ⚠️ ONLY EVER CALLED FOR AN ENTRY WE JUST CREATED (the caller keeps the
 * `already: false` result and passes nothing else), so this cannot delete a
 * trust decision somebody made themselves.
 *
 * Same shape, same refusals, same fail-soft contract as `trustFolder`.
 */
function forgetFolder(dir) {
  const target = CONFIG();
  if (!dir || !path.isAbsolute(dir)) return { ok: false, because: 'that is not an absolute folder path' };

  // ⚠️ NOT realpath: by the time this runs the folder is gone, so resolving it
  // would throw and the entry would be stranded. The caller hands back the same
  // key `trustFolder` returned, which is the resolved one.
  const key = dir;

  try { if (fs.lstatSync(target).isSymbolicLink()) return { ok: false, because: 'their config file is a symlink' }; }
  catch { /* handled below */ }

  let data;
  let prevMode = null;
  try {
    const st = fs.statSync(target);
    prevMode = st.mode & 0o7777;
    if (st.size === 0) return { ok: false, because: 'their config file is empty' };
    data = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch { return { ok: false, because: 'we could not read their config file' }; }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, because: 'their config file is not shaped the way we expect' };
  if (!data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)) return { ok: true, already: true };
  if (!(key in data.projects)) return { ok: true, already: true };

  delete data.projects[key];

  const tmp = target + '.kosmos.new';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: prevMode });
    fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return { ok: false, because: 'we could not write to their config file' };
  }
  return { ok: true, already: false };
}

module.exports = { trustFolder, forgetFolder, KEY };
