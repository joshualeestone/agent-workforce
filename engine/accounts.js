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

module.exports = { list, identityOf, HOME_FOR_TEST: HOME };
