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
const nodePath = require('node:path');

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
  const consts = 'const ORG_R0 = 150, ORG_STEP = 96, ORG_MIN_ARC = 62;\n';
  // eslint-disable-next-line no-new-func
  return new Function(consts + src + '\n' + tail)();
}

const tree = lift(['orgTreeOf'], 'return orgTreeOf;');
const place = lift(['orgTreeOf', 'orgPlace'], 'return { orgTreeOf, orgPlace };');

const agent = (name, reportsTo) => ({ sessionName: name, profile: reportsTo ? { reportsTo } : {} });

test('nobody assigned puts everyone on the first ring', () => {
  const out = tree([agent('a'), agent('b'), agent('c')]);
  assert.deepEqual(out.map((n) => n.depth), [0, 0, 0]);
  assert.deepEqual(out.map((n) => n.parent), [null, null, null]);
});

test('a chain runs outward, one ring per step', () => {
  const out = tree([agent('a'), agent('b', 'a'), agent('c', 'b')]);
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
  const out = tree([agent('a', 'departed')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].depth, 0);
  assert.equal(out[0].parent, null);
});

test('an agent reporting to itself is not a manager either', () => {
  const out = tree([agent('a', 'a')]);
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
  const out = tree([agent('a', 'b'), agent('b', 'a'), agent('c')]);
  const names = out.map((n) => n.agent.sessionName).sort();
  assert.deepEqual(names, ['a', 'b', 'c'], 'a cycle swallowed an agent');
  assert.equal(new Set(names).size, 3, 'an agent was drawn twice');
});

test('a three-way cycle also terminates', () => {
  const out = tree([agent('a', 'b'), agent('b', 'c'), agent('c', 'a')]);
  assert.deepEqual(out.map((n) => n.agent.sessionName).sort(), ['a', 'b', 'c']);
});

test('a crowded ring spills outward instead of overlapping', () => {
  /**
   * 🔑 EVERYBODY'S FIRST ORG CHART IS THIS. A fleet starts with nobody
   * assigned, so "everyone on ring one" is the FIRST screen anyone sees, not an
   * edge case. Circumference is finite: at 150px radius and a 62px arc per
   * node, about fifteen fit before they touch.
   */
  const many = Array.from({ length: 30 }, (_, i) => agent('a' + i));
  const { placed, maxR } = place.orgPlace(place.orgTreeOf(many));
  assert.equal(placed.size, 30, 'an agent was dropped');
  assert.ok(maxR > 150, 'thirty nodes stayed on one radius', 'maxR ' + maxR);

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
  const { placed } = place.orgPlace(place.orgTreeOf([
    agent('p1'), agent('p2'), agent('p3'), agent('p4'),
    agent('kid', 'p1'),
  ]));
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
