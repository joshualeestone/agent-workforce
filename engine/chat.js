'use strict';

/**
 * Talking to ONE agent, about ONE project.
 *
 * The gap this closes: a card could say an agent is asking you something, and
 * there was nowhere to see the question or answer it. The board could observe
 * an agent and could not reach one.
 *
 * ⚠️ This paragraph used to be framed as a QUOTATION of the person who reported
 * the gap, around a card sentence the copy sweep then rewrote. An edited
 * quotation is not a quotation, so the frame went rather than the words.
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
 * | we typed it and cannot tell whether it landed | ✅ | our own blind spot, stated |
 * | what the pane was doing when we typed | ✅ | the board's own verdict, at that moment |
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
 * Where a send got to. THREE values, and the third is the one that matters.
 *
 * ⚠️ AN EARLIER VERSION OF THIS BLOCK HAD TWO, and said so proudly: "unlike a
 * status read there is no 'we did not look' — a send either happened or it did
 * not". That is wrong about the only part of this module that touches another
 * program. We drive tmux, and tmux can take a keystroke and then fail to tell
 * us so: a timed-out call may have delivered, and an Enter we could not send
 * leaves the person's words sitting in a live composer.
 *
 * With two states those cases render as failure — and the person does the
 * obvious thing, which is send it again. Now the agent has the message twice,
 * and on the screen this feature exists for (a permission prompt) the second
 * copy answers a question the first one already answered. **The verdict has to
 * make re-sending feel unnecessary exactly when it is**, which is a thing only
 * a third state can say.
 *
 * The line between them is not "how bad it was". It is one checkable fact:
 *
 *   COULD_NOT    — NOTHING of the person's text reached the pane. Re-sending is
 *                  safe, and is what they should do.
 *   UNCONFIRMED  — something may have. Re-sending may duplicate it. Look at the
 *                  screen, which is on this very page, before deciding.
 *   PLACED       — tmux took the text and the Enter, and said so.
 *
 * Every refusal that happens BEFORE the first keystroke (a bad message, a pane
 * we will not type into, a roster we could not read) is `COULD_NOT` by that
 * rule, and the tests assert the invariant rather than the enumeration.
 */
const DELIVERY = {
  PLACED: 'placed',
  UNCONFIRMED: 'unconfirmed',
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
 * One tmux call. Returns the `{ran, status, out, err}` shape `status.shDetail`
 * produces, plus one field of its own — see `spawnFailed`.
 *
 * ⚠️ `spawnFailed` IS THE THIRD OUTCOME, and it exists because two very
 * different things both arrive as `ran: false`:
 *
 *   - tmux could not be EXECUTED (it is not on PATH, it is not executable). The
 *     process never started, so nothing was typed anywhere. That is a definite
 *     answer.
 *   - tmux was executed and did not come back inside the timeout. It may have
 *     delivered the keystroke and been slow to exit. That is NOT a definite
 *     answer, and reporting it as a failure is what makes somebody re-send a
 *     message that already landed.
 *
 * Collapsing the two is exactly the "cannot tell a failure from a thing I could
 * not see" shape this codebase is built against, and here it costs the person a
 * duplicate message in a live agent's composer.
 */
function tmux(args) {
  if (runner) return runner(args);
  if (DRY_RUN) {
    return {
      ran: false,
      spawnFailed: true, // nothing was executed, so nothing was typed
      status: null,
      out: '',
      // Neutral wording on purpose (round 27): viewport() funnels this
      // through refusalReason too, and "without permission to TYPE" as the
      // explanation of a failed READ was a wrong sentence. Fixture-facing
      // only, but fixtures are where sentences get read most carefully.
      err: 'this copy of Kosmos is running without permission to touch agents',
    };
  }
  try {
    return { ran: true, spawnFailed: false, status: 0, out: execFileSync(tmuxBin(), args, { encoding: 'utf8', timeout: 5000 }), err: '' };
  } catch (e) {
    const code = e && typeof e.status === 'number' ? e.status : null;
    return {
      ran: code !== null,
      spawnFailed: code === null && spawnFailure(e),
      status: code,
      out: (e && e.stdout && e.stdout.toString()) || '',
      err: (e && e.stderr && e.stderr.toString()) || '',
    };
  }
}

/**
 * Did this `execFileSync` failure mean the process NEVER STARTED?
 *
 * ⚠️ PURE AND EXPORTED, so it can be tested against errors a real
 * `execFileSync` really threw rather than against a fixture of what I remember
 * it throwing. The whole three-state distinction rests on this one boolean: get
 * it wrong towards `true` and a slow tmux is reported as "your message did not
 * arrive", which is the duplicate-send this feature is guarding against.
 *
 * ⚠️ MEASURED, on this machine, Node v25.6.1 — because the exit status alone
 * cannot answer it. Both of the first two rows carry `status: null`:
 *
 *   ENOENT   (no such binary)   code ENOENT     status null  signal null
 *   ETIMEDOUT (killed at the timeout)           status null  signal SIGTERM
 *   a non-zero exit             code undefined  status 3     signal null
 *   EACCES   (not executable)   code EACCES     status null  signal null
 *
 * So the discriminator is the SIGNAL: a child killed by one was running. Note
 * `killed` was `undefined` in every row above, so a check written on that
 * property alone would have called a timeout a spawn failure — which is the
 * defect this function exists to prevent, and it is why the signal is read
 * first.
 */
function spawnFailure(err) {
  if (!err) return true;
  return !(err.signal || err.killed);
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
  // ⚠️ A non-string is refused, not coerced. cleanMessage's String() would
  // turn {"text": {}} into the literal "[object Object]" and this module's
  // whole contract is that what was CHECKED is what gets TYPED into a
  // person's agent -- a coerced artifact was never checked by anyone.
  if (raw != null && typeof raw !== 'string') return 'that message is not text';
  const text = cleanMessage(raw);
  if (!text) return 'write something to send';
  if (text.length > MAX_TEXT) return `keep it to ${MAX_TEXT} characters or fewer`;
  if (CONTROL.test(text)) return 'that message has characters we will not type into a terminal';
  return null;
}

/**
 * The person's text, as it has to be spelled ON THE WIRE to arrive intact.
 *
 * ⚠️ MEASURED, on this machine, tmux 3.6a, against a scratch session created
 * and killed for the probe — not read off the parser and not assumed. tmux
 * splits its argv into a COMMAND LIST before running anything, and a `;` at the
 * very end of the last element is that split's separator rather than a
 * character. What the pane really showed:
 *
 *   typed `const total = 0;`          → pane `const total = 0`   (semicolon eaten)
 *   typed `;`                         → pane ``                  (NOTHING arrives)
 *   typed `wait;;`                    → pane `wait;`             (exactly one eaten)
 *   typed `const a = 1; const b = 2`  → unchanged  (a middle `;` is safe)
 *   typed `const total = 0; `         → unchanged  (a trailing SPACE saves it)
 *   typed `foo\`                      → unchanged  (a lone trailing backslash is safe)
 *   typed `foo\;`                     → pane `foo;`  (the `\` escapes the `;`: one pair, one semicolon)
 *   typed `foo\\;` (2 backslashes)    → pane `foo\;` (so the ESCAPED form round-trips exactly)
 *
 * The last two rows settle the input class this function's own design lives
 * on (measured 2026-08-14, same scratch-session instrument): a message
 *   ending `\;` wires to `…\\;` and arrives as `…\;`, the person's text
 * exactly. tmux's splitter consumes one backslash to escape the final
 * semicolon and nothing else; it does not treat `\\` as a general escape
 * that would leave a bare separator behind.
 *
 * Two different harms. The first is quiet: the text delivered is not the text
 * we checked, recorded and rendered, and the verdict still says `placed` — the
 * screen shows the person a semicolon their agent never received. The second is
 * not quiet at all: a message of exactly `;` types NOTHING, and the separate
 * Enter still fires, so a bare submit lands in a live composer. On the
 * permission prompt this whole feature exists for, a bare submit takes the
 * highlighted default. We would have reported that as `placed`.
 *
 * Escaping the trailing one as `\;` makes the parser hand it back as a literal.
 * Measured to round-trip all eight cases above, including `wait;;` (sent as
 * `wait;\;`) and a message ending in a backslash, which is untouched.
 *
 * ⚠️ APPLIED AT THE SEND AND NOWHERE ELSE. `cleanMessage` is what gets checked,
 * recorded and shown, and it must stay the person's own text — an escape that
 * leaked into the record would put a backslash in their history and in the
 * thread on screen.
 */
const WIRE_SEMICOLON = String.fromCharCode(92) + ';';

function wireText(text) {
  const said = String(text == null ? '' : text);
  return said.endsWith(';') ? said.slice(0, -1) + WIRE_SEMICOLON : said;
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
    return { ok: false, because: 'we cannot tell where this agent is running' };
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
 * The three fields that can go stale between authorising a send and making it,
 * asked for by NAME from the engine's own column list.
 *
 * ⚠️ Built from `status.PANE_COLUMNS` rather than hand-typed, for the reason
 * `test-support/fleet` builds pane lines the same way: a format string typed
 * out here is a second place that has to be right about what tmux calls these
 * things, and it would go on looking right while asking for the wrong field.
 *
 * ⚠️ `claim` sits in the MIDDLE on purpose. It is empty for every session that
 * does not carry one, and a trailing empty field is indistinguishable from a
 * field that was not emitted at all once the answer is split. `inMode` is
 * always `0` or `1`, so putting it last keeps the shape readable.
 */
const VERIFY_KEYS = ['command', 'claim', 'inMode'];
/* A FUNCTION, not a require-time constant (round 38): `verifyAtSend`'s
   column guard re-reads `status.PANE_COLUMNS` at call time, and a constant
   computed at load can outlive the shape it describes -- the exported copy
   and the guard could disagree about the same columns. Derived on demand,
   the two cannot fork; the export below is a getter for the same reason
   `DRY_RUN`'s is. */
const verifyFormat = () => VERIFY_KEYS
  .map((key) => (status.PANE_COLUMNS.find((c) => c.key === key) || {}).fmt)
  .join('\t');

/**
 * Is this pane STILL one we may type into, right now?
 *
 * Never throws. Answers `{ok}` or `{ok: false, because}`, and every refusal
 * here happens before a single keystroke — so the caller's verdict is
 * `could_not`, which is the one that tells the person re-sending is safe.
 */
function verifyAtSend(card) {
  if (VERIFY_KEYS.some((key) => {
    const col = status.PANE_COLUMNS.find((c) => c.key === key);
    // The fmt too, not only the key (round 28): a column that kept its key
    // and lost its fmt puts the literal string "undefined" into the format,
    // survives the arity check, and refuses every send on the machine with
    // a sentence about the pane changing -- the same silent machine-wide
    // refusal this guard exists to prevent, one field over.
    return !col || typeof col.fmt !== 'string' || !col.fmt;
  })) {
    // A column was renamed in the engine and this would silently ask tmux for
    // an empty string, which reads as "no Claude running" and refuses every
    // send on the machine. Better to say so than to fail closed in silence.
    return { ok: false, because: 'we cannot work out how to check its window before typing, so we did not type anything' };
  }
  const got = tmux(['display-message', '-p', '-t', paneTarget(card), verifyFormat()]);
  if (!got.ran || got.status !== 0) {
    return {
      ok: false,
      because: refusalReason(got, 'we could not check its window just before sending, so we did not type anything'),
    };
  }
  const parts = String(got.out || '').replace(/\n+$/, '').split('\t');
  /**
   * ⚠️ TOO MANY FIELDS IS AS WRONG AS TOO FEW, and only the second half was
   * checked. A short answer was refused while a LONG one was silently accepted
   * and its extras dropped — so if a value ever contained a tab, or a future
   * tmux emitted another field, the fields would shift by one and this would
   * read a claim as a command and a command as a session name, then hand the
   * result to `isAgentPane` with complete confidence. Length is the only signal
   * available that the shape is the shape we asked for, so it is checked
   * exactly, in both directions.
   */
  if (parts.length !== VERIFY_KEYS.length) {
    return {
      ok: false,
      because: 'its window answered in a shape we do not recognise, so we did not type anything',
    };
  }
  const fresh = {};
  VERIFY_KEYS.forEach((key, i) => { fresh[key] = parts[i]; });
  /**
   * ⚠️ The IDENTITY fields come from the card and the LIVE fields from tmux,
   * and that split is deliberate. A session's name cannot change under us
   * without the exact-pinned target failing outright, so re-reading it would
   * add nothing; what changes in the window that matters is what is RUNNING in
   * the pane and whether it is scrolled back.
   */
  const pane = {
    name: card.sessionName,
    session: card.session,
    claim: fresh.claim,
    command: fresh.command,
    inMode: fresh.inMode,
  };
  /**
   * ⚠️ OWNERSHIP IS ASSERTED SEPARATELY, and a test caught me leaving it out.
   *
   * `isAgentPane` is NOT an ownership check: its fleet arm accepts any pane
   * with a live Claude in it, whatever the session is called, because a
   * legitimately non-Discord agent has to be manageable. So a probe answering
   * with somebody ELSE's claim still passed it — while the `claim` field this
   * function goes to the trouble of fetching went unread, which is its own
   * smell.
   *
   * `addressable` gates the send on `isNamedOurs` up front; this is that same
   * gate re-asked against the live values, so the window closes on all three
   * facts rather than two. It is the lesson `status.js` states about itself:
   * publishing a flag and leaving another branch to honour it is not enough.
   */
  if (!status.isNamedOurs(pane)) {
    return {
      ok: false,
      because: 'we could not still tie its window to this agent when we went to type, so we did not type anything',
    };
  }
  if (status.isAgentPane(pane)) return { ok: true };
  // Told apart, because they are different things to be told: one is somebody
  // scrolling, the other is an agent that has stopped since we looked.
  return {
    ok: false,
    because: status.isAgentSession(pane)
      ? 'its window was scrolled back by the time we went to type, so we did not type anything'
      : 'it stopped being an agent’s window between us checking and us typing, so we did not type anything: '
        + 'anything we sent would have been run as a command instead of read',
  };
}

/**
 * What the agent was doing when we typed into it.
 *
 * ⚠️ THIS EXISTS BECAUSE THE NO-QUEUE DESIGN IS HONEST ABOUT THE SEND AND
 * MISLEADING ABOUT THE READ. "Placed into casey's session just now" is exactly
 * true and invites precisely the wrong inference: that casey is now reading it.
 * A Claude that is mid-task does not consume its composer until it finishes, so
 * a message sent to a working agent sits there — possibly for minutes. Without
 * this clause the person waits, sees nothing happen, and concludes the feature
 * is broken.
 *
 * ⚠️ THE STATE IS THE BOARD'S, not a second reading. It comes off the roster
 * card the send was authorised against — the same `classify` verdict the agent's
 * own card shows — so the thread and the card cannot disagree about what an
 * agent was doing. And it is a claim about WHEN THIS WAS SENT, not about now:
 * the roster is one observation, taken at the start of the request, and the
 * wording says so rather than implying a live reading.
 *
 * ⚠️ `unknown` GETS A SENTENCE TOO. It is the state that must never read as
 * fine, and silence here would render identically to an idle agent.
 */
/**
 * @param {string} [outcome] the delivery state this note will be shown beside.
 *   ⚠️ `unconfirmed` DROPS THE SETTLED-FACT CLAUSE. "It was mid-task, so this
 *   sits in its composer until it finishes" is a statement about where the
 *   message IS — and the one verdict that cannot make that statement is the one
 *   that exists precisely because we do not know whether it arrived. The two
 *   were being printed side by side: "we cannot tell you whether it arrived"
 *   and "this sits in its composer", in one sentence. What the agent was DOING
 *   is still true and still useful, so that half stays.
 */
function waitingNote(state, outcome) {
  const unsure = outcome === DELIVERY.UNCONFIRMED;
  // The engine's own constants, not literals: a state renamed in status.js
  // must move these cases with it rather than leaving a switch that
  // silently stops matching (the same rule server.js records for its
  // STATE import).
  switch (state) {
    case status.STATE.WORKING:
      return unsure
        ? 'it was mid-task'
        : 'it was mid-task, so it will not read this until it finishes';
    case status.STATE.NEEDS_YOU:
      // Deliberately weaker than "this answered its question". We observed a
      // question on its screen; what its interface did with the keystroke is
      // not something we watched.
      return 'it was waiting on an answer when this was sent';
    case status.STATE.RATE_LIMITED:
      return unsure
        ? 'it was paused on a usage limit'
        : 'it was paused on a usage limit, so it may not act on this until that clears';
    case status.STATE.IDLE:
      return 'it was sitting at its prompt';
    default:
      return 'we could not tell what it was doing when this was sent';
  }
}

/**
 * Put one message into one agent's session.
 *
 * ⚠️ NEVER THROWS, and never claims more than a keystroke. The return is a
 * verdict a screen can render as-is. See `DELIVERY` for the three states and
 * for the one fact that separates them: whether anything of the person's text
 * could have reached the pane. None of them says the agent knows anything.
 */
function deliver(sessionName, raw, roster) {
  const at = new Date().toISOString();
  const problem = messageProblem(raw);
  if (problem) return { state: DELIVERY.COULD_NOT, because: problem, at, paneState: null, paneNote: null };

  const allowed = addressable(sessionName, roster);
  if (!allowed.ok) {
    return { state: DELIVERY.COULD_NOT, because: allowed.because, at, paneState: null, paneNote: null };
  }

  const text = cleanMessage(raw);
  const target = paneTarget(allowed.card);
  // Read BEFORE the send, from the card the send was authorised against, so the
  // note describes the pane we typed into rather than whatever it became while
  // we were typing.
  const paneState = allowed.card.state || null;
  // ⚠️ The note depends on the VERDICT as well as the state (see waitingNote),
  // and the verdict is not known until the sends have answered — so it is built
  // at each return rather than once up front.
  const noteFor = (outcome) => waitingNote(paneState, outcome);

  /**
   * ⚠️ THE PANE IS ASKED AGAIN, HERE, IMMEDIATELY BEFORE THE KEYSTROKE.
   *
   * `addressable` above checked a roster SNAPSHOT, and that snapshot is already
   * hundreds of milliseconds old by the time we get here: it was taken at the
   * top of the request, and a `snapshot()` fans out one `capture-pane` per agent
   * on the machine before the route even reaches this function. Everything it
   * authorised can stop being true inside that window, and the two ways it can
   * are the two worst outcomes this module has:
   *
   *   - Claude EXITS. The pane falls back to a shell, and the person's message
   *     is then a COMMAND, executed. "have a look at the lease" is harmless;
   *     the message somebody sends about deleting an old build is not.
   *   - The person scrolls the pane into copy-mode. The keystrokes go to
   *     copy-mode bindings, tmux answers success, and we report `placed` for a
   *     message that reached nothing.
   *
   * A check whose window a real user action can walk through is not a check, so
   * this closes it to one tmux round-trip. It is not zero — nothing outside the
   * pane can make it zero — but it is the difference between a gate that can be
   * beaten by scrolling and one that cannot realistically be.
   *
   * ⚠️ AND THE VERDICT IS THE ENGINE'S OWN. The fresh values are put back into a
   * pane shaped the way `status` builds them and handed to `isAgentPane`, so
   * this cannot drift from the rule that authorised the send in the first place.
   * A second copy of "is this pane typeable" is exactly the two-derivations
   * habit this codebase keeps paying for.
   */
  const still = verifyAtSend(allowed.card);
  if (!still.ok) {
    return { state: DELIVERY.COULD_NOT, because: still.because, at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT) };
  }

  // ⚠️ TWO CALLS, in this order, never one. `-l` types characters literally, so
  // folding Enter into the same call would type the five letters E-n-t-e-r.
  // connect.js sends a sign-in code exactly this way for exactly this reason.
  // ⚠️ `wireText`, not `text`: a trailing `;` is tmux's command-list separator
  // and never reaches the pane unescaped. See `wireText` for what was measured.
  const typed = tmux(['send-keys', '-t', target, '-l', '--', wireText(text)]);
  if (typed.ran && typed.status !== 0) {
    // tmux ran and refused: it did not type anything. Re-sending is safe.
    return {
      state: DELIVERY.COULD_NOT,
      because: refusalReason(typed, 'we could not type it into its window'),
      at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT),
    };
  }
  if (!typed.ran && typed.spawnFailed) {
    // tmux never started, so no keystroke exists. Also safe to re-send.
    return {
      state: DELIVERY.COULD_NOT,
      because: refusalReason(typed, 'we could not get to its window, so we did not type anything'),
      at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT),
    };
  }
  if (!typed.ran) {
    /**
     * ⚠️ THE AMBIGUOUS ONE, AND THE REASON THIS STATE EXISTS. tmux was started
     * and did not answer inside the timeout — which it can do having already
     * delivered the keystroke. Rendering that as a failure is what makes
     * somebody re-send, and this send may have landed.
     */
    return {
      state: DELIVERY.UNCONFIRMED,
      // ⚠️ THE FACT ONLY. What to DO about it belongs to the screen, which
      // knows where its own viewport is; a module that also gave instructions
      // produced a three-clause wall on screen, each clause telling the person
      // to look somewhere different.
      because: 'we typed it in and its window did not answer us in time, so we cannot tell whether it arrived',
      at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED),
    };
  }
  const entered = tmux(['send-keys', '-t', target, 'Enter']);
  if (!entered.ran || entered.status !== 0) {
    /**
     * ⚠️ EVERYTHING PAST THE FIRST KEYSTROKE IS UNCONFIRMED, whatever the
     * second call said, and the previous version of this branch got it wrong in
     * a way worth keeping written down. It answered `could_not` with the
     * sentence "it is sitting there unsent" — two over-claims in one line. The
     * text HAD gone in, so "could not deliver" invited a re-send that would
     * duplicate it; and "sitting there unsent" is a settled claim about where
     * somebody's words are, made in the one case where we could not read the
     * pane to find out. The pane may have taken the Enter and died, or never
     * seen it.
     *
     * What we know is exactly this: we typed it, and we cannot say whether it
     * was submitted. The screen is on the same page, so the honest instruction
     * is to look rather than to guess for them.
     */
    return {
      state: DELIVERY.UNCONFIRMED,
      because: refusalReason(entered, 'it went into its window and we could not press Enter, so it may be sitting in its composer unsent'),
      at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED),
    };
  }
  return { state: DELIVERY.PLACED, because: null, at, paneState, paneNote: noteFor(DELIVERY.PLACED) };
}

/**
 * What to say about a tmux call that did not work.
 *
 * "We could not run tmux" and "tmux ran and refused" are different facts, and
 * the second one usually names the pane, which is the half a person can act on.
 */
function refusalReason(got, fallback) {
  if (!got || !got.ran) {
    /**
     * ⚠️ TOLD APART, because they send a person to different places. tmux
     * NEVER STARTED (it is not installed, not executable, not on PATH) is a
     * machine to fix; tmux started and did not answer in time is a machine
     * under load, where the same action a moment later usually works. One
     * sentence for both told the second person to go looking for a missing
     * program they have.
     */
    if (got && got.spawnFailed === false) {
      // ⚠️ The fallback clause SURVIVES the timeout branch. "…, so we did not
      // type anything" is the sentence that makes this verdict a could_not
      // rather than an unconfirmed, i.e. the reason re-sending is safe -- and
      // the timeout was the one branch that dropped it exactly where it
      // carries that weight.
      return fallback
        ? `${fallback} (its window did not answer in time)`
        : 'its window did not answer in time';
    }
    // ⚠️ Same weight-bearing rule as the timeout arm above (round 20): the
    // caller's fallback clause is what tells the reader nothing was typed,
    // so the spawn-failed sentence keeps it too instead of replacing it.
    const why = (got && got.err) ? String(got.err).trim().split('\n')[0] : 'we could not reach the agents on this computer';
    return fallback ? `${fallback} (${why})` : why;
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
 *
 * ⚠️ THIS IS NOT THE BOARD'S CAPTURE, and the differences are load-bearing
 * rather than incidental. `status.capturePane` asks for 40 lines of scrollback
 * WITHOUT `-J` and `classify` reads only the last 25 of what came back; this
 * asks for 60 WITH `-J`, and `questionIn` scans all of it. (Measured: `-S -N`
 * returns N plus the pane height, so the request is not the size of the
 * answer — see the note above `questionIn`.) So the two can legitimately disagree about
 * whether a question is on screen — see the note above `questionIn`, and
 * `questionBecause` on the route, which exists for exactly that case.
 */
function viewport(sessionName, roster) {
  // No `at` stamp (round 31): it was published on every return and read
  // by nothing -- the unread-surface rule rounds 19 and 22 applied to the
  // thread payload's agents copy and readIdentity's source, applied to
  // the third instance. The capture is made in the same request cycle as
  // the sentence that describes it, which is what "right now" claims.
  const key = String(sessionName == null ? '' : sessionName);
  if (!Array.isArray(roster)) {
    return { text: null, because: 'we could not check which agents are running, so we cannot show you its screen' };
  }
  const card = roster.find((a) => a && a.sessionName === key) || null;
  if (!card) {
    return { text: null, because: 'we cannot see an agent by exactly this name on this computer right now' };
  }
  if (card.isNamedOurs !== true) {
    return { text: null, because: 'something is running under this name, but we cannot tell that it is this agent, so we are not showing you its screen' };
  }
  if (!card.target) {
    return { text: null, because: 'we cannot tell where this agent is running' };
  }
  // One depth for every caller: a `lines` parameter used to ride here with
  // a bound no caller ever exercised (round 16), which was API surface
  // whose safety nothing held.
  const got = tmux(['capture-pane', '-p', '-J', '-t', paneTarget(card), '-S', `-${VIEWPORT_LINES}`]);
  if (!got.ran || got.status !== 0) {
    return { text: null, because: refusalReason(got, 'we could not read its window just now') };
  }
  // ⚠️ Trailing blank lines are trimmed and NOTHING ELSE IS. tmux pads a
  // capture to the pane height, so an untrimmed viewport is mostly empty space
  // and the newest line sits off the top of a scrolled box. Trimming the ENDS
  // is presentation; touching the middle would be parsing, which this module
  // does not do.
  return { text: String(got.out || '').replace(/\s+$/, ''), because: null };
}

/**
 * The part of the screen that made the board say "Needs you".
 *
 * ⚠️ ONE derivation, shared. The markers come from `engine/status.js`, which is
 * where the NEEDS_YOU verdict is made — a private copy here would be a second
 * answer to one question, this codebase's worst habit, and it would drift the
 * first time a marker is added there. So this function SHARES the markers with
 * the card that sent the person here.
 *
 * ⚠️ That is not the same as the two agreeing, and an earlier version of this
 * paragraph claimed it was. The two reads differ in THREE ways, not one, and
 * only the first is about timing:
 *
 *   MOMENT — the card comes from the roster snapshot at the top of the request;
 *            this runs on a capture taken after it, and a TUI redraws.
 *   FLAGS  — `status.capturePane` does NOT pass `-J`; `viewport` does. `-J`
 *            joins a wrapped line back together, so a marker split across the
 *            pane's right edge is one line here and two there. The board can
 *            see a question this misses, and the reverse.
 *   DEPTH  — the board asks for 40 lines of scrollback and `classify` then
 *            reads only the LAST 25 of what came back; this asks for 60 and
 *            scans all of it. A question that has scrolled past those last 25
 *            lines is invisible to the card while still being findable here.
 *            (⚠️ MEASURED: `-S -N` returns N lines of scrollback PLUS the
 *            pane height — on a 20-row pane, `-S -40` came back with 60 lines
 *            and `-S -60` with 80. So neither number is the size of what is
 *            returned, and an earlier version of this note read as though it
 *            were. The 25-line window is the part that actually bounds what
 *            the card can see.)
 *
 * All three gaps are real and reachable, which is exactly why the route carries
 * `questionBecause` — a sentence for the case where the two reads disagree,
 * instead of a silence that would render as no question at all under a card
 * saying there is one.
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
  // ⚠️ The TEXT only. A `line` index used to ride along and nothing ever
  // read it — and a line number counted against a capture the caller does not
  // hold is not a thing anybody could use safely anyway.
  return { text: lines.slice(from).join('\n').replace(/\s+$/, '') };
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
/**
 * ⚠️ THE LENGTH IS DELIBERATELY GENEROUS, and the reason is a defect rather
 * than a preference. `projects.idFor` now bounds new ids at 64, but this ran at
 * 80 while `cleanName` allowed a 120-character NAME — so a project created
 * before that bound, with a long-but-ordinary name, DELIVERED messages and
 * recorded none of them, under the sentence "that is not a project we can
 * read" about a project the same screen had just listed.
 *
 * The job of this pattern is the CHARSET — refusing `..`, a separator, anything
 * that could point the write at another thread's file. The length is a
 * sanity bound, not the guard, so it sits well above every id the producer can
 * now make and above the historical ones too. Tightening it would re-open a
 * silent no-record for records that already exist on somebody's disk.
 */
const PROJECT_ID = /^[a-z0-9_-]{1,128}$/;

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
/**
 * @param {string} [bornAt] the project's own `createdAt`. When given, and when
 *   the stored record carries one too, a MISMATCH is refused — see below.
 */
function readThread(projectId, agent, bornAt) {
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
    damaged.code = 'UNPARSEABLE';
    throw damaged;
  }
  if (!parsed || !Array.isArray(parsed.messages)) {
    const damaged = new Error('this conversation is there but we cannot make sense of it');
    damaged.code = 'UNPARSEABLE';
    throw damaged;
  }
  // ⚠️ PER-ELEMENT shape too (round 27): `messages: [null]` passed every
  // gate here and threw a TypeError in the page's renderer -- outside its
  // try, unawaited, so the thread area stayed blank forever with the poll
  // re-throwing every five seconds. The stranded-with-no-sentence state is
  // the one this file's whole damage taxonomy exists to remove, and every
  // OTHER damage mode was already first-class. UNPARSEABLE routes it into
  // the existing set-aside-and-start-again repair, so the file is kept.
  if (parsed.messages.some((m) => !m || typeof m !== 'object' || typeof m.text !== 'string')) {
    const damaged = new Error('this conversation is there but we cannot make sense of it');
    damaged.code = 'UNPARSEABLE';
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
    wrong.code = 'UNPARSEABLE';
    throw wrong;
  }
  /**
   * ⚠️ THE SAME NAME IS NOT THE SAME PROJECT, and without this the messages
   * come back attached to work they were never about.
   *
   * A project id is derived from its NAME, and removing a project frees the id.
   * So: make "Henderson lease", say six things to Mara about the lease, remove
   * the project, make a new "Henderson lease" months later for a different
   * building — and the thread opens holding the old conversation, under the new
   * project's heading, as though it had been said about this work. Nothing on
   * screen would suggest otherwise.
   *
   * The project's own `createdAt` distinguishes them, and a mismatch is refused
   * exactly like the agent mismatch above. NOTHING IS DELETED: the record stays
   * on disk, and the sentence says the messages exist and belong to a project
   * that had this name before. `appendMessage` is what moves the old file aside
   * so the new project can keep its own conversation — a refusal alone would
   * leave the new thread permanently unable to record anything, which would be a
   * worse bug than the one being fixed.
   *
   * ⚠️ ONLY when BOTH stamps are present. A record written before this existed
   * carries none, and inventing a mismatch for it would refuse a conversation
   * that is very probably this project's own.
   */
  if (bornAt && parsed.projectBornAt && parsed.projectBornAt !== String(bornAt)) {
    const other = new Error('these messages were sent to an earlier project that had this name, '
      + 'so we are not showing them here. They are still on this computer.');
    other.code = 'OTHER_PROJECT';
    throw other;
  }
  return {
    project: String(projectId),
    agent: String(agent),
    messages: parsed.messages,
    projectBornAt: parsed.projectBornAt || null,
  };
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
/**
 * Hold the thread file while it is read, changed and written back.
 *
 * ⚠️ `appendMessage` IS A READ-MODIFY-WRITE, and without this two windows lose
 * a message. Both read a thread of five, both append their own sixth, both
 * rename their seven-message file into place, and the second one wins — the
 * first person's message is delivered to the agent and then vanishes from the
 * record of it. Silent, and unrecoverable from the screen.
 *
 * ⚠️ `mkdir` IS THE LOCK, which is the same primitive the fleet's own
 * `claude-msg` transport uses for the same reason: it is atomic on every
 * filesystem this product runs on, needs no cleanup daemon, and its failure
 * mode is a refusal rather than a corrupt file. `writeFileSync` with `wx` would
 * do as well; `mkdir` is chosen because the pattern already exists here.
 *
 * ⚠️ A STALE LOCK EXPIRES. A process killed between `mkdir` and `rmdir` would
 * otherwise wedge that one conversation forever, so a lock older than the bound
 * is broken rather than waited on — the window it protects is two file
 * operations, so anything older is debris rather than a live writer.
 */
const LOCK_STALE_MS = 10 * 1000;

const LOCK_WAIT_MS = 2000;

/**
 * Pause without a subprocess.
 *
 * ⚠️ THIS WAS `execFileSync('/bin/sleep')` AND IT BROKE THE MODULE'S CONTRACT.
 * `appendMessage` promises never to throw — a recording failure is REPORTED,
 * because it is reached with a message that has already been delivered. An
 * unguarded subprocess spawn breaks that promise the moment the machine is out
 * of process slots or `/bin/sleep` is not where it is expected: the throw
 * escapes to the route's 400 handler and a DELIVERED message is reported to the
 * person as a failed send. That is precisely the inversion the contract exists
 * to prevent, introduced by the fix for a different one.
 *
 * `Atomics.wait` on a private buffer blocks this thread for the timeout with no
 * process, no file descriptor and nothing to throw.
 *
 * ⚠️ AND IT BLOCKS THE WHOLE SERVER, which is single-threaded: while one
 * request waits out lock contention (up to LOCK_WAIT_MS, 2s), every other
 * request on the machine stalls behind it. Bounded and rare (the lock is
 * per-thread-file and held for one read-modify-write), and far better than
 * the 15-second unbounded spin it replaced -- but a wait here is everybody
 * waiting, which is the cost to weigh before raising LOCK_WAIT_MS. And the
 * lock is the SMALL half of the request's blocking budget: deliver's tmux
 * path is up to three execFileSync calls at 5s timeout each (probe, text,
 * Enter), so a wedged tmux stalls the whole board ~15s on its own.
 * Consistent with the codebase's synchronous design; named so the number
 * being watched is the real one (round 19).
 */
const PARK = new Int32Array(new SharedArrayBuffer(4));
function pauseMs(ms) {
  Atomics.wait(PARK, 0, 0, ms);
}

function withThreadLock(file, fn) {
  const lock = file + '.lock';
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') {
        // We could not even attempt the lock (an unwritable directory, say).
        // Answering rather than throwing keeps `appendMessage`'s contract: a
        // recording failure is reported, never raised at a delivered message.
        return { ok: false, because: 'we could not get exclusive access to this conversation' };
      }
      /**
       * ⚠️ THE DEADLINE COVERS THIS BRANCH TOO, and the first version's did not.
       * MEASURED: with a leftover lock directory that is not empty — a
       * `.DS_Store` inside one left by a crash is enough — `rmdirSync` throws
       * ENOTEMPTY, the catch swallowed it, `continue` re-entered `mkdirSync`,
       * the age was still stale, and the loop ran forever. Inside the
       * synchronous POST handler, on a single-threaded server: every request on
       * the machine wedged behind one thread, with "Sending…" on screen. A
       * fifteen-second spin was measured before it was killed by hand.
       */
      if (Date.now() > until) {
        return { ok: false, because: lockedBecause() };
      }
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { age = Infinity; }
      if (age > LOCK_STALE_MS) {
        /**
         * ⚠️ STOLEN BY RENAME, NOT BY `rmdir`, and that is what makes the break
         * safe against a second breaker. Two writers can both measure the same
         * lock as stale; with `rmdir` they both removed it and both proceeded —
         * the second one demolishing the FIRST one's brand-new, perfectly
         * fresh lock and walking straight into the critical section beside it.
         * The interleave the lock exists to prevent, reachable only through the
         * path that repairs it.
         *
         * `rename` of a path can only succeed ONCE: the loser gets ENOENT and
         * goes back around, finds the winner's fresh lock, and waits like any
         * other contender. It also copes with the non-empty directory that
         * `rmdir` could not, which is the deadlock above.
         */
        const aside = `${lock}.${process.pid}.${Date.now()}.stale`;
        try {
          fs.renameSync(lock, aside);
        } catch {
          // Somebody else won the steal, or the lock vanished under us. Either
          // way the next turn of the loop reads the world as it now is.
          pauseMs(20);
          continue;
        }
        // Ours to clean up, and `rm -r` because the thing that made the old
        // path deadlock was a directory with something in it.
        try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* debris, not fatal */ }
        continue;
      }
      pauseMs(20);
    }
  }
  /**
   * ⚠️ WE RELEASE OUR OWN LOCK, NEVER WHOEVER'S IS THERE NOW.
   *
   * The `finally` removed the lock PATH unconditionally, which is right until
   * one critical section outlives `LOCK_STALE_MS`. Then: this holder is still
   * working, a second writer measures the lock as stale and steals it, and
   * this holder's `finally` deletes the SUCCESSOR's brand-new lock — putting
   * two writers inside at once by way of the cleanup. Unlikely (the section is
   * two file operations) and cheap to close, which is the whole argument for
   * closing it rather than reasoning about how unlikely it is.
   *
   * A token written into the lock is what makes ownership checkable. Losing the
   * marker (an unwritable dir) is not a reason to fail the write — it only
   * means we cannot prove the lock is ours, so we do not remove it and let the
   * staleness rule collect it.
   */
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  let marked = false;
  try { fs.writeFileSync(path.join(lock, 'owner'), token); marked = true; } catch { marked = false; }
  try {
    return { ok: true, value: fn() };
  } finally {
    let ours = marked;
    if (marked) {
      try { ours = fs.readFileSync(path.join(lock, 'owner'), 'utf8') === token; } catch { ours = false; }
    }
    if (ours) {
      try { fs.rmSync(lock, { recursive: true, force: true }); } catch { /* already gone */ }
    }
  }
}

/**
 * ⚠️ ONE SENTENCE, BECAUSE WE CANNOT TELL THE TWO APART. The wait is 2s and a
 * lock is only called stale after 10s, so for eight seconds a lock left behind
 * by a window that CRASHED was being described as "another window is writing to
 * this conversation right now" — a confident claim about a process that is not
 * running.
 *
 * A first fix branched on the lock's age, and that branch was almost never
 * taken: by the time we give up, we have waited the full 2s, so the lock is
 * essentially always older than the wait. A distinction that is real in
 * principle and unreachable in practice is worse than none, because it reads as
 * though something was determined. We waited, somebody else holds it, and we do
 * not know whether they are still there — so that is what it says.
 */
function lockedBecause() {
  return 'this conversation is locked by another window, or by one that stopped part-way through a send';
}

function appendMessage(projectId, agent, entry, bornAt) {
  // ⚠️ EVERYTHING from the read to the rename happens inside the lock. Holding
  // it for the write alone would not help: the loss is in the gap between the
  // read and the write, not in the write itself.
  let file;
  try { file = threadFile(projectId, agent); }
  catch (err) { return { recorded: false, because: String((err && err.message) || 'we could not find that conversation') }; }
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); }
  catch { /* the write below reports what it cannot do */ }
  /**
   * ⚠️ THE NEVER-THROWS PROMISE IS HELD BY CODE, not by the docblock that makes
   * it. Everything below runs with a message that has ALREADY BEEN DELIVERED,
   * so a throw escaping here reaches the route's 400 handler and reports a
   * delivered message as a failed send — the one inversion this contract
   * exists to prevent. `pauseMs` was an unguarded subprocess spawn once for
   * exactly this reason; a promise that depends on nothing inside ever throwing
   * again is a promise waiting to be broken by the next edit.
   */
  let held;
  try {
    held = withThreadLock(file, () => appendLocked(projectId, agent, entry, bornAt));
  } catch {
    return { recorded: false, because: 'we could not write this conversation down on this computer' };
  }
  if (!held.ok) return { recorded: false, because: held.because };
  return held.value;
}

function appendLocked(projectId, agent, entry, bornAt) {
  let existing;
  let supersededBecause = null;
  try {
    existing = readThread(projectId, agent, bornAt);
  } catch (err) {
    if (err && err.code === 'OTHER_PROJECT') {
      /**
       * ⚠️ MOVED ASIDE, NEVER DELETED, and never appended to either.
       *
       * The file under this key belongs to an earlier project that had this
       * name (see `readThread`). Appending would mix two projects' conversations
       * into one record; refusing forever would leave this project unable to
       * keep a single message, which is a worse bug than the one being fixed.
       * So the old record is RENAMED out of the way — every word of it still on
       * disk — and this project starts its own.
       *
       * A failure to move it is not a failure to send: we say we could not
       * record, and the old file stays exactly as it was.
       */
      const moved = supersede(projectId, agent, 'superseded');
      if (!moved.ok) {
        return { recorded: false, because: moved.because };
      }
      existing = { messages: [] };
      supersededBecause = 'an earlier project had this name; its messages have been kept aside.';
    } else if (err && err.code === 'UNPARSEABLE') {
      /**
       * ⚠️ A DAMAGED FILE LOCKED RECORDING OUT FOREVER, and the argument
       * against that is already written three paragraphs up: refusing forever
       * is a worse bug than the one being fixed. A thread file that will not
       * parse is not a thread we can add to — and it is also not a reason for
       * this conversation to stop being kept for the rest of time. Every send
       * after the damage was delivered and silently unrecorded.
       *
       * Same treatment, different suffix: the damaged file is RENAMED aside
       * (nothing deleted, in case a person or a tool can still salvage it) and
       * this conversation starts again. The suffix differs from the
       * `projectBornAt` one on purpose, so the two kinds of aside can never be
       * mistaken for each other on disk or collide.
       *
       * ⚠️ `UNPARSEABLE`, NOT `UNREADABLE`, AND THE SPLIT IS THE WHOLE POINT.
       * The first version of this branch caught both, and `readThread` throws
       * `UNREADABLE` for a `readFileSync` that failed on an INTACT file —
       * EACCES, EMFILE, EIO. Measured: `chmod 000` on a healthy six-message
       * thread plus one send renamed it aside as `.damaged` and replaced the
       * conversation with an empty one, while the screen asserted damage
       * nothing had established. A transient permission problem is not a
       * corrupt file, and the destructive repair for one must never fire for
       * the other.
       *
       * `readThread` was already writing two different SENTENCES for these two
       * cases ("we cannot read this conversation right now" versus "it is there
       * but we cannot make sense of it"); the distinction existed in the prose
       * and not in the code. It is in the code now.
       */
      const moved = supersede(projectId, agent, 'damaged');
      if (!moved.ok) {
        return { recorded: false, because: moved.because };
      }
      existing = { messages: [] };
      supersededBecause = 'an earlier damaged file was set aside, and this conversation started again.';
    } else {
      return { recorded: false, because: String((err && err.message) || 'we could not read this conversation to add to it') };
    }
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
    // Stamped so a LATER project that reuses this name cannot inherit these
    // messages. Carried forward when the record already had one, so an existing
    // conversation is not re-stamped by a read that happened to know the date.
    projectBornAt: existing.projectBornAt || (bornAt ? String(bornAt) : null),
    messages: [...existing.messages, {
      at: (entry && entry.at) || new Date().toISOString(),
      text: cleanMessage(entry && entry.text),
      delivery: {
        state: (entry && entry.delivery && entry.delivery.state) || DELIVERY.COULD_NOT,
        because: (entry && entry.delivery && entry.delivery.because) || null,
        /**
         * ⚠️ THE PANE'S STATE IS KEPT WITH THE MESSAGE, not just shown once.
         * "It was mid-task when you sent this" is the answer to the question
         * somebody asks an hour later — why did nothing happen? — and a note
         * that lives only in the moment of sending cannot answer it. It is a
         * record of what was observed then, which is why the sentence is past
         * tense and stays past tense on every later read.
         */
        paneState: (entry && entry.delivery && entry.delivery.paneState) || null,
        paneNote: (entry && entry.delivery && entry.delivery.paneNote) || null,
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
  } catch {
    /**
     * ⚠️ OUR SENTENCE, NOT THE ERRNO. Forwarding `err.message` put
     * "EISDIR: illegal operation on a directory, open '/var/folders/rn/…/
     * lease.casey.json.4821.new'" on screen — an error code and an internal
     * temp path, to somebody who wanted to message their agent. `folderState`
     * has answered these in plain language since the day it shipped; this is
     * the same rule for the same reason. The detail is dropped rather than
     * appended: there is nothing in it a person can act on.
     *
     * ⚠️ AND THE ASIDE IS REPORTED EVEN THOUGH THE WRITE FAILED. `supersede`
     * may already have RENAMED an earlier project's conversation out of the
     * way — a change to somebody's disk — and only the success return carried
     * word of it, so that move could happen with no sentence anywhere. It
     * travels on both returns now.
     */
    return {
      recorded: false,
      because: 'we could not write this conversation down on this computer',
      supersededBecause,
    };
  }
  return { recorded: true, because: null, messages: record.messages, supersededBecause };
}

/**
 * Move an earlier project's thread out of the way, keeping every word of it.
 *
 * ⚠️ A RENAME, and the destination name never collides: it carries the stamp of
 * the project the messages belonged to, plus the pid, so two windows doing this
 * at once cannot rename over each other. If the destination somehow exists, we
 * refuse rather than overwrite — this whole function exists so that nothing of
 * the person's is lost, and clobbering the file we are rescuing would be the
 * one way to fail at that.
 */
function supersede(projectId, agent, kind) {
  let file;
  try { file = threadFile(projectId, agent); }
  catch (err) { return { ok: false, because: String((err && err.message) || 'we could not find that conversation') }; }
  let stamp = 'earlier';
  try {
    const was = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (was && was.projectBornAt) stamp = String(was.projectBornAt).replace(/[^0-9A-Za-z-]/g, '');
  } catch { /* the name is a label, not a lookup key */ }
  /**
   * ⚠️ THE KIND is in the name: a file set aside because a previous project had
   * this name is a different thing from one set aside because it was damaged,
   * and a person looking at the directory should be able to tell.
   *
   * ⚠️ AND THE NAME MUST BE UNIQUE, which the first version was not — it
   * reopened the very lockout it was written to fix, one occurrence later.
   * `stamp` falls back to the literal `'earlier'` for a DAMAGED file (there is
   * no `projectBornAt` to read out of a file that will not parse), so
   * `<file>.earlier.<pid>.damaged` was a CONSTANT for one project+agent inside
   * one server process. Measured: a second sequential damage computed the same
   * path, hit the `existsSync` guard, and answered `recorded: false` for good.
   *
   * The bounded counter is what makes the refusal below the cannot-happen
   * guard it was always described as, instead of the second-time-through
   * path; the millisecond stamp only spreads names across time and would be
   * redundant on its own (a same-ms collision falls through to `.2`).
   */
  // ⚠️ The counter sits BEFORE the kind. Appending it after
  // (`...damaged.2`) breaks the property the first warning above promises:
  // the kind stops being the last segment, so a person (or a suffix match)
  // reading the directory can no longer tell what the second aside was.
  const stem = `${file}.${stamp}.${process.pid}.${Date.now()}`;
  const suffix = kind || 'superseded';
  let aside = `${stem}.${suffix}`;
  for (let n = 2; fs.existsSync(aside) && n <= 50; n += 1) aside = `${stem}.${n}.${suffix}`;
  if (fs.existsSync(aside)) {
    // Fifty asides for one project+agent, in one process, inside one
    // millisecond. Refusing beats overwriting the file we are rescuing.
    return { ok: false, because: cannotMoveAside(kind) };
  }
  try {
    fs.renameSync(file, aside);
    return { ok: true, aside };
  } catch {
    // Plain language, same rule as the write failure above: an errno and an
    // internal path are not things a person can act on.
    return { ok: false, because: cannotMoveAside(kind) };
  }
}

/**
 * ⚠️ THE SENTENCE FOLLOWS THE KIND. Both failure returns used to say "an
 * earlier project's messages" whatever they had been asked to move — so a
 * DAMAGED file that could not be renamed was reported as a project-name clash,
 * which is a different thing that would send somebody looking for a project
 * they never made.
 */
function cannotMoveAside(kind) {
  return kind === 'damaged'
    ? 'we could not move the damaged file aside, so we did not add to it'
    : 'we could not move an earlier project’s messages aside, so we did not add to them';
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
  cleanMessage, messageProblem, addressable, paneTarget, wireText,
  deliver, viewport, questionIn, waitingNote, spawnFailure, verifyAtSend,
  threadFile, readThread, appendMessage, supersede, withThreadLock,
  defaultAgentFor, looksLikeManager,
  setRunner, setDryRun, resetForTests,
};

/**
 * ⚠️ READABLE, so a fixture can ASSERT this seam is armed the way it believes.
 *
 * `engine/create.js` exports its own `DRY_RUN`, and `thread-server.js` asserts
 * it — which is exactly what caught that file one line away from making a real
 * launchd job on this machine. The same fixture then called
 * `chat.setDryRun(false)` with no way to check what it had done, so two seams
 * in one file were held to different standards, and the one that types into a
 * live agent was the unguarded one.
 *
 * A GETTER rather than the flag's value: it changes at runtime, and a snapshot
 * exported at load would answer about the past.
 */
Object.defineProperty(module.exports, 'DRY_RUN', { get: () => DRY_RUN, enumerable: true });
// Same live-read contract as DRY_RUN, for the same fixture-assertable reason.
Object.defineProperty(module.exports, 'VERIFY_FORMAT', { get: verifyFormat, enumerable: true });
