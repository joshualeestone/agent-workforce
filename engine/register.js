'use strict';

/**
 * Which of your agents will still be here after you restart the computer.
 *
 * 🛑 THE ANSWER WAS NOT AVAILABLE ANYWHERE, and on Josh's machine it was one
 * out of sixteen. Measured 2026-08-22, after the first real reboot:
 *
 *   ~/work/workers/          16 folders
 *   ~/Library/LaunchAgents/   1 job      com.kosmos.agent.anna
 *   tmux ls                   1 session  anna
 *
 * ⚠️ AN AGENT WITH NO JOB IS NOT BROKEN AND DOES NOT LOOK BROKEN. It runs, it
 * answers, it draws exactly the same card as a registered one. The difference
 * only appears at the next login, and by then the session that was holding it
 * up is gone. **Nobody could have found this out except by restarting**, which
 * is how Josh found it out.
 *
 * ⚠️ WHAT IS NOT AT RISK, because it changes how urgent this is rather than how
 * serious: nothing was deleted. The folders, the instructions, the history and
 * the profiles are all on disk. These agents are STOPPED and UNREGISTERED, not
 * lost, and nothing decays while somebody works out what to do.
 *
 * 🔑 THE ROSTER COMES FROM WHAT KOSMOS ITSELF WROTE, never from "there is a
 * folder here". `~/work/workers` is a plain directory a person may keep their
 * own things in — on this fleet's own Mac it holds worker checkouts that are
 * not Kosmos agents at all — and writing launchd jobs for whatever is sitting
 * in it would start strangers' processes at every login. A profile under the
 * product's own data directory is a record only this product writes, so it is
 * the evidence used, and the failure direction is to do nothing.
 */

const fs = require('node:fs');
const path = require('node:path');
const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');

/**
 * What this agent is called by the person who made it.
 *
 * 🛑 THE PANEL PRINTED THE MACHINE NAME, and Josh met it head on: the list read
 * `ava, bob, brigitte…` while his board showed **Ava**, **Brigitte** and
 * **Scarlett**. The same agents, in two vocabularies, on one screen. He
 * reasonably read it as Scarlett being missing from a list she was in.
 *
 * 🔑 THE RULE THIS BREAKS IS ALREADY WRITTEN DOWN, in `create.js`: act on the
 * machine name, speak the display name. Every value this module ACTS on stays
 * the slug; this is only for the sentence.
 *
 * ⚠️ THROUGH `status.readIdentity`, which is the board's own reader, so a name
 * cannot differ between the card and the panel that names the card. It prefers
 * the stored record over the instruction file, handles the overrides, and falls
 * back to the slug — three behaviours a local `readProfile().displayName` would
 * have to grow one at a time, wrongly, in a second place.
 */
function shownName(name) {
  try {
    const id = status.readIdentity(name);
    const shown = id && typeof id.displayName === 'string' ? id.displayName.trim() : '';
    return shown || name;
  } catch {
    /* A name we cannot look up is still a name. The slug is what the machine
       calls it, which is worse to read and never wrong. */
    return name;
  }
}

/** Names Kosmos has written a profile for: its own record that an agent exists. */
function known() {
  let files;
  try { files = fs.readdirSync(store.PROFILES); } catch (err) {
    /* ⚠️ "NOTHING HAS EVER BEEN WRITTEN" IS NOT "WE COULD NOT LOOK", and this
       module would have shipped saying the second on every fresh machine: the
       directory does not exist until the first profile is written. That is the
       exact distinction the rest of this product is built on, inverted, in the
       one place where the wrong answer is a permanent alarming sentence on a
       board that has no agents to be alarmed about. */
    if (err && err.code === 'ENOENT') return { ok: true, names: [] };
    return { ok: false, names: [] };
  }
  const names = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    /* ⚠️ Filtered through `create.NAME_RE`, the writer's own rule, and NOT
       through `slugFor`: that only lowercases, so `..json` would round-trip
       unchanged and `..` is a path, not a name. A profile file whose name does
       not survive the rule is not something we can build a job from, and
       guessing at what it was meant to be is how a job ends up pointing into
       a folder belonging to something else. */
    .filter((n) => create.NAME_RE.test(n));
  return { ok: true, names: names.sort() };
}

/**
 * Every agent Kosmos knows about, and whether it survives a restart.
 *
 * ⚠️ THREE SEPARATE FACTS PER AGENT, deliberately not collapsed into a verdict.
 * A folder with no job is recoverable; a job with no folder is a job that fails
 * every thirty seconds forever; and a removed agent is neither, it is somebody's
 * decision. A single "healthy" boolean would hide which of the three you have.
 */
function survey() {
  const k = known();
  const rem = remove.removedNames();
  if (!k.ok) {
    return { ok: false, because: 'we could not read what Kosmos knows about your agents', agents: [], missing: [] };
  }
  if (!rem.ok) {
    /* ⚠️ FAIL CLOSED. Without a readable removed list we cannot tell a
       forgotten agent from one somebody deliberately took off the board, and
       the wrong guess starts a process they stopped on purpose. */
    return { ok: false, because: 'we could not read which agents you have removed, so we are not going to change anything', agents: [], missing: [] };
  }
  const removed = new Set(rem.names);
  const agents = k.names.map((name) => ({
    name,
    /* ⚠️ ACT ON `name`, SPEAK `shownAs`. Both travel, and the caller must not
       have to choose: the panel printed the machine name and Josh read
       `ava, bob, brigitte` beside cards saying Ava, Brigitte and Scarlett. */
    shownAs: shownName(name),
    removed: removed.has(name),
    folder: fs.existsSync(create.workerDir(name)),
    job: fs.existsSync(create.plistPath(name)),
  }));
  return {
    ok: true,
    because: null,
    agents,
    /* The ones a repair would act on: known, not removed, on disk, no job.
       Machine names, because this is the list a repair ACTS on; the sentence
       naming them reads `shownAs` off `agents`. */
    missing: agents.filter((x) => !x.removed && x.folder && !x.job).map((x) => x.name),
  };
}

/**
 * Give every agent that is missing one the job it never got.
 *
 * ⚠️ IT REPORTS PER AGENT AND NEVER IN AGGREGATE. "12 agents repaired" over a
 * run where three of them could not be started is the shape of sentence this
 * product keeps removing: the person needs to know WHICH, because the ones that
 * did not start are the ones they will go looking for.
 *
 * ⚠️ `model` is what the caller could read of what each agent last ran as, and
 * it is a live reading rather than a stored choice — the model an agent was
 * SET to run on lived only in the job that does not exist. Passing nothing is
 * honest and lands the agent on Claude's own default; what must not happen is
 * a sentence claiming we restored a choice we never had.
 */
function repair(opts) {
  const seen = survey();
  if (!seen.ok) return { ok: false, because: seen.because, results: [] };
  const modelFor = (opts && typeof opts.modelFor === 'function') ? opts.modelFor : () => null;
  const results = seen.missing.map((name) => {
    let model = null;
    /* A model we cannot read is not a reason to leave the agent unregistered.
       An agent that comes back on the default model is recoverable in one
       click; an agent that does not come back at all is not. */
    try { model = modelFor(name) || null; } catch { model = null; }
    const r = create.installJob(name, { model });
    return { name, shownAs: shownName(name), ...r };
  });
  return {
    ok: true,
    because: null,
    results,
    /* Counts for a headline, beside the list rather than instead of it. */
    installed: results.filter((r) => r.ok).length,
    started: results.filter((r) => r.ok && r.started).length,
  };
}

module.exports = { known, survey, repair };
