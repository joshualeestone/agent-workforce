'use strict';

/**
 * An agent that is not running still exists, and the board says so (#278).
 *
 * 🛑 THE ROSTER CAME FROM `tmux list-panes`, so an agent with no live pane was
 * not merely unreported, it was absent. Josh's board read "1 Agents" on
 * 2026-08-22 while fifteen more sat in ~/work/workers with their instructions,
 * avatars and history intact, and the Projects tab one click away was correctly
 * saying "4 agents, 4 we cannot see" about the same fleet. Two screens, one
 * app, one moment, opposite answers (Mona Lisa).
 *
 * ⚠️ THE ROW UNDER TEST IS ASKED FOR, NEVER WRITTEN HERE, which is
 * `test-support/fleet`'s rule and it applies with more force to this shape than
 * to any other: it is a row the ROUTE fabricates for an agent no producer has
 * ever seen, so a hand-built copy would be a description of what I meant rather
 * than of what ships. It comes from a real server against a sandboxed store,
 * and it is wrapped in the same strict proxy, so a renderer reading a field the
 * route does not emit throws instead of quietly reading `undefined`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;
const PAGE = fs.readFileSync(nodePath.join(REPO, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');
const SCRIPT = page.scriptOf(PAGE);

/** One real board, asked once, with two agents on disk and neither running. */
let PAYLOAD = null;
function board() {
  if (PAYLOAD) return PAYLOAD;
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-nr-'));
  const profiles = nodePath.join(sb, 'data', 'AgentWorkforce', 'profiles');
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'workers', 'ghosty'), { recursive: true });
  fs.writeFileSync(nodePath.join(profiles, 'ghosty.json'),
    JSON.stringify({ role: 'Copywriter', displayName: 'Ghosty' }));

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      http.get({ host: '127.0.0.1', port, path: '/api/status' }, (res) => {
        let s = '';
        res.on('data', (d) => { s += d; });
        res.on('end', () => { process.stdout.write(s); srv.close(); process.exit(0); });
      });
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  PAYLOAD = JSON.parse(out);
  return PAYLOAD;
}

function offlineRow({ strict = true } = {}) {
  const row = board().agents.find((a) => a.sessionName === 'ghosty');
  assert.ok(row, 'the route no longer puts a known, not-running agent in the roster');
  return strict ? fleet.strict(row, '/api/status') : row;
}

/**
 * The renderers, with the helpers they reach for.
 *
 * `face` is lifted rather than stubbed: it is the ONE derivation of an agent's
 * picture, shared with the memory ring, and stubbing it would let the two drift
 * apart with these tests still green.
 */
function render(which, a) {
  const fn = new Function('a', 'esc', 'GLYPH', 'PRESSAY', 'roleLine', 'discTint', 'discInk', 'initials',
    `${page.lift(SCRIPT, 'face')}\n${page.lift(SCRIPT, which)}\nreturn ${which}(a);`);
  return fn(a, (x) => String(x == null ? '' : x), { stopped: '<span class="stop"></span>' },
    { off: 'Not running' }, (x) => x.role || '', () => '#eee', () => '#111', (n) => n[0]);
}

test('the route puts a known, not-running agent in the roster', () => {
  const row = offlineRow();
  assert.equal(row.running, false);
  assert.equal(row.name, 'Ghosty', 'act on the machine name, speak the one the person chose');
  assert.equal(row.role, 'Copywriter', 'the role is a record field and survives a stopped session');
  assert.equal(row.state, 'stopped');
});

test('the row carries no reading, absent rather than blank or unknown', () => {
  /* ⚠️ The memory and the task do not EXIST for a stopped agent, and the
     transcript holds yesterday's model. "Unknown" would mean we tried and could
     not; there is nothing to try (Mona Lisa's ruling). */
  const raw = offlineRow({ strict: false });
  for (const field of ['context', 'model', 'modelName', 'task']) {
    assert.ok(!(field in raw), `the route emits ${field} for an agent that is not running`);
  }
});

test('the tiles count them apart, and the row closes', () => {
  const body = board();
  assert.equal(body.counts.notRunning, 1);
  const running = body.agents.filter((a) => a.running !== false).length;
  assert.equal(body.counts.total, running + body.counts.notRunning,
    'the headline total is not what is running plus what is not');
});

for (const which of ['card', 'lrow']) {
  test(`${which}: drawn from the record`, () => {
    const html = render(which, offlineRow());
    assert.match(html, /notrunning/);
    assert.match(html, /Ghosty/);
    assert.match(html, /Copywriter/);
    assert.match(html, /Not running/);
  });

  test(`${which}: no memory, no model, no task, and no unknown either`, () => {
    /* ⚠️ NOT EVEN THE DASHED UNKNOWN RING. Drawing the unknown treatment here
       would be the could-not-look versus is-not-there inversion, on the surface
       that distinction was built for. */
    const html = render(which, offlineRow());
    for (const gone of ['membadge', 'class="gu"', 'class="gf', 'amodel', 'unk', 'lbar']) {
      assert.ok(!html.includes(gone), `${which} still draws ${gone} for an agent that is not running`);
    }
  });

  test(`${which}: the cells it cannot answer are ${which === 'card' ? 'absent' : 'empty'}`, () => {
    /* 🛑 THE TWO RENDERERS DIFFER HERE AND THE FIRST VERSION TREATED THEM THE
       SAME, which shipped a real defect. A card is a stack of rows, so a row
       it cannot fill is simply not drawn. A list row is a FIVE-COLUMN GRID,
       so a row supplying four children shifts every cell one column right:
       measured on a real board, `.lstate` at left=463 where its neighbours
       have it at 313, with the agent's ROLE landing in the state column and
       reading as a state (Mona Lisa).
       🔑 So the list keeps the board's column rhythm and leaves the two cells
       EMPTY. Empty, not a dash and not "no task": a stopped agent has no task
       to not-show. */
    const html = render(which, offlineRow());
    if (which === 'card') {
      for (const gone of ['atask', 'amodel']) {
        assert.ok(!html.includes(gone), `the card still draws ${gone}`);
      }
      return;
    }
    for (const slot of ['lav', 'lname', 'lstate', 'ltask', 'lmem']) {
      assert.ok(html.includes(`class="${slot}"`) || html.includes(`class="${slot} `),
        `the list row is missing its ${slot} cell, so every cell after it moves one column`);
    }
    assert.match(html, /<div class="ltask"><\/div>/, 'the task cell is not empty');
    assert.match(html, /<div class="lmem"><\/div>/, 'the memory cell is not empty');
  });

  test(`${which}: reading a field the route does not emit throws`, () => {
    /* 🛑 THE SHIP-BLOCKER THIS CLASS ALREADY PRODUCED. `lrow` read
       `a.context.percent`, which is not on this row, so ONE stopped agent took
       the whole board down to "we cannot read your agents" while every markup
       assertion passed. The strict proxy is what turns that from `undefined`
       into a loud failure here. */
    assert.doesNotThrow(() => render(which, offlineRow()));
  });
}

for (const which of ['card', 'lrow']) {
  test(`${which}: the state pill uses a class the stylesheet actually dresses`, () => {
    /* 🛑 IT DID NOT. The pill shipped as `st-off`, which has no CSS in this file
       at all, so it fell back to the base `.astate`: in dark its border came out
       at 1.27:1 against the card, which is no outline, and in light its text
       rendered at full ink, making the pill on the card we deliberately
       quietened the loudest thing on the board (Mona Lisa, measured).
       🔑 THE ASSERTION IS NOT THE NAME. Pinning `st-stopped` would pass on any
       future rename to another undressed class. What must hold is that whatever
       class the pill wears is one the stylesheet has rules for. */
    const html = render(which, offlineRow());
    const cls = /class="(?:astate|lstate) (st-[a-z-]+)"/.exec(html);
    assert.ok(cls, `${which} no longer puts a state class on its pill`);
    const rules = PAGE.split(`.${cls[1]}`).length - 1;
    assert.ok(rules > 0, `${which} uses .${cls[1]}, which has no rule anywhere in the stylesheet`);
  });
}
