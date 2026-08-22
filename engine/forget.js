'use strict';

/**
 * Delete your history: the record of what your agents have SAID and REPORTED.
 *
 * 🛑 THIS IS THE ONE CONTROL IN KOSMOS THAT TAKES SOMETHING AWAY WITH NO UNDO,
 * so the scope is named exhaustively here and nowhere else, and the screen
 * reads it from this module rather than describing it in its own words. Two
 * directories, both entirely ours:
 *
 *   chats/        every conversation -- the direct threads and the project rooms
 *   commitments/  what each agent last reported it was holding
 *
 * ⚠️ AND THE LIST OF THINGS IT DOES NOT TOUCH IS THE LOAD-BEARING HALF, because
 * a person deleting "history" cannot be expected to guess where the line is:
 *
 *   projects.json          projects, their members, and their tasks
 *   profiles/ avatars/     who an agent IS, which is not something it has done
 *   the worker folders     instructions, and the files agents made
 *   ~/.claude/projects/    the TRANSCRIPTS, which are Claude Code's and are
 *                          shared across accounts. Deleting those is the exact
 *                          amnesia the account move refuses to cause, and it
 *                          would be Kosmos destroying another tool's data.
 *
 * 🔑 IT CAN ONLY EVER REMOVE THOSE TWO NAMES. `rm -rf` on a computed path is
 * how a delete feature becomes an incident: the paths are joined from a fixed
 * list here, checked to be inside the data root, and nothing else is reachable
 * from any caller. There is no argument that widens it.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;

/* The whole surface. Adding a name here is the only way to widen this. */
const KINDS = [
  { key: 'chats', dir: () => path.join(store.ROOT, 'chats'), label: 'conversations' },
  { key: 'commitments', dir: () => path.join(BASE, 'commitments'), label: 'reports' },
];

function countIn(dir) {
  try { return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length; }
  catch { return 0; }
}

/**
 * What is there to delete, so the screen can say it before asking.
 *
 * ⚠️ A count of ZERO is not the same as a directory we could not read, and both
 * would render as "nothing to delete" if this returned a bare number. `readable`
 * carries the difference, and the screen refuses to offer a delete it cannot
 * describe -- "this will remove nothing" over an unreadable store is the worst
 * sentence this feature could say.
 */
function summary() {
  const parts = KINDS.map((k) => {
    const dir = k.dir();
    let readable = true;
    let count = 0;
    try {
      if (fs.existsSync(dir)) count = countIn(dir);
    } catch { readable = false; }
    return { key: k.key, label: k.label, count, readable };
  });
  return {
    parts,
    total: parts.reduce((n, p) => n + p.count, 0),
    readable: parts.every((p) => p.readable),
  };
}

/**
 * Remove them.
 *
 * 🛑 EVERY PATH IS RE-CHECKED TO BE INSIDE THE DATA ROOT IMMEDIATELY BEFORE THE
 * DELETE, even though it was built from a constant a line earlier. The check is
 * cheap and the failure it prevents is unbounded: an env var pointing the data
 * root somewhere unexpected, a symlinked directory, a future caller passing a
 * name. A guard that is only correct because of how it is called today is not a
 * guard.
 */
function forget() {
  const root = path.resolve(BASE);
  const altRoot = path.resolve(store.ROOT);
  const gone = [];
  for (const k of KINDS) {
    const dir = path.resolve(k.dir());
    const inside = (dir.startsWith(root + path.sep) || dir.startsWith(altRoot + path.sep));
    if (!inside) {
      return { ok: false, because: 'we will not delete anything outside your Kosmos data folder' };
    }
    if (path.basename(dir) !== k.key) {
      return { ok: false, because: 'that does not look like the folder we meant to delete' };
    }
    const count = fs.existsSync(dir) ? countIn(dir) : 0;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      return { ok: false, because: 'we could not delete all of it, so some of your history is still here' };
    }
    gone.push({ key: k.key, label: k.label, count });
  }
  return { ok: true, gone, total: gone.reduce((n, g) => n + g.count, 0) };
}

module.exports = { summary, forget, KINDS };
