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
 *     string, and **nothing is interpolated into shell text at all**. The agent
 *     needs a supervising script — `tmux new-session -d` exits immediately, and
 *     launchd would otherwise respawn the job forever — but that script is
 *     `bin/agent-supervisor.sh`, shipped and shared, taking the agent as
 *     ARGUMENTS. So a name reaches launchd, tmux and the script as one argument
 *     each, never as text a shell could reinterpret.
 *     ⚠️ This is the second correction of this paragraph. It first read "no
 *     shell, ever", which stopped being true when a script was generated per
 *     agent with the name written into it; then it described that generated
 *     text and named `launcherFor`, which no longer exists. A safety header
 *     that is wrong about the safety model is the worst place in the file for
 *     it to be wrong, because it is what stops the next reader checking.
 *   - **A runner seam with a bidirectional interlock**: leaving dry-run throws
 *     unless a runner is already injected, and clearing the runner re-arms
 *     dry-run, so neither ordering leaves a test able to spawn real agents.
 *     ⚠️ And dry-run now suppresses the WRITES as well as the commands. It
 *     guarded them with `DRY_RUN && !runner` — true only in the state where the
 *     commands are inert anyway — so a test that installed a recorder still
 *     wrote a real plist into `~/Library/LaunchAgents`, and launchd starts that
 *     job at the next login whether or not anybody ran `bootstrap`. The
 *     interlock was covering the quieter half of the danger.
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
// ⚠️ The same key every name-keyed route resolves by. Comparing raw names let
// this create `mybot` beside a live `my.bot-discord`: two names, one key, one
// instruction file, one avatar, one commitment record -- so a write naming
// either reached the other. This module's own header exists to prevent exactly
// that ("a name that sanitises to something else means two names can become
// one"), and the gate was checking the wrong thing to enforce it.
const store = require('./store');

const HOME = os.homedir();
const WORKERS_DIR = process.env.AGENT_WORKFORCE_WORKERS || path.join(HOME, 'work', 'workers');
const AGENTS_DIR = process.env.AGENT_WORKFORCE_LAUNCH || path.join(HOME, 'Library', 'LaunchAgents');
/**
 * Where the product keeps things it installs for itself, as opposed to things
 * that belong to an agent.
 *
 * ⚠️ The same root `engine/store.js` uses, honouring the same variable, so a
 * sandboxed test sandboxes this too — and so there is one answer to "where does
 * this product keep its files" rather than a second convention introduced by
 * whoever needed a directory next.
 */
const SUPPORT_DIR = process.env.AGENT_WORKFORCE_DATA
  ? path.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce')
  : path.join(HOME, 'Library', 'Application Support', 'AgentWorkforce');

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
  // ⚠️ `stdio` pipes stderr rather than inheriting it. Without this, the
  // `launchctl print` probe -- which fails for every FREE name, by design --
  // printed "Could not find service" to the operator's console immediately
  // before the board reported a successful creation.
  return {
    ok: true,
    stdout: execFileSync(file, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }),
  };
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
  // ⚠️ Length gets its OWN sentence. `NAME_RE` enforces 2 to 32 characters, and
  // a person who typed `a` was told to use letters, numbers, hyphens and
  // underscores -- a rule they had not broken, with no way to work out what was
  // actually wrong. A refusal that names the wrong rule is worse than a vague
  // one.
  if (name.length < 2) return 'use at least two characters, so the name is something you can pick out';
  if (name.length > 32) return 'keep it to 32 characters or fewer';
  if (!NAME_RE.test(name)) {
    return 'use letters, numbers, hyphens and underscores, starting with a letter or number';
  }
  /* ⚠️ NOT `<something>-discord`, and this is not cosmetic.
   *
   * The board files an agent under its session name with `-discord` STRIPPED.
   * So an agent created as `angel-discord` would be filed under `angel` — the
   * name a real agent already holds — and the roster collision check, which
   * compares board names, would not see it: it looks for `angel-discord` in a
   * list where the live `angel-discord` session appears as `angel`.
   *
   * Two failures from one accepted name. The creation collides with a running
   * agent the check was written to protect, and even on an empty machine the
   * new agent is filed under a name that is not its session, so its identity,
   * its instructions and its writes all resolve to the wrong key and its card
   * is anonymous and uneditable.
   */
  if (/-discord$/.test(name)) {
    return 'names cannot end in -discord, which the board reads as an agent running somewhere else';
  }
  return null;
}

/* ── paths, derived once ─────────────────────────────────────────────────── */

function workerDir(name) { return path.join(WORKERS_DIR, name); }
function instructionFile(name) { return path.join(workerDir(name), 'CLAUDE.md'); }
function logFile(name) { return path.join(workerDir(name), 'start.log'); }
function serviceLabel(name) { return `com.kosmos.agent.${name}`; }
function plistPath(name) { return path.join(AGENTS_DIR, `${serviceLabel(name)}.plist`); }

/**
 * Where the ONE supervisor lives, and how it gets there.
 *
 * ⚠️ It used to be GENERATED PER AGENT: each got its own 151-line copy under
 * its own folder. Every defect in it therefore shipped as many times as there
 * were agents, and every fix reached only the agents created afterwards — the
 * ones already on the machine kept their copy of the bug forever. It also could
 * not be reviewed once; it was reviewed per generation, which is how six
 * separate defects got into it in a single afternoon.
 *
 * ⚠️ INSTALLED, not referenced in place. The job could have pointed at
 * `bin/agent-supervisor.sh` inside this checkout, which is one fewer moving
 * part — but then moving or deleting the repository breaks every agent on the
 * machine at their next login, silently, long after whoever moved it has
 * forgotten. So it is copied to a stable location outside the checkout, and
 * refreshed on every creation so a change reaches the agents that already
 * exist too.
 */
function supervisorSource() {
  return path.join(__dirname, '..', 'bin', 'agent-supervisor.sh');
}

function supervisorPath() {
  return path.join(SUPPORT_DIR, 'bin', 'agent-supervisor.sh');
}

/**
 * Put the current supervisor where the jobs point, and answer whether it is
 * there.
 *
 * ⚠️ Returns false rather than throwing, and the caller refuses the creation on
 * a false. An agent whose job points at a script that is not there is the
 * respawn-loop state: `bash` exits at once and `KeepAlive` retries every thirty
 * seconds for as long as the machine is on.
 */
function installSupervisor() {
  /**
   * ⚠️ Answers WHY it failed, not just that it did.
   *
   * Every failure collapsed into one boolean, and the caller then told the
   * operator "trying again will not help until it is fixed". For a full disk,
   * or a support directory momentarily unwritable, that sentence is false in
   * exactly the case that produced it — and it is the sentence that stops them
   * retrying. A missing source file is genuinely permanent; nothing else here
   * is.
   */
  try {
    const dest = supervisorPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    /**
     * ⚠️ WRITE BESIDE IT AND RENAME, never copy over it.
     *
     * `copyFileSync` truncates and rewrites the destination in place, same
     * inode — and every live agent's supervisor is a `bash` process reading
     * that exact file. Bash reads a script by file offset as it goes, so
     * rewriting it underneath a running instance can make it execute whatever
     * now sits at that offset, or fall out of its supervision loop and hand the
     * agent back to `KeepAlive`.
     *
     * This branch makes that the NORMAL case rather than an edge one: the
     * refresh exists precisely so a change lands while other agents are
     * running. `rename` is atomic within a filesystem and gives the new file a
     * new inode, so every running instance keeps reading the one it started
     * with and picks the new one up at its next start — which is exactly the
     * update model this change is for.
     */
    // ⚠️ Per-process, because a fixed name lets two installs interleave into one
    // inode (`copyFileSync` opens with O_TRUNC) and rename a truncated script
    // into place for every agent on the machine.
    const staging = `${dest}.${process.pid}.new`;
    fs.copyFileSync(supervisorSource(), staging);
    fs.chmodSync(staging, 0o755);
    fs.renameSync(staging, dest);
    return { ok: true };
  } catch (err) {
    // Leave nothing half-written beside the real one.
    try { fs.rmSync(`${supervisorPath()}.${process.pid}.new`, { force: true }); } catch { /* best effort */ }
    return { ok: false, missing: err && err.code === 'ENOENT' && !fs.existsSync(supervisorSource()) };
  }
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
// A path is a legal place for `&` or `<`, and either one emits a plist launchd
// silently refuses to load. The shell-shape check above rejects quotes and
// metacharacters; this is the XML half of the same idea.
function xml(value) {
  return String(value)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;');
}

function plistFor(name, claudeBin, tmuxBin) {
  const label = serviceLabel(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${xml(supervisorPath())}</string>
    <string>${xml(name)}</string>
    <string>${xml(workerDir(name))}</string>
    <string>${xml(claudeBin)}</string>
    <string>${xml(tmuxBin)}</string>
    <string>${xml(logFile(name))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(workerDir(name))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xml(HOME)}</string>
    <key>PATH</key><string>${xml(`${path.dirname(claudeBin)}:${path.dirname(tmuxBin)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(logFile(name))}</string>
  <key>StandardErrorPath</key><string>${xml(logFile(name))}</string>
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
  // ⚠️ Overridable by environment, because these two defaults are ONE machine's
  // paths: an Intel Mac keeps Homebrew at `/usr/local`, and an npm-global Claude
  // is not in `~/.local/bin` at all. Without a way to say so, this product
  // simply cannot make an agent on those machines — it refuses, correctly but
  // uselessly. It is also what lets the route be tested without depending on
  // what happens to be installed on the machine running the suite.
  //
  // ⚠️ Environment and arguments only. NOT the request body: honouring a
  // caller-supplied path would let anything that can reach this server name an
  // executable to be launched under launchd on every reboot, which is a far
  // worse hole than the one creation already is.
  const claudeBin = (opts && opts.claudeBin)
    || process.env.AGENT_WORKFORCE_CLAUDE_BIN
    || path.join(HOME, '.local', 'bin', 'claude');
  const tmuxBin = (opts && opts.tmuxBin)
    || process.env.AGENT_WORKFORCE_TMUX_BIN
    || '/opt/homebrew/bin/tmux';

  const steps = [];
  const problem = nameProblem(name);
  if (problem) return { outcome: OUTCOME.REFUSED, because: problem, steps };

  const role = roles.byKey(roleKey);
  if (!role) {
    return { outcome: OUTCOME.REFUSED, because: 'pick what this agent is for', steps };
  }
  /**
   * ⚠️ A NAME ON THE REMOVED LIST IS TAKEN, and refusing it here is what stops
   * a new agent being born invisible.
   *
   * The board hides removed agents by name. Nothing prunes that list, and
   * `remove` deletes nothing — so a name removed earlier could be created
   * again, succeed, and then be filtered off the board on every poll: no card,
   * no error, and nothing on screen to explain where it went. The person who
   * hit this would have no way at all to work out what happened.
   *
   * Restoring is almost always what they actually want, so the refusal says so
   * rather than sending them to a manual recipe.
   *
   * ⚠️ Required LAZILY, and it has to stay that way: `remove` requires THIS
   * module at its top, so a top-level require here closes the cycle. By the
   * time an agent is being created both are loaded, so this resolves from
   * cache. (An `eslint-disable-next-line global-require` used to sit on the
   * line below, implying a linter enforced something here. There is no eslint
   * config, no eslint dependency and no lint script in this repo, so it was
   * decoration that read as a rule.)
   */
  const removedList = require('./remove');
  if (removedList.isRemoved(name)) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `${name} is on your removed list. Put that one back from "Show removed agents" at the bottom of the Agents tab, or pick a different name.`,
      steps,
    };
  }

  /* ⚠️ WHAT IS ALREADY HERE, and the refusal has to name the RIGHT half.
   *
   * Three states, not one: a folder can outlive its job, and a job can outlive
   * its folder. (This used to say "because removing an agent is still manual
   * and the README says so". Remove exists now -- but it deliberately deletes
   * NOTHING, so the halves can still come apart, and every reason below still
   * holds.) Checking only the folder meant a leftover launchd job was
   * discovered as a FAILED BOOTSTRAP -- "we set it up but could not start it",
   * which is true and about the wrong thing, on the one screen built to tell
   * somebody which half failed. Checking only the job inverted it.
   *
   * The half-made case matters most in practice: a PARTIAL leaves both on disk,
   * the screen offers Start over, and the person needs to be told what is in
   * the way rather than that an agent they can see is not running exists.
   */
  const hasFolder = fs.existsSync(workerDir(name));
  const hasJob = fs.existsSync(plistPath(name));
  if (hasFolder && hasJob) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `there is already an agent called ${name}. If it never came up, it is half made rather than missing, and the README says how to clear one out.`,
      steps,
    };
  }
  if (hasJob) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `something called ${name} is still set to start on this computer, even though there is no folder for it. It has to be removed before the name can be used again, and the README says how.`,
      steps,
    };
  }
  if (hasFolder) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `there is already a folder for an agent called ${name}. If you removed that agent, its folder is still there; the README says how to clear one out.`,
      steps,
    };
  }

  /* ⚠️ AND A SERVICE THAT IS LOADED WITH NO PLIST ON DISK, which is what the
   * README's own removal recipe produces if the `rm` runs without the
   * `bootout`, or before it.
   *
   * Without this check the creation proceeds, `bootstrap` fails with "service
   * already bootstrapped", the rollback removes the plist it just wrote, and
   * the person is told "we have taken it back off your computer. You can try
   * that name again." Retrying fails identically, forever, against a message
   * promising the opposite -- while the orphaned job keeps respawning against a
   * startup script the rollback has just deleted.
   *
   * ⚠️ We REFUSE rather than booting the stray service out ourselves. It is a
   * job this creation did not install, running something we have not looked at,
   * and unloading somebody else's service to free up a name is exactly the
   * "act on something we have not tied to us" move the rest of this codebase
   * refuses to make.
   */
  //
  // ⚠️ Loaded means launchctl actually DESCRIBED the service, not merely that
  // the command came back. `print` exits non-zero and throws when there is no
  // such service, and prints a block describing it when there is — so the
  // presence of output is the signal, and an empty answer is read as "no". That
  // also keeps the seam honest: a recorder that reports every command as
  // succeeding does not thereby claim every name is taken.
  let loaded = false;
  try {
    const r = run('/bin/launchctl', ['print', `gui/${process.getuid()}/${serviceLabel(name)}`]);
    loaded = Boolean(r && r.ok !== false && String(r.stdout || '').trim());
  } catch {
    loaded = false;
  }
  if (loaded) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `something called ${name} is already running as a startup job on this computer, even though there is nothing on disk for it. It has to be removed before the name can be used again, and the README says how.`,
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
  const wantedKey = (() => { try { return store.safeKey(name); } catch { return null; } })();
  const clash = roster.find((p) => {
    if (p.sessionName === name) return true;
    if (!wantedKey) return false;
    try { return store.safeKey(p.sessionName) === wantedKey; } catch { return false; }
  });
  if (clash) {
    // ⚠️ Names the SESSION rather than asserting an agent exists. `paneRoster`
    // covers every pane on the machine, so a person with a shell session called
    // `notes` was told there was an agent called `notes`, which there is not --
    // the same "refusal that names the wrong thing" the length rule was split
    // out to avoid.
    // Names the REAL tmux session, not the board name: the board name is the
    // stripped form, so for `my.bot-discord` it would have said "this computer
    // is running my.bot", which is not a session anybody can find.
    const running = clash.session || clash.sessionName;
    const also = running === name ? '' : ` (this computer is running ${running}, which the board files under the same name)`;
    return {
      outcome: OUTCOME.REFUSED,
      because: `something called ${name} is already running on this computer${also}`,
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
   * ⚠️ And they are checked for SHAPE, not only presence. They are NOT
   * interpolated into shell text any more — they reach the plist as separate
   * XML elements and the supervisor as argv — so the original reason for this
   * check has gone. It is kept because a path carrying a quote or a newline is
   * a path nothing good comes of passing anywhere, and because the relevant
   * guard for the plist is now the XML escaping beside it. Said plainly so the
   * next reader does not have to re-derive which one is load-bearing.
   */
  // ⚠️ The worker folder is checked with them. It is operator-controlled rather
  // than request-controlled (it comes from AGENT_WORKFORCE_WORKERS), and it no
  // longer reaches any generated shell text -- it is passed to the supervisor as
  // one argument. Kept for the same reason as the binaries above: a path
  // carrying a quote or a newline is one nothing good comes of passing
  // anywhere, and the guard that matters for the plist is the XML escaping.
  for (const [what, bin] of [['Claude', claudeBin], ['tmux', tmuxBin], ['the agents folder', workerDir(name)]]) {
    if (/['"\n\r\\$`]/.test(bin)) {
      return { outcome: OUTCOME.REFUSED, because: `we cannot use that path for ${what}`, steps };
    }
    if (what === 'the agents folder') continue;
    if (!fs.existsSync(bin)) {
      return {
        outcome: OUTCOME.REFUSED,
        because: `we could not find ${what} on this computer, so an agent made now would never start`,
        steps,
      };
    }
  }

  /**
   * ⚠️ PUT THE MACHINE BACK.
   *
   * Every failure after this point has to leave nothing behind, and the reason
   * is not tidiness. Two separate half-states shipped before this existed:
   *
   *   - A failed write left the FOLDER, so the very next attempt at the same
   *     name was refused for the folder's existence -- permanently, from a
   *     screen whose own button is "Start over". The comment beside it claimed
   *     the cleanup "lets the person try the same name again", which was false.
   *   - A failed `bootstrap` left the PLIST, and launchd loads every plist in
   *     that directory at the next login. So an agent the person was told is
   *     "not running yet" was in fact installed to start at their next login,
   *     undisclosed, with `--dangerously-skip-permissions`.
   *
   * Nothing here existed before this call: the folder is refused if it is
   * already there, and so is the job. So removing them takes back only what we
   * just made. The `steps` list still records which half failed, which is where
   * the diagnostic value actually lives.
   */
  function rollBack({ unload = false } = {}) {
    /* ⚠️ `unload` is for a failed START, and only then.
     *
     * `bootstrap` can register a service and still exit non-zero. Removing only
     * the plist then leaves that job respawning against a `start.sh` this
     * rollback has just deleted, and every retry of the name hits the
     * already-loaded refusal above — so the message "you can try that name
     * again" becomes false forever.
     *
     * The refusal above deliberately will NOT unload a stray service, because
     * it did not install it. This one did, seconds ago, which is exactly the
     * difference that makes unloading it the right thing rather than an
     * overreach.
     */
    if (DRY_RUN) return;
    if (unload) {
      try { run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${serviceLabel(name)}`]); }
      catch { /* it was probably never registered, which is the common case */ }
    }
    try { fs.rmSync(plistPath(name), { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(workerDir(name), { recursive: true, force: true }); } catch { /* best effort */ }
  }

  function step(label, fn) {
    try {
      const r = fn();
      steps.push({ label, ok: r !== false });
      return r !== false;
    } catch {
      // ⚠️ Never the raw errno: it carries absolute paths and says nothing a
      // person can act on. The step label is what the operator needs.
      steps.push({ label, ok: false });
      return false;
    }
  }

  const madeDir = step('made its folder', () => {
    if (DRY_RUN) return true;
    fs.mkdirSync(workerDir(name), { recursive: true });
  });
  if (!madeDir) {
    rollBack();
    return { outcome: OUTCOME.REFUSED, because: 'we could not make a folder for it', steps };
  }

  const wroteInstructions = step('wrote its instructions', () => {
    if (DRY_RUN) return true;
    fs.writeFileSync(instructionFile(name), roles.instructionsFor(roleKey, name), 'utf8');
  });

  // ⚠️ Executable, and that is not a detail. launchd runs it through
  // `/bin/bash` either way, but this file is the one an operator debugging a
  // stuck agent will run by hand with the same arguments the job passes, and a
  // "permission denied" at that moment is a file that is real only to us.
  // ⚠️ Installed rather than written per agent, and still a STEP: if the shared
  // supervisor is not in place, the job would point at a script that does not
  // exist, which is the respawn loop. The gate below stops before the job is
  // written at all.
  let supervisorMissing = false;
  const installedSupervisor = step('put the startup script in place', () => {
    if (DRY_RUN) return true;
    const done = installSupervisor();
    supervisorMissing = done.missing === true;
    return done.ok;
  });

  /**
   * ⚠️ THE JOB IS WRITTEN LAST, AND REMOVED IF WE CANNOT FINISH.
   *
   * Order matters more here than anywhere else in this function. The plist was
   * written before the gate below, so a failed instructions or launcher write
   * left a launchd job on disk pointing at a startup script that does not
   * exist. Skipping `bootstrap` does not help: launchd loads every plist in
   * `~/Library/LaunchAgents` at the next login, `bash` exits at once on a
   * missing file, and `KeepAlive` with `ThrottleInterval 30` respawns it every
   * thirty seconds for as long as the machine is on.
   *
   * That is word for word the harm the gate below says it prevents, arriving
   * through the file the gate does not clean up. And it compounds: the name is
   * then permanently refused by the leftover-job branch above, so the person
   * cannot even retry from the screen.
   */
  const wroteJob = (wroteInstructions && installedSupervisor) && step('wrote its startup job', () => {
    if (DRY_RUN) return true;
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
  if (!wroteInstructions || !installedSupervisor || !wroteJob) {
    rollBack();
    // ⚠️ A missing supervisor gets its OWN sentence. It is not "try again":
    // `bin/agent-supervisor.sh` is missing from the installation, so retrying
    // fails identically forever, and the only place the real cause surfaced was
    // a step label. Naming the wrong cause is the failure the Claude and tmux
    // checks are careful to avoid.
    if (!installedSupervisor) {
      return {
        outcome: OUTCOME.PARTIAL,
        because: supervisorMissing
          ? 'the script that starts agents is missing from this app, so we have not made it. Trying again will not help until that is fixed.'
          : 'we could not put the script that starts agents in place, so we have not made it. You can try that name again.',
        steps,
      };
    }
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we could not write everything it needs, so we have not made it. Nothing has been left on your computer, and you can try that name again.',
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
    // ⚠️ INCLUDING THE JOB, and including UNLOADING it. It was left installed
    // here, so an agent reported as "not running yet" would have started at the
    // person's next login anyway -- the one outcome nobody would predict from
    // that sentence. And `bootstrap` can register a service and still fail, so
    // deleting the plist alone would leave a job nothing on disk explains.
    rollBack({ unload: true });
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we set it up but could not start it, so we have taken it back off your computer rather than leave something half installed. You can try that name again.',
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
    // Where it actually is, so no screen has to rebuild this path and be wrong
    // about it on a machine with the roots pointed elsewhere.
    folder: workerDir(name),
  };
}

module.exports = {
  createAgent,
  nameProblem,
  cleanName,
  plistFor,
  supervisorPath,
  supervisorSource,
  installSupervisor,
  serviceLabel,
  workerDir,
  instructionFile,
  plistPath,
  setRunner,
  setDryRun,
  OUTCOME,
  get DRY_RUN() { return DRY_RUN; },
};
