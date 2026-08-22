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
 * The column's list versus the whole list, per the pack's door rule: the
 * column shows a task with somebody on it that is not finished; finished
 * tasks and tasks nobody has picked up are both real and both behind the
 * door.
 */
function columnTasks(p) {
  return (p.tasks || []).filter((t) => t.who && !t.closedAt);
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
  if (!task || !task.who || task.closedAt) return null;
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

module.exports = { create, close, reopen, byNumber, columnTasks, claimFor, taskProblem, SENTENCE_MAX, DETAIL_MAX, WHO_MAX };
