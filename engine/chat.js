'use strict';

/**
 * Talking to ONE agent, about ONE project.
 *
 * The gap this closes, in the words of the person who hit it: a card said
 * "Needs you — the pane is showing a question", and there was nowhere to see
 * the question or answer it. The board could observe an agent and could not
 * reach one.
 *
 * ⚠️ WHAT THIS MODULE MAY CLAIM, and the fourth row is the one that is never
 * ours. `engine/projects.js` has the same table for membership; this is the
 * same discipline pointed at a keystroke:
 *
 * | Claim | | |
 * |---|---|---|
 * | we put this text into that pane | ✅ | tmux took it and said so |
 * | this is what that pane shows right now | ✅ | we captured it a moment ago |
 * | we could not deliver, and why | ✅ | the failure is ours to report |
 * | the agent **read** it, received it, or will act on it | ❌ | never |
 *
 * The fourth is false in three separate ways, which is why it gets a paragraph
 * rather than a footnote. `send-keys` reaches a terminal, not a program's
 * understanding: the composer may be mid-render, the agent may be busy for
 * minutes, and a Claude that is thinking does not consume its input box the
 * moment text lands in it. So every sentence this module produces is about the
 * KEYSTROKE, and the UI that renders it says "placed into casey's session just
 * now", never "casey received it".
 *
 * ⚠️ AND THE PANE IS SHOWN, NEVER PARSED. There is no bubble-maker here. A
 * parser that guesses which lines of a TUI are "the agent talking" puts words
 * in the agent's mouth the first time it guesses wrong, and it will guess wrong
 * — Claude Code redraws, wraps, animates, and prints tool output that looks
 * exactly like prose. So the agent's side of this screen is a VIEWPORT: the
 * literal tail of what the terminal is displaying, labelled as that.
 *
 * ⚠️ WHAT WAS MEASURED BEFORE THIS WAS WRITTEN (2026-08-13, tmux 3.6a, this
 * machine — the same discipline connect.js's fixtures are held to):
 *
 *   - `send-keys -t '=<session>:<window>.<pane>' -l -- <text>` places the text
 *     literally, INCLUDING a leading `-` (probed with `-echo dashy-probe-text`,
 *     which landed verbatim in the composer). `-l` sends literal characters
 *     rather than key names, and `--` ends option parsing.
 *   - A second, separate `send-keys -t <same> Enter` submits it. The two are
 *     never one call: `-l` would type the word "Enter".
 *   - `capture-pane -p -J -t '=<session>:<window>.<pane>'` reads that pane back.
 *   - The `=` exact-match prefix DOES defeat prefix matching on a pane target:
 *     with the session killed and a `kchatprobe2` still alive, the same command
 *     answered `can't find session: kchatprobe` rather than landing on the
 *     lookalike. That refusal is the whole reason every target here is built
 *     with `=`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const store = require('./store');
const status = require('./status');

/**
 * Where a send got to. Two values and no third, because unlike a status read
 * there is no "we did not look": a send either happened or it did not, and the
 * reason travels with the refusal.
 */
const DELIVERY = {
  PLACED: 'placed',
  COULD_NOT: 'could_not',
};

/**
 * One message, one line.
 *
 * ⚠️ NOT a style preference. A newline inside `send-keys -l` reaches the
 * composer as a submit, so a two-line message is delivered as two messages and
 * the second half arrives as its own instruction — with the agent already
 * acting on the first half. Runs of whitespace are collapsed rather than
 * refused, so the person's paragraph arrives as a paragraph-shaped sentence
 * rather than an error they have to work around.
 */
const MAX_TEXT = 2000;

/**
 * Ceiling on how many of the person's messages one thread keeps.
 *
 * ⚠️ REFUSES rather than rotates. Dropping the oldest entries would delete
 * something the person wrote, and "nothing of the user's is ever deleted" is
 * this codebase's rule on every other write path. So a full thread stops
 * RECORDING and says so, while delivery is unaffected — the two are separate
 * acts and separate sentences (see `appendMessage`).
 */
const MAX_MESSAGES = 1000;

/** How much of the pane the viewport shows. */
const VIEWPORT_LINES = 60;

const DIR = () => path.join(store.ROOT, 'chats');

/* ── the tmux seam ───────────────────────────────────────────────────────── */

/**
 * ⚠️ THE SAME BIDIRECTIONAL INTERLOCK AS `engine/create.js` AND
 * `engine/connect.js`, and it matters more here than in either: this is the
 * only module in the product that types into a RUNNING AGENT's session. A test
 * that reached the real tmux would put its fixture text into somebody's live
 * conversation. `setRunner(null)` re-arms dry-run, so no ordering of teardowns
 * leaves a suite able to send.
 */
let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

function setRunner(fn) {
  runner = typeof fn === 'function' ? fn : null;
  if (!runner) DRY_RUN = true;
}

function setDryRun(on) {
  if (!on && !runner) {
    throw new Error('refusing to leave dry-run with no injected runner: this would type into real agents');
  }
  DRY_RUN = Boolean(on);
}

function resetForTests() {
  runner = null;
  DRY_RUN = true;
}

/**
 * ⚠️ Bare `tmux`, resolved on PATH, because that is what the running product
 * already depends on: `engine/status.js` reads every pane on the board with a
 * bare `tmux`, so a machine where this module could not find tmux is a machine
 * with no board at all. The env override exists for the same reason connect's
 * does — a sandboxed run must be able to point somewhere harmless.
 */
function tmuxBin() {
  return process.env.AGENT_WORKFORCE_TMUX_BIN || 'tmux';
}

/**
 * One tmux call. Returns the same `{ran, status, out, err}` shape
 * `status.shDetail` produces, so a caller can tell "we could not run tmux at
 * all" from "tmux ran and refused" — which are two different sentences to the
 * person, and the second one is the one that names the pane.
 */
function tmux(args) {
  if (runner) return runner(args);
  if (DRY_RUN) {
    return { ran: false, status: null, out: '', err: 'this copy of Kosmos is running without permission to type into agents' };
  }
  try {
    return { ran: true, status: 0, out: execFileSync(tmuxBin(), args, { encoding: 'utf8', timeout: 5000 }), err: '' };
  } catch (e) {
    const code = e && typeof e.status === 'number' ? e.status : null;
    return {
      ran: code !== null,
      status: code,
      out: (e && e.stdout && e.stdout.toString()) || '',
      err: (e && e.stderr && e.stderr.toString()) || '',
    };
  }
}

/* ── what may be sent ────────────────────────────────────────────────────── */

/**
 * The text we will actually type, from whatever was typed at us.
 *
 * ⚠️ ONE cleaner, EXPORTED, and validated in the same place it is applied.
 * `create.js` has the identical note above `cleanName` because the two-function
 * version there agreed with itself only by coincidence, and the caller that
 * validated a raw value then used it unchanged carried a leading space into a
 * directory name. Here the equivalent slip types something other than what was
 * checked into somebody's agent.
 */
function cleanMessage(raw) {
  // Any run of whitespace — newlines, tabs, the lot — becomes one space. See
  // MAX_TEXT for why a newline cannot survive to the pane.
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

/**
 * Why this message cannot be sent, or null.
 *
 * ⚠️ CONTROL CHARACTERS ARE REFUSED, NOT STRIPPED, and ESC is the reason. `-l`
 * sends characters literally, so an ESC inside the text is the Escape KEY
 * arriving in a TUI: in Claude Code that cancels what is on screen. A message
 * that quietly cancels the agent's current prompt and then types the rest of
 * itself is not the message anybody wrote. The whitespace collapse above has
 * already dealt with the ordinary ones (tab, newline, carriage return), so
 * anything left in this range got there on purpose or by paste accident, and
 * refusing names it.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function messageProblem(raw) {
  const text = cleanMessage(raw);
  if (!text) return 'write something to send';
  if (text.length > MAX_TEXT) return `keep it to ${MAX_TEXT} characters or fewer`;
  if (CONTROL.test(text)) return 'that message has characters we will not type into a terminal';
  return null;
}

/* ── who may be sent to ──────────────────────────────────────────────────── */

/**
 * The agent card this name is allowed to address, or a refusal.
 *
 * ⚠️ EXACT MATCH TO PERMIT, LOOSE TO NOTICE — the rule this repo has now fixed
 * three separate times (the profile route, then `projects.tellAgent`, then
 * `remove`). `store.safeKey` STRIPS rather than rejects, so any spelling that
 * sanitises to a live agent would otherwise address it: `An.gel` reaching
 * `angel`'s session is the same hole, one keystroke more dangerous, because
 * here it types into a conversation rather than editing a file.
 *
 * ⚠️ AND `isNamedOurs`, not merely a name on the roster. `list-panes -a`
 * returns every pane on the machine, so a stranger's `tmux new -s casey` is on
 * the roster under that name. `remove` gates its destructive action on exactly
 * this flag and `tellAgent` gates the instruction write on it; typing into a
 * pane is at least as strong an act as either.
 *
 * ⚠️ AND `isAgentPane`, which is a DIFFERENT question and the one that stops
 * the worst outcome here. It is false when no Claude is running in the pane —
 * i.e. when the pane is a SHELL — and text sent to a shell is EXECUTED rather
 * than read. It is also false while the pane is scrolled back in copy-mode,
 * where keystrokes go to copy-mode bindings and the message silently never
 * arrives while we report that it did.
 *
 * A roster of `null` means the caller could not look, which is not permission.
 */
function addressable(sessionName, roster) {
  const key = String(sessionName == null ? '' : sessionName);
  if (!key) return { ok: false, because: 'we do not have an agent to send this to' };
  if (!Array.isArray(roster)) {
    return { ok: false, because: 'we could not check which agents are running, so we did not type anything anywhere' };
  }
  const card = roster.find((a) => a && a.sessionName === key) || null;
  if (!card) {
    return { ok: false, because: 'we cannot see an agent by exactly this name on this computer right now' };
  }
  if (card.isNamedOurs !== true) {
    return { ok: false, because: 'something is running under this name, but we cannot tell that it is this agent, so we did not type into it' };
  }
  if (!card.target) {
    return { ok: false, because: 'we do not know which pane this agent is in' };
  }
  if (card.isAgentPane !== true) {
    // Two reasons, and they are worth telling apart on screen: a pane with no
    // Claude in it would EXECUTE what we typed, and a pane scrolled back in
    // copy-mode swallows it.
    return {
      ok: false,
      because: card.isAgentSession === true
        ? 'its window is scrolled back right now, so anything we typed would go to the scrollback instead of to the agent'
        : 'there is no Claude running in its window right now, so anything we typed would be run as a command instead of read',
    };
  }
  return { ok: true, card };
}

/**
 * The exact tmux pane, pinned.
 *
 * ⚠️ `=` on every target, no exceptions — the rule `engine/connect.js`,
 * `engine/remove.js` and the README already treat as mandatory. Without it tmux
 * resolves a target by PREFIX when no exact session exists, so a send aimed at
 * a `casey` that has just died lands in a `casey2` that has not. Measured on
 * 3.6a: with the session gone and a lookalike alive, the pinned form answers
 * "can't find session" instead of typing into the neighbour.
 */
function paneTarget(card) {
  return '=' + card.target;
}

/* ── the send ────────────────────────────────────────────────────────────── */

/**
 * Put one message into one agent's session.
 *
 * ⚠️ NEVER THROWS, and never claims more than a keystroke. The return is a
 * verdict a screen can render as-is: `placed` means tmux accepted both sends,
 * `could_not` carries the reason. Neither says the agent knows anything.
 */
function deliver(sessionName, raw, roster) {
  const at = new Date().toISOString();
  const problem = messageProblem(raw);
  if (problem) return { state: DELIVERY.COULD_NOT, because: problem, at };

  const allowed = addressable(sessionName, roster);
  if (!allowed.ok) return { state: DELIVERY.COULD_NOT, because: allowed.because, at };

  const text = cleanMessage(raw);
  const target = paneTarget(allowed.card);

  // ⚠️ TWO CALLS, in this order, never one. `-l` types characters literally, so
  // folding Enter into the same call would type the five letters E-n-t-e-r.
  // connect.js sends a sign-in code exactly this way for exactly this reason.
  const typed = tmux(['send-keys', '-t', target, '-l', '--', text]);
  if (!typed.ran || typed.status !== 0) {
    return {
      state: DELIVERY.COULD_NOT,
      because: refusalReason(typed, 'we could not type it into its window'),
      at,
    };
  }
  const entered = tmux(['send-keys', '-t', target, 'Enter']);
  if (!entered.ran || entered.status !== 0) {
    /**
     * ⚠️ A DISTINCT, WORSE STATE, and it gets its own sentence. The text is
     * sitting in the agent's composer unsent — so "we could not deliver it" is
     * true but incomplete, and the person needs to know something of theirs is
     * on that screen. Collapsing this into the generic failure would leave them
     * to discover a half-typed message later and wonder who wrote it.
     */
    return {
      state: DELIVERY.COULD_NOT,
      because: refusalReason(entered, 'it went into its window but we could not press Enter, so it is sitting there unsent'),
      at,
    };
  }
  return { state: DELIVERY.PLACED, because: null, at };
}

/**
 * What to say about a tmux call that did not work.
 *
 * "We could not run tmux" and "tmux ran and refused" are different facts, and
 * the second one usually names the pane, which is the half a person can act on.
 */
function refusalReason(got, fallback) {
  if (!got || !got.ran) {
    return (got && got.err) ? String(got.err).trim().split('\n')[0] : 'we could not reach tmux on this computer';
  }
  const said = String((got && got.err) || '').trim().split('\n')[0];
  return said ? `${fallback} (${said})` : fallback;
}

/* ── the agent's side ────────────────────────────────────────────────────── */

/**
 * What this agent's screen is showing, right now.
 *
 * ⚠️ THE LABEL IS PART OF THE CONTRACT. This is the terminal's pixels as text.
 * It is not a transcript, it is not "what the agent said", and it does not
 * belong to the person's thread — it is live-only and never stored (see
 * `appendMessage`, which keeps only what is ours to keep).
 *
 * ⚠️ Gated on `isNamedOurs` like every other name-keyed read in this codebase.
 * A pane merely sharing the name is somebody else's screen, and putting it
 * under this agent's heading would be the borrowed-name defect wearing a chat
 * window.
 */
function viewport(sessionName, roster, lines) {
  const at = new Date().toISOString();
  const key = String(sessionName == null ? '' : sessionName);
  if (!Array.isArray(roster)) {
    return { text: null, at, because: 'we could not check which agents are running, so we cannot show you its screen' };
  }
  const card = roster.find((a) => a && a.sessionName === key) || null;
  if (!card) {
    return { text: null, at, because: 'we cannot see an agent by exactly this name on this computer right now' };
  }
  if (card.isNamedOurs !== true) {
    return { text: null, at, because: 'something is running under this name, but we cannot tell that it is this agent, so we are not showing you its screen' };
  }
  if (!card.target) {
    return { text: null, at, because: 'we do not know which pane this agent is in' };
  }
  const want = Number.isInteger(lines) && lines > 0 && lines <= 400 ? lines : VIEWPORT_LINES;
  const got = tmux(['capture-pane', '-p', '-J', '-t', paneTarget(card), '-S', `-${want}`]);
  if (!got.ran || got.status !== 0) {
    return { text: null, at, because: refusalReason(got, 'we could not read its window just now') };
  }
  // ⚠️ Trailing blank lines are trimmed and NOTHING ELSE IS. tmux pads a
  // capture to the pane height, so an untrimmed viewport is mostly empty space
  // and the newest line sits off the top of a scrolled box. Trimming the ENDS
  // is presentation; touching the middle would be parsing, which this module
  // does not do.
  return { text: String(got.out || '').replace(/\s+$/, ''), at, because: null };
}

/**
 * The part of the screen that made the board say "Needs you".
 *
 * ⚠️ ONE derivation, shared. The markers come from `engine/status.js`, which is
 * where the NEEDS_YOU verdict is made — a private copy here would be a second
 * answer to one question, this codebase's worst habit, and it would drift the
 * first time a marker is added there. So this function cannot disagree with the
 * card that sent the person here.
 *
 * ⚠️ AND IT IS STILL NOT A PARSER. It returns a SLICE of the same pane text,
 * from a few lines above the matching line to the end. It does not extract "the
 * question", name the options, or reword anything: the person reads the
 * terminal, we only scroll it to the right place.
 */
function questionIn(text) {
  const whole = String(text == null ? '' : text);
  if (!whole.trim()) return null;
  const lines = whole.split('\n');
  // The LAST match, not the first: a pane accumulates, and an older question
  // that has already been answered may still be on screen above the live one.
  let at = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (status.NEEDS_YOU_MARKERS.some((re) => re.test(lines[i]))) at = i;
  }
  if (at < 0) return null;
  // A few lines of run-up, because a Claude permission prompt states what it is
  // asking about above the line that matches.
  const from = Math.max(0, at - 6);
  return { text: lines.slice(from).join('\n').replace(/\s+$/, ''), line: at };
}

/* ── what is ours to keep ────────────────────────────────────────────────── */

/**
 * ⚠️ A project id is a path segment here, so it is checked rather than trusted.
 * `projects.idFor` only ever produces `[a-z0-9_-]`, but this module is reached
 * from a URL and "the producer is careful" is not a property of the input a
 * route receives. `..` is the case that matters and this refuses it outright
 * rather than stripping it — a stripped id silently becomes a DIFFERENT
 * thread's file, which is worse than an error.
 */
const PROJECT_ID = /^[a-z0-9_-]{1,80}$/;

/**
 * ⚠️ The agent name must ALREADY be its own key. `store.safeKey` strips, so
 * `worker.2` and `worker2` collapse to one file — `engine/commitments.js`
 * guards the identical hazard the identical way, and for a thread a collision
 * would show one person's messages under another agent's name.
 */
function threadFile(projectId, agent) {
  const id = String(projectId == null ? '' : projectId);
  const name = String(agent == null ? '' : agent);
  if (!PROJECT_ID.test(id)) throw badRequest('that is not a project we can read');
  let key;
  try { key = store.safeKey(name); } catch { key = null; }
  if (!key || key !== name) throw badRequest('that is not an agent name we can keep a thread under');
  return path.join(DIR(), `${id}.${key}.json`);
}

function badRequest(message) {
  const err = new Error(message);
  err.code = 'BAD_THREAD';
  return err;
}

/**
 * The person's side of one thread.
 *
 * ⚠️ AN ABSENT FILE IS AN EMPTY THREAD; AN UNREADABLE ONE IS AN ERROR. Those
 * are different facts and `engine/projects.js` learned the difference the hard
 * way — a bare catch there rendered "No projects yet" over a file nobody could
 * read. Nothing here may tell somebody they have said nothing when we simply
 * could not look.
 */
function readThread(projectId, agent) {
  const file = threadFile(projectId, agent);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { project: String(projectId), agent: String(agent), messages: [] };
    const unreadable = new Error('we cannot read this conversation on this computer right now');
    unreadable.code = 'UNREADABLE';
    throw unreadable;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const damaged = new Error('this conversation is there but we cannot make sense of it');
    damaged.code = 'UNREADABLE';
    throw damaged;
  }
  if (!parsed || !Array.isArray(parsed.messages)) {
    const damaged = new Error('this conversation is there but we cannot make sense of it');
    damaged.code = 'UNREADABLE';
    throw damaged;
  }
  /**
   * ⚠️ The record has to say whose it is, and it is checked on the way out.
   * `commitments.read` refuses a record whose stored name does not match for
   * the same reason: a file that ends up under the wrong key by any route at
   * all must not be rendered as this agent's conversation.
   */
  if (parsed.agent !== String(agent)) {
    const wrong = new Error('this conversation is filed under a different agent');
    wrong.code = 'UNREADABLE';
    throw wrong;
  }
  return { project: String(projectId), agent: String(agent), messages: parsed.messages };
}

/**
 * Add one of the person's messages, with the verdict on delivering it.
 *
 * ⚠️ RECORDING AND DELIVERING ARE TWO ACTS AND TWO SENTENCES. This is called
 * AFTER the send, with whatever the send answered, so a failed delivery is
 * still written down: "I asked casey this and it did not get there" is a thing
 * the person needs to be able to see later, and a thread that only remembers
 * the successes is a thread that quietly rewrites history.
 *
 * ⚠️ AND IT NEVER THROWS ON A FULL OR UNWRITABLE STORE. It answers
 * `{recorded: false, because}` so the route can report the delivery and the
 * recording separately. A message that went through and could not be written
 * down must not come back looking like a message that was not sent.
 */
function appendMessage(projectId, agent, entry) {
  let existing;
  try {
    existing = readThread(projectId, agent);
  } catch (err) {
    return { recorded: false, because: String((err && err.message) || 'we could not read this conversation to add to it') };
  }
  if (existing.messages.length >= MAX_MESSAGES) {
    // See MAX_MESSAGES: refusing keeps every word the person wrote. Rotating
    // would delete the oldest of them to make room, which nothing else in this
    // product does to anybody's data.
    return {
      recorded: false,
      because: `this conversation has reached the ${MAX_MESSAGES} messages Kosmos keeps, so we did not add to it`,
    };
  }
  const record = {
    project: String(projectId),
    agent: String(agent),
    messages: [...existing.messages, {
      at: (entry && entry.at) || new Date().toISOString(),
      text: cleanMessage(entry && entry.text),
      delivery: {
        state: (entry && entry.delivery && entry.delivery.state) || DELIVERY.COULD_NOT,
        because: (entry && entry.delivery && entry.delivery.because) || null,
      },
    }],
  };
  try {
    const file = threadFile(projectId, agent);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename, like every other record in this store: an interrupted
    // write must not leave a half-written file that parses as no messages and
    // silently loses the lot. Per-process temp name, so two windows saving at
    // once cannot rename each other's half-written file into place.
    const tmp = `${file}.${process.pid}.new`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    return { recorded: false, because: String((err && err.message) || 'we could not write this conversation down') };
  }
  return { recorded: true, because: null, messages: record.messages };
}

/* ── who answers ─────────────────────────────────────────────────────────── */

/**
 * Which agent a project's thread opens on.
 *
 * ⚠️ ONE agent answers, and this is the rule that decides which. The screen
 * this replaces said the room was waiting on exactly this question ("when five
 * agents are on a project, who answers"), and the settled answer is: every
 * message is addressed to ONE agent, chosen here, changeable by the person, and
 * the others are visible and silent. Everything answering at once and nothing
 * answering are the same bug.
 *
 * The manager goes first because that is what a manager is for; with no
 * manager, the first agent on the project. Pure, so the rule is testable
 * without a fleet.
 */
function defaultAgentFor(members) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  if (!list.length) return null;
  const manager = list.find((m) => looksLikeManager(m.role));
  return (manager || list[0]).sessionName;
}

/**
 * ⚠️ Matched on the ROLE TEXT, which is a sentence a person or a role template
 * wrote, not an enum. `engine/roles.js` ships "project manager"; a person may
 * have typed "PM" or "Ops manager" into the role field. So this is a loose
 * match on purpose — being wrong costs a preselected dropdown entry the person
 * can change in one click, which is the cheapest wrong answer in this product.
 */
function looksLikeManager(role) {
  const said = String(role == null ? '' : role).toLowerCase();
  if (!said) return false;
  return /manager|\bpm\b|project lead|\blead\b/.test(said);
}

module.exports = {
  DELIVERY, MAX_TEXT, MAX_MESSAGES, VIEWPORT_LINES,
  cleanMessage, messageProblem, addressable, paneTarget,
  deliver, viewport, questionIn,
  threadFile, readThread, appendMessage,
  defaultAgentFor, looksLikeManager,
  setRunner, setDryRun, resetForTests,
};
