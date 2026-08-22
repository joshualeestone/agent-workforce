#!/usr/bin/env node
'use strict';

/**
 * Keep the FORCED dark theme in step with the SYSTEM dark theme.
 *
 * 🔑 THE PROBLEM THIS SOLVES. A manual light/dark switch (#40) cannot be done
 * with a media query, because a media query answers a question about the
 * machine and the switch is a question about the person. The usual shape is
 * therefore two copies of every dark rule -- one under
 * `@media (prefers-color-scheme: dark)`, one under `[data-theme="dark"]` -- and
 * two copies of anything is two things that drift. This file makes the second
 * copy DERIVED: it is generated from the first and checked in, and a test fails
 * the moment they disagree.
 *
 * What it does, to every `prefers-color-scheme: dark` block in web/index.html:
 *
 *   1. Prefixes each selector inside with `:root:not([data-theme="light"])`, so
 *      somebody on a dark Mac who chooses Light actually gets light. Without
 *      this the switch works in one direction only, which is the half-built
 *      version of this feature that is easy to ship and hard to notice.
 *   2. Emits a mirrored rule under `:root[data-theme="dark"]` into a generated
 *      section at the end of the stylesheet, so somebody on a light Mac who
 *      chooses Dark gets dark. Outer media conditions (a width, a contrast
 *      preference) are preserved around the mirror; only the colour-scheme
 *      clause is dropped.
 *
 * Run it after touching any dark rule:  node tools/sync-forced-theme.js
 * Check it without writing:             node tools/sync-forced-theme.js --check
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'web', 'index.html');
const START = '/* ===== GENERATED: forced dark theme. Do not edit by hand. ===== */';
const END = '/* ===== END GENERATED ===== */';
const GUARD = ':root:not([data-theme="light"])';
const FORCE = ':root[data-theme="dark"]';

/** The index just past the `{` that opens a block, to its matching `}`. */
function matchBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Selector prefixing that keeps `:root` from becoming `:root :root`. */
function prefixed(sel, prefix) {
  return sel.split(',').map((one) => {
    const s = one.trim();
    if (!s) return s;
    if (s.startsWith(prefix)) return s;              // already done: idempotent
    if (s === ':root' || s.startsWith(':root ')) return prefix + s.slice(':root'.length);
    return prefix + ' ' + s;
  }).join(', ');
}

/**
 * Split a block body into its rules, keeping comments attached to the rule
 * that follows them so the generated copy carries the reasoning too.
 *
 * ⚠️ COMMENTS ARE SKIPPED WHEN LOOKING FOR A BRACE. A `{` inside a comment --
 * and this file's comments quote CSS constantly -- would otherwise close a rule
 * in the wrong place and produce a generated section that parses as nonsense.
 */
function rulesIn(body) {
  const out = [];
  let i = 0;
  let pending = '';
  while (i < body.length) {
    if (body.startsWith('/*', i)) {
      const end = body.indexOf('*/', i + 2);
      const stop = end === -1 ? body.length : end + 2;
      pending += body.slice(i, stop);
      i = stop;
      continue;
    }
    const ch = body[i];
    if (ch === '{') {
      const close = matchBrace(body, i);
      if (close === -1) break;
      const sel = pending.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const comments = (pending.match(/\/\*[\s\S]*?\*\//g) || []).join('\n');
      /* 🛑 OFFSETS, NOT A STRING REPLACE. The first version rewrote selectors
         with `body.replace(sel + raw, want + ' ' + raw)` -- and a selector is
         almost never adjacent to its brace in a real stylesheet (a newline, an
         indent, a comment sit between). So it matched NOTHING, the guard pass
         wrote the file back unchanged, and the tool reported success. The
         generated half looked perfect, which is exactly why it was believable.
         `selAt` is the first character of the selector; splicing to `braceAt`
         cannot miss. */
      out.push({
        sel,
        comments,
        selAt: i - pending.length + (pending.length - pending.trimStart().length),
        braceAt: i,
        body: body.slice(i + 1, close),
        raw: body.slice(i, close + 1),
      });
      pending = '';
      i = close + 1;
      continue;
    }
    pending += ch;
    i += 1;
  }
  return out;
}

function conditionOf(text, atIdx) {
  const open = text.indexOf('{', atIdx);
  return text.slice(atIdx, open).replace(/^@media\s*/, '').trim();
}

/** Every dark media block in the stylesheet, innermost-aware. */
function darkBlocks(css) {
  const found = [];
  const re = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const at = m.index;
    const open = css.indexOf('{', at);
    const close = matchBrace(css, open);
    if (close === -1) continue;
    found.push({ at, open, close, condition: conditionOf(css, at) });
    re.lastIndex = close;
  }
  return found;
}

/** The outer @media conditions a nested block sits inside. */
function outerConditions(css, at) {
  const conds = [];
  const re = /@media[^{]*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const open = css.indexOf('{', m.index);
    const close = matchBrace(css, open);
    if (close === -1) continue;
    if (m.index < at && close > at && !/prefers-color-scheme/.test(css.slice(m.index, open))) {
      conds.push(conditionOf(css, m.index));
    }
  }
  return conds;
}

function build(css) {
  /* Guard pass first, on the ORIGINAL text, so the mirror is generated from
     rules whose selectors are already in their final shape. */
  let guarded = css;
  for (const b of darkBlocks(guarded).reverse()) {
    const body = guarded.slice(b.open + 1, b.close);
    let rebuilt = body;
    /* Back to front, so an earlier splice cannot move a later offset. */
    for (const r of rulesIn(body).reverse()) {
      if (r.sel.startsWith('@')) continue;   // a nested at-rule keeps its own shape
      const want = prefixed(r.sel, GUARD);
      if (want === r.sel) continue;
      rebuilt = rebuilt.slice(0, r.selAt) + want + ' ' + rebuilt.slice(r.braceAt);
    }
    guarded = guarded.slice(0, b.open + 1) + rebuilt + guarded.slice(b.close);
  }

  /* Mirror pass, from the guarded text. */
  const pieces = [];
  for (const b of darkBlocks(guarded)) {
    const body = guarded.slice(b.open + 1, b.close);
    const outer = outerConditions(guarded, b.at);
    /* The colour-scheme clause is what the mirror replaces; anything else in
       the condition (a contrast preference, a width) still has to hold. */
    const rest = b.condition
      .split(/\s+and\s+/)
      .filter((c) => !/prefers-color-scheme/.test(c))
      .join(' and ');
    const wraps = outer.concat(rest ? [rest] : []);
    const inner = [];
    for (const r of rulesIn(body)) {
      if (r.sel.startsWith('@')) continue;
      const sel = prefixed(r.sel.replace(new RegExp(GUARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ':root'), FORCE);
      inner.push((r.comments ? r.comments + '\n' : '') + sel + ' {' + r.body + '}');
    }
    if (!inner.length) continue;
    const text = inner.join('\n');
    pieces.push(wraps.length
      ? wraps.map((c) => '@media ' + c + ' {').join('\n') + '\n' + text + '\n' + wraps.map(() => '}').join('\n')
      : text);
  }

  const generated = [START,
    '/* Written by tools/sync-forced-theme.js from the prefers-color-scheme',
    '   blocks above. Edit those; run the tool; commit both. */',
    pieces.join('\n\n'), END].join('\n');

  const s = guarded.indexOf(START);
  if (s !== -1) {
    const e = guarded.indexOf(END, s);
    return guarded.slice(0, s) + generated + guarded.slice(e + END.length);
  }
  return guarded.replace(/\n<\/style>/, '\n' + generated + '\n</style>');
}

function run() {
  const before = fs.readFileSync(FILE, 'utf8');
  const after = build(before);
  const check = process.argv.includes('--check');
  if (before === after) { if (!check) console.log('forced theme already in sync'); return 0; }
  if (check) {
    console.error('the forced dark theme is out of sync with the system one.');
    console.error('run: node tools/sync-forced-theme.js');
    return 1;
  }
  fs.writeFileSync(FILE, after, 'utf8');
  console.log('forced theme regenerated');
  return 0;
}

if (require.main === module) process.exit(run());
module.exports = { build, prefixed, rulesIn, darkBlocks, START, END };
