'use strict';

/**
 * Status engine.
 *
 * Derives the state of every agent on this machine. Read-only: it runs tmux
 * queries and reads files, and never writes, sends keys, or starts anything.
 *
 * The one rule that shapes the whole file: an agent we cannot read must come
 * out as `unknown`, never as something healthy. Most monitoring bugs are the
 * same shape -- the check cannot tell "fine" from "I can't see it" and renders
 * green. Every field here therefore carries how it was determined, so the UI
 * can show confidence rather than implying certainty it does not have.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');
const { readWorkerFile } = require('./workerfile');

const HOME = os.homedir();

/**
 * Claude Code config roots.
 *
 * There is usually one (`~/.claude`), but an agent launched with
 * CLAUDE_CONFIG_DIR pointing elsewhere keeps its transcripts and its registry
 * entry under that root instead. On this fleet the two agents billed to a
 * second subscription run with `CLAUDE_CONFIG_DIR=~/.claude-account-b`, and a
 * reader that only knows about `~/.claude` reports them as unreadable while
 * their data sits in plain sight one directory over.
 *
 * So we discover roots rather than assuming one. The alternative -- parsing
 * launch scripts for the variable -- couples us to how agents happen to be
 * started on one machine.
 */
function configRoots() {
  const roots = [];
  let entries = [];
  try {
    entries = fs.readdirSync(HOME);
  } catch { /* fall through to the default */ }
  for (const name of entries) {
    if (name !== '.claude' && !name.startsWith('.claude-')) continue;
    const projects = path.join(HOME, name, 'projects');
    if (fs.existsSync(projects)) roots.push(path.join(HOME, name));
  }
  if (!roots.length) roots.push(path.join(HOME, '.claude'));
  // Primary root first, so the common case costs one lookup.
  roots.sort((a) => (a.endsWith('/.claude') ? -1 : 1));
  return roots;
}

// How the value was arrived at. The UI renders low-confidence values
// differently, and never renders `none` as a real number.
const CONFIDENCE = {
  STRUCTURED: 'structured', // read from a file written for this purpose
  SCRAPED: 'scraped',       // read off a terminal pane; may be UI chrome
  NONE: 'none',             // could not determine -- must not render as a value
};

const STATE = {
  WORKING: 'working',
  NEEDS_YOU: 'needs_you',
  RATE_LIMITED: 'rate_limited',
  IDLE: 'idle',
  STOPPED: 'stopped',
  UNKNOWN: 'unknown', // the default, deliberately
};

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
  } catch {
    return null;
  }
}

/**
 * ⚠️ Three tiers live here, and mixing them up has caused a defect at every
 * level, so read which one you want before using it:
 *
 *   `isFleetSession` — our session, whatever is running in it. What RESTART
 *                      asks, because a crashed agent is still our agent.
 *   `isAgentSession` — the above, AND Claude is actually running.
 *   `isAgentPane`    — the above, AND the pane is not scrolled back in
 *                      copy-mode. What TYPING asks.
 *
 * `list-panes -a` returns EVERY pane on the machine, and the roster it feeds
 * gates every destructive route. Without these, `/clear` and Enter would be
 * typed into a plain shell, an editor, or a REPL, where the text is EXECUTED
 * rather than read as a slash command. Latent while every session happens to be
 * a Claude agent; live the moment anyone opens an unrelated tmux session.
 *
 * ⚠️ Split apart because RESTART needs a different question from typing, and
 * conflating them was a real hole at both ends.
 *
 * Too loose: `restart` was exempt from every roster check on the reasoning that
 * it goes through launchd and types nothing. But the roster is every tmux pane
 * on the machine with the `-discord` suffix merely STRIPPED, never required. So
 * a plain shell in a session called `mikey` appeared as an agent named `mikey`,
 * and its Restart button ran `restart-bot.sh mikey` against the REAL bot. The
 * shown cost even looked right, because the dialog reads the real `mikey`'s
 * commitments. The operator would be acting on a card that is not the thing
 * being restarted.
 *
 * Too tight: making restart use `isAgentPane` instead would refuse whenever the
 * pane is scrolled back in copy-mode, which matters only for TYPING. Restart
 * sends no keystrokes, so copy-mode is irrelevant to it, and refusing there
 * would take the feature away in a state the operator can enter by accident
 * with a scroll wheel.
 */
/**
 * Is this pane in one of the fleet's sessions, whatever is running in it?
 *
 * ⚠️ Three tiers now, and the distinction between this one and
 * `isAgentSession` is the difference between restart working and restart being
 * useless in the case it matters most.
 *
 * `isAgentSession` additionally requires a live Claude process. Gating RESTART
 * on that was too strict in a way that inverted the feature: an agent that has
 * crashed back to a shell inside its own `*-discord` session has no Claude
 * process, so it classified `stopped` and its Restart button answered "we are
 * not confident that card is one of your agents". That sentence is untrue — it
 * plainly is one of your agents — and a crashed agent is the single most
 * valuable thing a Restart button can act on. The guard refused precisely the
 * case the feature exists for.
 *
 * The hazard restart was actually exposed to is an unrelated session that
 * merely COLLIDES with an agent's name (`tmux new -s mikey`).
 *
 * ⚠️ The suffix test does NOT close that on its own any more, and this comment
 * claimed it did for one commit after it stopped being true — which is worse
 * than saying nothing, because the claim is what stops the next reader checking.
 * Once the process arm below was added, an impostor session RUNNING CLAUDE
 * passes this function: `isFleetSession({session:'mikey', command:'2.1.212'})`
 * is `true`. What actually closes the collision now is `rank`, which puts every
 * named-ours pane above an unnamed one so the impostor cannot win the name. The
 * gate here answers "could this be an agent at all"; `rank` answers "which pane
 * IS this agent". Both are needed and only the second resolves a collision.
 *
 * `restart-bot.sh` refuses independently when there is no `com.<name>.discord`
 * plist, so a name that is not a real service cannot reach launchd either.
 *
 * What this deliberately does NOT stop is somebody opening a session literally
 * called `<agent>-discord` by hand. That is not the accident this guards
 * against, and anyone able to do it can run `restart-bot.sh` directly.
 */
/**
 * The canonical "this command IS Claude" test, in ONE place.
 *
 * ⚠️ Written out three times before this: in `isFleetSession`, in
 * `isAgentSession`, and in `rank`. The header of this file condemns exactly
 * that, and `isAgentPane` obeys it — but `rank`, the function that decides
 * WHICH PANE a destructive action reaches, carried a private copy. Loosening
 * the rule in the two that read as "the check" would have silently demoted every
 * real agent a tier in `rank` with no test noticing.
 */
function isNativeClaude(command) {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(command || '').trim());
}

/**
 * Is a Claude process running in this pane? ONE definition, used by everything.
 *
 * ⚠️ There were two, and the looser one decided what the board asserted.
 * `classify` asked `isClaudeRunning`, a DENYLIST of six shell names, while
 * `isAgentSession` asked an ALLOWLIST. So `vim`, `ssh`, `python3`, `less` — and
 * `-zsh`, a login shell, which is not in the denylist at all despite this
 * branch's own tests using it as the crashed case — were all "Claude is
 * running" to `classify`.
 *
 * The consequence was not theoretical: a crashed agent whose only remaining
 * pane is an editor won its name in `rank`, then `classify` scraped that
 * editor's screen and reported `idle` if the buffer contained "Worked for",
 * `needs_you` if it contained "Do you want to proceed", `rate_limited` if it
 * contained "rate limit". **The board reported a healthy state for a crashed
 * agent, on the one card whose Restart button exists for that case.**
 *
 * Matched against the fleet's canonical rule
 * (`~/.claude/scripts/lib/claude-process-classify.sh`): a strict three-segment
 * version, or one of the legacy names, because an npm-global install fronts as
 * `node`.
 */
function isClaudeCommand(command) {
  const c = String(command || '').trim();
  return isNativeClaude(c) || c === 'claude' || c === 'claude.exe' || c === 'node';
}

function isFleetSession(pane) {
  if (!pane) return false;

  // ⚠️ EITHER a session we recognise by name, OR a pane visibly running Claude.
  //
  // This used to require `/-discord$/` and nothing else, which meant an agent
  // that was not a Discord bot was invisible to every check here: not
  // restartable, not typeable, effectively unmanaged. That is a straight
  // contradiction of the product's own second paragraph ("Not Discord as the
  // surface"), and it was load-bearing rather than cosmetic — it is why the
  // install instructions grew a Discord developer-portal step nobody should
  // have to take.
  //
  // Both arms are needed, and each covers what the other cannot:
  //
  //   - The NAME arm keeps a CRASHED agent ours. Its pane is a shell, so there
  //     is no Claude process to see, and restart is the whole reason to care
  //     about it. Only the session name still says whose it is.
  //   - The PROCESS arm is what removes the Discord coupling. A native Claude
  //     install fronts as a strict three-segment version, which nothing else on
  //     a machine looks like, so it is evidence on its own whatever the session
  //     is called.
  //
  // Deliberately NOT in the process arm: `node`. An npm-global Claude install
  // fronts as `node`, and so does every dev server, REPL and build watcher. A
  // bare `node` pane is claimed only via the name arm, because trusting it
  // alone would make `/clear` typeable into a webpack watcher — the exact
  // hazard these checks exist for.
  if (isNamedOurs(pane)) return true;
  return isNativeClaude(pane.command);
}

function isAgentSession(pane) {
  if (!isFleetSession(pane)) return false;

  // ⚠️ An ALLOW list, not a deny list.
  //
  // `isClaudeRunning` merely excludes six known shell names, so inside a
  // `*-discord` session every other command passed: `vim`, `nvim`, `node`,
  // `less`, `ssh`, `python3` all classified as an agent pane, and the comment
  // above claimed it stopped an editor or a REPL. It stopped neither.
  //
  // Matched against the fleet's CANONICAL rule rather than a rule invented
  // here: `~/.claude/scripts/lib/claude-process-classify.sh` accepts a strict
  // three-segment version (the native install fronts as `2.1.212`) or one of
  // the legacy names, because an npm-global install fronts as `node`. A
  // two-segment form was accepted here for one round, which the canonical rule
  // deliberately excludes to avoid matching an unrelated numeric-named process,
  // and the legacy names were rejected, which silently removed this feature for
  // any agent on an npm install.
  return isClaudeCommand(pane.command);
}

/**
 * ⚠️ DERIVED from `isAgentSession`, not a second copy of its rule. Writing the
 * suffix test and the command allowlist out again here is the defect this
 * codebase has shipped more times than any other: one fact derived in two
 * places, the two drifting, and the looser one deciding the dangerous path.
 * This adds exactly one clause and inherits the rest.
 */
function isAgentPane(pane) {
  if (!isAgentSession(pane)) return false;

  // ⚠️ Not while the pane is scrolled back in copy-mode. There, keystrokes go
  // to copy-mode bindings rather than the composer, so nothing is compacted or
  // cleared and the route would still answer "we asked it to". This clause is
  // about TYPING, which is why restart asks `isAgentSession` instead.
  //
  // ⚠️ `=== '0'`, an ALLOWLIST, not `!== '1'`. The negative form ruled a pane
  // typeable whenever `inMode` was anything unexpected — undefined, empty, a
  // value from a future tmux — which is asserting the safe answer from an
  // absence of information. `parsePanes` already defends that default at the
  // boundary, and defending one fact in only one of the two places that decide
  // it is precisely the shape this codebase keeps shipping: any caller holding
  // a pane object it did not get from the parser got the permissive answer.
  return pane.inMode === '0';
}

/**
 * The columns we ask tmux for, in order.
 *
 * ⚠️ ONE list, used to build the format string AND to read the answer back.
 *
 * These were two separate literals: a format string here and a positional
 * destructure below. Nothing tied them together, so deleting `#{pane_in_mode}`
 * from the format, or reordering any column, left the whole suite green while
 * `inMode` silently held the pane TITLE. `inMode !== '1'` is then true for every
 * pane, and every copy-mode pane classifies as typeable — which is precisely
 * the case the copy-mode clause was added to refuse, disabled by an edit
 * nowhere near it.
 *
 * `title` is last on purpose: it is the only field that can itself contain a
 * tab, so it absorbs the remainder rather than shifting every column after it.
 */
const PANE_COLUMNS = [
  { key: 'session', fmt: '#{session_name}' },
  { key: 'pane', fmt: '#{window_index}.#{pane_index}' },
  { key: 'command', fmt: '#{pane_current_command}' },
  { key: 'inMode', fmt: '#{pane_in_mode}' },
  { key: 'title', fmt: '#{pane_title}', rest: true },
];

const PANE_FORMAT = PANE_COLUMNS.map((c) => c.fmt).join('\t');

/** Parse `list-panes -F PANE_FORMAT` output. Pure, so it can be tested. */
function parsePanes(out) {
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    const raw = {};
    PANE_COLUMNS.forEach((col, i) => {
      raw[col.key] = col.rest ? parts.slice(i).join('\t') : parts[i];
    });
    const session = raw.session || '';
    return {
      name: session.replace(/-discord$/, ''),
      session,
      // Kept, not just folded into `target`: choosing one pane per session
      // needs to compare indexes, and re-parsing them back out of the target
      // would be a second derivation of something we already had.
      pane: raw.pane || '',
      target: `${session}:${raw.pane}`,
      command: raw.command || '',
      // '1' when the pane is scrolled back in copy-mode, where keystrokes go to
      // copy-mode bindings rather than to the composer.
      //
      // ⚠️ Defaults to '1' (in copy-mode), not '0'. A truncated or malformed
      // line leaves this undefined, and defaulting to '0' meant "not in copy
      // mode, safe to type" — asserting the safe answer from an absence of
      // information, which is the one thing this codebase refuses to do.
      inMode: raw.inMode === undefined || raw.inMode === '' ? '1' : raw.inMode,
      title: raw.title || '',
    };
  });
}

/**
 * Where the raw `list-panes` output comes from.
 *
 * ⚠️ A seam, and it exists for one reason: without it the WIRING is unpinnable.
 * `onePanePerSession` had three tests and deleting its call from `snapshot()`
 * left all of them green, because every pane on this machine is already a
 * distinct session — the duplicate case cannot be arranged on a live fleet, so
 * a test that reads the real board can never fail. The same shape as
 * `setRunner` in `engine/lifecycle.js`, and for the same reason.
 *
 * Read-only either way: this replaces where the TEXT comes from, never what is
 * done with it, so it cannot be used to reach a real agent.
 */
let paneSource = null;

function setPaneSource(fn) { paneSource = typeof fn === 'function' ? fn : null; }

function listPanes() {
  const out = paneSource
    ? paneSource()
    : sh('tmux', ['list-panes', '-a', '-F', PANE_FORMAT]);
  return parsePanes(out);
}

/**
 * One entry per agent NAME, not per pane and not per session.
 *
 * ⚠️ `list-panes -a` returns every pane, and the roster mapped straight over
 * it. A `*-discord` session with a split window produced two cards with the
 * same name, the same commitment record and the same `data-fresh` value — and
 * both the card click and the action route resolve an agent by `.find()`, which
 * takes whichever sorted first. So the operator could click the card for one
 * pane and have the keystrokes go to the other.
 *
 * ⚠️ Keyed on NAME rather than session, because the roster STRIPS `-discord`
 * without requiring it: `kappa` and `kappa-discord` are two sessions and one
 * agent name, which is the same collision one level up.
 *
 * A name with no agent pane still yields one entry, because the board must show
 * something it cannot read rather than hiding it — but it will be an entry that
 * `isAgentPane` refuses, which is the honest answer for it. See `rank` for
 * which pane represents the name.
 */
/**
 * Does the SESSION NAME say this pane is ours?
 *
 * Separated from `isFleetSession` because the two arms of that function are not
 * equally strong evidence and `rank` has to tell them apart. The name is
 * evidence of WHOSE a pane is. A Claude process is evidence only that SOMEONE's
 * Claude is running there.
 */
function isNamedOurs(pane) {
  return Boolean(pane) && /-discord$/.test(String(pane.session || ''));
}

/**
 * How much this pane deserves to be the card for its name. Lower wins.
 *
 * ⚠️ FIVE tiers, because two different pairs of cases used to tie here and a tie
 * falls through to pane index — which compares indexes across unrelated sessions,
 * i.e. picks arbitrarily. Both ties were introduced by the commit that removed
 * the Discord coupling from `isFleetSession`, and both were wrong-agent bugs of
 * exactly the kind this branch exists to prevent:
 *
 *   1. `tmux new -s mikey` with Claude running in it now satisfied
 *      `isAgentSession` via the new process arm, so the impostor tied with the
 *      real `mikey-discord` at tier 0. tmux lists `mikey` first, so the impostor
 *      WON: the real agent vanished from the board, and the surviving card read
 *      the real agent's commitments, typed `/clear` into the impostor's pane,
 *      and then tombstoned the real agent's record. One conversation destroyed,
 *      the cost of a different one displayed, and a false claim that the real
 *      agent's holdings were gone while they were intact.
 *   2. Inside a genuine `zeta-discord`, a `node` pane (a build watcher in a
 *      split) tied with the real agent's version-string pane, because
 *      `isAgentSession`'s legacy arm accepts `node` for npm-global installs.
 *      Pane `0.0` won, so `/clear` and a bare Enter were typed into a process
 *      that EXECUTES text rather than reading it as a slash command.
 *
 * ⚠️ CRASHED OUTRANKS LEGACY, and that ordering is deliberately the less
 * convenient one. Inside a real `<agent>-discord` session, a bare `node` pane
 * cannot be told apart from the agent itself: an npm-global Claude install
 * fronts as `node`, and so does a build watcher in a split. Ranking `node`
 * higher meant that when the agent CRASHED to a shell, the watcher won the name
 * — so the board reported "we cannot tell" instead of "not running", hiding the
 * crash on the one card whose Restart button exists for it, and if the
 * watcher's tail ever matched an idle marker, `/clear` plus a bare Enter went
 * into a `node` process, which EXECUTES text rather than reading it.
 *
 * Both readings are wrong in one direction or the other, so the tie is settled
 * on which wrongness is recoverable:
 *
 *   - Picking the shell when `node` was really an npm-global agent: the board
 *     says `stopped` for something that is running, and typing is refused.
 *     **Restart still works** (the session name is still ours), which is the
 *     recovery, and the operator can see the pane themselves.
 *   - Picking `node` when it was really a watcher: the board hides a crash and
 *     may type an executable string into an unrelated process. **Nothing
 *     recovers that.**
 *
 * ⚠️ So the known cost, stated rather than discovered: an npm-global agent that
 * shares its session with any shell pane reads as `stopped` and is
 * restart-only. That is a real regression for that setup and it is the price of
 * not typing into a build watcher.
 *
 * ⚠️ And the tier is WIDER than "a shell", which the first version of this note
 * did not say. `RANK_NAMED_CRASHED` is every named-ours pane that is not native
 * Claude and not one of the three legacy names — so `vim`, `ssh`, `python3`,
 * `less` and `man` all land in it and outrank a `node` pane. `classify` uses a
 * different and narrower definition of "no Claude here" (a six-name shell
 * denylist), so a winning `vim` pane is NOT reported as stopped: its screen is
 * scraped, and `working`, `idle`, `needs_you` and `rate_limited` are all
 * reachable from arbitrary text.
 *
 * Typing stays refused (`isAgentPane` is an allowlist), so this misreports
 * rather than misfires — but "the board asserts a state read off a program that
 * is not the agent" is exactly the class of defect this module exists to
 * prevent, and it is a real gap rather than an accepted cost. The fix is for
 * `rank` and `classify` to share one definition of "this pane is not running
 * Claude" instead of holding two; it is not done here because that function is
 * `classify`'s and changing it reaches well past this branch.
 *
 * ⚠️ The ordering principle, and the reason a crashed agent outranks a stranger:
 * **the session name is the only evidence of WHOSE a pane is.** A Claude process
 * in a session we cannot name is somebody else's Claude. So every named-ours
 * pane, including one that has crashed to a shell, beats an unnamed one — which
 * is also the case restart exists for.
 *
 * This does NOT re-couple anything to Discord. A non-Discord agent still ranks
 * (tier 3), still appears, and is still typeable. The name only settles a TIE
 * against a same-named session that does carry the suffix.
 */
const RANK_NAMED_RUNNING = 0;   // ours by name, definitely Claude
const RANK_NAMED_CRASHED = 1;   // ours by name, fallen back to a shell
const RANK_NAMED_LEGACY = 2;    // ours by name, ambiguous process (`node`)
const RANK_INFERRED = 3;        // not ours by name; a Claude process says maybe
const RANK_NONE = 4;

function rank(pane) {
  if (isNamedOurs(pane)) {
    if (isNativeClaude(pane && pane.command)) return RANK_NAMED_RUNNING;
    // `isAgentSession` accepts these too, but they are weaker: `node` is what a
    // dev server looks like, and inside our own session it must not outrank the
    // pane that is unambiguously Claude.
    if (isAgentSession(pane)) return RANK_NAMED_LEGACY;
    return RANK_NAMED_CRASHED;
  }

  if (isAgentSession(pane)) return RANK_INFERRED;
  return RANK_NONE;
}

/** `<window>.<pane>` as a sortable number pair. */
function paneOrder(id) {
  const [w, p] = String(id || '').split('.');
  return (Number(w) || 0) * 10000 + (Number(p) || 0);
}

function onePanePerSession(panes) {
  const bySession = new Map();
  for (const pane of panes) {
    // ⚠️ Keyed on NAME, not session. Every consumer identifies an agent by
    // `name` (the session with `-discord` stripped) — `findAgent`, the card's
    // `data-fresh`, `openFresh`, all `.find()` by name — so deduping by session
    // left the one collision this function exists to prevent wide open:
    // `kappa` and `kappa-discord` are two sessions and ONE name.
    //
    // Measured: both survived as two roster entries called `kappa`, and
    // whichever tmux listed first won every lookup. If the impostor sorted
    // first, the REAL agent's dialog rendered all three options refused with
    // "we are not confident that card is one of your agents" — the exact untrue
    // refusal `isFleetSession` was introduced to eliminate. The two cards also
    // shared a `data-fresh` value and an SVG element id.
    //
    // The preference below already resolves it correctly once they collide:
    // the real agent pane wins over the shell.
    const key = pane.name;
    const held = bySession.get(key);
    if (!held) { bySession.set(key, pane); continue; }

    if (rank(pane) < rank(held)
      || (rank(pane) === rank(held) && paneOrder(pane.pane) < paneOrder(held.pane))) {
      bySession.set(key, pane);
    }
  }
  return [...bySession.values()];
}

/**
 * Where a pane's visible text comes from. The companion to `setPaneSource`.
 *
 * ⚠️ Both seams exist for one reason, and it is a coverage reason rather than a
 * convenience one. Every test of this feature's safety surface sourced its
 * agent from the LIVE roster, so on a machine without a running fleet the whole
 * surface skipped and the suite still reported green: measured at 19 skips,
 * including the cross-site guard, the confirmation token, the alias guard, the
 * `mayTypeInto` call site and the tombstone. A suite that passes on a laptop
 * with no agents while testing none of the dangerous paths is worse than one
 * that fails.
 *
 * `setPaneSource` alone was not enough: a synthetic pane has no real tmux
 * session, so `capturePane` returns null and every agent classifies `unknown`,
 * which the action routes correctly refuse. Both halves are needed to describe
 * an agent that is idle and actionable.
 *
 * Read-only, like its companion: this replaces where the TEXT comes from and
 * nothing about what is done with it, so neither seam can reach an agent.
 */
let paneCapture = null;

function setPaneCapture(fn) { paneCapture = typeof fn === 'function' ? fn : null; }

function capturePane(target, lines = 40) {
  if (paneCapture) return paneCapture(target, lines);
  return sh('tmux', ['capture-pane', '-p', '-t', target, '-S', `-${lines}`]);
}

/**
 * Is a Claude process running in this pane at all?
 *
 * pane_current_command reports a version string ("2.1.222") when Claude Code
 * is running, and a shell name when it is not. That distinguishes running from
 * stopped and nothing else -- it cannot tell working from idle from blocked.
 */
// ⚠️ DERIVED, not a second rule. This was a denylist of six shell names, which
// made every editor, REPL and login shell read as a running Claude. See
// `isClaudeCommand` for what that cost.
function isClaudeRunning(command) {
  return isClaudeCommand(command);
}

/**
 * Braille spinner frames. Claude Code animates these in the pane title while
 * it is actively producing output, so their presence is a live "working"
 * signal. Their absence is NOT evidence of idleness -- we may simply have
 * sampled between frames.
 */
const SPINNER = /[⠀-⣿]/;

const NEEDS_YOU_MARKERS = [
  /Do you want to proceed/i,
  /Would you like to/i,
  /\bAllow\b.*\?/,
  /permission to/i,
  /❯\s*1\.\s*Yes/,
];

const RATE_LIMIT_MARKERS = [
  /rate limit/i,
  /usage limit/i,
  /\b429\b/,
  /try again (later|at)/i,
];

/**
 * Classify one pane.
 *
 * Ordered most-certain first. Anything that does not match a rule falls
 * through to UNKNOWN on purpose; that is the honest answer and it is what
 * stops the board reporting health it has not verified.
 */
function classify(pane, paneText) {
  if (!isClaudeRunning(pane.command)) {
    return { state: STATE.STOPPED, confidence: CONFIDENCE.STRUCTURED, because: 'no Claude process in this pane' };
  }
  if (paneText === null) {
    return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'could not read this pane' };
  }

  const tail = paneText.split('\n').slice(-25).join('\n');

  if (RATE_LIMIT_MARKERS.some((re) => re.test(tail))) {
    return { state: STATE.RATE_LIMITED, confidence: CONFIDENCE.SCRAPED, because: 'the pane mentions a usage limit' };
  }
  if (NEEDS_YOU_MARKERS.some((re) => re.test(tail))) {
    return { state: STATE.NEEDS_YOU, confidence: CONFIDENCE.SCRAPED, because: 'the pane is showing a question' };
  }
  if (SPINNER.test(pane.title)) {
    return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is producing output right now' };
  }
  if (/esc to interrupt/i.test(tail)) {
    return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is mid-task' };
  }
  if (/✱|Worked for|Brewed for|Baked for|to save .* tokens/i.test(tail)) {
    return { state: STATE.IDLE, confidence: CONFIDENCE.SCRAPED, because: 'it finished and is waiting for you' };
  }

  return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'nothing in the pane says what it is doing' };
}

/** The task line Claude Code keeps in the pane title, stripped of glyphs. */
function taskLine(title) {
  const cleaned = (title || '').replace(SPINNER, '').replace(/^[✀-➿\s]+/, '').trim();
  return cleaned || null;
}

/**
 * Current context-window fill, from the session transcript.
 *
 * Deliberately NOT the pane's "/clear to save Nk tokens" figure. That one is
 * cumulative session tokens: it only ever grows, so a ring driven by it would
 * fill once and never empty, and could never show the reset that is the entire
 * point of showing it. This is per-turn window occupancy, which oscillates and
 * therefore actually predicts a reset.
 */
/**
 * Per-model context limits, in tokens.
 *
 * Evidenced, not assumed. Across eight separate opus-4-8 sessions on this
 * machine the window peaks at 999,173 / 999,076 / 998,545 / 998,022 and so on,
 * clustering just under 1,000,000 and never crossing it. That is a 1M window
 * showing itself repeatedly.
 *
 * An earlier version of this file hardcoded 200,000, which was inferred from
 * the largest number seen at the time rather than from evidence. A ring
 * calibrated to it would have put a real agent at 406% and pegged it full
 * forever.
 *
 * A second attempt tried to learn each agent's ceiling from its own history.
 * That was worse and it was visibly worse: for a session still growing, the
 * highest value it has reached IS roughly its current value, so every agent
 * rendered at 100%. Cleverness that produces a uniformly wrong answer is just
 * a slower way to be wrong.
 *
 * Limits are per-model and must stay that way. A Haiku agent genuinely does
 * have a 200k window, so a single global constant would be wrong again in the
 * other direction.
 */
const CONTEXT_LIMITS = {
  'claude-opus-4-8': 1000000, // observed: 8 sessions peaking 996k-999k
};

/**
 * Models we have not directly watched hit their ceiling.
 *
 * Every current-generation model observed here is consistent with 1M and none
 * contradicts it, so this is applied as a labelled assumption rather than
 * withheld. The UI marks it: an assumed denominator is fine to show as long as
 * nobody is told it was measured.
 */
const ASSUMED_LIMIT = 1000000;
const ASSUMED_LIMIT_MODELS = /^claude-(opus|sonnet|fable)-/;

function limitFor(model) {
  if (!model) return null;
  if (CONTEXT_LIMITS[model]) return { limit: CONTEXT_LIMITS[model], assumed: false };
  const undated = model.replace(/-\d{8}$/, '');
  if (CONTEXT_LIMITS[undated]) return { limit: CONTEXT_LIMITS[undated], assumed: false };
  if (ASSUMED_LIMIT_MODELS.test(model)) return { limit: ASSUMED_LIMIT, assumed: true };
  return null;
}



/**
 * Find the transcript belonging to an agent's CURRENT session.
 *
 * The obvious approach -- guess a project directory from the agent's name --
 * silently reads the wrong file. Claude Code creates a project directory per
 * working directory, agents move between directories, and one agent can
 * therefore own transcripts in several places while another agent's directory
 * looks like a plausible match for a name it does not own. That failure is the
 * dangerous kind: it finds *a* transcript, so it looks like it worked, and
 * reports confident numbers from the wrong session.
 *
 * The registry records each agent's live `session_id`, and a transcript is
 * named for its session id. That is an exact identity, not a resemblance, so
 * we resolve by it and search every project directory for the file.
 */
function sessionIdFor(sessionName) {
  for (const root of configRoots()) {
    const file = path.join(root, 'agent-registry', `${sessionName}-discord_0.0.json`);
    try {
      const id = JSON.parse(fs.readFileSync(file, 'utf8')).session_id;
      if (id) return id;
    } catch { /* try the next root */ }
  }
  return null;
}

function transcriptFor(agentName) {
  const sessionId = sessionIdFor(agentName);
  if (!sessionId) return null;

  for (const root of configRoots()) {
    const projects = path.join(root, 'projects');
    let dirs;
    try {
      dirs = fs.readdirSync(projects);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const candidate = path.join(projects, d, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // No registry entry, or its session has gone. We deliberately do NOT fall
  // back to guessing by name: a wrong transcript produces confident numbers
  // about the wrong conversation, which is worse than no numbers at all.
  return null;
}

/** Read the tail of a file without loading all of it. Transcripts reach 8MB+. */
function tailBytes(file, bytes = 262144) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function readContext(agentName, model) {
  const file = transcriptFor(agentName);
  if (!file) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'no transcript found' };
  }
  const text = tailBytes(file);
  if (!text) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'could not read the transcript' };
  }

  const usages = [...text.matchAll(/"usage":\{([^}]*)\}/g)];
  if (!usages.length) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'no usage data in the transcript' };
  }

  const num = (blob, key) => {
    const m = blob.match(new RegExp(`"${key}":(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  const last = usages[usages.length - 1][1];
  const tokens = num(last, 'input_tokens') +
                 num(last, 'cache_creation_input_tokens') +
                 num(last, 'cache_read_input_tokens');

  if (!tokens) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'usage data was empty' };
  }

  const found = limitFor(model);
  const ceiling = found && found.limit;

  if (!ceiling) {
    return {
      tokens,
      percent: null,
      ceiling: null,
      ceilingSource: null,
      confidence: CONFIDENCE.STRUCTURED,
      because: `measured, but we do not know how much ${model || 'this model'} can hold`,
    };
  }

  const percent = Math.round((tokens / ceiling) * 100);
  return {
    tokens,
    percent: Math.min(100, percent),
    overCeiling: percent > 100,
    ceiling,
    ceilingAssumed: found.assumed,
    confidence: CONFIDENCE.STRUCTURED,
    because: found.assumed
      ? 'measured, against a limit we have assumed rather than watched'
      : 'measured, against a limit we have watched it hit',
  };
}

/**
 * Model IDs as a person should read them.
 *
 * An explicit table, not a transform. A dash-to-space rule looks fine on
 * `claude-opus-5` and then ships a visible bug on `claude-haiku-4-5`, which
 * would render "Haiku 4 5" when the last two segments are a decimal. Version
 * numbers are not word separators.
 *
 * We deliberately do not ask the Models API for display names, even though it
 * has this exact field: that call needs an API key, and the rule the whole cost
 * model rests on is that this platform never talks to the API directly. Not
 * worth breaking for a label.
 *
 * An ID we do not recognise renders raw. New models ship often, and an
 * unfamiliar accurate name beats a confident wrong one -- the same rule the
 * status board follows.
 */
const MODEL_NAMES = {
  'claude-opus-5': 'Claude Opus 5',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
};

function modelDisplayName(id) {
  if (!id) return null;
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  // Dated IDs (…-20251001) are the same model with a snapshot suffix.
  const undated = id.replace(/-\d{8}$/, '');
  if (MODEL_NAMES[undated]) return MODEL_NAMES[undated];
  return id;
}

function readModel(agentName) {
  const file = transcriptFor(agentName);
  if (!file) return { model: null, confidence: CONFIDENCE.NONE };
  const text = tailBytes(file, 65536);
  if (!text) return { model: null, confidence: CONFIDENCE.NONE };
  const matches = [...text.matchAll(/"model":"([^"]+)"/g)];
  if (!matches.length) return { model: null, confidence: CONFIDENCE.NONE };
  return { model: matches[matches.length - 1][1], confidence: CONFIDENCE.STRUCTURED };
}

/**
 * Who the agent actually is, as opposed to what the machine calls it.
 *
 * `claudebot` is Splinter. `angel` is Angel Bridge. The tmux session name is an
 * infrastructure identifier and showing it to a person is a small lie of
 * omission -- it is the name of a process, not the name of a colleague.
 *
 * On this fleet the real name lives in the agent's own instruction file, which
 * is fitting: that file is the source of truth for who the agent is, and it is
 * the same file the agent-detail screen is built around. In the product proper
 * this is just a field somebody typed when they created the agent.
 *
 * Where it cannot be derived we show the raw session name and say so, rather
 * than inventing something friendlier.
 */
/**
 * Where worker directories live.
 *
 * ⚠️ Honours `AGENT_WORKFORCE_WORKERS` because `engine/instructions.js` does,
 * and these two must be the SAME root. They were not: this one was hardcoded,
 * so relocating the variable moved the instruction READ and WRITE while leaving
 * `readIdentity` pointed at the operator's live `~/work/workers`. A test suite
 * that believed it was sandboxed was still reading real agents' files, and the
 * sandbox comment in server.test.js said so in good faith while being wrong.
 *
 * ⚠️ The ROOT is now shared. The per-agent SEGMENT still is not: `readIdentity`
 * below joins the verbatim `sessionName`, while `instructions.fileFor` joins
 * `safeKey(sessionName)`. For any agent whose session name is not already its
 * own sanitised form, those two resolve to different directories, so the board
 * can show a derived name and role read from one file while staleness reports
 * on another.
 *
 * ⚠️ An earlier version of this said "it fails safe in both directions". That
 * is false, and the correction matters because the unsafe direction is a
 * CROSS-AGENT WRITE. Measured with two agents whose names collide under
 * `safeKey` (`mybot` and `my.bot`), each with its own worker directory:
 * `readIdentity('my.bot')` read `my.bot`'s file, while `fileFor('my.bot')`
 * resolved to `mybot`'s, `read` returned `mybot`'s text and `staleness`
 * returned a confident `current` computed from it. `knownAgent` compares
 * `sessionName === safeKey(name)`, so `PUT /api/agent/my.bot/instructions`
 * passes the gate and rewrites `mybot`'s boot file.
 *
 * There are no such collisions on this machine, checked rather than assumed,
 * and `server.js` states the same risk accurately at `knownAgent`. The real fix
 * is one identity per agent instead of a name sanitised in one place and taken
 * verbatim in another, which reaches the avatar and profile stores too.
 */
const WORKERS_DIR = process.env.AGENT_WORKFORCE_WORKERS || path.join(HOME, 'work', 'workers');

/**
 * Explicit overrides for agents whose identity is not derivable.
 *
 * Convention holds for twelve of the thirteen here. The thirteenth predates the
 * convention and is inconsistent at every layer: tmux says `claudebot-discord`,
 * its launch script is `launch-discord-bot.sh`, its config dir is
 * `channels/discord`, its launchd job is `com.claudebot.discord`, and the person
 * using it calls it Splinter. Five identifiers, none of them "splinter".
 *
 * Deriving from any single layer produces a confident wrong answer -- the config
 * dir would name it "discord". So exceptions are listed, not inferred. In the
 * product proper this whole file collapses into a field somebody typed.
 */
const IDENTITY_OVERRIDES = {
  claudebot: { displayName: 'Splinter', role: 'Project Manager' },
};

function readIdentity(sessionName) {
  const override = IDENTITY_OVERRIDES[sessionName];
  if (override) return { ...override, derived: true, source: 'override' };

  const file = path.join(WORKERS_DIR, sessionName, 'CLAUDE.md');

  // ⚠️ Through the SHARED reader, not a local `readFileSync`.
  //
  // This was the sixth instance of one defect on this branch: a second reader
  // of the workers directory with fewer guards than the first. It followed a
  // symlinked worker folder, then, once that was fixed, still followed a
  // symlinked CLAUDE.md and served a name parsed out of a file outside the
  // root, while the instructions route for the same agent correctly refused.
  // It also blocked FOREVER on a fifo, and because `knownAgent` calls
  // `snapshot()`, that wedged every route on the server with no crash to say
  // why. Both measured, not theorised.
  //
  // The guards are no longer duplicated here, because duplicating them is what
  // kept going wrong. `engine/workerfile.js` sits below both modules on purpose:
  // `instructions.js` already requires this one, so anything shared has to live
  // underneath or the require becomes a cycle.
  const got = readWorkerFile(file, WORKERS_DIR);
  if (!got.ok) return { displayName: sessionName, role: null, derived: false };
  const text = got.buf.toString('utf8').slice(0, 4000);

  const m = text.match(/You are \*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?\s*,?\s*([^.\n]*)/);
  if (!m) return { displayName: sessionName, role: null, derived: false };

  const displayName = m[1].trim();
  let role = (m[3] || '')
    .replace(/\*\*/g, '')          // instruction files are markdown; strip emphasis
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^Josh Stone's\s+/i, '')
    .split(/\s+in the\s+|,/)[0]
    .trim();
  if (role.length > 60) role = role.slice(0, 60).trim();

  return { displayName, role: role || null, derived: true };
}

function safeAvatar(name) {
  try { return store.avatarPath(name); } catch { return null; }
}

function snapshot() {
  const panes = onePanePerSession(listPanes());
  const agents = panes.map((pane) => {
    const text = capturePane(pane.target);
    const status = classify(pane, text);
    const { model } = readModel(pane.name);
    const context = readContext(pane.name, model);
    const identity = readIdentity(pane.name);
    return {
      name: identity.displayName,
      sessionName: pane.name,
      nameDerived: identity.derived,
      role: identity.role,
      target: pane.target,
      // ⚠️ Whether this pane is one an action may be typed into. `list-panes -a`
      // returns every pane on the machine, so the roster alone is not evidence
      // that a pane holds an agent, and `/clear` typed into a shell is executed
      // rather than read as a command.
      isAgentPane: isAgentPane(pane),
      // Restart needs this one, not the copy-mode-sensitive one above.
      isAgentSession: isAgentSession(pane),
      // ⚠️ NOT "the suffix alone", and NOT what restart asks — this comment said
      // both and neither is true. It is suffix OR a live Claude process, and
      // restart's effective gate is `isNamedOurs` below, because restart reaches
      // the launchd service rather than the pane. This is kept because the UI
      // distinguishes "one of ours" from "an agent we inferred".
      isFleetSession: isFleetSession(pane),
      // ⚠️ Whether the SESSION NAME ties this pane to the fleet's record for
      // this name — as opposed to us having merely inferred an agent from a
      // Claude process. The distinction exists because a card's name addresses
      // THREE different objects: the tmux pane, the launchd service
      // (`com.<name>.discord`, what restart acts on), and the commitment record.
      // Only the suffixed session name is evidence that all three are the same
      // agent. Without it we may still show the pane and type into it — it is
      // the pane the operator clicked — but we must not act on the service or
      // claim to have destroyed the record, because those belong to whoever
      // owns the NAME and this pane has not proven it is them.
      isNamedOurs: isNamedOurs(pane),
      task: taskLine(pane.title),
      state: status.state,
      stateConfidence: status.confidence,
      because: status.because,
      context,
      model,
      modelName: modelDisplayName(model),
      // Things a person set, which the machine cannot derive. Role in
      // particular: nothing on this machine records what an agent *is*.
      hasAvatar: Boolean(safeAvatar(pane.name)),
      profile: store.readProfile(pane.name),
    };
  });

  agents.sort((a, b) => a.name.localeCompare(b.name));

  return {
    // Freshness is not decoration. An ambient display gets trusted passively,
    // and silence from it reads as "all fine". If this poller dies, the UI can
    // show the stamp going stale instead of freezing on a happy picture.
    checkedAt: new Date().toISOString(),
    counts: {
      total: agents.length,
      needsYou: agents.filter((a) => a.state === STATE.NEEDS_YOU).length,
      unknown: agents.filter((a) => a.state === STATE.UNKNOWN).length,
      unreadableTokens: agents.filter((a) => a.context.tokens === null).length,
      unknownFullness: agents.filter((a) => a.context.percent === null).length,
    },
    agents,
  };
}

// `transcriptFor` is exported for the instructions module, which needs a
// session start time. It resolves by session id rather than by guessing a
// directory from the agent's name, for the reason its own comment gives: a
// guess finds *a* transcript every time, so it looks like it worked while
// reporting from the wrong session. One derivation, shared, rather than a
// second copy that can drift.
module.exports = { snapshot, classify, modelDisplayName, readIdentity, transcriptFor, isAgentPane, isAgentSession, isFleetSession, parsePanes, onePanePerSession, setPaneSource, setPaneCapture, PANE_FORMAT, PANE_COLUMNS, STATE, CONFIDENCE, CONTEXT_LIMITS };

if (require.main === module) {
  process.stdout.write(JSON.stringify(snapshot(), null, 2) + '\n');
}
