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
 * A temp path that is OURS, not a predictable one.
 *
 * ⚠️ THE FIXED NAME `<config>.kosmos.new` HAD TWO PROBLEMS AND ONLY ONE FIX.
 * `wx` closes the symlink route — a link sitting at that predictable path would
 * otherwise receive the whole config, account details included, and the rename
 * would make the config itself that link. But `wx` also means anything already
 * sitting there REFUSES the write, and we cannot tell another writer's in-flight
 * file from litter a crash left behind. Clearing it breaks the other writer;
 * leaving it wedges this feature permanently.
 *
 * 🔑 A unique name removes the choice. Nothing else is sitting at it, so `wx`
 * only fails for a planted file, and a planted file is one we must NOT delete.
 *
 * ⚠️ AND THE CLOCK IS IN THE NAME, not just the pid. With `pid-seq` alone, a
 * process that died between create and rename left `…-1.new` behind, and the
 * next process to draw that pid refused at seq 1 FOREVER — a permanent wedge
 * from one crash, which is worse than the case the unique name was introduced
 * to avoid. With the start time in it, a leftover is inert: nothing ever asks
 * for that name again.
 *
 * ⚠️ SO A CRASH CAN LEAVE ONE STRAY FILE AND NOTHING EVER REMOVES IT. Said
 * plainly rather than implied: the alternative is deleting files at a path we
 * cannot prove is ours, which is the harm every guard in here is pointed at.
 */
let SEQ = 0;
const STARTED = Date.now();
const tempPath = (target) => `${target}.kosmos-${process.pid}-${STARTED}-${++SEQ}.new`;

/**
 * @param {string} dir absolute path of a folder KOSMOS CREATED. The caller
 *   proves that; this function does not guess it, because the two cases are
 *   not distinguishable from the folder afterwards and only one of them is
 *   ours to answer for. A folder the person chose themselves is a case where
 *   the prompt is doing its job.
 * @returns {{ok: true, already: boolean, key: string} | {ok: false, because: string}}
 *   `key` is the resolved path that was written. The rollback gates on it, so
 *   it is part of the contract rather than a convenience.
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
  if (existing && existing[KEY] === true) return { ok: true, already: true, key };

  // 🛑 A RECORDED `false` IS NOT A REFUSAL, AND AN EARLIER VERSION OF THIS FILE
  // REFUSED ON ONE BECAUSE I ASSUMED IT WAS. The premise was that Claude Code
  // writes `false` when somebody chooses "No, exit". Measured rather than
  // assumed: 19 of the 22 entries on this machine are `false`, and SIXTEEN of
  // those also carry completed-session metrics (`lastSessionId`, `lastCost`,
  // `lastDuration`). A session that was declined never runs long enough to write
  // those. `false` is what Claude Code records for a folder it has opened and
  // not been told to trust — a default, not an answer.
  //
  // ⚠️ AND THE GUARD WOULD HAVE REFUSED FOR THIS FEATURE'S OWN POPULATION. All
  // fifteen worker folders on this machine are `false` with a recorded session.
  // Remove an agent and make it again — which create.js's own refusal calls the
  // thing people almost always want — and every one of them would have hit
  // "they have already answered no for that folder": a sentence false about the
  // person, while the feature silently did nothing.
  //
  // 🔑 THE ARGUMENT FOR WRITING ANYWAY IS NOT THAT THE VALUE IS MEANINGLESS, IT
  // IS WHOSE FOLDER THIS IS. The caller reaches here only for a folder KOSMOS
  // CREATED, moments ago. Whatever an older entry at that path recorded, it was
  // about a folder that no longer exists; this one holds what we put in it.

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
  const tmp = tempPath(target);
  try {
    // Born at the preserved mode rather than chmodded into it: this file holds
    // account details and sits at 600. A window where it is world-readable is
    // not acceptable even if the chmod that follows would close it.
    // ⚠️ `wx`, and this repo has already paid for learning why: the DEFAULT
    // flag FOLLOWS A SYMLINK, so a link at the temp path would receive the
    // whole config — account details included — at a path somebody else chose,
    // and the rename would then make the config itself that link. `wx` fails
    // instead of following. Same fix, same reasoning, as
    // `engine/instructions.js`'s boot-file write.
    // ⚠️ THE NAME BEING UNIQUE IS NOT A SUBSTITUTE FOR IT. `pid-starttime-seq`
    // is not secret — a local attacker can read both — so the flag is what
    // closes the route; the unique name only stops us colliding with ourselves.
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: prevMode });
    // ⚠️ MODE IS THE ONLY THING CARRIED OVER, said plainly rather than left to
    // read as "permissions are preserved": `rename` replaces the inode, so
    // macOS ACLs, extended attributes, `chflags` and any hard link to the file
    // do not survive. Nothing here restores them and no test covers them.
    // ⚠️ AND THE CHMOD AFTER STILL RUNS, for umask exactness — `mode` on the
    // create is masked by the umask, so a file that must come back at 600 on a
    // machine with a loose umask needs this line. It is not belt and braces.
    fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch (err) {
    // ⚠️ NEVER UNLINK A TEMP FILE WE DID NOT CREATE. Nothing else uses this
    // naming scheme, so an EEXIST here means a file somebody PLANTED at a path
    // we were about to write — the exact case `wx` exists to refuse. Removing
    // it would be this code deleting a file it cannot prove anything about, on
    // behalf of a write it is already refusing to do.
    if (!err || err.code !== 'EEXIST') {
      try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    }
    return { ok: false, because: 'we could not write to their config file' };
  }

  return { ok: true, already: false, key };
}

/**
 * Take back the trust we wrote, for a folder that is being rolled back.
 *
 * ⚠️ IT EXISTS BECAUSE OF A SENTENCE. When `bootstrap` fails, creation tells
 * the person "we have taken it back off your computer rather than leave
 * something half installed" — and without this, a `projects[…]` entry for a
 * folder that no longer exists stays in another tool's config forever, which
 * makes that sentence false in exactly the case that produces it.
 *
 * 🛑 IT REMOVES THE KEY, NOT THE ENTRY, and the difference is somebody's data.
 * `trustFolder` reports `already: false` when it SET THE KEY — which is not the
 * same as having created the entry. A person can have a `projects[…]` entry for
 * that exact path carrying their allowedTools, their MCP servers and their
 * history, with no trust key in it. A version of this that deleted the entry
 * took all of that with it, on a path whose whole job is putting things back.
 *
 * ⚠️ THAT SHAPE IS DEFENSIVE, NOT OBSERVED, and an earlier version of this
 * comment cited "93 dead entries measured on this machine" as evidence for it.
 * Those 93 were THIS BRANCH'S OWN DAMAGE — an unsandboxed suite writing temp
 * directories into the real config — so a bug of mine was being quoted back as
 * independent measurement. Measured properly: 0 of 22 entries lack the key. The
 * merge is still right, because the cost of being wrong about it is somebody's
 * settings. The number is what did not measure what it claimed.
 *
 * ⚠️ So: delete the key, and drop the entry only if nothing else is left in it.
 * That restores the exact state from before `trustFolder` ran, in both cases,
 * without needing to be told which case it was.
 *
 * ⚠️ AND IT IS NOT CALLED ON AN ORDINARY REMOVAL, deliberately. Removing an
 * agent deletes its folder, which leaves an entry for a path that is gone — the
 * same litter this exists to avoid. But at that moment we cannot tell an entry
 * we wrote from one the person made themselves, and deleting their decision is
 * the harm every guard in this file is pointed at. The rollback below is
 * different only because we wrote that key seconds earlier and know it.
 * Recorded as a card rather than guessed at here.
 *
 * Same shape, same refusals, same fail-soft contract as `trustFolder`.
 */
function forgetFolder(dir) {
  const target = CONFIG();
  if (!dir || !path.isAbsolute(dir)) return { ok: false, because: 'that is not an absolute folder path' };

  // ⚠️ NOT realpath, because THE CALLER HANDS BACK THE KEY `trustFolder`
  // RETURNED — already resolved, and resolved at the moment the folder was
  // certainly there. Resolving again here would be a second derivation of one
  // fact, and it would be the derivation that runs while a rollback is deleting
  // the folder under it.
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
  // ⚠️ A SHAPE WE WOULD REFUSE TO WRITE IS REFUSED HERE TOO. An earlier version
  // answered `ok: true` for a malformed `projects`, reporting success about a
  // file it had not really read — on the one path whose entire job is being
  // honest about what was taken back.
  if (data.projects !== undefined
      && (data.projects === null || typeof data.projects !== 'object' || Array.isArray(data.projects))) {
    return { ok: false, because: 'their config file is not shaped the way we expect' };
  }
  const entry = data.projects && data.projects[key];
  if (entry === undefined) return { ok: true, already: true };
  // ⚠️ A malformed ENTRY is refused for the same reason a malformed `projects`
  // is, eight lines up: answering "taken back" about a shape we did not
  // understand is reporting success for a file we did not really read.
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, because: 'their config file is not shaped the way we expect' };
  }
  if (!(KEY in entry)) return { ok: true, already: true };

  // ⚠️ AND ONLY IF IT STILL SAYS YES. The caller's gate is a claim about a
  // moment that has passed: between our rename and the bootstrap failing, a
  // live Claude Code session can write its own value for this path — including
  // the `false` this file argues elsewhere is AN ANSWER, NOT AN ABSENCE.
  // Deleting that would be the undo destroying a decision, on the one path
  // whose whole job is putting things back.
  if (entry[KEY] !== true) return { ok: true, already: true };
  delete entry[KEY];
  // Only now, and only if there is nothing of theirs left in it.
  if (Object.keys(entry).length === 0) delete data.projects[key];

  const tmp = tempPath(target);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: prevMode });
    fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch (err) {
    // ⚠️ NEVER UNLINK A TEMP FILE WE DID NOT CREATE. Nothing else uses this
    // naming scheme, so an EEXIST here means a file somebody PLANTED at a path
    // we were about to write — the exact case `wx` exists to refuse. Removing
    // it would be this code deleting a file it cannot prove anything about, on
    // behalf of a write it is already refusing to do.
    if (!err || err.code !== 'EEXIST') {
      try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    }
    return { ok: false, because: 'we could not write to their config file' };
  }
  return { ok: true, already: false };
}

module.exports = { trustFolder, forgetFolder, KEY };
