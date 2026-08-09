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
    assert.throws(() => instructions.write('emptytest', body), /at least 20 characters/,
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

test('the version being replaced is kept beside the file', () => {
  // ⚠️ The most destructive edit in the product had no way back. The box is
  // labelled "what they should focus on" and hinted as "your words, in plain
  // language", but it holds an agent's entire boot file: kilobytes of hard
  // rules, escalation policy and house style. The only floor on a save is
  // twenty characters, so someone taking that hint at face value and typing two
  // sentences destroyed those rules permanently and was told "Saved."
  const file = makeAgent('backuptest', 'THE ORIGINAL OPERATING RULES THAT MUST BE RECOVERABLE');
  instructions.write('backuptest', 'two sentences of my own words here, nothing more');

  assert.equal(fs.readFileSync(file, 'utf8'), 'two sentences of my own words here, nothing more');
  assert.equal(fs.readFileSync(`${file}.previous`, 'utf8'),
    'THE ORIGINAL OPERATING RULES THAT MUST BE RECOVERABLE',
    'the replaced version was not kept');
});

test('a first save has nothing to keep and does not invent a backup', () => {
  fs.mkdirSync(path.join(ROOT, 'firstsave'), { recursive: true });
  instructions.write('firstsave', 'the first instructions this agent has ever had');
  assert.ok(!fs.existsSync(path.join(ROOT, 'firstsave', 'CLAUDE.md.previous')),
    'a backup was written for a file that did not exist');
});

test('a refused save does not disturb the kept version', () => {
  const file = makeAgent('backupkeep', 'THE VERSION THAT SHOULD STAY IN THE BACKUP SLOT');
  instructions.write('backupkeep', 'a legitimate first replacement of the instructions');
  const kept = fs.readFileSync(`${file}.previous`, 'utf8');

  assert.throws(() => instructions.write('backupkeep', 'too short'), /at least 20 characters/);
  assert.equal(fs.readFileSync(`${file}.previous`, 'utf8'), kept,
    'a refused save rewrote the backup');
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

test('a file that exists but cannot be opened is never silently replaced', (t) => {
  // ⚠️ The one the first version of this guard missed. It checked a PARALLEL
  // predicate (regular file, within the ceiling) instead of asking `read`, so a
  // file that is perfectly ordinary but unopenable (mode 000, a bad mount, a
  // permissions change) passed the guard while `read` reported "no instruction
  // file yet". The editor showed an empty box and the first Save destroyed a
  // real agent's instructions. Reproduced before the fix: read().exists false,
  // write() succeeded, file replaced.
  const file = makeAgent('unreadable', 'INSTRUCTIONS THAT MUST SURVIVE A REFUSED SAVE');
  fs.chmodSync(file, 0o000);
  try {
    if (instructions.read('unreadable').exists) {
      t.skip('running as root, so an unreadable file is still readable');
      return;
    }
    assert.throws(() => instructions.write('unreadable', REAL), /cannot safely replace/);
    fs.chmodSync(file, 0o644);
    assert.equal(fs.readFileSync(file, 'utf8'), 'INSTRUCTIONS THAT MUST SURVIVE A REFUSED SAVE');
  } finally {
    try { fs.chmodSync(file, 0o644); } catch { /* already restored */ }
  }
});

test('the original file permissions survive a save', () => {
  // A fresh temp file is created at 0666 minus the umask and the rename carries
  // that mode onto the target, so a file deliberately locked to 0600 came out
  // 0644 after one save. Widening the permissions of the most sensitive file
  // this product writes, as a side effect of an unrelated edit, is not
  // something anyone would be told about.
  const file = makeAgent('modetest');
  fs.chmodSync(file, 0o600);
  instructions.write('modetest', 'New instructions for the permissions test agent.');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600,
    'the save widened the file permissions');
});

test('a save is refused when the file changed after it was read', () => {
  // The file is read once, when the panel opens. An agent rewriting its own
  // instructions, or the operator editing by hand, is invisible to a panel that
  // has been sitting open, and an unconditional save destroys that work with no
  // warning. We cannot merge two versions, so refusing is the only honest
  // answer.
  const file = makeAgent('conflicttest');
  const opened = instructions.read('conflicttest');
  assert.ok(opened.version, 'the read must say which version it showed');

  // Someone else edits it after the panel opened. The mtime is deliberately put
  // BACK to what it was, because the guard must not depend on a timestamp: an
  // rsync, a git checkout or a coarse-granularity volume all leave mtime alone
  // while the bytes change, and the first version of this guard compared mtimes
  // and was defeated by exactly this.
  const before = fs.statSync(file).mtime;
  fs.writeFileSync(file, 'AN EDIT MADE OUTSIDE THIS EDITOR THAT MUST SURVIVE');
  fs.utimesSync(file, before, before);

  assert.throws(() => instructions.write('conflicttest', REAL, opened.version),
    /changed since you opened them/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'AN EDIT MADE OUTSIDE THIS EDITOR THAT MUST SURVIVE',
    'the outside edit was overwritten anyway');

  // And the current version saves cleanly.
  const fresh = instructions.read('conflicttest');
  instructions.write('conflicttest', REAL, fresh.version);
  assert.equal(fs.readFileSync(file, 'utf8'), REAL);
});

test('a file created while the panel was open is not silently replaced', () => {
  // ⚠️ The case the mtime-based version could not express at all. The panel
  // said "there is no instruction file for this one yet", so it had no
  // timestamp to send, so the guard skipped itself, and a CLAUDE.md the agent
  // wrote in the meantime was destroyed with no warning. `absent` is a real
  // version, so "there was none and now there is" compares unequal like any
  // other change.
  fs.mkdirSync(path.join(ROOT, 'createtest'), { recursive: true });
  const opened = instructions.read('createtest');
  assert.equal(opened.exists, false);
  assert.equal(opened.version, instructions.ABSENT, 'an absent file still needs a version');

  const file = path.join(ROOT, 'createtest', 'CLAUDE.md');
  fs.writeFileSync(file, 'THE AGENT WROTE ITS OWN INSTRUCTIONS WHILE THE PANEL SAT OPEN');

  assert.throws(() => instructions.write('createtest', REAL, opened.version),
    /changed since you opened them/);
  assert.equal(fs.readFileSync(file, 'utf8'),
    'THE AGENT WROTE ITS OWN INSTRUCTIONS WHILE THE PANEL SAT OPEN',
    'a file created after the read was overwritten anyway');
});

test('a file that is not UTF-8 is neither shown nor rewritten', () => {
  // ⚠️ Two bugs in one, both measured before the fix.
  //
  // The editor round-trips through a UTF-8 string, so every byte that is not
  // valid UTF-8 came back as U+FFFD. Opening such a file and pressing Save
  // rewrote it lossily and reported "Saved.": 50 bytes in, 52 bytes out.
  //
  // And because the version token hashed the DECODED string, every invalid byte
  // collapsed to the same replacement character, so two genuinely different
  // files hashed identically and the changed-since-read guard waved the save
  // through. A hash of a lossy decoding is not a hash of the file.
  const dir = path.join(ROOT, 'latin1');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'CLAUDE.md');
  const original = Buffer.from('You are Ren\xE9, the agent who handles the accounts.\n', 'latin1');
  fs.writeFileSync(file, original);

  const got = instructions.read('latin1');
  assert.equal(got.exists, false, 'a file we cannot round-trip must not be shown as editable');
  assert.equal(got.text, '');
  assert.match(got.staleness.because, /not UTF-8/);

  assert.throws(() => instructions.write('latin1', REAL), /cannot safely replace/);
  assert.ok(fs.readFileSync(file).equals(original), 'the file was rewritten anyway');
});

test('two files differing only in an invalid byte are both refused', () => {
  // ⚠️ Renamed. This was called "do not share a version" and its comment said
  // "the hash must be over the bytes", but it never calls `versionOf`: it
  // computes two sha256s itself, which is a tautology, and then asserts the
  // refusal. Changing `versionOf` to hash the decoded string leaves it green.
  //
  // The hashing guard genuinely CANNOT be tested through the real path, because
  // the round-trip refusal means no file with invalid bytes ever reaches
  // `versionOf`. That is declared at the function itself and in the plan's
  // table. What this test actually pins is the refusal, so it is now named for
  // that.
  const mk = (name, byte) => {
    fs.mkdirSync(path.join(ROOT, name), { recursive: true });
    const f = path.join(ROOT, name, 'CLAUDE.md');
    fs.writeFileSync(f, Buffer.concat([Buffer.from('You are '), Buffer.from([byte]), Buffer.from(' here.\n')]));
    return f;
  };
  const a = mk('bytea', 0xE9);
  const b = mk('byteb', 0xFF);
  assert.notEqual(
    require('node:crypto').createHash('sha256').update(fs.readFileSync(a)).digest('hex'),
    require('node:crypto').createHash('sha256').update(fs.readFileSync(b)).digest('hex'),
    'fixture is wrong: these should differ');
  // Both are refused by the read path, so neither can be clobbered through it.
  assert.equal(instructions.read('bytea').exists, false);
  assert.equal(instructions.read('byteb').exists, false);
});

test('a file DELETED while the panel was open is not silently recreated over', () => {
  // The other side of the create case, and the one the `absent` fallback in
  // `write` actually serves. The test above it exercises the opposite
  // direction (nothing, then something) and reaches `write` with the file
  // present, so it never touches this branch at all. Without this, mutating
  // that fallback in either direction left the suite green while the plan's
  // guard table claimed it was covered.
  const file = makeAgent('deletetest', 'The version the panel was showing before it went away.');
  const opened = instructions.read('deletetest');
  assert.ok(opened.exists);

  fs.rmSync(file);

  assert.throws(() => instructions.write('deletetest', REAL, opened.version),
    /changed since you opened them/);
  assert.ok(!fs.existsSync(file), 'a refused save must not recreate the file');
});

test('a write with no expected version still works, for scripts and first saves', () => {
  makeAgent('noexpecttest');
  instructions.write('noexpecttest', 'Saved without claiming which version was open.');
  assert.match(fs.readFileSync(path.join(ROOT, 'noexpecttest', 'CLAUDE.md'), 'utf8'), /without claiming/);
});

test('a planted temp file cannot redirect the write out of the root', (t) => {
  // The third symlink route, and the one that bypasses every other guard
  // because it is not the path any of them look at. The temp name is
  // predictable (`CLAUDE.md.<pid>.tmp`), and the default write flag follows a
  // symlink, so a link planted there sends the body to its target.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tmplink-'));
  const target = path.join(outside, 'elsewhere.md');
  fs.writeFileSync(target, 'A FILE THE WRITE MUST NOT REACH');
  makeAgent('tmplinkagent');
  const tmp = path.join(ROOT, 'tmplinkagent', `CLAUDE.md.${process.pid}.tmp`);
  try {
    fs.symlinkSync(target, tmp);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
  }
  try {
    // Refusing is the correct outcome; silently succeeding into `target` is not.
    try { instructions.write('tmplinkagent', REAL); } catch { /* refused is fine */ }
    assert.equal(fs.readFileSync(target, 'utf8'), 'A FILE THE WRITE MUST NOT REACH',
      'the write followed a planted temp symlink out of the workers root');
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('staleness refuses a symlinked file rather than reporting its mtime', (t) => {
  // `staleness` is what the CARD renders, and it used to `stat` where `read`
  // used `lstat`. The card showed a confident "running on older instructions"
  // derived from a file outside the workers root, and disclosed that file's
  // mtime, while the detail page for the same agent said it could not read
  // anything. Two surfaces contradicting each other about one agent is worse
  // than either answer alone.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stlink-'));
  const target = path.join(outside, 'target.md');
  fs.writeFileSync(target, 'OUTSIDE THE ROOT');
  fs.utimesSync(target, new Date('2030-01-01'), new Date('2030-01-01'));
  fs.mkdirSync(path.join(ROOT, 'stlinkagent'), { recursive: true });
  const link = path.join(ROOT, 'stlinkagent', 'CLAUDE.md');
  makeSession('stlinkagent', 'sess-stlink');
  try {
    fs.symlinkSync(target, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
  }
  try {
    const got = instructions.staleness('stlinkagent');
    assert.equal(got.state, instructions.STALENESS.UNKNOWN, 'a symlink produced a confident verdict');
    assert.equal(got.editedAt, undefined, 'the mtime of a file outside the root was disclosed');
    // And the two surfaces must agree.
    assert.equal(instructions.read('stlinkagent').staleness.state, got.state);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlinked worker directory is not READ through either', (t) => {
  // ⚠️ The write side of this was guarded and tested; the read side was not,
  // and nothing noticed because the test below is named for the directory and
  // only ever asserted on `write`. Measured before the fix: `read` returned
  // `exists: true` with the contents of a file OUTSIDE the root, under a `path`
  // that content had not come from, and `staleness` disclosed that file's
  // mtime. The editor served a foreign file as editable while Save answered
  // "there is no agent by that name to write to", so the two surfaces
  // disagreed about the same agent.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dirread-'));
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'), 'CONTENTS FROM OUTSIDE THE WORKERS ROOT');
  const link = path.join(ROOT, 'dirreadagent');
  makeSession('dirreadagent', 'sess-dirread');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
  }
  try {
    const got = instructions.read('dirreadagent');
    assert.equal(got.exists, false, 'a read followed a directory symlink out of the root');
    assert.ok(!got.text.includes('OUTSIDE THE WORKERS ROOT'), 'foreign contents were served');
    assert.equal(got.staleness.state, instructions.STALENESS.UNKNOWN);
    assert.equal(instructions.staleness('dirreadagent').editedAt, undefined,
      'the mtime of a file outside the root was disclosed');
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlinked worker directory cannot land a write outside the root', (t) => {
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
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
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

test('a symlinked instruction file cannot be overwritten through the link', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-wlink-'));
  const target = path.join(outside, 'target.md');
  fs.writeFileSync(target, 'THE FILE THE LINK POINTS AT');
  fs.mkdirSync(path.join(ROOT, 'wlinkagent'), { recursive: true });
  const link = path.join(ROOT, 'wlinkagent', 'CLAUDE.md');
  try {
    fs.symlinkSync(target, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
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

test('a symlinked instruction file is not followed out of the workers root', (t) => {
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
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
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

test('the card and the panel never disagree about whether a file can be read', () => {
  // ⚠️ The blocker this pins, measured before the fix: `staleness` re-derived
  // "can we show this file" as the size-and-type check ALONE, while `read`
  // applied four refusals. So an unreadable file got a confident verdict on the
  // card, and with a back-dated mtime that verdict was `current`: a positive
  // claim of health, and a disclosed timestamp, about a file the app had
  // already decided it could not read. The rule this codebase runs on is that
  // something we cannot assess must not render as fine, and a third derivation
  // of one question is how that rule got broken with every guard looking right.
  const cases = [];

  // Not UTF-8, and back-dated so a naive comparison would answer `current`.
  fs.mkdirSync(path.join(ROOT, 'agreelatin'), { recursive: true });
  const latin = path.join(ROOT, 'agreelatin', 'CLAUDE.md');
  fs.writeFileSync(latin, Buffer.from('You are Ren\xE9, the accounts agent.\n', 'latin1'));
  fs.utimesSync(latin, new Date('2020-01-01'), new Date('2020-01-01'));
  makeSession('agreelatin', 'sess-agree-latin');
  cases.push('agreelatin');

  // Over the ceiling, also back-dated.
  const big = makeAgent('agreebig', 'x'.repeat(instructions.MAX_BYTES + 1));
  fs.utimesSync(big, new Date('2020-01-01'), new Date('2020-01-01'));
  makeSession('agreebig', 'sess-agree-big');
  cases.push('agreebig');

  // A directory where the file should be.
  fs.mkdirSync(path.join(ROOT, 'agreedir', 'CLAUDE.md'), { recursive: true });
  makeSession('agreedir', 'sess-agree-dir');
  cases.push('agreedir');

  for (const name of cases) {
    const card = instructions.staleness(name);
    const panel = instructions.read(name).staleness;
    assert.equal(card.state, panel.state, `${name}: the two surfaces disagree`);
    assert.equal(card.because, panel.because, `${name}: different reasons`);
    assert.equal(card.state, instructions.STALENESS.UNKNOWN,
      `${name}: a file we cannot read must never get a confident verdict`);
    assert.equal(card.editedAt, undefined,
      `${name}: disclosed the mtime of a file it refused to read`);
  }
});

test('read says whether a save is possible as a field, not as prose', () => {
  // The screen used to decide this by regex-matching the reason string, so
  // rewording one sentence here would have silently removed the ability to
  // write a first instruction file.
  makeAgent('editableyes');
  assert.equal(instructions.read('editableyes').editable, true);

  fs.mkdirSync(path.join(ROOT, 'editablenofile'), { recursive: true });
  assert.equal(instructions.read('editablenofile').editable, true,
    'no file yet is editable: that is how a first one gets written');

  assert.equal(instructions.read('editablenofolder').editable, false,
    'an agent with no folder has nowhere to save to');

  fs.mkdirSync(path.join(ROOT, 'editablelatin'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'editablelatin', 'CLAUDE.md'),
    Buffer.from('You are Ren\xE9 here.\n', 'latin1'));
  assert.equal(instructions.read('editablelatin').editable, false);
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
  // ⚠️ This asserts the `because` and the absent `editedAt`, not just the
  // state, and that is the whole point. BOTH inputs already reach `unknown`
  // without this guard, by a different route: `compare` tests `!editedAt`
  // first, and NaN and 0 are both falsy. So a test that only checked the state
  // would stay green against the guard being deleted. What the guard actually
  // buys is an accurate reason and no bogus `editedAt: 1970-01-01` on the wire,
  // and those are the only observables that tell the two paths apart.
  //
  // An earlier version of this comment said an epoch mtime would otherwise
  // resolve to `current`. That was wrong, and it is corrected here rather than
  // quietly deleted, because a test whose stated rationale is false is how a
  // future reader concludes the guard is more load-bearing than it is.
  const epochFile = makeAgent('epochtime');
  fs.utimesSync(epochFile, new Date(0), new Date(0));

  // A body of a length nothing else in this suite uses, so the injection below
  // can identify this file from a file DESCRIPTOR, which carries no path.
  const NAN_BODY = 'n'.repeat(4242);
  makeAgent('nantime', NAN_BODY);
  makeSession('nantime', 'sess-nan');

  // ⚠️ Patches `fstatSync`, which is what the shared reader actually asks for
  // the mtime. It used to patch `lstatSync`, and when the reader moved to
  // opening the file and asking the DESCRIPTOR (so a swapped path could not
  // change what we read), this injection silently stopped reaching the value
  // under test. A test that injects into the wrong call pins nothing.
  const real = fs.fstatSync;
  fs.fstatSync = (fd, ...rest) => {
    const st = real(fd, ...rest);
    if (st.size === NAN_BODY.length) {
      return Object.create(Object.getPrototypeOf(st), {
        ...Object.getOwnPropertyDescriptors(st),
        mtime: { value: new Date(NaN), enumerable: true },
      });
    }
    return st;
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
    fs.fstatSync = real;
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

test('every reader of the workers directory refuses the same files', (t) => {
  // ⚠️ The sixth instance of one defect, and the reason `engine/workerfile.js`
  // exists. `readIdentity` was given the DIRECTORY check and still had no FILE
  // check, so it followed a symlinked CLAUDE.md and served a name parsed out of
  // a file outside the root, while the instructions route for the same agent
  // refused. Both are measured below rather than reasoned about.
  const status = require('./status');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bothread-'));
  fs.writeFileSync(path.join(outside, 'private.md'),
    'You are **Outside Secret**, the private note that is not in the workers root.\n');
  fs.mkdirSync(path.join(ROOT, 'bothagent'), { recursive: true });
  const link = path.join(ROOT, 'bothagent', 'CLAUDE.md');
  try {
    fs.symlinkSync(path.join(outside, 'private.md'), link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
  }
  try {
    assert.equal(instructions.read('bothagent').exists, false);
    const id = status.readIdentity('bothagent');
    assert.equal(id.derived, false, 'readIdentity followed a symlinked instruction file');
    assert.notEqual(id.displayName, 'Outside Secret',
      'a name was parsed out of a file outside the workers root');
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a non-regular instruction file cannot wedge the board', (t) => {
  // ⚠️ A fifo makes `readFileSync` block forever inside a synchronous request
  // handler. `readIdentity` had no is-a-file check, so `snapshot()` never
  // returned, and because `knownAgent` also calls `snapshot()`, EVERY route on
  // the server hung with it and nothing crashed to say why.
  //
  // This test would hang rather than fail if the guard were removed, which is
  // worth knowing: a hang in the suite IS the failure signal here.
  const status = require('./status');
  const dir = path.join(ROOT, 'fifoagent');
  fs.mkdirSync(dir, { recursive: true });
  const fifo = path.join(dir, 'CLAUDE.md');
  try {
    require('node:child_process').execFileSync('mkfifo', [fifo]);
  } catch {
    t.skip('mkfifo is unavailable on this machine');
    return;
  }
  try {
    // ⚠️ Run in a CHILD PROCESS with a timeout, deliberately.
    //
    // The reader now opens with `O_NONBLOCK`, so removing the type checks alone
    // makes this FAIL in milliseconds rather than hang: the fifo reads as EOF.
    // The hang returns only if the reader is ALSO reverted to
    // `readFileSync(path)`, measured at just over five seconds and reported
    // correctly by this timeout.
    //
    // The harness stays. The hang is what happens on the code shape this branch
    // shipped for two iterations, a synchronous read of a fifo cannot be
    // interrupted in-process, and a hung suite reads as broken infrastructure
    // rather than as a caught bug on the one guard whose absence takes down
    // every route. An earlier version of this comment said the removal "would
    // hang" flatly, which stopped being true when the reader changed.
    //
    // A hung suite reads as broken infrastructure, not as a caught bug, so the
    // signal was worse than useless on the one guard whose absence takes down
    // every route on the server. A timeout turns it back into a real failure
    // with a message that says what happened.
    const probe = `
      process.env.AGENT_WORKFORCE_WORKERS = ${JSON.stringify(ROOT)};
      const i = require(${JSON.stringify(require.resolve('./instructions'))});
      const s = require(${JSON.stringify(require.resolve('./status'))});
      if (i.read('fifoagent').exists) throw new Error('read served a fifo');
      if (s.readIdentity('fifoagent').derived) throw new Error('readIdentity read a fifo');
      console.log('ok');
    `;
    let out;
    try {
      out = require('node:child_process')
        .execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 5000 });
    } catch (err) {
      assert.fail(err.killed
        ? 'reading a fifo BLOCKED: the is-a-file guard is gone and this would wedge every route'
        : `the fifo probe failed: ${err.stderr || err.message}`);
    }
    assert.match(out, /ok/);
  } finally {
    fs.rmSync(fifo, { force: true });
  }
});

test('the status engine does not read an identity through a linked worker folder', (t) => {
  // ⚠️ The FOURTH reader of the workers root, and the last one to be closed.
  // `instructions.js` refuses a linked worker folder on all three of its paths;
  // `readIdentity` did not, so the board rendered a name and role parsed from a
  // file outside the root and presented it as that agent's identity, while the
  // instructions route for the same agent correctly refused.
  const status = require('./status');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-idlink-'));
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'),
    'You are **Outside**, the file outside the root that must not be served.\n');
  const link = path.join(ROOT, 'idlinkagent');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    // Visible, not silent: a bare return prints a tick for a test that asserted
    // nothing, which is the exact anti-pattern `anyAgent` in server.test.js was
    // written to avoid, and it is what would go quiet on a filesystem with no
    // symlink support.
    t.skip('symlinks are unavailable on this filesystem');
    return;
  }
  try {
    const id = status.readIdentity('idlinkagent');
    assert.equal(id.derived, false, 'an identity was derived through a directory symlink');
    assert.notEqual(id.displayName, 'Outside', 'content from outside the root was served as a name');
    assert.equal(id.role, null);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('the status engine resolves worker files under the SAME root as this module', () => {
  // ⚠️ Pins the one thing keeping `node --test` off the live CLAUDE.md files
  // that real agents boot from. `status.js` used to carry its own hardcoded
  // `~/work/workers`, so a suite that believed it was sandboxed was reading the
  // operator's real agents, and reverting that one line left everything green.
  //
  // Deliberately here rather than in the route tests: those need a live tmux
  // fleet and skip without one, and node:test reports a skip as a pass. A guard
  // this load-bearing cannot be pinned by a test that evaporates on any machine
  // without agents running, which is every CI runner.
  const status = require('./status');
  const name = 'rootfixture';
  fs.mkdirSync(path.join(ROOT, name), { recursive: true });
  fs.writeFileSync(path.join(ROOT, name, 'CLAUDE.md'),
    `You are **Root Fixture**, the sandbox check worker.\n`);

  const id = status.readIdentity(name);
  assert.equal(id.displayName, 'Root Fixture',
    'status.js did not read the sandboxed file, so it resolves a different root');
  assert.equal(id.derived, true);
});

test('a file we cannot get at is not reported as a file that is not there', (t) => {
  // ⚠️ Any `lstat` failure used to mean "no instruction file yet", and that
  // answer becomes `editable: true` upstream. So an unsearchable worker folder
  // (mode 000) holding real instructions was reported as "there is no
  // instruction file for this one yet", with an enabled empty editor offered
  // over the top of it: a positive false claim about the most sensitive file in
  // the product, from the one error that is not ENOENT.
  const dir = path.join(ROOT, 'lockedagent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'REAL INSTRUCTIONS INSIDE AN UNSEARCHABLE FOLDER');
  fs.chmodSync(dir, 0o000);
  try {
    const got = instructions.read('lockedagent');
    if (got.editable && got.exists) {
      t.skip('running as root, so an unsearchable directory is still readable');
      return;
    }
    assert.equal(got.exists, false);
    assert.equal(got.editable, false, 'offered an editor for a file it could not even look at');
    assert.doesNotMatch(got.because, /no instruction file/,
      'claimed there is no file when it simply could not look');
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('a symlinked INTERMEDIATE component cannot lead the read out of the root', (t) => {
  // ⚠️ The escape a string-prefix containment check believes.
  //
  // `path.resolve(file).startsWith(root)` is satisfied by any path that LOOKS
  // like it is under the root, and `dirEscapes` only lstats the IMMEDIATE
  // parent, so a link one level further up passed both. Measured before the
  // fix: `<ROOT>/sub` linked elsewhere made `readWorkerFile` return `ok: true`
  // with the foreign file's contents, and `readIdentity('sub/victim')` put a
  // name and role parsed out of that file on the board as an agent's identity.
  //
  // Same escape as the immediate parent, one level up, in the module written so
  // it could not happen again. `realpath` resolves every component at once.
  const workerfile = require('./workerfile');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mid-'));
  fs.mkdirSync(path.join(outside, 'victim'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'victim', 'CLAUDE.md'),
    'You are **Outside Secret**, the file outside the workers root.\n');
  const link = path.join(ROOT, 'sublink');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    fs.rmSync(outside, { recursive: true, force: true });
    t.skip('symlinks are unavailable on this filesystem');
    return;
  }
  try {
    const got = workerfile.readWorkerFile(path.join(ROOT, 'sublink', 'victim', 'CLAUDE.md'), ROOT);
    assert.equal(got.ok, false, 'the read followed a symlinked intermediate component');

    const status = require('./status');
    const id = status.readIdentity(path.join('sublink', 'victim'));
    assert.equal(id.derived, false, 'an identity was derived from outside the root');
    assert.notEqual(id.displayName, 'Outside Secret');
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('the shared reader refuses a path outside the workers root', () => {
  // ⚠️ Extracting the file checks into `workerfile` did NOT close containment
  // for its second caller, and the module read as though it had.
  // `instructions.fileFor` sanitises the name and asserts it is under the root;
  // `status.readIdentity` joins the tmux session name verbatim and did neither.
  // Measured before the fix: `readIdentity('../victim')` returned a name and
  // role parsed out of a file outside the root, while the instructions route
  // for the same name refused.
  const status = require('./status');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-escape-'));
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'),
    'You are **Outside Victim**, the file outside the workers root.\n');
  const escape = path.join(path.relative(ROOT, outside));
  try {
    // Sanity: the fixture really is reachable by a naive join.
    assert.ok(fs.existsSync(path.join(ROOT, escape, 'CLAUDE.md')),
      'fixture is wrong: the escape target does not exist');

    const workerfile = require('./workerfile');
    assert.equal(workerfile.readWorkerFile(path.join(ROOT, escape, 'CLAUDE.md'), ROOT).ok, false,
      'the shared reader read a file outside the root it was given');

    // And the root is not optional. It was, justified as convenience for a
    // test, in the one module whose whole purpose is that a guard cannot be
    // forgotten. An optional containment check is one a future caller omits.
    assert.throws(() => workerfile.readWorkerFile(path.join(ROOT, 'x', 'CLAUDE.md')),
      /needs the root/, 'containment can be skipped by omitting an argument');

    const id = status.readIdentity(escape);
    assert.equal(id.derived, false, 'an identity was derived from outside the workers root');
    assert.notEqual(id.displayName, 'Outside Victim');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
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
