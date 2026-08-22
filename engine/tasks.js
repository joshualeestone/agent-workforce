/**
 * Tasks: things that need doing, which exist whether or not anyone is on
 * them (the pack's definition, stated on the project column). A task lives
 * INSIDE its project's record: its number is issued by the project and is
 * only unique there ("task 15" spans no projects), so the project is the
 * storage unit and the atomic write is the project store's own.
 *
 * ⚠️ WHAT A TASK DELIBERATELY DOES NOT HAVE, from the pack, because each
 * absence is a claim the system cannot check:
 *   - no writable STATUS: a new task has not started because nobody started
 *     it, and whether an agent is on it is engine/commitments.js's fact to
 *     observe, not a person's to type (the removed "Handed off" rule);
 *   - no person-chosen NUMBER: the project issues it;
 *   - no cross-project list anywhere down the line.
 *
 * ⚠️ CLOSING A TASK DOES NOT STOP AN AGENT. Verified in this repo when the
 * pack was drawn and still true: nothing in tasks can reach into a running
 * session. close() edits Kosmos's own record, exactly like
 * commitments.resolve(). The screen carries the sentence; this file
 * carries the mechanism that makes the sentence true.
 *
 * The `who` field records who the task was GIVEN to, with the same honesty
 * shape as project membership's everSeen: whether we could see that agent
 * at assignment time is recorded, so a typo and a temporarily unreadable
 * agent stay distinguishable later.
 */
const projects = require('./projects');

const SENTENCE_MAX = 200;
const DETAIL_MAX = 2000;

const WHO_MAX = 80;

function taskProblem({ sentence, detail, who } = {}) {
  if (typeof sentence !== 'string' || !sentence.trim()) {
    return 'say what needs doing';
  }
  if (sentence.trim().length > SENTENCE_MAX) {
    return `say what needs doing in ${SENTENCE_MAX} characters or fewer; the detail box below has the room`;
  }
  if (detail !== undefined && detail !== null
      && (typeof detail !== 'string' || detail.length > DETAIL_MAX)) {
    return `anything they should know has to be words (${DETAIL_MAX} characters or fewer)`;
  }
  // ⚠️ A PRESENT who is refused when it cannot be an agent's name, never
  // silently dropped: a caller who asked to assign and got a 200 with a
  // "Nobody yet" task believes an assignment happened. Absent/blank means
  // nobody, which is the modal's real default.
  if (who !== undefined && who !== null && who !== ''
      && (typeof who !== 'string' || !who.trim() || who.trim().length > WHO_MAX)) {
    return 'who is on it has to be an agent\'s name';
  }
  return null;
}

/**
 * Create a task on a project. Validated whole-or-not-at-all BEFORE the
 * write; the number is issued inside the same atomic mutate that stores
 * the task, so two concurrent creates cannot share one.
 */
function create(projectId, { sentence, detail, who } = {}, roster) {
  const problem = taskProblem({ sentence, detail, who });
  if (problem) throw new Error(problem);
  const whoKey = typeof who === 'string' && who.trim() ? who.trim() : null;
  const seen = (whoKey && Array.isArray(roster))
    ? roster.some((a) => a && a.sessionName === whoKey)
    : (whoKey ? null : undefined);
  let made;
  projects.mutate(projectId, (p) => {
    // ⚠️ Membership is checked HERE, inside the same read that stores the
    // task, never from a separate earlier read. The screen only offers
    // members, so this refusal is for the API path -- without it the route
    // answered `told` while syncAgent (which derives the block strictly
    // from membership) had silently written a block that never mentioned
    // the task. A refusal is honest; a told-when-not is the lie this
    // module's header forbids.
    if (whoKey && !(p.agents || []).includes(whoKey)) {
      throw new Error('that agent is not on this project, so the task cannot be given to it');
    }
    const number = (p.taskCounter || 0) + 1;
    made = {
      number,
      sentence: sentence.trim(),
      detail: (typeof detail === 'string' && detail.trim()) ? detail.trim() : null,
      who: whoKey,
      // undefined when unassigned (nothing to have seen); null when assigned
      // with no roster to check against; boolean when checked.
      whoSeen: seen,
      /* 🔑 WHO PUT IT THERE, STORED NOW WHILE THE ANSWER IS TRIVIAL. Only the
         operator can make a task today, so the page could hardcode "You" and
         be right -- and would go wrong silently the day an agent can add one,
         because nothing would have recorded the difference. Mona Lisa's note
         on the pack's "Added: You, yesterday": the field costs nothing while
         the answer is free and cannot be recovered afterwards.
         'operator' rather than a name: Kosmos has no accounts, so the only
         honest identity here is the person at the machine. */
      addedBy: 'operator',
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    return {
      ...p,
      taskCounter: number,
      tasks: [...(p.tasks || []), made],
    };
  });
  return made;
}

/**
 * Write a task's parts back, ALWAYS materialising the derived ones first.
 *
 * 🛑 THE TRAP THIS EXISTS TO CLOSE. A legacy task has `who` and no `parts`. Add
 * a second part to it and store only that one, and the FIRST part -- the
 * original assignment -- silently ceases to exist, because `partsOf` only
 * derives when the array is empty. The person adds a part and loses one.
 * So every write starts from `partsOf`, which is the derived list, and the
 * legacy `who` is retired in the same edit rather than left to disagree.
 */
function writeParts(projectId, n, fn) {
  let changed;
  projects.mutate(projectId, (p) => {
    const t = byNumber(p, n);
    if (!t) throw new Error('there is no task by that number on this project');
    const parts = fn(partsOf(t), t);
    if (!parts) throw new Error('that did not change anything');
    changed = { ...t, parts };
    /* ⚠️ `who` is DROPPED once parts are stored, not kept in step. Two fields
       answering "who is on this" is two things that disagree the first time
       one of them is edited, and every reader would then have to know which
       one wins. `partsOf` no longer looks at it once `parts` is there. */
    delete changed.who;
    return { ...p, tasks: (p.tasks || []).map((x) => (x.number === changed.number ? changed : x)) };
  });
  return changed;
}

function nextPartId(parts) {
  /* ⚠️ Never reused, including after a delete, for the reason the task number
     is never reused: an id that comes back means "part 2" stops meaning one
     thing forever. */
  return parts.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
}

/** Add a piece to a task. Its own sentence, and nobody on it until asked. */
function addPart(projectId, n, { sentence, who } = {}) {
  const said = typeof sentence === 'string' ? sentence.trim() : '';
  if (!said) return { ok: false, because: 'say what this part is' };
  if (said.length > SENTENCE_MAX) return { ok: false, because: `keep it under ${SENTENCE_MAX} characters` };
  const whoKey = typeof who === 'string' && who.trim() ? who.trim() : null;
  if (whoKey && whoKey.length > WHO_MAX) return { ok: false, because: 'who is on it has to be an agent\'s name' };
  const task = writeParts(projectId, n, (parts) =>
    parts.concat([{ id: nextPartId(parts), who: whoKey, sentence: said, closedAt: null }]));
  return { ok: true, task };
}

/** Put somebody on a part, or take them off it (`who: null`). */
function assignPart(projectId, n, partId, who) {
  const whoKey = typeof who === 'string' && who.trim() ? who.trim() : null;
  if (whoKey && whoKey.length > WHO_MAX) return { ok: false, because: 'who is on it has to be an agent\'s name' };
  let found = false;
  const task = writeParts(projectId, n, (parts) => parts.map((x) => {
    if (Number(x.id) !== Number(partId)) return x;
    found = true;
    return { ...x, who: whoKey };
  }));
  if (!found) return { ok: false, because: 'there is no part by that number on this task' };
  return { ok: true, task };
}

/** Finish a part, or put it back. The parent's state follows from its parts. */
function setPartClosed(projectId, n, partId, closedAt) {
  let found = false;
  const task = writeParts(projectId, n, (parts) => parts.map((x) => {
    if (Number(x.id) !== Number(partId)) return x;
    found = true;
    return { ...x, closedAt };
  }));
  if (!found) return { ok: false, because: 'there is no part by that number on this task' };
  return { ok: true, task };
}

function byNumber(p, n) {
  return (p.tasks || []).find((t) => t.number === Number(n));
}

/** Close: a record edit, never an act on an agent (see the header). */
function close(projectId, n) {
  return setClosed(projectId, n, new Date().toISOString());
}

/** Reopen: the undo of the one human verb. */
function reopen(projectId, n) {
  return setClosed(projectId, n, null);
}

function setClosed(projectId, n, closedAt) {
  let changed;
  projects.mutate(projectId, (p) => {
    const t = byNumber(p, n);
    if (!t) throw new Error('there is no task by that number on this project');
    changed = { ...t, closedAt };
    return {
      ...p,
      tasks: (p.tasks || []).map((x) => (x.number === changed.number ? changed : x)),
    };
  });
  return changed;
}

/**
 * A task's PARTS: the assignable things it is made of.
 *
 * 🔑 THE PARENT HAS NO ASSIGNEE OF ITS OWN. Mona Lisa's spec: a real job splits
 * into pieces needing different agents, so assignment lives on the part and the
 * parent is just the thing they add up to. Its state is DERIVED from its parts,
 * which is why it cannot disagree with them.
 *
 * 🛑 AND THE MIGRATION IS A READ, NOT A REWRITE. Every task already on disk has
 * a `who` and no `parts`, and a bulk pass over somebody's stored tasks is a
 * chance to lose them for a shape change nobody asked for. So this DERIVES the
 * parts of a legacy task every time it is read, and only new writes carry the
 * field. A record written in July keeps working in December with no upgrade
 * step and no version number.
 *
 * ⚠️ ONE PART, NEVER ZERO, when there is nobody on it. Mona Lisa's line
 * verbatim: "A task with no parts and a task with one unassigned part are
 * different screens: the first has nothing to show, the second says 'Nobody
 * yet', which is the state the pack draws and the only one that is true of an
 * existing task."
 */
function partsOf(task) {
  if (!task) return [];
  if (Array.isArray(task.parts) && task.parts.length) {
    return task.parts.map((part, i) => ({
      id: typeof part.id === 'number' ? part.id : i + 1,
      who: typeof part.who === 'string' && part.who.trim() ? part.who.trim() : null,
      /* A part with no sentence of its own IS the whole task, which is exactly
         what a migrated single part is. */
      sentence: (typeof part.sentence === 'string' && part.sentence.trim())
        ? part.sentence.trim() : task.sentence,
      closedAt: part.closedAt || null,
    }));
  }
  return [{
    id: 1,
    who: typeof task.who === 'string' && task.who.trim() ? task.who.trim() : null,
    sentence: task.sentence,
    /* ⚠️ The legacy task's own closedAt, so a finished task migrates to
       "1 of 1 done" rather than to a finished parent holding an open part.
       The two halves of one record must not disagree the moment they are read
       through a new shape. */
    closedAt: task.closedAt || null,
  }];
}

/**
 * What a person reads on the card: how many of a task's parts are finished.
 *
 * ⚠️ `done` is derived from the PARTS and never stored, so the sentence cannot
 * drift from the rows underneath it. A task whose parts are all closed IS
 * closed, whatever a parent field says.
 */
function progressOf(task) {
  const parts = partsOf(task);
  const done = parts.filter((x) => x.closedAt).length;
  return {
    parts,
    done,
    total: parts.length,
    /* The parent's own truth. `closedAt` on the task still exists and still
       wins when it is set, because closing a task is a thing a person does to
       the whole thing; all-parts-done is the other way in. */
    closed: Boolean(task && task.closedAt) || (parts.length > 0 && done === parts.length),
    assigned: parts.filter((x) => x.who).length,
  };
}

/** Whoever is on this task at all, for the join and the card's face. */
function whoOf(task) {
  const named = partsOf(task).map((x) => x.who).filter(Boolean);
  return [...new Set(named)];
}

/**
 * The column's list versus the whole list, per the pack's door rule: the
 * column shows a task with somebody on it that is not finished; finished
 * tasks and tasks nobody has picked up are both real and both behind the
 * door.
 */
function columnTasks(p) {
  /* ⚠️ THROUGH `whoOf` AND `progressOf`, not through `t.who`. Once a task
     stores parts it has no `who` at all, so the old test dropped every
     multi-part task out of the column silently -- the door would have shown
     tasks the column was hiding for no reason a person could see. */
  return (p.tasks || []).filter((t) => whoOf(t).length > 0 && !progressOf(t).closed);
}


/**
 * The JOIN, read side: does the assignee SAY it is on this task?
 *
 * ⚠️ Assignment is the join (the pack's rule): commitments knows what each
 * agent says it is holding; a task knows who it was given to. The match is
 * DETERMINISTIC, never fuzzy: a commitment counts only when its text names
 * "task <number>" (word-bounded, so task 1 never matches task 12). Agents
 * learn the convention from the managed block in their own instructions
 * (projects.blockBody lists their open tasks with exactly that spelling).
 *
 * Three answers, never two:
 *   { claimed: true }          a FRESH report names this task
 *   { claimed: false }         a fresh report exists and does not name it
 *                              (which is NOT "not started": it says only
 *                              that the agent has not said so)
 *   { claimed: null, because } we could not read what it reports (absent,
 *                              stale, unreadable) -- and null must never
 *                              render as either of the others
 * Unassigned and closed tasks have no claim to compute (null, no because).
 */
function claimFor(task, reading) {
  /* ⚠️ Same correction as columnTasks: a task with parts has no `who`, so this
     returned null for every assigned multi-part task and the card lost its
     says-it-is-on-this line with nothing saying why. The claim is still asked
     of the task as a whole (one report naming "task 15" is a claim about the
     task); per-part claims need a spelling agents have not been taught. */
  if (!task || whoOf(task).length === 0 || progressOf(task).closed) return null;
  // ⚠️ The DEFINITE branch is allowlisted, never the unknown one: a state
  // this module does not recognize (a future vocabulary word, a hand-edited
  // record) must fall to could-not-tell, because falling to true/false would
  // render a definite answer nobody computed. STATE comes from the producer,
  // so the two cannot drift.
  const { STATE } = require('./commitments');
  if (!reading || (reading.state !== STATE.HOLDING && reading.state !== STATE.CLEAR)) {
    return {
      claimed: null,
      because: (reading && reading.because) || 'we could not read what it reports holding',
    };
  }
  // Server-issued numbers are integers; a hand-edited store can hold
  // anything, and a non-integer interpolated into the pattern is regex
  // (1.5 matches "task 175"). Same way-out validation commitments.js does.
  const n = task.number;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    return { claimed: null, because: 'this task\'s number is not a whole number, so a report cannot name it' };
  }
  // The trailing guard is two lookaheads, not \b: \b sits happily between
  // "1" and ".", so "task 1.5" in a report would join task 1. Not-a-digit
  // blocks "task 12"; not-a-dot-then-digit blocks "task 1.5" while still
  // matching a sentence that simply ends "task 1."
  const re = new RegExp('\\btask\\s+' + n + '(?!\\d)(?!\\.\\d)', 'i');
  const named = (reading.commitments || []).some(
    (c) => c && typeof c.what === 'string' && re.test(c.what));
  return { claimed: named, because: null };
}

module.exports = { create, close, reopen, byNumber, columnTasks, claimFor, taskProblem,
  partsOf, progressOf, whoOf, addPart, assignPart, setPartClosed,
  SENTENCE_MAX, DETAIL_MAX, WHO_MAX };
