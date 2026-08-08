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

// And relocate HOME, also before the require, for the same reason one step
// further out: `status.js` resolves the session registry and the transcripts
// under `os.homedir()`, which on POSIX is `$HOME`. Without this the staleness
// tests read the operator's real `~/.claude` and their answers depend on which
// agents happen to be running, which is both non-hermetic and a live-data read
// from a test suite. It also points `store.ROOT` at the temp tree rather than
// the real app data.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-home-'));
process.env.HOME = HOME;
const REGISTRY = path.join(HOME, '.claude', 'agent-registry');
const PROJECTS = path.join(HOME, '.claude', 'projects', 'p');
fs.mkdirSync(REGISTRY, { recursive: true });
fs.mkdirSync(PROJECTS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const instructions = require('./instructions');

test.after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
});

/**
 * Give an agent a session the status engine can actually resolve: a registry
 * entry keyed on its name, pointing at a transcript file that exists.
 */
function makeSession(name, sessionId) {
  fs.writeFileSync(path.join(REGISTRY, `${name}-discord_0.0.json`),
    JSON.stringify({ session_id: sessionId }));
  const transcript = path.join(PROJECTS, `${sessionId}.jsonl`);
  fs.writeFileSync(transcript, '{}\n');
  return transcript;
}

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

test('the name is stripped of separators before it ever becomes a path', () => {
  // Isolates the FIRST of the two containment guards.
  //
  // The traversal test below passes if EITHER guard holds, so on its own it
  // cannot tell you which one is doing the work: loosen `safeKey` to allow `/`
  // and `.` and the `startsWith(ROOT)` assertion silently covers for it, and
  // the traversal test stays green against a `safeKey` that no longer sanitises
  // anything. This one asserts on the path `safeKey` actually produced, so it
  // fails the moment `safeKey` stops stripping separators, whatever the second
  // guard does.
  assert.equal(instructions.fileFor('a/b/c'), path.join(ROOT, 'abc', instructions.FILENAME));
  assert.equal(instructions.fileFor('../evil'), path.join(ROOT, 'evil', instructions.FILENAME));
});

test('no name can make a read or a write escape the workers directory', () => {
  // Through the REAL paths, with a file planted at the place an unsanitised
  // join would land, so the test can tell whether containment actually held
  // rather than whether the target happened not to exist.
  //
  // ⚠️ What this pins is "at least one of the two guards held", NOT either one
  // in particular. Both `safeKey` stripping separators and the
  // `startsWith(ROOT)` assertion in fileFor() can independently stop the
  // escape, so removing either one alone leaves this green. The test above
  // isolates the first. The second is genuinely uncovered, which is declared
  // here and at the assertion itself rather than left to look like coverage:
  // a test named for traversal that silently covers only part of what it names
  // is how the commitment store shipped a traversal test that passed against a
  // vulnerable build.
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

test('a directory where the instruction file should be is refused, not written through', () => {
  const dir = path.join(ROOT, 'dirwritetest');
  fs.mkdirSync(path.join(dir, 'CLAUDE.md'), { recursive: true });
  assert.throws(() => instructions.write('dirwritetest', REAL), /cannot safely replace/);
  assert.ok(fs.lstatSync(path.join(dir, 'CLAUDE.md')).isDirectory(), 'the directory should survive');
});

/**
 * Force the rename to fail.
 *
 * The rename is the only step that runs AFTER the temp file exists, so it is
 * the only way to reach the cleanup path. It used to be provoked by planting a
 * directory at the target, but that is now refused earlier by the showable
 * guard, so the old tests stopped exercising the path they were named for while
 * still passing. Injecting the failure targets it directly, and lets the
 * injected error carry the absolute path on purpose so the sanitisation has
 * something real to strip.
 */
function withFailingRename(fn) {
  const real = fs.renameSync;
  fs.renameSync = (from) => { throw new Error(`EACCES: permission denied, rename '${from}'`); };
  try { return fn(); } finally { fs.renameSync = real; }
}

test('a failed write leaves no temp file and does not damage the original', () => {
  const file = makeAgent('failtest');
  const before = fs.readFileSync(file, 'utf8');
  withFailingRename(() => {
    assert.throws(() => instructions.write('failtest', REAL), /could not be saved/);
  });
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the original must survive a failed write');
  const strays = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp'));
  assert.deepEqual(strays, [], `temp file left behind: ${strays.join(', ')}`);
});

test('an error never carries the absolute path', () => {
  // The message reaches the person verbatim, and a raw errno carries the home
  // directory. House rule, and the commitment store shipped a violation of it.
  // The injected error below contains BOTH the absolute path and an errno, so
  // this fails loudly if the raw message is ever passed through.
  makeAgent('leaktest');
  withFailingRename(() => {
    try {
      instructions.write('leaktest', REAL);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(!err.message.includes(ROOT), `message leaked the path: ${err.message}`);
      assert.ok(!/ENOENT|EISDIR|EACCES/.test(err.message), `message named an errno: ${err.message}`);
    }
  });
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

test('a directory in place of the file reads as unknown, never as current', () => {
  fs.mkdirSync(path.join(ROOT, 'notafile'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'notafile', 'CLAUDE.md'), { recursive: true });
  const got = instructions.read('notafile');
  assert.equal(got.exists, false);
  assert.equal(got.staleness.state, instructions.STALENESS.UNKNOWN);
});

test('an oversized file reads as unknown rather than being read into memory', () => {
  // Named separately from the directory case above, which was doing duty for
  // both: with only that one, deleting the size half of the guard left the
  // whole suite green. The size ceiling is what stops a request handler
  // pulling an arbitrarily large file into memory.
  makeAgent('oversizetest', 'x'.repeat(instructions.MAX_BYTES + 1));
  const got = instructions.read('oversizetest');
  assert.equal(got.exists, false, 'an oversized file must not be served');
  assert.equal(got.text, '');
  assert.equal(got.staleness.state, instructions.STALENESS.UNKNOWN);
});

test('a file the read path refuses to show cannot be silently overwritten', () => {
  // The failure this prevents: read() rejects an oversized file and answers
  // `{exists:false, text:''}`, so the editor shows an empty box saying there is
  // no instruction file yet, and Save then destroys the real one. The screen
  // must be describing the same file that Save replaces.
  const file = makeAgent('clobbertest', 'y'.repeat(instructions.MAX_BYTES + 1));
  const before = fs.readFileSync(file, 'utf8');

  assert.equal(instructions.read('clobbertest').exists, false, 'fixture is wrong: read should refuse this');
  assert.throws(() => instructions.write('clobbertest', REAL), /cannot safely replace/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a refused-to-show file was overwritten anyway');
});

test('a symlinked worker directory cannot land a write outside the root', () => {
  // The containment assertion in fileFor only ever sees the NAME, never where
  // it points, so if the directory check follows links the write lands wherever
  // the link goes. `lstat`, not `stat`.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dirlink-'));
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'), 'A FILE OUTSIDE THE WORKERS ROOT');
  const link = path.join(ROOT, 'dirlinkagent');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    return; // symlinks unavailable
  }
  try {
    assert.throws(() => instructions.write('dirlinkagent', REAL), /no agent by that name/);
    assert.equal(fs.readFileSync(path.join(outside, 'CLAUDE.md'), 'utf8'),
      'A FILE OUTSIDE THE WORKERS ROOT', 'a write followed a directory symlink out of the root');
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlinked instruction file cannot be overwritten through the link', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-wlink-'));
  const target = path.join(outside, 'target.md');
  fs.writeFileSync(target, 'THE FILE THE LINK POINTS AT');
  fs.mkdirSync(path.join(ROOT, 'wlinkagent'), { recursive: true });
  const link = path.join(ROOT, 'wlinkagent', 'CLAUDE.md');
  try {
    fs.symlinkSync(target, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    return; // symlinks unavailable
  }
  try {
    assert.throws(() => instructions.write('wlinkagent', REAL), /cannot safely replace/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'THE FILE THE LINK POINTS AT',
      'a write followed a symlink out of the workers root');
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
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

test('staleness never throws, whatever is at the path', () => {
  // The status route calls THIS, not read(), once per agent. One throw here
  // answers 500 for the entire board over a single agent's odd file. The
  // never-throws guarantee was documented on read() while the route called
  // staleness, so the tested function was not the reachable one.
  makeAgent('stok');
  fs.mkdirSync(path.join(ROOT, 'stdir', 'CLAUDE.md'), { recursive: true });
  makeAgent('stbig', 'x'.repeat(instructions.MAX_BYTES + 1));

  for (const name of ['stok', 'stdir', 'stbig', 'never-existed', '...', '../../evil', '', null, undefined]) {
    let got;
    assert.doesNotThrow(() => { got = instructions.staleness(name); }, `threw on ${String(name)}`);
    assert.ok(got && typeof got.state === 'string', `no usable answer for ${String(name)}`);
    assert.ok(got.because, `no explanation for ${String(name)}`);
  }
});

test('an mtime we cannot use is unknown, and says so for the right reason', () => {
  // Two ways an mtime arrives unusable: the epoch, which real filesystems do
  // hand back, and NaN, which has to be injected because no real file carries
  // one. Both must reach the SAME refusal.
  //
  // ⚠️ This asserts the `because`, not just the state, and that is the whole
  // point. Every path through this function returns `unknown` for these inputs
  // one way or another, so a test that only checked the state would stay green
  // against the guard being deleted: NaN is falsy, so it falls through to a
  // later branch and still reads `unknown`, while an epoch mtime sails past and
  // gets compared as a real date in 1970, which resolves to `current`. The
  // reason string is the only observable that tells the two apart.
  const epochFile = makeAgent('epochtime');
  fs.utimesSync(epochFile, new Date(0), new Date(0));
  makeAgent('nantime');
  makeSession('nantime', 'sess-nan');

  const real = fs.statSync;
  fs.statSync = (p, ...rest) => {
    const s = real(p, ...rest);
    if (String(p).includes('nantime')) return { ...s, isFile: () => true, mtime: new Date(NaN) };
    return s;
  };
  try {
    for (const name of ['epochtime', 'nantime']) {
      let got;
      assert.doesNotThrow(() => { got = instructions.staleness(name); }, `threw on ${name}`);
      assert.equal(got.state, instructions.STALENESS.UNKNOWN, name);
      assert.match(got.because, /when its instruction file was last edited/, name);
      assert.equal(got.editedAt, undefined, `${name} reported a time it cannot know`);
    }
  } finally {
    fs.statSync = real;
  }
});

test('a session is found for a name safeKey would have mangled', () => {
  // ⚠️ Pins the WIRING, not the helper. The unit test below proves
  // `registryKey` returns the name unchanged, but on its own it pins nothing:
  // swap the call inside `sessionStartedAt` back to `safeKey` and that test
  // stays green while every agent whose session name carries a capital, a dot
  // or a space silently loses its staleness forever. This one goes through
  // `sessionStartedAt`, so it fails when the call site changes.
  const name = 'Odd.Name Agent';
  const transcript = makeSession(name, 'sess-odd-name');
  fs.mkdirSync(path.join(ROOT, name), { recursive: true });

  const at = instructions.sessionStartedAt(name);
  assert.ok(at, 'no session start resolved for a name safeKey would rewrite');
  assert.equal(at, fs.statSync(transcript).birthtime.getTime());
});

test('a staleness answer for such a name is a real verdict, not unknown', () => {
  // The end the wiring exists for: the whole chain, from the name on the URL to
  // a state on the screen.
  //
  // ⚠️ Note where the file goes. The DIRECTORY is the sanitised name and the
  // REGISTRY key is the verbatim one, and that asymmetry is deliberate: a path
  // under a root we own should be sanitised, an identity lookup in someone
  // else's file should not be rewritten. The consequence, stated rather than
  // discovered: an agent whose worker directory is not already the sanitised
  // form of its session name reads as "no instruction file yet". Every agent on
  // this machine is lowercase so none of them hit it, and unifying the two
  // would mean changing how the avatar and profile stores derive paths as well,
  // which is not this branch.
  const name = 'Mixed.Case Worker';
  makeSession(name, 'sess-mixed-case');
  const file = instructions.fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, REAL);

  const got = instructions.staleness(name);
  assert.notEqual(got.state, instructions.STALENESS.UNKNOWN,
    'a resolvable session still read as unknown, so the lookup key was rewritten');
  assert.ok(got.startedAt, 'a real verdict must say when the session started');
});

test('the registry name is validated, not rewritten', () => {
  // safeKey would lowercase this and strip the dot, asking the registry for an
  // agent that does not exist, so staleness would read `unknown` forever while
  // the data sat on disk. The registry is an identity lookup, not a path we
  // own, so names pass through byte for byte or are refused outright.
  assert.equal(instructions.registryKey('Angel.Bridge 2'), 'Angel.Bridge 2');
  for (const bad of ['../evil', 'a/b', 'a\\b', '..', '.', '', null]) {
    assert.equal(instructions.registryKey(bad), null, `${String(bad)} should be refused`);
  }
});

test('an agent with no instruction file reads as unknown, not current', () => {
  fs.mkdirSync(path.join(ROOT, 'barefolder'), { recursive: true });
  const got = instructions.read('barefolder');
  assert.equal(got.exists, false);
  assert.equal(got.staleness.state, instructions.STALENESS.UNKNOWN);
  assert.match(got.staleness.because, /no instruction file/);
});
