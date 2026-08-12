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
const path = require('node:path');
const store = require('./store');
const instructions = require('./instructions');

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

const BLOCK_START = '<!-- kosmos:projects:start -->';
const BLOCK_END = '<!-- kosmos:projects:end -->';

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
function idFor(name, taken) {
  let base;
  try {
    base = store.safeKey(name);
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
 * ⚠️ `lstat` rather than `stat`, then a second look. A symlink to a directory
 * answers `isDirectory()` under `stat` and would be reported as an ordinary
 * folder — which is fine for a project, but it must be RESOLVED before it is
 * displayed, or the path on screen is not the path being worked in. The
 * resolved path is returned beside the stored one rather than replacing it, so
 * a link that later points somewhere else shows up as a change instead of
 * disappearing into an identical-looking row.
 */
function folderState(folder) {
  const given = String(folder || '');
  if (!given) return { state: FOLDER.MISSING, because: 'no folder was recorded for this project', real: null };
  let real = given;
  try {
    real = fs.realpathSync(given);
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
 * PURE, and takes the roster rather than fetching it, so the honest cases can
 * be tested against a fixture instead of against whatever tmux happens to be
 * running. The cases that matter are exactly the ones a live machine will not
 * reliably produce on demand.
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
function describe(project, roster) {
  const cards = Array.isArray(roster) ? roster : [];
  // ⚠️ Seeing an agent is remembered. `everSeen` was written once, at add time,
  // and never revisited -- so an agent added while tmux could not be read was
  // stamped "never seen" permanently, and said so about an agent we later saw
  // with our own eyes. Upgrading here, on the read, keeps the claim as weak as
  // the evidence: `false` survives only while nothing has ever contradicted it.
  let upgraded = null;
  for (const name of project.agents || []) {
    if (project.everSeen && project.everSeen[name] === false && cards.some((a) => a && a.sessionName === name)) {
      upgraded = upgraded || { ...(project.everSeen || {}) };
      upgraded[name] = true;
    }
  }
  if (upgraded) {
    try {
      const all = readAll();
      const at = all.findIndex((p) => p.id === project.id);
      if (at >= 0) { all[at].everSeen = { ...(all[at].everSeen || {}), ...upgraded }; writeAll(all); }
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
      state: card ? card.state : 'unknown',
      // ⚠️ "Never seen" is only said when we have never seen it. The flag is
      // written once at add time, and an agent added while the roster was
      // unreadable was stamped `false` forever -- so a real agent that stopped
      // later got "we have never seen an agent by this name", which is a
      // strictly stronger claim than the record supports. `describe` upgrades
      // the flag the moment a live card proves otherwise (see below), so this
      // can only fire for a name we genuinely have never resolved.
      because: card ? card.because : (
        (project.everSeen && project.everSeen[sessionName] === false)
          // Said plainly, because it is almost always a typed name that never
          // matched anything, and telling somebody an agent is "missing" sends
          // them looking for something that was never there.
          ? 'we have never seen an agent by this name on this computer'
          : 'we cannot see this agent on this computer right now'),
      told: project.told && project.told[sessionName] ? project.told[sessionName] : { state: TOLD.NOT_TRIED, because: null },
    };
  });

  return {
    ...project,
    folder: project.folder,
    folderState: folderState(project.folder),
    agents: members,
    // ⚠️ Deliberately NOT a health summary. It counts what is on screen so the
    // list row can say "1 needs you" the way the page does, and it carries
    // `unseen` beside the counts so a row can never quietly report that
    // everything is fine when some of it was unreadable. A summary that hides
    // its own blind spot is the defect this codebase keeps finding.
    summary: {
      total: members.length,
      needsYou: members.filter((m) => m.present && m.state === 'needs_you').length,
      working: members.filter((m) => m.present && m.state === 'working').length,
      unseen: members.filter((m) => !m.present).length,
    },
  };
}

function list(roster) {
  return readAll().map((p) => describe(p, roster));
}

function get(id, roster) {
  const found = readAll().find((p) => p.id === id);
  return found ? describe(found, roster) : null;
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
  return readAll()
    .filter((p) => (p.agents || []).includes(key))
    .map((p) => describe(p, roster));
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
  const title = oneLine(name);
  if (!title) throw new Error('give this project a name');
  if (title.length > 120) throw new Error('that name is longer than a project name should be');
  return title;
}

function create({ name, folder, agents, roster } = {}) {
  const title = cleanName(name);

  const given = String(folder == null ? '' : folder).trim();
  if (!given) throw new Error('choose the folder this project lives in');
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

function rename(id, name) {
  const title = cleanName(name);
  // ⚠️ The id does NOT change with the name. It is what the agents' recorded
  // membership and any open URL point at, and renaming is a display change
  // rather than a new project.
  return mutate(id, (p) => ({ ...p, name: title }));
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

function findBlock(text) {
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
    const start = original.indexOf(BLOCK_START, at);
    if (start < 0) break;
    const end = original.indexOf(BLOCK_END, start + BLOCK_START.length);
    if (end < 0) break;
    const next = original.indexOf(BLOCK_START, start + BLOCK_START.length);
    if (next < 0 || next > end) tight.push({ start, end: end + BLOCK_END.length });
    at = start + BLOCK_START.length;
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
 * So: scan ends left to right, and take the first one that has a start before
 * it.
 */
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
 * So: scan ends left to right, and take the first one that has a start before
 * it.
 */
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
 * So: scan ends left to right, and take the first one that has a start before
 * it.
 */
/**
 * Replace the managed block in some instruction text, leaving everything else
 * exactly as it was.
 *
 * PURE and separately tested, because this is the function that can eat
 * somebody's words. The instruction file is described in its own module as
 * "the most powerful write in the product", and a projects feature has no
 * business being the thing that truncates one.
 */
function spliceBlock(text, body) {
  const original = String(text == null ? '' : text);
  const block = `${BLOCK_START}\n${body}\n${BLOCK_END}`;
  const at = findBlock(original);
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
function removeBlock(text) {
  const original = String(text == null ? '' : text);
  const at = findBlock(original);
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
    .trim();
}

function blockBody(projects) {
  // ⚠️ Never reached with an empty list any more -- `tellAgent` REMOVES the
  // block instead of writing a placeholder. Kept as a guard rather than
  // deleted, because a caller that does reach it with nothing should not get
  // an empty heading.
  if (!projects.length) return 'Kosmos has not put this agent on a project yet.';
  const lines = projects.map((p) => `- **${oneLine(p.name)}** — \`${oneLine(p.folder)}\``);
  return [
    '## Your projects',
    '',
    'Kosmos records which projects you are on, and this is where their folders are.',
    '',
    ...lines,
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
        because: Array.isArray(roster)
          ? 'we cannot tie an agent by exactly this name to a session on this computer, so we did not write to anything'
          : 'we could not check which agents are running, so we did not write to anything',
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
      return { state: TOLD.COULD_NOT, because: current.because || 'this agent keeps its instructions somewhere we cannot safely change' };
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
        because: 'this agent has no instructions file yet, and we will not create one for it',
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
    const next = projects.length
      ? spliceBlock(current.text || '', blockBody(projects))
      : removeBlock(current.text || '');
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
        ? 'taking this out would leave its instructions almost empty, so we left them alone'
        : (/larger than an instruction file should be/.test(raw)
          // Same reason as the length case above: the file was already at the
          // limit, and telling somebody their file is too big for a write they
          // did not ask for aims the complaint at the wrong person.
          ? 'its instructions are already at the size limit, so we left them alone'
          : (raw || 'we could not write to this agent’s instructions')),
    };
  }
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
  FILE, FOLDER, TOLD, BLOCK_START, BLOCK_END,
  file, readAll, writeAll, idFor, folderState, describe,
  list, get, projectsFor, create, rename, addAgent, removeAgent, remove,
  findBlock, spliceBlock, removeBlock, blockBody, tellAgent, syncAgent,
};
