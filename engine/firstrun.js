'use strict';

/**
 * Whether this machine has been through first run, and what first run should
 * say when it has not.
 *
 * ⚠️ "ADOPTING" YOUR EXISTING AGENTS IS NOT AN IMPORT, AND THE SCREEN MUST NOT
 * PRETEND IT IS.
 *
 * The prototype shows "We found 5 agents → Continue", which reads like a
 * migration step. It is not one. The board is built from `tmux list-panes`, so
 * every agent already on the machine is ALREADY on the board before anybody
 * clicks anything — measured: 13 agents visible on this machine, none of them
 * created by Kosmos, nothing imported.
 *
 * So the honest thing that screen does is **show somebody that we can already
 * see their fleet**. That is worth a screen — it is the moment the promise
 * "manage the agents you already use" becomes visible — but building an import
 * behind it would be building a fake step that can fail, for work that has
 * already happened.
 *
 * ⚠️ What first run therefore persists is exactly one fact: that it has been
 * seen. Not a list of adopted agents, not a migration record. One flag, so the
 * app knows whether to open on the welcome or on the board.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const status = require('./status');
const subscription = require('./subscription');

const FLAG = path.join(store.ROOT, 'first-run.json');

/**
 * ⚠️ Read through the same reader the rest of the product uses, and fail the
 * same way: a flag we cannot read is NOT "they have never been here". Telling
 * a returning person they are new is a small insult; showing them onboarding
 * over their working board is a bigger one.
 */
function seen() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FLAG, 'utf8'));
    return parsed && parsed.completedAt ? { known: true, done: true, at: parsed.completedAt } : { known: true, done: false };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { known: true, done: false };
    // Unreadable: we do not know. The caller treats that as "done", because
    // the cost of re-running onboarding over somebody's working board is
    // higher than the cost of not showing it once.
    return { known: false, done: true };
  }
}

function complete() {
  fs.mkdirSync(path.dirname(FLAG), { recursive: true });
  const tmp = `${FLAG}.${process.pid}.new`;
  fs.writeFileSync(tmp, `${JSON.stringify({ completedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, FLAG);
  return seen().done === true;
}

/** How many agents are already here, and can we trust the answer? */
function fleet() {
  try {
    const agents = status.paneRoster();
    /**
     * ⚠️ `paneRoster` cards carry `sessionName`, NOT a display name -- the name
     * a person recognises is parsed out of the agent's instruction file by
     * `readIdentity`. Mapping `.name` here returned an array of nulls, and the
     * screen would have shown "We found 4 agents" over four blank rows.
     *
     * Caught by reading the route's output rather than its status code, which
     * was 200 the whole time.
     */
    const names = agents.map((a) => {
      try { return status.readIdentity(a.sessionName).displayName || a.sessionName; }
      catch { return a.sessionName; }
    });
    return { known: true, count: agents.length, names: names.slice(0, 12) };
  } catch {
    // ⚠️ An unreachable tmux is not an empty machine. That confusion is the
    // one this codebase is built against, and here it would route somebody
    // with a working fleet down "create your first agent".
    return { known: false, count: null, names: [] };
  }
}

/**
 * What first run should show, decided in one place so the screen cannot
 * disagree with the engine about which path somebody is on.
 */
function state() {
  const flag = seen();
  const sub = subscription.check();
  const here = fleet();

  /**
   * ⚠️ THE FORK IS ONLY OFFERED WHEN WE CAN ACTUALLY COUNT. If tmux could not
   * be asked we do not know whether they have agents, and guessing "create
   * your first one" at somebody with a running fleet is the version of this
   * mistake that looks broken.
   */
  const path_ = !here.known ? 'unknown' : (here.count > 0 ? 'adopt' : 'create');

  return {
    done: flag.done,
    // Carried so the screen can say WHY it is not offering the fork, rather
    // than silently picking one.
    fleetKnown: here.known,
    fleetCount: here.count,
    fleetNames: here.names,
    path: path_,
    subscription: sub,
  };
}

module.exports = { state, seen, complete, fleet, FLAG };
