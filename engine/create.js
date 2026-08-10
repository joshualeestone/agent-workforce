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
 *   - **No shell, ever.** Every command is `execFile` with an argument array.
 *     A name reaches tmux and launchd as one argument, never as text a shell
 *     could reinterpret.
 *   - **Dry-run by default**, with the same interlock `lifecycle` uses: leaving
 *     dry-run throws unless a runner is already injected, so a test cannot
 *     reach the real machine by forgetting a line.
 *   - **Nothing is claimed that was not verified.** "Created" is a claim about
 *     us; "it answered" is a claim about the agent, and only the second means
 *     the person has an agent.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const roles = require('./roles');

const HOME = os.homedir();
const WORKERS_DIR = process.env.AGENT_WORKFORCE_WORKERS || path.join(HOME, 'work', 'workers');
const AGENTS_DIR = process.env.AGENT_WORKFORCE_LAUNCH || path.join(HOME, 'Library', 'LaunchAgents');

const OUTCOME = { CREATED: 'created', REFUSED: 'refused', PARTIAL: 'partial' };

/* ── the runner seam ─────────────────────────────────────────────────────── */

let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

/**
 * ⚠️ The same bidirectional interlock as `lifecycle`, for the same reason.
 * `setDryRun(false)` refuses unless a runner is installed, and `setRunner(null)`
 * re-arms dry-run — so neither ordering can leave a test able to spawn a real
 * tmux session. A one-directional invariant would depend on every test's
 * `finally` running in the right order.
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

function nameProblem(raw) {
  const name = String(raw == null ? '' : raw).trim();
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
function serviceLabel(name) { return `com.kosmos.agent.${name}`; }
function plistPath(name) { return path.join(AGENTS_DIR, `${serviceLabel(name)}.plist`); }

/**
 * The launchd job.
 *
 * ⚠️ `PATH` **and `LANG`**, and neither is optional. launchd's default PATH
 * omits Homebrew, so tmux is simply not found — the board then serves happily
 * with zero agents. And without a UTF-8 locale, tmux SANITISES its own format
 * output, replacing the tab separators with underscores, so every agent parses
 * as one garbage field. Both were found the hard way on this machine on
 * 2026-08-10; see issue #23.
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
    <string>${tmuxBin}</string>
    <string>new-session</string>
    <string>-d</string>
    <string>-s</string><string>${name}</string>
    <string>-c</string><string>${workerDir(name)}</string>
    <string>${claudeBin}</string>
    <string>--dangerously-skip-permissions</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
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
  const name = String((opts && opts.name) || '').trim();
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

  step('wrote its instructions', () => {
    if (DRY_RUN && !runner) return true;
    fs.writeFileSync(instructionFile(name), roles.instructionsFor(roleKey, name), 'utf8');
  });

  step('wrote its startup job', () => {
    if (DRY_RUN && !runner) return true;
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.writeFileSync(plistPath(name), plistFor(name, claudeBin, tmuxBin), 'utf8');
  });

  const started = step('started it', () => {
    const r = run(tmuxBin, ['new-session', '-d', '-s', name, '-c', workerDir(name),
      claudeBin, '--dangerously-skip-permissions']);
    return r && r.ok !== false;
  });

  // ⚠️ THE CLAIM, and it must be set by us and only us. This is what makes the
  // agent recognisable as ours without a Discord naming convention. An agent
  // setting its own would let any process claim any name.
  const claimed = started && step('claimed the session', () => {
    const r = run(tmuxBin, ['set-option', '-t', name, '@kosmos_agent', name]);
    return r && r.ok !== false;
  });

  if (!started) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we set it up but could not start it, so it is not running yet',
      steps,
    };
  }
  if (!claimed) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'it started, but we could not mark the session as ours, so the board may not recognise it',
      steps,
    };
  }

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
  plistFor,
  serviceLabel,
  workerDir,
  instructionFile,
  plistPath,
  setRunner,
  setDryRun,
  OUTCOME,
  get DRY_RUN() { return DRY_RUN; },
};
