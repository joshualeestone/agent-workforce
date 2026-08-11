'use strict';

/**
 * Removing an agent from Kosmos, and putting it back.
 *
 * ⚠️ REMOVE IS NOT DELETE, and the whole shape of this module follows from
 * that. Removing means: stop it, do not let it come back, and take it off the
 * board. **Nothing on disk is deleted, ever.** The agent's folder, the
 * instructions somebody wrote for it, its log — all untouched. Delete is a
 * different feature and does not exist yet.
 *
 * That makes removal REVERSIBLE, which changes what the screen has to say: no
 * "this cannot be undone", no list of consequences to weigh. The person is
 * deciding whether to see this agent in Kosmos, not whether to destroy it.
 *
 * ⚠️ AND IT WORKS ON EVERY AGENT ON THE BOARD, including ones another tool
 * created. An earlier version refused those because we had not made them. That
 * is wrong for this product: Kosmos manages a fleet, and a fleet agent it
 * cannot manage is a hole rather than a safeguard. What it does not do is
 * destroy anything of theirs — it stops them, and it can start them again.
 *
 * ⚠️ Which puts the weight on RESTORE actually reversing. Removing an agent
 * another tool created disables a launchd job we did not write, so "reversible
 * by design" is only true if the implementation reverses: the exact label is
 * recorded at removal, and restoring re-enables that label and bootstraps that
 * plist. A remove that cannot cleanly restore is a broken agent, not a
 * reversible one.
 *
 * The mechanism is launchd's own, which is why nothing has to be moved or
 * deleted to make a removal stick:
 *
 *   `bootout`  stops it now, for this login session.
 *   `disable`  keeps it from starting at the next one. Persisted by launchd,
 *              reversed by `enable`, and it touches no files at all.
 *
 * Measured on this machine: `disable` works on a label that is not currently
 * loaded, `print-disabled` reflects it, and `enable` flips it back.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const create = require('./create');
const status = require('./status');

const OUTCOME = { REMOVED: 'removed', RESTORED: 'restored', REFUSED: 'refused', PARTIAL: 'partial' };

const HOME = os.homedir();
const SUPPORT_DIR = process.env.AGENT_WORKFORCE_DATA
  ? path.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce')
  : path.join(HOME, 'Library', 'Application Support', 'AgentWorkforce');
const REMOVED_FILE = path.join(SUPPORT_DIR, 'removed.json');

/* ── the runner seam ─────────────────────────────────────────────────────── */

/**
 * ⚠️ The same bidirectional interlock `create` uses, for a stronger reason: a
 * test that reaches the real machine here does not litter it, it STOPS a live
 * agent — and on this machine that includes the ones the operator is talking
 * to. `setDryRun(false)` refuses unless a runner is installed, and clearing the
 * runner re-arms dry-run.
 *
 * ⚠️ The DEFAULT is not dry-run, matching `create`. Defaulting it on made the
 * server silently do nothing while reporting success, which is not a safe
 * default but an invisible one. The safety belongs in the tests, which arm it
 * at file load.
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
    // ⚠️ THE EXIT CODE IS CARRIED. "Already gone" and "it failed" are both
    // non-zero here and mean opposite things: `bootout` answers 3 for a job that
    // is not loaded, `kill-session` answers 1 for a session that is not there.
    // A bare failure threw that away, and the caller then treated every outcome
    // as success.
    return { ok: false, code: err && typeof err.status === 'number' ? err.status : null };
  }
}

/* ── the record of what has been removed ─────────────────────────────────── */

/**
 * ⚠️ Kosmos's OWN list, because removal is a fact about Kosmos rather than
 * about the machine. The agent's files are still there and its launchd job is
 * still on disk; what changed is that we stopped it and no longer show it. That
 * state has to live somewhere we control, and it has to carry enough to put the
 * agent back exactly.
 */
function readRemoved() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REMOVED_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.name === 'string') : [];
  } catch {
    // No file, or one we cannot read. Either way the honest answer is that we
    // are not hiding anything: a removed list we cannot read must not become a
    // board that hides agents for reasons nobody can inspect.
    return [];
  }
}

function writeRemoved(list) {
  fs.mkdirSync(path.dirname(REMOVED_FILE), { recursive: true });
  // Written beside and renamed: this file decides what the board shows, and a
  // half-written one read as "nothing is removed" would put every stopped agent
  // back on screen.
  const tmp = `${REMOVED_FILE}.${process.pid}.new`;
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, REMOVED_FILE);
}

/** Is this agent currently removed from Kosmos? */
function isRemoved(name) {
  const clean = create.cleanName(name);
  return readRemoved().some((r) => r.name === clean);
}

/** The removed agents, newest first, for the "show removed" list. */
function removedAgents() {
  return readRemoved().slice()
    .sort((a, b) => String(b.removedAt || '').localeCompare(String(a.removedAt || '')));
}

/* ── finding the job that starts an agent ────────────────────────────────── */

/**
 * The launchd label that starts this agent, whoever created it.
 *
 * ⚠️ TWO CONVENTIONS, because the board shows agents from both worlds: ours are
 * `com.kosmos.agent.<name>`, and the fleet's own are `com.<name>.discord`. We
 * look for a plist that exists rather than guessing a label, so an agent with
 * neither is reported as having no job rather than as having one we then fail
 * to stop.
 */
function jobFor(name) {
  const clean = create.cleanName(name);
  const candidates = [
    { label: create.serviceLabel(clean), plist: create.plistPath(clean), ours: true },
    {
      label: `com.${clean}.discord`,
      plist: path.join(path.dirname(create.plistPath(clean)), `com.${clean}.discord.plist`),
      ours: false,
    },
  ];
  return candidates.find((c) => {
    try { return fs.existsSync(c.plist); } catch { return false; }
  }) || null;
}

/**
 * The tmux session this agent is actually running in, as the BOARD identifies
 * it. `null` means nothing of this agent's is running; `undefined` means we
 * could not ask.
 *
 * ⚠️ Asked of the roster rather than re-derived. The board already owns "which
 * pane is which agent" — the claim for agents we create, the `-discord` suffix
 * for the fleet's. A second definition here is how the two would come to
 * disagree about which session to end, and this is the half that ends things.
 */
function sessionFor(name) {
  const clean = create.cleanName(name);
  try {
    const card = status.paneRoster().find((p) => p.sessionName === clean);
    if (!card) return null;
    return card.isNamedOurs ? (card.session || clean) : null;
  } catch {
    // ⚠️ Cannot ask tmux. That is NOT "nothing is running" — it is an unknown,
    // and the caller must treat it as one rather than proceeding as if the
    // agent were already stopped.
    return undefined;
  }
}

/* ── what removing would do ──────────────────────────────────────────────── */

/**
 * The confirmation's content.
 *
 * ⚠️ Deliberately NOT a list of consequences. An earlier version enumerated the
 * job, the session and the startup entry, and Josh was right that every line of
 * it describes our implementation rather than their decision. The person is
 * choosing whether to see this agent in Kosmos. The one thing they might fear —
 * that their files are going — is answered, and nothing else is said.
 *
 * ⚠️ The question NAMES the agent. On a machine whose board includes the agents
 * the operator is talking to, an unnamed "are you sure?" is the same dialog for
 * a demo and for their project manager.
 */
function plan(name) {
  const clean = create.cleanName(name);
  const problem = create.nameProblem(clean);
  if (problem) return { ok: false, because: problem };
  if (isRemoved(clean)) {
    return { ok: false, because: `${clean} has already been removed from Kosmos.` };
  }
  return {
    ok: true,
    name: clean,
    question: `Are you sure you want to remove ${clean} from Kosmos?`,
    reassurance: "The agent's folder and the contents you wrote for it will not be deleted.",
  };
}

/* ── doing it ────────────────────────────────────────────────────────────── */

function remove(name, { tmuxBin } = {}) {
  const intent = plan(name);
  if (!intent.ok) return { outcome: OUTCOME.REFUSED, because: intent.because, steps: [] };

  const clean = intent.name;
  const tmux = tmuxBin || process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux';
  const steps = [];
  const job = jobFor(clean);

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
   * ⚠️ THE JOB FIRST, AND `disable` BEFORE `bootout`.
   *
   * While the job is loaded, `KeepAlive` restarts the agent the moment its
   * session ends — so ending the session first only makes launchd put it back,
   * and the person watches the agent they removed reappear.
   *
   * And disable before bootout, because between the two there is a window where
   * the job is unloaded but still enabled, and a login in that window brings it
   * back. Disabling first closes it.
   */
  if (job) {
    const stopped = step('stopped it starting again', () => {
      const off = run('/bin/launchctl', ['disable', `gui/${process.getuid()}/${job.label}`]);
      if (!(off && off.ok !== false)) return false;
      const out = run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${job.label}`]);
      // 3 is launchd for "no such service", which is the end state we wanted.
      return Boolean(out && (out.ok !== false || out.code === 3));
    });
    if (!stopped) {
      return {
        outcome: OUTCOME.PARTIAL,
        because: `we could not stop ${clean} from starting again, so we have left it alone. Nothing has changed.`,
        steps,
      };
    }
  } else {
    steps.push({ label: 'stopped it starting again', ok: true, note: 'it had no startup job' });
  }

  /**
   * ⚠️ Three worlds, not two: "nothing running", "a session we cannot tie to
   * this agent", and "we could not ask tmux at all". Collapsing the third into
   * the first is how a removal reports success over an agent that is still
   * going.
   */
  const session = sessionFor(clean);
  if (session === undefined) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `we stopped ${clean} from starting again, but could not ask tmux whether it is still running, so it may still be going.`,
      steps,
    };
  }
  if (session !== null) {
    const ended = step('ended its session', () => {
      const r = run(tmux, ['kill-session', '-t', `=${session}`]);
      if (!(r && (r.ok !== false || r.code === 1))) return false;
      // ⚠️ Look again. The kill's own answer is not evidence the session has
      // gone, and this is the check that stops a removal being reported over a
      // live agent.
      const still = run(tmux, ['has-session', '-t', `=${session}`]);
      return Boolean(still && still.ok === false && still.code === 1);
    });
    if (!ended) {
      return {
        outcome: OUTCOME.PARTIAL,
        because: `we stopped ${clean} from starting again, but could not end the session it is running in, so it is still going.`,
        steps,
      };
    }
  } else {
    steps.push({ label: 'ended its session', ok: true, note: 'it was not running' });
  }

  // Only now is it true that this agent is stopped and will stay stopped.
  const recorded = step('took it off the board', () => {
    if (DRY_RUN && !runner) return true;
    const list = readRemoved().filter((r) => r.name !== clean);
    list.push({
      name: clean,
      removedAt: new Date().toISOString(),
      // ⚠️ What RESTORE needs, captured at removal rather than re-derived later.
      // By then the plist may be gone, or a different one may have taken its
      // place, and restoring the wrong job is worse than not restoring at all.
      label: job ? job.label : null,
      plist: job ? job.plist : null,
      ours: job ? job.ours : null,
    });
    writeRemoved(list);
    return isRemoved(clean);
  });
  if (!recorded) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `${clean} has been stopped, but we could not record it as removed, so it will still appear on the board.`,
      steps,
    };
  }

  return {
    outcome: OUTCOME.REMOVED,
    because: `${clean} has been removed from Kosmos. Its folder and everything in it is still on your computer.`,
    steps,
  };
}

/* ── putting it back ─────────────────────────────────────────────────────── */

function restore(name) {
  const clean = create.cleanName(name);
  const record = readRemoved().find((r) => r.name === clean);
  if (!record) {
    return { outcome: OUTCOME.REFUSED, because: `${clean} is not on the removed list.`, steps: [] };
  }

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

  let started = true;
  if (record.label) {
    started = step('let it start again', () => {
      const on = run('/bin/launchctl', ['enable', `gui/${process.getuid()}/${record.label}`]);
      if (!(on && on.ok !== false)) return false;
      /**
       * ⚠️ Only bootstrap a plist that is still there. Somebody may have
       * removed it by hand while the agent was off the board, and bootstrapping
       * a file that is gone fails in a way worth reporting rather than hiding —
       * the enable still stands, so a later start by their own tooling works.
       */
      if (!record.plist || !fs.existsSync(record.plist)) return true;
      const up = run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, record.plist]);
      // 5 is launchd for "already loaded", which is the end state we wanted.
      return Boolean(up && (up.ok !== false || up.code === 5));
    });
  }

  // ⚠️ Taken off the list even when the start failed. The record's purpose is
  // "Kosmos is hiding this"; leaving it there would hide an agent that is back,
  // and the PARTIAL below says plainly that it may need starting by hand.
  const forgotten = step('put it back on the board', () => {
    if (DRY_RUN && !runner) return true;
    writeRemoved(readRemoved().filter((r) => r.name !== clean));
    return !isRemoved(clean);
  });

  if (!forgotten) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `we started ${clean} again, but could not take it off the removed list, so it may still be hidden.`,
      steps,
    };
  }
  if (!started) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `${clean} is back on the board, but we could not start it again. It may need starting by hand.`,
      steps,
    };
  }

  return { outcome: OUTCOME.RESTORED, because: `${clean} is back.`, steps };
}

module.exports = {
  plan,
  remove,
  restore,
  isRemoved,
  removedAgents,
  jobFor,
  setRunner,
  setDryRun,
  OUTCOME,
  REMOVED_FILE,
  get DRY_RUN() { return DRY_RUN; },
};
