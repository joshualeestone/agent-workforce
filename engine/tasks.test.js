const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tasks-'));
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
