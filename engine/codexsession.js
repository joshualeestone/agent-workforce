'use strict';

/**
 * Reading a Codex session, the way `status.js` reads a Claude Code one.
 *
 * #244, phase 1 of running agents on OpenAI. Kosmos does not call an API: it
 * launches a terminal agent, keeps it alive, addresses its pane, and READS THE
 * LOG THAT AGENT WRITES. So a second provider is mostly a second reader.
 *
 * 📌 CODEX WRITES A JSONL ROLLOUT, one object per line, at
 * `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<uuid>.jsonl` -- the same
 * SHAPE Claude writes, in a different place. (It also keeps a SQLite index over
 * that file; this reads the file, because the file is the record and the index
 * is derived from it.) Measured from a real session on 2026-08-22, not taken
 * from documentation, which does not describe this at all.
 *
 * ⭐ AND IT CARRIES ONE THING CLAUDE'S DOES NOT: the context window, stated by
 * the tool on `task_started`. Kosmos has to ASSUME that number for Claude --
 * the card literally says "against a limit we have assumed rather than
 * watched". Here it is measured, so an OpenAI agent's memory ring rests on a
 * firmer footing than a Claude one.
 *
 * 🛑 WHAT THIS FILE DOES NOT CLAIM. The USED half of the ring is not here,
 * because I have not seen a successful run report usage and I will not invent a
 * field name from a failed one. `contextUsed` is null until somebody reads a
 * real completed session and says what carries it. Null renders as "we could
 * not tell", which is this product's honest answer and not a placeholder.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Overridable so tests never read the operator's real Codex history. */
const HOME = () => process.env.AGENT_WORKFORCE_CODEX_HOME
  || path.join(process.env.AGENT_WORKFORCE_HOME || os.homedir(), '.codex');

const SESSIONS = () => path.join(HOME(), 'sessions');

/** Every rollout file, newest first by name (the name carries the timestamp). */
function rollouts() {
  const root = SESSIONS();
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      /* Bounded rather than unbounded: the layout is year/month/day, so three
         levels is the whole tree. An unbounded walk of somebody's home
         directory is a different and much worse function. */
      if (e.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(full);
    }
  };
  walk(root, 0);
  return out.sort().reverse();
}

/**
 * The first line of a rollout is its `session_meta`, which carries the folder
 * the session was launched in.
 *
 * ⚠️ THE HEAD, NOT THE TAIL, and that distinction already cost a bug once in
 * this product: the same reader for Claude read the END of the file looking for
 * something written at the START.
 */
function metaOf(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const first = buf.slice(0, n).toString('utf8').split('\n')[0];
    const row = JSON.parse(first);
    if (!row || row.type !== 'session_meta') return null;
    return row.payload || null;
  } catch { return null; }
  finally { try { fs.closeSync(fd); } catch { /* already gone */ } }
}

/**
 * The newest session Codex recorded for a given working directory.
 *
 * 🔑 KEYED ON THE LAUNCH FOLDER, exactly as the Claude reader is, because that
 * is the one fact Kosmos controls: it chooses the directory it starts an agent
 * in. Anything else -- a name, a title, a pane id -- is a coincidence the agent
 * could change.
 */
function forWorkdir(dir) {
  if (!dir) return null;
  const want = path.resolve(dir);
  for (const file of rollouts()) {
    const meta = metaOf(file);
    if (!meta || !meta.cwd) continue;
    /* `realpathSync` on both sides, because /tmp is a symlink to /private/tmp
       on macOS and a string compare misses every session started under it. */
    let a = want; let b = path.resolve(meta.cwd);
    try { a = fs.realpathSync(a); } catch { /* gone; compare the literal */ }
    try { b = fs.realpathSync(b); } catch { /* gone; compare the literal */ }
    if (a === b) return { file, meta };
  }
  return null;
}

/**
 * What the board needs from a Codex session.
 *
 * ⚠️ EVERY FIELD IS null WHEN UNKNOWN, never a default. A model of "unknown"
 * and a context window of 0 would each render as a fact somebody could act on.
 */
function read(dir) {
  const found = forWorkdir(dir);
  if (!found) return { found: false, because: 'Codex has not recorded a session in that folder' };
  let lines = [];
  try { lines = fs.readFileSync(found.file, 'utf8').split('\n'); } catch {
    return { found: false, because: 'we could not read that session' };
  }
  let contextWindow = null;
  let lastAt = null;
  let messages = 0;
  let lastAgentMessage = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.timestamp) lastAt = row.timestamp;
    if (row.type === 'response_item') messages += 1;
    if (row.type === 'event_msg' && row.payload) {
      const p = row.payload;
      /* The tool states its own limit here. Taken only from `task_started`,
         where it is the model's window, rather than from any field that merely
         looks like a number of tokens. */
      if (p.type === 'task_started' && typeof p.model_context_window === 'number') {
        contextWindow = p.model_context_window;
      }
      if (p.type === 'task_complete' && typeof p.last_agent_message === 'string') {
        lastAgentMessage = p.last_agent_message;
      }
    }
  }
  return {
    found: true,
    file: found.file,
    sessionId: found.meta.session_id || null,
    provider: found.meta.model_provider || null,
    cliVersion: found.meta.cli_version || null,
    contextWindow,
    /* 🛑 DELIBERATELY NULL. I have not seen a successful Codex run report token
       usage, and inventing a field name from a failed one is how a number
       nobody computed ends up on a card. One real session decides this. */
    contextUsed: null,
    messages,
    lastAt,
    lastAgentMessage,
  };
}

module.exports = { read, forWorkdir, rollouts, metaOf, SESSIONS };
