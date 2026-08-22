'use strict';

/**
 * The Claude accounts this machine can run agents on.
 *
 * 🔑 AN ACCOUNT IS A CONFIG DIRECTORY, NOT A LOGIN, and that is the whole of
 * this module's shape. `CLAUDE_CONFIG_DIR` selects which directory a Claude Code
 * process uses, and everything that process knows lives in there.
 *
 * 🛑 WHICH MEANS MOVING AN AGENT BETWEEN ACCOUNTS MOVES ITS MEMORY. Transcripts
 * live under `<dir>/projects`, so an agent pointed at a different account reads
 * as having no history — and the fleet's own write-up of this says the failure
 * out loud: *"An agent restarted onto a fresh account comes up with no memory,
 * and nothing on screen says so. It looks like a working agent and behaves like
 * a blank one."* Anything built on top of this module has to say that where the
 * choice is made.
 *
 * 📌 INSTRUCTIONS ARE SAFE, and it is worth stating so nobody re-derives the
 * scare: a Kosmos agent reads its instructions from its own worker folder, which
 * the supervisor passes as the working directory. Those do not live in the
 * config directory and do not move.
 *
 * ⚠️ THE NAMING IS LOad-BEARING RATHER THAN COSMETIC. `status.configRoots()`
 * finds `~/.claude` and any `~/.claude-*` that contains a `projects` directory,
 * and that is how memory readings are found. Naming Kosmos's account directories
 * `~/.claude-<label>` therefore keeps memory working across accounts for free.
 * Put them anywhere else and every agent on a second account reads Unknown.
 *
 * ⚠️ AND A `.claude-*` DIRECTORY IS NOT AUTOMATICALLY AN ACCOUNT. Measured on
 * this machine: `.claude-account-b` and `.claude-account-c` each carry a
 * `.claude.json` with an `oauthAccount`; `.claude-workers` carries none and is
 * not a login at all. The presence of that record is what makes a directory an
 * account, not the name.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.AGENT_WORKFORCE_HOME || os.homedir();

/**
 * Where a config directory keeps its account record.
 *
 * 🛑 THE DEFAULT IS NOT WHERE THE OTHERS ARE, and this asymmetry would have
 * shipped as "your main account vanished from the list". Measured on this
 * machine:
 *
 *   ~/.claude.json                  <- the DEFAULT account's record, at HOME
 *   ~/.claude-account-b/.claude.json   an overridden config dir keeps its own
 *
 * There is no `~/.claude/.claude.json` at all. `engine/subscription.js` has
 * always read the HOME-level file, which is why the product has been right about
 * one account and would have been wrong about the first thing it said about two.
 */
function configFile(dir) {
  const isDefault = dir === path.join(HOME, '.claude');
  return isDefault ? path.join(HOME, '.claude.json') : path.join(dir, '.claude.json');
}

/**
 * The account a config directory is signed in to, or null.
 *
 * ⚠️ NULL FOR EVERY UNREADABLE SHAPE rather than a guess: a missing file, a
 * file that is not JSON, and a config with no `oauthAccount` are all "this is
 * not a signed-in account", and none of them is an error worth surfacing.
 */
function identityOf(dir) {
  let raw;
  try { raw = fs.readFileSync(configFile(dir), 'utf8'); } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const acct = parsed && parsed.oauthAccount;
  if (!acct || typeof acct !== 'object') return null;
  const email = typeof acct.emailAddress === 'string' ? acct.emailAddress
    : typeof acct.email === 'string' ? acct.email : null;
  return {
    email,
    organization: typeof acct.organizationName === 'string' ? acct.organizationName : null,
  };
}

/**
 * Every account on this machine, the default one first.
 *
 * 📌 `~/.claude` IS ALWAYS FIRST AND IS NEVER SYNTHESISED. It is the directory
 * Claude Code uses with no override, so it is the account an agent runs on
 * unless something says otherwise — and it is the one the rest of the product
 * has always meant by "your account".
 */
function list() {
  const out = [];
  const seen = new Set();
  const add = (dir, isDefault) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const who = identityOf(dir);
    if (!who) return;
    out.push({
      dir,
      label: isDefault ? null : path.basename(dir).replace(/^\.claude-/, ''),
      isDefault: isDefault === true,
      email: who.email,
      organization: who.organization,
      /* Whether a memory reading taken on this account can be FOUND. See the
         naming note at the top: `status.configRoots` only looks at `~/.claude`
         and `~/.claude-*`, and only when a `projects` directory is there. */
      memoryReadable: fs.existsSync(path.join(dir, 'projects')),
    });
  };

  add(path.join(HOME, '.claude'), true);
  let entries = [];
  try { entries = fs.readdirSync(HOME); } catch { entries = []; }
  for (const name of entries.sort()) {
    if (!name.startsWith('.claude-')) continue;
    add(path.join(HOME, name), false);
  }
  return out;
}

/**
 * Make a directory a Kosmos account can be signed in to.
 *
 * 🔑 THE RULE THIS ENCODES IS JOSH'S, 2026-08-22, and it is a principle rather
 * than a setting: **an agent's memory belongs to the agent.** His words: *"her
 * memory should follow her everywhere she goes"* — across models, across
 * accounts, and across providers the day there is a second one.
 *
 * 📌 WHICH FALLS OUT ALMOST FREE, because of what the store is already keyed by.
 * Claude Code files transcripts under the DIRECTORY A SESSION WAS LAUNCHED IN,
 * and Kosmos launches every agent in its own folder. So the tree is already
 * per-agent; it just happens to live inside whichever config directory is in
 * use. Pointing every account at ONE tree therefore does not move memory to a
 * new home — it stops a second home from existing.
 *
 * 🛑 AND WITHOUT THIS, A SECOND ACCOUNT IS A QUIET AMNESIA. The fleet's own
 * write-up of this failure: *"An agent restarted onto a fresh account comes up
 * with no memory, and nothing on screen says so. It looks like a working agent
 * and behaves like a blank one."* That is the outcome this function exists to
 * make impossible rather than to warn about.
 *
 * ⚠️ THE NAME IS LOAD-BEARING TWICE OVER. `~/.claude-<label>` is what
 * `status.configRoots()` scans, so a directory named anything else is invisible
 * to the memory reading even with the tree shared.
 */
function prepare(label) {
  const clean = String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean) return { ok: false, because: 'that is not a name we can use for an account' };
  const dir = path.join(HOME, `.claude-${clean}`);
  const shared = path.join(HOME, '.claude', 'projects');

  try { fs.mkdirSync(dir, { recursive: true }); }
  catch { return { ok: false, because: 'we could not make a place for that account on this computer' }; }

  const projects = path.join(dir, 'projects');
  let memoryShared = false;
  try {
    const st = fs.lstatSync(projects);
    /* Already pointed somewhere. A real directory here is somebody's existing
       history and is NOT ours to replace — that is the amnesia this guards
       against, arriving from the other direction. */
    memoryShared = st.isSymbolicLink() && fs.realpathSync(projects) === fs.realpathSync(shared);
  } catch {
    try {
      fs.mkdirSync(shared, { recursive: true });
      fs.symlinkSync(shared, projects);
      memoryShared = true;
    } catch { memoryShared = false; }
  }
  return { ok: true, dir, label: clean, memoryShared };
}

module.exports = { list, identityOf, prepare, HOME_FOR_TEST: HOME };
