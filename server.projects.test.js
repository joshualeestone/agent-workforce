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
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

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
    const routes = [
      ['/api/projects', undefined],
      ['/api/project/anything', undefined],
      ['/api/project/anything/agent/mara', { method: 'POST', headers: { origin: base } }],
      ['/api/project/anything/agent/mara', { method: 'DELETE', headers: { origin: base } }],
      ['/api/project/anything', { method: 'DELETE', headers: { origin: base } }],
    ];
    for (const [p, opts] of routes) {
      const res = await req(p, opts);
      assert.ok(res.status >= 400, `${p} answered ${res.status}`);
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
