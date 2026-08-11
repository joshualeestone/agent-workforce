'use strict';

/**
 * The projects routes, driven against the real server.
 *
 * A SEPARATE FILE from `server.test.js`, on purpose. The `restart` branch has
 * been parked for days on a merge of two versions of one test file whose blocks
 * had been restructured on both sides — four scripted approaches failed, and
 * the closest three-way still cut conflict boundaries through the middle of
 * test bodies. PR #28 adds 516 lines to `server.test.js`. This feature adds
 * none, so the union is a file list rather than a merge.
 *
 * ⚠️ SANDBOX ALL THREE ROOTS BEFORE ANY REQUIRE. The instruction files these
 * routes write are the ones live agents boot from: an unsandboxed run does not
 * litter, it changes how working agents behave the next time they start.
 *
 *   node --test server.projects.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-projects-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');

const WORK = path.join(SANDBOX, 'work');
fs.mkdirSync(WORK, { recursive: true });

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function req(p, options) {
  const res = await fetch(base + p, options);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}
const json = (r) => JSON.parse(r.body);

async function post(p, body) {
  return req(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body || {}),
  });
}

function folder(name) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function reset() {
  try { fs.rmSync(projects.file()); } catch { /* nothing yet */ }
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test('the list answers as JSON, and as an empty list before anything exists', async () => {
  reset();
  const res = await req('/api/projects');
  assert.ok(res.type.includes('application/json'));
  assert.deepEqual(json(res).projects, []);
});

test('a project can be created and read back', async () => {
  reset();
  const dir = folder('henderson');
  const made = await post('/api/projects', { name: 'Henderson lease', folder: dir });
  assert.equal(made.status, 200);
  assert.equal(json(made).project.name, 'Henderson lease');

  const list = json(await req('/api/projects')).projects;
  assert.equal(list.length, 1);
  assert.equal(list[0].folderState.state, projects.FOLDER.READABLE);
});

test('a project pointed at a folder that is not there is refused with a sentence, not a stack', async () => {
  reset();
  const res = await post('/api/projects', { name: 'Ghost', folder: path.join(WORK, 'nope') });
  assert.equal(res.status, 400);
  assert.match(json(res).error, /no folder at that path/);
  assert.ok(!/Error:|at Object\./.test(json(res).error), 'our sentence, never a raw throw');
});

test('a project whose folder disappears is still listed, and says so', async () => {
  reset();
  const dir = folder('vanishing');
  await post('/api/projects', { name: 'Vanishing', folder: dir });

  // The control: readable first, or "missing" afterwards proves nothing.
  assert.equal(json(await req('/api/projects')).projects[0].folderState.state, projects.FOLDER.READABLE);

  fs.rmSync(dir, { recursive: true });

  const after = json(await req('/api/projects')).projects;
  assert.equal(after.length, 1, 'a project is not dropped because we cannot see its folder');
  assert.equal(after[0].folderState.state, projects.FOLDER.MISSING);
});

test('a project id that does not exist answers 404 as JSON, not the page at 200', async () => {
  const res = await req('/api/project/nothing-here');
  assert.equal(res.status, 404);
  assert.ok(res.type.includes('application/json'));
});

test('a query string does not fall through to the HTML page', async () => {
  // The bug this whole test file's sibling exists for: routes matched against
  // `req.url` stop matching the moment a caller appends anything, and the
  // server answers an API call with HTML at 200.
  const res = await req('/api/projects?t=12345');
  assert.ok(res.type.includes('application/json'), res.type);
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

test('an agent can be put on a project and taken off again', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Members', folder: folder('members') })).project;

  const added = await post(`/api/project/${made.id}/agent/mara`);
  assert.equal(added.status, 200);
  // Control before absence: assert it is actually on before asserting it comes off.
  assert.deepEqual(json(added).project.agents.map((a) => a.sessionName), ['mara']);

  const removed = await req(`/api/project/${made.id}/agent/mara`, {
    method: 'DELETE', headers: { origin: base },
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(json(removed).project.agents, []);
});

test('putting an agent on a project reports whether we could tell it', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Telling', folder: folder('telling') })).project;
  const res = await post(`/api/project/${made.id}/agent/nobody-here`);

  assert.equal(res.status, 200, 'an agent we cannot tell is still a membership');
  const told = json(res).told;
  assert.equal(told.state, projects.TOLD.COULD_NOT);
  assert.ok(told.because, 'and the screen is given the reason, because it has to say one');
});

test('a project is still created when its agents are ones we cannot tell', async () => {
  reset();
  // ⚠️ Recording a membership and announcing it are two acts, and the second
  // failing must not undo the first. Without this test, a change that made
  // creation depend on the announcement would refuse the whole project — and
  // the person would be told their project could not be made because an agent
  // has no instruction file, which is not a reason they can act on.
  const res = await post('/api/projects', {
    name: 'Untellable', folder: folder('untellable'), agents: ['nobody-here', 'nor-here'],
  });
  assert.equal(res.status, 200, res.body);
  assert.deepEqual(
    json(res).project.agents.map((a) => a.sessionName).sort(), ['nobody-here', 'nor-here'],
  );
  assert.equal(json(await req('/api/projects')).projects.length, 1, 'and it survives a reload');
});

test('removing a project keeps the folder and everything in it', async () => {
  reset();
  const dir = folder('deleteme');
  fs.writeFileSync(path.join(dir, 'work.txt'), 'the user’s actual work');
  const made = json(await post('/api/projects', { name: 'Delete', folder: dir })).project;

  const res = await req(`/api/project/${made.id}`, { method: 'DELETE', headers: { origin: base } });
  assert.equal(res.status, 200);
  assert.deepEqual(json(await req('/api/projects')).projects, []);
  assert.ok(fs.existsSync(path.join(dir, 'work.txt')), 'this product does not delete anybody’s work');
});

test('a write from another site is refused before it reaches the engine', async () => {
  reset();
  const res = await req('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ name: 'Evil', folder: folder('evil') }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(json(await req('/api/projects')).projects, [], 'and nothing was written');
});

// ---------------------------------------------------------------------------
// Choosing a folder — the new safety code, attacked rather than exercised
// ---------------------------------------------------------------------------

test('the folder list starts at home and offers only folders', async () => {
  const res = await req('/api/folders');
  assert.equal(res.status, 200);
  const body = json(res);
  assert.equal(body.path, fs.realpathSync(os.homedir()));
  assert.equal(body.parent, null, 'there is no "up" from home, so there is no way out of it');
  assert.ok(Array.isArray(body.folders));
  assert.ok(body.folders.every((f) => fs.statSync(f.path).isDirectory()), 'every entry offered is really a folder');
  assert.ok(body.folders.every((f) => !f.name.startsWith('.')), 'no dotfiles');
});

test('only real folders are offered, and a link to a FILE is not one', async () => {
  // ⚠️ Aimed at the failure rather than at the mechanism. The first version of
  // this test asserted "everything offered is a directory" against the real
  // home folder, which contains no link-to-a-file — so it could not fail, and a
  // mutation that dropped the directory check passed it. A test needs the thing
  // it is looking for to actually be there.
  const root = fs.mkdtempSync(path.join(os.homedir(), 'kosmos-test-browse-'));
  try {
    fs.mkdirSync(path.join(root, 'a-real-folder'));
    fs.writeFileSync(path.join(root, 'a-file.txt'), 'x');
    fs.symlinkSync(path.join(root, 'a-file.txt'), path.join(root, 'link-to-a-file'));
    fs.symlinkSync(path.join(root, 'a-real-folder'), path.join(root, 'link-to-a-folder'));

    const body = json(await req(`/api/folders?path=${encodeURIComponent(root)}`));
    const names = body.folders.map((f) => f.name).sort();

    // The control: the two things that ARE folders are offered.
    assert.deepEqual(names, ['a-real-folder', 'link-to-a-folder'],
      'a link to a folder is a perfectly ordinary way to keep work; a link to a file is not a folder');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a folder inside home can be opened', async () => {
  const inside = path.join(os.homedir(), 'work');
  if (!fs.existsSync(inside)) return;
  const res = await req(`/api/folders?path=${encodeURIComponent(inside)}`);
  assert.equal(res.status, 200, 'the control: an allowed path really is allowed');
  assert.equal(json(res).path, fs.realpathSync(inside));
  assert.ok(json(res).parent, 'and below home there IS an up');
});

test('climbing out of home with .. is refused', async () => {
  const res = await req(`/api/folders?path=${encodeURIComponent(path.join(os.homedir(), '..', '..'))}`);
  assert.equal(res.status, 403, res.body);
  assert.match(json(res).error, /only look inside your home folder/);
});

test('an absolute path outside home is refused', async () => {
  for (const p of ['/etc', '/', '/var/root', '/Users']) {
    const res = await req(`/api/folders?path=${encodeURIComponent(p)}`);
    assert.ok(res.status === 403 || res.status === 400, `${p} answered ${res.status}`);
    assert.ok(!/"folders"/.test(res.body), `${p} must not list anything`);
  }
});

test('a SYMLINK inside home pointing outside it is refused', async () => {
  // ⚠️ The case every string-level check misses, and the reason containment is
  // asserted on the resolved path rather than on the spelling of the one asked
  // for. This link is inside home by every prefix test there is.
  const link = path.join(os.homedir(), '.kosmos-test-escape');
  try { fs.rmSync(link); } catch { /* first run */ }
  fs.symlinkSync('/etc', link);
  try {
    const res = await req(`/api/folders?path=${encodeURIComponent(link)}`);
    assert.equal(res.status, 403, res.body);
    assert.ok(!/"folders"/.test(res.body), 'and nothing outside home was listed');
  } finally {
    fs.rmSync(link, { force: true });
  }
});

test('a path with a null byte is refused rather than truncated', async () => {
  // ⚠️ A REAL null byte, written as an ESCAPE. The first version of this file
  // carried the byte literally in the source, which made the whole test file
  // register as binary -- `grep` stopped matching it and `file` reported
  // `data`. The test was right and unreadable, which is its own defect.
  const res = await req(`/api/folders?path=${encodeURIComponent(os.homedir() + '\0/etc')}`);
  assert.ok(res.status === 400 || res.status === 403, `answered ${res.status}`);
  assert.ok(!/"folders"/.test(res.body));
});

test('a path that does not exist is refused', async () => {
  const res = await req(`/api/folders?path=${encodeURIComponent(path.join(os.homedir(), 'definitely-not-a-real-folder-xyz'))}`);
  assert.equal(res.status, 400);
});

test('a file is refused as somewhere to browse', async () => {
  const f = path.join(os.homedir(), '.kosmos-test-file');
  fs.writeFileSync(f, 'x');
  try {
    const res = await req(`/api/folders?path=${encodeURIComponent(f)}`);
    assert.equal(res.status, 400, res.body);
  } finally {
    fs.rmSync(f, { force: true });
  }
});

test('a name that cannot be decoded is refused rather than guessed at', async () => {
  const res = await req('/api/project/%ZZ');
  assert.equal(res.status, 400);
  assert.ok(res.type.includes('application/json'));
});
