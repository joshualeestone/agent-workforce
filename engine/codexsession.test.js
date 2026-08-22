'use strict';

/**
 * Reading a Codex session (#244).
 *
 * 🔑 THE FIXTURE IS THE REAL FORMAT, captured from an actual Codex 0.149.0
 * session on 2026-08-22, not invented from documentation -- which does not
 * describe this file at all. Every field asserted below was observed.
 *
 * ⚠️ A SANDBOXED CODEX HOME, set before the module loads. The real one holds
 * whatever the operator has said to Codex, and a test that walked it would be
 * reading somebody's conversations to check a path join.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-codex-'));
process.env.AGENT_WORKFORCE_CODEX_HOME = nodePath.join(SANDBOX, '.codex');
const codex = require('./codexsession');

const WORKDIR = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-codex-wd-'));

function writeRollout(name, cwd, rows) {
  const dir = nodePath.join(SANDBOX, '.codex', 'sessions', '2026', '08', '21');
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, name);
  const meta = {
    timestamp: '2026-08-22T04:47:23.150Z', ordinal: 0, type: 'session_meta',
    payload: {
      session_id: '01a027cb-800c-7963-b6e6-7fe4821e3ee5',
      cwd, originator: 'codex_exec', cli_version: '0.149.0',
      source: 'exec', model_provider: 'openai',
    },
  };
  fs.writeFileSync(file, [meta].concat(rows).map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

const TASK_STARTED = {
  timestamp: '2026-08-22T04:47:24.000Z', ordinal: 1, type: 'event_msg',
  payload: { type: 'task_started', turn_id: 't1', started_at: 1, model_context_window: 272000 },
};
const A_MESSAGE = { timestamp: '2026-08-22T04:47:25.000Z', ordinal: 2, type: 'response_item', payload: {} };
const TASK_DONE = {
  timestamp: '2026-08-22T04:47:40.000Z', ordinal: 3, type: 'event_msg',
  payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'kosmos-probe-ok', duration_ms: 17129 },
};

test('a session is found by the folder it was launched in', () => {
  writeRollout('rollout-2026-08-21T23-47-23-aaa.jsonl', WORKDIR, [TASK_STARTED, A_MESSAGE, TASK_DONE]);
  const r = codex.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  /* 🔑 The launch folder is the one fact Kosmos CONTROLS -- it chooses the
     directory it starts an agent in. A name, a title or a pane id is a
     coincidence the agent could change. Same key the Claude reader uses. */
  assert.equal(r.provider, 'openai');
  assert.equal(r.cliVersion, '0.149.0');
  assert.equal(r.lastAgentMessage, 'kosmos-probe-ok');
});

test('the context LIMIT is read from the tool rather than assumed', () => {
  writeRollout('rollout-2026-08-21T23-47-23-bbb.jsonl', WORKDIR, [TASK_STARTED, A_MESSAGE]);
  const r = codex.read(WORKDIR);
  /**
   * ⭐ THE INCUMBENT IS THE ONE THAT GUESSES. status.js carries
   * `ASSUMED_LIMIT` for Claude and the card says so out loud: "against a limit
   * we have assumed rather than watched". Codex STATES its window on
   * task_started, so this provider's ring rests on a measured denominator.
   * 🛑 Worth pinning precisely because the temptation runs the other way: a
   * builder making the two look alike would port the assumption across and
   * throw away the better number.
   */
  assert.equal(r.contextWindow, 272000);
});

test('the USED half is null, and null is the answer rather than a placeholder', () => {
  writeRollout('rollout-2026-08-21T23-47-23-ccc.jsonl', WORKDIR, [TASK_STARTED, A_MESSAGE]);
  const r = codex.read(WORKDIR);
  /* 🛑 I have not seen a successful Codex run report token usage, and inventing
     a field name from a failed one is how a number nobody computed reaches a
     card. Null renders as "we could not tell", which is this product's honest
     answer. One real completed session decides it, and THIS test is what has to
     change when somebody has one. */
  assert.equal(r.contextUsed, null);
});

test('a folder Codex has never run in is NOT an error', () => {
  const never = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-codex-never-'));
  const r = codex.read(never);
  assert.equal(r.found, false);
  /* ⚠️ The distinction the Claude reader learned the hard way: "has not started
     yet" and "something is wrong" are different facts, and a brand-new agent
     sitting at its prompt must not be told its session could not be read. */
  assert.equal(r.because, require('./status').NO_READING.NO_TRANSCRIPT,
    'the Codex path invented its own words for a condition the Claude path already names');
});

test('the newest session wins when a folder has several', () => {
  writeRollout('rollout-2026-08-21T10-00-00-old.jsonl', WORKDIR, [TASK_STARTED]);
  writeRollout('rollout-2026-08-21T23-59-59-new.jsonl', WORKDIR, [
    TASK_STARTED, { ...TASK_DONE, payload: { ...TASK_DONE.payload, last_agent_message: 'the newer one' } },
  ]);
  assert.equal(codex.read(WORKDIR).lastAgentMessage, 'the newer one');
});

test('a symlinked folder still matches, because /tmp is one on macOS', () => {
  /* 🛑 MEASURED, NOT ANTICIPATED: every session in this suite is under /tmp,
     which is a symlink to /private/tmp, so a string compare of the two paths
     misses every one of them. The reader resolves both sides.
     ⚠️ ITS OWN FOLDER, AND THAT IS THE WHOLE TEST. The first version reused
     WORKDIR, where earlier tests had already written rollouts carrying the
     LITERAL path -- so deleting the realpath resolution changed nothing and
     this passed green. The fixture was supplying the premise: `read` found a
     literally-matching session and never had to resolve anything. A fresh
     folder whose ONLY session records the resolved path is the only shape
     that can fail. */
  const own = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-codex-sym-'));
  const real = fs.realpathSync(own);
  assert.notEqual(real, own, 'the premise: this platform symlinks the temp dir');
  writeRollout('rollout-2026-08-21T23-00-00-sym.jsonl', real, [TASK_STARTED]);
  assert.equal(codex.read(own).found, true, 'a symlinked launch folder was not recognised');
});

test('a corrupt line does not lose the session', () => {
  const dir = nodePath.join(SANDBOX, '.codex', 'sessions', '2026', '08', '21');
  const file = writeRollout('rollout-2026-08-21T23-30-00-bad.jsonl', WORKDIR, [TASK_STARTED, A_MESSAGE]);
  fs.appendFileSync(file, 'this is not json\n');
  void dir;
  const r = codex.read(WORKDIR);
  assert.equal(r.found, true, 'one unparseable line threw the whole session away');
  assert.equal(r.contextWindow, 272000);
});

test('a file that is not a session_meta at all is skipped, not guessed at', () => {
  const dir = nodePath.join(SANDBOX, '.codex', 'sessions', '2026', '08', '21');
  fs.writeFileSync(nodePath.join(dir, 'rollout-2026-08-21T23-58-00-notmeta.jsonl'),
    JSON.stringify({ type: 'event_msg', payload: {} }) + '\n');
  // The newest-first scan meets this one first and must not crash or claim it.
  assert.equal(codex.read(WORKDIR).found, true);
});

test('both providers say the SAME sentence about the same condition', () => {
  /**
   * 🔑 A PERSON MUST NOT BE ABLE TO TELL WHICH PROVIDER AN AGENT RUNS ON FROM
   * AN ERROR MESSAGE. The reasons are about the AGENT, not the runtime, and the
   * moment the two paths phrase one condition differently the board speaks two
   * dialects about one fact. (Mona Lisa's principle for the whole OpenAI phase,
   * not a copy nit.)
   *
   * ⚠️ ASSERTED AS A SHARED SOURCE rather than by comparing two string
   * literals, because two literals that happen to match today drift the first
   * time somebody edits one of them -- which is exactly the failure this is
   * for.
   */
  const status = require('./status');
  const src = fs.readFileSync(nodePath.join(__dirname, 'codexsession.js'), 'utf8');
  assert.ok(src.includes("require('./status')"), 'the Codex path stopped sharing the reasons');
  for (const key of Object.keys(status.NO_READING)) {
    assert.ok(src.includes('NO_READING.' + key), 'NO_READING.' + key + ' is no longer used by the Codex path');
  }
  /* 🛑 AND NO PRODUCT NAME IN A REASON. Somebody chose a provider on one screen
     an hour ago; they did not sign up to learn what Codex calls its files. */
  const reasons = [...src.matchAll(/because: '([^']+)'/g)].map((m) => m[1]);
  for (const r of reasons) {
    assert.ok(!/codex|claude|openai|anthropic/i.test(r),
      'a reason names the runtime: ' + JSON.stringify(r));
  }
});
