'use strict';

/**
 * Removing an agent.
 *
 * ⚠️ The only DESTRUCTIVE thing this product does. Everything else makes
 * something, changes something, or reads something; this one ends an agent that
 * a person may have been talking to for weeks. So it is built around two rules
 * that the rest of the codebase states and this module has to enforce:
 *
 *   1. **We only remove what WE made.** The board shows every agent on the
 *      machine, including thirteen that this product did not create and whose
 *      launchd jobs belong to somebody else's tooling. A remove that can reach
 *      those is a worse defect than no remove at all, so the refusal is here in
 *      the engine and not only in the screen that calls it.
 *   2. **Nothing is destroyed that was not named first.** `plan()` says exactly
 *      what will happen, in the words the person will read, and `remove()` does
 *      that and nothing else. The screen shows the plan; the engine performs it.
 *
 * ⚠️ THE FOLDER IS KEPT BY DEFAULT, and that is a deliberate product decision
 * rather than caution for its own sake. It holds the agent's instruction file —
 * the thing the PERSON wrote, in their own words, which is the whole of what
 * made this agent theirs — and its log. "Remove this agent" does not imply "and
 * delete what I wrote", and getting that wrong is unrecoverable. Deleting it is
 * a separate, explicit choice, and `plan()` says what is inside so the choice is
 * informed rather than blind.
 */

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const create = require('./create');
// ⚠️ The platform's OWN records about this agent, which live nowhere near its
// folder: the avatar and the role label in `store`, and the commitment record in
// `commitments`. All keyed by name. Removal that ignored them meant a REUSED
// name inherited the dead agent's picture, its job title and its promises —
// and the commitment text can carry real work, so it is a privacy question as
// well as a correctness one.
const store = require('./store');
const commitments = require('./commitments');

const OUTCOME = { REMOVED: 'removed', REFUSED: 'refused', PARTIAL: 'partial' };

/* ── the runner seam ─────────────────────────────────────────────────────── */

/**
 * ⚠️ The same bidirectional interlock `create` uses, for a stronger reason: a
 * test that reaches the real machine here does not litter it, it KILLS a live
 * agent. `setDryRun(false)` refuses unless a runner is installed, and clearing
 * the runner re-arms dry-run, so neither ordering leaves a test able to stop
 * something real.
 *
 * ⚠️ SAME DEFAULT AS `create`, and defaulting it to `true` here was a real bug
 * that only a live run caught.
 *
 * It looked like the safer choice. What it actually did was make the SERVER
 * permanently inert: every filesystem step short-circuits on
 * `if (DRY_RUN && !runner) return true`, so a removal through the product
 * killed the session, reported REMOVED, returned the person to the board — and
 * left the launchd job and its plist exactly where they were, so the agent
 * would come back at the next login.
 *
 * A screen saying "gone" over an agent that is coming back is the precise
 * failure this module's own PARTIAL path exists to prevent, and the "safe"
 * default is what stopped that path from ever firing.
 *
 * The safety belongs in the TESTS, which arm dry-run at file load, not in the
 * module default. A default that makes the product do nothing while claiming
 * success is not a safe default.
 */
let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

function setRunner(fn) {
  runner = fn || null;
  if (!runner) DRY_RUN = true;
}
function setDryRun(on) {
  if (!on && !runner) {
    throw new Error('refusing to leave dry-run with no injected runner: this would stop real agents');
  }
  DRY_RUN = Boolean(on);
}

function run(file, args) {
  if (runner) return runner(file, args);
  if (DRY_RUN) return { ok: true, stdout: '', dryRun: true };
  try {
    return { ok: true, stdout: execFileSync(file, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    // ⚠️ THE EXIT CODE IS CARRIED, because "already gone" and "it failed" are
    // both non-zero here and mean opposite things. `bootout` answers 3 for a
    // job that is not loaded, and `kill-session` answers 1 for a session that
    // is not there — both of which mean the end state we wanted is already
    // true. Anything else is a real failure, and the caller must be able to
    // tell. Returning a bare `{ok:false}` threw that away, and the step above
    // then treated every outcome as success.
    return { ok: false, code: err && typeof err.status === 'number' ? err.status : null };
  }
}

/* ── what is actually there ──────────────────────────────────────────────── */

/**
 * Is this an agent THIS PRODUCT created, and may we act on it?
 *
 * ⚠️ The distinction that matters, and it is not "is it on the board". The
 * board shows every pane on the machine. An agent we created has a launchd job
 * we wrote, at a path we chose, under a label we own (`com.kosmos.agent.*`).
 * The fleet's own agents have jobs called `com.<name>.discord`, written by
 * somebody else's tooling and started by scripts we have never read.
 *
 * So OURS means: there is a plist at the path our own creation would have
 * written. Not the session name, not the claim — those say the board may
 * SPEAK for an agent, which is a different and weaker question than whether we
 * may END it.
 */
function isOurs(name) {
  const clean = create.cleanName(name);
  if (!clean || create.nameProblem(clean)) return false;
  return fs.existsSync(create.plistPath(clean));
}

/**
 * What removing this agent would do, in the words the person will read.
 *
 * Returned rather than printed, so the screen and the engine cannot disagree
 * about what is about to happen: the confirmation renders this, and `remove`
 * performs exactly these steps.
 */
function plan(name, { alsoDeleteFolder = false } = {}) {
  const clean = create.cleanName(name);
  const problem = create.nameProblem(clean);
  if (problem) return { ok: false, because: problem };
  if (!isOurs(clean)) {
    return {
      ok: false,
      // ⚠️ Says WHY, and the why is not "you may not". It is that this agent was
      // not made here, so this product does not know what stopping it would
      // break. A person seeing this for one of their own fleet agents needs to
      // understand it is out of scope, not forbidden.
      because: `${clean} was not created by this app, so it is not ours to remove. Whatever set it up is what can take it away.`,
    };
  }

  const folder = create.workerDir(clean);
  // ⚠️ Counted RECURSIVELY, because the delete is recursive. `readdirSync` on
  // its own reports a folder holding one subdirectory of five hundred files as
  // "1 item", under a plan whose stated purpose is to say what is actually
  // inside rather than "its files".
  let contents = [];
  try {
    contents = fs.readdirSync(folder, { recursive: true });
  } catch { /* the folder may already be gone, which the plan simply reflects */ }

  return {
    ok: true,
    name: clean,
    // ⚠️ EVERY destructive step, including the one nobody would think to ask
    // about. `remove()` also clears the picture, the job title and the
    // commitment record this app keeps under its own data directory — and the
    // commitment text can name real work, which the module's own comment calls
    // a privacy question. The confirmation renders THIS list and nothing else,
    // so a step missing from here is a thing destroyed without being announced.
    steps: [
      'stop it running',
      'end its session',
      'remove its startup job, so it does not come back at your next login',
      'forget its picture, its job title, and anything it said it was working on',
      alsoDeleteFolder
        ? `delete its folder and everything in it (${contents.length} item${contents.length === 1 ? '' : 's'})`
        : null,
    ].filter(Boolean),
    // What the person is about to lose if they tick the box, named specifically
    // rather than as "its files".
    folder,
    folderContents: contents,
    keepsFolder: !alsoDeleteFolder,
    // ⚠️ The sentence the confirmation leads with. It says what is permanent,
    // because that is the only part a person cannot undo by making another one.
    warning: alsoDeleteFolder
      ? 'This cannot be undone. Its instructions, the ones you wrote, are in that folder and will be deleted with it.'
      : 'This cannot be undone. Its folder stays on your computer, so what you wrote for it is kept.',
  };
}

/* ── doing it ────────────────────────────────────────────────────────────── */

function remove(name, { alsoDeleteFolder = false, tmuxBin } = {}) {
  const intent = plan(name, { alsoDeleteFolder });
  if (!intent.ok) return { outcome: OUTCOME.REFUSED, because: intent.because, steps: [] };

  const clean = intent.name;
  const tmux = tmuxBin || process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux';
  const steps = [];

  function step(label, fn) {
    try {
      const r = fn();
      steps.push({ label, ok: r !== false });
      return r !== false;
    } catch {
      steps.push({ label, ok: false });
      return false;
    }
  }

  /**
   * ⚠️ ORDER MATTERS, and it is the reverse of creation for a reason.
   *
   * The job first: while it is loaded, `KeepAlive` will restart the agent the
   * moment its session ends, so killing the session first just makes launchd
   * put it back — and the person watches the agent they removed reappear.
   */
  /**
   * ⚠️ THE RESULT IS READ, and discarding it was the worst defect in the first
   * version of this file.
   *
   * A `bootout` that genuinely failed was recorded as done, the session was
   * then killed — which `KeepAlive` instantly undoes, because the job is still
   * loaded — and the plist was deleted on top of it. That leaves the machine in
   * the one state `create` refuses to clean up: a loaded service with nothing
   * on disk explaining it, so the NAME IS PERMANENTLY UNUSABLE, while the person
   * is told the agent is gone and watches it come back.
   *
   * Exit 3 is launchd for "no such service", which is the end state we wanted.
   * Anything else is a failure and must reach the operator.
   */
  const stoppedJob = step('stopped its startup job', () => {
    const r = run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${create.serviceLabel(clean)}`]);
    if (r && r.ok !== false) return true;
    return r && r.code === 3;   // not loaded: already true
  });

  // ⚠️ Stop here rather than continuing. Killing the session next would have
  // KeepAlive restart it, and deleting the plist after that destroys the only
  // record of what is running.
  if (!stoppedJob) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we could not stop the job that starts it, so we have not gone any further. It is still running, and nothing has been removed. The README says how to remove one by hand.',
      steps,
    };
  }

  /**
   * ⚠️ THREE WORLDS, NOT TWO, and collapsing them was a defect that deleted
   * somebody's folder out from under a running agent.
   *
   * The first version asked "is this session ours?" and treated every `false`
   * the same: no session, a session that is not ours, and TMUX WE COULD NOT ASK
   * all meant "nothing to end", so the step recorded "ended its session", the
   * removal ran on to delete the folder, and the agent carried on running out
   * of a directory that no longer existed. Reachable without anything exotic —
   * tmux not at the path we expect, which is the Intel-Mac case the README
   * documents and which `create` preflights and refuses.
   *
   * So the question is asked in the right order, and "we could not ask" is its
   * own answer:
   *
   *   cannot ask tmux        → PARTIAL. Never REMOVED, never a folder delete.
   *   no session by that name → nothing to end. Proceed.
   *   session, claim is ours  → kill it, then LOOK AGAIN.
   *   session, not ours       → leave it alone; our files still go.
   *   session, cannot tell    → PARTIAL. Proving it is not ours is not the same
   *                             as failing to prove it is.
   */
  const present = run(tmux, ['has-session', '-t', `=${clean}`]);
  const sessionExists = Boolean(present && present.ok !== false);
  const cannotAsk = !sessionExists && !(present && present.code === 1);
  if (cannotAsk) {
    steps.push({ label: 'looked for its session', ok: false });
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we stopped its startup job, but could not ask tmux whether it is still running, so we have gone no further. Nothing else has been removed.',
      steps,
    };
  }

  let claim = null;
  if (sessionExists) {
    const asked = run(tmux, ['show-options', '-t', clean, '-v', '@kosmos_agent']);
    if (!asked || asked.ok === false) {
      steps.push({ label: 'checked whose session it is', ok: false });
      return {
        outcome: OUTCOME.PARTIAL,
        because: `we stopped its startup job, but something is still running as ${clean} and we could not check whether it is the agent we made. We have not touched it, and nothing else has been removed.`,
        steps,
      };
    }
    claim = String(asked.stdout || '').trim();
  }

  const endedSession = step('ended its session', () => {
    // Nothing running under that name: the end state we wanted is already true.
    if (!sessionExists) return true;
    /**
     * ⚠️ Somebody else's. Owning the plist is a fact about DISK — it says this
     * product made an agent by this name, not that the session holding the name
     * right now is that agent. Ours can die and something else can take it.
     * `bin/agent-supervisor.sh` already refuses to touch a session it cannot tie
     * to `@kosmos_agent`; removal must not hold a lower bar than the product's
     * own startup script.
     */
    if (claim !== clean) return true;

    const r = run(tmux, ['kill-session', '-t', `=${clean}`]);
    if (!(r && (r.ok !== false || r.code === 1))) return false;
    // ⚠️ LOOK AGAIN, because the launchd half is verified with `print` and this
    // half was asserted from a command whose answer was never re-read.
    const still = run(tmux, ['has-session', '-t', `=${clean}`]);
    return Boolean(still && still.ok === false && still.code === 1);
  });

  // ⚠️ STOP if it is still running. Continuing deletes the working directory out
  // from under a live agent, returns the person to a board that still shows it,
  // and leaves a name that can be neither removed (no plist) nor recreated (the
  // session still holds it).
  if (!endedSession) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we stopped its startup job, but could not end the session it is running in, so it is still going. Nothing else has been removed.',
      steps,
    };
  }

  const removedJob = step('removed its startup job', () => {
    if (DRY_RUN && !runner) return true;
    fs.rmSync(create.plistPath(clean), { force: true });
    return !fs.existsSync(create.plistPath(clean));
  });



  /**
   * ⚠️ The job is what makes a removal STICK. If the plist is still there the
   * agent returns at the next login, so a screen saying "removed" over a
   * surviving plist is the same lie as a board reporting a healthy agent it
   * cannot see. Everything else failing is recoverable by hand; this is not.
   */
  if (!removedJob) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we stopped it, but could not remove the job that starts it, so it will come back when you next log in. The README says how to remove it by hand.',
      steps,
    };
  }

  /**
   * ⚠️ THE IRREVERSIBLE STEP GOES LAST, AFTER EVERYTHING RECOVERABLE HAS
   * SUCCEEDED.
   *
   * It used to run before the check above, so a failed plist removal deleted
   * the person's instructions anyway — and then told them the agent "will come
   * back when you next log in", which was worse than it sounded: it would
   * respawn every thirty seconds forever against a working directory that no
   * longer existed. Deleting what somebody wrote during a run that FAILED is
   * the one mistake here with nothing behind it.
   */
  /**
   * ⚠️ WHAT THE PLATFORM ITSELF STORED, which the folder checkbox does not
   * cover and a person would never think to ask about.
   *
   * The avatar, the role label and the commitment record are kept under the
   * app's own data directory, keyed by name. Leaving them meant that making a
   * new agent with the same name later produced one wearing the dead agent's
   * face, carrying its job title, and holding its promises. Always removed —
   * there is no version of "remove this agent" where keeping its photograph is
   * what somebody meant.
   */
  const clearedRecords = step('cleared what the app remembered about it', () => {
    if (DRY_RUN && !runner) return true;
    let ok = true;
    try { store.removeAvatar(clean); } catch { ok = false; }
    try { fs.rmSync(store.profilePath(clean), { force: true }); } catch { ok = false; }
    try { fs.rmSync(commitments.recordPath(clean), { force: true }); } catch { ok = false; }
    return ok;
  });

  let removedFolder = true;
  if (alsoDeleteFolder) {
    removedFolder = step('deleted its folder', () => {
      if (DRY_RUN && !runner) return true;
      fs.rmSync(create.workerDir(clean), { recursive: true, force: true });
      return !fs.existsSync(create.workerDir(clean));
    });
  }
  if (!removedFolder) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'it is removed and will not come back, but its folder could not be deleted. Nothing is running from it.',
      steps,
    };
  }

  /**
   * ⚠️ LOOK, rather than assume. Creating an agent watches the board until it
   * can see it before saying it is running; removing one was claiming an
   * outcome from three commands whose answers it had not read. The same rule
   * applies in both directions, and this is the direction where being wrong
   * means the agent comes back.
   */
  const stillLoaded = (() => {
    try {
      const r = run('/bin/launchctl', ['print', `gui/${process.getuid()}/${create.serviceLabel(clean)}`]);
      return Boolean(r && r.ok !== false && String(r.stdout || '').trim());
    } catch {
      // Unreachable on the real path: `run()` catches the throw and answers
      // `{ok:false}`, which the test above already reads as "not loaded". Kept
      // so an injected runner that throws cannot take the process down.
      return false;
    }
  })();
  if (stillLoaded) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `we removed its files, but ${clean} is still registered as a startup job. It may come back, and the name cannot be used again until that job is cleared: run "launchctl bootout gui/$UID/com.kosmos.agent.${clean}" in a terminal.`,
      steps,
    };
  }

  // ⚠️ A failed clear does not block the removal — the agent IS gone — but it is
  // not silent either. What survives is a picture, a job title and a commitment
  // record that can name real work, and a person who reuses the name would meet
  // them again without knowing why.
  if (!clearedRecords) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `${clean} is gone, but we could not clear everything this app remembered about it. If you make another agent with that name, it may pick up the old picture or job title.`,
      steps,
    };
  }

  return {
    outcome: OUTCOME.REMOVED,
    // ⚠️ Says what keeping the folder COSTS. Creation refuses a name whose
    // worker folder exists, so the recommended path quietly burns the name —
    // and the only way to reuse it is a terminal, in a product whose whole
    // pitch is that you never need one. Better said here than discovered later.
    because: alsoDeleteFolder
      ? `${clean} is gone, along with its folder.`
      : `${clean} is gone. Its folder is still on your computer, so you cannot make another agent called ${clean} until you remove it.`,
    steps,
  };
}

module.exports = {
  plan,
  remove,
  isOurs,
  setRunner,
  setDryRun,
  OUTCOME,
  get DRY_RUN() { return DRY_RUN; },
};
