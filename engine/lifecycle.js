'use strict';

/**
 * Giving an agent a fresh start: compact, clear, restart.
 *
 * ⚠️ **These are the first actions in the product that reach a RUNNING agent.**
 * Everything before this edited files an agent reads. These interrupt a live
 * session, and two of the three destroy its conversation, which is where every
 * commitment it is holding lives.
 *
 * The three are ordered by what they cost, and the ordering is the whole point:
 *
 *   - **compact** summarises the older part of the conversation. Loses nothing.
 *   - **clear** empties the conversation. The agent keeps running and forgets.
 *   - **restart** stops and starts the process. Also forgets, and is the ONLY
 *     one that re-reads the instruction file, which is what ties this to the
 *     editor added alongside it.
 *
 * ⚠️ **Restart goes through `restart-bot.sh`, and that is not incidental.**
 * The script drives launchd, which runs the launch script, which supplies
 * `--dangerously-skip-permissions`. A hand-rolled `tmux kill-session` +
 * `new-session` looks equivalent and is not: the bot comes back WITHOUT that
 * flag and freezes on its first permission prompt, silently, until a human
 * notices it has stopped answering. This is a standing fleet rule, and it is
 * why this module shells out to a script instead of doing the obvious thing.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * The blessed restart path. Overridable so tests never touch the real one.
 */
const RESTART_SCRIPT = process.env.AGENT_WORKFORCE_RESTART_SCRIPT
  || path.join(os.homedir(), '.claude', 'bin', 'restart-bot.sh');

/**
 * Perform nothing; report what would have happened.
 *
 * ⚠️ This exists because I sent `/compact` to a live agent while testing these
 * very routes, and that agent was the session doing the work. The command
 * queued in its composer and would have wiped the conversation the moment the
 * turn ended.
 *
 * The cause is worth stating exactly, because it is not carelessness: the two
 * sandbox variables this codebase already had (`AGENT_WORKFORCE_DATA`,
 * `AGENT_WORKFORCE_WORKERS`) redirect FILE roots, and every previous feature
 * touched only files. tmux and launchd are global to the machine. There was no
 * safe way to exercise these routes at all, so the first honest probe hit a
 * real agent, and the plan's own rule ("no test may restart, clear or compact a
 * real agent") had no mechanism behind it.
 *
 * So the mechanism is here. `AGENT_WORKFORCE_DRY_RUN=1` and every action
 * becomes a description of itself. Any manual probing of this surface must set
 * it.
 */
let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';

/**
 * Turn dry-run off for one test, and ONLY with an injected runner in place.
 *
 * ⚠️ This exists because the safety mechanism disabled the coverage of the
 * thing it protects, which is the sharpest instance yet of the pattern this
 * branch keeps hitting: new defensive code breaking something the previous
 * code did correctly.
 *
 * `server.test.js` sets `AGENT_WORKFORCE_DRY_RUN=1` file-wide, so `perform()`
 * always returns `DRY_RUN`, so `invalidatesCommitments()` always returns false,
 * so the route's entire reconciliation block — the tombstone that stops the
 * board asserting destroyed commitments at full confidence for the next thirty
 * minutes — never executed in any test. Deleting that block left the suite
 * green. The flag added to make this surface safe to probe was the reason its
 * most consequential guard could not be pinned.
 *
 * ⚠️ Turning it OFF requires a runner to already be installed, and this throws
 * otherwise. That invariant is the whole safety of this function: with a
 * recorder in place nothing can reach `execFileSync`, and without one the only
 * way to clear dry-run is an exception. A flag that could be switched off on a
 * machine running thirteen agents, with nothing checking what would run, is a
 * worse hazard than the untested branch it was added to fix.
 */
function setDryRun(on) {
  if (!on && run === defaultRunner) {
    throw new Error('refusing to leave dry-run with the real runner installed: call setRunner() first');
  }
  DRY_RUN = Boolean(on);
}

/**
 * What each action costs, in the product's own words.
 *
 * Held here rather than in the browser so the screen cannot describe an action
 * differently from the thing that performs it. The editor shipped a version of
 * exactly that bug: the panel decided whether a file was editable by
 * regex-matching the engine's English prose, and rewording one sentence would
 * have silently changed behaviour.
 */
const ACTIONS = {
  compact: {
    id: 'compact',
    label: 'Compact',
    gentlest: true,
    what: 'Summarises the older part of the conversation instead of deleting it. It keeps running, and what it is holding should survive the summary.',
    // ⚠️ NOT "nothing", though the wireframe says so and it is the tempting
    // word for the gentlest option.
    //
    // `/compact` replaces the older conversation with a summary. That is lossy
    // by construction, and this card's own premise is that an agent's
    // commitments live in the conversation. "Loses nothing" was the only cost
    // claim in this file that overstated safety, on the one screen whose entire
    // job is to state cost honestly, and it was also what exempted compact from
    // the confirmation the other two require.
    loses: 'detail, but not usually the things it is holding',
  },
  clear: {
    id: 'clear',
    label: 'Clear',
    gentlest: false,
    what: 'Empties the conversation. It keeps running but forgets what was said.',
    loses: 'everything it is holding',
  },
  restart: {
    id: 'restart',
    label: 'Restart',
    gentlest: false,
    what: 'Stops it and starts it again. The only option that re-reads its instructions, so a change there needs this one.',
    loses: 'everything it is holding',
  },
};

/**
 * Did we actually do it, or only ask?
 *
 * ⚠️ Three outcomes, not two, for the same reason the rest of this codebase
 * refuses to answer in two: a send-keys returns the instant the keystrokes are
 * queued and confirms nothing about whether the agent acted on them. Reporting
 * that as `done` would be the product asserting something it did not verify,
 * on the screen whose entire job is to be honest about consequences.
 */
const OUTCOME = {
  DONE: 'done',         // performed and verified
  ASKED: 'asked',       // the request was delivered; we cannot confirm the effect
  REFUSED: 'refused',   // we did not attempt it, and why
  DRY_RUN: 'dry-run',   // nothing was done; this is what would have been
};

/**
 * A tmux pane target we are willing to send keystrokes to.
 *
 * ⚠️ Validates, never transforms, and never interpolates. This string reaches
 * `tmux send-keys -t <target>`, so anything shell-ish or option-ish in it is a
 * problem. `execFileSync` with an argument array means there is no shell to
 * inject into, but a leading dash would still be read by tmux as an option, and
 * a name that is not on the roster is not ours to touch at all.
 *
 * Deliberately strict: sessions on this fleet are `<name>-discord` and panes are
 * `<window>.<pane>`. Anything else is refused rather than sanitised, because
 * sanitising a target means acting on an agent the caller did not name.
 */
function safeTarget(target) {
  const t = String(target == null ? '' : target);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*:[0-9]+\.[0-9]+$/.test(t)) return null;
  return t;
}

/**
 * A launchd service name we are willing to restart.
 *
 * Same discipline: the agent name becomes `com.<name>.discord`, so it is
 * validated as a bare name rather than cleaned up into one.
 */
function safeServiceName(agent) {
  const a = String(agent == null ? '' : agent);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(a)) return null;
  return a;
}

/**
 * Run a command, capturing whether it worked without leaking how it failed.
 *
 * Injectable so the tests can exercise every path without touching a real
 * agent. ⚠️ A test suite that can restart the fleet is worse than no test
 * suite, so the seam is here rather than in the caller.
 */
function defaultRunner(file, args, opts) {
  return execFileSync(file, args, { encoding: 'utf8', timeout: 30000, ...opts });
}

let run = defaultRunner;

/**
 * Swap the runner. Tests only.
 *
 * ⚠️ Restoring the DEFAULT runner re-arms dry-run, and that is not tidiness.
 * The `setDryRun` invariant was one-directional: it refuses to leave dry-run
 * while the real runner is installed, but nothing stopped the reverse order
 * (`setDryRun(false)` then `setRunner(null)`), which left `execFileSync` armed
 * with the fleet-wide protection off, on a machine running thirteen agents. The
 * one test doing this happens to order its `finally` correctly; a guard that
 * depends on everyone remembering the order is not a guard.
 */
function setRunner(fn) {
  if (typeof fn === 'function') { run = fn; return; }
  run = defaultRunner;
  DRY_RUN = true;
}

/**
 * Send a slash command into an agent's pane.
 *
 * `send-keys` twice on purpose: the text, then Enter as a separate key. Sending
 * `"/clear\n"` as one argument types a literal newline into the composer on
 * some terminal setups rather than submitting it, which leaves the command
 * sitting there unsent and the caller believing it ran.
 */
function sendCommand(target, command) {
  const t = safeTarget(target);
  if (!t) {
    return { outcome: OUTCOME.REFUSED, because: 'we do not have a usable pane for that agent' };
  }
  if (DRY_RUN) {
    return {
      outcome: OUTCOME.DRY_RUN,
      because: `nothing was sent; this would have typed ${command} into ${t}`,
    };
  }

  // ⚠️ Two calls, and which one failed changes what is true afterwards.
  //
  // If the TEXT landed and the Enter did not, `/clear` is now sitting in a live
  // agent's composer waiting to submit itself on the next keypress or at the
  // end of its turn. That is the incident in this module's header. Reporting it
  // as a clean "we could not reach that agent" would be the product saying
  // nothing happened when something did, and the operator would never look.
  let sent = false;
  try {
    run('tmux', ['send-keys', '-t', t, command]);
    sent = true;
    run('tmux', ['send-keys', '-t', t, 'Enter']);
  } catch {
    // Never the raw errno: it carries absolute paths and says nothing useful.
    return {
      outcome: OUTCOME.REFUSED,
      // ⚠️ A STRUCTURED flag, not a sentence to be matched later. The decision
      // to destroy a commitment record keyed on a regex over this English for
      // one round, which is the coupling this file's own ACTIONS comment
      // condemns and the browser had to be fixed for twice.
      mayHaveLanded: sent,
      because: sent
        ? `we could not finish, and ${command} may be sitting in its composer unsent, so check on it`
        : 'we could not reach that agent to ask',
    };
  }
  return {
    outcome: OUTCOME.ASKED,
    // ⚠️ Deliberately not "done". The keystrokes were delivered; whether the
    // agent acted on them is not something this can see.
    because: 'we asked it to, and it does not report back when it has',
  };
}

/**
 * Restart an agent through launchd.
 */
function restart(agent) {
  const name = safeServiceName(agent);
  if (!name) {
    return { outcome: OUTCOME.REFUSED, because: 'that is not a name we can restart' };
  }

  // Refuse rather than improvise. The whole reason this path exists is that the
  // obvious alternative silently produces a bot with no permissions flag, so a
  // missing script must stop us, not route us around the rule it enforces.
  // ⚠️ Executable, not merely present. A script that exists and is mode 644
  // makes `execFileSync` throw EACCES with NOTHING having run, and the catch
  // below reports that as `asked` ("it may have been stopped"), which
  // tombstones the commitment record of an agent nobody touched. The board then
  // tells you its conversation was cleared while it is sitting there intact.
  let usable = false;
  try {
    usable = fs.statSync(RESTART_SCRIPT).isFile();
    fs.accessSync(RESTART_SCRIPT, fs.constants.X_OK);
  } catch {
    usable = false;
  }
  if (!usable) {
    return {
      outcome: OUTCOME.REFUSED,
      because: 'the restart script is not on this machine, and restarting another way would bring it back without its permissions',
    };
  }

  if (DRY_RUN) {
    return {
      outcome: OUTCOME.DRY_RUN,
      because: `nothing was done; this would have restarted ${name}`,
    };
  }

  let out = '';
  try {
    out = String(run(RESTART_SCRIPT, [name]) || '');
  } catch (err) {
    // ⚠️ Except when the script told us it never started. `restart-bot.sh`
    // exits 1 with "No launchd service found" BEFORE it reaches
    // `launchctl stop`, so that one is genuinely untouched, and reporting it as
    // maybe-stopped tombstoned the record of an agent nobody had touched. The
    // comment below used to claim the stop was unconditional; it is not.
    const said = `${(err && err.stdout) || ''}${(err && err.stderr) || ''}`;
    if (/No launchd service found/.test(said)) {
      return {
        outcome: OUTCOME.REFUSED,
        because: 'there is no launchd service by that name, so there was nothing to restart',
      };
    }

    // ⚠️ ASKED, not REFUSED, and the difference decides whether the commitment
    // record gets tombstoned.
    //
    // `REFUSED` means "we did not attempt it", and that is true of the checks
    // above (bad name, missing script) and of the missing-service case just
    // handled, but NOT of anything else. Past that point the script has already
    // run `launchctl stop`, so a non-zero exit or a timeout means the agent was
    // stopped and then something went wrong. Calling that "did not attempt" skipped the
    // tombstone, so the conversation was destroyed while the board went on
    // serving "it reported these itself" at full confidence: the exact failure
    // the tombstone exists to prevent, on the one path that skipped it.
    return {
      outcome: OUTCOME.ASKED,
      because: 'the restart did not finish cleanly, and it may have been stopped, so check on it',
    };
  }

  // ⚠️ The EXIT CODE is not the answer, and believing it was is the worst bug
  // this module has had.
  //
  // `restart-bot.sh` ends with `if tmux has-session …; then echo OK; else echo
  // WARN; fi`. Under `set -euo pipefail` that WARN branch is still the last
  // command and still exits 0, so a bot that launchd started and that then died
  // on boot — including the missing-permissions-flag case this whole module
  // exists to prevent — came back as exit 0.
  //
  // We reported `done`, "performed and verified", and the route then FORGOT the
  // agent's commitments on the strength of it. A false claim of success plus
  // irreversible data loss, on the screen whose stated job is honesty about
  // consequences. Measured: a faithful reproduction of the script's tail exits
  // 0 on the WARN path.
  //
  // So the output is read. `OK:` present means the session was seen coming
  // back, which is a real verification. Anything else is `asked`: we ran the
  // restart and cannot confirm it took.
  const cameBack = /(^|\n)OK: .*session is running/.test(out);
  // ⚠️ The script reports TWO things, and only matching the first was wrong.
  //
  // It prints `OK: <session> tmux session is running`, and then EITHER
  // `OK: bypass permissions is ON` or `WARN: bypass permissions not confirmed`.
  // A loose `OK:` match saw the first line in both cases, so a bot that came
  // back WITHOUT its permissions flag — the exact silent-freeze failure this
  // module's header gives as the reason it shells out to this script at all —
  // was reported as `done`, "performed and verified", and the commitment record
  // was destroyed on the strength of it.
  const permissionsOn = /bypass permissions is ON/.test(out);

  if (cameBack && permissionsOn) {
    return { outcome: OUTCOME.DONE, because: 'it was stopped and started again, and came back' };
  }
  if (cameBack) {
    return {
      outcome: OUTCOME.ASKED,
      because: 'it came back, but we could not confirm it has permission to work, so check on it',
    };
  }
  return {
    outcome: OUTCOME.ASKED,
    because: 'it was stopped and started, but it has not come back yet, so check on it',
  };
}

function clear(agent, target) {
  return sendCommand(target, '/clear');
}

function compact(agent, target) {
  return sendCommand(target, '/compact');
}

/**
 * Perform one action by id.
 */
function perform(action, agent, target) {
  switch (action) {
    case 'restart': return restart(agent);
    case 'clear': return clear(agent, target);
    case 'compact': return compact(agent, target);
    default:
      return { outcome: OUTCOME.REFUSED, because: 'that is not something we know how to do' };
  }
}

/**
 * May we type a command into this agent's pane at all?
 *
 * ⚠️ Extracted as a decision rather than left inline in the route, because
 * inline it could not be pinned: the `needs_you` case needs an agent that
 * happens to be showing a question right now, and no test can arrange that.
 *
 * Two refusals, and the second is the most dangerous thing in this feature:
 *
 *   - **Not an agent pane.** `list-panes -a` returns every pane on the machine,
 *     and `/clear` typed into a shell is EXECUTED rather than read as a command.
 *   - **Waiting on a question.** `clear` and `compact` send the command and then
 *     a bare `Enter`. On a permission prompt the text is ignored by the select
 *     and the ENTER CONFIRMS THE HIGHLIGHTED OPTION, which is Yes. So the
 *     gentlest button on a screen built to show you the cost of an action would
 *     instead approve an arbitrary tool call nobody saw, and the answer would
 *     say "we asked it to compact".
 *
 * `restart` types nothing, so the second refusal does not apply to it. It is
 * NOT exempt from the first.
 *
 * ⚠️ It used to be exempt from both, and that was a live hole. The roster is
 * every tmux pane on the machine with the `-discord` suffix merely STRIPPED,
 * never required, so a plain shell in a session called `mikey` appeared as an
 * agent named `mikey` — and its Restart button ran `restart-bot.sh mikey`
 * against the real bot. "It goes through launchd" answers whether the ACTION is
 * safe; it does not answer whether this card is the agent that service belongs
 * to, which is the question that was never asked.
 *
 * Restart checks `isFleetSession` rather than `isAgentPane`. ⚠️ This line said
 * `isAgentSession` while the code below checked `isFleetSession` — the same fact
 * stated two ways in one file, with the docstring naming the STRICTER of the two.
 * A reader trusting it would believe restart requires a live Claude process,
 * which is the opposite of the point: the crashed agent is the case restart
 * exists for.
 */
function mayTypeInto(action, agent) {
  if (action === 'restart') {
    // ⚠️ `isFleetSession`, NOT `isAgentSession`. The difference is whether a
    // Claude process is currently running in the pane, and requiring one made
    // restart refuse a CRASHED agent — the single case the button is most
    // needed for — with the untrue sentence "we are not confident that card is
    // one of your agents".
    //
    // ⚠️ This is a gate, NOT a collision resolver, and it used to claim it was
    // both ("the `-discord` suffix test alone closes that"). It does not: once
    // `isFleetSession` grew a process arm, a stranger's session running Claude
    // passes this check. The collision is resolved upstream in `status.rank`,
    // which ranks every named-ours pane above an unnamed one so the impostor
    // never becomes the card in the first place. By the time an agent reaches
    // here it is already the winner of its name; this only asks whether that
    // winner is plausibly ours at all.
    if (!agent || !agent.isFleetSession) {
      return { ok: false, because: 'we are not confident that card is one of your agents, so we will not restart anything under its name' };
    }

    // ⚠️ Restart addresses the launchd SERVICE (`com.<name>.discord`), not the
    // pane on the card. Those are different objects, and only the suffixed
    // session name is evidence they are the same agent.
    //
    // The hole this closes, which the `rank` tie-break could not: when the real
    // agent is DEAD there is no competing pane to outrank. `mikey-discord` is
    // gone, someone has `tmux new -s mikey` with Claude in it, and that pane is
    // the ONLY candidate for the name — so it wins by default and every check
    // above passes. Restart would then run `restart-bot.sh mikey` against the
    // real service while the card shows a stranger's pane, state and task line.
    //
    // Refusing costs nothing real: an agent with no `com.<name>.discord` plist
    // cannot be restarted by this mechanism anyway, so the alternative is not
    // "it works" but "it fails after acting". This is not a re-coupling to
    // Discord — the roster, typing and every read stay decoupled. It is restart
    // alone, because restart alone reaches launchd, whose naming convention is
    // what it is.
    if (!agent.isNamedOurs) {
      return {
        ok: false,
        because: 'we found a session with this name, but not the one this agent\u2019s service runs in, so we will not restart the service under its name',
      };
    }
    return { ok: true };
  }
  if (!agent || !agent.isAgentPane) {
    return { ok: false, because: 'we are not confident that is a running agent, so we will not type into it' };
  }
  // ⚠️ An ALLOWLIST of states we can vouch for, NOT a denylist of `needs_you`.
  //
  // `classify` reports ONE state from a priority-ordered list, and it tests the
  // rate-limit markers BEFORE the question markers. So a pane genuinely showing
  // `Do you want to proceed? ❯ 1. Yes` classifies as `rate_limited` the moment
  // the same 25-line tail also contains "rate limit" — which a Bash call
  // grepping for that phrase is enough to do. Measured: that exact pane text
  // returned `rate_limited`, my denylist returned ok, and the Enter would have
  // confirmed the highlighted Yes. Two agents on this board are `rate_limited`
  // right now.
  //
  // `unknown` is refused for the reason this whole codebase exists: it is what
  // `classify` returns when it could not read the pane at all, so it is exactly
  // the case where we cannot see whether a prompt is on screen. The question
  // markers are a five-regex heuristic, and anything they miss lands here too.
  if (agent.state !== 'idle' && agent.state !== 'working') {
    return {
      ok: false,
      because: agent.state === 'needs_you'
        ? 'it is waiting on an answer from you right now, and a keystroke would answer that question instead. Deal with the question first'
        : 'we cannot see clearly enough what it is showing to be sure a keystroke would not answer something',
    };
  }
  return { ok: true };
}

/**
 * Should the agent's commitment record be forgotten after this?
 *
 * ⚠️ Pulled out as a decision rather than left inline at the call site, because
 * inline it could not be pinned by any test: it fires only on a REAL action,
 * and no test in this repo may clear or restart a live agent. A guard that
 * cannot be tested where it lives gets moved somewhere it can be.
 *
 * True only when something destructive ACTUALLY happened. Three deliberate
 * exclusions:
 *
 *   - `compact` summarises rather than empties, so what the agent is holding
 *     should survive it. It is the one action that does not invalidate the
 *     record.
 *   - A REFUSED action did nothing, so the record still describes reality.
 *   - A DRY RUN did nothing either, and destroying a real record while
 *     pretending to act would make the safety flag itself destructive.
 */
function invalidatesCommitments(action, result) {
  if (action === 'compact') return false;
  const outcome = result && result.outcome;
  if (outcome === OUTCOME.DONE || outcome === OUTCOME.ASKED) return true;

  // ⚠️ And a REFUSED that may still have landed. `sendCommand` returns REFUSED
  // when the text arrived and the Enter did not, which means the command is
  // sitting in the composer and the conversation may still be destroyed at the
  // end of the turn. `restart` already took this branch for the identical
  // we-may-have-done-it case; the reasoning was not carried across, so a
  // half-sent clear left the board asserting commitments that were about to
  // stop existing.
  //
  // Keyed on the flag, not on the wording of the message.
  return outcome === OUTCOME.REFUSED && result.mayHaveLanded === true;
}

module.exports = {
  ACTIONS, OUTCOME, RESTART_SCRIPT, setDryRun,
  // ⚠️ A GETTER, not the value. `DRY_RUN` was exported by value, so
  // `lifecycle.DRY_RUN` froze at module load and could never reflect
  // `setDryRun()` — a second copy of the fleet-wide safety flag that silently
  // disagreed with the real one. Harmless while only a test read it; wrong the
  // first time anything checks it before doing something destructive. Exactly
  // the one-fact-two-derivations shape this module's comments are written
  // against, in the module's own public surface.
  get DRY_RUN() { return DRY_RUN; },
  safeTarget, safeServiceName, sendCommand, restart, clear, compact, perform, setRunner,
  invalidatesCommitments, mayTypeInto,
};
