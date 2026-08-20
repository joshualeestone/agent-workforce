'use strict';

/**
 * Tests for the person record and its managed block.
 *
 * Sandbox-every-root: DATA (the record), WORKERS (instruction files the
 * tell writes), HOME (status resolves the session registry under it), and
 * PROJECTS (you.js requires projects, whose store defaults live).
 *
 *   node --test engine/you.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-you-data-'));
const WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-you-workers-'));
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-you-home-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-you-projects-'));

const you = require('./you');
const projects = require('./projects');
const fleet = require('../test-support/fleet');

const GOOD = { name: 'Josh', does: 'Runs a company that builds AI tools', know: 'No em dashes.' };

function bootFile(name) {
  return path.join(WORKERS, name, 'CLAUDE.md');
}
function plantAgent(name, text) {
  fs.mkdirSync(path.join(WORKERS, name), { recursive: true });
  fs.writeFileSync(bootFile(name), text, 'utf8');
}
const BOOT = 'You are **Casey**.\n\nDo the work well, and say what you did.\n';

test('the answers are validated whole-or-not-at-all, and the record round-trips', () => {
  assert.throws(() => you.save({ does: 'x' }), /call you/);
  assert.throws(() => you.save({ name: 'J' }), /what you do/);
  assert.throws(() => you.save({ name: 'x'.repeat(you.NAME_MAX + 1), does: 'y' }), /characters/);
  assert.throws(() => you.save({ name: 'J', does: 'y'.repeat(you.DOES_MAX + 1) }), /characters/);
  assert.throws(() => you.save({ name: 'J', does: 'y', know: 42 }), /words/);
  assert.equal(you.read().state, 'absent', 'an unanswered record is absent, not an error');

  const saved = you.save(GOOD);
  assert.equal(saved.name, 'Josh');
  const back = you.read();
  assert.equal(back.state, 'saved');
  assert.deepEqual({ name: back.you.name, does: back.you.does, know: back.you.know },
    { name: GOOD.name, does: GOOD.does, know: GOOD.know });

  // The optional answer really is optional, and absent reads as null.
  you.save({ name: 'Josh', does: 'Runs a company' });
  assert.equal(you.read().you.know, null);
});

test('a record we cannot trust is unknown with a reason, never half-served', () => {
  fs.writeFileSync(you.FILE, 'not json at all', 'utf8');
  assert.equal(you.read().state, 'unknown');
  // Hand-edited into an invalid shape: missing answers are not "saved".
  fs.writeFileSync(you.FILE, JSON.stringify({ name: 'Josh' }), 'utf8');
  const r = you.read();
  assert.equal(r.state, 'unknown');
  assert.ok(r.because, 'unknown carries its reason');
});

test('the block speaks the answers and neutralises the markers', () => {
  const body = you.blockBody({
    name: 'Josh ' + you.START,
    does: 'Builds\nthings',
    know: 'Watch for ' + projects.BLOCK_END,
  });
  assert.match(body, /## Who you work for/);
  assert.ok(!body.includes(you.START), 'a marker in an answer would end the block early');
  assert.ok(!body.slice(body.indexOf('Josh')).includes(projects.BLOCK_END), 'the projects marker is neutralised too');
  assert.match(body, /Builds things/, 'one-line answers collapse their newlines');

  // The colleagues pair as well, since tellAgent heals that block on every
  // membership sync: a smuggled pair would ambiguate the real block (heal
  // silently off) or hand the heal a span INSIDE the person's own words.
  const messages = require('./messages');
  const smuggled = you.blockBody({
    name: 'Josh',
    does: 'Builds things',
    know: 'A ' + messages.START + ' pair ' + messages.END + ' typed by hand',
  });
  assert.ok(!smuggled.includes(messages.START) && !smuggled.includes(messages.END),
    'a colleagues marker survived through a typed answer');
  assert.ok(smuggled.includes('(kosmos marker)'),
    'CONTROL: neutralization left no trace, so the absence above proves nothing');
});

test('tellAgent writes the block for a tied agent, and an absent record removes it', () => {
  you.save(GOOD);
  plantAgent('casey', BOOT);
  const roster = fleet.install([fleet.agent('casey', { state: 'idle' })]).agents;
  try {
    assert.equal(you.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    const text = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(text.includes(you.START) && text.includes('Who you work for') && text.includes('Josh'));
    assert.ok(text.includes('Do the work well'), 'the agent\'s own words survived');

    // Telling twice with no change writes nothing new (byte-for-byte skip).
    const before = fs.statSync(bootFile('casey')).mtimeMs;
    assert.equal(you.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    assert.equal(fs.statSync(bootFile('casey')).mtimeMs, before, 'an unchanged tell rewrote the file');

    // An absent record takes the block back out, leaving no residue.
    fs.rmSync(you.FILE);
    assert.equal(you.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    const after = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(!after.includes(you.START) && !after.includes('Who you work for'));
    assert.ok(after.includes('Do the work well'));
  } finally {
    fleet.restore();
  }
});

test('the tell refuses what its siblings refuse: untied names, missing files, unreadable rosters', () => {
  you.save(GOOD);
  plantAgent('borrowed', BOOT);
  const untied = fleet.install([fleet.stranger('borrowed')]).agents;
  try {
    const r1 = you.tellAgent('borrowed', untied);
    assert.equal(r1.state, projects.TOLD.COULD_NOT);
    // ⚠️ THE FIXTURE IS `stranger`, so something IS running under this name.
    // The pin used to read /could not find an agent with exactly this name/,
    // which is the sentence for a name that is NOT THERE -- so it certified
    // the one wording that is false of this test's own fixture. It asserts the
    // untied sentence now, and the not-there one is pinned separately below.
    assert.match(r1.because, /something is running under this name, but we cannot tell that it is this agent/,
      'the untied refusal denied the existence of the thing the roster just showed it');
    assert.doesNotMatch(r1.because, /could not find an agent/,
      'it says the name was not found, and the fixture is a pane holding exactly that name');
  } finally {
    fleet.restore();
  }
  // A folder with no boot file in it: we do not invent one. (No folder at
  // all refuses one branch earlier, with the reader's own sentence.)
  fs.mkdirSync(path.join(WORKERS, 'bootless'), { recursive: true });
  const tied = fleet.install([fleet.agent('bootless', { state: 'idle' })]).agents;
  try {
    const r2 = you.tellAgent('bootless', tied);
    assert.equal(r2.state, projects.TOLD.COULD_NOT);
    assert.match(r2.because, /no instructions file/);
  } finally {
    fleet.restore();
  }
  const r3 = you.tellAgent('casey', null);
  assert.equal(r3.state, projects.TOLD.COULD_NOT);
  assert.match(r3.because, /could not check which agents are running/);
});

test('syncEveryone tells the tied and skips the strangers', () => {
  you.save(GOOD);
  plantAgent('one', BOOT);
  plantAgent('two', BOOT);
  const roster = fleet.install([
    fleet.agent('one', { state: 'idle' }),
    fleet.agent('two', { state: 'idle' }),
    fleet.stranger('shady'),
  ]).agents;
  try {
    const told = you.syncEveryone(roster);
    assert.deepEqual(told.map((t) => t.agent).sort(), ['one', 'two'], 'a stranger was addressed');
    assert.ok(told.every((t) => t.state === projects.TOLD.TOLD), JSON.stringify(told));
    assert.ok(fs.readFileSync(bootFile('two'), 'utf8').includes('Who you work for'));
  } finally {
    fleet.restore();
  }
  const blind = you.syncEveryone(null);
  assert.equal(blind.length, 1);
  assert.equal(blind[0].state, projects.TOLD.COULD_NOT);
});

test('a projectless agent heals its stale colleagues block on an About-you write', () => {
  // The heal used to ride only projects.tellAgent, and an agent on no
  // project never passes through it -- its stale bare-kosmos teaching
  // would have outlived every About-you rewrite of the same file.
  const messages = require('./messages');
  you.save(GOOD);
  const stale = messages.START + '\nold body teaching bare kosmos\n' + messages.END;
  plantAgent('drift', BOOT + '\n' + stale + '\n');
  const roster = fleet.install([fleet.agent('drift', { state: 'idle' })]).agents;
  try {
    const v = you.tellAgent('drift', roster);
    assert.equal(v.state, projects.TOLD.TOLD, 'heal-path verdict: ' + v.because);
    const text = fs.readFileSync(bootFile('drift'), 'utf8');
    assert.ok(!text.includes('old body teaching bare kosmos'),
      'the stale colleagues body survived an About-you write');
    assert.ok(text.includes(' msg <their-name>'),
      'the healed block does not teach the msg command');
    assert.ok(text.includes('Do the work well'), 'the agent\'s own words survive');
  } finally {
    fleet.restore();
  }
});
