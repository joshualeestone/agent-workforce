'use strict';

/**
 * Delete your history.
 *
 * 🛑 EVERY TEST HERE RUNS AGAINST A SANDBOXED DATA ROOT, SET BEFORE THE MODULE
 * LOADS, and that is not routine hygiene for this file: it is the one module in
 * the product whose whole job is `rmSync(..., {recursive: true})`. An
 * unsandboxed run of these tests would delete the operator's real
 * conversations, which is precisely the outcome the module is written to make
 * deliberate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-forget-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const store = require('./store');
const forget = require('./forget');

function seed() {
  fs.rmSync(nodePath.join(store.ROOT, 'chats'), { recursive: true, force: true });
  fs.rmSync(nodePath.join(SANDBOX, 'commitments'), { recursive: true, force: true });
  fs.mkdirSync(nodePath.join(store.ROOT, 'chats'), { recursive: true });
  fs.mkdirSync(nodePath.join(SANDBOX, 'commitments'), { recursive: true });
  fs.writeFileSync(nodePath.join(store.ROOT, 'chats', 'april.json'), '[]');
  fs.writeFileSync(nodePath.join(store.ROOT, 'chats', 'room-1.json'), '[]');
  fs.writeFileSync(nodePath.join(SANDBOX, 'commitments', 'april.json'), '{}');
  // The things that MUST survive, seeded so their survival is observed rather
  // than assumed.
  fs.mkdirSync(nodePath.join(store.ROOT, 'profiles'), { recursive: true });
  fs.mkdirSync(nodePath.join(store.ROOT, 'avatars'), { recursive: true });
  fs.writeFileSync(nodePath.join(store.ROOT, 'profiles', 'april.json'), '{"role":"Researcher"}');
  fs.writeFileSync(nodePath.join(store.ROOT, 'avatars', 'april.png'), 'not really a png');
  fs.writeFileSync(nodePath.join(store.ROOT, 'projects.json'), '[{"id":"p1"}]');
  fs.writeFileSync(nodePath.join(store.ROOT, 'first-run.json'), '{"completedAt":"x"}');
}

test('the summary counts what is there, per kind', () => {
  seed();
  const sum = forget.summary();
  assert.equal(sum.readable, true);
  assert.equal(sum.total, 3);
  const byKey = Object.fromEntries(sum.parts.map((p) => [p.key, p.count]));
  assert.deepEqual(byKey, { chats: 2, commitments: 1 });
  // The words the screen says come from here, so a change to them is a change
  // to a sentence somebody reads before an irreversible act.
  assert.deepEqual(sum.parts.map((p) => p.label), ['conversations', 'reports']);
});

test('an empty store reads as zero, not as unreadable', () => {
  seed();
  fs.rmSync(nodePath.join(store.ROOT, 'chats'), { recursive: true, force: true });
  fs.rmSync(nodePath.join(SANDBOX, 'commitments'), { recursive: true, force: true });
  const sum = forget.summary();
  assert.equal(sum.total, 0);
  /* ⚠️ AND IT IS STILL READABLE. "Nothing to delete" and "we could not look"
     must not collapse into one answer: the screen offers the button on the
     first and refuses it on the second. */
  assert.equal(sum.readable, true);
});

test('it deletes both kinds and NOTHING else', () => {
  seed();
  const out = forget.forget();
  assert.equal(out.ok, true, out.because);
  assert.equal(out.total, 3);
  assert.equal(fs.existsSync(nodePath.join(store.ROOT, 'chats')), false, 'the conversations survived');
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, 'commitments')), false, 'the reports survived');

  /**
   * 🔑 THE HALF THAT MATTERS MORE. A delete that removes the right things and
   * one extra is a worse failure than one that removes nothing, and nothing in
   * the "it deleted the chats" assertions above can see it. Each of these was
   * seeded above precisely so its survival is measured.
   *
   * ⚠️ The transcripts are not listed here because they are not in this root at
   * all -- they are Claude Code's, under ~/.claude/projects, shared across
   * accounts. That they are unreachable from this module is the guarantee; a
   * test asserting their survival would imply they were ever in scope.
   */
  for (const kept of [['profiles', 'april.json'], ['avatars', 'april.png']]) {
    assert.ok(fs.existsSync(nodePath.join(store.ROOT, ...kept)), kept.join('/') + ' was deleted');
  }
  assert.equal(fs.readFileSync(nodePath.join(store.ROOT, 'projects.json'), 'utf8'), '[{"id":"p1"}]',
    'projects were deleted or rewritten');
  assert.ok(fs.existsSync(nodePath.join(store.ROOT, 'first-run.json')), 'first-run was deleted');
  assert.ok(fs.existsSync(store.ROOT), 'the data folder itself was deleted');
});

test('deleting twice is not an error', () => {
  seed();
  assert.equal(forget.forget().ok, true);
  const again = forget.forget();
  assert.equal(again.ok, true, again.because);
  assert.equal(again.total, 0, 'the second pass claimed to delete things that were already gone');
});

test('the surface is exactly two names, and widening it takes an edit here', () => {
  /* 🛑 THE SCOPE IS THE FEATURE. This pins the list itself, so adding a third
     kind cannot happen as a side effect of some other change: it goes red, and
     whoever widened it has to say so in a diff somebody reads. */
  assert.deepEqual(forget.KINDS.map((k) => k.key), ['chats', 'commitments']);
});
