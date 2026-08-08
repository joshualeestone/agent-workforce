'use strict';

/**
 * Tests for the instruction file.
 *
 * Two properties matter more than the rest:
 *
 * 1. **A write here changes how a live agent boots.** It is the most powerful
 *    write in the product, so the containment and refusal guards are tested
 *    through the REAL read and write paths, never through a helper. The
 *    commitment store shipped a traversal test that asserted on a path helper
 *    no production code called, and it passed against a build whose actual read
 *    and write used something else.
 *
 * 2. **`read()` must never throw.** It is called once per agent from the status
 *    route, so a throw answers 500 for the whole board.
 *
 *   node --test engine/instructions.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Relocate the workers root BEFORE requiring the module, so nothing here can
// touch a real agent's instructions. instructions.js reads it at load.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-workers-'));
process.env.AGENT_WORKFORCE_WORKERS = ROOT;

const test = require('node:test');
const assert = require('node:assert/strict');
const instructions = require('./instructions');

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const REAL = 'You are a test agent. Your job is to be used by this test suite.';

function makeAgent(name, body = REAL) {
  fs.mkdirSync(path.join(ROOT, name), { recursive: true });
  fs.writeFileSync(path.join(ROOT, name, 'CLAUDE.md'), body);
  return path.join(ROOT, name, 'CLAUDE.md');
}

// ---------------------------------------------------------------------------
// The staleness decision, as a pure function
// ---------------------------------------------------------------------------

test('a file edited after the session started is stale', () => {
  const now = Date.now();
  assert.equal(instructions.compare(now, now - 60000).state, instructions.STALENESS.STALE);
});

test('a file edited before the session started is current', () => {
  const now = Date.now();
  assert.equal(instructions.compare(now - 60000, now).state, instructions.STALENESS.CURRENT);
});

test('a missing timestamp on either side is UNKNOWN, never current', () => {
  // The rule this whole codebase runs on: something we cannot assess must not
  // render as fine. `birthtime` comes back as the epoch on some filesystems,
  // and treating that as 1970 would make every agent look freshly started and
  // every file look stale; treating a missing edit time as "not stale" would
  // hide a real edit.
  const now = Date.now();
  for (const [edited, started, label] of [
    [now, null, 'no session start'],
    [null, now, 'no edit time'],
    [now, 0, 'epoch birthtime'],
    [0, now, 'epoch mtime'],
    [null, null, 'neither'],
  ]) {
    assert.equal(instructions.compare(edited, started).state, instructions.STALENESS.UNKNOWN, label);
  }
});

test('the same timestamp on both sides is current, not stale', () => {
  // A file written in the same millisecond the session started is not evidence
  // of an edit since. Strictly-greater, not greater-or-equal.
  const now = Date.now();
  assert.equal(instructions.compare(now, now).state, instructions.STALENESS.CURRENT);
});

// ---------------------------------------------------------------------------
// Containment: the write changes how an agent boots
// ---------------------------------------------------------------------------

test('no name can make a read or a write escape the workers directory', () => {
  // Through the REAL paths, with a file planted at the place an unsanitised
  // join would land, so the test can tell whether containment actually held
  // rather than whether the target happened not to exist.
  //
  // ⚠️ What this pins is `safeKey` stripping separators. It does NOT pin the
  // `startsWith(ROOT)` assertion in fileFor(), which is unreachable while
  // safeKey behaves: deleting that line leaves this suite green. That is
  // declared rather than implied, because a test named for traversal that
  // silently covers only one of two guards is how the commitment store shipped
  // a traversal test which passed against a vulnerable build.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-outside-'));
  fs.mkdirSync(path.join(outside, 'victim'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'victim', 'CLAUDE.md'), 'SECRET FROM OUTSIDE THE ROOT');

  const escape = path.join(path.relative(ROOT, outside), 'victim');
  try {
    // Sanity: unsanitised, this really would reach the planted file.
    assert.ok(fs.existsSync(path.join(ROOT, `${escape}`, 'CLAUDE.md')),
      'fixture is wrong: the traversal target does not exist');

    const got = instructions.read(escape);
    assert.ok(!got.text.includes('SECRET FROM OUTSIDE'), 'a read escaped the workers root');

    const before = fs.readFileSync(path.join(outside, 'victim', 'CLAUDE.md'), 'utf8');
    try { instructions.write(escape, REAL); } catch { /* refused is fine */ }
    assert.equal(fs.readFileSync(path.join(outside, 'victim', 'CLAUDE.md'), 'utf8'), before,
      'a write escaped the workers root and overwrote a file outside it');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a name that sanitises to nothing is refused rather than writing to the root', () => {
  for (const bad of ['...', '///', '..']) {
    assert.equal(instructions.fileFor(bad), null, `${bad} should have no path`);
    assert.throws(() => instructions.write(bad, REAL), /not a name we can look up/);
  }
});

// ---------------------------------------------------------------------------
// Refusals: an agent with no instructions is worse than an edit that failed
// ---------------------------------------------------------------------------

test('an empty or near-empty body is refused, not saved', () => {
  const file = makeAgent('emptytest');
  const before = fs.readFileSync(file, 'utf8');
  for (const body of ['', '   ', '\n\n', 'too short']) {
    assert.throws(() => instructions.write('emptytest', body), /cannot be empty/,
      `${JSON.stringify(body)} should be refused`);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the original must survive a refused write');
});

test('an oversized body is refused', () => {
  makeAgent('bigtest');
  assert.throws(() => instructions.write('bigtest', 'x'.repeat(instructions.MAX_BYTES + 1)),
    /larger than an instruction file should be/);
});

test('writing to an agent with no worker directory is refused, not created', () => {
  // Creating the directory would invent an agent that does not exist.
  assert.throws(() => instructions.write('no-such-agent-here', REAL), /no agent by that name/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'no-such-agent-here')),
    'a refused write must not create the directory');
});

test('a successful write replaces the file and leaves no temp behind', () => {
  const file = makeAgent('writetest');
  instructions.write('writetest', 'These are the new instructions for the write test agent.');
  assert.match(fs.readFileSync(file, 'utf8'), /new instructions/);

  const strays = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp'));
  assert.deepEqual(strays, [], `temp files left behind: ${strays.join(', ')}`);
});

test('a failed write leaves no temp file and does not damage the original', () => {
  const file = makeAgent('failtest');
  const before = fs.readFileSync(file, 'utf8');
  // A directory where the file should be makes the rename fail, which is AFTER
  // the temp write -- the only path that can leave one behind.
  fs.rmSync(file);
  fs.mkdirSync(file);
  try {
    assert.throws(() => instructions.write('failtest', REAL), /could not be saved/);
    const strays = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp'));
    assert.deepEqual(strays, [], `temp file left behind: ${strays.join(', ')}`);
  } finally {
    fs.rmSync(file, { recursive: true, force: true });
    fs.writeFileSync(file, before);
  }
});

test('an error never carries the absolute path', () => {
  // The message reaches the person verbatim, and a raw errno carries the home
  // directory. House rule, and the commitment store shipped a violation of it.
  const file = makeAgent('leaktest');
  fs.rmSync(file);
  fs.mkdirSync(file);
  try {
    instructions.write('leaktest', REAL);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(!err.message.includes(ROOT), `message leaked the path: ${err.message}`);
    assert.ok(!/ENOENT|EISDIR|EACCES/.test(err.message), `message named an errno: ${err.message}`);
  } finally {
    fs.rmSync(file, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// read() must never throw
// ---------------------------------------------------------------------------

test('read never throws, whatever is at the path', () => {
  // It runs once per agent inside the status handler, so one throw answers 500
  // for the entire board.
  makeAgent('okagent');

  // A directory in place of the file.
  fs.mkdirSync(path.join(ROOT, 'diragent'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'diragent', 'CLAUDE.md'), { recursive: true });

  // A file far larger than we will read.
  fs.mkdirSync(path.join(ROOT, 'hugeagent'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'hugeagent', 'CLAUDE.md'), 'x'.repeat(instructions.MAX_BYTES + 1024));

  for (const name of ['okagent', 'diragent', 'hugeagent', 'never-existed', '...', '../../evil']) {
    let got;
    assert.doesNotThrow(() => { got = instructions.read(name); }, `threw on ${name}`);
    assert.ok(got && typeof got.staleness.state === 'string', `no usable answer for ${name}`);
  }
});

test('a directory or an oversized file reads as unknown, never as current', () => {
  fs.mkdirSync(path.join(ROOT, 'notafile'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'notafile', 'CLAUDE.md'), { recursive: true });
  const got = instructions.read('notafile');
  assert.equal(got.exists, false);
  assert.equal(got.staleness.state, instructions.STALENESS.UNKNOWN);
});

test('a symlinked instruction file is not followed out of the workers root', () => {
  // lstat rather than stat, so a link is seen as a link.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-link-'));
  const target = path.join(outside, 'target.md');
  fs.writeFileSync(target, 'REACHED THROUGH A SYMLINK');
  fs.mkdirSync(path.join(ROOT, 'linkagent'), { recursive: true });
  const link = path.join(ROOT, 'linkagent', 'CLAUDE.md');
  try {
    fs.symlinkSync(target, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    return; // symlinks unavailable
  }
  try {
    const got = instructions.read('linkagent');
    assert.ok(!got.text.includes('REACHED THROUGH A SYMLINK'), 'a symlink was followed');
    assert.equal(got.staleness.state, instructions.STALENESS.UNKNOWN);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('an agent with no instruction file reads as unknown, not current', () => {
  fs.mkdirSync(path.join(ROOT, 'barefolder'), { recursive: true });
  const got = instructions.read('barefolder');
  assert.equal(got.exists, false);
  assert.equal(got.staleness.state, instructions.STALENESS.UNKNOWN);
  assert.match(got.staleness.because, /no instruction file/);
});
