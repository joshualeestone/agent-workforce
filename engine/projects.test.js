'use strict';

/**
 * ⚠️ SANDBOX FIRST, BEFORE ANY REQUIRE.
 *
 * All three write roots, every time. `engine/projects` reaches `store.ROOT` for
 * its own file and `engine/instructions` for the agents' instruction files, and
 * those modules read their roots ONCE at require time. Setting these after the
 * require would sandbox nothing and the suite would edit the live fleet's real
 * instruction files — which is not littering, it is taking working agents off
 * the air by rewriting what they boot from.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-projects-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert');

const projects = require('./projects');
const store = require('./store');

// A folder that really exists, because every folder assertion in this module is
// a real stat and a fixture that lies about the filesystem cannot fail.
const WORK = path.join(SANDBOX, 'work');
fs.mkdirSync(WORK, { recursive: true });

function reset() {
  try { fs.rmSync(projects.file()); } catch { /* nothing written yet */ }
}

function folder(name) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** An agent with a real worker directory, so instruction writes can succeed. */
function agent(sessionName, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, sessionName);
  fs.mkdirSync(dir, { recursive: true });
  if (text != null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return dir;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

test('no projects yet reads as an empty list, not as an error', () => {
  reset();
  assert.deepEqual(projects.readAll(), []);
  assert.deepEqual(projects.list([]), []);
});

test('a project is created against a folder that really exists', () => {
  reset();
  const dir = folder('henderson');
  const p = projects.create({ name: 'Henderson lease', folder: dir });
  assert.equal(p.name, 'Henderson lease');
  assert.equal(p.folder, dir);
  assert.equal(projects.readAll().length, 1);
});

test('a folder that is not there is refused at creation', () => {
  reset();
  assert.throws(
    () => projects.create({ name: 'Ghost', folder: path.join(WORK, 'nope') }),
    /no folder at that path/,
  );
  assert.deepEqual(projects.readAll(), [], 'a refused project must not be half-written');
});

test('a file is refused as a project folder', () => {
  reset();
  const f = path.join(WORK, 'a-file.txt');
  fs.writeFileSync(f, 'x');
  assert.throws(() => projects.create({ name: 'File', folder: f }), /file, not a folder/);
});

test('a relative path is refused, because it is not a place', () => {
  reset();
  assert.throws(() => projects.create({ name: 'Rel', folder: 'work/thing' }), /full path/);
});

test('the same folder cannot become two projects', () => {
  reset();
  const dir = folder('shared');
  projects.create({ name: 'First', folder: dir });
  assert.throws(() => projects.create({ name: 'Second', folder: dir }), /already the project "First"/);
});

test('two projects named the same get different ids rather than one replacing the other', () => {
  reset();
  const a = projects.create({ name: 'Q3', folder: folder('q3-a') });
  const b = projects.create({ name: 'Q3.', folder: folder('q3-b') });
  assert.notEqual(a.id, b.id);
  assert.equal(projects.readAll().length, 2, 'the second must not have overwritten the first');
});

test('renaming changes the name and NOT the id, because the id is what membership points at', () => {
  reset();
  const p = projects.create({ name: 'Old', folder: folder('rename') });
  const after = projects.rename(p.id, 'New');
  assert.equal(after.id, p.id);
  assert.equal(after.name, 'New');
});

test('removing a project removes our record and NOT the folder', () => {
  reset();
  const dir = folder('keepme');
  fs.writeFileSync(path.join(dir, 'work.txt'), 'the user’s actual work');
  const p = projects.create({ name: 'Keep', folder: dir });

  projects.remove(p.id);

  assert.deepEqual(projects.readAll(), []);
  assert.ok(fs.existsSync(path.join(dir, 'work.txt')), 'this product does not delete anybody’s work');
});

// ---------------------------------------------------------------------------
// The folder, stated on every read
// ---------------------------------------------------------------------------

test('a folder that disappears AFTER creation reads as missing, and the project stays', () => {
  reset();
  const dir = folder('vanishing');
  projects.create({ name: 'Vanishing', folder: dir });

  // The control: it is readable BEFORE, or "missing" afterwards proves nothing.
  assert.equal(projects.list([])[0].folderState.state, projects.FOLDER.READABLE);

  fs.rmSync(dir, { recursive: true });

  const after = projects.list([]);
  assert.equal(after.length, 1, 'a project whose folder moved is shown, not dropped');
  assert.equal(after[0].folderState.state, projects.FOLDER.MISSING);
  assert.match(after[0].folderState.because, /not there any more, or it was moved/);
});

test('a folder we are not allowed to read reads as unreadable, not as missing', () => {
  reset();
  const dir = folder('locked');
  projects.create({ name: 'Locked', folder: dir });
  fs.chmodSync(dir, 0o000);
  try {
    const state = projects.list([])[0].folderState;
    // ⚠️ Running as root defeats this — the chmod holds but access still
    // succeeds — so the assertion is skipped rather than made to pass by
    // weakening it into something that cannot fail.
    if (state.state === projects.FOLDER.READABLE && process.getuid && process.getuid() === 0) return;
    assert.equal(state.state, projects.FOLDER.UNREADABLE);
    assert.notEqual(state.state, projects.FOLDER.MISSING, '"we cannot read it" is not "it is gone"');
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('a symlinked folder reports the path it really resolves to', () => {
  reset();
  const real = folder('real-target');
  const link = path.join(WORK, 'a-link');
  try { fs.rmSync(link); } catch { /* first run */ }
  fs.symlinkSync(real, link);

  projects.create({ name: 'Linked', folder: link });
  const state = projects.list([])[0].folderState;
  assert.equal(state.state, projects.FOLDER.READABLE);
  assert.equal(state.real, fs.realpathSync(real), 'the path shown must be the path worked in');
});

// ---------------------------------------------------------------------------
// Members — the display-name trap
// ---------------------------------------------------------------------------

const ROSTER = [
  { sessionName: 'mara', name: 'Mara', state: 'working', because: 'it is doing something' },
  // ⚠️ The fixture that matters: display name ≠ session name. Matching members
  // on `name` passes every test built from agents this app created, and fails
  // for exactly the pre-existing fleet the product exists to manage.
  { sessionName: 'claudebot', name: 'Splinter', state: 'needs_you', because: 'it is asking something' },
];

test('members are matched on the machine name and spoken as the display name', () => {
  reset();
  const p = projects.create({ name: 'Fleet', folder: folder('fleet'), agents: ['claudebot'] });
  const [described] = projects.list(ROSTER);

  const member = described.agents[0];
  assert.equal(member.sessionName, 'claudebot', 'we act on the machine name');
  assert.equal(member.name, 'Splinter', 'we speak the display name');
  assert.equal(member.present, true);
  assert.equal(p.agents[0], 'claudebot', 'the record stores the machine name');
});

test('a member we cannot see stays in the list, as unknown', () => {
  reset();
  projects.create({ name: 'Gone', folder: folder('gone'), agents: ['mara', 'ghost'] });
  const [described] = projects.list(ROSTER);

  // The control first: the one we CAN see is there and is not unknown.
  const mara = described.agents.find((a) => a.sessionName === 'mara');
  assert.equal(mara.present, true);
  assert.equal(mara.state, 'working');

  const ghost = described.agents.find((a) => a.sessionName === 'ghost');
  assert.ok(ghost, 'an agent we cannot find must not be dropped from its own project');
  assert.equal(ghost.present, false);
  assert.equal(ghost.state, 'unknown');
  assert.match(ghost.because, /cannot see this agent/);
});

test('the row summary counts what it can see AND says what it could not', () => {
  reset();
  projects.create({ name: 'Mixed', folder: folder('mixed'), agents: ['mara', 'claudebot', 'ghost'] });
  const [described] = projects.list(ROSTER);

  assert.equal(described.summary.total, 3);
  assert.equal(described.summary.working, 1);
  assert.equal(described.summary.needsYou, 1);
  assert.equal(described.summary.unseen, 1, 'a summary that hides its own blind spot is the defect');
});

test('an agent is on every project it was added to, read from the agent’s end', () => {
  reset();
  const a = projects.create({ name: 'One', folder: folder('one'), agents: ['mara'] });
  projects.create({ name: 'Two', folder: folder('two'), agents: ['claudebot'] });
  const c = projects.create({ name: 'Three', folder: folder('three'), agents: ['mara'] });

  const mine = projects.projectsFor('mara', ROSTER).map((p) => p.id);
  assert.deepEqual(mine.sort(), [a.id, c.id].sort());
  assert.deepEqual(projects.projectsFor('nobody', ROSTER), []);
});

test('adding the same agent twice does not put it on twice', () => {
  reset();
  const p = projects.create({ name: 'Dup', folder: folder('dup'), agents: ['mara'] });
  const after = projects.addAgent(p.id, 'mara');
  assert.deepEqual(after.agents, ['mara']);
});

test('removing an agent takes it off, and the control proves it was on', () => {
  reset();
  const p = projects.create({ name: 'Off', folder: folder('off'), agents: ['mara', 'claudebot'] });

  // ⚠️ Assert presence before absence. "It is gone" passes against code that
  // filters nothing and code that filters everything; only the pair is a test.
  assert.ok(projects.get(p.id, ROSTER).agents.some((a) => a.sessionName === 'mara'));

  projects.removeAgent(p.id, 'mara');

  const after = projects.get(p.id, ROSTER);
  assert.ok(!after.agents.some((a) => a.sessionName === 'mara'));
  assert.ok(after.agents.some((a) => a.sessionName === 'claudebot'), 'and only that one came off');
});

// ---------------------------------------------------------------------------
// The managed block — the function that can eat somebody's words
// ---------------------------------------------------------------------------

test('a block is appended to an instruction file that has none, keeping every word', () => {
  const before = '# Casey\n\nYou are the QA engineer. Do not skip the controls.\n';
  const after = projects.spliceBlock(before, 'BODY');
  assert.ok(after.startsWith(before), 'nothing that was there may move or change');
  assert.ok(after.includes(projects.BLOCK_START) && after.includes(projects.BLOCK_END));
  assert.ok(after.includes('BODY'));
});

test('rewriting the block leaves the words above AND below it exactly as they were', () => {
  const above = '# Casey\n\nYou are the QA engineer.\n\n';
  const below = '\n\n## House rules\n\nNo em dashes. Ever.\n';
  const first = above + `${projects.BLOCK_START}\nOLD\n${projects.BLOCK_END}` + below;

  const second = projects.spliceBlock(first, 'NEW');

  assert.ok(second.startsWith(above), 'the words above the block survive verbatim');
  assert.ok(second.endsWith(below), 'the words below the block survive verbatim');
  assert.ok(second.includes('NEW'));
  assert.ok(!second.includes('OLD'), 'and the old block is actually replaced');
});

test('rewriting twice does not accumulate blocks', () => {
  const once = projects.spliceBlock('# A\n', 'ONE');
  const twice = projects.spliceBlock(once, 'TWO');
  assert.equal(twice.split(projects.BLOCK_START).length - 1, 1);
});

test('half a block is left alone rather than eating the rest of the file', () => {
  // An interrupted write or a hand edit can leave one marker. Matching from it
  // to the end of the file would delete everything after it.
  const damaged = `# A\n\n${projects.BLOCK_START}\nstranded\n\n## Important\n\nkeep me\n`;
  const after = projects.spliceBlock(damaged, 'NEW');

  // ⚠️ Asserting only that "keep me" survived is not enough, and this test
  // proved it: a mutation that removed the ordering guard sliced from an
  // arithmetic accident rather than from the end marker, mangled the file into
  // a fragment of a marker plus the tail, and still contained "keep me". So the
  // assertion is the whole specified behaviour — the damaged file is left
  // EXACTLY as it was and a new block is added after it.
  assert.ok(after.includes(damaged), 'the damaged file must survive intact, not merely in part');
  assert.ok(after.includes('NEW'));
  assert.equal(after.split(projects.BLOCK_END).length - 1, 1, 'exactly one end marker');
  // The stranded start marker DOES survive, on purpose — leaving the damaged
  // file untouched is the whole point, and it is visible for someone to delete.
  assert.equal(after.split(projects.BLOCK_START).length - 1, 2, 'the stranded marker is left, the new block is added');
});

test('an empty instruction file gets a block and no leading blank line', () => {
  const after = projects.spliceBlock('', 'BODY');
  assert.ok(after.startsWith(projects.BLOCK_START));
});

test('the block names each project and its folder', () => {
  const body = projects.blockBody([{ name: 'Henderson lease', folder: '/Users/josh/work/henderson' }]);
  assert.match(body, /Henderson lease/);
  assert.match(body, /\/Users\/josh\/work\/henderson/);
});

test('the block for an agent on nothing says so rather than being empty', () => {
  assert.match(projects.blockBody([]), /not put this agent on a project/);
});

// ---------------------------------------------------------------------------
// Telling the agent — and the three-valued verdict
// ---------------------------------------------------------------------------

test('telling an agent writes the block into its real instruction file', () => {
  reset();
  agent('mara', '# Mara\n\nYou are the executive assistant.\n');
  const dir = folder('henderson-2');
  const p = projects.create({ name: 'Henderson lease', folder: dir, agents: ['mara'] });

  const verdict = projects.syncAgent('mara');

  assert.equal(verdict.state, projects.TOLD.TOLD);
  const written = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mara', 'CLAUDE.md'), 'utf8');
  assert.ok(written.includes('You are the executive assistant.'), 'its own instructions survive');
  assert.ok(written.includes(dir), 'and it is told where the folder is');
  assert.equal(projects.get(p.id, []).agents[0].told.state, projects.TOLD.TOLD, 'and the verdict is recorded');
});

test('an agent with no worker folder is recorded as a member we COULD NOT tell', () => {
  reset();
  // ⚠️ Not hypothetical: measured on this machine 2026-08-11, `claudebot` — the
  // fleet's own PM — has no worker directory, so this is the live case.
  const p = projects.create({ name: 'Fleetwide', folder: folder('fleetwide'), agents: ['claudebot'] });

  const verdict = projects.syncAgent('claudebot');

  assert.equal(verdict.state, projects.TOLD.COULD_NOT);
  assert.ok(verdict.because, 'and it says why, because the screen has to say why');
  assert.equal(projects.readAll().length, 1, 'the membership is still recorded');
  assert.deepEqual(projects.get(p.id, []).agents.map((a) => a.sessionName), ['claudebot']);
});

test('a write that fails partway is reported, not thrown', () => {
  reset();
  // ⚠️ This test exists because a mutation exposed that `tellAgent`'s catch
  // block was never reached by anything: the only failing case in the suite
  // (`claudebot`, no worker folder) is refused by the reader BEFORE the write,
  // so the exception path was untested defensive code. A worker folder that
  // exists but cannot be written to is the realistic case that reaches it, and
  // it is the one that matters — the membership must still be recorded.
  const dir = agent('readonly-agent', '# Read only\n\nYou are a test agent.\n');
  fs.chmodSync(dir, 0o555);
  try {
    const p = projects.create({ name: 'Readonly', folder: folder('readonly'), agents: ['readonly-agent'] });
    const verdict = projects.syncAgent('readonly-agent');

    if (verdict.state === projects.TOLD.TOLD && process.getuid && process.getuid() === 0) return;
    assert.equal(verdict.state, projects.TOLD.COULD_NOT);
    assert.ok(verdict.because, 'and it says why');
    assert.deepEqual(
      projects.get(p.id, []).agents.map((a) => a.sessionName), ['readonly-agent'],
      'recording membership and announcing it are two acts, and the second failing must not undo the first',
    );
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('a membership nobody has tried to announce reads as not_tried, not as failed', () => {
  reset();
  const p = projects.create({ name: 'Fresh', folder: folder('fresh'), agents: ['mara'] });
  const member = projects.get(p.id, ROSTER).agents[0];
  assert.equal(member.told.state, projects.TOLD.NOT_TRIED, '"we did not ask" is not "we asked and could not"');
});

test('taking an agent off a project also drops the claim that we told it', () => {
  reset();
  agent('mara', '# Mara\n\nYou are the executive assistant.\n');
  const p = projects.create({ name: 'Leaving', folder: folder('leaving'), agents: ['mara'] });
  projects.syncAgent('mara');
  assert.equal(projects.readAll()[0].told.mara.state, projects.TOLD.TOLD);

  projects.removeAgent(p.id, 'mara');

  assert.equal(projects.readAll()[0].told.mara, undefined, 'a sentence about a membership that ended is not true');
});

test('an agent on two projects is told about both in one block', () => {
  reset();
  agent('mara', '# Mara\n\nYou are the executive assistant.\n');
  const one = folder('proj-one');
  const two = folder('proj-two');
  projects.create({ name: 'One', folder: one, agents: ['mara'] });
  projects.create({ name: 'Two', folder: two, agents: ['mara'] });

  projects.syncAgent('mara');

  const written = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mara', 'CLAUDE.md'), 'utf8');
  assert.ok(written.includes(one) && written.includes(two));
  assert.equal(written.split(projects.BLOCK_START).length - 1, 1, 'one block, not one per project');
});

test('nothing is ever written into the user’s project folder', () => {
  reset();
  agent('mara', '# Mara\n\nYou are the executive assistant.\n');
  const dir = folder('untouched');
  const before = fs.readdirSync(dir);
  projects.create({ name: 'Untouched', folder: dir, agents: ['mara'] });
  projects.syncAgent('mara');
  assert.deepEqual(fs.readdirSync(dir), before, 'the project folder holds their work and nothing of ours');
});

test('the store lives under the sandboxed data root, so nothing here reached the real one', () => {
  assert.ok(projects.file().startsWith(SANDBOX), projects.file());
  assert.ok(store.ROOT.startsWith(SANDBOX), store.ROOT);
});

test('a corrupt projects file reads as empty rather than throwing on every page', () => {
  reset();
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(projects.file(), '{not json');
  assert.deepEqual(projects.readAll(), []);
});
