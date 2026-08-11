'use strict';

/**
 * Creating an agent.
 *
 * ⚠️ This is the most powerful thing this codebase does. Restart and clear act
 * on something that already exists; this MAKES things — a directory, a file an
 * agent boots from, a tmux session, and a launchd job that will start it again
 * on every reboot until someone removes it.
 *
 * So it is built like the destructive routes rather than like a form handler:
 *
 *   - **A name is validated once, hard, and early.** It has to be exactly its
 *     own sanitised form AND start alphanumeric — the two rules the rest of the
 *     system already enforces separately, which have disagreed before.
 *   - **Every command is `execFile` with an argument array**, never a shell
 *     string. A name reaches launchd as one argument, never as text a shell
 *     could reinterpret.
 *     ⚠️ This used to read "no shell, ever", and that sentence stopped being
 *     true the moment the agent needed a supervising startup script — which it
 *     does, because `tmux new-session -d` exits immediately and launchd would
 *     otherwise respawn the job forever. So there IS generated shell text now,
 *     in exactly one place (`launcherFor`), and the safety there is the name
 *     validator rather than the absence of a shell. Leaving the old sentence
 *     standing would have been the more dangerous half of the change.
 *   - **A runner seam with a bidirectional interlock**: leaving dry-run throws
 *     unless a runner is already injected, and clearing the runner re-arms
 *     dry-run, so neither ordering leaves a test able to spawn real agents.
 *     ⚠️ This used to say "dry-run by default", and that was FALSE: the flag
 *     starts at `AGENT_WORKFORCE_DRY_RUN === '1'`, which is false unless
 *     somebody sets it, so a fresh process with no runner installed executes
 *     for real. The server relies on exactly that. What actually holds the
 *     tests off the machine is the test file arming dry-run at load, which it
 *     now does explicitly rather than by inheriting a guarantee that was only
 *     written down. A safety comment claiming more than the code does is worse
 *     than none — it is what stops the next reader checking.
 *   - **Nothing is claimed that was not verified.** "Created" is a claim about
 *     us; "it answered" is a claim about the agent, and only the second means
 *     the person has an agent.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const roles = require('./roles');
// ⚠️ The ROSTER, from the module that defines what an agent name is. A second
// reading of tmux here would be a second definition of "who is already
// running", and this codebase's worst defects have all been two definitions of
// one fact. `status` does not require this module, so there is no cycle, and
// its `setPaneSource` seam is what keeps these tests off the real machine.
const status = require('./status');

const HOME = os.homedir();
const WORKERS_DIR = process.env.AGENT_WORKFORCE_WORKERS || path.join(HOME, 'work', 'workers');
const AGENTS_DIR = process.env.AGENT_WORKFORCE_LAUNCH || path.join(HOME, 'Library', 'LaunchAgents');

const OUTCOME = { CREATED: 'created', REFUSED: 'refused', PARTIAL: 'partial' };

/* ── the runner seam ─────────────────────────────────────────────────────── */

let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

/**
 * ⚠️ A BIDIRECTIONAL interlock. `setDryRun(false)` refuses unless a runner is
 * installed, and `setRunner(null)` re-arms dry-run — so neither ordering can
 * leave a test able to spawn a real tmux session. A one-directional invariant
 * would depend on every test's `finally` running in the right order.
 *
 * (Earlier comments here cited `engine/lifecycle.js` as the precedent. That
 * module is on another branch and does not exist beside this one, so a reader
 * sent to it could not check the invariant being claimed — the same
 * cross-branch reference that put a call to a nonexistent function in this
 * file's own route once already.)
 */
function setRunner(fn) {
  runner = fn || null;
  if (!runner) DRY_RUN = true;
}
function setDryRun(on) {
  if (!on && !runner) {
    throw new Error('refusing to leave dry-run with no injected runner: this would create real agents');
  }
  DRY_RUN = Boolean(on);
}

function run(file, args) {
  if (runner) return runner(file, args);
  if (DRY_RUN) return { ok: true, stdout: '', dryRun: true };
  return { ok: true, stdout: execFileSync(file, args, { encoding: 'utf8', timeout: 20000 }) };
}

/* ── names ───────────────────────────────────────────────────────────────── */

/**
 * Is this a name we can build an agent out of?
 *
 * ⚠️ ONE function, because the rules it combines have already disagreed with
 * each other elsewhere in this codebase and the disagreement was the worst
 * defect found on the previous branch. A name has to survive:
 *
 *   - `safeKey` unchanged — the routes resolve by exact name, and a name that
 *     sanitises to something else means two names can become one.
 *   - an alphanumeric first character — `safeServiceName` and `safeTarget` both
 *     require it, so a leading `_` produces a directory we can make and a
 *     service we cannot.
 *   - a length a human will actually see, and a shape a person can type.
 */
const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * The name we will actually use, from whatever was typed.
 *
 * ⚠️ ONE trim, in one place, EXPORTED. `nameProblem` trimmed its input and
 * `createAgent` trimmed again independently, so the two agreed only by
 * coincidence: `nameProblem(' ab')` answered "that is fine" about a string
 * nobody would ever use, and any third caller that validated a raw value and
 * then used it unchanged would have carried a leading space into a directory
 * name and into the startup script. Found by a property test asking what the
 * validator actually accepts rather than what I remembered it accepting.
 *
 * So: validate the cleaned name, use the cleaned name, and let a caller ask for
 * it rather than re-deriving it.
 */
function cleanName(raw) {
  return String(raw == null ? '' : raw).trim();
}

function nameProblem(raw) {
  const name = cleanName(raw);
  if (!name) return 'give the agent a name';
  if (name.toLowerCase() !== name) return 'use lower case, so the name is the same everywhere it appears';
  if (!NAME_RE.test(name)) {
    return 'use letters, numbers, hyphens and underscores, starting with a letter or number';
  }
  return null;
}

/* ── paths, derived once ─────────────────────────────────────────────────── */

function workerDir(name) { return path.join(WORKERS_DIR, name); }
function instructionFile(name) { return path.join(workerDir(name), 'CLAUDE.md'); }
function launcherFile(name) { return path.join(workerDir(name), 'start.sh'); }
function logFile(name) { return path.join(workerDir(name), 'start.log'); }
function serviceLabel(name) { return `com.kosmos.agent.${name}`; }
function plistPath(name) { return path.join(AGENTS_DIR, `${serviceLabel(name)}.plist`); }

/**
 * The script that actually starts the agent, and keeps starting it.
 *
 * ⚠️ The job CANNOT be `tmux new-session` directly, and the version that was
 * is the reason this exists. `new-session -d` daemonises and exits immediately,
 * so launchd sees the job finish, `KeepAlive` restarts it, and the restart
 * fails because the session it just made already exists — a respawn loop that
 * runs for as long as the machine is on, while the agent looks perfectly
 * healthy because the FIRST attempt worked. Invisible, permanent, and shipped
 * on every agent.
 *
 * So the job runs a script that supervises instead: it clears any session of
 * that name, starts a new one, and then STAYS ALIVE while the session does.
 * This is the pattern the thirteen agents on this machine already run under,
 * and its own comment says why: "keeps launchd happy".
 *
 * ⚠️ AND IT SETS THE CLAIM ITSELF. The claim is a tmux user option, so it dies
 * with the session — which is exactly why it is trustworthy, and exactly why
 * setting it once at creation is not enough. After a reboot launchd starts the
 * agent afresh, and without this line the session comes back unclaimed: the
 * board stops recognising an agent it created, shows it anonymous with no role,
 * no model and no editable instructions, and the whole blocker this branch
 * exists to remove comes back on the first restart.
 *
 * ⚠️ This is still KOSMOS writing the claim, not the agent. The distinction
 * that matters is that nothing an agent does to itself can claim a name: this
 * file is written by the creation, run by the job the creation installed, and
 * lives beside the agent's instructions where a person can read it.
 *
 * ⚠️ The name is interpolated into shell text here, which is the one place this
 * module does that, so it is worth stating why it is safe: `nameProblem`
 * refuses anything outside `^[a-z0-9][a-z0-9_-]{1,31}$` long before this is
 * called, and that set contains no quote, no space and no shell metacharacter.
 * The single quotes are belt and braces on top of a validator that has already
 * made them unnecessary.
 */
function launcherFor(name, claudeBin, tmuxBin) {
  const dir = workerDir(name);
  return `#!/bin/bash
# Starts ${name}, and keeps launchd from restarting it in a loop.
#
# Written by Kosmos when this agent was created. It is a real file: you can
# read it, and you can change it. It runs at every login and whenever the
# agent's session ends.

SESSION='${name}'
TMUX='${tmuxBin}'
CLAUDE='${claudeBin}'
WORKDIR='${dir}'

# ⚠️ Only ever clear a session that is OURS.
#
# This ran unconditionally, and it runs at every login and after every crash —
# so a person who happened to have a tmux session of this name would have had it
# destroyed with no warning, by a job installed weeks earlier. The board refuses
# to act on any pane it cannot tie to a name; a script that kills one is the
# same rule broken from the outside.
#
# The claim is the tie. If something else holds the name we WAIT rather than
# exit: exiting would have launchd restart us every 30 seconds, and waiting
# recovers on its own the moment that session ends.
warned=0
while "$TMUX" has-session -t "$SESSION" 2>/dev/null; do
  if [ "$("$TMUX" show-options -t "$SESSION" -v @kosmos_agent 2>/dev/null)" = "$SESSION" ]; then
    "$TMUX" kill-session -t "$SESSION" 2>/dev/null
    break
  fi
  if [ "$warned" -eq 0 ]; then
    echo "$(date): a session called $SESSION is already running and is not ours -- waiting rather than killing it" >&2
    warned=1
  fi
  sleep 30
done

# --dangerously-skip-permissions is not optional for an unattended agent.
# Without it the agent starts, looks healthy, and freezes forever on its first
# permission prompt with nobody there to answer it.
"$TMUX" new-session -d -s "$SESSION" -c "$WORKDIR" \\
  "$CLAUDE" --dangerously-skip-permissions

# The claim. Without it this agent is anonymous on the board after every
# restart, whatever it was when it was created.
"$TMUX" set-option -t "$SESSION" @kosmos_agent "$SESSION"

# Stay alive while the session does, so launchd supervises the AGENT rather
# than a command that exits in a tenth of a second.
while "$TMUX" has-session -t "$SESSION" 2>/dev/null; do
  sleep 10
done
`;
}

/**
 * The launchd job.
 *
 * ⚠️ `PATH` **and `LANG`**, and neither is optional. launchd's default PATH
 * omits Homebrew, so tmux is simply not found — the board then serves happily
 * with zero agents. And without a UTF-8 locale, tmux SANITISES its own format
 * output, replacing the tab separators with underscores, so every agent parses
 * as one garbage field. Both were found the hard way on this machine on
 * 2026-08-10; see issue #23.
 *
 * ⚠️ `HOME` too. A launchd job does not reliably carry one, and Claude keeps
 * everything it knows under `~/.claude` — without it the agent starts as
 * somebody with no history.
 *
 * ⚠️ And somewhere to SEE a failure. A job that cannot start writes its reason
 * to a log or to nowhere, and "to nowhere" is how the board spent fourteen
 * hours reporting zero agents this morning.
 */
function plistFor(name, claudeBin, tmuxBin) {
  const label = serviceLabel(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${launcherFile(name)}</string>
  </array>
  <key>WorkingDirectory</key><string>${workerDir(name)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${HOME}</string>
    <key>PATH</key><string>${path.dirname(claudeBin)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${logFile(name)}</string>
  <key>StandardErrorPath</key><string>${logFile(name)}</string>
</dict>
</plist>
`;
}

/* ── the steps ───────────────────────────────────────────────────────────── */

/**
 * Make an agent, and report honestly about how far it got.
 *
 * Returns `{ outcome, because, steps }`. `steps` records each thing attempted
 * and whether it worked, because a half-made agent is a real state and the
 * operator has to be able to see which half.
 */
function createAgent(opts) {
  const name = cleanName(opts && opts.name);
  const roleKey = String((opts && opts.role) || '').trim();
  const claudeBin = (opts && opts.claudeBin) || path.join(HOME, '.local', 'bin', 'claude');
  const tmuxBin = (opts && opts.tmuxBin) || '/opt/homebrew/bin/tmux';

  const steps = [];
  const problem = nameProblem(name);
  if (problem) return { outcome: OUTCOME.REFUSED, because: problem, steps };

  const role = roles.byKey(roleKey);
  if (!role) {
    return { outcome: OUTCOME.REFUSED, because: 'pick what this agent is for', steps };
  }
  if (fs.existsSync(workerDir(name))) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `there is already an agent called ${name}`,
      steps,
    };
  }

  /* ⚠️ AND a name nobody has a FOLDER for can still be taken, because the board
   * identifies an agent by its session name with `-discord` STRIPPED. So
   * creating `casey` beside a running `casey-discord` makes two sessions with
   * one name — the exact collision `onePanePerSession` exists to survive, which
   * we would be manufacturing rather than tolerating. Measured on this machine:
   * the creation screen watched for a session called `casey`, found the fleet's
   * existing one, and reported "casey is running" over a creation that had done
   * nothing at all. The screen's verification cannot tell the agent it just made
   * from one that was already there, so the name has to be free BEFORE we start.
   *
   * ⚠️ And it FAILS CLOSED. If tmux cannot be asked who is already running, we
   * do not know the name is free, and "we could not check" is not "it is
   * available" — the whole rule this codebase runs on. Creating blind is what
   * produces the collision, so being unable to check has to stop the creation
   * rather than wave it through. The board's own gates refuse the same way when
   * tmux is unreachable.
   */
  let roster;
  try {
    roster = status.paneRoster();
  } catch {
    return {
      outcome: OUTCOME.REFUSED,
      because: 'we could not check which agents are already running, so we will not risk making a second one with the same name',
      steps,
    };
  }
  if (roster.some((p) => p.sessionName === name)) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `there is already an agent called ${name}`,
      steps,
    };
  }

  /**
   * ⚠️ The two programs this agent is made of have to EXIST.
   *
   * Both defaults are this machine's paths. On a Mac with an npm-global Claude,
   * or an Intel Mac where Homebrew lives at `/usr/local`, creation reported
   * CREATED, the screen waited thirty seconds and then said it did not know
   * why, and launchd was left respawning an instantly-failing job every thirty
   * seconds for as long as the machine was on. Refusing up front costs two
   * lines and names the actual problem.
   *
   * ⚠️ And they are checked for SHAPE, not only presence. They are interpolated
   * into the startup script the same way the name is, and unlike the name they
   * have never been through `nameProblem`. Not reachable from the HTTP route
   * today — the route passes neither — so this is closing a door before someone
   * opens it, which is cheaper than the alternative.
   */
  for (const [what, bin] of [['Claude', claudeBin], ['tmux', tmuxBin]]) {
    if (/['"\n\r\\$`]/.test(bin)) {
      return { outcome: OUTCOME.REFUSED, because: `we cannot use that path for ${what}`, steps };
    }
    if (!fs.existsSync(bin)) {
      return {
        outcome: OUTCOME.REFUSED,
        because: `we could not find ${what} on this computer, so an agent made now would never start`,
        steps,
      };
    }
  }

  function step(label, fn) {
    try {
      const r = fn();
      steps.push({ label, ok: r !== false });
      return r !== false;
    } catch (err) {
      // ⚠️ Never the raw errno: it carries absolute paths and says nothing a
      // person can act on. The step label is what the operator needs.
      steps.push({ label, ok: false });
      return false;
    }
  }

  const madeDir = step('made its folder', () => {
    if (DRY_RUN && !runner) return true;
    fs.mkdirSync(workerDir(name), { recursive: true });
  });
  if (!madeDir) {
    return { outcome: OUTCOME.REFUSED, because: 'we could not make a folder for it', steps };
  }

  const wroteInstructions = step('wrote its instructions', () => {
    if (DRY_RUN && !runner) return true;
    fs.writeFileSync(instructionFile(name), roles.instructionsFor(roleKey, name), 'utf8');
  });

  // ⚠️ Executable, and that is not a detail: launchd runs it through
  // `/bin/bash`, but a person told "this is a real file you can run" and met
  // "permission denied" has been handed a file that is real only to us.
  const wroteLauncher = step('wrote its startup script', () => {
    if (DRY_RUN && !runner) return true;
    fs.writeFileSync(launcherFile(name), launcherFor(name, claudeBin, tmuxBin), { mode: 0o755 });
  });

  const wroteJob = step('wrote its startup job', () => {
    if (DRY_RUN && !runner) return true;
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.writeFileSync(plistPath(name), plistFor(name, claudeBin, tmuxBin), 'utf8');
  });

  /**
   * ⚠️ STOP BEFORE LOADING A JOB THAT CANNOT WORK.
   *
   * Only the folder and the start were gating the outcome, so a failed write
   * still returned `CREATED` — "set up and starting" over an agent with no
   * instructions, or with a job pointing at a startup script that was never
   * written. The second one is actively harmful rather than merely untrue:
   * `bash` exits immediately on a missing script, `KeepAlive` restarts it,
   * and the machine gets a job that fails every thirty seconds forever.
   *
   * And the screen built on this said "the folder and the instructions are on
   * your computer either way" — a sentence that is false in exactly the case
   * that produced it.
   */
  if (!wroteInstructions || !wroteLauncher || !wroteJob) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we could not write everything it needs, so we have not started it',
      steps,
    };
  }

  /**
   * ⚠️ LOADING the job is what starts the agent, and it is deliberately the
   * only way it is started.
   *
   * The previous version ran tmux itself and left the job on disk unloaded, so
   * the agent ran now and was gone after a reboot — the one thing the job
   * exists to prevent. Worse, the two paths would have started it DIFFERENTLY:
   * a session started here and a session started by the job are set up by
   * different code, and the second one is the one that runs for the rest of the
   * agent's life. Starting it any way other than the way it will always be
   * started means the first run is the only one anybody ever tested.
   *
   * So: bootstrap the job, and let `RunAtLoad` do it. One path, exercised at
   * creation, at reboot, and after every crash.
   */
  const started = step('started it', () => {
    const r = run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath(name)]);
    return r && r.ok !== false;
  });

  if (!started) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we set it up but could not start it, so it is not running yet',
      steps,
    };
  }
  // ⚠️ `CREATED` says the job was accepted, and NOT that the agent is up. The
  // claim, the session and the process all happen inside the job, after this
  // function has returned — so the thing that decides whether a person actually
  // has an agent is the board seeing it, which is watched on the screen rather
  // than asserted here. "We started it" is a claim about us.
  return {
    outcome: OUTCOME.CREATED,
    because: `${name} is set up and starting`,
    steps,
    firstAction: role.firstAction,
  };
}

module.exports = {
  createAgent,
  nameProblem,
  cleanName,
  plistFor,
  launcherFor,
  serviceLabel,
  workerDir,
  instructionFile,
  launcherFile,
  plistPath,
  setRunner,
  setDryRun,
  OUTCOME,
  get DRY_RUN() { return DRY_RUN; },
};
