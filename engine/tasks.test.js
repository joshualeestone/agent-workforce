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
  assert.equal(tasks.create(p.id, { sentence: 'Seen', who: 'april' }, roster).whoSeen, true);
  assert.equal(tasks.create(p.id, { sentence: 'Typo', who: 'apirl' }, roster).whoSeen, false);
  assert.equal(tasks.create(p.id, { sentence: 'No roster', who: 'april' }, null).whoSeen, null);
  assert.equal(tasks.create(p.id, { sentence: 'Nobody' }).whoSeen, undefined);
});

test('close and reopen edit the record and nothing else', () => {
  const p = freshProject('Closing');
  tasks.create(p.id, { sentence: 'Done soon', who: 'april' });
  const closed = tasks.close(p.id, 1);
  assert.ok(closed.closedAt, 'close did not stamp');
  const reopened = tasks.reopen(p.id, 1);
  assert.equal(reopened.closedAt, null);
  assert.throws(() => tasks.close(p.id, 99), /no task by that number/);
});

test("the column shows a task with somebody on it that is not finished; everything else is behind the door", () => {
  const p = freshProject('Doors');
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
});

test('the described project carries claims joined from the real commitments store', () => {
  const commitments = require('./commitments');
  const p = freshProject('Join Home');
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
