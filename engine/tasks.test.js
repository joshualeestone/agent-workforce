const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tasks-'));
// ⚠️ AND THE DATA ROOT: the join tests report commitments, and the
// commitments store defaults to the REAL app data of whoever runs the
// suite (sandbox-every-root: the un-sandboxed third root is the one that
// clobbers a live machine).
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tasks-data-'));
const projects = require('./projects');
const tasks = require('./tasks');
const fleet = require('../test-support/fleet');

function freshProject(name) {
  return projects.create({ name });
}

test('a task is validated whole-or-not-at-all before any write', () => {
  const p = freshProject('Gatekeeping');
  for (const [label, bad] of [
    ['no sentence', {}],
    ['a blank sentence', { sentence: '   ' }],
    ['a sentence over the cap', { sentence: 'x'.repeat(tasks.SENTENCE_MAX + 1) }],
    ['a non-string detail', { sentence: 'Real work', detail: 42 }],
    ['detail over the cap', { sentence: 'Real work', detail: 'y'.repeat(tasks.DETAIL_MAX + 1) }],
    // ⚠️ A present who that cannot be a name is REFUSED, never silently
    // stored as unassigned: a 200 with a "Nobody yet" task is an assignment
    // the person believes happened.
    ['a non-string who', { sentence: 'Real work', who: 42 }],
    ['an oversize who', { sentence: 'Real work', who: 'x'.repeat(tasks.WHO_MAX + 1) }],
  ]) {
    assert.throws(() => tasks.create(p.id, bad), Error, label);
    const after = projects.readAll().find((x) => x.id === p.id);
    assert.equal((after.tasks || []).length, 0, `${label}: the refusal wrote a task`);
    assert.ok(!after.taskCounter, `${label}: the refusal spent a number`);
  }
});

test('numbers are issued by the project, atomically with the task', () => {
  const p = freshProject('Numbering');
  const a = tasks.create(p.id, { sentence: 'First thing' });
  const b = tasks.create(p.id, { sentence: 'Second thing' });
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);
  // A second project issues its own 1: numbers are project-scoped.
  const q = freshProject('Numbering Two');
  assert.equal(tasks.create(q.id, { sentence: 'Other first' }).number, 1);
  // Closing does not free a number for reuse.
  tasks.close(p.id, 1);
  assert.equal(tasks.create(p.id, { sentence: 'Third thing' }).number, 3);
});

test('who records assignment with the everSeen honesty shape', () => {
  const p = freshProject('Assigning');
  // A real card from the fleet fixture, never a hand-built stand-in (the
  // fixture-discipline lint enforces this for exactly the dead-field class).
  const roster = fleet.install([fleet.agent('april', { state: 'idle' })]).agents;
  // Assignment requires membership, so the fixtures join first -- including
  // the typo'd name, because a mistyped MEMBER is a real recorded state
  // (the everSeen machinery in projects.js exists for exactly it).
  projects.addAgent(p.id, 'april', roster);
  projects.addAgent(p.id, 'apirl', roster);
  assert.equal(tasks.create(p.id, { sentence: 'Seen', who: 'april' }, roster).whoSeen, true);
  assert.equal(tasks.create(p.id, { sentence: 'Typo', who: 'apirl' }, roster).whoSeen, false);
  assert.equal(tasks.create(p.id, { sentence: 'No roster', who: 'april' }, null).whoSeen, null);
  assert.equal(tasks.create(p.id, { sentence: 'Nobody' }).whoSeen, undefined);
});

test('close and reopen edit the record and nothing else', () => {
  const p = freshProject('Closing');
  projects.addAgent(p.id, 'april', null);
  tasks.create(p.id, { sentence: 'Done soon', who: 'april' });
  const closed = tasks.close(p.id, 1);
  assert.ok(closed.closedAt, 'close did not stamp');
  const reopened = tasks.reopen(p.id, 1);
  assert.equal(reopened.closedAt, null);
  assert.throws(() => tasks.close(p.id, 99), /no task by that number/);
});

test("the column shows a task with somebody on it that is not finished; everything else is behind the door", () => {
  const p = freshProject('Doors');
  projects.addAgent(p.id, 'april', null);
  projects.addAgent(p.id, 'mikey', null);
  tasks.create(p.id, { sentence: 'Assigned open', who: 'april' });
  tasks.create(p.id, { sentence: 'Nobody yet' });
  tasks.create(p.id, { sentence: 'Assigned closed', who: 'mikey' });
  tasks.close(p.id, 3);
  const stored = projects.readAll().find((x) => x.id === p.id);
  const col = tasks.columnTasks(stored);
  assert.deepEqual(col.map((t) => t.sentence), ['Assigned open']);
  // The whole list still holds all three: the door is a filter, not a loss.
  assert.equal(stored.tasks.length, 3);
});

test('claimFor: deterministic word-bounded matching, three answers never two', () => {
  const mk = (items, state) => ({ state: state || 'holding', commitments: items.map((w) => ({ what: w })) });
  // ⚠️ task 1 never matches task 12: the boundary is the whole point of a
  // deterministic matcher over a fuzzy one.
  assert.deepEqual(tasks.claimFor({ number: 1, who: 'a' }, mk(['working on task 12'])), { claimed: false, because: null });
  assert.deepEqual(tasks.claimFor({ number: 12, who: 'a' }, mk(['working on task 12'])), { claimed: true, because: null });
  assert.deepEqual(tasks.claimFor({ number: 3, who: 'a' }, mk(['Task 3: the checklist'])), { claimed: true, because: null });
  // Case and spacing tolerated, exactly as the block teaches it.
  assert.equal(tasks.claimFor({ number: 7, who: 'a' }, mk(['TASK  7 rewrite'])).claimed, true);
  // A fresh CLEAR report is a real "has not said so", not an unknown.
  assert.deepEqual(tasks.claimFor({ number: 1, who: 'a' }, mk([], 'clear')), { claimed: false, because: null });
  // Could-not-read is null WITH its reason, and never either boolean.
  const un = tasks.claimFor({ number: 1, who: 'a' }, { state: 'unknown', commitments: [], because: 'stale' });
  assert.equal(un.claimed, null);
  assert.equal(un.because, 'stale');
  // Nothing to compute: unassigned and closed tasks.
  assert.equal(tasks.claimFor({ number: 1, who: null }, mk(['task 1'])), null);
  assert.equal(tasks.claimFor({ number: 1, who: 'a', closedAt: 'x' }, mk(['task 1'])), null);
  // A hand-edited store can hold a non-integer number, and 1.5 in a
  // pattern is regex (it would match "task 175"); the matcher refuses to
  // guess rather than matching by accident.
  const odd = tasks.claimFor({ number: 1.5, who: 'a' }, mk(['task 175']));
  assert.equal(odd.claimed, null);
  assert.match(odd.because, /whole number/);
  // And non-number types: Number(true) is 1 and Number(null) is 0, so a
  // coercing guard would let a hand-edited `number: true` render task 1's
  // definite claim.
  assert.equal(tasks.claimFor({ number: true, who: 'a' }, mk(['task 1'])).claimed, null);
  assert.equal(tasks.claimFor({ number: '1', who: 'a' }, mk(['task 1'])).claimed, null);
  // The decimal boundary cuts the OTHER way too: \b sits happily between
  // "1" and ".", so without the lookahead "task 1.5" in a REPORT would join
  // task 1. A sentence merely ending "task 1." still counts.
  assert.equal(tasks.claimFor({ number: 1, who: 'a' }, mk(['splitting task 1.5 today'])).claimed, false);
  assert.equal(tasks.claimFor({ number: 1, who: 'a' }, mk(['finished planning task 1.'])).claimed, true);
  // A state this module does not recognize is could-not-tell, never a
  // definite answer nobody computed.
  assert.equal(tasks.claimFor({ number: 1, who: 'a' }, mk(['task 1'], 'someday-vocabulary')).claimed, null);
});

test('a task cannot be given to an agent that is not on the project', () => {
  const p = freshProject('Members Only');
  // The screen only offers members; this refusal is for the API path,
  // where a 200-with-told for a stranger would claim a block write that
  // membership-derived syncAgent never made.
  assert.throws(() => tasks.create(p.id, { sentence: 'For a stranger', who: 'outsider' }),
    /not on this project/);
  const after = projects.readAll().find((x) => x.id === p.id);
  assert.equal((after.tasks || []).length, 0, 'the refusal wrote a task');
  assert.ok(!after.taskCounter, 'the refusal spent a number');
});

test('a task number an agent holds on two projects joins as could-not-tell on both', () => {
  const commitments = require('./commitments');
  const a = freshProject('Collide A');
  const b = freshProject('Collide B');
  projects.addAgent(a.id, 'twohats', null);
  projects.addAgent(b.id, 'twohats', null);
  tasks.create(a.id, { sentence: 'First on A', who: 'twohats' });
  tasks.create(b.id, { sentence: 'First on B', who: 'twohats' });
  tasks.create(b.id, { sentence: 'Second on B', who: 'twohats' });
  commitments.report('twohats', [
    { what: 'On task 1: whichever one this is' },
    { what: 'also holding task 2: the second thing' },
  ]);
  // Both cards refuse the definite answer: "task 1" cannot say which
  // project it means, and rendering a guess is the lie the null exists for.
  const gotA = projects.get(a.id, []);
  const gotB = projects.get(b.id, []);
  assert.equal(gotA.tasks[0].claim.claimed, null, 'ambiguous task 1 rendered a definite answer on A');
  assert.match(gotA.tasks[0].claim.because, /more than one/);
  assert.equal(gotB.tasks[0].claim.claimed, null, 'ambiguous task 1 rendered a definite answer on B');
  // The guard refuses only what it cannot tell apart: the unique number joins.
  assert.equal(gotB.tasks[1].claim.claimed, true, 'the guard over-fired on a unique number');
  // And closing one twin dissolves the collision for the survivor.
  tasks.close(a.id, 1);
  assert.equal(projects.get(b.id, []).tasks[0].claim.claimed, true, 'a closed twin still blocks the join');
});

test('a removed member\'s still-assigned task joins as could-not-tell, not as a definite claim', () => {
  const commitments = require('./commitments');
  const p = freshProject('Departures');
  projects.addAgent(p.id, 'leaver', null);
  tasks.create(p.id, { sentence: 'Held at departure', who: 'leaver' });
  commitments.report('leaver', [{ what: 'On task 1: the held thing' }]);
  assert.equal(projects.get(p.id, []).tasks[0].claim.claimed, true, 'the member\'s fresh report did not join');
  // Removal does not unassign (the given-to record is the person's), but a
  // non-member's report can no longer be checked against the taught
  // convention -- so the still-fresh report must stop rendering as definite.
  projects.removeAgent(p.id, 'leaver');
  const after = projects.get(p.id, []).tasks[0];
  assert.equal(after.who, 'leaver', 'removal silently unassigned the task');
  assert.equal(after.claim.claimed, null, 'a departed agent\'s report rendered as a definite claim');
  assert.match(after.claim.because, /no longer on the project/);
  // And the leftover does not HAUNT: the ambiguity count mirrors the taught
  // convention (member tasks only), so the same agent's open task 1 on the
  // project it is STILL on joins as unique despite the departed leftover.
  const q = freshProject('Departures Two');
  projects.addAgent(q.id, 'leaver', null);
  tasks.create(q.id, { sentence: 'Current home', who: 'leaver' });
  assert.equal(projects.get(q.id, []).tasks[0].claim.claimed, true,
    'a departed project\'s leftover task suppressed the live project\'s join');
});

test('a name held by an untied pane is not spoken for', () => {
  const commitments = require('./commitments');
  const p = freshProject('Borrowed');
  projects.addAgent(p.id, 'borrowed-name', null);
  tasks.create(p.id, { sentence: 'Held under a borrowed name', who: 'borrowed-name' });
  commitments.report('borrowed-name', [{ what: 'On task 1: the held thing' }]);
  // Tied pane: the record is the agent's word and the join renders it.
  const tied = fleet.install([fleet.agent('borrowed-name', { state: 'idle' })]).agents;
  assert.equal(projects.get(p.id, tied).tasks[0].claim.claimed, true, 'a tied pane did not join');
  // A stranger's pane under the name: every consumer of the commitments
  // store refuses to speak for a borrowed name, and the join is a consumer
  // (a-new-sibling-does-not-inherit-the-guard is how this gate gets missed).
  const untied = fleet.install([fleet.stranger('borrowed-name')]).agents;
  const got = projects.get(p.id, untied).tasks[0];
  assert.equal(got.claim.claimed, null, 'a borrowed name was spoken for');
  assert.match(got.claim.because, /cannot tell whether this is the same agent/,
    'the borrowed-name arm no longer says WHY it refuses; both sibling arms end alike, so the trailing clause cannot tell them apart');
  // And the gate fails CLOSED like its siblings: a roster we could not
  // read is not "we looked and no pane holds the name".
  const gotNull = projects.get(p.id, null).tasks[0];
  assert.equal(gotNull.claim.claimed, null, 'an unreadable roster joined as definite');
  assert.match(gotNull.claim.because, /could not check which agents are running/);
});

test('the described project carries claims joined from the real commitments store', () => {
  const commitments = require('./commitments');
  const p = freshProject('Join Home');
  projects.addAgent(p.id, 'joiner', null);
  projects.addAgent(p.id, 'never-reported', null);
  tasks.create(p.id, { sentence: 'Rewrite the checklist', who: 'joiner' });
  tasks.create(p.id, { sentence: 'Second thing', who: 'joiner' });
  tasks.create(p.id, { sentence: 'Nobody task' });
  // The agent reports, in the taught spelling, holding task 1 only.
  commitments.report('joiner', [{ what: 'On task 1: rewriting the checklist' }]);
  const got = projects.get(p.id, []);
  const [t1, t2, t3] = got.tasks;
  assert.equal(t1.claim.claimed, true, 'the reported task did not join');
  assert.equal(t2.claim.claimed, false, 'an unreported task shows a claim');
  assert.equal(t3.claim, undefined, 'an unassigned task grew a claim');
  // And an assignee with NO record reads as could-not-tell, never false.
  tasks.create(p.id, { sentence: 'Ghost task', who: 'never-reported' });
  const again = projects.get(p.id, []);
  assert.equal(again.tasks[3].claim.claimed, null, 'an absent record rendered as a definite answer');
});

test('the managed block teaches the join: tasks listed in the matching spelling, for the right agent only', () => {
  const p = freshProject('Teach Home');
  projects.addAgent(p.id, 'teachee', null);
  projects.addAgent(p.id, 'other', null);
  tasks.create(p.id, { sentence: 'Mine to do', who: 'teachee' });
  tasks.create(p.id, { sentence: 'Somebody else\'s', who: 'other' });
  tasks.create(p.id, { sentence: 'Closed already', who: 'teachee' });
  tasks.close(p.id, 3);
  const stored = projects.readAll().find((x) => x.id === p.id);
  const body = projects.blockBody([stored], 'teachee');
  assert.match(body, /- Task 1: Mine to do/, 'the open task is not taught');
  assert.ok(!/Somebody else/.test(body), 'another agent\'s task leaked into the block');
  assert.ok(!/Closed already/.test(body), 'a closed task is still taught');
  assert.match(body, /include "task <number>" in the commitment/, 'the convention line is missing');
  // One-arg compatibility: no session name, no task lines, no trailer.
  const bare = projects.blockBody([stored]);
  assert.ok(!/Task 1:/.test(bare) && !/task <number>/.test(bare), 'task lines appear with no agent to scope them');
});

test('a task records who added it, while the answer is still free', () => {
  const p = freshProject('Provenance');
  const t = tasks.create(p.id, { sentence: 'Rewrite the handoff checklist' });
  assert.equal(t.addedBy, 'operator',
    'nothing stored who added the task, so the page can only guess');
  // And it SURVIVES the write, which is the half a return value cannot prove.
  const stored = projects.readAll().find((x) => x.id === p.id).tasks[0];
  assert.equal(stored.addedBy, 'operator');
});

/* ---- parts (#206 step 2) ------------------------------------------------
   🔑 THE SHAPE OF THIS FEATURE IS A READ-TIME MIGRATION. Every task already on
   disk has a `who` and no `parts`, and a bulk rewrite of somebody's stored
   tasks is a chance to lose them for a shape change nobody asked for. So a
   legacy task DERIVES its single part on every read, and only new writes carry
   the field. These tests pin both shapes through the same readers. */

test('a legacy task derives exactly one part, and a finished one derives it finished', () => {
  const p = freshProject('Legacy parts');
  const open = tasks.create(p.id, { sentence: 'Rewrite the handoff checklist' });
  const nobody = tasks.create(p.id, { sentence: 'Nobody on this one' });
  const done = tasks.create(p.id, { sentence: 'An old one' });
  tasks.close(p.id, done.number);
  const stored = projects.readAll().find((x) => x.id === p.id);

  for (const [t, label] of [[tasks.byNumber(stored, open.number), 'open'],
    [tasks.byNumber(stored, nobody.number), 'unassigned'],
    [tasks.byNumber(stored, done.number), 'closed']]) {
    const parts = tasks.partsOf(t);
    /* ⚠️ ONE PART, NEVER ZERO, even with nobody on it. Mona Lisa's line: a task
       with no parts and a task with one unassigned part are different screens.
       The first has nothing to show; the second says "Nobody yet", which is the
       only state that is true of an existing task. */
    assert.equal(parts.length, 1, label + ': a legacy task did not derive exactly one part');
    assert.equal(parts[0].sentence, t.sentence, label + ": the part is the whole task, so it carries its sentence");
  }
  const closed = tasks.progressOf(tasks.byNumber(stored, done.number));
  assert.deepEqual([closed.done, closed.total], [1, 1], 'a finished task derives 1 of 1, not a finished parent over an open part');
  const still = tasks.progressOf(tasks.byNumber(stored, open.number));
  assert.deepEqual([still.done, still.total], [0, 1]);
});

test('adding a part to a legacy task keeps the part that was already there', () => {
  const p = freshProject('Legacy add');
  projects.addAgent(p.id, 'april');
  const t = tasks.create(p.id, { sentence: 'Rewrite it', who: 'april' });

  /* 🛑 THE TRAP. A legacy task has `who` and no `parts`. Store only the NEW
     part and the original assignment ceases to exist, because the derivation
     only fires on an empty array: the person adds a part and loses one. */
  const out = tasks.addPart(p.id, t.number, { sentence: 'Check it against the live flow' });
  assert.equal(out.ok, true, out.because);
  const parts = tasks.partsOf(out.task);
  assert.equal(parts.length, 2, 'adding a part swallowed the one that was already on the task');
  assert.equal(parts[0].who, 'april', 'the original assignment was lost');
  assert.equal(parts[1].who, null, 'a new part starts with nobody on it');
  assert.equal(out.task.who, undefined,
    'the legacy field survived alongside parts, so two fields now answer "who is on this"');
});

test('every reader treats a parts task exactly as it treats the legacy one', () => {
  /**
   * 🔑 THE POINT OF THIS TEST. Four separate places keyed on `t.who`, and a
   * task with parts has no `who` at all. Each would have failed SILENTLY and
   * differently: the column would hide the task, the claim would never be
   * computed, and the agent's own instructions would stop listing it -- so the
   * board would say "has not said it is on this" about an agent that was never
   * told the task existed.
   */
  const p = freshProject('Same to every reader');
  projects.addAgent(p.id, 'april');
  const legacy = tasks.create(p.id, { sentence: 'Legacy shape', who: 'april' });
  const modern = tasks.create(p.id, { sentence: 'Modern shape', who: 'april' });
  // force the modern one into the parts shape without changing anything else
  tasks.addPart(p.id, modern.number, { sentence: 'a second piece', who: 'april' });

  const stored = projects.readAll().find((x) => x.id === p.id);
  const inColumn = tasks.columnTasks(stored).map((t) => t.number);
  assert.ok(inColumn.includes(legacy.number), 'the premise: the legacy task is in the column');
  assert.ok(inColumn.includes(modern.number), 'a task with parts fell out of the column');

  assert.deepEqual(tasks.whoOf(tasks.byNumber(stored, modern.number)), ['april'],
    'the same agent, named twice, should read as one person on the task');

  /* 🛑 THE CLAIM JOIN, and it had no test at all until a mutation went
     unnoticed: reverting `joinTaskClaims` to `t.who` broke nothing red. A task
     with parts got no claim computed, so the card silently lost its
     says-it-is-on-this line and nobody would have known which change did it. */
  const commitments = require('./commitments');
  commitments.report('april', [{ what: 'On task ' + modern.number + ': the modern one' }]);
  const described = projects.get(p.id, []);
  const modernSeen = described.tasks.find((x) => x.number === modern.number);
  assert.equal(modernSeen.claim && modernSeen.claim.claimed, true,
    'a task with parts got no claim, so the card cannot say the agent is on it');
  const legacySeen = described.tasks.find((x) => x.number === legacy.number);
  assert.equal(legacySeen.claim && legacySeen.claim.claimed, false,
    'the premise: the unreported legacy task joins as a definite no');

  const block = projects.blockBody([stored], 'april');
  assert.match(block, new RegExp('Task ' + legacy.number), 'the premise: the legacy task is in the agent\'s instructions');
  assert.match(block, new RegExp('Task ' + modern.number),
    'a task with parts vanished from the agent\'s own instructions, so it would never be told');
});

test('a part can be given to somebody, finished, and put back', () => {
  const p = freshProject('Part verbs');
  projects.addAgent(p.id, 'april');
  const t = tasks.create(p.id, { sentence: 'Three pieces' });
  tasks.addPart(p.id, t.number, { sentence: 'Write it' });
  const two = tasks.partsOf(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), t.number));
  assert.equal(two.length, 2);

  const assigned = tasks.assignPart(p.id, t.number, two[1].id, 'april');
  assert.equal(assigned.ok, true, assigned.because);
  assert.equal(tasks.partsOf(assigned.task)[1].who, 'april');

  const closed = tasks.setPartClosed(p.id, t.number, two[1].id, new Date().toISOString());
  assert.equal(closed.ok, true, closed.because);
  const prog = tasks.progressOf(closed.task);
  assert.deepEqual([prog.done, prog.total, prog.closed], [1, 2, false],
    'one of two done should not close the parent');

  const back = tasks.setPartClosed(p.id, t.number, two[1].id, null);
  assert.equal(tasks.progressOf(back.task).done, 0);

  // and nobody on it again is a real state, not a refusal
  const off = tasks.assignPart(p.id, t.number, two[1].id, null);
  assert.equal(off.ok, true, off.because);
  assert.equal(tasks.partsOf(off.task)[1].who, null);
});

test('all parts done closes the parent, without anything storing that', () => {
  const p = freshProject('Derived close');
  const t = tasks.create(p.id, { sentence: 'Two pieces' });
  tasks.addPart(p.id, t.number, { sentence: 'the other piece' });
  const stored = () => tasks.byNumber(projects.readAll().find((x) => x.id === p.id), t.number);
  for (const part of tasks.partsOf(stored())) {
    tasks.setPartClosed(p.id, t.number, part.id, new Date().toISOString());
  }
  const prog = tasks.progressOf(stored());
  assert.equal(prog.closed, true, 'every part is finished and the task still reads as open');
  assert.equal(stored().closedAt, null,
    'the parent stored a closed stamp, so the derived state can now disagree with its parts');
});

test('a part needs words, and a part number that is not there is refused', () => {
  const p = freshProject('Part refusals');
  const t = tasks.create(p.id, { sentence: 'Something' });
  assert.equal(tasks.addPart(p.id, t.number, { sentence: '   ' }).ok, false);
  assert.match(tasks.addPart(p.id, t.number, {}).because, /say what this part is/);
  assert.match(tasks.assignPart(p.id, t.number, 99, 'april').because, /no part by that number/);
  assert.match(tasks.setPartClosed(p.id, t.number, 99, null).because, /no part by that number/);
});
