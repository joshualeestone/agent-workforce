'use strict';

/**
 * Projects — the work, and which agents are on it.
 *
 * A project **is a folder on disk** (§4, Josh 2026-08-06). Not a container this
 * platform fills: a pointer at work the person already has, which is why an
 * agent can be aimed at a repo that already exists without us adding a single
 * file to it. Everything this module writes lives in app data, never in the
 * project folder (§7b).
 *
 * ⚠️ **Membership is an ORGANISING fact and never a boundary**, and that is the
 * one thing in this file that must not be softened later. Access levels were
 * dropped 2026-08-11: every agent runs at full permission, nothing is enforced,
 * and *a level that is not enforced is worse than none, because it is believed*
 * by somebody with no way to check. So nothing here returns a permission, and
 * nothing that consumes it may render one — no locks, no "access", no
 * "restricted", no wording implying an agent cannot reach something.
 *
 * ## What is actually true when you put an agent on a project
 *
 * Four claims are available and only three of them are ours to make:
 *
 * | Claim | | |
 * |---|---|---|
 * | this project is that folder | ✅ | we can stat it, and do, on every read |
 * | these agents are on this project | ✅ | it is our own record |
 * | we told this agent where the folder is | ✅ | we wrote the line and can show it |
 * | this agent **knows** it, works there, or is confined to it | ❌ | never |
 *
 * The fourth is false in three separate ways, which is why it gets its own
 * paragraph rather than a footnote. An instruction file is read ONCE, at
 * session start, so a running agent is still working from what it read at boot.
 * An agent may have no instruction file this product can write at all. And
 * nothing constrains where any agent goes regardless. Hence `told` below is a
 * verdict with a reason attached, never a boolean that reads as knowledge.
 */

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');
const instructions = require('./instructions');
// ⚠️ ONE rule for who answers, and it lives with the thread rather than being
// re-derived in the page. `web/index.html` ships as one file with no import
// mechanism, so a picker that worked out its own default would be a second
// answer to "who answers on this project" — this codebase's worst habit, and
// the exact question the screen this replaced said it was waiting on. So the
// project publishes the answer and the page renders it.
const chat = require('./chat');
const { kosmosCliShown } = require('./clipath');
// One direction only: messages requires chat/store/limits, never projects,
// so this edge (for the colleagues-block heal in tellAgent) cannot cycle.
const messagesBlock = () => require('./messages');

const FILE = 'projects.json';

/**
 * How a folder is doing, asked every time rather than remembered.
 *
 * Scope §4 Q3: a project whose folder was moved or deleted is shown as
 * unreadable rather than quietly dropped. Dropping it is the failure this
 * codebase is built against — it turns "I cannot see this" into "this is not
 * here", and the person who put their work in that folder gets no signal at
 * all.
 */
const FOLDER = {
  READABLE: 'readable',
  MISSING: 'missing',
  NOT_A_FOLDER: 'not_a_folder',
  UNREADABLE: 'unreadable',
};

/**
 * Whether we managed to tell an agent where its project folder is.
 *
 * ⚠️ Three values, not two, and the third is the one that matters. `TOLD` and
 * `COULD_NOT` are the obvious pair; `NOT_TRIED` exists because a membership
 * recorded before we ever attempted the write must not read as a failed
 * attempt. Same reason the commitment store answers `unknown` for an agent that
 * has never reported: "we did not ask" and "we asked and could not" are
 * different facts, and collapsing them invents an answer.
 */
const TOLD = {
  TOLD: 'told',
  COULD_NOT: 'could_not',
  NOT_TRIED: 'not_tried',
};

/**
 * A plural sibling for each singular could_not because.
 *
 * The singular strings are written for a one-agent context ("this agent
 * has no folder…") and do not survive being quoted inside a plural frame:
 * "we could not tell ANY OF THEM … THIS AGENT has…" reads as a
 * contradiction (Mona Lisa's ruling, 2026-08-18). The screen's group line
 * asks here for the plural form; anything unmapped gets `null`, and the
 * screen states no reason it does not have rather than splicing.
 *
 * ⚠️ Keyed on the EXACT singular string, so an edited engine sentence
 * silently falls back to the reasonless group line instead of pairing
 * with a stale plural. Edit the singular, edit its row here.
 * ⚠️ NOTHING MAPS TO ITSELF ANY MORE. One row used to, and this line said so;
 * the trim that moved the outcome clause into the frame gave it a distinct
 * plural like every other row. I updated the TEST's comment about that in the
 * same commit and left this one standing, which is the class this file keeps
 * producing: the newest sentence is the least examined one.
 */
const GROUP_BECAUSE = new Map([
  /**
   * ⚠️ THE FRAME NAMES THE AGENTS, so these values carry `instructions`
   * themselves. An earlier frame named `instructions`, which made it the
   * antecedent for every pronoun after it AND asserted an object some of
   * these reasons deny exists ("...were not updated: none of them has one
   * yet"). Trimming the noun out of the values to stop it appearing twice
   * removed the only thing telling a reader what `them` meant, so the
   * property was real and optimising for it made the copy worse.
   *
   * 🛑 EDIT THE FRAME AND YOU MUST RE-RENDER ALL NINE. They are written to
   * sit after "We could not update these agents about this folder: " and
   * nowhere else. The KEYS are the engine's verbatim singulars and are
   * authored at call sites in this file, `you.js` and `workerfile.js`.
   *
   * ⚠️ AND "ALL NINE" IS AN INSTRUCTION, NOT A CLAIM ABOUT WHAT WAS DONE.
   * When the frame changed, the row below said "we cannot tell they are THOSE
   * agents" and read as a second, different set under a frame saying THESE
   * agents. Nothing about that value looked edited, because nothing about it
   * WAS edited, which is the trap:
   *
   * 🔑 CHANGING A FRAME SILENTLY RE-POINTS EVERY DEICTIC IN EVERY VALUE UNDER
   * IT. A frame edit is a change to all nine sentences and only the frame
   * appears in the diff.
   *
   * All eighteen were checked against the new frame afterwards and only that
   * one row carried it.
   */
  ['it has no folder of its own on this computer yet',
    'none of them has a folder of its own on this computer yet'],
  ['it has no instructions file yet, and we will not create one',
    'none of them has an instructions file yet, and we will not create any'],
  ['we could not find an agent with exactly this name on this computer',
    'we could not find any of them by exactly these names on this computer'],
  ['something is running under this name, but we cannot tell that it is this agent',
    'something is running under these names, but we cannot tell they are these agents'],
  ['we could not check which agents are running',
    'we could not check which agents are running'],
  ['it keeps its instructions somewhere we cannot safely change',
    'they keep their instructions somewhere we cannot safely change'],
  ['taking this out would leave its instructions almost empty',
    'taking this out would leave their instructions almost empty'],
  ['its instructions are already at the size limit',
    'their instructions are already at the size limit'],
  ['we could not write to its instructions',
    'we could not write to their instructions'],
]);

/** The plural form for a singular because, or null. NEVER invents. */
function groupBecause(because) {
  if (typeof because !== 'string') return null;
  return GROUP_BECAUSE.get(because) || null;
}

const BLOCK_START = '<!-- kosmos:projects:start -->';
const BLOCK_END = '<!-- kosmos:projects:end -->';
// The you-block's markers live HERE, beside the pair they must never be
// confused with, because oneLine has to neutralise BOTH pairs: a project
// name or task sentence carrying the you markers would fabricate a tight
// pair the you-writer then splices INSIDE the projects block ("beside,
// never inside" violated by injection). engine/you.js imports these.
const YOU_START = '<!-- kosmos:you:start -->';
const YOU_END = '<!-- kosmos:you:end -->';

function file() {
  return path.join(store.ROOT, FILE);
}

/**
 * ⚠️ Reads as an EMPTY LIST when the file is absent, and that is correct — no
 * projects yet is a real state the empty screen is built for. It also reads as
 * an empty list when the file is unparseable, and that is a deliberate,
 * narrower call: this file is ours alone, written atomically, so a corrupt one
 * means something outside the product damaged it, and there is nothing a user
 * of this list can do about it. What must NOT happen is the caller mistaking
 * either case for "we checked the folders and they are fine" — which is why
 * every folder is stated separately, on every read, by `describe`.
 */
let LAST_READ_OK = true;

function readAll() {
  let raw;
  try {
    raw = fs.readFileSync(file(), 'utf8');
  } catch (err) {
    // ⚠️ ENOENT ONLY. No projects yet is a real state the empty screen is built
    // for; a file we are not allowed to read is NOT that, and a bare catch made
    // the two identical. Measured: with a real project stored and the file
    // chmod 000, the page rendered "No projects yet. Point Kosmos at a folder
    // you already have." -- a positive claim about a state nobody checked,
    // which is the one defect shape this codebase exists to prevent. The page's
    // own network-error path already says "this is not saying you have none, it
    // is saying we cannot see them"; the file read has to be as honest.
    LAST_READ_OK = err && err.code === 'ENOENT';
    if (LAST_READ_OK) return [];
    const unreadable = new Error('we cannot read your projects on this computer right now');
    unreadable.code = 'UNREADABLE';
    throw unreadable;
  }
  try {
    const parsed = JSON.parse(raw);
    LAST_READ_OK = Array.isArray(parsed);
    if (LAST_READ_OK) return parsed;
  } catch {
    LAST_READ_OK = false;
  }
  const damaged = new Error('your projects file is there but we cannot make sense of it');
  damaged.code = 'UNREADABLE';
  throw damaged;
}

function writeAll(list) {
  // ⚠️ REFUSES rather than clobbers. A `projects.json` that could not be read or
  // parsed was silently replaced by the next write, and every record in it was
  // gone -- `syncAgent` was worst, reading `[]` and writing `[]` back, which
  // truncated the whole store on any route that synced. `instructions.write`
  // has refused to replace a file its own reader would not show since the day
  // it shipped, for exactly this reason: "nothing of the user's is ever
  // deleted" has to hold on the error paths too, or it does not hold.
  if (!LAST_READ_OK && fs.existsSync(file())) {
    const err = new Error('we will not overwrite your projects file while we cannot read it');
    err.code = 'UNREADABLE';
    throw err;
  }
  fs.mkdirSync(store.ROOT, { recursive: true });
  // Write-then-rename, the same as `writeProfile`: an interrupted write must not
  // leave a half-written file that parses as no projects and silently loses
  // every one of them.
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file());
  return list;
}

/**
 * A project's id.
 *
 * Goes through `store.safeKey` like every other name-derived key here, because
 * a project name is user input and ids end up in URLs. Two projects named the
 * same way get distinguished by a counter rather than one silently replacing
 * the other — "Q3" and "q3." must not be the same project.
 */
/**
 * ⚠️ BOUNDED, because an id is a KEY IN A FILENAME further downstream and the
 * caps did not line up.
 *
 * `cleanName` allows a 120-character project name and `safeKey` keeps every
 * ASCII alphanumeric in it, while `engine/chat.js` USED TO file a thread only
 * under an id of 80 characters or fewer. So a project with a
 * long-but-perfectly-ordinary name DELIVERED messages and never RECORDED one,
 * and the sentence it showed for that was "that is not a project we can read" —
 * about a project it had just created, listed, and typed into. Three caps, no
 * relationship between them, and the only symptom was a conversation that
 * silently kept nothing.
 *
 * (Past tense on purpose: that limit is 128 now, raised so records already on
 * somebody's disk are not refused. Both halves of the fix are needed — this
 * bound stops NEW ids growing, the raised limit stops OLD ones being rejected —
 * and a note that described the old cap in the present tense would send the
 * next reader looking for a mismatch that has been closed.)
 *
 * 64 is comfortably under the thread key's limit and long enough that no
 * readable name reaches it. The counter still disambiguates, so two long names
 * that share their first 64 characters become `<base>` and `<base>-2` rather
 * than one project silently replacing the other.
 */
const MAX_ID = 64;

function idFor(name, taken) {
  let base;
  try {
    base = store.safeKey(name).slice(0, MAX_ID);
  } catch {
    // ⚠️ NOT an error. `safeKey` keeps `[a-z0-9_-]` only, so it yields nothing
    // for a name written in Cyrillic, Japanese, or anything else without ASCII
    // alphanumerics — and refusing there told a person their own language was
    // not a name we could use. The id is an internal key, not a display value;
    // when the name cannot supply one, a counter can.
    base = 'project';
  }
  if (!taken || !taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('there are too many projects with that name');
}

/**
 * Is this folder there, and can we read it?
 *
 * ⚠️ `realpathSync` then `statSync`, so a symlinked project folder is resolved
 * rather than merely accepted, and `real` is returned beside the stored path.
 *
 * ⚠️ WHAT `real` IS ACTUALLY FOR, said accurately: it is the identity used to
 * refuse the same folder twice (`create`'s duplicate check), so two projects
 * cannot be made out of one directory reached by two names. That is its only
 * consumer.
 *
 * An earlier version of this paragraph claimed `lstat` (this function has never
 * called it), and claimed the resolved path "must be RESOLVED before it is
 * displayed, or the path on screen is not the path being worked in", and that a
 * link pointing somewhere else later "shows up as a change". None of that is
 * built: the page prints the STORED path, `blockBody` writes the stored path
 * into the agent's instruction file, and nothing compares `real` over time. So
 * for a symlinked project the path on screen is exactly the unresolved one the
 * sentence said must not be shown.
 *
 * Left as-is rather than "fixed" to match the sentence, because showing the
 * stored path is defensible — it is the path the person typed or picked, and
 * the one they will recognise — and swapping to the resolved path is a product
 * decision about what a project IS, not a passing correction. The sentence was
 * the defect.
 */
/**
 * The resolved path, canonicalised the way the FILESYSTEM spells it.
 *
 * ⚠️ `realpathSync.native`, NOT `realpathSync`, AND THIS IS A DATA-CORRUPTION
 * FIX RATHER THAN A TIDY-UP. Measured on this machine, 2026-08-13, in a temp
 * directory containing one real folder named `Lease`:
 *
 *     fs.realpathSync('…/lease')         → '…/lease'   (case preserved as asked)
 *     fs.realpathSync.native('…/lease')  → '…/Lease'   (canonicalised)
 *     statSync of both                    → the same inode
 *
 * Node's JS implementation resolves symlinks and does not canonicalise case;
 * the native one goes through the OS `realpath(3)`, which does. On macOS's
 * default case-INSENSITIVE volume that difference was making `Lease` and
 * `lease` two projects over ONE directory: the duplicate check compares `real`,
 * the two spellings never matched, and the person ended up with two rows whose
 * agents both write into the same folder — and an add screen naming a spelling
 * Finder will never show them.
 *
 * ⚠️ AND IT IS EXACT ON BOTH KINDS OF VOLUME, which is why this beats
 * case-folding on `process.platform === 'darwin'`. On a case-SENSITIVE volume
 * `Lease` and `lease` are genuinely two directories, and the native call
 * answers each as itself — so they stay two projects, correctly. Case-folding
 * would have refused the second one, a false refusal invented by a rule that
 * guessed at the volume instead of asking it.
 *
 * (The case-sensitive half is reasoned from what `realpath(3)` returns, not
 * measured: this machine has no case-sensitive volume to test on. Said plainly
 * rather than left to read as though both halves were run.)
 *
 * Falls back to the JS implementation if the native one is unavailable, so a
 * platform without it degrades to today's behaviour rather than throwing.
 */
function resolveReal(given) {
  if (typeof fs.realpathSync.native === 'function') return fs.realpathSync.native(given);
  return fs.realpathSync(given);
}

function folderState(folder) {
  const given = String(folder || '');
  if (!given) return { state: FOLDER.MISSING, because: 'no folder was recorded for this project', real: null };
  let real = given;
  try {
    real = resolveReal(given);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { state: FOLDER.MISSING, because: 'this folder is not there any more, or it was moved', real: null };
    }
    return { state: FOLDER.UNREADABLE, because: 'we cannot read this folder', real: null };
  }
  let st;
  try {
    st = fs.statSync(real);
  } catch {
    return { state: FOLDER.UNREADABLE, because: 'we cannot read this folder', real };
  }
  if (!st.isDirectory()) {
    return { state: FOLDER.NOT_A_FOLDER, because: 'this is a file, not a folder', real };
  }
  try {
    fs.accessSync(real, fs.constants.R_OK);
  } catch {
    return { state: FOLDER.UNREADABLE, because: 'this folder is there, but we are not allowed to read it', real };
  }
  return { state: FOLDER.READABLE, because: null, real };
}

/**
 * Join a stored project to the agents actually on this machine.
 *
 * ⚠️ TAKES the roster rather than fetching it, so the honest cases can be
 * tested against a fixture instead of against whatever tmux happens to be
 * running. The cases that matter are exactly the ones a live machine will not
 * reliably produce on demand.
 *
 * ⚠️ AND IT IS NOT PURE, though this paragraph called it that for three
 * commits. It WRITES: when a live card contradicts an `everSeen: false`, the
 * upgrade is persisted to `projects.json` right here, on a read. That is
 * deliberate — the alternative is telling somebody "we have never seen an agent
 * by this name" about one we are looking at — but a caller trusting the word
 * PURE would be wrong about a read that touches the store. Bounded rather than
 * chatty: it only writes when something actually needs upgrading, so the
 * five-second poll does not rewrite the file every tick, and a failed write is
 * swallowed because a record we cannot update is not a reason to fail a read.
 *
 * ⚠️ A member we cannot find comes back `present: false` and STAYS IN THE LIST.
 * Dropping it would tell the person "these are your agents" while quietly
 * omitting one of them — the board's own rule, applied one level up: an agent
 * we cannot read is shown as unknown, never as something healthy, and never as
 * nothing at all.
 *
 * ⚠️ Members are matched on `sessionName`, NEVER on `name`. The two coincide for
 * every agent this app creates — which is the only kind a test would naturally
 * fixture — and differ for exactly the pre-existing agents Kosmos exists to
 * manage: `claudebot` displays as `Splinter`. Matching on the display name
 * shipped once already, in Remove, and was caught by a blind review rather than
 * by the suite. **Act on the machine name, speak the display name.**
 */
/**
 * The role a PERSON set on this agent, if they set one.
 *
 * ⚠️ `hasOwnProperty` rather than a plain `profile.role`, and the reason is the
 * fixture harness in `test-support/fleet.js` — which is right to complain. A
 * profile is a free-form record: `store.readProfile` answers `{}` for an agent
 * nobody has edited, so `profile.role` is a read of a key that legitimately may
 * be absent, and the harness cannot tell that apart from the wrong-shape reads
 * it exists to catch (it caught six of those on this very feature, where
 * `describe` read `name`, `state` and `because` off a producer that emits none
 * of them). Asking whether the key is there says which of the two this is.
 */
function profileRole(card) {
  const profile = card && card.profile;
  if (!profile || typeof profile !== 'object') return null;
  return Object.prototype.hasOwnProperty.call(profile, 'role') ? profile.role : null;
}

/**
 * Attach the commitments claim to each assigned open task.
 *
 * ⚠️ ONE derivation of the join, here in the engine, never re-implemented
 * by a screen: the matcher is engine/tasks.claimFor and the reading is
 * engine/commitments.read, required lazily because tasks requires this
 * module at load (the cycle resolves at call time). One read per assignee
 * per project, memoized for the call.
 *
 * ⚠️ The AMBIGUITY guard: task numbers are project-scoped and every project
 * counts from 1, so one agent on two projects can hold an open "task 1" on
 * both -- and a report saying "task 1" cannot say which. Rendering "says it
 * is on this" on either card would be a definite claim the system cannot
 * check, which is exactly what claimed:null exists to refuse. So a
 * colliding (who, number) pair joins as null-with-because on EVERY card it
 * touches, computed here from the full store (`all`), never guessed.
 * Teaching an unambiguous spelling is the next slice; refusing to guess is
 * this one.
 */
const AMBIGUITY_COUNTS = new WeakMap();
function ambiguityCounts(everyProject) {
  if (AMBIGUITY_COUNTS.has(everyProject)) return AMBIGUITY_COUNTS.get(everyProject);
  const counts = new Map();
  for (const p of everyProject) {
    for (const t of p.tasks || []) {
      // Non-integer numbers are excluded: they cannot be validly named by a
      // report at all, and claimFor's "not a whole number" answer is the
      // truer sentence than an ambiguity one interpolating NaN. (SAFE
      // integer: 1.5e21 passes isInteger and still interpolates a dot.)
      // ⚠️ And DEPARTED assignees are excluded: the count exists to mirror
      // the taught convention, and the block only teaches MEMBER tasks --
      // a leftover assignment on a project the agent has left is not "one
      // of this agent's projects" (its own join already answers
      // could-not-tell), so it must not suppress the join on the project
      // the agent is actually on.
      if (!t || t.closedAt || typeof t.number !== 'number' || !Number.isSafeInteger(t.number)) continue;
      /* ⚠️ `whoOf`, not `t.who`: a task with parts has no `who`, so it counted
         as no task at all and could not make a number ambiguous. Every agent
         named on the task counts, because the ambiguity being counted is
         "task 15" meaning two things TO ONE AGENT. */
      const tasksModC = require('./tasks');
      for (const one of tasksModC.whoOf(t)) {
        if (!(p.agents || []).includes(one)) continue;
        const key = one + '\u0000' + Number(t.number);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  AMBIGUITY_COUNTS.set(everyProject, counts);
  return counts;
}

const READINGS = new WeakMap();
function joinTaskClaims(tasks, all, memberOf, roster) {
  const tasksModEarly = require('./tasks');
  /* ⚠️ `whoOf`/`progressOf`, not `t.who`. A task that stores PARTS has no `who`
     at all, so this filter dropped every one of them and no claim was ever
     computed for a multi-part task -- the card silently lost its
     says-it-is-on-this line with nothing on screen saying why. */
  const withWho = tasks.filter((t) => t && tasksModEarly.whoOf(t).length > 0 && !tasksModEarly.progressOf(t).closed);
  if (!withWho.length) return tasks;
  const tasksMod = require('./tasks');
  const commitments = require('./commitments');
  // A two-arg caller gets a store read here that its own path never
  // wrapped; an unreadable store falls back to judging ambiguity from the
  // one project in hand rather than throwing out of a read.
  let everyProject;
  if (Array.isArray(all)) everyProject = all;
  else {
    try { everyProject = readAll(); }
    catch { everyProject = [{ tasks, agents: Array.isArray(memberOf) ? memberOf : [] }]; }
  }
  // Memoized per `all` snapshot (WeakMap), so list() over P projects builds
  // the cross-store counts once, not P times.
  const counts = ambiguityCounts(everyProject);
  // Readings ride the same snapshot as the counts: one commitments read per
  // assignee per list(), not per project the assignee appears on.
  let shared = READINGS.get(everyProject);
  if (!shared) { shared = new Map(); READINGS.set(everyProject, shared); }
  const members = Array.isArray(memberOf) ? memberOf : [];
  // ⚠️ FAIL CLOSED on an unreadable roster, like every sibling: tellAgent
  // refuses a non-array roster and borrowedName() answers true from its
  // catch. "We could not look" is not "we looked and no pane holds the
  // name" -- collapsing the two had this gate open exactly when the rest of
  // the payload was answering unknown/untied for the same names.
  const rosterUnreadable = !Array.isArray(roster);
  const cards = rosterUnreadable ? [] : roster;
  // ⚠️ The borrowed-name gate, inherited: every sibling consumer of the
  // commitments store refuses to speak for a name an untied pane is holding
  // (/api/status answers unknown, the GET route 404s), and a new consumer
  // does not get to skip the gate its siblings carry. Only a tied pane can
  // WRITE the record, so the stored text is genuine -- but rendering it as
  // this agent's word while the same row says "we cannot tell that it is
  // this agent" would have the board speaking with two postures at once.
  const borrowed = (who) => cards.some((a) => a && a.sessionName === who && !a.isNamedOurs);
  // Same type guard as the count and the matcher: a hand-edited
  // `number: true` coerces to 1 and would render the ambiguity sentence
  // where claimFor's "not a whole number" is the truer reason.
  const ambiguous = (t, who) => typeof t.number === 'number' && Number.isSafeInteger(t.number)
    && counts.get(who + '\u0000' + t.number) > 1;
  const readings = shared;
  const readFor = (who) => {
    if (!readings.has(who)) {
      let r;
      try { r = commitments.read(who); }
      catch (err) { r = { state: 'unknown', commitments: [], because: String((err && err.message) || 'we could not read its record') }; }
      readings.set(who, r);
    }
    return readings.get(who);
  };
  /**
   * 🔑 THE DERIVED SHAPE TRAVELS WITH EVERY TASK, and it is computed HERE
   * rather than on the page. The screen needs a task's parts and its "1 of 3
   * done" on every surface that draws a task, and a second implementation in
   * the browser is a second thing to keep in step with the migration rules --
   * which is exactly the drift the read-time migration exists to avoid.
   * ⚠️ Applied to EVERY task, not only the ones that earn a claim: an
   * unassigned or finished task returns early from the claim work below and
   * would otherwise reach the screen with no parts at all, which the page
   * cannot tell apart from "a task with nothing on it".
   */
  const withParts = (t) => (t ? {
    ...t,
    parts: tasksMod.partsOf(t),
    progress: (({ done, total, closed, assigned }) => ({ done, total, closed, assigned }))(tasksMod.progressOf(t)),
  } : t);
  return tasks.map((t) => {
    /* 🛑 THE SECOND `t.who` GATE, AND IT IS THE ONE THAT ACTUALLY BIT. The
       filter at the top of this function was corrected for parts and this was
       not, so a task with parts sailed past the filter and fell straight out
       here: no claim computed, `claim: undefined`, and the card silently short
       one line. Found only because a mutation of the OTHER gate went unnoticed
       and the missing test exposed this one.
       📌 `who` is the first agent named on the task. The claim is asked of the
       task as a whole, because "task 15" in a report is a claim about the task;
       per-part claims would need a spelling agents have not been taught. */
    if (!t || t.closedAt) return withParts(t);
    const who = tasksMod.whoOf(t)[0];
    if (!who || tasksMod.progressOf(t).closed) return withParts(t);
    // ⚠️ A departed assignee: removal does not unassign (the given-to record
    // is the person's, and history should not vanish because membership
    // changed), but the taught convention and the managed block both derive
    // from membership, so a non-member's report cannot be checked against
    // this task. Could-not-tell with the real reason -- rendering a
    // still-fresh "task N" report as a definite claim here would be the
    // told-when-not shape back through the removal door.
    if (!members.includes(who)) {
      return {
        ...withParts(t),
        claim: {
          claimed: null,
          because: 'this agent is no longer on the project, so what it reports cannot be checked against this task',
        },
      };
    }
    if (rosterUnreadable) {
      return {
        ...withParts(t),
        claim: {
          claimed: null,
          because: 'we could not check which agents are running, so we cannot say who holds this task',
        },
      };
    }
    if (borrowed(who)) {
      return {
        ...withParts(t),
        claim: {
          claimed: null,
          because: 'we cannot tell whether this is the same agent, so we cannot say whether it holds this task',
        },
      };
    }
    if (ambiguous(t, who)) {
      return {
        ...withParts(t),
        claim: {
          claimed: null,
          because: '"task ' + Number(t.number) + '" names more than one of this '
            + 'agent\'s open tasks, so a report saying it cannot say which '
            + 'one it means',
        },
      };
    }
    /* One reading, for the first agent named on the task. The claim is asked of
       the task as a whole, because "task 15" in a report is a claim about the
       task; per-part claims would need a spelling agents have not been taught
       and would be a fact nobody computed. */
    return { ...withParts(t), claim: tasksMod.claimFor(t, readFor(who)) };
  });
}

function describe(project, roster, all) {
  const cards = Array.isArray(roster) ? roster : [];
  // ⚠️ Seeing an agent is remembered. `everSeen` was written once, at add time,
  // and never revisited -- so an agent added while tmux could not be read was
  // stamped "never seen" permanently, and said so about an agent we later saw
  // with our own eyes. Upgrading here, on the read, keeps the claim as weak as
  // the evidence: `false` survives only while nothing has ever contradicted it.
  let upgraded = null;
  for (const name of project.agents || []) {
    // ⚠️ `isNamedOurs` HERE TOO. This was the one name-keyed read in the
    // function that did not ask, and it is the one that WRITES. A stranger's
    // ordinary `tmux new -s notes` matches by sessionName, so a mistyped member
    // that has never been an agent got its "never seen" flag flipped to true
    // and PERSISTED -- after which the row said "we cannot see this agent right
    // now" about a name that has never existed, sending the person hunting for
    // it. Unrecoverable, because the upgrade only goes false -> true.
    //
    // Three lines below, the same function refuses to read that card's state
    // and reason precisely because it is not tied. The strongest claim in the
    // function was resting on the weakest evidence in it.
    if (project.everSeen && project.everSeen[name] === false
        && cards.some((a) => a && a.sessionName === name && a.isNamedOurs === true)) {
      upgraded = upgraded || { ...(project.everSeen || {}) };
      upgraded[name] = true;
    }
  }
  if (upgraded) {
    try {
      // (named `stored`, not `all`: describe's `all` parameter is the join's
      // shared snapshot, and shadowing it here would be a trap.)
      const stored = readAll();
      const at = stored.findIndex((p) => p.id === project.id);
      if (at >= 0) { stored[at].everSeen = { ...(stored[at].everSeen || {}), ...upgraded }; writeAll(stored); }
    } catch { /* a record we cannot update is not a reason to fail a read */ }
    project = { ...project, everSeen: { ...(project.everSeen || {}), ...upgraded } };
  }
  const members = (project.agents || []).map((sessionName) => {
    const card = cards.find((a) => a && a.sessionName === sessionName) || null;
    return {
      sessionName,
      // The display name when we have one, the machine name when we do not —
      // and `present` says which, so nothing downstream has to guess whether a
      // name it is showing was read off a live agent or is just the key.
      name: card && card.name ? card.name : sessionName,
      present: Boolean(card),
      // ⚠️ TIED, and it is a different question from `present`. A pane can hold
      // this name without being this agent — a stranger's `tmux new -s angel`
      // is on the roster and matches by `sessionName`. The write gate already
      // refuses those (`tellAgent` requires `isNamedOurs`), but the ROW said
      // `present: true` and reported the stranger's state as this member's, so
      // the screen vouched for an agent the same module refuses to write to.
      // Publishing the fact is not enough on its own: the counts below have to
      // honour it, or the row still says "1 working" about a pane we cannot
      // tie to anybody.
      tied: Boolean(card && card.isNamedOurs),
      // ⚠️ Carried so the thread can open on the project's MANAGER without a
      // second read of the board. Gated on `tied` like every other value taken
      // off a card here: a role read off a pane we cannot tie to this name is
      // somebody else's role, and it would decide who a person's message is
      // addressed to. The person-set role wins over the derived one, the same
      // order the detail panel already uses.
      // ⚠️ DEFENCE-IN-DEPTH, like the page's button gate and the route's
      // asking conjunct: snapshot() already nulls role and profile on an
      // untied card, so this gate is unreachable through today's producer
      // and no test can hold it live (round 15 measured its removal green;
      // the gate-bites test in chat.test.js holds it with a produced card
      // whose tie flag is deliberately flipped).
      role: (card && card.isNamedOurs) ? (profileRole(card) || card.role || null) : null,
      // ⚠️ `unknown` for an untied pane, for the same reason the board refuses
      // to read its model or its transcript: whatever that pane is doing, we
      // have not established it is this agent doing it.
      state: (card && card.isNamedOurs) ? card.state : 'unknown',
      // The face, gated on tied like every other card-read here: a
      // stranger's pane borrowing the name must not lend the row a
      // photograph of somebody it is not (the project cards draw member
      // faces, and a face is the strongest identity claim on the screen).
      hasAvatar: Boolean(card && card.isNamedOurs && card.hasAvatar),
      /**
       * ⚠️ WHETHER THIS AGENT HAS ACTUALLY BEEN TOLD, which is a different
       * question from whether we wrote the file. An agent reads its
       * instructions when it starts and nothing makes it read them again, so
       * adding it to a project edits a document it finished reading, and the
       * row said nothing about that.
       *
       * Josh, 2026-08-21: he added an agent, the room said "Placed with
       * Johnson and Rick", and the agent answered out of a project he had
       * DELETED. The receipt was true about delivery and silent about whether
       * either agent knew what the project was.
       *
       * 📌 NOT A NEW COMPUTATION. `instructions.staleness` already returns
       * exactly this and the agent card already draws it; it was absent from
       * the one screen where KOSMOS edits the file on the person's behalf and
       * present on the screen where the PERSON edits it by hand, which is the
       * one place they already know something changed.
       *
       * Gated on `tied` like every other value taken off a card here: a
       * staleness verdict read off a pane we cannot tie to this name is
       * somebody else's.
       */
      instructions: (card && card.isNamedOurs)
        ? instructions.staleness(sessionName, undefined, card.session)
        : { state: 'unknown', editable: false, version: null, startedAt: null, because: 'we cannot tell whether this is the same agent' },
      // ⚠️ "Never seen" is only said when we have never seen it. The flag is
      // written once at add time, and an agent added while the roster was
      // unreadable was stamped `false` forever -- so a real agent that stopped
      // later got "we have never seen an agent by this name", which is a
      // strictly stronger claim than the record supports. `describe` upgrades
      // the flag the moment a live card proves otherwise (see below), so this
      // can only fire for a name we genuinely have never resolved.
      // ⚠️ An UNTIED pane's reason is not this member's reason. `card.because`
      // there is a sentence about somebody else's session ("it finished and is
      // waiting for you"), and printing it under this member's name is the
      // board's borrowed-name defect wearing a project row. Said plainly
      // instead, and the row's own state is `unknown` by the same rule.
      because: (card && !card.isNamedOurs)
        ? 'something is running under this name, but we cannot tell that it is this agent'
        : card ? card.because : (
        (project.everSeen && project.everSeen[sessionName] === false)
          // Said plainly, because it is almost always a typed name that never
          // matched anything, and telling somebody an agent is "missing" sends
          // them looking for something that was never there.
          ? 'we have never seen an agent by this name on this computer'
          : 'we cannot see this agent on this computer right now'),
      // becauseGroup is DERIVED at read time from the verbatim singular,
      // never stored: old verdicts get their plural sibling for free, and
      // an edited singular falls back to null rather than pairing with a
      // stale plural. null means the screen states no reason (its rule).
      told: (() => {
        const t = project.told && project.told[sessionName]
          ? project.told[sessionName] : { state: TOLD.NOT_TRIED, because: null };
        return { ...t, becauseGroup: groupBecause(t.because) };
      })(),
    };
  });

  return {
    ...project,
    folder: project.folder,
    folderState: folderState(project.folder),
    // Normalized here rather than trusted from the record: a legacy project
    // has no field at all, and "read as ''" has to hold for API readers too,
    // not only the two web renderers with their own || '' fallbacks.
    description: project.description || '',
    // Same normalization argument for archiving: a project written before
    // the field existed must read as "not archived", never as undefined
    // leaking into a template. Same heal path the rest of the payload uses.
    archived: project.archived === true,
    // Gated on the healed flag AND the value: a hand-edited record carrying
    // a date beside archived:false must not publish an "archived at", and a
    // non-string or unparseable value beside archived:true must not become
    // "Archived 1/1/1970" through new Date().
    archivedAt: project.archived === true ? cleanArchivedAt(project.archivedAt) : null,
    // Same normalization rule as description/archived above: the healed
    // shape has to hold for API readers too, so a legacy project reads as
    // "no tasks yet", never as fields that simply are not there.
    tasks: joinTaskClaims(Array.isArray(project.tasks) ? project.tasks : [], all, project.agents || [], roster),
    // Whether the folder lives under the Kosmos projects root: the settings
    // screen's location sentence branches on this (the pack's "In your
    // Kosmos folder." versus naming the real place), and the server is the
    // only side that knows where the root is.
    folderInKosmos: typeof project.folder === 'string'
      && path.dirname(project.folder) === projectsRoot(),
    taskCounter: project.taskCounter || 0,
    agents: members,
    // Who this project's thread opens on. Published rather than left to the
    // caller for the reason given above the `chat` require.
    defaultAgent: chat.defaultAgentFor(members),
    // ⚠️ Deliberately NOT a health summary. It counts what is on screen so the
    // list row can say "1 needs you" the way the page does, and it carries
    // `unseen` beside the counts so a row can never quietly report that
    // everything is fine when some of it was unreadable. A summary that hides
    // its own blind spot is the defect this codebase keeps finding.
    //
    // ⚠️ AND IT HID ONE, directly under that sentence. `unseen` counted only
    // members with no card at all, so the two ways of being unreadable WHILE
    // ON THE BOARD fell through every bucket: a member whose card says
    // `unknown` (its pane could not be captured — the product's own "I cannot
    // see it" value), and a member whose pane is not tied to the name. Both
    // landed in `total` and in nothing else, so a project holding one working
    // agent and one unreadable one rendered as "mara · nils — 1 working", with
    // no trace of the blind spot. The SAME agent on the Agents tab reads
    // "Can't tell" over "we cannot see this one, so we are not telling you it
    // is fine". Two derivations of one question, disagreeing.
    //
    // `unseen` is now "members this row cannot speak for", which is the count
    // the sentence above always claimed it was.
    summary: {
      total: members.length,
      // ⚠️ `tied` on both, because a state read off a pane we cannot tie to
      // this name is somebody else's state. Counting it here is how a stranger
      // would have put "1 needs you" on another person's project row.
      needsYou: members.filter((m) => m.present && m.tied && m.state === 'needs_you').length,
      working: members.filter((m) => m.present && m.tied && m.state === 'working').length,
      unseen: members.filter((m) => !m.present || !m.tied || m.state === 'unknown').length,
    },
  };
}

function list(roster) {
  // One read of the store shared by every describe: the ambiguity guard
  // needs the full list anyway, so each project's join reuses it instead
  // of re-reading per project.
  const all = readAll();
  return all.map((p) => describe(p, roster, all));
}

function get(id, roster) {
  const all = readAll();
  const found = all.find((p) => p.id === id);
  return found ? describe(found, roster, all) : null;
}

/**
 * Every project a given agent is on — the reverse edge.
 *
 * The mock draws three project names under one agent, so the relationship has
 * to be readable from both ends on day one rather than later.
 */
function projectsFor(sessionName, roster) {
  const key = String(sessionName || '');
  if (!key) return [];
  const all = readAll();
  return all
    .filter((p) => (p.agents || []).includes(key))
    .map((p) => describe(p, roster, all));
}

/**
 * The one place a project name is judged.
 *
 * ⚠️ `rename` used to skip this entirely, so a 5000-character name full of
 * newlines was refused at creation and accepted on the very next edit — and the
 * rename route then wrote it into every member's instruction file. Two
 * derivations of one question always drift; this is the one.
 */
function cleanName(name) {
  // Words or refused, like cleanDescription (one asymmetry, deliberate:
  // null keeps the older "give this project a name" -- absence, not wrong
  // type): oneLine String()s, so {name: {}} stored "[object Object]" -- and
  // the name is what syncAgent writes into every member's boot block.
  if (name !== undefined && name !== null && typeof name !== 'string') {
    throw new Error('a name has to be words');
  }
  const title = oneLine(name);
  if (!title) throw new Error('give this project a name');
  if (title.length > 120) throw new Error('that name is longer than a project name should be');
  return title;
}

/**
 * A project's one-line description: what this work IS, in the person's words.
 *
 * ⚠️ OPTIONAL, and empty is a real value. Unlike the name (a project must be
 * addressable) a description can legitimately be blank, and clearing one is a
 * deliberate act the settings screen offers -- so '' is stored, never refused
 * and never quietly kept. `oneLine` folds newlines like the name's does: this
 * renders on a card and in a heading, and a stray newline would break both.
 * Capped at 200 characters: the design renders one line under the title, and
 * Josh's own twelve fixture descriptions top out under half that.
 */
function cleanDescription(text) {
  // Absent is a legitimate blank; anything present has to BE words. String()
  // here turned {description: {}} into "[object Object]" on one route while
  // the other route silently dropped it -- one field, two rules, the exact
  // "two derivations of one question" cleanName's own comment warns against.
  // null means absence, exactly as it does for name and folder in create:
  // round 2 refused it as "a second clear spelling", which made description
  // the ONE field where null meant malformed while its neighbours read it
  // as not-provided. (A whitespace-only description folds to '' through
  // oneLine below and clears the field too -- the same deliberate act as
  // the explicit empty.)
  if (text === undefined || text === null || text === '') return '';
  if (typeof text !== 'string') throw new Error('a description has to be words');
  const flat = oneLine(text); // oneLine already trims
  // REFUSED over the cap, like cleanName at 120: a silent truncation
  // answered success while cutting the person's words with nothing saying
  // so -- two answers to over-length on two adjacent fields of one form.
  // Counted in code points (the "200 characters" people count is the
  // approximation; an all-emoji description is up to 400 UTF-16 units).
  // ⚠️ Counted in code POINTS, and deliberately NOT the name's rule: the
  // name caps at 120 UTF-16 units because its input carries maxlength=120,
  // which counts units, and the cap must agree with the box a person types
  // into. The description has no input yet -- and when the settings screen
  // adds one, it must NOT use a raw maxlength=200 (that would cut a pasted
  // 200-emoji description at 100 while this rule accepts it). The split is
  // a recorded decision, not drift.
  if (Array.from(flat).length > 200) {
    throw new Error('that description is longer than 200 characters');
  }
  return flat;
}

/* ---------------------------------------------------------------------------
 * Making the folder ourselves
 *
 * ⚠️ WHY THIS EXISTS, and it is a permission dialog rather than a preference.
 * Naming a project and then being made to point at a folder sent every new
 * person into the macOS file picker, and the first folder anyone opens there is
 * Desktop or Documents — which is exactly what raises the system's "Kosmos
 * wants to access files in your Documents folder" prompt. A person setting up a
 * product for the first time, three screens in, being asked by the operating
 * system whether to let it read their documents. Most say no, and the ones who
 * say yes have been taught that this app wants their files.
 *
 * So the DEFAULT asks for a name and makes `~/Kosmos/Projects/<name>` itself.
 * Nothing outside a folder Kosmos owns, and no picker. Pointing at a folder you
 * already have is still there, one link away, for the people whose work is
 * somewhere else — see the note on `create`.
 * ------------------------------------------------------------------------- */

/**
 * Where Kosmos makes project folders when it makes them itself.
 *
 * Overridable so a test can point it somewhere disposable. Without that, the
 * suite would create real directories in the operator's home — the same rule
 * every other root in this codebase is held to.
 */
/**
 * Open the folder in Finder. `open -R` selects it in its parent, which is
 * the "show me where it is" a person asked for, rather than dropping them
 * INSIDE it with no context. The path is the caller-validated stored
 * record's; runner injectable for tests, same shape as machine.js.
 */
let revealRunner = null;
function setRevealRunner(f) { revealRunner = f; }
function revealFolder(folder) {
  try {
    if (revealRunner) return revealRunner('/usr/bin/open', ['-R', folder]);
    execFileSync('/usr/bin/open', ['-R', folder], { timeout: 5000, stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    // ⚠️ A programming error must not wear the failure's clothes. This
    // catch once swallowed a ReferenceError (execFileSync unimported) into
    // "Finder did not open", blaming Finder for a missing import, forever,
    // invisibly -- and the runner-injected tests replaced the exact broken
    // line. Real open failures are Errors from execFileSync; anything else
    // is ours and throws loud.
    if (err instanceof ReferenceError || err instanceof TypeError) throw err;
    return { ok: false, because: 'Finder did not open' };
  }
}

/**
 * The files in a project's folder, newest first.
 *
 * ⚠️ TOP LEVEL ONLY, AND FILES ONLY. A project folder is a place a person and
 * their agents both write into, so it will contain subfolders, and walking them
 * would turn "the last ten documents" into a crawl of somebody's whole working
 * tree. Directories, dotfiles and anything that is not a regular file are left
 * out — a symlink is not listed, because the thing it points at is what would
 * open and this list would be naming the wrong file.
 *
 * Returns a REASON rather than an empty array when it cannot read, because
 * "this project has no documents" and "we could not look" are different
 * sentences and only one of them is about the project.
 */
function listFiles(folder, limit) {
  const state = folderState(folder);
  if (!state || state.state !== FOLDER.READABLE) {
    return { ok: false, because: (state && state.because) || 'we cannot read that folder right now', files: [] };
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
  let names;
  try {
    names = fs.readdirSync(state.real, { withFileTypes: true });
  } catch (err) {
    return { ok: false, because: 'we could not read what is in that folder', files: [] };
  }
  const files = [];
  for (const ent of names) {
    if (ent.name.startsWith('.')) continue;
    // ⚠️ isFile() on the DIRENT, so a symlink is excluded without a second
    // stat: withFileTypes reports the link itself, which is what we want here.
    if (!ent.isFile()) continue;
    let st;
    try { st = fs.statSync(path.join(state.real, ent.name)); } catch { continue; }
    files.push({ name: ent.name, size: st.size, modified: st.mtime.toISOString() });
  }
  files.sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
  /* ⚠️ `names` IS EVERY FILE, not the capped view, and it is here rather than
     behind a second route because the two answers must come from ONE read of
     the folder. A message body's path citations are matched against this list,
     so a name that is in the folder but past the cap would render as dead text
     while its neighbour rendered as a chip -- the same file, two appearances,
     decided by sort order. It carries no sizes or times: the matcher needs
     identity, and shipping more than that would invite a second, divergent
     documents list built off the wrong field. */
  return { ok: true, total: files.length, files: files.slice(0, cap), names: files.map((f) => f.name) };
}

/**
 * Open ONE file from a project's folder with the system opener.
 *
 * 🛑 THIS IS THE MOST DANGEROUS PRIMITIVE IN THIS MODULE and it is written to
 * refuse rather than to sanitise, the same rule `folderNameFor` follows and for
 * the same reason: this string becomes a path, and a path quietly changed into
 * a different path opens something nobody asked for. `open` will happily launch
 * an application or a script.
 *
 * Three independent gates, and the third is the one a name check cannot do:
 *
 *   1. The name must be a BARE FILENAME. Any separator, any `..`, any absolute
 *      path is refused outright rather than trimmed. The documents list is flat,
 *      so a bare name is all a caller ever legitimately has.
 *   2. The project's folder must be READABLE, by the same folderState every
 *      other folder-touching route already goes through.
 *   3. The RESOLVED target must still sit inside the RESOLVED folder, and must
 *      be a regular file. A symlink planted inside the folder passes gate 1
 *      untouched and points wherever it likes; only resolving both sides and
 *      comparing can see that, which is why this gate exists separately from
 *      the first rather than being folded into it.
 */
function openFile(folder, name) {
  const given = String(name == null ? '' : name);
  if (!given) return { ok: false, because: 'no file was named' };
  if (given.includes('/') || given.includes('\\') || given === '.' || given === '..'
      || path.isAbsolute(given) || path.basename(given) !== given) {
    return { ok: false, because: 'that is not a file in this project' };
  }
  const state = folderState(folder);
  if (!state || state.state !== FOLDER.READABLE) {
    return { ok: false, because: (state && state.because) || 'we cannot find that folder right now, so there is nothing to open' };
  }
  let target;
  try {
    target = resolveReal(path.join(state.real, given));
  } catch {
    return { ok: false, because: 'that file is not there any more, or it was moved' };
  }
  const root = state.real.endsWith(path.sep) ? state.real : state.real + path.sep;
  if (!target.startsWith(root)) {
    return { ok: false, because: 'that file lives outside this project, so we will not open it' };
  }
  let st;
  try { st = fs.statSync(target); } catch { return { ok: false, because: 'that file is not there any more, or it was moved' }; }
  if (!st.isFile()) return { ok: false, because: 'that is not a file we can open' };
  try {
    if (revealRunner) return revealRunner('/usr/bin/open', [target]);
    execFileSync('/usr/bin/open', [target], { timeout: 5000, stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    // Same rule as revealFolder: ours throws loud, theirs reports.
    if (err instanceof ReferenceError || err instanceof TypeError) throw err;
    return { ok: false, because: 'that file did not open' };
  }
}

function projectsRoot() {
  return process.env.AGENT_WORKFORCE_PROJECTS
    || path.join(os.homedir(), 'Kosmos', 'Projects');
}

/**
 * The FOLDER name for a project called this, or a refusal.
 *
 * ⚠️ REFUSES rather than sanitises, for everything that could point the write
 * somewhere else. `create.js` refuses agent names on the same principle and for
 * the same reason: this string becomes a path, and a name that is quietly
 * changed into a different path is a folder somebody cannot find, or worse, one
 * they did not mean to write in. `..` is the case that matters and it is
 * refused outright — stripping it would silently make a DIFFERENT folder.
 *
 * ⚠️ SEPARATORS ARE THE ONE EXCEPTION, and they are replaced rather than
 * refused, because "Q3/Q4 planning" is a name a person really types and
 * refusing it teaches them the product is fussy about punctuation. The
 * replacement is not silent: the add screen shows the exact path before
 * anything is made, so what lands on disk is on screen first.
 */
/**
 * The one fold. Validation and production both call THIS, because deriving
 * the separator fold twice was the two-derivations habit this file keeps
 * warning about, one function apart (round 16: removing the fold from the
 * validator failed nothing, because the producer had its own copy).
 */
function foldSeparators(raw) {
  // ⚠️ `:` folds with the slashes (round 21, measured on this machine):
  // macOS stores a colon in the POSIX name but Finder RENDERS it as `/`, so
  // `Q3:Q4 planning` previews here as one name and appears in Finder as
  // `Q3/Q4 planning` -- and the path shown is meant to be the path they
  // find. The reverse mapping is the same legacy HFS rule that makes `/`
  // unusable, so all three fold to the same `-`.
  return raw.split('/').join('-').split('\\').join('-').split(':').join('-').trim();
}

function folderNameProblem(name) {
  const raw = oneLine(name);
  if (!raw) return 'give this project a name';
  // ⚠️ CHECKED BEFORE THE FOLD, NOT AFTER, and the difference is a real hole a
  // test found. Folding first turns `/` into `-`, which is not empty — so a
  // project named `/` sailed past the emptiness check and got a folder called
  // `-`. Harmless as an escape (it stays inside the root) and nonsense as a
  // folder somebody has to find later. Ask whether there is a NAME in there
  // before asking what it folds to.
  if (!raw.split('/').join('').split('\\').join('').split(':').join('').trim()) {
    return 'that name is only slashes or colons, so there is no folder name in it';
  }
  const folded = foldSeparators(raw);
  if (!folded) return 'that name is only slashes or colons, so there is no folder name in it';
  // `.` and `..` ARE the current and parent directory; a leading dot is a
  // hidden folder the person would never see again in Finder.
  if (folded === '.' || folded === '..') return 'that name means a folder that already has a meaning on this computer';
  if (folded.startsWith('.')) return 'a name starting with a dot makes a folder your Mac hides, so pick another';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(folded)) return 'that name has characters we cannot make a folder out of';
  if (folded.length > 60) return 'that name is too long to make a folder out of; keep it to 60 characters';
  return null;
}

function folderNameFor(name) {
  const problem = folderNameProblem(name);
  if (problem) throw new Error(problem);
  return foldSeparators(oneLine(name));
}

/** The exact path a project of this name would get, so a screen can show it. */
function folderPathFor(name) {
  return path.join(projectsRoot(), folderNameFor(name));
}

/**
 * The path a screen may SHOW for this name: folderPathFor, with the same
 * one-segment case correction makeFolder will apply when the button is
 * pressed. Read-only (trueChildName only lists the parent; nothing is made).
 *
 * ⚠️ Without this, the preview and the act can disagree in case: on macOS's
 * case-insensitive volume, typing `lease` beside an existing `Lease` shows
 * "Kosmos will make this at …/lease" and then ADOPTS `…/Lease` -- a sentence
 * about where a folder will be that the act does not match, on the screen
 * whose whole job is saying the path before anything is made.
 */
function folderPathPreview(name) {
  const dest = folderPathFor(name);
  const corrected = path.join(path.dirname(dest), trueChildName(path.dirname(dest), path.basename(dest)));
  // ⚠️ WHETHER IT ALREADY EXISTS travels with the path, because "make" and
  // "adopt" are different acts and the screen was claiming the first while
  // makeFolder performed the second (round 17): a person typing `lease`
  // beside their existing Lease folder was told Kosmos WILL MAKE a folder,
  // and pressing Add adopted the folder and its contents. Same statSync
  // shape makeFolder itself uses; a stat we cannot take reads as
  // not-existing, which errs toward the weaker claim.
  // ⚠️ THREE arms, because makeFolder has three (round 23): a FILE at the
  // derived path is neither make nor adopt -- makeFolder will refuse it --
  // and folding it into exists:false had the preview promising "will make
  // this at X" about an act the engine had already decided not to perform.
  // `blocked` carries makeFolder's own refusal sentence so the preview and
  // the button speak identically.
  let there = null;
  try { there = fs.statSync(corrected); } catch { there = null; }
  const exists = !!(there && there.isDirectory());
  const blocked = (there && !there.isDirectory())
    ? 'there is already a file with that name where this project’s folder would go'
    : null;
  return { path: corrected, exists, blocked };
}

/**
 * Make it, or adopt it if it is already there.
 *
 * ⚠️ AN EXISTING FOLDER IS ADOPTED, NOT REPLACED, and nothing in it is touched.
 * Same rule as everywhere else here: this product does not delete anybody's
 * work. A person who made `~/Kosmos/Projects/Henderson lease` themselves gets
 * the folder they made. A FILE by that name is refused, because there is
 * nothing sensible to do with it and overwriting it is not on the list.
 */
function makeFolder(name) {
  const dest = folderPathFor(name);
  let there = null;
  try { there = fs.statSync(dest); } catch { there = null; }
  if (there && !there.isDirectory()) {
    throw new Error('there is already a file with that name where this project’s folder would go');
  }
  if (!there) {
    try {
      fs.mkdirSync(dest, { recursive: true });
    } catch (err) {
      // ⚠️ The errno and its absolute path stay OFF the screen (round 24):
      // this sentence goes to the person verbatim, and the branch's own
      // rule two files over (appendMessage's sentence, with a test pinning
      // /EISDIR|\/var\/folders/ absent) is that a raw err.message is a
      // machine's sentence in a person's mouth. The one useful word is
      // whether it is a permissions wall, said in ours.
      const denied = err && (err.code === 'EACCES' || err.code === 'EPERM');
      throw new Error(denied
        ? 'we could not make a folder for this project: this Mac would not let us write there'
        : 'we could not make a folder for this project');
    }
  }
  /**
   * ⚠️ THE SPELLING THE FILESYSTEM USES — FOR THE ONE SEGMENT WE DERIVED, and
   * not a single character more.
   *
   * On macOS's case-insensitive volume, a project called `lease` next to an
   * existing folder called `Lease` ADOPTS that folder — `statSync` finds it,
   * because they are the same directory — and returning `dest` would store
   * `…/lease`, naming a folder Finder will never show them.
   *
   * ⚠️ AND IT IS DELIBERATELY NOT `resolveReal(dest)`, which was the first
   * version of this line and was wrong in a way the tests caught immediately:
   * a full resolve also follows SYMLINKS, so on this machine it rewrote
   * `/var/folders/…` to `/private/var/folders/…`. `folderState`'s own docstring
   * settles that question — showing the stored path is defensible because it is
   * the path the person picked, and swapping to the resolved one "is a product
   * decision about what a project IS, not a passing correction". Fixing a case
   * bug is not licence to make that decision quietly.
   *
   * So: the parent is left exactly as it was (it comes from the person's home
   * directory, which they recognise), and only the last segment — the part
   * derived from their typed name — is corrected against the parent's own
   * listing. That is the same instrument `create.test.js` uses for the identical
   * volume lesson, and it is exact on both kinds of volume: on a case-sensitive
   * one, `Lease` and `lease` are two entries and each matches itself.
   */
  return path.join(path.dirname(dest), trueChildName(path.dirname(dest), path.basename(dest)));
}

/**
 * How this directory really spells a child of this name.
 *
 * Answers the asked-for name unchanged when the listing cannot be read, or when
 * it does not hold exactly one case-insensitive match — an ambiguous answer is
 * not one to act on, and inventing a spelling is worse than keeping theirs.
 */
function trueChildName(parent, name) {
  let entries;
  try { entries = fs.readdirSync(parent); } catch { return name; }
  const wanted = name.toLowerCase();
  const matches = entries.filter((entry) => entry.toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : name;
}

/**
 * @param {string} [folder] the folder to point at. LEFT OUT on the default
 *   path, which makes `~/Kosmos/Projects/<name>` instead — see the block above
 *   `projectsRoot`. Supplying one is the "use a folder you already have" route,
 *   which is still fully supported and is the only way to reach work that lives
 *   somewhere else.
 */
function create({ name, folder, agents, roster, description } = {}) {
  const asked = String(folder == null ? '' : folder).trim();
  // ⚠️ On the default path the FOLDER-NAME refusal comes first, because it
  // is the sentence the person has been reading: the preview line under the
  // name box speaks folderNameProblem's words, and a name over both caps
  // used to meet cleanName's DIFFERENT sentence at the button after the
  // preview had said the 60-character one all along (round 16). One name,
  // one sentence, whichever screen it appears on.
  if (!asked) {
    const problem = folderNameProblem(name);
    if (problem) throw new Error(problem);
  }
  const title = cleanName(name);
  // ⚠️ BEFORE makeFolder, with every other refusal. This was the one
  // validation firing after the mkdir, so a type-refused description left
  // an empty folder no record pointed at -- and unlike the accepted
  // I/O-failure case below, nothing adopts it: a caller refused for a bad
  // body does not retry with the same bad body.
  const desc = cleanDescription(description);
  // ⚠️ Made BEFORE the duplicate check below rather than after, so a second
  // project of the same name meets "that folder is already the project X"
  // rather than a fresh empty directory nobody asked for. `makeFolder` adopts
  // an existing folder, so the retry is idempotent either way. The cost of
  // this ordering is accepted, not overlooked: if readAll/writeAll throws
  // after the mkdir, an empty folder is left with no project pointing at it.
  // That folder is exactly what the person's retry will adopt, so it is a
  // parked spot, not a leak.
  const given = asked || makeFolder(title);
  if (!path.isAbsolute(given)) throw new Error('that needs to be the full path to a folder');

  // ⚠️ Checked at creation AND on every read, and neither one is redundant.
  // This one stops a typo becoming a project pointing at nothing; the read-time
  // one catches the folder that is deleted next week. Only checking here would
  // leave a project asserting a folder that stopped existing the moment after.
  const state = folderState(given);
  if (state.state === FOLDER.MISSING) throw new Error('there is no folder at that path');
  if (state.state === FOLDER.NOT_A_FOLDER) throw new Error('that is a file, not a folder');
  if (state.state === FOLDER.UNREADABLE) throw new Error('we cannot read that folder');

  const all = readAll();
  const already = all.find((p) => folderState(p.folder).real === state.real);
  if (already) throw new Error(`that folder is already the project "${already.name}"`);

  // ⚠️ Coerced, not trusted. A caller handing `agents` a string or an object
  // put a raw TypeError through the route's catch and out to the person as
  // their error message.
  const members = [...new Set((Array.isArray(agents) ? agents : []).map(String).map((a) => a.trim()).filter(Boolean))];
  const now = new Date().toISOString();
  const project = {
    id: idFor(title, new Set(all.map((p) => p.id))),
    name: title,
    description: desc,
    folder: given,
    agents: members,
    everSeen: Object.fromEntries(members.map((a) => [
      a, Array.isArray(roster) ? roster.some((c) => c && c.sessionName === a) : null,
    ])),
    told: {},
    createdAt: now,
    updatedAt: now,
  };
  writeAll([...all, project]);
  return project;
}

function mutate(id, fn) {
  const all = readAll();
  const at = all.findIndex((p) => p.id === id);
  if (at < 0) throw new Error('there is no project by that name');
  const next = fn({ ...all[at] });
  next.updatedAt = new Date().toISOString();
  all[at] = next;
  writeAll(all);
  return next;
}

/**
 * Every writable field, applied in ONE mutate.
 *
 * ⚠️ One write on purpose. The PUT route used to run rename, setDescription
 * and setArchived as independent read-modify-writes -- so a failure in a
 * later one answered the caller "your save failed" about a change that had
 * already persisted. Validation happens for EVERY carried field BEFORE any
 * write (cleanName and cleanDescription throw; archived refuses anything
 * but a boolean, because `!!` would turn {"archived": "false"} into an
 * archive, the opposite of what the caller wrote), so a request either
 * applies whole or not at all.
 */
function edit(id, fields = {}) {
  const want = {};
  if (fields.name !== undefined) want.name = cleanName(fields.name);
  if (fields.description !== undefined) want.description = cleanDescription(fields.description);
  if (fields.archived !== undefined && typeof fields.archived !== 'boolean') {
    throw new Error('archived must be true or false');
  }
  if (!Object.keys(want).length && fields.archived === undefined) {
    // A save that would move nothing is refused, not answered "saved": a
    // typo'd key reporting success is a save the person believes happened.
    throw new Error('nothing here we can change');
  }
  return mutate(id, (p) => {
    const next = { ...p, ...want };
    if (fields.archived !== undefined) {
      next.archived = fields.archived;
      // Archiving an already-archived project keeps its original date;
      // restoring clears it rather than leaving a stale "archived at"
      // beside a project that is not archived.
      next.archivedAt = fields.archived
        ? ((p.archived === true && cleanArchivedAt(p.archivedAt)) || new Date().toISOString())
        : null;
    }
    return next;
  });
}

function rename(id, name) {
  // ⚠️ The id does NOT change with the name. It is what the agents' recorded
  // membership and any open URL point at, and renaming is a display change
  // rather than a new project.
  return edit(id, { name });
}

function setDescription(id, text) {
  // Records written before this field existed simply gain it here; readers
  // treat a missing description as ''.
  return edit(id, { description: text });
}

/**
 * Archive or restore a project.
 *
 * ⚠️ A display state, not a removal. The record stays in the store, the folder
 * is untouched, and the agents that were on it stay as they are -- so nothing
 * here re-tells the members: their instructions still describe a project that
 * still exists under the same name. Restoring clears the timestamp rather than
 * leaving a stale "archived at" beside a project that is not archived, which
 * would be a sentence about a thing that is no longer true.
 */
/**
 * An archive date is published only when it is a parseable STRING: the heal
 * for the flag taught the read side to distrust strays, and 12345 beside
 * archived:true rendered "Archived 1/1/1970" -- a confident date from a
 * distrusted field, one field over from the heal.
 */
function cleanArchivedAt(value) {
  if (typeof value !== 'string') return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * Archive or restore a project.
 *
 * ⚠️ A display state, not a removal. The record stays in the store, the folder
 * is untouched, and the agents that were on it stay as they are -- so nothing
 * here re-tells the members: their instructions still describe a project that
 * still exists under the same name. Restoring clears the timestamp rather than
 * leaving a stale "archived at" beside a project that is not archived, which
 * would be a sentence about a thing that is no longer true.
 */
function setArchived(id, want) {
  // One rule: this is edit with one field carried.
  return edit(id, { archived: want });
}

function addAgent(id, sessionName, roster) {
  const key = String(sessionName || '').trim();
  if (!key) throw new Error('choose an agent');
  // ⚠️ Whether we could see this agent AT THE MOMENT IT WAS ADDED is recorded,
  // because otherwise a typo'd name and a real agent that is temporarily
  // unreadable produce the identical sentence — "we cannot see this agent
  // right now" — and that collapses "this never existed" into "this is
  // missing". It is the same distinction `not_tried` versus `could_not` makes
  // for the instruction write, and it deserves the same care.
  const seen = Array.isArray(roster) ? roster.some((a) => a && a.sessionName === key) : null;
  return mutate(id, (p) => {
    if ((p.agents || []).includes(key)) return p;
    return {
      ...p,
      agents: [...(p.agents || []), key],
      everSeen: { ...(p.everSeen || {}), [key]: seen },
    };
  });
}

function removeAgent(id, sessionName) {
  const key = String(sessionName || '').trim();
  return mutate(id, (p) => {
    const told = { ...(p.told || {}) };
    const everSeen = { ...(p.everSeen || {}) };
    delete everSeen[key];
    // The record of having told it goes with the membership. Keeping it would
    // leave a stale "we told this agent" beside an agent that is no longer on
    // the project, which is a sentence about a thing that is not true any more.
    delete told[key];
    return { ...p, agents: (p.agents || []).filter((a) => a !== key), told, everSeen };
  });
}

/**
 * Remove a project.
 *
 * ⚠️ Removes OUR RECORD and nothing else. The folder, and everything in it, is
 * untouched — same rule as removing an agent, and for the same reason: this
 * product does not delete anybody's work, so the worst outcome of a misclick is
 * re-adding a folder. The managed block is cleared from the members' instruction
 * files by the caller, because that is a write per agent and each one can fail
 * on its own.
 */
function remove(id) {
  const all = readAll();
  const found = all.find((p) => p.id === id);
  if (!found) throw new Error('there is no project by that name');
  writeAll(all.filter((p) => p.id !== id));
  return found;
}

// ---------------------------------------------------------------------------
// Telling the agent where its work is
// ---------------------------------------------------------------------------

/**
 * Where the managed block IS, or null.
 *
 * ⚠️ ONE rule, two callers, and that is the point. `removeBlock` had its own
 * idea of where the block starts — `indexOf(BLOCK_START)` from zero — and it
 * was WRONG in exactly the case `spliceBlock` had already been hardened
 * against. Measured: an instruction file carrying a stranded start marker plus
 * a real block lost the user's whole "## House rules" section on removal, and
 * `syncAgent` still answered `told`, so the screen said "Kosmos told it where
 * this folder is" about a write that had just eaten somebody's words. Two
 * derivations of one question is this codebase's worst habit and it grew back
 * inside the fix for the last instance of it.
 *
 * BOTH single-marker cases are reachable from a hand edit or an interrupted
 * write, and each breaks a different naive rule:
 *   a stranded START before a real block — first-start-to-first-end spans them
 *     and eats everything between;
 *   a stranded END before a real block — first-end-then-look-backwards finds no
 *     start, so a block is appended EVERY time and the file grows without bound
 *     until it outgrows the write limit and every save fails, including the
 *     person's own.
 * So: pair the markers, and refuse rather than guess. `findBlock` scans STARTS
 * left to right and takes the first one whose next marker is an END with no
 * second START in between; a stranded marker on either side is skipped rather
 * than paired across. Two well-formed blocks are AMBIGUOUS and refused outright
 * — that refusal is the load-bearing half, and an earlier version of this
 * paragraph described a "first end with a start before it" scan that appears
 * nowhere in the file and does not mention the refusal at all.
 */
function findBlock(text, startMark = BLOCK_START, endMark = BLOCK_END) {
  const original = String(text == null ? '' : text);
  // ⚠️ THIS FUNCTION HAS BEEN WRONG THREE TIMES, each time in a damaged shape
  // the version before it had not considered, and each fix was written against
  // the single case in front of it. So it is now paired with a MATRIX test over
  // every arrangement of a stray start and a stray end, before and after the
  // block — 25 shapes — instead of one fixture per round. The rule below is
  // what survives all of them.
  //
  // A block is a start, the FIRST end after it, and NO other start in between.
  // That "tight" condition is what stops a stray start from pairing with the
  // real block's end and swallowing everything the user wrote between them,
  // which is how two of the three earlier versions destroyed text.
  const tight = [];
  for (let at = 0; ; ) {
    const start = original.indexOf(startMark, at);
    if (start < 0) break;
    const end = original.indexOf(endMark, start + startMark.length);
    if (end < 0) break;
    const next = original.indexOf(startMark, start + startMark.length);
    if (next < 0 || next > end) tight.push({ start, end: end + endMark.length });
    at = start + startMark.length;
  }
  if (!tight.length) return null;
  // ⚠️ TWO WELL-FORMED BLOCKS ARE AMBIGUOUS, AND WE REFUSE RATHER THAN GUESS.
  // They are structurally identical, so picking one means overwriting a span of
  // somebody's file on a guess — and the matrix showed exactly that guess
  // deleting their words. This module's whole posture is that something we
  // cannot determine is reported rather than assumed, so the callers turn this
  // into a `could_not` carrying a reason a person can act on, and nothing is
  // written at all. Refusing costs the feature until the file is tidied;
  // guessing costs the file.
  if (tight.length > 1) return { ambiguous: true, pairs: tight.length };
  return tight[0];
}

/**
 * Replace the managed block in some instruction text, leaving everything else
 * exactly as it was.
 *
 * PURE and separately tested, because this is the function that can eat
 * somebody's words. The instruction file is described in its own module as
 * "the most powerful write in the product", and a projects feature has no
 * business being the thing that truncates one.
 */
function spliceBlock(text, body, startMark = BLOCK_START, endMark = BLOCK_END) {
  const original = String(text == null ? '' : text);
  const block = `${startMark}\n${body}\n${endMark}`;
  const at = findBlock(original, startMark, endMark);
  // Unchanged, byte for byte, when we cannot tell which block is ours. The
  // caller reports it; writing anything here would be the guess.
  if (at && at.ambiguous) return original;
  if (at) return original.slice(0, at.start) + block + original.slice(at.end);
  if (!original.trim()) return block + '\n';
  const sep = original.endsWith('\n') ? '\n' : '\n\n';
  return original + sep + block + '\n';
}

/**
 * Take the managed block out, leaving everything else exactly as it was.
 *
 * ⚠️ Returns the input UNCHANGED when there is no block, byte for byte. It used
 * to append a newline and collapse trailing blank lines even when it removed
 * nothing — and `tellAgent` only skips the write on exact equality, so a
 * no-op removal still rewrote `CLAUDE.md`. That rotates the one-deep
 * `.previous` backup `instructions.write` keeps (destroying the person's undo
 * of their OWN last edit) and flips the agent to "running on older
 * instructions" for a change that was not a change.
 */
function removeBlock(text, startMark = BLOCK_START, endMark = BLOCK_END) {
  const original = String(text == null ? '' : text);
  const at = findBlock(original, startMark, endMark);
  if (!at || at.ambiguous) return original;
  const before = original.slice(0, at.start);
  const after = original.slice(at.end);
  // The block was written with a blank line in front of it; take that back out
  // rather than leaving a growing gap where it used to be.
  return (before.replace(/\n{2,}$/, '\n') + after.replace(/^\n+/, '')) || '';
}

/**
 * One line of plain text, safe to put inside the managed block.
 *
 * ⚠️ THIS IS THE BOUNDARY OF THE MOST DANGEROUS WRITE IN THE PRODUCT, and it
 * had two holes, both measured:
 *
 * 1. A project NAME containing the end marker closed the block early. Everything
 *    after it landed permanently OUTSIDE the block, where this module can never
 *    rewrite or remove it — and every later sync appended another copy, growing
 *    the file until it crossed the size limit and every future write failed.
 * 2. A name containing newlines wrote arbitrary markdown headings and sentences
 *    into the file an agent boots from. Every agent runs at full permission, so
 *    that is instruction injection into the one file that tells it what it is.
 *
 * A folder path gets the same treatment: a newline is a legal character in a
 * macOS path, so the path is untrusted for exactly the same reason the name is.
 */
function oneLine(value) {
  return String(value == null ? '' : value)
    // Any run of whitespace, newlines included, becomes one space.
    .replace(/\s+/g, ' ')
    // Neutralised rather than stripped, so a name that contained one is still
    // recognisable to the person who typed it instead of silently changing.
    .split(BLOCK_START).join('(kosmos marker)')
    .split(BLOCK_END).join('(kosmos marker)')
    // The sibling block's pair too -- the older writer must know the newer
    // sibling's markers or it becomes the injection path into them.
    .split(YOU_START).join('(kosmos marker)')
    .split(YOU_END).join('(kosmos marker)')
    // And the colleagues pair, the moment tellAgent became that block's
    // healer: an inline pair smuggled through a project name would either
    // ambiguate the real block (silently disabling the heal) or make the
    // heal splice a colleagues body INTO the projects block of a file
    // that never had one -- the exact growth the heal's marker gate
    // refuses. Same lesson, third sibling.
    .split(messagesBlock().START).join('(kosmos marker)')
    .split(messagesBlock().END).join('(kosmos marker)')
    .trim();
}

function blockBody(projects, sessionName) {
  // ⚠️ Never reached with an empty list any more -- `tellAgent` REMOVES the
  // block instead of writing a placeholder. Kept as a guard rather than
  // deleted, because a caller that does reach it with nothing should not get
  // an empty heading.
  if (!projects.length) return 'Kosmos has not put this agent on a project yet.';
  // ⚠️ THE TEACHING HALF OF THE JOIN. The board only ever shows what an
  // agent SAYS it is on, and the matcher accepts exactly the spelling
  // "task <number>". These lines are where an agent learns both facts:
  // its open tasks, in that spelling, in the file it boots from. Without
  // this the join would be a convention nobody was told about.
  let any = false;
  // One resolution per block build, not one per project line (two to
  // three existsSync probes each).
  const cliShown = kosmosCliShown();
  const lines = projects.map((p) => {
    // The room command rides each project line (View D): this block
    // re-splices on every membership change, so it is the one surface
    // that teaches EXISTING agents the room exists, not only newborns.
    // ⚠️ The command is taught as THIS machine can run it (kosmosCli):
    // bare `kosmos` is not on a stock install's PATH, and an agent whose
    // shell says "command not found" never reaches the engine, so its
    // failure leaves no trace for anyone to find. Re-spliced on every
    // membership change, so existing agents get the corrected form.
    const head = `- **${oneLine(p.name)}**: \`${oneLine(p.folder)}\`` + (p.id
      ? `\n  - Post to everyone on it: \`${cliShown} post ${oneLine(String(p.id))} "your message"\``
      : '');
    const mine = (sessionName && Array.isArray(p.tasks))
      /* 🛑 THE ONE THAT WOULD HAVE BROKEN QUIETLY AND WORST. This is the list
         of "your open tasks" written into an agent's own instructions, and it
         is how an agent learns the `task <n>` spelling the join depends on. A
         task with parts has no `who`, so this dropped it, the agent never saw
         it, never reported it, and the board then showed "has not said it is
         on this" -- a true sentence about an agent that was never told. */
      ? p.tasks.filter((t) => t && require('./tasks').whoOf(t).includes(sessionName)
          && !require('./tasks').progressOf(t).closed
          && typeof t.number === 'number' && Number.isSafeInteger(t.number))
      : [];
    if (!mine.length) return head;
    any = true;
    return [head, ...mine.map((t) => `  - Task ${Number(t.number)}: ${oneLine(t.sentence)}`)].join('\n');
  });
  return [
    '## Your projects',
    '',
    'Kosmos records which projects you are on, and this is where their folders are.',
    '',
    ...lines,
    ...(any ? [
      '',
      'The indented lines are tasks written down for you. When you take one up,',
      'include "task <number>" in the commitment you report, so the board can',
      'show you are on it.',
    ] : []),
  ].join('\n');
}

/**
 * Write the managed block into one agent's instruction file.
 *
 * ⚠️ Goes through `instructions.read` and `instructions.write` rather than
 * touching the file, and that is not tidiness. That module refuses to replace a
 * file its own reader would not show, refuses an edit made while an editor was
 * open, contains the path three separate ways, and derives staleness. Writing
 * the file here would be a second derivation of the most dangerous write in the
 * product, and two derivations of one question is this codebase's worst habit.
 *
 * ⚠️ NEVER THROWS. A membership that is recorded but could not be announced is
 * a real, common state — `claudebot`, the fleet's own PM, has no worker folder
 * at all on this machine, measured 2026-08-11 — and it must be reportable
 * rather than fatal. Recording membership and telling the agent are two
 * different acts, and the second one failing must not undo the first.
 */
function tellAgent(sessionName, projects, roster) {
  try {
    // ⚠️ EXACT MATCH TO PERMIT, and this gate was MISSING while every sibling
    // route that touches an instruction file has one. `instructions.fileFor`
    // resolves through `store.safeKey`, which lowercases and strips everything
    // outside [a-z0-9_-] -- so ANY spelling that normalises to a real agent
    // wrote that agent's boot file. Measured: putting `An.gel` on a project
    // rewrote the real `angel`'s CLAUDE.md, while the screen said "we cannot
    // see this agent on this computer right now" AND "Kosmos told it where
    // this folder is" about the same row. This repo has fixed this exact shape
    // once before, on the profile route: LOOSE TO NOTICE, EXACT TO PERMIT.
    //
    // A roster of `null` means the caller could not look, which is not
    // permission -- it refuses, and says so, rather than writing on a guess.
    // ⚠️ `isNamedOurs` TOO, not just the name. `paneRoster` returns one entry
    // per session for EVERY pane on the machine, including a plain
    // `tmux new -s notes` shell -- so a session that merely shares a name was
    // enough permission to rewrite that agent's boot file. Remove gates the
    // equivalent destructive action on exactly this flag, and the status engine
    // states the rule outright: every read keyed on a pane name needs it.
    if (!Array.isArray(roster) || !roster.some((a) => a && a.sessionName === sessionName && a.isNamedOurs === true)) {
      return {
        state: TOLD.COULD_NOT,
        /**
         * ⚠️ THREE WORLDS REACH THIS RETURN, and only one of them is "not
         * there": an unreadable roster, a name held by something we will not
         * vouch for, and a name nothing holds. `isNamedOurs !== true` is the
         * second one, and it is the case the gate was written for. One
         * sentence covering all three said the name was not found, which is
         * false on that half. Split, in `addressable`'s words, so each arm is
         * true of its world.
         */
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running'
          : roster.some((a) => a && a.sessionName === sessionName)
            ? 'something is running under this name, but we cannot tell that it is this agent'
            : 'we could not find an agent with exactly this name on this computer',
      };
    }
    const current = instructions.read(sessionName);
    // ⚠️ Asks the reader's OWN structured verdict rather than re-deriving one.
    // `editable` is false for a file that exists but cannot be safely replaced —
    // a symlink, an oversized file, a mode-000 file — and the reader returns
    // `text: ''` for all of them. Splicing a block into that empty string and
    // saving it would replace somebody's real instructions with our block and
    // nothing else. `instructions.write` refuses this too; checking here as well
    // means the refusal arrives as a reportable verdict instead of an exception
    // that has to be pattern-matched.
    if (!current.exists && !current.editable) {
      return { state: TOLD.COULD_NOT, because: current.because || 'it keeps its instructions somewhere we cannot safely change' };
    }
    // ⚠️ We do not INVENT a boot file. An agent with no instruction file got
    // one containing nothing but our block -- so it booted from a file this
    // product made up, saying nothing about its job, and the instruction editor
    // flipped from "there is no instruction file for this one yet" to showing
    // our note as the agent's entire instructions. Writing the most powerful
    // file in the product for something nobody asked for is not ours to do.
    if (!current.exists) {
      return {
        state: TOLD.COULD_NOT,
        because: 'it has no instructions file yet, and we will not create one',
      };
    }
    // ⚠️ Two complete blocks in one file: we cannot tell which is ours, so we
    // say so rather than overwrite a span of somebody's file on a guess.
    const found = findBlock(current.text || '');
    if (found && found.ambiguous) {
      return {
        state: TOLD.COULD_NOT,
        because: `its instructions contain ${found.pairs} Kosmos project blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    // ⚠️ An agent on NO projects gets the block REMOVED, not replaced with a
    // note saying it is on none. Removing a project must not leave residue in
    // somebody's instruction file, and "Kosmos has not put this agent on a
    // project yet" sitting in a boot file forever is residue.
    let next = projects.length
      ? spliceBlock(current.text || '', blockBody(projects, sessionName))
      : removeBlock(current.text || '');
    // The colleagues block heals on EVERY event that writes this file
    // (here, and you.js's tellAgent -- an agent on no project still gets
    // About-you writes, and "piggyback on the one write" undercounted the
    // writers). It is spliced at birth and nothing else refreshed it, so
    // a corrected command (the PATH fix) would otherwise reach only
    // newborn agents. The heal itself is in healColleagues below.
    next = healColleagues(next);
    if (next === current.text) return { state: TOLD.TOLD, because: null };
    instructions.write(sessionName, next, current.version);
    return { state: TOLD.TOLD, because: null };
  } catch (err) {
    // ⚠️ A length refusal is OUR doing here, not the person's. Taking our block
    // back out can push a file under the editor's minimum, and forwarding that
    // module's sentence verbatim told somebody to "say what this agent is for
    // in at least 20 characters" about a shortening they did not perform.
    const raw = (err && err.message) || '';
    return {
      state: TOLD.COULD_NOT,
      because: /cannot be this short/.test(raw)
        ? 'taking this out would leave its instructions almost empty'
        : (/larger than an instruction file should be/.test(raw)
          // Same reason as the length case above: the file was already at the
          // limit, and telling somebody their file is too big for a write they
          // did not ask for aims the complaint at the wrong person.
          ? 'its instructions are already at the size limit'
          : (raw || 'we could not write to its instructions')),
    };
  }
}

/**
 * Heal a drifted colleagues block in place; NEVER introduce one.
 *
 * Shared by every ENGINE writer into an agent's instruction file (this
 * module's tellAgent and you.js's), so a projectless agent still heals on
 * an About-you write. The person's own instructions PUT deliberately does
 * NOT heal: their text is verbatim by design. Heal-only: spliceBlock APPENDS when the markers are
 * absent, which would grow an adopted agent's file nobody asked us to
 * grow, so a file without the markers (or with an ambiguous pair) comes
 * back byte-identical. Callers keep their own equality short-circuit, so
 * a no-drift file is never rewritten (protecting the one-deep .previous
 * undo).
 */
function healColleagues(text) {
  const mm = messagesBlock();
  const at = findBlock(String(text == null ? '' : text), mm.START, mm.END);
  if (!at || at.ambiguous) return text;
  return spliceBlock(text, mm.blockBody(), mm.START, mm.END);
}

/**
 * Tell one agent about every project it is on, and record how that went.
 *
 * ⚠️ The verdict is STORED, because it is a claim the screen makes and a claim
 * the screen makes has to survive a page reload. Deriving it live would mean
 * re-writing an instruction file to find out whether we could — the read is
 * cheap, the write is the most dangerous one here.
 */
function syncAgent(sessionName, roster) {
  const key = String(sessionName || '');
  const mine = readAll().filter((p) => (p.agents || []).includes(key));
  const verdict = tellAgent(key, mine, roster);
  const all = readAll();
  for (const p of all) {
    if (!(p.agents || []).includes(key)) continue;
    p.told = { ...(p.told || {}), [key]: { ...verdict, at: new Date().toISOString() } };
  }
  writeAll(all);
  return verdict;
}

module.exports = {
  FILE, FOLDER, TOLD, BLOCK_START, BLOCK_END, YOU_START, YOU_END,
  file, readAll, writeAll, idFor, folderState, describe,
  list, get, projectsFor, create, edit, rename, setDescription, setArchived, addAgent, removeAgent, remove, mutate,
  findBlock, spliceBlock, removeBlock, blockBody, tellAgent, syncAgent, groupBecause, healColleagues,
  projectsRoot, folderNameProblem, folderNameFor, folderPathFor,
  folderPathPreview, makeFolder, revealFolder, setRevealRunner, listFiles, openFile,
};
