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
 * ⚠️ AND IT WORKS ON EVERY AGENT, including ones another tool created. An
 * earlier version refused those because we had not made them. That is wrong for
 * this product: Kosmos manages a fleet, and a fleet agent it cannot manage is a
 * hole rather than a safeguard. What it does not do is destroy anything of
 * theirs — it stops them, and it can start them again.
 *
 * ⚠️ "EVERY AGENT" IS NOT "EVERY CARD", and the earlier wording of this
 * sentence said the second. The board draws a card for any pane running Claude,
 * including a `tmux new -s notes` somebody opened by hand — and `plan` refuses
 * those, because the board will not vouch that the session belongs to the agent
 * whose name it is filed under. That refusal is right, so the promise narrows
 * to match it rather than the other way round.
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
const { execFileSync } = require('node:child_process');
const create = require('./create');
const store = require('./store');
const status = require('./status');

const OUTCOME = { REMOVED: 'removed', RESTORED: 'restored', REFUSED: 'refused', PARTIAL: 'partial' };

/**
 * ⚠️ TAKEN FROM THE STORE, not re-derived. `engine/store.js` already owns
 * "where this product keeps its own data", and this module had a verbatim copy
 * of the same conditional. Two derivations of one fact is the defect
 * `engine/status.js` calls the one this codebase has shipped more times than
 * any other; the two agreed today only because nobody had moved the store yet,
 * and the day somebody does, the removed list silently stops being found — a
 * board that quietly un-hides every removed agent, with nothing to explain it.
 */
const REMOVED_FILE = path.join(store.ROOT, 'removed.json');

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
/**
 * ⚠️ TWO DIFFERENT QUESTIONS, and answering them the same way loses data.
 *
 * `readRemoved` fails OPEN — an unreadable list means we are not hiding
 * anything, because a board that hides agents for a reason nobody can inspect
 * is worse than one that shows too many. That is right for the QUERY.
 *
 * It is wrong as the base of a read-modify-write. `writeRemoved(readRemoved()
 * ...)` on a transiently unreadable file (EACCES after a permissions change, a
 * truncated write, an EIO) starts from an empty list and then persists it —
 * silently discarding every OTHER removed agent's `label`, `plist` and
 * `shownAs`. Those three fields are the only thing that makes Restore possible,
 * so one unlucky read turns every other removed agent into the state with no
 * way back that this whole module is shaped around avoiding. The fail-open then
 * hides the damage: the board simply shows them again, running or not.
 *
 * So writers use `readRemovedForWrite`, which distinguishes "there is no file
 * yet" (safe to start empty) from "there is a file and I could not read it"
 * (refuse, and let the caller report a partial).
 */
function readRemoved() {
  const got = readRemovedForWrite();
  return got === UNREADABLE ? [] : got;
}

/** Sentinel: the file is there and we could not read it. NOT the same as absent. */
const UNREADABLE = Symbol('removed-list-unreadable');

function readRemovedForWrite() {
  let raw;
  try {
    raw = fs.readFileSync(REMOVED_FILE, 'utf8');
  } catch (err) {
    // ENOENT is the ordinary first-run case: nothing has ever been removed.
    if (err && err.code === 'ENOENT') return [];
    return UNREADABLE;
  }
  try {
    const parsed = JSON.parse(raw);
    // ⚠️ A file that parses to something that is not a list is CORRUPT, not
    // empty. Treating it as empty is the same overwrite by another route.
    if (!Array.isArray(parsed)) return UNREADABLE;
    return parsed.filter((r) => r && typeof r.name === 'string');
  } catch {
    return UNREADABLE;
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
/**
 * Does this exact path exist, spelled exactly this way?
 *
 * ⚠️ `fs.existsSync` IS NOT AN ANSWER TO THAT QUESTION ON THIS PLATFORM. macOS
 * volumes are case-insensitive by default (verified on this machine), so
 * `existsSync` happily resolves `.../CASEY` to `casey`'s real file.
 *
 * That is not cosmetic here, because every step AFTER the probe keys on the
 * exact string the caller passed. Measured, in a sandbox, against a real
 * `casey` agent running in tmux:
 *
 *     remove('CASEY') -> "casey has been removed from Kosmos."
 *     commands run:      disable gui/501/com.kosmos.agent.CASEY
 *                        bootout gui/501/com.kosmos.agent.CASEY
 *     isHidden('casey') = false
 *
 * So: the screen names a live agent as removed, NOTHING is done to that agent,
 * and a **persistent disabled override is written into launchd's per-user
 * database under a label that has never existed** -- with no file anywhere
 * recording it, which is precisely the invisible state the README's `enable`
 * paragraph exists to warn about.
 *
 * Asking the DIRECTORY for its real entry names is the only way to get a
 * case-sensitive answer out of a case-insensitive volume.
 */
function existsExactly(full) {
  try {
    return fs.readdirSync(path.dirname(full)).includes(path.basename(full));
  } catch {
    return false;
  }
}

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
  // ⚠️ `existsExactly`, not `existsSync`: see its note. A case-variant spelling
  // resolves to the REAL agent's plist here and then every step below acts on
  // the variant, disabling a launchd label that does not exist while the real
  // agent keeps running.
  return candidates.find((c) => existsExactly(c.plist)) || null;
}

/**
 * Which session, if any, this removal may end.
 *
 * ⚠️ FOUR ANSWERS, and every one of them is a different thing to tell a person.
 * An earlier version returned `null` for both "nothing is running" and "a
 * session exists under this name but we cannot tie it to this agent", and the
 * caller then recorded the step as done with the note "it was not running".
 * That is this codebase's own defect class — an assertion about a state nobody
 * checked — sitting in the sentence that tells somebody their agent has been
 * stopped. A shape with a `kind` on it cannot be collapsed by accident the way
 * two falsy values can.
 */
const FOUND = { NONE: 'none', OURS: 'ours', UNTIED: 'untied', UNKNOWN: 'unknown' };

function sessionFor(name) {
  const clean = create.cleanName(name);
  try {
    const card = status.paneRoster().find((p) => p.sessionName === clean);
    if (!card) return { kind: FOUND.NONE, session: null };
    /**
     * ⚠️ NO FALLBACK TO THE AGENT'S NAME, and this is the one place in the
     * module that used to have one (`card.session || clean`).
     *
     * `session` is what gets killed. Falling back to `clean` means that if the
     * roster ever hands back a card without one, the kill targets a session
     * NAMED after the agent rather than the session the board tied to it -- and
     * because `kill-session` exit 1 and `has-session` exit 1 both read as
     * "gone", the removal would then report REMOVED over an agent still
     * running, or end something that merely shares the name. `paneRoster`
     * always sets `session` today, so the fallback was unreachable; it was also
     * the only spot here that failed OPEN, and an unreachable fail-open is
     * exactly the kind that becomes reachable later without anyone noticing.
     * An unknown is an unknown.
     */
    if (!card.session) return { kind: FOUND.UNKNOWN, session: null };
    if (!card.isNamedOurs) return { kind: FOUND.UNTIED, session: card.session };
    return { kind: FOUND.OURS, session: card.session };
  } catch {
    // ⚠️ Cannot ask tmux. That is NOT "nothing is running" — it is an unknown,
    // and the caller must treat it as one rather than proceeding as if the
    // agent were already stopped.
    return { kind: FOUND.UNKNOWN, session: null };
  }
}

/**
 * Files an agent as removed, and answers whether the filing stuck.
 *
 * ⚠️ ONE writer, used by the success path AND by the partial where the job was
 * disabled but not unloaded. A removal with no record is the single state with
 * no way back — no row in the removed list, so no Restore button, so the only
 * route is the manual launchctl recipe this product exists to spare people. A
 * second copy of this for the partial path would have been the obvious way to
 * write it, and the obvious way for the two to drift.
 */
function recordRemoval(clean, job, stopped, shownAs) {
  if (DRY_RUN && !runner) return true;
  const existing = readRemovedForWrite();
  // ⚠️ Refuse rather than overwrite. Answering `false` costs this one agent its
  // Restore button and says so; overwriting costs every OTHER removed agent
  // theirs, silently.
  if (existing === UNREADABLE) return false;
  const list = existing.filter((r) => r.name !== clean);
  list.push({
    name: clean,
    /**
     * ⚠️ WHAT THE BOARD CALLED IT, captured HERE rather than re-derived when
     * the removed list is drawn.
     *
     * The list is the one screen showing agents that have no card, so a row
     * reading `claudebot` for the agent the confirmation called `Splinter` is
     * an undo path the person cannot recognise -- for exactly the pre-existing
     * agents this feature was rebuilt to support. Re-deriving it at draw time
     * would not work either: the display name is parsed out of the agent's
     * instruction file, which is still on disk but may have been edited, or
     * the folder renamed, in the days since. What was on the card when they
     * pressed the button is the thing that makes the row recognisable.
     */
    shownAs: shownAs || clean,
    removedAt: new Date().toISOString(),
    /**
     * ⚠️ WHETHER THE AGENT ACTUALLY STOPPED, and the board reads it.
     *
     * Two requirements pulled in opposite directions here and both were right.
     * A half-removal needs a RECORD, or there is no Restore button and no way
     * back. But a half-removal is exactly the case where the agent may still be
     * running, and hiding a running agent is the thing this codebase refuses to
     * do above all others.
     *
     * They only conflict while "recorded" and "hidden" are the same fact. They
     * are not: the record says Kosmos was asked to remove this, and this flag
     * says whether it managed to. A partial is listed as removed — so it can be
     * put back — and stays ON the board, because it may still be going, which
     * is precisely what the card is for.
     */
    stopped: stopped !== false,
    // ⚠️ What RESTORE needs, captured at removal rather than re-derived later.
    // By then the plist may be gone, or a different one may have taken its
    // place, and restoring the wrong job is worse than not restoring at all.
    label: job ? job.label : null,
    plist: job ? job.plist : null,
    ours: job ? job.ours : null,
  });
  /**
   * ⚠️ CANNOT THROW OUT OF HERE, and this is the one call in `remove` that is
   * not already inside `step`.
   *
   * `writeRemoved` does mkdir + write + rename, any of which can fail
   * (permissions, a full disk, a `removed.json` that is somehow a directory).
   * On the partial paths this is called AFTER the job has been disabled and
   * booted out -- so a throw escaping here leaves the agent stopped, disabled,
   * and with no record: no row on the removed list, so no Restore button, so
   * the only way back is the manual launchctl recipe this product exists to
   * spare people. That is the single state with no way out, reached by an
   * exception rather than by any decision.
   *
   * Answering `false` instead lets each caller report a PARTIAL that says so.
   */
  try {
    writeRemoved(list);
  } catch {
    return false;
  }
  return isRemoved(clean);
}

/**
 * Whether the board should hide this agent.
 *
 * ⚠️ NOT the same question as `isRemoved`, and keeping them apart is the whole
 * point. `isRemoved` asks whether Kosmos was asked to remove this agent, which
 * is what puts a Restore button on screen. This asks whether it actually
 * stopped, which is what may take a card off the board. A removal that half
 * worked answers yes to the first and no to the second: it is recoverable AND
 * still visible, because it may still be running.
 */
function isHidden(name) {
  const clean = create.cleanName(name);
  const r = readRemoved().find((x) => x.name === clean);
  return Boolean(r) && r.stopped !== false;
}

/**
 * Whether there is anything here to remove: a folder, a startup job, or a
 * session on the board. Any one is enough.
 */
function exists(clean) {
  if (jobFor(clean)) return true;
  // ⚠️ Exact spelling again. Without it `exists('CASEY')` is true because
  // `casey`'s folder answers, and the removal proceeds under the wrong name.
  if (existsExactly(create.workerDir(clean))) return true;
  /**
   * ⚠️ An unreachable tmux is UNKNOWN, and the caller says so in those words.
   * Returning a bare false here made `plan` answer "we cannot find an agent
   * called X" — an assertion of absence derived from a question that was never
   * asked, under a comment claiming it did the opposite.
   *
   * ⚠️ MOSTLY PRE-EMPTED NOW, and the comment above would otherwise read as
   * live. `plan` asks the roster for the ownership tie BEFORE calling this and
   * refuses on a throw there, so in practice an unreachable tmux is caught one
   * step earlier. What reaches here is the narrow race where the roster
   * answered once and then stopped. Kept because it fails closed and the race
   * is real; described accurately rather than left implying it is the main
   * path.
   */
  const found = sessionFor(clean);
  if (found.kind === FOUND.OURS || found.kind === FOUND.UNTIED) return true;
  return found.kind === FOUND.UNKNOWN ? UNKNOWN : false;
}

/** Neither "it is there" nor "it is not": we could not ask. */
const UNKNOWN = Symbol('unknown');

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
/**
 * Can this name be acted on SAFELY? Not: would we have let somebody create it.
 *
 * ⚠️ `create.nameProblem` is the CREATION rule and it is the wrong test here.
 * Removal acts on names the product did not choose: the roster admits any tmux
 * session running Claude, whatever it is called, so a default `tmux new`
 * session `0`, a session called `Notes`, or one named `orch.main` all draw
 * cards. Running them through the creation rule refused the removal with advice
 * nobody can act on — "use lower case, so the name is the same everywhere it
 * appears", printed under "Remove this agent" about an agent nobody is naming.
 * That contradicts the one thing the README promises about this feature: the
 * board shows every agent on this machine, and managing the ones you already
 * have is the point.
 *
 * What removal actually needs is that the name cannot escape a path or bend a
 * command. It is interpolated into a worker directory, a plist filename, a
 * launchd label and a tmux target, so those are what this checks — and nothing
 * else. Every argument goes out through `execFileSync` with an array, so there
 * is no shell to quote for; the risk is path traversal and a name that reads as
 * an option.
 */
function unsafeToActOn(name) {
  if (!name) return 'we have no name to look up';
  // Path separators and NUL would let a name reach outside its own directory.
  if (/[/\\\0]/.test(name)) return `${name} is not a name we can act on safely`;
  // `.` and `..` are directories, not agents.
  if (name === '.' || name === '..') return `${name} is not a name we can act on safely`;
  // A leading dash reads as a flag to launchctl and tmux alike.
  if (name.startsWith('-')) return `${name} is not a name we can act on safely`;
  // Long enough for any real session, short enough not to be a filesystem
  // problem in its own right.
  if (name.length > 200) return 'that name is too long for us to act on';
  return null;
}

function plan(name) {
  const clean = create.cleanName(name);
  const problem = unsafeToActOn(clean);
  if (problem) return { ok: false, because: problem };
  /**
   * ⚠️ WHAT TO CALL IT ON SCREEN, resolved once and used by every sentence
   * below — the refusals as well as the question. See the note above the return
   * for why this is the display name and not the session name; a refusal shown
   * on Splinter's own screen reading "claudebot has already been removed" has
   * the same problem as the confirmation did.
   */
  const shown = status.readIdentity(clean).displayName || clean;
  /**
   * ⚠️ `isHidden`, NOT `isRemoved`, and the difference is a retry.
   *
   * A removal that half worked leaves a record, so keying this on "is there a
   * record" refused the second attempt — the person is looking at an agent
   * still running under a message telling them it could not be stopped, and the
   * only button offered answers "it has already been removed". Refuse when it
   * is genuinely gone; let them try again when it is not.
   */
  if (isHidden(clean)) {
    return { ok: false, because: `${shown} has already been removed from Kosmos.` };
  }
  /**
   * ⚠️ A CARD WE CANNOT TIE TO THIS NAME MUST NOT HAND OVER THIS NAME'S JOB.
   *
   * This is the same defect this branch already fixed for every other
   * name-keyed write, reopened on the most dangerous one. The removal routes
   * were added afterwards and were never brought under the gate.
   *
   * The harm, measured on the shape of this fleet: the real `claudebot-discord`
   * is not currently up, and somebody has an ordinary `tmux new -s claudebot`
   * running Claude — no `-discord` suffix, no claim, so the board draws it as an
   * UNTIED card named `claudebot`. The detail screen offers "Remove this
   * agent…", and `jobFor('claudebot')` resolves to the REAL agent's
   * `com.claudebot.discord.plist`. Removing the bystander's scratch session
   * would disable and boot out the operator's actual project manager.
   *
   * ⚠️ IT HAS TO BE HERE, NOT IN `sessionFor`. That check exists and is right,
   * but it is not consulted until after `disable` and `bootout` have already
   * run — so by the time the untied session is noticed, the damage is done. The
   * question "is this name mine to act on" belongs before the first command.
   *
   * ⚠️ AND IT DOES NOT NARROW THE FEATURE. A pre-existing agent is
   * `isNamedOurs` through the `-discord` arm and a Kosmos-made one through its
   * claim, so every agent this is meant to manage still passes. What it refuses
   * is a card the board itself will not vouch for.
   *
   * Fails CLOSED: `paneRoster` throws when tmux cannot be asked, and "I could
   * not check whether this name is yours" is not permission to disable a job.
   */
  let tie;
  try {
    tie = status.paneRoster().find((c) => c.sessionName === clean) || null;
  } catch {
    return {
      ok: false,
      because: `we could not check which agent ${shown} refers to right now, so we have not offered to remove it. Try again in a moment.`,
    };
  }
  if (tie && tie.isNamedOurs !== true) {
    return {
      ok: false,
      because: `something is running in a session called ${clean}, and we cannot confirm it is this agent. `
        + 'Kosmos will not stop it, because doing so could stop the wrong thing.',
    };
  }
  /**
   * ⚠️ THERE HAS TO BE SOMETHING THERE TO REMOVE.
   *
   * Without this, any name at all could be "removed": no folder, no job,
   * nothing running, and the answer was still a completed removal that wrote a
   * record. Nothing prunes those, and the board filters on them — so a name
   * removed in error, or typed into the URL, silently hid a REAL agent created
   * under that name later, with no card and nothing on screen to explain it.
   *
   * `exists` is deliberately generous: a folder OR a job OR a running session
   * all count. Requiring all three would refuse the half-set-up agents this
   * feature is most useful for.
   */
  const there = exists(clean);
  if (there === UNKNOWN) {
    return { ok: false, because: `we could not check whether ${shown} is still there, so we have not offered to remove it. Try again in a moment.` };
  }
  if (!there) {
    /**
     * ⚠️ SAYS THE NAME THEY ASKED FOR, not `shown`. Everywhere else the display
     * name is the friendlier of two true names for one agent -- but here there
     * is no agent, so `shown` is whatever `readIdentity` picked up reading a
     * case-insensitive path, and it would name a DIFFERENT, living agent:
     * "we cannot find an agent called casey" in answer to a request for CASEY,
     * while casey is on the board. The one refusal that must use the requested
     * spelling is the one that says nothing by that name is here.
     */
    return { ok: false, because: `we cannot find an agent called ${clean}.` };
  }
  /**
   * ⚠️ THE QUESTION USES THE NAME ON THE CARD, NOT THE NAME ON THE MACHINE.
   *
   * These are the same string for every agent Kosmos creates and differ for
   * exactly the pre-existing ones this feature was rebuilt to cover. The board
   * shows `Splinter`; the session is `claudebot`. Naming the machine one asks
   * somebody whether they are sure about removing an agent **they have never
   * seen that name for** — which defeats the entire reason Josh asked for the
   * confirmation to be named: *"so they really understand what they are doing."*
   *
   * ⚠️ And it is the SAME display-versus-session split that produced a blocker
   * on this branch already, pointing the other way: the board filtered on the
   * display name while a removal recorded the session name. The rule that comes
   * out of both: **act on the session name, speak the display name.** Nothing
   * below this line acts on `shown`; it is only ever said.
   *
   * `readIdentity` falls back to the session name when it cannot read one, so
   * the worst case is the plainer of two true names, never a wrong one.
   */
  return {
    ok: true,
    name: clean,
    // What to CALL it on screen. The buttons use this too, so a confirmation
    // cannot say "Splinter" above a button reading "Remove claudebot".
    label: shown,
    question: `Are you sure you want to remove ${shown} from Kosmos?`,
    reassurance: "The agent's folder and the contents you wrote for it will not be deleted.",
    /**
     * ⚠️ THE HINT ON THE DETAIL SCREEN, and it comes from here for the same
     * reason the question does.
     *
     * The browser composed this sentence itself, which contradicts the rule
     * stated directly above the confirmation code in that file -- and it was
     * WRONG for an agent with no startup job, promising to stop something
     * starting again when there is nothing to stop. Any sentence describing
     * what removal will do has to be written where the code that does it lives,
     * or the two drift, and this one already had.
     */
    hint: jobFor(clean)
      ? 'Removing it takes it off this board and stops it starting again. '
        + 'Nothing on your computer is deleted, and you can put it back.'
      : 'Removing it takes it off this board and ends its session. '
        + 'It has no startup job, so nothing was going to restart it anyway. '
        + 'Nothing on your computer is deleted, and you can put it back.',
  };
}

/* ── doing it ────────────────────────────────────────────────────────────── */

/**
 * ⚠️ SAYS SO WHEN NOTHING ACTUALLY HAPPENED.
 *
 * `AGENT_WORKFORCE_DRY_RUN=1` with no injected runner is exactly the failure
 * the note on `DRY_RUN` describes -- every command answers success and every
 * write short-circuits, so a removal reports REMOVED having done nothing at
 * all. That default was moved out of the module for precisely this reason, and
 * the env var can still reproduce it. It stays (it is a real dev affordance),
 * but it no longer looks identical to a real removal: the outcome carries a
 * marker and the sentence says it out loud, so a screen or a route cannot pass
 * it off as work.
 */
function markDryRun(result) {
  if (!(DRY_RUN && !runner)) return result;
  // ⚠️ A refusal is already honest -- nothing was going to happen. Every OTHER
  // outcome describes work, and in this mode no work occurred.
  if (!result || result.outcome === OUTCOME.REFUSED) return result;
  return {
    ...result,
    dryRun: true,
    because: `${result.because} (Nothing actually happened: this board is running in dry-run.)`,
  };
}

function removeInner(name, { tmuxBin } = {}) {
  const intent = plan(name);
  if (!intent.ok) return { outcome: OUTCOME.REFUSED, because: intent.because, steps: [] };

  const clean = intent.name;
  /**
   * ⚠️ WHAT TO CALL IT IN EVERY SENTENCE BELOW, and it is the DISPLAY name.
   *
   * `plan` already resolved this for the question the person was asked, and
   * the answers have to match it. Without this, the confirmation said "Remove
   * Splinter" and the outcome that came back said "we stopped claudebot from
   * starting again" -- one dialog, two names, and the second one a name they
   * have never seen on the board they clicked from. Same display-versus-session
   * split as everywhere else in this feature: act on `clean`, speak `shown`.
   */
  const shown = intent.label || intent.name;
  const tmux = tmuxBin || process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux';
  const steps = [];
  const job = jobFor(clean);

  /**
   * ⚠️ THE PARTIALS' LAST SENTENCE, and it has to be EARNED rather than
   * appended.
   *
   * Every partial below ends by telling the person they can put the agent back
   * from the removed list. That is only true if the record was actually
   * written. `recordRemoval` can fail -- the write is mkdir + write + rename,
   * and disks fill, permissions change -- and it used to be able to THROW,
   * which escaped `remove` entirely and took the process with it, leaving an
   * agent stopped, disabled and unrecoverable by an exception rather than by
   * any decision.
   *
   * Containing the throw is not enough on its own: a contained failure that
   * still printed "you can put it back from the removed list" would send
   * somebody to a screen with no row for them, which is the same lie in a
   * quieter voice. So the sentence is chosen from what actually happened.
   */
  /**
   * ⚠️ ONE WRITER for "the record failed, here is the way back". It was two --
   * `recordAndSay` named the launchd label and the final branch below named
   * nothing at all, which is how the one path where the agent also loses its
   * card ended up with the least information.
   */
  function recoveryRoute() {
    return job
      ? `Its startup job is ${job.label}, and re-enabling that is what undoes this.`
      : 'It has no startup job, so nothing will restart it -- its folder and everything in it is untouched.';
  }

  function recordAndSay(stopped) {
    const kept = recordRemoval(clean, job, stopped, shown);
    if (kept) return 'You can put it back from the removed list.';
    /**
     * ⚠️ The manual route only exists if there IS a job. Told an agent that
     * never had one that "its startup job is not present, and re-enabling that
     * is what undoes this", a person is being handed a recipe for a thing that
     * does not exist, at the exact moment they need a real one.
     */
    return 'We could not add it to the removed list either, so it will not appear there to be put back. '
      + recoveryRoute();
  }

  /**
   * ⚠️ WHAT WAS ACTUALLY DONE TO THE STARTUP JOB, and every partial below opens
   * with it.
   *
   * All three used to open with a flat "we stopped `<name>` from starting
   * again". That is true only when there WAS a job to disable. `exists()`
   * deliberately admits an agent on the strength of a running session alone --
   * a hand-started one, or one supervised by something that is not launchd --
   * and for those the branch above ran no command at all. The sentence then
   * reported an action nobody performed, which is the one defect class this
   * module's header says it exists to avoid, in the messages a person reads
   * when something has already half-happened.
   */
  const didToJob = job
    ? `we stopped ${shown} from starting again, but`
    : `${shown} has no startup job to turn off, and`;

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
    /**
     * ⚠️ TWO STEPS, NOT ONE, because they fail differently and the difference
     * is what the person is told.
     *
     * As one step, a `disable` that succeeded followed by a `bootout` that
     * failed reported "we have left it alone. Nothing has changed" — while the
     * job WAS disabled and would not start at the next login. Worse, it
     * returned before the record was written, so the agent appeared on no
     * removed list, had no Restore button, and the only way back was the
     * manual launchctl recipe this product exists to spare people.
     */
    const disabled = step('stopped it starting again', () => {
      const off = run('/bin/launchctl', ['disable', `gui/${process.getuid()}/${job.label}`]);
      return Boolean(off && off.ok !== false);
    });
    if (!disabled) {
      // Nothing was changed here, so this sentence is true.
      return {
        outcome: OUTCOME.PARTIAL,
        because: `we could not stop ${shown} from starting again, so we have left it alone. Nothing has changed.`,
        steps,
      };
    }
    const unloaded = step('stopped it now', () => {
      const out = run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${job.label}`]);
      // 3 is launchd for "no such service", which is the end state we wanted.
      return Boolean(out && (out.ok !== false || out.code === 3));
    });
    if (!unloaded) {
      /**
       * ⚠️ RECORD IT ANYWAY, then report the partial. The job is disabled, so
       * this agent IS half-removed and saying otherwise would be a lie — and a
       * removal with no record is the one state with no way back. Recording it
       * puts the Restore button on screen, which re-enables exactly this label.
       */
      return {
        outcome: OUTCOME.PARTIAL,
        because: `${didToJob} could not stop it right now, so it is still running. `
          + recordAndSay(false),
        steps,
      };
    }
  } else {
    // ⚠️ The LABEL does not claim work nobody did. Its three siblings (`hint`,
    // `didToJob`, restore's two endings) were each branched for exactly this
    // reason and this one was missed. Not visible in the browser today, which
    // ignores `steps` -- but the route ships them, so it is a sentence on the
    // wire asserting a job was stopped when there was none.
    steps.push({ label: 'it had no startup job to stop', ok: true });
  }

  /**
   * ⚠️ Three worlds, not two: "nothing running", "a session we cannot tie to
   * this agent", and "we could not ask tmux at all". Collapsing the third into
   * the first is how a removal reports success over an agent that is still
   * going.
   */
  const found = sessionFor(clean);
  if (found.kind === FOUND.UNKNOWN) {
    // ⚠️ RECORDED FIRST, and the same goes for every partial below.
    //
    // By this line the job is disabled AND unloaded, so the agent is
    // half-removed whatever we say next. A half-removal with no record is the
    // one state with no way back: no row in the removed list, so no Restore
    // button, so the only route is the manual launchctl recipe this product
    // exists to spare people. The bootout partial above learnt this; these
    // three returns were left behind, and they are the ones a person actually
    // hits, because an unreachable tmux and an untied session are ordinary.
    return {
      outcome: OUTCOME.PARTIAL,
      because: `${didToJob} we could not ask tmux whether it is still running, so it may still be going. `
        + recordAndSay(false),
      steps,
    };
  }
  /**
   * ⚠️ A SESSION WE CANNOT TIE TO THIS AGENT IS NOT NOTHING.
   *
   * Something is running under this name and the board will not vouch that it
   * is this agent — so ending it could kill somebody else's work, and NOT
   * ending it means the removal did not stop what the person was looking at.
   * Neither is a success, and the only honest answer is to say precisely that
   * and leave the session alone.
   */
  if (found.kind === FOUND.UNTIED) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `${didToJob} something is running in a session called ${found.session} `
        + 'that we cannot confirm is this agent, so we have left it alone. It may still be going. '
        + recordAndSay(false),
      steps,
    };
  }
  const session = found.session;
  if (found.kind === FOUND.OURS) {
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
        because: `${didToJob} we could not end the session it is running in, so it is still going. `
          + recordAndSay(false),
        steps,
      };
    }
  } else {
    steps.push({ label: 'ended its session', ok: true, note: 'it was not running' });
  }

  // Only now is it true that this agent is stopped and will stay stopped.
  const recorded = step('took it off the board', () => recordRemoval(clean, job, true, shown));
  if (!recorded) {
    /**
     * ⚠️ THE LAST STATE WITH NO WAY BACK, and the sentence here was FALSE.
     *
     * It said the agent "will still appear on the board". It will not: the
     * board is built from live tmux panes, and the session was killed two steps
     * ago. So the agent is stopped, disabled, on no removed list and with no
     * card — invisible in every direction — and the one message about it
     * pointed at a board that would not show it.
     *
     * ⚠️ Not exotic, either. `readRemoved` fails OPEN by design, so a
     * `removed.json` that is corrupt rather than absent sends EVERY otherwise
     * successful removal down this branch.
     *
     * Every other partial hands back the launchd label through `recordAndSay`,
     * because when the record is what failed, the label is the only way back.
     * This branch was the one that did not, at the moment it mattered most.
     */
    return {
      outcome: OUTCOME.PARTIAL,
      because: `${shown} has been stopped, but we could not add it to the removed list, `
        + 'so it will not appear there to be put back, and its card has gone from the board. '
        + recoveryRoute(),
      steps,
    };
  }

  return {
    outcome: OUTCOME.REMOVED,
    /**
     * ⚠️ Only mentions the folder when there IS one. `exists()` deliberately
     * admits an agent on a startup job alone, so an agent with a plist and no
     * worker directory removes cleanly and was being reassured about a folder
     * it never had. Its three siblings (`hint`, `didToJob`, restore's two) were
     * each branched for the same reason; this one was missed.
     */
    because: fs.existsSync(create.workerDir(clean))
      ? `${shown} has been removed from Kosmos. Its folder and everything in it is still on your computer.`
      : `${shown} has been removed from Kosmos. Nothing on your computer was deleted.`,
    steps,
  };
}

/* ── putting it back ─────────────────────────────────────────────────────── */

function restoreInner(name) {
  const clean = create.cleanName(name);
  /**
   * ⚠️ Same gate as `plan`, for symmetry rather than for a live hole. Restore's
   * launchctl arguments come from the stored RECORD, never from the request, so
   * a traversal name simply falls through to "is not on the removed list"
   * today. But `restore` does interpolate the name into the very paths
   * `unsafeToActOn` exists for, and the asymmetry is the kind that goes live
   * the day a record is written by a second route.
   */
  const unsafe = unsafeToActOn(clean);
  if (unsafe) return { outcome: OUTCOME.REFUSED, because: unsafe, steps: [] };
  const record = readRemoved().find((r) => r.name === clean);
  /**
   * ⚠️ SPOKEN NAME, same rule as `remove` and `plan`: act on `clean`, say
   * `shown`. Restore is reached from the removed list, which is the ONE screen
   * where a person may be looking at an agent they cannot currently see a card
   * for -- so a machine name here is even less recognisable than elsewhere.
   *
   * ⚠️ Falls back through the RECORD before the session name. A removed agent's
   * folder may have been renamed or emptied since, in which case `readIdentity`
   * has nothing to read and would answer with the session name; the label
   * captured at removal is what the person was actually shown at the time.
   */
  const shown = (record && record.shownAs)
    || status.readIdentity(clean).displayName
    || clean;
  if (!record) {
    return { outcome: OUTCOME.REFUSED, because: `${shown} is not on the removed list.`, steps: [] };
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
  // ⚠️ Whether the startup FILE is still there, captured before the step runs.
  // The step returns true when it is gone (the enable stands, so their own
  // tooling can start it) -- which is right, but it left the terminal message
  // claiming the agent was "set to start again" when launchd has nothing to
  // load and will not start it at the next login either. The comment inside the
  // step says a missing plist "fails in a way worth reporting rather than
  // hiding"; nothing reported it.
  const plistGone = Boolean(record.label) && (!record.plist || !fs.existsSync(record.plist));
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
    // ⚠️ Same hazard as `recordRemoval`: rewriting the list from a read that
    // failed would drop every other removed agent's record while claiming to
    // have restored this one.
    const existing = readRemovedForWrite();
    if (existing === UNREADABLE) return false;
    writeRemoved(existing.filter((r) => r.name !== clean));
    return !isRemoved(clean);
  });

  if (!forgotten) {
    /**
     * ⚠️ BOTH HALVES CAN FAIL, and this branch used to speak for only one.
     *
     * It opened with "we started `<name>` again" unconditionally -- so when the
     * enable ALSO failed, the person was told the agent had been started by
     * code that had just watched that fail, and the "may need starting by hand"
     * sentence never rendered because this return came first. Two independent
     * outcomes, reported as two.
     */
    return {
      outcome: OUTCOME.PARTIAL,
      because: started
        ? `we started ${shown} again, but could not take it off the removed list, so it may still be hidden.`
        : `we could not start ${shown} again, and could not take it off the removed list either, `
          + 'so it stays hidden and stopped. Trying again is safe.',
      steps,
    };
  }
  if (!started) {
    return {
      outcome: OUTCOME.PARTIAL,
      because: `${shown} is back on the board, but we could not start it again. It may need starting by hand.`,
      steps,
    };
  }

  /**
   * ⚠️ SAYS WHAT WAS CHECKED, WHICH IS THAT THE JOB IS LOADED AND ENABLED.
   *
   * `bootstrap` succeeding means launchd accepted the job, NOT that the agent
   * is running — a plist with `RunAtLoad` off, or one whose program dies
   * immediately, both load fine. "It is back" asserted the second from evidence
   * for the first, and restore is the worst place in this module for a claim
   * nobody verified: it is what makes the removal's single light question an
   * honest one. The board is the thing that will actually show it running,
   * within one poll, and it derives that from tmux rather than from us.
   */
  return {
    outcome: OUTCOME.RESTORED,
    // ⚠️ Two sentences, because two things can be true. An agent removed while
    // it had no startup job has nothing to re-enable, and telling somebody it
    // is "set to start again" would be a claim about a job that does not exist.
    because: (() => {
      if (!record.label) {
        return `${shown} is back on the board. It had no startup job, so there was nothing to turn back on.`;
      }
      if (plistGone) {
        return `${shown} is back on the board, and we have turned its startup entry back on. `
          + 'But the file that starts it is no longer on this computer, so it will not start on its own. '
          + 'Whatever set this agent up originally is what can put that back.';
      }
      return `${shown} is back on the board and set to start again.`;
    })(),
    steps,
  };
}

/**
 * ⚠️ Wrapped at the boundary, not at each return. `remove` has five outcomes
 * and `restore` four, and the PARTIALS need the marker as much as the successes
 * do: in env dry-run the post-kill look-again answers "still there" (every
 * command reports success, including `has-session`), so a dry run actually
 * lands on a partial whose text describes work that did not happen.
 */
function remove(name, opts) { return markDryRun(removeInner(name, opts)); }
function restore(name) { return markDryRun(restoreInner(name)); }

module.exports = {
  plan,
  unsafeToActOn,
  isHidden,
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
