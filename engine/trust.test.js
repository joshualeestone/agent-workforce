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

const { trustFolder, KEY } = require('./trust');

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
  assert.deepEqual(r, { ok: true, already: false });
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
  write({ projects: { [d]: { allowedTools: ['Bash(ls:*)'], mcpServers: { linear: {} }, [KEY]: false } } });
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
  write({ projects: { [d]: { [KEY]: true } } });
  const before = raw();
  assert.deepEqual(trustFolder(d), { ok: true, already: true });
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
  clear();
  fs.writeFileSync(CONFIG, '', 'utf8');
  const d = folder();
  assert.equal(trustFolder(d).ok, false);
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
  const d = folder();
  write({ projects: {} }, 0o600);
  fs.chmodSync(CONFIG, 0o600);
  assert.equal(trustFolder(d).ok, true);
  assert.equal(fs.statSync(CONFIG).mode & 0o7777, 0o600);
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
