'use strict';

/**
 * The org view's tree and placement (#137).
 *
 * 🛑 THESE TWO FUNCTIONS SHIPPED WITH NO TEST AT ALL. They were verified in a
 * browser, which proved the picture on ONE board -- fourteen agents, nobody
 * assigned. Every branch that matters is invisible on that board: a cycle, a
 * manager who has been removed, a ring that fills, a chain three deep. A
 * screenshot of the easy case is not coverage of the hard ones.
 *
 * 🔑 AND THE CYCLE ONE IS NOT COSMETIC. `reportsTo` is refused both places a
 * person can set it, but a hand-edited profile file is refused nowhere, and a
 * walk with no seen-set over that data recurses until the tab dies. A guard
 * was written for it and had never once been exercised.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sandboxed before the fleet loads: it writes worker folders and reads a data
   root, and neither belongs to a test about polar coordinates. */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-org-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-org-w-'));
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* Boundary-anchored, for the reason server.test.js records: a sibling whose
   name merely starts with the wanted one silently captures the extractor. */
function lift(names, tail) {
  const src = names.map((name) => {
    let at = SCRIPT.indexOf('function ' + name + '(');
    assert.ok(at > -1, name + ' vanished from the page');
    let depth = 0; let end = -1;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
      if (SCRIPT[k] === '{') depth += 1;
      else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
    }
    return SCRIPT.slice(at, end);
  }).join('\n');
  /* ⚠️ READ OUT OF THE BUILD, never restated here. An earlier draft of this
     file hard-coded `150 / 96 / 62`, which is a copy: the day somebody widens
     the first ring, the copy keeps the old number and every placement test
     goes on passing against a geometry the product no longer has. Lifting the
     declarations means a changed constant reaches the tests. */
  const consts = ['ORG_R0', 'ORG_STEP', 'ORG_MIN_ARC'].map((k) => {
    const m = SCRIPT.match(new RegExp('const\\s+' + k + '\\s*=\\s*([-\\d.]+)\\s*;'));
    assert.ok(m, k + ' is no longer declared in the page');
    return 'const ' + k + ' = ' + m[1] + ';';
  }).join('\n') + '\n';
  // eslint-disable-next-line no-new-func
  return new Function(consts + src + '\n' + tail)();
}

const tree = lift(['orgTreeOf'], 'return orgTreeOf;');
const place = lift(['orgTreeOf', 'orgPlace'],
  'return { orgTreeOf, orgPlace, ORG_R0, ORG_STEP, ORG_MIN_ARC };');

/**
 * Inputs come from the REAL producers, and the field names are pinned to them.
 *
 * 🔑 `fixture-discipline.test.js` refuses hand-built cards, and it is right to:
 * a literal is free to carry fields `snapshot()` never emits, and a test built
 * on one proves nothing about production. So the cards here come from
 * `fleet.install()` and the `reportsTo` on them is written through the real
 * `store.writeProfile`, which is the same path `createAgent` uses.
 *
 * 🛑 BUT THE STRICT WRAPPER CANNOT BE LEFT ON FOR THE LAYOUT TESTS, and the
 * reason is worth stating rather than working around. `create.js` writes
 * `reportsTo` into a profile ONLY when one was chosen, so an unassigned
 * agent's profile genuinely does not contain the key. The wrapper throws on
 * any field the producer did not emit, which is precisely what makes it
 * valuable -- and it cannot tell a legitimately absent OPTIONAL field from a
 * misspelled one. Under strict mode the product's own correct read throws on
 * the commonest board there is: a fresh install where nobody is assigned.
 *
 * So the protection is bought back where it can be exact, in `pins` below:
 * ONE strict test proves `sessionName` and `profile.reportsTo` are the names
 * the producer really uses, against a profile written by the real writer. The
 * layout tests then run unstrict, on cards from the same producer. A typo in
 * either field name fails `pins`; the geometry tests stay able to model an
 * absent manager, which is the case that matters most.
 */
const store = require('./engine/store');

const build = (specs, opts) => {
  for (const sp of specs) if (sp.to) store.writeProfile(sp.name, { reportsTo: sp.to });
  const board = fleet.install(
    specs.map((sp) => fleet.agent(sp.name, { state: 'idle' })),
    opts,
  );
  try {
    const byName = Object.fromEntries(board.agents.map((c) => [c.sessionName, c]));
    return specs.map((sp) => {
      assert.ok(byName[sp.name], 'the fleet produced no card for ' + sp.name);
      return byName[sp.name];
    });
  } finally { board.restore(); }
};

/* Unstrict, for the reason written above. */
const agents = (...specs) => build(specs, { strict: false });
const a = (name, to) => ({ name, to });

test('the producer emits the two fields the org view reads', () => {
  /* Strict ON. This is the one test that can afford it, and it is the one that
     makes the rest honest: if `snapshot()` ever renames either field, or if
     `writeProfile` stops landing in `profile`, this fails by name. */
  const [boss, kid] = build([a('theboss'), a('thekid', 'theboss')]);

  assert.equal(kid.sessionName, 'thekid', 'the card names its session `sessionName`');
  assert.equal(kid.profile.reportsTo, 'theboss',
    'a profile written by the real writer reaches the card as `profile.reportsTo`');

  /* And the absent case is asserted WITHOUT reading the key, since reading it
     is what the wrapper refuses. `Object.keys` goes through a different trap. */
  assert.ok(!Object.keys(boss.profile || {}).includes('reportsTo'),
    'an unassigned agent has no reportsTo, which is why the layout tests run unstrict');
});

test('nobody assigned puts everyone on the first ring', () => {
  const out = tree(agents(a('a'), a('b'), a('c')));
  assert.deepEqual(out.map((n) => n.depth), [0, 0, 0]);
  assert.deepEqual(out.map((n) => n.parent), [null, null, null]);
});

test('a chain runs outward, one ring per step', () => {
  const out = tree(agents(a('a'), a('b', 'a'), a('c', 'b')));
  const byName = Object.fromEntries(out.map((n) => [n.agent.sessionName, n]));
  assert.equal(byName.a.depth, 0);
  assert.equal(byName.b.depth, 1);
  assert.equal(byName.c.depth, 2);
  assert.equal(byName.c.parent, 'b');
});

test('a manager who is not on the board is no manager', () => {
  /* ⚠️ Otherwise the agent hangs off a node that is not drawn and vanishes from
     the picture entirely. Back to the first ring is the truth: nothing above it
     exists here. */
  const out = tree(agents(a('a', 'departed')));
  assert.equal(out.length, 1);
  assert.equal(out[0].depth, 0);
  assert.equal(out[0].parent, null);
});

test('an agent reporting to itself is not a manager either', () => {
  const out = tree(agents(a('a', 'a')));
  assert.equal(out[0].depth, 0, 'a self-report made a ring of one');
});

test('a CYCLE terminates, and draws everybody exactly once', () => {
  /**
   * 🛑 THE ONE THAT WOULD KILL THE TAB. Both write paths refuse a self-loop,
   * and neither can refuse `a -> b -> a` written into the profile files by
   * hand. A walk with no seen-set recurses forever on that.
   *
   * ⚠️ AND EVERY AGENT MUST STILL APPEAR. An agent missing from a picture is
   * the one failure a picture cannot admit to: there is no empty space that
   * says "somebody is not drawn here".
   */
  const out = tree(agents(a('a', 'b'), a('b', 'a'), a('c')));
  const names = out.map((n) => n.agent.sessionName).sort();
  assert.deepEqual(names, ['a', 'b', 'c'], 'a cycle swallowed an agent');
  assert.equal(new Set(names).size, 3, 'an agent was drawn twice');
});

test('a three-way cycle also terminates', () => {
  const out = tree(agents(a('a', 'b'), a('b', 'c'), a('c', 'a')));
  assert.deepEqual(out.map((n) => n.agent.sessionName).sort(), ['a', 'b', 'c']);
});

test('a crowded ring spills outward instead of overlapping', () => {
  /**
   * 🔑 EVERYBODY'S FIRST ORG CHART IS THIS. A fleet starts with nobody
   * assigned, so "everyone on ring one" is the FIRST screen anyone sees, not an
   * edge case. Circumference is finite: the first ring holds however many
   * minimum-arcs fit around it, and thirty is comfortably more than that at
   * any ring size this product has shipped.
   */
  const many = agents(...Array.from({ length: 30 }, (_, i) => a('a' + i)));
  const { placed, maxR } = place.orgPlace(place.orgTreeOf(many));
  assert.equal(placed.size, 30, 'an agent was dropped');
  /* ⚠️ AGAINST THE LIFTED CONSTANT, not against `150`. Written as a literal
     this assertion passed with the first ring widened to 400px -- where thirty
     nodes fit on one ring comfortably and NOTHING SPILLS, which is the exact
     behaviour the test is named for. A literal here does not merely go stale,
     it inverts: the bigger the ring grows, the more certainly `maxR > 150`
     holds while the property stops being true. */
  assert.ok(maxR > place.ORG_R0,
    'thirty nodes stayed on the first ring (maxR ' + maxR + ', R0 ' + place.ORG_R0 + ')');

  /* The real assertion: no two nodes closer than a node's width. Positions are
     polar, so this is the same arithmetic the browser check does on rects. */
  const pts = [...placed.values()].map((s) => ({
    x: Math.cos(s.ang) * s.r, y: Math.sin(s.ang) * s.r,
  }));
  let tooClose = 0;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 46) tooClose += 1;
    }
  }
  assert.equal(tooClose, 0, tooClose + ' pairs of nodes overlap');
});

test('a child sits near its parent rather than wherever its index falls', () => {
  /* A chain must run outward ALONG ITS OWN BRANCH; scattering children by index
     is what makes a radial chart unreadable. */
  const { placed } = place.orgPlace(place.orgTreeOf(
    agents(a('p1'), a('p2'), a('p3'), a('p4'), a('kid', 'p1')),
  ));
  const parent = placed.get('p1');
  const kid = placed.get('kid');
  const diff = Math.abs(((kid.ang - parent.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(diff < 0.35, 'the child was placed away from its parent, angle gap ' + diff.toFixed(2));
  assert.ok(kid.r > parent.r, 'the child is not further out than its parent');
});

test('an empty board places nothing and does not throw', () => {
  const { placed } = place.orgPlace(place.orgTreeOf([]));
  assert.equal(placed.size, 0);
});
