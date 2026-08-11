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
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const create = require('./create');
const status = require('./status');

const OUTCOME = { REMOVED: 'removed', REFUSED: 'refused', PARTIAL: 'partial' };

/* ── the runner seam ─────────────────────────────────────────────────────── */

/**
 * ⚠️ The same bidirectional interlock `create` uses, for a stronger reason.
 * A test that reaches the real machine here does not litter it — it KILLS a
 * live agent. `setDryRun(false)` refuses unless a runner is installed, and
 * clearing the runner re-arms dry-run, so neither ordering leaves a test able
 * to stop something real.
 */
/**
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
  } catch {
    // ⚠️ A non-zero exit is NOT a failure for every command here. `bootout` on a
    // job that is not loaded, and `kill-session` on a session that is already
    // gone, both exit non-zero and both mean "the thing you wanted is already
    // true". The step decides; this only reports.
    return { ok: false };
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
  let contents = [];
  try {
    contents = fs.readdirSync(folder);
  } catch { /* the folder may already be gone, which the plan simply reflects */ }

  return {
    ok: true,
    name: clean,
    steps: [
      'stop it running',
      'end its session',
      'remove its startup job, so it does not come back at your next login',
      alsoDeleteFolder ? `delete its folder and everything in it (${contents.length} file${contents.length === 1 ? '' : 's'})` : null,
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
  step('stopped its startup job', () => {
    const r = run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${create.serviceLabel(clean)}`]);
    // Not loaded is not a failure: the end state is what we wanted.
    return true;
  });

  step('ended its session', () => {
    // The `=` form, exactly: `kill-session -t sam` prefix-matches and will
    // happily end `samantha-discord`. Measured on this machine, by doing it.
    run(tmux, ['kill-session', '-t', `=${clean}`]);
    return true;
  });

  const removedJob = step('removed its startup job', () => {
    if (DRY_RUN && !runner) return true;
    fs.rmSync(create.plistPath(clean), { force: true });
    return !fs.existsSync(create.plistPath(clean));
  });

  let removedFolder = true;
  if (alsoDeleteFolder) {
    removedFolder = step('deleted its folder', () => {
      if (DRY_RUN && !runner) return true;
      fs.rmSync(create.workerDir(clean), { recursive: true, force: true });
      return !fs.existsSync(create.workerDir(clean));
    });
  }

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
  if (!removedFolder) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'it is removed and will not come back, but its folder could not be deleted. Nothing is running from it.',
      steps,
    };
  }

  return {
    outcome: OUTCOME.REMOVED,
    because: alsoDeleteFolder
      ? `${clean} is gone, along with its folder.`
      : `${clean} is gone. Its folder is still on your computer.`,
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
