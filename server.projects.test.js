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
// ⚠️ HOME IS SANDBOXED TOO, and it is not a nicety. `/api/folders` is rooted at
// `os.homedir()`, which on POSIX reads `$HOME` — so without this the folder
// tests built their fixtures in the OPERATOR'S REAL HOME, including a symlink
// pointing at `/etc`. A crash between creating that and the `finally` would
// leave it sitting there. The plan's own rule is to sandbox every root the
// code writes to, and this route reads one the others do not.
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
// ⚠️ THE FOURTH ROOT, and it is new on this branch. Creating a project with no
// folder makes one under `~/Kosmos/Projects` — so without this the suite would
// leave real directories in the operator's home, named after test fixtures. The
// rule is every root the code writes to, and the code grew one.
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
// ⚠️ Belt AND braces, same as chat.test.js (round 24): the echo stub above
// is justified in-file for create.js and remove.js, so without this line
// the only thing keeping a test process from typing into live agents was a
// variable whose stated purpose is a different module. chat.js reads this
// from its first require.
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

// ⚠️ THAT VARIABLE DOES NOT STUB THE STATUS ENGINE, and a comment here used to
// claim it did. `engine/status.js` calls `sh('tmux', …)` directly and never
// reads `AGENT_WORKFORCE_TMUX_BIN` — only `create.js` and `remove.js` do. So
// the roster in these tests is whatever the HOST's real tmux answers, which
// makes results machine-dependent and means the header's claim about what this
// file exercises was a claim about a world that does not exist.
//
// That is the same shape as the defect this branch was just fixed for, in the
// comment written about it. The seam tests at the bottom of this file stub
// `setPaneSource` explicitly — the seam the engine actually reads — so both the
// real-board and the could-not-look paths are exercised on purpose rather than
// by accident of the host.

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const fleet = require('./test-support/fleet');

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
  fs.mkdirSync(path.join(HOME, 'work'), { recursive: true });
  fs.mkdirSync(path.join(HOME, '.hidden'), { recursive: true });
  const res = await req('/api/folders');
  assert.equal(res.status, 200);
  const body = json(res);
  assert.equal(body.path, fs.realpathSync(HOME));
  assert.equal(body.parent, null, 'there is no "up" from home, so there is no way out of it');
  assert.ok(body.folders.some((f) => f.name === 'work'), 'the control: a real folder IS offered');
  assert.ok(!body.folders.some((f) => f.name === '.hidden'), 'no dotfiles');
});

test('only real folders are offered, and a link to a FILE is not one', async () => {
  // ⚠️ Aimed at the failure rather than at the mechanism. An earlier version
  // asserted "everything offered is a directory" against a folder that
  // contained no link-to-a-file, so it could not fail, and a mutation that
  // dropped the directory check passed it.
  const root = path.join(HOME, 'browse-fixture');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'a-real-folder'));
  fs.writeFileSync(path.join(root, 'a-file.txt'), 'x');
  fs.symlinkSync(path.join(root, 'a-file.txt'), path.join(root, 'link-to-a-file'));
  fs.symlinkSync(path.join(root, 'a-real-folder'), path.join(root, 'link-to-a-folder'));

  const body = json(await req(`/api/folders?path=${encodeURIComponent(root)}`));
  assert.deepEqual(body.folders.map((f) => f.name).sort(), ['a-real-folder', 'link-to-a-folder'],
    'a link to a folder is an ordinary way to keep work; a link to a file is not a folder');
  assert.equal(body.truncated, false, 'and a short listing is not reported as cut');
});

test('a listing longer than the limit says it was cut', async () => {
  // A silent cut makes a folder that exists but sorts past the limit
  // indistinguishable from one that is not there.
  const root = path.join(HOME, 'many');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (let i = 0; i < 520; i += 1) fs.mkdirSync(path.join(root, `f${String(i).padStart(4, '0')}`));

  const body = json(await req(`/api/folders?path=${encodeURIComponent(root)}`));
  assert.equal(body.truncated, true);
  assert.equal(body.showing, 500);
  // ⚠️ NOT a number. We stopped after typing 500 entries, so the remaining 20
  // were never checked for being folders at all -- reporting "of 520" was a
  // count of things nobody had looked at, and in a directory holding
  // links-to-files it announced folders that do not exist.
  assert.equal(body.total, null, 'a total we did not count must not be reported as one');
});

test('a cut listing does not report a total it never counted', async () => {
  // The control for the assertion above: 500 real folders plus entries that are
  // NOT folders. `readdir` sees 520; only folders may be claimed.
  const root = path.join(HOME, 'many-mixed');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (let i = 0; i < 500; i += 1) fs.mkdirSync(path.join(root, `d${String(i).padStart(4, '0')}`));
  // ⚠️ SYMLINKS to files, not plain files. `readdir` types a plain file
  // immediately and it never enters the candidate list at all, so it could not
  // have inflated the count -- the entries that DO get in and are only rejected
  // by the per-entry `statSync` are the ones typed as symlinks. A control built
  // from plain files exercises nothing (measured: `truncated` came back false).
  const target = path.join(root, 'd0000', 'a-file.txt');
  fs.writeFileSync(target, 'x');
  for (let i = 0; i < 20; i += 1) fs.symlinkSync(target, path.join(root, `zz-link-${i}`));

  const body = json(await req(`/api/folders?path=${encodeURIComponent(root)}`));
  assert.equal(body.truncated, true, 'the control: this listing really was cut');
  assert.equal(body.showing, 500);
  assert.equal(body.total, null,
    'the route reported 520 folders for a directory holding 500 folders and 20 files');
});

test('home reached through a SYMLINK still browses, rather than refusing itself', async () => {
  // ⚠️ The regression this exists for: `home` was compared un-resolved against
  // a resolved path, so on a machine whose home is behind a symlink the route
  // 403'd its own home folder and the add-project flow was dead. The old test
  // compared against `realpathSync(homedir())`, so it could only ever pass.
  const realHome = fs.realpathSync(HOME);
  const res = await req('/api/folders');
  assert.equal(res.status, 200, res.body);
  assert.equal(json(res).path, realHome);
  assert.notEqual(json(res).folders.length, 0);
});

test('a folder inside home can be opened', async () => {
  const inside = path.join(HOME, 'work');
  fs.mkdirSync(inside, { recursive: true });
  const res = await req(`/api/folders?path=${encodeURIComponent(inside)}`);
  assert.equal(res.status, 200, 'the control: an allowed path really is allowed');
  assert.ok(json(res).parent, 'and below home there IS an up');
});

test('a folder named ..something inside home is not mistaken for a climb', async () => {
  const odd = path.join(HOME, '..archive');
  fs.mkdirSync(odd, { recursive: true });
  const res = await req(`/api/folders?path=${encodeURIComponent(odd)}`);
  assert.equal(res.status, 200, 'the climb is the segment "..", not the two characters');
});

test('climbing out of home with .. is refused', async () => {
  const res = await req(`/api/folders?path=${encodeURIComponent(path.join(HOME, '..', '..'))}`);
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
  // asserted on the resolved path rather than on the spelling asked for. This
  // link is inside home by every prefix test there is.
  const link = path.join(HOME, 'escape-hatch');
  fs.rmSync(link, { force: true });
  fs.symlinkSync('/etc', link);
  const res = await req(`/api/folders?path=${encodeURIComponent(link)}`);
  assert.equal(res.status, 403, res.body);
  assert.ok(!/"folders"/.test(res.body), 'and nothing outside home was listed');
});

test('a path with a null byte is refused rather than truncated', async () => {
  // ⚠️ A REAL null byte, written as an ESCAPE. An earlier version carried the
  // byte literally in the source, which made the whole test file register as
  // binary -- `grep` stopped matching it and `file` reported `data`.
  const res = await req(`/api/folders?path=${encodeURIComponent(HOME + '\0/etc')}`);
  assert.ok(res.status === 400 || res.status === 403, `answered ${res.status}`);
  assert.ok(!/"folders"/.test(res.body));
});

test('a path that does not exist is refused', async () => {
  const res = await req(`/api/folders?path=${encodeURIComponent(path.join(HOME, 'definitely-not-real-xyz'))}`);
  assert.equal(res.status, 400);
});

test('a file is refused as somewhere to browse', async () => {
  const f = path.join(HOME, 'a-plain-file');
  fs.writeFileSync(f, 'x');
  const res = await req(`/api/folders?path=${encodeURIComponent(f)}`);
  assert.equal(res.status, 400, res.body);
});

test('renaming a project that does not exist answers 404, like GET and DELETE', async () => {
  const res = await req('/api/project/no-such-project', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Whatever' }),
  });
  assert.equal(res.status, 404, res.body);
});

test('renaming a project keeps its id, and reaches its members', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Before', folder: folder('renaming'), agents: ['nobody-here'] })).project;
  const res = await req(`/api/project/${made.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'After' }),
  });
  assert.equal(res.status, 200, res.body);
  assert.equal(json(res).project.name, 'After');
  assert.equal(json(res).project.id, made.id, 'the id is what membership points at');
});

test('the description travels the routes: created, carried, updated alone, cleared', async () => {
  reset();
  const made = json(await post('/api/projects', {
    name: 'Q4 Marketing Plan', folder: folder('q4'),
    description: '  Build the campaign calendar and track deadlines.  ',
  })).project;
  assert.equal(made.description, 'Build the campaign calendar and track deadlines.');
  // GET carries it (the card and the detail read this list).
  const listed = json(await req('/api/projects')).projects.find((p) => p.id === made.id);
  assert.equal(listed.description, 'Build the campaign calendar and track deadlines.');
  // Description-only PUT: the name must not move, and the request must not
  // need to carry one (the old route ran rename unconditionally).
  const put1 = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ description: 'Second wording.' }),
  });
  assert.equal(put1.status, 200, put1.body);
  assert.equal(json(put1).project.description, 'Second wording.');
  assert.equal(json(put1).project.name, 'Q4 Marketing Plan', 'a description-only save must not touch the name');
  // Name-only PUT preserves the description it never mentioned.
  const put2 = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Q4 Plan' }),
  });
  assert.equal(put2.status, 200, put2.body);
  assert.equal(json(put2).project.description, 'Second wording.', 'a rename must not blank the description');
  // Explicit empty clears -- deliberate, per the engine's own rule.
  const put3 = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ description: '' }),
  });
  assert.equal(put3.status, 200, put3.body);
  assert.strictEqual(json(put3).project.description, '');
});

test('a rename re-tells members and a description-only save leaves their files alone', async () => {
  reset();
  // ⚠️ Both directions of the re-tell gate, neither previously held: delete
  // the gate and the second assertion reds; invert it and the third does.
  const board = fleet.install([fleet.agent('telltest', { state: 'working' })]);
  try {
  const wdir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'telltest');
  fs.mkdirSync(wdir, { recursive: true });
  const file = path.join(wdir, 'CLAUDE.md');
  fs.writeFileSync(file, '# telltest\n');
  const made = json(await post('/api/projects', { name: 'Before name', folder: folder('retell'), agents: ['telltest'] })).project;
  const afterCreate = fs.readFileSync(file, 'utf8');
  assert.match(afterCreate, /Before name/, 'the premise: creation reached the member boot file');

  // ⚠️ The gate is held by the TOLD STAMP, not by byte-comparing the file:
  // blockBody carries only name and folder, so a re-tell fired on a
  // description-only save splices back identical text and the byte
  // comparison measures idempotence, never the gate (round 4 deleted the
  // gate outright and the file comparison stayed green). syncAgent stamps
  // told[key].at on EVERY call, so the stamp moves iff the re-tell fired.
  const stampOf = () => projects.readAll().find((x) => x.id === made.id).told.telltest.at;
  const stampAfterCreate = stampOf();
  assert.ok(stampAfterCreate, 'the premise: creation stamped the told verdict');
  // The breath goes HERE, before the description-only PUT: the equality
  // below is the assertion that catches a deleted gate, and it needs the
  // clock's millisecond granularity cleared far more than the notEqual
  // does (round 5: the two stamps ran 1ms apart under load).
  await new Promise((r) => setTimeout(r, 5));

  const descOnly = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ description: 'display-side words' }),
  });
  assert.equal(descOnly.status, 200, descOnly.body);
  assert.equal(stampOf(), stampAfterCreate,
    'a description-only save re-told the member (the stamp moved)');
  assert.equal(fs.readFileSync(file, 'utf8'), afterCreate,
    'a description-only save rewrote a boot file the block does not mention');

  // The stamp has millisecond resolution; two writes inside one ms read
  // equal and flake the inequality below. A 5ms breath is not a sleep-based
  // assertion, it is the clock's own granularity.
  await new Promise((r) => setTimeout(r, 5));
  const renamed = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'After name' }),
  });
  assert.equal(renamed.status, 200, renamed.body);
  assert.notEqual(stampOf(), stampAfterCreate,
    'the rename did not re-tell the member (the stamp never moved)');
  const afterRename = fs.readFileSync(file, 'utf8');
  assert.match(afterRename, /After name/, 'the rename never reached the member');
  assert.ok(!/Before name/.test(afterRename), 'the boot file still names a project that no longer goes by that');
  } finally {
    board.restore();
  }
});

test('a save that would move nothing is refused, not answered "saved"', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Immovable', folder: folder('immovable'), description: 'stays' })).project;
  // {} and a typo'd key both carry no field we recognise -- reporting 200
  // for either is a save the person believes happened.
  for (const body of [{}, { descrption: 'typo' }]) {
    const res = await req(`/api/project/${made.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} should be refused: ${res.body}`);
  }
  const list = json(await req('/api/projects')).projects;
  assert.equal(list[0].description, 'stays');
  assert.equal(list[0].name, 'Immovable');
});

test('a name has to be words at the ROUTE boundary too, on both routes', async () => {
  reset();
  const posted = await post('/api/projects', { name: { a: 1 }, folder: folder('typed-name') });
  assert.equal(posted.status, 400, posted.body);
  const made = json(await post('/api/projects', { name: 'Typed name', folder: folder('typed-name') })).project;
  const put = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: ['x'] }),
  });
  assert.equal(put.status, 400, put.body);
  assert.equal(json(await req('/api/projects')).projects[0].name, 'Typed name');
});

test('one rule for what a description IS, on both routes: words or refused', async () => {
  reset();
  // POST: String() used to store "[object Object]" while PUT silently
  // dropped the same value -- one field, two rules, split across routes.
  const posted = await post('/api/projects', { name: 'Typed', folder: folder('typed-desc'), description: { not: 'words' } });
  assert.equal(posted.status, 400, posted.body);
  const made = json(await post('/api/projects', { name: 'Typed', folder: folder('typed-desc'), description: 'real words' })).project;
  for (const bad of [{ not: 'words' }, ['a', 'b'], 7, true]) {
    const res = await req(`/api/project/${made.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ description: bad }),
    });
    assert.equal(res.status, 400, `description ${JSON.stringify(bad)} should be refused: ${res.body}`);
  }
  const after = json(await req('/api/projects')).projects[0];
  assert.equal(after.description, 'real words', 'a refused write changes nothing');
  // Over-length is refused at the route with the sentence, not cut.
  const long = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ description: 'x'.repeat(201) }),
  });
  assert.equal(long.status, 400, long.body);
  assert.match(json(long).error, /longer than 200/);
  // And null clears, as absence: the one field where null meant malformed.
  const nulled = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ description: null }),
  });
  assert.equal(nulled.status, 200, nulled.body);
  assert.strictEqual(json(nulled).project.description, '');
});

test('a failed half of a two-field save applies NOTHING, not the readable half', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Whole', folder: folder('whole-put'), description: 'original' })).project;
  // The name is valid, the description is refused: the rename must not have
  // happened when the route answers failure -- a 400 about a save that half
  // landed tells the caller a lie in the other direction.
  const res = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Renamed anyway', description: 42 }),
  });
  assert.equal(res.status, 400, res.body);
  const after = json(await req('/api/projects')).projects[0];
  assert.equal(after.name, 'Whole', 'the valid half of a refused save must not land');
  assert.equal(after.description, 'original');
});

test('an archive-only PUT archives without renaming, and restore brings it back', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Season', folder: folder('archiving') })).project;

  const on = await req(`/api/project/${made.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ archived: true }),
  });
  assert.equal(on.status, 200, on.body);
  assert.equal(json(on).project.archived, true);
  assert.ok(json(on).project.archivedAt);
  assert.equal(json(on).project.name, 'Season', 'a PUT with no name does not touch the name');

  const off = await req(`/api/project/${made.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ archived: false }),
  });
  assert.equal(off.status, 200, off.body);
  assert.equal(json(off).project.archived, false);
  assert.equal(json(off).project.archivedAt, null);
});

test('a rename-only PUT does not touch archived', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Kept', folder: folder('kept-archived') })).project;
  await req(`/api/project/${made.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ archived: true }),
  });
  const res = await req(`/api/project/${made.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Kept still' }),
  });
  assert.equal(res.status, 200, res.body);
  assert.equal(json(res).project.name, 'Kept still');
  assert.equal(json(res).project.archived, true, 'an absent field means leave it alone, never clear it');
});

test('a save that would move nothing is refused, not answered "saved"', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Immovable', folder: folder('immovable') })).project;
  // {} and a capitalised typo both carry no field we recognise -- 200 for
  // either is a save the person believes happened. On main the same {} was
  // already refused (rename ran unconditionally); conditional fields must
  // not turn that refusal into a silent success.
  for (const body of [{}, { Archived: true }]) {
    const res = await req(`/api/project/${made.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} should be refused: ${res.body}`);
  }
  // A carried name of the wrong type is refused loudly, not skipped.
  const bad = await req(`/api/project/${made.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 42 }),
  });
  assert.equal(bad.status, 400, bad.body);
  const list = json(await req('/api/projects')).projects;
  assert.equal(list[0].name, 'Immovable', 'a refused write changes nothing');
  assert.equal(list[0].archived, false);
});

test('archived refuses anything but a boolean, because "false" the string is not false', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Strict', folder: folder('strict-put') })).project;
  const res = await req(`/api/project/${made.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ archived: 'false' }),
  });
  assert.equal(res.status, 400, res.body);
  const list = json(await req('/api/projects')).projects;
  assert.equal(list[0].archived, false, 'a refused write changes nothing');
});

test('a name that cannot be decoded is refused rather than guessed at', async () => {
  const res = await req('/api/project/%ZZ');
  assert.equal(res.status, 400);
  assert.ok(res.type.includes('application/json'));
});

// ---------------------------------------------------------------------------
// A store we cannot read. Every route has to survive it, and none may pretend.
// ---------------------------------------------------------------------------

async function withCorruptStore(fn) {
  const f = projects.file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const had = fs.existsSync(f) ? fs.readFileSync(f) : null;
  fs.writeFileSync(f, '{corrupt');
  try { await fn(); } finally {
    if (had === null) { try { fs.rmSync(f); } catch { /* nothing to restore */ } }
    else fs.writeFileSync(f, had);
  }
}

test('a corrupt store does not kill the board, on any projects route', async () => {
  // ⚠️ MEASURED before the fix: the list route answered its honest 500 and the
  // very next request for ONE project took the whole process down (exit 9).
  // The app that watches the fleet dying on a plain read is worse than every
  // state the guards around it protect.
  await withCorruptStore(async () => {
    // ⚠️ The THREAD routes are in this list. Its first version enumerated
    // five routes under a name promising "any projects route", and the two
    // thread routes plus the folder preview were not among them -- round 14
    // replaced the thread GET's unreadable-500 with a 200 carrying an empty
    // conversation and the suite stayed green. An enumerating test's name is
    // a promise about the enumeration.
    const routes = [
      ['/api/projects', undefined],
      ['/api/project/anything', undefined],
      ['/api/project/anything/agent/mara', { method: 'POST', headers: { origin: base } }],
      ['/api/project/anything/agent/mara', { method: 'DELETE', headers: { origin: base } }],
      ['/api/project/anything', { method: 'DELETE', headers: { origin: base } }],
      ['/api/project/anything/thread/mara', undefined],
      ['/api/project/anything/thread/mara', {
        method: 'POST', headers: { origin: base, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      }],
    ];
    for (const [p, opts] of routes) {
      const res = await req(p, opts);
      // Exactly 500 (round 37): server.js argues at length that a store WE
      // cannot read must not answer 400, because 400 puts "we will not
      // overwrite your projects file" in front of somebody as if it were a
      // complaint about what they had typed. `>= 400` could not hold that
      // line -- inverting the status pick left it green.
      assert.equal(res.status, 500, `${p} answered ${res.status}, and an unreadable store is OUR fault, not the request's`);
      assert.ok(res.type.includes('application/json'), `${p} must still answer as JSON`);
      assert.ok(!/"projects":\s*\[\]/.test(res.body), `${p} must not report an empty list for a store it cannot read`);
    }
    // ⚠️ The control that matters: the server is STILL SERVING afterwards --
    // a corrupt projects file once killed the board process outright (exit 9)
    // through the one read that did not catch.
    //
    // ⚠️ This assertion could not fail. It read
    // `status < 500 || type.includes('application/json')`, and /api/status sets
    // that content-type on BOTH its 200 path and its 500 catch — so the right
    // disjunct is true for every response the route can produce, and the only
    // thing being tested was that `fetch` did not reject. It passed with the
    // route arbitrarily broken. Asked as what a dead or damaged board would
    // actually fail: a 200 carrying a real board.
    const alive = await req('/api/status');
    assert.equal(alive.status, 200, 'the board stopped answering after a corrupt projects file');
    assert.ok(alive.type.includes('application/json'));
    assert.ok(Array.isArray(JSON.parse(alive.body).agents),
      'the board answered, but not with a board');
  });
});

test('an unreadable store answers 500, never an empty list', async () => {
  await withCorruptStore(async () => {
    const res = await req('/api/projects');
    assert.equal(res.status, 500);
    assert.equal(json(res).projectsUnreadable, true);
    assert.ok(!('projects' in json(res)), '"you have none" is not something we know');
  });
});

test('taking an agent off returns the verdict for the instruction write too', async () => {
  reset();
  const made = json(await post('/api/projects', { name: 'Verdicts', folder: folder('verdicts'), agents: ['nobody-here'] })).project;
  const res = await req(`/api/project/${made.id}/agent/nobody-here`, {
    method: 'DELETE', headers: { origin: base },
  });
  assert.equal(res.status, 200);
  // ⚠️ Removing an agent also takes the block back OUT of its instruction file,
  // and that write can fail for every reason the add can. The page used to
  // check only `res.ok` and repaint as success, leaving a block naming a
  // project the agent is no longer on, silently. The route has to hand the
  // verdict over or the page cannot say so.
  assert.ok(json(res).told, 'the route reports what happened to the instruction file');
  assert.equal(json(res).told.state, projects.TOLD.COULD_NOT);
  assert.ok(json(res).told.because);
});

test('removing a project reports which members it could not re-tell', async () => {
  reset();
  const made = json(await post('/api/projects', {
    name: 'Leaving', folder: folder('leaving-route'), agents: ['nobody-here', 'nor-here'],
  })).project;

  const res = await req(`/api/project/${made.id}`, { method: 'DELETE', headers: { origin: base } });
  assert.equal(res.status, 200);
  const told = json(res).told;
  assert.equal(told.length, 2, 'one verdict per member, not a single summary');
  assert.ok(told.every((t) => t.state === projects.TOLD.COULD_NOT && t.because));
  assert.deepEqual(told.map((t) => t.agent).sort(), ['nobody-here', 'nor-here']);
});

test('creating a project reports the instruction-write verdicts as well', async () => {
  reset();
  const res = await post('/api/projects', {
    name: 'Made', folder: folder('made-route'), agents: ['nobody-here'],
  });
  assert.equal(res.status, 200);
  assert.equal(json(res).told[0].state, projects.TOLD.COULD_NOT);
  assert.equal(json(res).told[0].agent, 'nobody-here');
});

test('with a real board, a member row carries the display name and state', async () => {
  reset();
  // ⚠️ The other half of the seam. `/bin/echo` stands in for tmux everywhere
  // else in this file, which makes the roster permanently null -- so the routes
  // could describe members against a shape that has no display name at all and
  // every test here still passed. This one supplies a real pane listing.
  const board = fleet.install([fleet.agent('zeta', { state: 'working' })]);
  try {
    const made = json(await post('/api/projects', {
      name: 'Seam', folder: folder('seam-route'), agents: ['zeta'],
    })).project;

    const member = made.agents[0];
    assert.equal(member.present, true, 'a real card resolves through the route');
    assert.ok(member.name, 'the row has a display name to speak');
    // ⚠️ Against the CARD the fixture really produced, not against a string
    // typed here. `ok(member.state)` alone passes for any non-empty state, so
    // it would have gone on passing had the route started reporting every
    // member as `unknown` — which is the shape of the defect this test was
    // added for, one step milder.
    assert.equal(member.state, board.card('zeta').state);
    assert.equal(member.state, 'working');

    const list = json(await req('/api/projects'));
    assert.equal(list.agentsUnreadable, false, 'and the list says the look succeeded');
  } finally {
    board.restore();
  }
});

test('a roster we could not read is reported, never rendered as an empty fleet', async () => {
  reset();
  // ⚠️ The other half of the seam, and the path the header used to claim was
  // saturated when in fact nothing exercised it. `setPaneSource` returning null
  // is "tmux could not be asked", which must reach the page as "we could not
  // see them" and never as "you have none of them".
  let blind = null;
  try {
    const made = json(await post('/api/projects', {
      name: 'Blind', folder: folder('blind-route'), agents: ['zeta'],
    })).project;

    blind = fleet.blind();
    const res = await req('/api/projects');
    assert.equal(res.status, 200, 'the record is still readable');
    const body = json(res);
    assert.equal(body.agentsUnreadable, true, 'and the response says the look failed');
    const member = body.projects.find((p) => p.id === made.id).agents[0];
    assert.equal(member.present, false);
    assert.match(member.because, /cannot see this agent|never seen/);
  } finally {
    if (blind) blind.restore();
  }
});

test('an agent the person removed does not appear on a project row', async () => {
  reset();
  // ⚠️ Two derivations of "the fleet" is this codebase's worst habit, and the
  // projects roster was one: the board filters removed agents out and called
  // that "the whole user-visible half of a removal", while a project row still
  // showed the same agent as present with a live state -- and the write gate
  // still permitted splicing the block into its boot file. Kosmos would have
  // edited the instructions of an agent it had told the person was gone.
  const removal = require('./engine/remove');
  const board = fleet.install([fleet.agent('zeta', { state: 'working' })]);
  try {
    const made = json(await post('/api/projects', {
      name: 'Removed', folder: folder('removed-route'), agents: ['zeta'],
    })).project;
    // The control: while it is on the board, it reads as present.
    assert.equal(made.agents[0].present, true, 'the control: present before the removal');

    // Written through the store the removal engine reads, since `recordRemoval`
    // is deliberately not exported (removing is a route, not a library call).
    const removedFile = path.join(require('./engine/store').ROOT, 'removed.json');
    fs.mkdirSync(path.dirname(removedFile), { recursive: true });
    fs.writeFileSync(removedFile, JSON.stringify([{ name: 'zeta', shownAs: 'zeta', stopped: true }]));
    assert.ok(removal.removedAgents().some((r) => r.name === 'zeta'), 'the control: the engine sees the removal');

    const after = json(await req('/api/projects')).projects.find((p) => p.id === made.id);
    assert.equal(after.agents[0].present, false, 'a removed agent is not present on a project row either');
  } finally {
    try { fs.rmSync(path.join(require('./engine/store').ROOT, 'removed.json')); } catch { /* never written */ }
    board.restore();
  }
});

// ---------------------------------------------------------------------------
// Talking to ONE agent on ONE project
//
// ⚠️ EVERY TEST BELOW ARMS THE tmux SEAM EXPLICITLY, and that is not optional
// here the way it is elsewhere in this file. `AGENT_WORKFORCE_TMUX_BIN` is
// `/bin/echo` for these tests, and `/bin/echo` EXITS ZERO — so an unarmed send
// would report `placed` for a keystroke that reached nothing, which is the one
// verdict this whole feature exists not to invent. The seam is installed per
// test and torn down in a `finally`, because a leaked runner would let a later
// test in this process type into whatever tmux is really on the machine.
// ---------------------------------------------------------------------------

const chat = require('./engine/chat');

/**
 * Arm the chat seam with a scripted tmux, and hand back what was called.
 *
 * ⚠️ THE JUST-BEFORE-SENDING PROBE IS ANSWERED SEPARATELY, and healthy by
 * default. `deliver` asks the pane about itself immediately before typing (see
 * `verifyAtSend` in engine/chat.js), so without this the first scripted answer
 * would be eaten by a read-only check and every send test would be measuring a
 * refusal instead of the send it was written for. Tests that care about the
 * probe pass one.
 */
function armChat(answers, probe) {
  const calls = [];
  const answerProbe = probe === undefined
    ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
    : probe;
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return answerProbe;
    return answers.length ? answers.shift() : { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  // The sends only, so an assertion about what was typed is not confused by the
  // read-only probe in front of it.
  calls.sends = () => calls.filter((args) => args[0] === 'send-keys');
  return calls;
}
const said = (out) => ({ ran: true, spawnFailed: false, status: 0, out: out || '', err: '' });

/**
 * A project with one agent on it, and the seam armed. Always torn down.
 *
 * ⚠️ THE THREAD STORE IS CLEARED TOO, and finding out why was worth the
 * paragraph. `reset()` removes `projects.json` only, and a project id is
 * derived from its NAME — so every test here rebuilt the SAME id and inherited
 * the previous test's messages. Three tests read another test's history and two
 * of them asserted the wrong verdict off it. A fixture that carries state
 * between tests is measuring a world the next test did not arrange.
 */
async function withThread(spec, answers, fn) {
  try { fs.rmSync(path.join(require('./engine/store').ROOT, 'chats'), { recursive: true, force: true }); }
  catch { /* nothing kept yet */ }
  const board = fleet.install([spec]);
  const calls = armChat(answers);
  try {
    const made = json(await post('/api/projects', {
      name: 'Thread ' + spec.name, folder: folder('thread-' + spec.name), agents: [spec.name],
    })).project;
    return await fn({ board, calls, project: made });
  } finally {
    chat.resetForTests();
    board.restore();
  }
}

test('the thread shows what the agent’s screen shows, labelled as the screen and not as speech', async () => {
  reset();
  await withThread(fleet.agent('zeta', { state: 'working' }), [said('Reading the lease\n· Working\n')],
    async ({ project, calls }) => {
      const res = await req(`/api/project/${project.id}/thread/zeta`);
      assert.equal(res.status, 200);
      const body = json(res);
      assert.equal(body.agent.sessionName, 'zeta');
      assert.equal(body.viewport.text, 'Reading the lease\n· Working');
      assert.equal(body.viewport.because, null);
      assert.deepEqual(body.messages, [], 'nothing has been said to it yet');
      assert.equal(body.asking, false);
      assert.equal(body.question, null);
      // The capture is a capture, pinned to the exact pane.
      assert.equal(calls[0][0], 'capture-pane');
      assert.ok(calls[0].includes('-J'));
      assert.ok(calls[0].some((a) => typeof a === 'string' && a.startsWith('=zeta-discord:')));
    });
});

test('an agent the board calls "Needs you" hands the thread the question region', async () => {
  reset();
  // The stranded state: from the card that says "Needs you", the thread has to
  // be able to show WHAT it is asking. Same screen, same markers.
  await withThread(fleet.agent('zeta', { state: 'needs_you' }),
    [said('I want to delete the old build folder.\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n')],
    async ({ project }) => {
      const body = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(body.agent.state, 'needs_you');
      assert.equal(body.asking, true);
      assert.ok(body.question, 'the thread must not be empty under a card that says it is asking');
      assert.match(body.question.text, /Do you want to proceed\?/);
      assert.match(body.question.text, /delete the old build folder/);
      assert.equal(body.questionBecause, null);
    });
});

test('a card that says "Needs you" over a screen we cannot read SAYS so, rather than showing nothing', async () => {
  reset();
  // The two reads are milliseconds apart and the pane redraws between them. A
  // silent empty question box under a "Needs you" card is the stranded state
  // rebuilt one step further in.
  await withThread(fleet.agent('zeta', { state: 'needs_you' }),
    [{ ran: true, status: 1, out: '', err: 'no server running' }],
    async ({ project }) => {
      const body = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(body.asking, true);
      assert.equal(body.question, null);
      // ⚠️ The COULD-NOT-READ sentence, not the not-in-the-capture one. One
      // string used to serve both facts, so a failed capture rendered as a
      // claim about what IS on a screen nobody read (round 14). The two
      // sentences are asserted apart here and in the test below.
      assert.match(body.questionBecause, /could not read its screen just now/);
      assert.doesNotMatch(body.questionBecause, /cannot find the question on its screen/);
      assert.equal(body.viewport.text, null);
      assert.match(body.viewport.because, /could not read its window/);
    });
});

test('a "Needs you" card over a READABLE screen missing the markers says that, not could-not-read', async () => {
  reset();
  // The other half of the split: the capture SUCCEEDED and the question
  // markers are not in it (the pane redrew between the two reads).
  await withThread(fleet.agent('zeta', { state: 'needs_you' }),
    [said('an ordinary screen with no prompt on it')],
    async ({ project }) => {
      const body = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(body.asking, true);
      assert.equal(body.question, null);
      assert.match(body.questionBecause, /cannot find the question on its screen/);
      assert.doesNotMatch(body.questionBecause, /could not read its screen/);
      assert.ok(body.viewport.text != null, 'control: the screen really was read');
    });
});

test('a POST to a project that is not there is the 404 sentence, not a raw throw', async () => {
  reset();
  // Round 14: deleting this guard left the suite green -- the GET sibling was
  // covered "on both verbs" in name only. Without it the caller gets a 400
  // carrying a raw TypeError string.
  const res = await post('/api/project/never-existed/thread/zeta', { text: 'hello' });
  assert.equal(res.status, 404);
  assert.match(json(res).error, /no project by that name/);
  assert.ok(!/TypeError|undefined/.test(json(res).error), 'our sentence, never a raw throw');
});

test('a blind roster reaches BOTH thread routes as agentsUnreadable, never as an empty fleet', async () => {
  reset();
  // Round 14: hardcoding agentsUnreadable:false on both thread routes left
  // the suite green -- fleet.blind() was only ever pointed at /api/projects.
  let blind = null;
  await withThread(fleet.agent('zeta', { state: 'idle' }), [said(), said(), said('screen')],
    async ({ project }) => {
      try {
        blind = fleet.blind();
        const got = json(await req(`/api/project/${project.id}/thread/zeta`));
        assert.equal(got.agentsUnreadable, true, 'the GET must say the look failed');
        const sent = json(await post(`/api/project/${project.id}/thread/zeta`, { text: 'while blind' }));
        assert.equal(sent.agentsUnreadable, true, 'the POST must say the look failed');
      } finally {
        if (blind) blind.restore();
      }
    });
});

test('sending places the text into the agent’s own session, and says only that', async () => {
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [said(), said()],
    async ({ project, calls }) => {
      const res = await post(`/api/project/${project.id}/thread/zeta`, { text: 'have a look at the lease' });
      assert.equal(res.status, 200);
      const body = json(res);
      // ⚠️ Membership FIRST, then the exact state (round 24): asserted the
      // other way round, the membership check sat below a line that had
      // already pinned 'placed', so it could only fail if the line above
      // already had -- unfalsifiable, inside the docblock diagnosing
      // exactly that shape.
      assert.ok(Object.values(chat.DELIVERY).includes(body.delivery.state),
        `the route answered a verdict the engine does not define: ${body.delivery.state}`);
      assert.equal(body.delivery.state, 'placed');
      assert.equal(body.recorded, true);
      // The POST answers a VERDICT, not the record (round 38): it used to
      // carry the whole thread (up to 1000 rows, ~2MB) in a `messages`
      // field nothing read, on the sibling of the GET that round 36 had
      // just bounded with TAIL. The page refreshes through the GET.
      assert.ok(!('messages' in body),
        'the POST response carries the thread again, an unread unbounded payload');
      /**
       * ⚠️ THE VOCABULARY IS ASSERTED, because the whole discipline of this
       * feature is what the answer is allowed to CLAIM: anything meaning
       * "received", "read" or "delivered to the agent" would be a claim about a
       * program's understanding that a keystroke cannot support.
       *
       * ⚠️ AGAINST THE ENGINE'S OWN SET, and the previous version of this line
       * was wrong twice over. It hard-coded `['placed', 'could_not']` under a
       * comment calling them "the only two verdicts" — which had stopped being
       * true when `unconfirmed` landed, so the enumeration was stale — and it
       * sat three lines below an assertion that the state equals `placed`, so
       * it could not have failed whatever the set said. An unfalsifiable check
       * guarding a stale fact is worse than no check: it reads as coverage.
       */
      const sends = calls.sends();
      assert.equal(sends[0][0], 'send-keys');
      assert.equal(sends[0][sends[0].length - 1], 'have a look at the lease');
      assert.deepEqual(sends[1].slice(-1), ['Enter']);
      // And the pane was asked about itself first, read-only, before any keystroke.
      assert.equal(calls[0][0], 'display-message');
    });
});

test('reusing a project name moves the earlier conversation aside, and the ROUTE says so', async () => {
  reset();
  // ⚠️ The engine's supersededBecause was pinned (engine/chat.test.js) and
  // the route forwarding it was pinned by nothing: nulling the field in
  // server.js left 718 tests green (round 24) while the page lost the one
  // sentence accounting for a file renamed on somebody's disk. This drives
  // the whole story over routes: same name, freed id, second conversation.
  const spec = fleet.agent('zeta', { state: 'idle' });
  try { fs.rmSync(path.join(require('./engine/store').ROOT, 'chats'), { recursive: true, force: true }); }
  catch { /* nothing kept yet */ }
  const board = fleet.install([spec]);
  armChat([said(), said()]);
  try {
    const first = json(await post('/api/projects', {
      name: 'Twice told', folder: folder('twice-told'), agents: ['zeta'] })).project;
    const one = json(await post(`/api/project/${first.id}/thread/zeta`, { text: 'to the first' }));
    assert.equal(one.recorded, true);
    assert.equal(one.supersededBecause, null, 'nothing to move aside on a fresh conversation');
    await req(`/api/project/${first.id}`, { method: 'DELETE', headers: { origin: base } });
    armChat([said(), said()]);
    const second = json(await post('/api/projects', {
      name: 'Twice told', folder: folder('twice-told'), agents: ['zeta'] })).project;
    // The control that makes this the supersede case at all: the reused
    // name takes the freed id, so the second conversation lands on the
    // first one's file.
    assert.equal(second.id, first.id, 'the reused name must take the freed id for this test to test anything');
    const two = json(await post(`/api/project/${second.id}/thread/zeta`, { text: 'to the second' }));
    assert.equal(two.recorded, true);
    assert.match(String(two.supersededBecause), /kept aside/,
      'the route must carry the moved-aside sentence to the page');
  } finally {
    chat.resetForTests();
    board.restore();
  }
});

test('what was sent is kept, with the verdict on sending it, and read back on the next look', async () => {
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [said(), said(), said('screen')],
    async ({ project }) => {
      await post(`/api/project/${project.id}/thread/zeta`, { text: 'first thing' });
      const body = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].text, 'first thing');
      assert.equal(body.messages[0].delivery.state, 'placed');
      assert.ok(body.messages[0].at);
    });
});

test('a send that could NOT be delivered is recorded too, so the thread does not rewrite its own history', async () => {
  reset();
  // A pane we cannot tie to the name: refused before tmux is touched, and the
  // attempt is still the person's to see later.
  await withThread(fleet.stranger('zeta', { state: 'working' }), [],
    async ({ project, calls }) => {
      const body = json(await post(`/api/project/${project.id}/thread/zeta`, { text: 'are you there' }));
      assert.equal(body.delivery.state, 'could_not');
      assert.match(body.delivery.because, /cannot tell that it is this agent/);
      assert.equal(body.recorded, true);
      assert.equal(calls.sends().length, 0, 'nothing was typed anywhere');
      const back = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(back.messages[0].delivery.state, 'could_not');
    });
});

test('an empty message is refused before anything is looked up', async () => {
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [], async ({ project, calls }) => {
    const res = await post(`/api/project/${project.id}/thread/zeta`, { text: '   ' });
    assert.equal(res.status, 400);
    assert.match(json(res).error, /write something to send/);
    assert.equal(calls.sends().length, 0);
  });
});

test('a thread for an agent that is not on the project is a 404, on both verbs', async () => {
  reset();
  // ⚠️ A ROUTING RULE, NOT A PERMISSION. Nothing here confines an agent to a
  // project. What it refuses is turning this route into a general "type into
  // any agent on this machine" endpoint that merely takes a project id.
  await withThread(fleet.agent('zeta', { state: 'idle' }), [], async ({ project, calls }) => {
    const got = await req(`/api/project/${project.id}/thread/nobody-here`);
    assert.equal(got.status, 404);
    assert.match(json(got).error, /not on this project/);
    const sent = await post(`/api/project/${project.id}/thread/nobody-here`, { text: 'hello' });
    assert.equal(sent.status, 404);
    assert.equal(calls.sends().length, 0, 'a refused route types nothing');
  });
});

test('a thread on a project that does not exist is a 404, not a blank screen', async () => {
  reset();
  const got = await req('/api/project/no-such-project/thread/zeta');
  assert.equal(got.status, 404);
  assert.match(json(got).error, /no project by that name/);
});

test('sending is a WRITE, so another website cannot fire it', async () => {
  /**
   * ⚠️ THE STRONGEST WRITE ON THIS SERVER, asserted rather than inherited. Every
   * other route here got its cross-site guard by being a POST and was tested
   * for it; this one arrived later and would have inherited the guard silently
   * — the new-sibling-does-not-inherit shape this repo has shipped before
   * (the removal routes joined neither the borrowed-name gate nor its "every
   * write route" test).
   *
   * ⚠️ AND THE STATUS IS ASSERTED, not merely "not 200". A 404 would also
   * satisfy `notEqual(200)` while meaning the guard never ran at all — the
   * refusal has to be the cross-site one, on a route and a project that exist.
   */
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [], async ({ project, calls }) => {
    // The control: the same request from this origin is accepted, so the
    // refusal below is the guard and not a broken route.
    const fine = await post(`/api/project/${project.id}/thread/zeta`, { text: 'from the page itself' });
    assert.equal(fine.status, 200, 'the control: this route works from its own page');

    const res = await req(`/api/project/${project.id}/thread/zeta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ text: 'do something regrettable' }),
    });
    assert.equal(res.status, 403, `a cross-site POST was answered ${res.status}, not refused`);
    assert.equal(calls.sends().length, 2,
      'a cross-site request reached an agent’s keyboard (the control send is the only one expected)');
  });
});

test('a conversation we cannot read is reported as unreadable, never as nothing said', async () => {
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [said(), said(), said('screen')],
    async ({ project }) => {
      await post(`/api/project/${project.id}/thread/zeta`, { text: 'something worth keeping' });
      // The control: it reads back before the file is damaged.
      assert.equal(json(await req(`/api/project/${project.id}/thread/zeta`)).messages.length, 1);

      const file = chat.threadFile(project.id, 'zeta');
      fs.writeFileSync(file, '{ not json');
      const body = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(body.messages, null, 'null is "we could not read them"; [] would be a claim');
      assert.match(body.historyBecause, /cannot make sense of it/);
      // ⚠️ The OTHER TWO channels are asserted off, here and in each
      // sibling: the three history sentences were built to be mutually
      // exclusive, and nothing held that -- round 14 set all three true in
      // one arm and the suite stayed green, which is the all-three-sentences
      // -on-one-screen collapse this branch was built around.
      assert.equal(body.historyOther, false);
      assert.equal(body.historyUnfilable, false);
      // And the rest of the screen still renders: the agent's side is a
      // different object with a different owner, and it failed nothing.
      assert.equal(body.agent.sessionName, 'zeta');
    });
});

// ---------------------------------------------------------------------------
// Creating a project without a folder picker
// ---------------------------------------------------------------------------

test('a project created with no folder gets one made for it, and says where', async () => {
  reset();
  const res = await post('/api/projects', { name: 'No picker' });
  assert.equal(res.status, 200);
  const made = json(res).project;
  assert.equal(made.folder, path.join(projects.projectsRoot(), 'No picker'));
  assert.equal(made.folderState.state, projects.FOLDER.READABLE, 'and it is really there');
});

test('the route says where a project WOULD go, and makes nothing while it answers', async () => {
  // ⚠️ ONE derivation. The add screen shows this path before creating, and a
  // copy of the rule in the page would drift from the directory on disk the
  // first time the rule changed.
  const res = await req('/api/project-folder?name=' + encodeURIComponent('Q3/Q4 planning'));
  assert.equal(res.status, 200);
  const body = json(res);
  assert.equal(body.problem, null);
  // "Asking must not create" is asserted BEFORE the act-agreement check
  // below, because that check performs the act. The order is the test.
  assert.ok(body.path && !fs.existsSync(body.path), 'asking must not create');
  // Agreement with the act, not a restated spelling (round 37, same shape as
  // the case-correction test below): `path.join(root, 'Q3-Q4 planning')`
  // re-derived the `/ -> -` fold in the test, so the pair could drift from
  // the directory the button actually makes and both would stay green.
  assert.equal(body.path, projects.makeFolder('Q3/Q4 planning'),
    'the route previewed one path and the act produced another');
});

test('a name we cannot make a folder out of comes back as a SENTENCE at 200, not an error', async () => {
  // It goes under a field somebody is still typing in. A 500 there would make
  // the screen catch and render an error state over a half-typed name.
  const res = await req('/api/project-folder?name=' + encodeURIComponent('..'));
  assert.equal(res.status, 200);
  assert.equal(json(res).path, null);
  assert.match(json(res).problem, /already has a meaning/);
});

test('a path-hostile name is refused by the create route too, with a sentence', async () => {
  reset();
  const res = await post('/api/projects', { name: '..' });
  assert.equal(res.status, 400);
  assert.match(json(res).error, /already has a meaning/);
  assert.ok(!/Error:|at Object\./.test(json(res).error), 'our sentence, never a raw throw');
});

test('the folder route answers as JSON with a query string, like every sibling', async () => {
  const res = await req('/api/project-folder?name=Lease&t=1');
  assert.ok(res.type.includes('application/json'), res.type);
});

test('a send we could not confirm is NOT reported as a failure, or the person sends it twice', async () => {
  reset();
  /**
   * ⚠️ THE WHOLE POINT OF THE THIRD STATE, at the route. The text reached the
   * composer and the Enter did not go through — so "could not deliver" is both
   * untrue and dangerous: the obvious next thing a person does is send it
   * again, and on a permission prompt the second copy answers a question the
   * first one already answered.
   */
  await withThread(fleet.agent('zeta', { state: 'idle' }),
    [said(), { ran: true, spawnFailed: false, status: 1, out: '', err: 'no current session' }],
    async ({ project }) => {
      const body = json(await post(`/api/project/${project.id}/thread/zeta`, { text: 'answer this' }));
      assert.equal(body.delivery.state, 'unconfirmed');
      assert.notEqual(body.delivery.state, 'could_not');
      assert.match(body.delivery.because, /may be sitting in its composer unsent/);
      // ⚠️ The route carries the FACT. Where to look is the page's sentence,
      // asserted on the rendered page by docs/browser-checks/render-thread.js —
      // an engine that also gave instructions produced three of them, stacked,
      // pointing somewhere different each time.
      assert.ok(!/screen is below|conversation above/i.test(body.delivery.because));
      // And it is kept that way, so a later read does not turn it back into a
      // failure the person would act on.
      const back = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(back.messages[0].delivery.state, 'unconfirmed');
    });
});

test('a send that never reached tmux IS a failure, because re-sending is the right thing to do', async () => {
  reset();
  // The other side of the line: nothing was typed, so the person should send
  // again — and the verdict is the one that tells them so.
  await withThread(fleet.agent('zeta', { state: 'idle' }),
    [{ ran: false, spawnFailed: true, status: null, out: '', err: 'ENOENT' }],
    async ({ project }) => {
      const body = json(await post(`/api/project/${project.id}/thread/zeta`, { text: 'hello' }));
      assert.equal(body.delivery.state, 'could_not');
    });
});

test('the verdict says what the agent was doing, and keeps saying it on every later read', async () => {
  reset();
  // ⚠️ "Placed into zeta's session" is exactly true and invites the wrong
  // inference — that zeta is reading it. A Claude that is mid-task does not
  // consume its composer until it finishes.
  await withThread(fleet.agent('zeta', { state: 'working' }), [said(), said(), said('screen')],
    async ({ project, board }) => {
      const body = json(await post(`/api/project/${project.id}/thread/zeta`, { text: 'have a look at the lease' }));
      assert.equal(body.delivery.state, 'placed');
      // Against the card the fixture really produced, so the thread and the
      // agent's own card cannot disagree about what it was doing.
      assert.equal(body.delivery.paneState, board.card('zeta').state);
      assert.match(body.delivery.paneNote, /mid-task/);

      const back = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.match(back.messages[0].delivery.paneNote, /mid-task/,
        '"why did nothing happen?" is asked an hour later, so the note has to survive the read');
    });
});

test('a project reusing an earlier name says its OWN conversation is empty, not that we cannot read it', async () => {
  /**
   * ⚠️ THREE FALSE SENTENCES CAME OUT OF ONE COLLAPSED BRANCH. Reported through
   * the same channel as a corrupt file, this state told the person "We cannot
   * read what you have sent this agent" — we read it perfectly well and chose
   * not to show it — and then "this is not saying you have sent nothing", which
   * manufactures the opposite wrong idea, because for THIS project they have
   * sent nothing and that is the useful fact.
   *
   * Withheld and unreadable are different answers, so they travel separately.
   */
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [said(), said(), said('screen')],
    async ({ project }) => {
      await post(`/api/project/${project.id}/thread/zeta`, { text: 'said to the first project' });
      // The control: this project reads its own message back.
      assert.equal(json(await req(`/api/project/${project.id}/thread/zeta`)).messages.length, 1);

      // Re-stamp the stored thread as belonging to an EARLIER project of this
      // name, which is what a remove-and-recreate leaves behind.
      const file = chat.threadFile(project.id, 'zeta');
      const was = JSON.parse(fs.readFileSync(file, 'utf8'));
      was.projectBornAt = '2020-01-01T00:00:00.000Z';
      fs.writeFileSync(file, JSON.stringify(was));

      const body = json(await req(`/api/project/${project.id}/thread/zeta`));
      assert.equal(body.historyOther, true, 'the withheld state is not distinguished from unreadable');
      assert.deepEqual(body.messages, [],
        'this project has genuinely sent nothing, and an empty list is the true answer');
      assert.equal(body.historyBecause, null,
        'a state we read and withheld must not be reported as one we could not read');
      assert.equal(body.historyUnfilable, false, 'the channels stay mutually exclusive');
    });
});

test('the folder-preview ROUTE answers the case-corrected path, not the raw derivation', async () => {
  // ⚠️ The route's docblock is where "the path shown is the path the act
  // produces" is promised, and swapping folderPathPreview back to
  // folderPathFor there failed nothing (round 13) -- the engine function was
  // covered, its one caller was not. Same volume-portable shape as the
  // engine test: the assertion is agreement with the act, not a spelling.
  reset();
  fs.mkdirSync(path.join(projects.projectsRoot(), 'Lease'), { recursive: true });
  const body = json(await req('/api/project-folder?name=lease'));
  assert.equal(body.problem, null);
  assert.equal(body.exists, true, 'an existing folder must preview as ADOPT, not make (round 17)');
  assert.equal(body.path, projects.makeFolder('lease'),
    'the route previewed one path and the act produced another');
  const fresh = json(await req('/api/project-folder?name=Entirely%20new%20here'));
  assert.equal(fresh.exists, false, 'control: a fresh name previews as make');
});

test('the folder-preview ROUTE carries the blocked arm, not just the engine', async () => {
  // ⚠️ Same round-13 shape as the test above: the engine's third arm is
  // covered (engine/projects.test.js), but `blocked: preview.blocked || null`
  // in the route was held by nothing -- hardcoding `blocked: null` there left
  // the whole suite green while the add screen went back to promising
  // "Kosmos will make this at X" over a path makeFolder refuses (round 37).
  reset();
  fs.writeFileSync(path.join(projects.projectsRoot(), 'Occupied'), 'a file, not a folder');
  const body = json(await req('/api/project-folder?name=Occupied'));
  assert.equal(typeof body.blocked, 'string',
    'a FILE at the path must reach the page as the engine\'s own refusal sentence');
  assert.ok(body.blocked.length > 0, 'the refusal is a sentence, not an empty flag');
  // The control, so this cannot pass by the route answering blocked for
  // everything: a makeable name previews with the arm empty.
  const clear = json(await req('/api/project-folder?name=Makeable%20here'));
  assert.equal(clear.blocked, null, 'control: a makeable path previews unblocked');
});

test('an undecodable segment on the THREAD verbs is refused, both verbs', async () => {
  // The plain project route's %ZZ test does not cover these: each verb calls
  // decodeSegment on its own two segments and answers its own 400 (round 37).
  const got = await req('/api/project/%ZZ/thread/zeta');
  assert.equal(got.status, 400);
  assert.ok(got.type.includes('application/json'));
  const posted = await req('/api/project/abc/thread/%ZZ', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ text: 'hello' }),
  });
  assert.equal(posted.status, 400);
  assert.ok(posted.type.includes('application/json'));
});

test('the POST route really stamps projectBornAt, read off the file it wrote', async () => {
  /**
   * ⚠️ THE WIRING, not the guard. The engine's reuse guard is well covered,
   * but every test of it re-stamped the file BY HAND, overwriting whatever
   * the route had written -- so dropping `project.createdAt` from the route's
   * appendMessage call left the whole suite green (measured, round 12) while
   * every new thread was born with projectBornAt null, which makes the
   * mismatch check inert for all of them: a recreated project of the same
   * name would inherit the earlier project's conversation, the exact defect
   * the guard exists for. This reads the file the route ACTUALLY wrote.
   */
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [said(), said(), said('screen')],
    async ({ project }) => {
      await post(`/api/project/${project.id}/thread/zeta`, { text: 'stamp me' });
      const was = JSON.parse(fs.readFileSync(chat.threadFile(project.id, 'zeta'), 'utf8'));
      assert.ok(project.createdAt, 'control: the project carries a createdAt to stamp');
      assert.equal(was.projectBornAt, project.createdAt,
        'the route must stamp the thread with the project’s own birth time');
    });
});

test('an agent whose name cannot be FILED under is told the truth, not the two false sentences', async () => {
  /**
   * ⚠️ THE CASE THAT SLIPPED PAST EVERY EARLIER ROUND. `chat.threadFile`
   * refuses an agent whose session name is not already its own store key — a
   * capital or a dot — which is exactly what adopting the pre-existing
   * `-discord` fleet produces, and exactly the capitalised names Josh asked to
   * be able to use. The refusal is RIGHT: relaxing it would fold `MyBot` and
   * `mybot` onto one file, which is the case-collision blocker this branch
   * already killed.
   *
   * What was wrong was the reporting. The refusal went down the same channel as
   * a corrupt file, so the screen said "We cannot read what you have sent this
   * agent" (there is no file to read, and never will be) and "this is not
   * saying you have sent nothing" (nothing is kept for this agent anywhere).
   * Both false, in opposite directions, on the one screen this branch built to
   * stop exactly that.
   *
   * ⚠️ The "corrupt file" test does NOT cover this, which is how it slipped:
   * that one plants a damaged file under a filable name.
   */
  for (const name of ['MyBot', 'my.bot']) {
    reset();
    await withThread(fleet.agent(name, { state: 'idle' }), [said(), said(), said('screen')],
      async ({ project }) => {
        const body = json(await req(`/api/project/${project.id}/thread/${encodeURIComponent(name)}`));
        assert.equal(body.historyUnfilable, true, `${name}: the unfilable state has no channel of its own`);
        assert.deepEqual(body.messages, [], `${name}: an empty list is the honest shape when no file exists`);
        assert.equal(body.historyOther, false, `${name}: this is not an earlier project's conversation`);
        // historyBecause is non-null here BY DESIGN (the unfilable sentence
        // rides that channel); exclusivity for this arm is the Other flag.
        assert.match(body.historyBecause, /agent name we can keep a thread under/);
        // ⚠️ AND IT PROMISES NOTHING ABOUT DELIVERY. This state fires on the
        // SHAPE OF THE NAME and knows nothing about whether the agent is
        // reachable — a member with no such session answers could_not on every
        // send, so a standing 'messages are delivered' promise here is false
        // exactly when the person most needs the screen to be right.
        assert.ok(!/delivered/i.test(JSON.stringify(body)),
          `${name}: the unfilable answer promises delivery it cannot know about`);

        // ⚠️ AND SENDING STILL WORKS. The words reach the agent's session; only
        // the keeping does not, and the send-time answer says both.
        const sent = json(await post(`/api/project/${project.id}/thread/${encodeURIComponent(name)}`,
          { text: 'this reaches you but is not kept' }));
        assert.equal(sent.delivery.state, 'placed', `${name}: delivery must not be collateral damage`);
        assert.equal(sent.recorded, false, `${name}: nothing can be recorded under this name`);
        assert.match(sent.recordedBecause, /agent name we can keep a thread under/);
      });
  }
});

test('the thread GET returns a bounded tail with the older count stated, never the whole 1000', async () => {
  // ⚠️ Round 36: the poll fetched the entire array every five seconds; at
  // the engine's own ceilings that is ~2MB of parse-and-stringify per tick
  // on a synchronous server. The tail is 200 and `olderCount` carries the
  // truth the page states.
  reset();
  await withThread(fleet.agent('zeta', { state: 'idle' }), [], async ({ project }) => {
    const chat = require('./engine/chat');
    for (let i = 0; i < 205; i += 1) {
      chat.appendMessage(project.id, 'zeta', {
        text: 'row ' + i, delivery: { state: chat.DELIVERY.PLACED },
      }, project.createdAt);
    }
    const body = json(await req(`/api/project/${project.id}/thread/zeta`));
    assert.equal(body.messages.length, 200, 'the tail must be bounded');
    assert.equal(body.olderCount, 5, 'and the count of unshown rows stated');
    assert.equal(body.messages[0].text, 'row 5', 'the tail is the NEWEST 200');
    assert.equal(body.messages[199].text, 'row 204');
  });
});
