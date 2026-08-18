'use strict';

/**
 * The person the agents work for, answered once.
 *
 * The pack's About-you step (first run, no skip, Josh's call): "if they
 * don't want to tell what they wanna be called and who they are then they
 * have no purpose in using this". Two required answers and one optional
 * one, stored in ONE local file, and taught to every agent in the file it
 * boots from -- a managed block with its own markers, beside (never inside)
 * the projects block, because the projects block is removed when an agent
 * leaves its last project and who the person is does not stop being true.
 *
 * ⚠️ The instruction write goes through the SAME machinery as the projects
 * block: projects.findBlock/spliceBlock/removeBlock, parameterized by
 * marker. One derivation of the tight-pair matching and the refuse-on-
 * ambiguity rule, because that logic is what keeps the most powerful write
 * in the product from eating somebody's words, and a second copy of it is
 * how a fix lands in one and not the other.
 *
 * ⚠️ This module writes one local file and local instruction files;
 * nothing else. That is a fact about the MODULE, not a privacy promise.
 * Those instruction files are prompt text, so what they contain reaches
 * Claude with every request the agent makes. The first-run copy says so
 * explicitly. Do not restore "nothing here leaves this computer" on the
 * strength of what this module does.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const instructions = require('./instructions');
const projects = require('./projects');

// Same layout convention as commitments.js: under a sandbox the env var IS
// the base (you.json sits directly in $AGENT_WORKFORCE_DATA), while in
// production store.ROOT carries the AgentWorkforce segment. The click
// drive's grandparent derivation depends on the sandboxed shape.
const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'you.json');

// Defined in projects.js beside the pair they must never be confused with,
// so oneLine (the projects block's own cleaner) can neutralise both.
const START = projects.YOU_START;
const END = projects.YOU_END;

const NAME_MAX = 80;
const DOES_MAX = 200;
const KNOW_MAX = 2000;

/**
 * Words, safe for the managed block. Same posture as projects.oneLine:
 * markers are neutralised rather than stripped, so what the person typed
 * stays recognisable instead of silently changing. `know` keeps its
 * newlines (it is a paragraph field); the two one-line answers do not.
 */
function clean(value, { multiline } = {}) {
  let s = String(value == null ? '' : value);
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  // Every sibling's marker pair, not only ours: a pair smuggled through a
  // typed answer would end a block early, ambiguate a real sibling block
  // (silently disabling its heal), or hand the colleagues heal a span to
  // replace inside somebody's own words. The colleagues pair joined this
  // list when tellAgent became that block's healer (same lesson, fourth
  // writer). Lazy require: you.js must not gain a cycle.
  const mm = require('./messages');
  for (const m of [START, END, projects.BLOCK_START, projects.BLOCK_END, mm.START, mm.END]) {
    s = s.split(m).join('(kosmos marker)');
  }
  return s.trim();
}

/** The refusal, or null. Same whole-or-not-at-all shape as tasks. */
function problem({ name, does, know } = {}) {
  if (typeof name !== 'string' || !name.trim()) return 'say what your agents should call you';
  if (name.trim().length > NAME_MAX) return `a name has to fit in ${NAME_MAX} characters`;
  if (typeof does !== 'string' || !does.trim()) return 'say what you do';
  if (does.trim().length > DOES_MAX) return `say what you do in ${DOES_MAX} characters or fewer`;
  if (know !== undefined && know !== null && know !== ''
      && (typeof know !== 'string' || know.length > KNOW_MAX)) {
    return `anything they should always know has to be words (${KNOW_MAX} characters or fewer)`;
  }
  return null;
}

/** Save the answers. Validated before the write; refusals throw. */
function save({ name, does, know } = {}) {
  const bad = problem({ name, does, know });
  if (bad) throw new Error(bad);
  const record = {
    name: clean(name),
    does: clean(does),
    know: (typeof know === 'string' && know.trim()) ? clean(know, { multiline: true }) : null,
    savedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
  return record;
}

/**
 * Three answers, never two: saved (with the record), absent (nobody has
 * answered -- the wizard's normal starting state, not a failure), and
 * unknown with the reason (a file we could not read or could not trust).
 * A hand-edited record that fails its own validation is unknown, never
 * silently half-served: a record with no name is not "saved".
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: 'absent', you: null, because: null };
    return { state: 'unknown', you: null, because: String((err && err.message) || 'we could not read the record') };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch {
    return { state: 'unknown', you: null, because: 'the record on disk is not something we can read' };
  }
  if (!rec || typeof rec !== 'object' || problem(rec)) {
    return { state: 'unknown', you: null, because: 'the record on disk does not hold the answers this screen saves' };
  }
  return {
    state: 'saved',
    you: {
      name: String(rec.name),
      does: String(rec.does),
      know: (typeof rec.know === 'string' && rec.know) ? rec.know : null,
      savedAt: (typeof rec.savedAt === 'string') ? rec.savedAt : null,
    },
    because: null,
  };
}

/** The block, in the voice the agent reads. */
function blockBody(you) {
  return [
    '## Who you work for',
    '',
    `${clean(you.name)}. ${clean(you.does)}`,
    ...(you.know ? ['', clean(you.know, { multiline: true })] : []),
  ].join('\n');
}

/**
 * Write (or remove) the you-block in one agent's instruction file.
 *
 * The guard sequence mirrors projects.tellAgent exactly, and the reasons
 * are that function's reasons: exact-match-to-permit on a TIED session,
 * the reader's own editable verdict, never inventing a boot file, refusing
 * two well-formed blocks, and never throwing -- a person the agents could
 * not be told about is a reportable state, not a fatal one. An ABSENT
 * record removes the block (no residue), same as leaving your last project.
 */
function tellAgent(sessionName, roster) {
  try {
    if (!Array.isArray(roster) || !roster.some((a) => a && a.sessionName === sessionName && a.isNamedOurs === true)) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: Array.isArray(roster)
          ? 'we cannot tie an agent by exactly this name to a session on this computer, so we did not write to anything'
          : 'we could not check which agents are running, so we did not write to anything',
      };
    }
    const current = instructions.read(sessionName);
    if (!current.exists && !current.editable) {
      return { state: projects.TOLD.COULD_NOT, because: current.because || 'this agent keeps its instructions somewhere we cannot safely change' };
    }
    if (!current.exists) {
      return { state: projects.TOLD.COULD_NOT, because: 'this agent has no instructions file yet, and we will not create one for it' };
    }
    const found = projects.findBlock(current.text || '', START, END);
    if (found && found.ambiguous) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: `its instructions contain ${found.pairs} Kosmos about-you blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    const record = read();
    if (record.state === 'unknown') {
      return { state: projects.TOLD.COULD_NOT, because: record.because };
    }
    let next = record.state === 'saved'
      ? projects.spliceBlock(current.text || '', blockBody(record.you), START, END)
      : projects.removeBlock(current.text || '', START, END);
    // A projectless agent never passes through projects.tellAgent, so the
    // colleagues block heals on THIS writer too: same shared, marker-gated
    // heal, and the equality short-circuit below still protects the
    // one-deep .previous undo on a no-drift file.
    next = projects.healColleagues(next);
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null };
    instructions.write(sessionName, next, current.version);
    return { state: projects.TOLD.TOLD, because: null };
  } catch (err) {
    const raw = (err && err.message) || '';
    return {
      state: projects.TOLD.COULD_NOT,
      because: /cannot be this short/.test(raw)
        ? 'taking this out would leave its instructions almost empty, so we left them alone'
        : (/larger than an instruction file should be/.test(raw)
          ? 'its instructions are already at the size limit, so we left them alone'
          : (raw || 'we could not write to this agent’s instructions')),
    };
  }
}

/**
 * Tell every tied agent on the machine, and report how each went.
 *
 * Only TIED sessions are attempted -- an untied pane is a name we will not
 * write under, and tellAgent would refuse it per card anyway; skipping it
 * here keeps the report about agents rather than strangers. A roster we
 * could not read tells nobody and says so once.
 */
function syncEveryone(roster) {
  if (!Array.isArray(roster)) {
    return [{ agent: null, state: projects.TOLD.COULD_NOT, because: 'we could not check which agents are running, so we did not write to anything' }];
  }
  const told = [];
  for (const a of roster) {
    if (!a || !a.sessionName || a.isNamedOurs !== true) continue;
    told.push({ agent: a.sessionName, ...tellAgent(a.sessionName, roster) });
  }
  return told;
}

module.exports = { FILE, START, END, NAME_MAX, DOES_MAX, KNOW_MAX, problem, save, read, blockBody, tellAgent, syncEveryone };
