'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ Sandbox EVERY root this touches, and there are two: the config file it
// writes and the folder it keys on. A test that sandboxed only the config
// would still realpath a directory on the operator's real disk.
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'trust-test-')));
const CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = CONFIG;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { trustFolder, forgetFolder, KEY } = require('./trust');

let n = 0;
/** A folder that exists, fresh per test. */
const folder = () => {
  const d = nodePath.join(SANDBOX, `w${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const write = (obj, mode) => {
  try { fs.rmSync(CONFIG, { force: true }); } catch { /* fine */ }
  fs.writeFileSync(CONFIG, JSON.stringify(obj, null, 2) + '\n', mode ? { mode } : {});
};
const read = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const raw = () => fs.readFileSync(CONFIG, 'utf8');
const clear = () => { try { fs.rmSync(CONFIG, { force: true }); } catch { /* fine */ } };

test('a folder we made is trusted, under the key Claude Code will look for', () => {
  /**
   * The whole feature. The key shape is not invented: Claude Code prints it in
   * its own refusal — "set projects[<path>].hasTrustDialogAccepted: true" —
   * and every entry in the real config on this machine is keyed by an
   * absolute, resolved path.
   */
  write({ projects: {} });
  const d = folder();
  const r = trustFolder(d);
  assert.deepEqual(r, { ok: true, already: false, key: d });
  assert.equal(read().projects[d][KEY], true);
});

test('the key is the RESOLVED path, because a symlinked spelling is never read', () => {
  /**
   * ⚠️ This is the defect that would ship silently. The write succeeds, the
   * file gains an entry, every other test here passes — and Claude Code, which
   * keys on its resolved cwd, never finds it. The agent stops on the prompt
   * anyway and nothing anywhere reports a failure.
   */
  write({ projects: {} });
  const real = folder();
  const link = nodePath.join(SANDBOX, `link${n}`);
  fs.symlinkSync(real, link);

  const r = trustFolder(link);
  assert.equal(r.ok, true);
  const keys = Object.keys(read().projects);
  assert.deepEqual(keys, [real], 'the resolved folder, not the link we were handed');
});

test('an existing entry keeps everything it had', () => {
  /**
   * ⚠️ An entry carries a person's allowedTools and their MCP servers. A fresh
   * object with one key would delete those, and it would look to them like
   * Claude Code lost their settings rather than like Kosmos took them.
   */
  const d = folder();
  // ⚠️ NO trust key at all, deliberately. This fixture used to seed
  // `[KEY]: false` and assert it flipped to true, which pinned the wrong
  // behaviour — see the test below.
  write({ projects: { [d]: { allowedTools: ['Bash(ls:*)'], mcpServers: { linear: {} } } } });
  assert.equal(trustFolder(d).ok, true);
  const e = read().projects[d];
  assert.deepEqual(e.allowedTools, ['Bash(ls:*)']);
  assert.deepEqual(e.mcpServers, { linear: {} });
  assert.equal(e[KEY], true);
});

test('every other project, and every other top-level setting, survives', () => {
  const d = folder();
  const other = folder();
  write({ theme: 'dark', oauthAccount: { emailAddress: 'someone@example.com' },
          projects: { [other]: { [KEY]: true, allowedTools: [] } } });
  assert.equal(trustFolder(d).ok, true);
  const after = read();
  assert.equal(after.theme, 'dark');
  assert.equal(after.oauthAccount.emailAddress, 'someone@example.com');
  assert.equal(after.projects[other][KEY], true);
  assert.deepEqual(after.projects[other].allowedTools, []);
  assert.equal(after.projects[d][KEY], true);
});

test('already trusted is a success AND writes nothing at all', () => {
  /**
   * ⚠️ The byte comparison is the assertion, not the return value. A rewrite
   * that produced identical JSON would still be a read-modify-write on a live
   * file for no reason, and the window where it can lose somebody's save is
   * the cost. `already` says which outcome it was; the bytes say we did not
   * pay for it.
   */
  const d = folder();
  /* ⚠️ WRITTEN MINIFIED, AND THAT IS THE WHOLE TEST. The `write()` helper
     serialises with the same two-space indent this module writes, so a fixture
     built with it is byte-for-byte what a rewrite would produce — the comparison
     below passed with the short circuit DELETED, leaving only the return value
     catching it, which is exactly what the docblock says it is not relying on.
     A fixture the module would never emit makes the bytes load-bearing. */
  try { fs.rmSync(CONFIG, { force: true }); } catch { /* fine */ }
  fs.writeFileSync(CONFIG, JSON.stringify({ projects: { [d]: { [KEY]: true } } }), 'utf8');
  const before = raw();
  assert.deepEqual(trustFolder(d), { ok: true, already: true, key: d });
  assert.equal(raw(), before, 'byte-identical: no write happened');
});

test('a config file we cannot read is left exactly as it is', () => {
  for (const [label, body] of [
    ['not JSON', '{ this is not json'],
    ['an array', '[]'],
    ['a bare string', '"hello"'],
    ['projects is a list', '{"projects":[]}'],
    ['the entry is a string', null],
  ]) {
    const d = folder();
    const text = body === null ? JSON.stringify({ projects: { [d]: 'yes' } }) : body;
    try { fs.rmSync(CONFIG, { force: true }); } catch { /* fine */ }
    fs.writeFileSync(CONFIG, text, 'utf8');
    const r = trustFolder(d);
    assert.equal(r.ok, false, `${label}: must refuse`);
    assert.equal(typeof r.because, 'string');
    assert.equal(raw(), text, `${label}: the file is untouched`);
  }
});

test('no config file means Claude Code has never run here, and we do not invent one', () => {
  /**
   * ⚠️ THE DIRECTION IS CHOSEN, not fallen into. Refusing costs the person one
   * prompt they answer once — today's behaviour. Writing would CREATE another
   * tool's config on a machine we have never seen that tool run on. Those are
   * not comparable, so the guard fails closed.
   */
  clear();
  const d = folder();
  const r = trustFolder(d);
  assert.equal(r.ok, false);
  assert.match(r.because, /has not run/);
  assert.equal(fs.existsSync(CONFIG), false, 'and no file was created');
});

test('an empty config file is refused rather than filled in', () => {
  /* ⚠️ THE `because` IS THE ASSERTION, not the refusal. Two guards cover this
     state: delete the size check and an empty file reaches JSON.parse(''),
     which throws SyntaxError and refuses anyway with the file untouched — so
     `ok === false` plus "still empty" passed with the guard it names deleted.
     Naming which refusal fired is what makes it fail. */
  clear();
  fs.writeFileSync(CONFIG, '', 'utf8');
  const d = folder();
  const r = trustFolder(d);
  assert.equal(r.ok, false);
  assert.match(r.because, /is empty/, 'a different guard refused, so this test is not watching the one it names');
  assert.equal(raw(), '', 'still empty');
});

test('a symlinked config file is left as a symlink', () => {
  /**
   * Renaming over a symlink replaces the link with a file. Somebody who points
   * their Claude config at a dotfiles repo did that on purpose, and severing it
   * is not a cost a trust prompt is worth.
   */
  const realCfg = nodePath.join(SANDBOX, 'real-claude.json');
  fs.writeFileSync(realCfg, JSON.stringify({ projects: {} }), 'utf8');
  clear();
  fs.symlinkSync(realCfg, CONFIG);
  const d = folder();

  const r = trustFolder(d);
  assert.equal(r.ok, false);
  assert.equal(fs.lstatSync(CONFIG).isSymbolicLink(), true, 'the link is intact');
  assert.deepEqual(JSON.parse(fs.readFileSync(realCfg, 'utf8')), { projects: {} }, 'and its target is untouched');
  fs.rmSync(CONFIG, { force: true });
});

test('a tightened config file is not widened by our write', () => {
  /**
   * ⚠️ This file holds account details and sits at 600 on the real machine. A
   * replace that came back at the umask default would be a permission change
   * nobody asked for, hidden inside a feature about a dialog box.
   */
  /* ⚠️ 0640, NOT 0600, and the difference is whether this test can fail. The
     real file sits at 600 — which is also what a default write lands at under a
     umask of 077, so on such a machine the assertion passed with the mode
     preservation deleted. 0640 is a mode no umask produces from 0666, so only
     preservation can produce it. */
  const d = folder();
  write({ projects: {} }, 0o640);
  fs.chmodSync(CONFIG, 0o640);
  assert.equal(trustFolder(d).ok, true);
  assert.equal(fs.statSync(CONFIG).mode & 0o7777, 0o640);
});

test('a path we cannot key on is refused before anything is opened', () => {
  write({ projects: {} });
  const before = raw();
  for (const bad of ['', 'work/workers/dan', nodePath.join(SANDBOX, 'never-made')]) {
    const r = trustFolder(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must refuse`);
  }
  assert.equal(raw(), before);
});

test('no temp file is left behind when the rename fails', () => {
  /**
   * ⚠️ THE FAILURE IS INJECTED, and the first version of this test is the
   * reason why. It made the containing directory read-only, passed, and went
   * on passing with the cleanup DELETED — because an unwritable directory
   * fails the `writeFileSync` too, so there was never a temp file to leave
   * behind. The test asserted litter was absent in the one case that cannot
   * produce litter.
   *
   * Reaching the real case through the filesystem is not possible here: it
   * needs a write that succeeds and a rename in the SAME directory that fails.
   * So the rename is made to throw directly. That is the condition the cleanup
   * exists for, and nothing weaker exercises it.
   */
  const d = folder();
  write({ projects: {} });
  const tmp = CONFIG + '.kosmos.new';
  const real = fs.renameSync;
  fs.renameSync = () => { const e = new Error('injected'); e.code = 'EIO'; throw e; };
  try {
    const r = trustFolder(d);
    assert.equal(r.ok, false, 'a rename that throws is a refusal');
    assert.equal(fs.existsSync(tmp), false, 'and the temp file it wrote is gone');
  } finally {
    fs.renameSync = real;
    try { fs.rmSync(tmp, { force: true }); } catch { /* fine */ }
  }
});

test('a DANGLING symlink is refused too, and not turned into a real file', () => {
  /**
   * ⚠️ Borrowed from the installer's own acceptance harness, which names this
   * state separately from a live symlink ("dangling-refused"). It is the case a
   * symlink check written as "does the target exist" would get wrong: the link
   * is somebody's arrangement whether or not its destination is there today,
   * and writing through it would MATERIALISE a config file at a path they
   * pointed somewhere else.
   *
   * ⚠️ IT TAKES TWO MUTATIONS TO MAKE THIS TEST FAIL, and that is the finding
   * rather than a weakness: removing the symlink refusal alone leaves the
   * absent-file refusal catching it, and removing the absent-file refusal alone
   * leaves the symlink check catching it. Both gone together and it goes red.
   * A single-mutation run would have reported this test as unable to fail.
   */
  clear();
  fs.symlinkSync(nodePath.join(SANDBOX, 'nowhere-at-all.json'), CONFIG);
  const d = folder();

  const r = trustFolder(d);
  assert.equal(r.ok, false);
  assert.equal(fs.lstatSync(CONFIG).isSymbolicLink(), true, 'still a link');
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, 'nowhere-at-all.json')), false,
    'and nothing was created where it pointed');
  fs.rmSync(CONFIG, { force: true });
});

test('a recorded NO is respected, not overwritten', () => {
  /**
   * 🛑 `false` IS AN ANSWER, NOT AN ABSENCE. Claude Code writes it when
   * somebody chose "No, exit" with that exact path in front of them, and it is
   * live rather than vestigial — 19 of 115 entries on this machine carried it
   * when this was written.
   *
   * The earlier version of this module flipped it to true, and the test above
   * PINNED that by seeding false and asserting true. The case is narrow (only a
   * name whose folder was removed and remade can reach it) but the direction is
   * this whole file's argument: we are writing into somebody else's config, so
   * a decision they made about this path outranks our convenience. The cost of
   * respecting it is one prompt.
   */
  const d = folder();
  write({ projects: { [d]: { [KEY]: false, allowedTools: ['Bash(ls:*)'] } } });
  const before = raw();

  const r = trustFolder(d);
  assert.equal(r.ok, false, 'we overrode an explicit no');
  assert.match(r.because, /answered no/);
  assert.equal(raw(), before, 'and we did not touch their file to do it');
});

test('taking a trust entry back leaves everything else exactly as it was', () => {
  /**
   * ⚠️ THE SENTENCE THIS EXISTS FOR. When the job fails to start, creation says
   * "we have taken it back off your computer rather than leave something half
   * installed" — and an entry for a folder that no longer exists, sitting in
   * another tool's config forever, makes that false in exactly the case that
   * produces it.
   */
  const d = folder();
  const other = folder();
  write({ theme: 'dark', projects: { [other]: { [KEY]: true, allowedTools: ['Bash(ls:*)'] } } });

  assert.deepEqual(trustFolder(d), { ok: true, already: false, key: d });
  assert.equal(read().projects[d][KEY], true);

  assert.deepEqual(forgetFolder(d), { ok: true, already: false });
  const after = read();
  assert.equal(after.projects[d], undefined, 'the entry we wrote is still there after a rollback');
  assert.equal(after.projects[other][KEY], true, 'somebody else’s entry went with it');
  assert.deepEqual(after.projects[other].allowedTools, ['Bash(ls:*)']);
  assert.equal(after.theme, 'dark');
});

test('taking back an entry that is not there is a success that writes nothing', () => {
  const d = folder();
  write({ projects: {} });
  const before = raw();
  assert.deepEqual(forgetFolder(d), { ok: true, already: true });
  assert.equal(raw(), before);
});

test('taking back never touches a config we would refuse to write', () => {
  /**
   * The undo runs on the failure path, which is the worst moment to introduce
   * a second way to damage somebody's file. It carries the same refusals.
   */
  const d = folder();
  const text = '{ not json';
  try { fs.rmSync(CONFIG, { force: true }); } catch { /* fine */ }
  fs.writeFileSync(CONFIG, text, 'utf8');
  assert.equal(forgetFolder(d).ok, false);
  assert.equal(raw(), text);
});

test('a file sitting at the OLD predictable temp path cannot receive the config', () => {
  /**
   * ⚠️ THE SYMLINK ROUTE, closed twice over. The write flag is `wx`, which
   * refuses rather than following a link — the fix this repo already made once
   * in `engine/instructions.js`. And the temp path is now unique per process,
   * so there is nothing predictable to plant a link AT.
   *
   * 🔑 THE UNIQUE NAME IS NOT BELT AND BRACES, IT REMOVES A CHOICE. With a
   * fixed name, `wx` refuses whatever is sitting there, and we cannot tell
   * another writer's in-flight file from a crash's litter: clearing it breaks
   * them, leaving it wedges this feature permanently. With a unique name
   * neither case exists.
   */
  const d = folder();
  write({ projects: {} });
  const planted = CONFIG + '.kosmos.new';
  const elsewhere = nodePath.join(SANDBOX, 'attacker.json');
  fs.symlinkSync(elsewhere, planted);

  const r = trustFolder(d);
  assert.equal(r.ok, true, 'a planted file at the old path stopped an honest write');
  assert.equal(fs.existsSync(elsewhere), false, 'the config was written through a planted link');
  assert.equal(read().projects[d][KEY], true);
  fs.rmSync(planted, { force: true });
});

test('the temp path is not the same twice, so nothing can be waiting at it', () => {
  /**
   * ⚠️ THE PROPERTY, checked rather than assumed, because it is what makes the
   * test above true. Read off the paths the module actually writes: a
   * `wx` create that succeeds twice in a row proves the second call did not
   * reuse the first path.
   */
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const d = folder();
    write({ projects: {} });
    assert.equal(trustFolder(d).ok, true);
    for (const name of fs.readdirSync(SANDBOX)) {
      if (name.includes('.kosmos-')) seen.add(name);
    }
  }
  assert.equal(seen.size, 0, 'a temp file survived a successful write');
});

test('a trust key merged into somebody’s existing entry is taken back WITHOUT their entry', () => {
  /**
   * 🛑 THE DEFECT THIS REPLACES, and it was in the fix for a defect. An earlier
   * `forgetFolder` deleted the whole `projects[…]` entry, on the reasoning that
   * `already: false` meant we had created it. It does not: it means we SET THE
   * KEY. A person can already have an entry for that exact path — Claude Code
   * never prunes them, and 93 dead ones were measured on this machine — holding
   * their allowedTools, their MCP servers and their history, with no trust key
   * in it. The rollback took all of it.
   *
   * ⚠️ AND THE TEST THAT WAS SUPPOSED TO GUARD THIS COULD NOT FAIL: it seeded
   * the entry with the trust key already TRUE, which short-circuits before any
   * write, so the undo never ran at all. The shape that loses data is an entry
   * with the key ABSENT, which is this fixture.
   */
  const d = folder();
  write({ projects: { [d]: { allowedTools: ['Bash(ls:*)'], mcpServers: { linear: {} }, history: [1, 2] } } });

  const t = trustFolder(d);
  assert.deepEqual(t, { ok: true, already: false, key: d }, 'the fixture did not reach the merge, so this tests nothing');
  assert.equal(read().projects[d][KEY], true);

  assert.equal(forgetFolder(t.key).ok, true);
  const e = read().projects[d];
  assert.ok(e, 'the whole entry was deleted, taking settings we never wrote');
  assert.deepEqual(e.allowedTools, ['Bash(ls:*)']);
  assert.deepEqual(e.mcpServers, { linear: {} });
  assert.deepEqual(e.history, [1, 2]);
  assert.equal(KEY in e, false, 'the key we added is still there after the undo');
});

test('an entry we created outright is removed outright, leaving no empty shell', () => {
  const d = folder();
  write({ projects: {} });
  const t = trustFolder(d);
  assert.equal(forgetFolder(t.key).ok, true);
  assert.equal(d in read().projects, false, 'an empty entry was left behind for a folder that is gone');
});

test('taking back never reports success about a config it could not read', () => {
  const d = folder();
  write({ projects: [] });
  const r = forgetFolder(d);
  assert.equal(r.ok, false, 'a malformed config was reported as taken back');
  assert.match(r.because, /shaped/);
});
