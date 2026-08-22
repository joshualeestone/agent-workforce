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
  // ⚠️ An override, so a test can point this at a sandbox. Without one, the
  // only way to give a fixture a registry entry and a transcript was to write
  // into the operator's REAL `~/.claude` — which the test suite did: it planted
  // a phantom `ghostly-discord_0.0.json` beside fifteen live agents and a
  // phantom `projects/seeded/` directory, and removed neither. Fleet tooling
  // that scans `agent-registry` would have picked it up.
  //
  // Worse for the suite itself: because the files persisted between runs, the
  // test's own anti-vacuity check ("the fixture stopped seeding, so these nulls
  // are vacuous again") passed off the PREVIOUS run's leftovers. Deleting the
  // seeding would have left the suite green forever on any machine that had run
  // it once.
  if (process.env.AGENT_WORKFORCE_CONFIG_ROOT) {
    return [process.env.AGENT_WORKFORCE_CONFIG_ROOT];
  }
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
/**
 * The sentences a person reads when we cannot see what an agent has been doing.
 *
 * 🔑 ONE SET, SHARED BY EVERY PROVIDER, and that is the point rather than tidiness.
 * A reason is about the AGENT, not about the runtime underneath it: "we cannot
 * find a transcript for it" is equally true of a Claude agent and a Codex one,
 * in the same words. The moment the two paths phrase it differently, the board
 * speaks two dialects about one fact and a person can tell which provider an
 * agent runs on from an ERROR MESSAGE.
 *
 * ⚠️ AND NO PRODUCT NAME BELONGS IN THEM. Somebody chose a provider on one
 * screen an hour ago; they did not sign up to learn what Codex calls its files.
 * The Claude path has never said "Claude" here either, and that was not an
 * accident. (Mona Lisa, on the OpenAI phase: the principle, not a copy nit.)
 */
const NO_READING = {
  NO_TRANSCRIPT: 'we cannot find a transcript for it',
  UNREADABLE: 'could not read the transcript',
};

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
  const got = shDetail(cmd, args);
  return got.ran && got.status === 0 ? got.out : null;
}

/**
 * The same call, with the outcome kept rather than flattened to `null`.
 *
 * ⚠️ `sh` throwing everything away is what made "there are no sessions"
 * indistinguishable from "we could not ask", and this module's whole reason for
 * existing is that those are different facts. `execFileSync` throws on a
 * non-zero exit AND on a failed spawn, so the catch could not tell a tmux that
 * ANSWERED from a tmux that is not installed.
 *
 * `ran` is the distinction: a process that started and exited has a numeric
 * `status`, and one that never started (ENOENT) or was killed by the timeout
 * does not.
 */
function shDetail(cmd, args) {
  try {
    return { ran: true, status: 0, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }), err: '' };
  } catch (e) {
    const status = e && typeof e.status === 'number' ? e.status : null;
    return {
      ran: status !== null,
      status,
      out: (e && e.stdout && e.stdout.toString()) || '',
      err: (e && e.stderr && e.stderr.toString()) || '',
    };
  }
}

/**
 * Did tmux ANSWER, and answer that there is nothing to list?
 *
 * ⚠️ A REAL PRODUCT STATE, and refusing it was a regression this branch
 * introduced while fixing its mirror image. `tmux list-panes -a` exits 1 with
 * "no server running on …" / "error connecting to …" when no tmux server is up
 * — which is the NORMAL state of a machine that has tmux installed and no
 * agents running yet. That is precisely the first-run machine this product
 * exists for.
 *
 * Before this, `sh` flattened that to `null` and `listPanes` threw, so a person
 * who had installed Kosmos and not yet created an agent got "we cannot read the
 * agents right now" — the board refusing to speak about a machine it had
 * successfully looked at. The earlier fix corrected one false claim ("0 agents,
 * checked just now" when tmux was unreachable) by minting its mirror image.
 *
 * ⚠️ IT IS A FACT ABOUT THE SOCKET WE ASKED, not about the machine. "No server
 * on the socket this process would use" is read here as "no agents", which is
 * sound today because nothing in production passes `-L` or sets `TMUX_TMPDIR`
 * (`bin/agent-supervisor.sh` uses the default socket, and so does this module).
 * Said out loud because the day those disagree, this converts "I am looking at a
 * different socket" into a confident empty board — the exact conversion this
 * module exists to prevent, arriving through its own fix for it.
 *
 * ⚠️ MATCHED ON TMUX'S OWN MESSAGE, not on the exit code alone. Exit 1 also
 * covers errors we have no business reading as an empty machine, so anything
 * that is not recognisably "there is no server" still refuses. Measured on
 * this machine: `tmux -L <unused> list-panes -a` exits 1 with
 * "error connecting to /private/tmp/tmux-501/<unused> (No such file or
 * directory)".
 */
function tmuxSaidNoServer(got) {
  if (!got || !got.ran || got.status === 0) return false;
  const err = String(got.err || '');
  // ⚠️ "error connecting to" ALONE IS TOO LOOSE, and the first version of this
  // guard used it. tmux prints that line for any socket it cannot reach, so
  // `error connecting to <socket> (Permission denied)` — a socket owned by
  // somebody else — would have read as "this machine has no agents". That is
  // the same cannot-see-reported-as-nothing failure this function exists to
  // fix, rebuilt inside the fix. Only the No-such-file variant is evidence that
  // there is no server, so only it is accepted.
  //
  // MEASURED, and it is why the qualifier matters: a tmux socket directory with
  // wrong permissions answers "directory … has unsafe permissions", which
  // matches neither branch and correctly stays a refusal.
  return /no server running/i.test(err)
    || (/error connecting to/i.test(err) && /no such file or directory/i.test(err));
}

/**
 * The raw `list-panes` text, an empty listing, or `null` for "we could not ask".
 *
 * One derivation, shared by `listPanes` and `paneRoster`, because two readers of
 * the same question drifting apart is this codebase's worst habit and these two
 * have already drifted once.
 */
function tmuxPanes() {
  const got = shDetail('tmux', ['list-panes', '-a', '-F', PANE_FORMAT]);
  if (got.ran && got.status === 0) return got.out;
  // ⚠️ An empty STRING, not null. `readPanes('')` is zero panes and zero
  // rejects, which is the honest reading of "tmux answered, and there are no
  // sessions" — and it is a different value from the `null` that means we never
  // got an answer.
  if (tmuxSaidNoServer(got)) return '';
  return null;
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
  return isUnambiguousClaude(c) || c === 'node';
}

/**
 * Claude, with no other plausible reading of the command name.
 *
 * ⚠️ The distinction that matters to `rank`: `node` is shared with every dev
 * server, REPL and build watcher on the machine, so it cannot outrank an
 * agent's own crashed shell. A version string, `claude` and `claude.exe` are
 * shared with nothing, so they must.
 */
function isUnambiguousClaude(command) {
  const c = String(command || '').trim();
  return isNativeClaude(c) || c === 'claude' || c === 'claude.exe';
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
  // ⚠️ The CLAIM, and it must sit before `title` — `title` is `rest: true`, so
  // it absorbs every remaining tab and anything after it would be swallowed.
  //
  // This is a tmux user option Kosmos sets on the session it creates. It reports
  // empty for every session that does not have one, which is what makes it
  // evidence rather than a naming convention.
  { key: 'claim', fmt: '#{@kosmos_agent}' },
  { key: 'title', fmt: '#{pane_title}', rest: true },
];

const PANE_FORMAT = PANE_COLUMNS.map((c) => c.fmt).join('\t');

/**
 * Is this line actually a pane, or something we cannot read?
 *
 * ⚠️ `PANE_FORMAT` is TAB-separated, and when the separator is absent every
 * field but the first is missing — so the whole line landed in `session` and
 * the rest defaulted, producing a syntactically valid agent whose name was the
 * entire raw line and whose target was `<whole line>:undefined`.
 *
 * That is not hypothetical. It happened on this machine: without a UTF-8
 * locale, **tmux sanitises its own format output** and replaces the tabs with
 * underscores (bisected: `PATH` alone gives mangled output, `PATH`+`LANG`
 * gives correct). The board then showed thirteen agents named
 * `angel-discord_0.0_2.1.223_0__ …` — populated, confident, and wrong, with
 * those entries carrying a name, a rank and a target into everything
 * downstream, where `safeKey` would happily sanitise one into a collision with
 * a real agent's key.
 *
 * ⚠️ THE RULE IS "IS THE SESSION A FIELD", NOT "ARE ALL THE FIELDS THERE", and
 * the difference is a decision, not an oversight.
 *
 * Requiring every column would also reject a TRUNCATED line — and this module
 * deliberately keeps those. A short line still names a session we can identify,
 * and the missing fields default to the UNSAFE answer (`inMode` defaults to in
 * copy-mode, a missing `command` classifies `unknown` rather than `stopped`),
 * which is handled and tested. Dropping them would hide a running agent from
 * the board, which is the same class of harm as showing a garbage one, pointed
 * the other way.
 *
 * What makes the mangled line different is that NOTHING about it can be
 * identified: with no separator at all, `session` is the whole line, so there is
 * no agent to be conservative about.
 *
 * ⚠️ "A separator somewhere" is NOT enough, and the first version of this rule
 * was exactly that. `title` is the one field that can itself contain a tab (see
 * the format note above, and the test for tab-carrying titles), so a mangled
 * line whose title happened to hold one sailed through and produced the very
 * garbage agent this exists to reject — reproduced: a line reading
 * `angel-discord_0.0_…_ Working<tab>on<tab>the thing` parsed as an agent named
 * `angel-discord_0.0_…_ Working`, with `rejected: 0`, so nothing refused and
 * nothing was counted.
 *
 * So the second field is CHECKED FOR SHAPE. `#{window_index}.#{pane_index}`
 * is always two integers separated by a dot, tmux always produces it, and no
 * mangled line can fake it. A truncated `session<tab>0.0` still passes, which
 * keeps the deliberate policy above intact.
 *
 * ⚠️ A mistake in OUR OWN format string is a different problem and is not
 * caught here. It is also not constructible in the form the issue imagined:
 * `PANE_FORMAT` is derived by joining `PANE_COLUMNS` with a tab, so a `\t`
 * cannot be dropped from it by hand. What can happen is a column being added,
 * removed or reordered, and the round-trip test over a hand-built line catches a
 * merge or a reorder — though not an appended column, which nothing currently
 * would. That is a gap in the tests rather than something this guard should
 * try to cover.
 */
const PANE_INDEX_SHAPE = /^\d+\.\d+$/;

function isParseable(line) {
  const parts = String(line).split('\t');
  return parts.length > 1 && PANE_INDEX_SHAPE.test(parts[1]);
}

/**
 * Parse `list-panes -F PANE_FORMAT` output, and say what could not be read.
 *
 * ⚠️ REJECTING IS ONLY HALF THE FIX, and the missing half is the one that cost
 * fourteen hours. Dropping unreadable lines silently turns "tmux told us
 * something we cannot understand" into "there are no agents" — which is exactly
 * what the board displayed, all night, while thirteen agents were running. An
 * empty board and an unreadable one look identical and mean opposite things.
 *
 * So the count travels with the panes, and `listPanes` refuses rather than
 * serving an empty fleet it cannot vouch for.
 */
function readPanes(out) {
  if (!out) return { panes: [], rejected: 0 };
  const lines = out.trim().split('\n').filter(Boolean);
  // ⚠️ Counted from what actually PARSED, not from a second application of the
  // filter. Two derivations of "how many did we lose" can drift the moment
  // `parsePanes` drops a line for any other reason.
  const panes = parsePanes(out);
  return { panes, rejected: lines.length - panes.length };
}

/**
 * Parse `list-panes -F PANE_FORMAT` output. Pure, so it can be tested.
 *
 * ⚠️ It DROPS lines it cannot read (see `isParseable`) and says nothing about
 * how many. That silence is the fourteen-hour failure in miniature, so anything
 * that needs to tell "no agents" from "an answer we could not read" must use
 * `readPanes`, which returns the count alongside.
 */
function parsePanes(out) {
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).filter(isParseable).map((line) => {
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
      // ⚠️ `null`, not `''`. An empty string reaches `classify` as "not a Claude
      // command", which answers `stopped` at STRUCTURED confidence — a
      // confident structural claim that an agent is not running, derived
      // entirely from a field that was MISSING. That is the move the `inMode`
      // default three lines below explicitly refuses, made in the same
      // function.
      // ⚠️ Empty counts as absent, matching the `inMode` default below rather
      // than merely claiming to. The first version handled only `undefined`, so
      // a dead or `remain-on-exit` pane reporting an EMPTY command still
      // reached `classify` as "not Claude" and answered `stopped` at
      // STRUCTURED confidence — the same confident claim from no information,
      // in the same function, under a comment asserting parity it did not have.
      command: raw.command == null || raw.command === '' ? null : raw.command,
      // '1' when the pane is scrolled back in copy-mode, where keystrokes go to
      // copy-mode bindings rather than to the composer.
      //
      // ⚠️ Defaults to '1' (in copy-mode), not '0'. A truncated or malformed
      // line leaves this undefined, and defaulting to '0' meant "not in copy
      // mode, safe to type" — asserting the safe answer from an absence of
      // information, which is the one thing this codebase refuses to do.
      inMode: raw.inMode === undefined || raw.inMode === '' ? '1' : raw.inMode,
      // ⚠️ Kosmos's claim on the session. Empty for every session it did not
      // create, which is what makes it evidence rather than a convention.
      //
      // ⚠️ AND THE LESSON: this field existed in `PANE_COLUMNS` and was parsed
      // into `raw` and then **silently dropped**, because this return builds its
      // object by hand. `PANE_COLUMNS` was introduced so the format and the
      // parser could not drift — and the drift moved one step downstream, to
      // the parser and the object it returns. The round-trip test did not catch
      // it because it asserted the fields it already knew about.
      //
      // Adding a column is therefore TWO edits, and the test below now asserts
      // that every column reaches the output so the next one cannot be lost the
      // same way.
      claim: raw.claim || '',
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
  const out = paneSource ? paneSource() : tmuxPanes();
  /**
   * ⚠️ TMUX COULD NOT BE ASKED AT ALL, which is not an empty machine either —
   * and this case was missing while the one below it was carefully handled.
   * `sh` swallows a failed spawn and returns null, so on a machine where tmux
   * is not installed (or not on PATH) `readPanes(null)` produced zero panes and
   * zero rejects, and the board reported a machine with no agents off a look
   * that never happened. That is the exact failure the comment below describes
   * — "a mangled answer and no answer were indistinguishable" — with the third
   * case, NO ANSWER AT ALL, still indistinguishable from an empty fleet.
   *
   * `paneSource` returning null is the same fact from the test seam, so both
   * go through here.
   */
  if (out === null || out === undefined) {
    throw new Error('we could not see what is running on this computer');
  }
  const { panes, rejected } = readPanes(out);

  /**
   * ⚠️ TMUX SPOKE AND WE UNDERSTOOD NONE OF IT. That is not an empty machine,
   * and the difference is the whole reason this module exists.
   *
   * Refusing here reaches the board as its "we cannot read the agents right
   * now" state, which says plainly that it is not claiming they are fine.
   * Returning an empty list instead would render as a machine with no agents —
   * which is what this board showed for fourteen hours while thirteen were
   * running, because a mangled answer and no answer were indistinguishable.
   */
  if (rejected > 0 && panes.length === 0) {
    throw new Error('we could not make sense of what came back');
  }
  // Some read, some did not: the fleet is shown, and the gap is RETURNED
  // alongside it rather than quietly closed, so `snapshot` can put it in the
  // counts. Returned rather than stashed in module state — the first version
  // used a module-level variable and justified it as avoiding a second
  // derivation, which was not true: threading it costs one destructuring and
  // cannot go stale.
  return { panes, rejected };
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
  if (!pane) return false;

  // ⚠️ THE CLAIM ARM, and it is what makes an agent Kosmos creates recognisable.
  //
  // Before this, the only evidence a pane belonged to the name it is filed under
  // was a `-discord` suffix — so an agent Kosmos created itself came back
  // anonymous and unwritable, because it has no reason to carry a naming
  // convention from our dev environment. The gate was right and its only
  // evidence was wrong.
  //
  // The claim is a tmux user option Kosmos sets on the session at creation, and
  // it beats a file on disk in the way that matters: **it dies with the
  // session**. A stranger opening a session with the same name does not inherit
  // it, and there is no stale record to reconcile — the two failure modes a
  // claims file on disk would have had.
  //
  // ⚠️ It must match the pane's own NAME, not merely be present. A claim naming
  // a different agent is somebody else's claim, and reading "has a claim" as
  // "is ours" would be the borrowed-name hole rebuilt out of new parts.
  //
  // ⚠️ KOSMOS writes this, never the agent, and that is a CONVENTION rather
  // than an enforcement — worth stating precisely, because the sentence used to
  // read as a guarantee the mechanism does not provide. Any local process can
  // run `tmux set-option -t <name> @kosmos_agent <name>` and be treated as
  // ours, exactly as any local process can open a session called
  // `<name>-discord` and be treated as ours by the legacy arm below. So this
  // arm is no weaker than the one it extends, and neither is a defence against
  // a process already running as you — which could rewrite the instruction file
  // directly anyway.
  //
  // What the claim actually buys is that it DIES WITH THE SESSION: there is no
  // stale record for a stranger to inherit later, which is the failure a claims
  // file on disk would have had.
  const claim = String(pane.claim || '').trim();
  if (claim && claim === String(pane.name || '')) return true;

  // The legacy arm: the existing fleet carries the suffix and no claim, and
  // must keep working untouched.
  return /-discord$/.test(String(pane.session || ''));
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
 * ⚠️ The tier is WIDER than "a shell": `RANK_NAMED_CRASHED` is every named-ours
 * pane that is not native Claude and not one of the legacy names, so `vim`,
 * `ssh`, `python3`, `less` and `man` all land in it and outrank a `node` pane.
 *
 * That used to matter twice over, because `classify` held a SECOND and looser
 * definition of "no Claude here" — a six-name shell denylist — so a winning
 * `vim` pane was not reported as stopped, its screen was scraped instead, and
 * `idle`, `working`, `needs_you` and `rate_limited` were all reachable from
 * arbitrary text. **That is fixed**: `classify` and `isAgentSession` both derive
 * from `isClaudeCommand` now, and `status.test.js`'s "a crashed agent is
 * reported stopped, not scraped off whatever replaced it" pins it for six
 * commands.
 *
 * ⚠️ This note described that gap as OPEN for one commit after the same commit
 * closed it — a comment claiming a defect that no longer exists, which is the
 * inverse of the failure this file keeps warning about and just as costly: the
 * next reader either chases a phantom or "fixes" it by re-loosening `classify`,
 * which is the actual bug.
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
const RANK_NAMED_RUNNING = 0;   // ours by name, unambiguously Claude
const RANK_NAMED_CRASHED = 1;   // ours by name, fallen back to a shell
const RANK_NAMED_LEGACY = 2;    // ours by name, AMBIGUOUS process — `node` only
/**
 * ⚠️ Everything ours by CLAIM sits below everything ours by SUFFIX, whatever is
 * running in either.
 *
 * The first version of this tie-break only preferred a suffixed pane that was
 * running unambiguous Claude, which left the hole one step along: a real
 * `angel-discord` CRASHED to a shell ranks `NAMED_CRASHED`, and a claimed
 * impostor running Claude ranks `NAMED_RUNNING`, so the impostor still won the
 * name. Measured — the roster came back with the impostor alone, and the real
 * agent was off the board.
 *
 * That case is the worst one available: the crash is hidden on the very card
 * whose Restart button exists for it, and `knownAgent` is satisfied through the
 * impostor, so a write still reaches the REAL agent's boot file while the
 * screen shows somebody else's pane. Under `main`'s ladder the crashed real
 * agent kept its card; the claim arm is what put it at risk, so the offset is
 * unconditional rather than conditional on what the impostor happens to run.
 *
 * Within either group the order is unchanged, and a claimed agent with no
 * suffixed twin — every agent this product creates — is unaffected, because the
 * offset applies uniformly to every pane in its name group.
 */
const RANK_CLAIM_ONLY = 3;      // added to any named-ours pane with no suffix
const RANK_INFERRED = 7;        // not ours by name; a Claude process says maybe
const RANK_NONE = 8;

function rank(pane) {
  if (isNamedOurs(pane)) {
    /* ⚠️ THE SUFFIXED PANE WINS A TIE, and adding the claim arm is what made
     * that necessary.
     *
     * `onePanePerSession` keys on the board NAME, and `angel` and
     * `angel-discord` are one name. Before the claim existed only the suffixed
     * session could be "ours", so the tie could not arise. Now any local
     * process can run `tmux new -s angel` and `set-option @kosmos_agent angel`,
     * and both panes rank identically at pane 0.0 — so the winner was whichever
     * tmux happened to list first. Measured on this code: the roster came back
     * with ONE entry, the impostor's, and the real agent was not on the board
     * at all. Everything keyed on the name then followed it: the instruction
     * reads and writes, and the name-keyed gates.
     *
     * A claim is set by us but is not unforgeable — any process running as this
     * user can set the same option. The suffix is the fleet's own convention
     * and is the older, established tie. So when both say "ours", the suffixed
     * one is the agent, and the claim is what recognises the agents WE create,
     * which by construction have no suffixed twin.
     */
    // ⚠️ `claude` and `claude.exe` belong UP HERE with the version string, not
    // down with `node`. Demoting the whole legacy set below a crashed shell
    // over-corrected: `node` is ambiguous because a dev server looks identical,
    // but a pane whose command is literally `claude` is not ambiguous at all.
    // Measured after the first version of this swap: `zeta-discord:0.0 zsh`
    // plus `zeta-discord:0.1 claude` picked the SHELL, so a healthy running
    // agent was reported dead and Clear and Compact were refused for it — and
    // `classify` disagreed, reporting `claude` as running. One fact, two
    // answers, in the two functions this file most recently unified.
    // The suffix is the fleet's own convention and cannot be taken by setting
    // an option; a claim can. So a pane claiming a name it does not carry sits
    // below every pane that carries it, whatever either is running.
    const byClaimOnly = /-discord$/.test(String(pane.session || '')) ? 0 : RANK_CLAIM_ONLY;

    if (isUnambiguousClaude(pane && pane.command)) return RANK_NAMED_RUNNING + byClaimOnly;
    // `isAgentSession` accepts these too, but they are weaker: `node` is what a
    // dev server looks like, and inside our own session it must not outrank the
    // pane that is unambiguously Claude.
    if (isAgentSession(pane)) return RANK_NAMED_LEGACY + byClaimOnly;
    return RANK_NAMED_CRASHED + byClaimOnly;
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

// Frozen (round 29): this is exported as the live array the classifier
// itself reads, so a consumer pushing into it would rewrite the board's
// definition of needs_you from outside. Freezing makes the one-derivation
// contract structural instead of conventional.
const NEEDS_YOU_MARKERS = Object.freeze([
  /Do you want to proceed/i,
  /Would you like to/i,
  /\bAllow\b.*\?/,
  /permission to/i,
  /❯\s*1\.\s*Yes/,
]);

/**
 * 🛑 THE FIRST FOUR WERE GUESSES AT WORDING AND CLAUDE CODE SAYS SOMETHING ELSE.
 *
 * Josh, 2026-08-21, from the raw window of an agent that could not answer him:
 *
 *   You've reached your Fable 5 limit. Run /usage-credits to continue or
 *   switch models with /model.
 *
 * None of `rate limit`, `usage limit`, `429` or `try again later` appears in
 * that sentence — it says usage-CREDITS, not usage limit — so the agent
 * classified as IDLE. Her card read Idle while she was blocked and could not
 * work, which is the board reporting health it has not verified, the one thing
 * `classify` exists to prevent.
 *
 * ⚠️ THE LAST TWO ARE OBSERVED AND THE FIRST FOUR ARE NOT. Nobody has produced
 * a pane containing "rate limit" or "429"; they are plausible strings somebody
 * wrote down. These two came off a screenshot of the real thing. Add to the
 * observed half by observing — the guesses are 0 for 1 against reality.
 *
 * 📌 Broad on the model name (`reached your … limit`) because the vendor puts
 * the model in the middle of it, and narrow on `/usage-credits`, a literal
 * command string that cannot appear by accident. Neither widens the false
 * positives: a pane merely DISCUSSING rate limits already matched `/rate limit/`
 * before this change, which is why 0.2.20 made the card say what it SAW
 * ("its screen mentions a usage limit") rather than what it concluded.
 */
const RATE_LIMIT_MARKERS = [
  /rate limit/i,
  /usage limit/i,
  /\b429\b/,
  /try again (later|at)/i,
  /reached your .{0,40}limit/i,   // observed 2026-08-21
  /\/usage-credits\b/,            // observed 2026-08-21
];

/**
 * The first line of `text` that any of `markers` matches, or null.
 *
 * ⚠️ RETURNS THE LINE, NOT A BOOLEAN, so a caller can show what it saw rather
 * than assert what it concluded. Trimmed of the tree-drawing glyphs Claude Code
 * prefixes its own notices with, and capped: pane text is arbitrary and this is
 * on its way to a person's screen.
 */
function matchedLine(text, markers) {
  const lines = String(text == null ? '' : text).split('\n');
  for (const raw of lines) {
    if (!markers.some((re) => re.test(raw))) continue;
    const line = raw.replace(/^[\s>│├└─*]+/, '').trim();
    if (!line) continue;
    return line.length > 240 ? line.slice(0, 240) + '…' : line;
  }
  return null;
}

/**
 * Classify one pane.
 *
 * Ordered most-certain first. Anything that does not match a rule falls
 * through to UNKNOWN on purpose; that is the honest answer and it is what
 * stops the board reporting health it has not verified.
 */
function classify(pane, paneText) {
  // ⚠️ A MISSING command is not evidence of anything. A truncated tmux line
  // gave `command: ''`, which fell through to "Claude is not running for this one"
  // — `stopped` at STRUCTURED confidence, i.e. a confident structural claim
  // built from a field that was not there. `unknown` is the honest answer, and
  // it is the rule the rest of this module runs on.
  if (pane && pane.command == null) {
    return {
      state: STATE.UNKNOWN,
      confidence: CONFIDENCE.NONE,
      because: 'we could not tell what it is doing',
    };
  }
  // ⚠️ FIRST, before the screen is read at all. `classify` consulted only
  // `pane.command`, so a session this engine has explicitly rejected still got
  // a scraped state: measured, a lone `devserver` running `node` with
  // "Do you want to proceed? (y/N)" on screen produced
  // `{state:'needs_you', confidence:'scraped'}` and occupied the board's
  // headline needs-you count — a vite dev server rendered as an agent asking
  // for help. With "Worked for 3m" on screen it read `idle`.
  //
  // That is this module's one rule inverted: something we KNOW is not ours,
  // reported as something healthy. Reading a pane's screen is only meaningful
  // once we believe the pane is an agent's.
  if (!isFleetSession(pane)) {
    return {
      state: STATE.UNKNOWN,
      confidence: CONFIDENCE.NONE,
      because: 'this is not one of your agents, so we cannot say what it is doing',
    };
  }
  if (!isClaudeRunning(pane.command)) {
    return { state: STATE.STOPPED, confidence: CONFIDENCE.STRUCTURED, because: 'Claude is not running for this one' };
  }
  if (paneText === null) {
    return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'we could not read its screen' };
  }

  const tail = paneText.split('\n').slice(-25).join('\n');

  const limitLine = matchedLine(tail, RATE_LIMIT_MARKERS);
  if (limitLine !== null) {
    /**
     * 🔑 THE LINE ITSELF RIDES ALONG, and it is the difference between a claim
     * and evidence. Josh, 2026-08-21: *"is there any way we could show that her
     * usage is full or something, or something that would prompt a user to know
     * that"*. We cannot know his account is spent — all we saw is a sentence on
     * a screen — but we can show him the sentence:
     *
     *   You've reached your Fable 5 limit. Run /usage-credits to continue or
     *   switch models with /model.
     *
     * That names the model, carries the vendor's own two remedies, and stays
     * true if the wording changes under us. Anything we wrote instead would be
     * our paraphrase of somebody else's message, going stale silently.
     *
     * ⚠️ ONE LINE, TRIMMED AND CAPPED. This is pane text on its way to a screen:
     * unbounded, it is a paste of somebody's terminal into a product surface.
     */
    return {
      state: STATE.RATE_LIMITED,
      confidence: CONFIDENCE.SCRAPED,
      because: 'its screen mentions a usage limit',
      evidence: limitLine,
    };
  }
  if (NEEDS_YOU_MARKERS.some((re) => re.test(tail))) {
    return { state: STATE.NEEDS_YOU, confidence: CONFIDENCE.SCRAPED, because: 'it is asking you something' };
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
  /**
   * ⚠️ THE INPUT BOX ITSELF, and it has to be last.
   *
   * Every marker above is a trace of something the agent DID, and traces scroll
   * away. An agent that has been sitting at its prompt long enough fell through
   * to `unknown` — so the board told the operator "we cannot see this one, so we
   * are not telling you it is fine" about an agent that was plainly waiting for
   * them, and a person who had just created their first agent landed on exactly
   * that card. Measured on a real created agent, and on the fleet: the footer is
   * frequently the only marker left in the last twenty-five lines.
   *
   * The footer is drawn by Claude's own interactive UI, so it is evidence that
   * Claude is running AND rendering a prompt. It is present while working too,
   * which is why this sits BELOW every working check rather than above them:
   * reaching here means nothing said working, nothing said it needs you, and
   * the prompt is on screen. That is waiting for you.
   *
   * ⚠️ Weigh this before extending it, because it moves the board's headline
   * count: with the footer on almost every live Claude pane, `unknown` stops
   * being reachable for a RUNNING agent, and this codebase's whole rule is that
   * "I cannot see it" must never be reported as something healthy. Two things
   * make it a fair trade rather than a green light. The state it produces is
   * "waiting for you", not "fine" — the card says which, and the `because` line
   * names the evidence. And an agent stuck on a question does not show this
   * footer at all: the dialog replaces the input box, so it is caught above by
   * `NEEDS_YOU_MARKERS` rather than swallowed here. If a future Claude draws a
   * blocking prompt WITH the footer still on screen, this becomes the trap the
   * module exists to prevent, and it has to be revisited.
   *
   * ⚠️ And that premise is ASSERTED, not measured. It is a claim about a user
   * interface this repo does not control, so no test here can hold it: the
   * ordering below is pinned, the premise is not, and nothing would notice the
   * day it stops being true. Said plainly rather than left for a reader to
   * assume the tests cover it.
   */
  if (/⏵⏵|\? for shortcuts/.test(tail)) {
    return { state: STATE.IDLE, confidence: CONFIDENCE.SCRAPED, because: 'it is sitting at its prompt' };
  }

  return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'nothing on its screen says what it is doing' };
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

/**
 * 🛑 HAIKU IS NOT 1M, AND SWEEPING IT INTO THE RULE ABOVE WOULD HAVE BEEN THE
 * DANGEROUS KIND OF WRONG.
 *
 * Josh, 2026-08-21: two of his eight agents read "Unknown" after the memory fix
 * landed, and they were the only two Haiku agents on the board. `limitFor`
 * returns null for `claude-haiku-4-5-20251001` — not in `CONTEXT_LIMITS`, its
 * undated form is not either, and the regex above omits haiku — so `noCeiling`
 * is set, `percent` stays null, and the badge falls back to Unknown. Their
 * memory was being read the whole time; only the denominator was missing.
 *
 * ⚠️ THE COMMENT ON THE RULE ABOVE ARGUES FROM OBSERVATION — "every
 * current-generation model observed here is consistent with 1M and none
 * contradicts it" — and nobody has observed a Haiku agent's ceiling. Being
 * current-generation makes Haiku eligible for that reasoning, not covered by
 * its evidence. Adding it there would have given every Haiku agent a
 * five-times-too-large denominator: one at 80% would draw at 16%, and a person
 * would not know it was nearly full. A vague "Unknown" is a bad reading; a
 * confident 16% for 80% is a wrong one, and this file's whole posture is that
 * the second is worse.
 *
 * 📌 So it gets its own assumed figure, carried as an assumption exactly as the
 * others are, and the UI marks it. Replace this with a measurement the day one
 * exists — `CONTEXT_LIMITS` is where an observed ceiling belongs.
 */
const HAIKU_ASSUMED_LIMIT = 200000;
const HAIKU_MODELS = /^claude-haiku-/;

function limitFor(model) {
  if (!model) return null;
  if (CONTEXT_LIMITS[model]) return { limit: CONTEXT_LIMITS[model], assumed: false };
  const undated = model.replace(/-\d{8}$/, '');
  if (CONTEXT_LIMITS[undated]) return { limit: CONTEXT_LIMITS[undated], assumed: false };
  if (ASSUMED_LIMIT_MODELS.test(model)) return { limit: ASSUMED_LIMIT, assumed: true };
  // Its own figure, for the reason above: the 1M assumption is not Haiku's.
  if (HAIKU_MODELS.test(model)) return { limit: HAIKU_ASSUMED_LIMIT, assumed: true };
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
/**
 * ⚠️ The registry is keyed on the SESSION name, and this function used to
 * reconstruct that name by appending `-discord`.
 *
 * For the existing fleet the two are the same string — the session really is
 * `angel-discord` — so nothing looked wrong. For an agent Kosmos creates, whose
 * session is simply `kosmos-demo`, the reconstruction asks for
 * `kosmos-demo-discord_0.0.json`, which never exists. The entry sitting right
 * beside it is called `kosmos-demo_0.0.json`.
 *
 * The consequence was the last piece of Discord coupling still visible to a
 * user: a created agent showed on the board with its name and its role and then
 * `model unknown` and a dashed, unknowable memory ring, permanently, because no
 * transcript could be found for it. Measured on a real agent created through
 * the product on 2026-08-10.
 *
 * ⚠️ And an entry that says whose it is is CHECKED rather than trusted by its
 * filename. It records its own `session_name`, so we confirm the file belongs to
 * the agent we asked about instead of inferring it from what it is called. An
 * entry with no `session_name` at all cannot be checked and is still taken on
 * its filename, which is the pre-existing behaviour and is said here so the
 * guarantee is not read as broader than it is — a file
 * named for one agent holding another's session id would otherwise produce
 * confident numbers about the wrong conversation, which is the exact failure
 * this whole resolution path was written to avoid.
 */
/**
 * ⚠️ A NAME THAT CANNOT WALK OUT OF THE REGISTRY DIRECTORY.
 *
 * Both arguments below are joined into a filename, and both arrive from tmux —
 * which accepts a `/` in a session name (measured: `tmux new -s 'a/b'`
 * succeeds). So a local session called `../../something-discord` is tied by the
 * legacy suffix arm and would have this function read a JSON file outside the
 * root and take a session id from it.
 *
 * `instructions.registryKey` exists to refuse exactly that, and threading the
 * real session through here routed around it. Rather than import across
 * modules for four lines, the same rule is applied at the point the value
 * becomes a path, which is where it can be checked against what it is about to
 * do.
 */
function registrySafe(value) {
  const name = String(value == null ? '' : value);
  if (!name || name === '.' || name === '..') return null;
  if (/[/\\\0]/.test(name) || name.includes('..')) return null;
  return name;
}

/**
 * ⚠️ AN EMPTY LIST HAS SEVERAL CAUSES AND NOTHING HERE SEPARATES THEM: no
 * entry anywhere, a corrupt entry, an entry with no session id, a name we
 * refuse to build a path from, an entry belonging to a DIFFERENT agent. Some of
 * those mean nothing has ever been registered; others mean we could not or
 * would not look.
 *
 * ⚠️ AND "NO ENTRY ANYWHERE" IS NOT THE CLEAN ABSENCE IT READS AS. The key is
 * `<session>_<window>.<pane>` and this only ever builds `_0.0`, so an agent in
 * pane 0.1 has an entry we never look for; a config root with no
 * `agent-registry` directory has none to find; entries get rotated away.
 *
 * 🔑 SO THE CALLER MUST NOT READ AN EMPTY LIST AS "this agent has never
 * started". An earlier version of this comment asserted exactly that, and the
 * claim is what let a running agent be reported as one that had never run.
 * A previous attempt returned a flag saying WHICH kind of empty this was; it
 * did not help, because the kinds it could tell apart were not the kinds that
 * matter, and it cost a second read of every registry file on every poll.
 */
function sessionIdsFor(sessionName, exactSession) {
  // ⚠️ When the caller knows the REAL session name, only that spelling is
  // tried. The board's name is the session with `-discord` stripped, so `foo`
  // and `foo-discord` are one name and two sessions — and trying both spellings
  // for a name means the surviving card of that collision can show the OTHER
  // agent's model and memory at structured confidence. `snapshot` holds the
  // pane, so it passes the session itself and this ambiguity never arises
  // there; the fallback below is for callers that have only a name.
  // ⚠️ The fallback tries the SUFFIXED spelling FIRST. Callers that hold only a
  // name (`instructions.sessionStartedAt`) used to try that spelling and no
  // other, so leading with the un-suffixed one silently changed which session
  // they resolve when a machine has both — the staleness verdict would then be
  // computed from the wrong agent's transcript. New capability, same order of
  // preference as before.
  const safeExact = exactSession === undefined ? undefined : registrySafe(exactSession);
  const safeName = registrySafe(sessionName);
  // A name we would refuse to build a path from resolves to nothing at all,
  // rather than to a path we then hope is harmless.
  // ⚠️ A REFUSAL, NOT AN ABSENCE. We can see there is a name and are declining
  // to build a path from it — the same shape as the identity refusal further
  // down, and the opposite of "nothing has ever been registered here".
  if (exactSession !== undefined && !safeExact) return [];
  if (!safeName) return [];
  const candidates = safeExact
    ? [`${safeExact}_0.0.json`]
    : [`${safeName}-discord_0.0.json`, `${safeName}_0.0.json`];
  const found = [];
  // ⚠️ CANDIDATE-major, not root-major. The comment above promises the suffixed
  // spelling is preferred, and root-major iteration silently broke that promise
  // on any machine with more than one config root (this one has two): root 1's
  // un-suffixed entry would outrank root 2's suffixed one. A stated order of
  // preference that the loop does not implement is the same class of defect as
  // a safety comment that overstates its guard.
  const roots = configRoots();
  for (const candidate of candidates) {
    for (const root of roots) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(root, 'agent-registry', candidate), 'utf8'));
        const owner = String(entry.session_name || '');
        const wanted = exactSession
          ? [exactSession]
          : [sessionName, `${sessionName}-discord`];
        // A registry entry that names a DIFFERENT agent is a collision we
        // deliberately refuse to read across.
        if (owner && !wanted.includes(owner)) continue;
        if (entry.session_id) found.push(entry.session_id);
      } catch { /* try the next candidate */ }
    }
  }
  // ⚠️ ALL of them, in preference order, rather than the first one found.
  // Returning the first meant a caller with only a name (the staleness check)
  // could be handed a session id whose transcript no longer exists, and stop —
  // reporting "no transcript" for an agent whose own transcript was sitting
  // under the other spelling. Registry entries outlive their sessions, so the
  // first match is not necessarily the live one.
  return found;
}

function transcriptFor(agentName, exactSession) {
  const sessionIds = sessionIdsFor(agentName, exactSession);
  /* 🛑 NO EARLY RETURN HERE ANY MORE, and the early return was the whole bug on
     a clean install. `sessionIdsFor` comes back EMPTY when there is no registry
     to read — which is every machine that is not the fleet's — so returning
     null here made `byWorkdir` below unreachable in exactly the case it exists
     for. Caught by its own test, which is the only reason it is not shipping
     dead: the fix was wired in behind a guard that skipped it. */

  for (const sessionId of sessionIds) {
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
  }

  // No registry entry, or its session has gone. We deliberately do NOT fall
  // back to guessing by NAME: a wrong transcript produces confident numbers
  // about the wrong conversation, which is worse than no numbers at all.
  // 📌 `byWorkdir` below is not that. It keys on the folder Kosmos itself
  // launched the agent in, and then VERIFIES the transcript says the same
  // folder before using it. See its own note.
  return byWorkdir(agentName);
}

/**
 * The transcript found from the folder Kosmos launched the agent in.
 *
 * 🛑 THE REGISTRY THIS FILE READS IS NOT WRITTEN BY CLAUDE CODE, AND NOT BY
 * KOSMOS. On the fleet machine where every one of these code paths was built,
 * `~/.claude/agent-registry/` is written by `~/.claude/scripts/lib/session-recovery.sh`
 * — local tooling that has nothing to do with this product. Kosmos only ever
 * READ that folder; nothing in this repo writes it.
 *
 * ⚠️ SO MEMORY HAS NEVER WORKED FOR ANYBODY WHO IS NOT US. Josh, 2026-08-21, on
 * a clean install: `ls: /Users/cabal/.claude/agent-registry/: No such file or
 * directory`, and every agent on his board reading "Unknown". Not four agents
 * misbehaving — the normal case, on a machine without our fleet's scripts. The
 * development machine had a file the product depended on and did not create,
 * which is why the gap survived every test: they all ran here.
 *
 * 🔑 WHAT THIS USES INSTEAD IS SOMETHING KOSMOS ALREADY KNOWS. Claude Code
 * writes each transcript to `<root>/projects/<the-launch-directory>/<id>.jsonl`,
 * with the directory's path flattened — every character that is not a letter or
 * a digit becomes a dash. MEASURED, not assumed: `/Users/agent1/.openclaw-workspace`
 * is stored as `-Users-agent1--openclaw-workspace`, and the naive
 * `[^A-Za-z0-9] -> -` reproduces it exactly, double dash and all. And the
 * supervisor launches every agent with `-c "$WORKDIR"`, one folder per agent,
 * created by `create.js`. So the folder is derivable from the agent's name.
 *
 * ⚠️ AND THE GUESS IS VERIFIED RATHER THAN TRUSTED, which is what makes this
 * different from the name-guessing the comment above refuses. Two paths CAN
 * flatten to one directory (`a.b` and `a-b` both become `a-b`), so the chosen
 * transcript is opened and its own `cwd` compared against the folder we meant.
 * A mismatch is refused, not used. A wrong reading is the one outcome worth
 * more than a missing one.
 */
function byWorkdir(agentName) {
  return byWorkdirDetailed(agentName).file;
}

/**
 * The same search, keeping WHICH of two worlds it found.
 *
 * 🛑 IT RETURNED ONE NULL FOR TWO OPPOSITE FACTS, which is the third instance of
 * that shape tonight after `because` and `ceilingAssumed`:
 *
 *   no folder, or no transcripts in it   Claude Code has never written there
 *   transcripts, none whose cwd matches  something IS wrong
 *
 * The first is an agent that has not started a session. The second is a fault.
 * Collapsed into `null`, the caller could only ever say the second, so a
 * brand-new agent that has never spoken was greeted with "could not be read" —
 * Josh's Ava, minutes old and sitting at her prompt, 2026-08-21.
 */
function byWorkdirDetailed(agentName) {
  const nothing = { file: null, sawTranscripts: false };
  // Lazily, and from create.js rather than re-derived here: the workers
  // directory is that module's fact, and a second copy of it would drift the
  // first time somebody moves it.
  let dir;
  try { dir = require('./create').workerDir(agentName); } catch { return nothing; }
  if (!dir) return nothing;
  const flat = dir.replace(/[^A-Za-z0-9]/g, '-');
  let sawTranscripts = false;

  for (const root of configRoots()) {
    const projects = path.join(root, 'projects', flat);
    let names;
    try { names = fs.readdirSync(projects); } catch { continue; }
    const jsonl = names.filter((n) => n.endsWith('.jsonl'));
    if (!jsonl.length) continue;
    // Something has been written for this agent, whether or not it turns out to
    // be readable. That fact is what separates "has not started" from "broken".
    sawTranscripts = true;
    // Newest first: a running agent is writing to its current session, and an
    // agent that has been restarted has older ones beside it.
    const byNewest = jsonl
      .map((n) => {
        const full = path.join(projects, n);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* skip below */ }
        return { full, mtime };
      })
      .filter((f) => f.mtime > 0)
      .sort((a, b) => b.mtime - a.mtime);
    for (const f of byNewest) {
      if (transcriptCwd(f.full) === dir) return { file: f.full, sawTranscripts };
    }
  }
  return { file: null, sawTranscripts };
}

/**
 * The working directory a transcript says it belongs to, or null.
 *
 * ⚠️ NOT ON THE FIRST LINE. Measured on a real transcript: line 1 carries only
 * `type`, `mode` and `sessionId`, and the first `cwd` appeared on line 5. So a
 * few lines are read rather than one, and a file that never says is refused
 * rather than assumed to match.
 */
/**
 * Has Kosmos launched this agent somewhere nothing has yet been written?
 *
 * ⚠️ TRUE ONLY WHEN BOTH HALVES HOLD — see the long note at the caller. The
 * plist is the half that makes the folder's emptiness mean anything: without
 * it, an empty folder says only that the agent did not run HERE.
 *
 * 📌 Any error reading either fact answers FALSE, so an unreadable machine
 * falls back to the admission rather than to a claim about the agent's life.
 */
function notYetStarted(agentName) {
  let managed = false;
  try { managed = fs.existsSync(require('./create').plistPath(agentName)); } catch { return false; }
  if (!managed) return false;
  try { return byWorkdirDetailed(agentName).sawTranscripts === false; } catch { return false; }
}

function transcriptCwd(file) {
  const text = headBytes(file, 65536);
  if (text === null) return null;
  const lines = text.split('\n');
  // Bounded: this runs per agent per snapshot, and the answer is at the top.
  for (const line of lines.slice(0, 40)) {
    if (!line || line.charAt(0) !== '{') continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && typeof row.cwd === 'string' && row.cwd) return row.cwd;
  }
  return null;
}

/**
 * Read the tail of a file without loading all of it. Transcripts reach 8MB+.
 *
 * ⚠️ IT ALSO REPORTS WHETHER IT SAW THE WHOLE FILE, and that is not a detail.
 * A caller that concludes "there is no usage data here" from a 256KB WINDOW is
 * making a claim about a file it did not read: one oversized tool result at the
 * end of an 8MB transcript pushes every usage row out of view, and a heavily
 * used agent then reports as one that has never used any memory. Truncation is
 * knowable — `size > bytes` — so it is answered rather than assumed.
 */
function tailBytes(file, bytes = 262144) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, start);
    // ⚠️ RETURNED, not stashed in a module variable. The first version of this
    // set a shared flag that the caller read on the next line, which works and
    // is one interleaved call away from a verdict computed about a different
    // file. The fact belongs to the read.
    return { text: buf.toString('utf8'), whole: size <= bytes };
  } catch {
    return { text: null, whole: false };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * The FIRST bytes of a file, which is the opposite of its sibling above.
 *
 * ⚠️ `tailBytes` READS THE END, and the first version of `transcriptCwd` used
 * it and then took `slice(0, 40)` — which on any transcript over 64KB is forty
 * lines from the middle of the file, not the top, dressed as the top. The
 * verification would still usually have worked, because `cwd` repeats on most
 * rows, and "usually works for a reason you did not intend" is how a check
 * stops being one.
 */
function headBytes(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, read).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * ⚠️ TWO DIFFERENT ANSWERS WERE SHARING ONE WORD, and the card said the one
 * that is a CLAIM.
 *
 *     nothing has been recorded yet   an admission: we looked, there is
 *                                     nothing there to look at
 *     we could not read it            a claim: something exists and we failed
 *
 * A thirty-second-old agent is the first. The card said "Unknown" and the ring
 * said "Memory could not be read", so a brand-new agent read as a fault — which
 * is why Josh screenshotted a working agent and asked how to stop it.
 *
 * 🔑 Mona Lisa's rule, and the reason the split resolves the way it does:
 * WHEN A CASE CANNOT BE ASSIGNED WITHOUT A THRESHOLD, IT GOES TO UNKNOWN.
 * "Not yet" is a claim about where an agent is in its life; "unknown" is an
 * admission about what we can see, and a wrong claim is worse than a vague
 * admission. So ambiguity resolves toward the admission every time.
 *
 * ⚠️ AND `notYet` IS DECIDED ON WHAT THE CODE ALREADY DISTINGUISHES, never on
 * the agent's age. Age would have been a threshold wearing a dimension's
 * clothes: it looks principled, and the number is somebody's guess.
 */
function readContext(agentName, model, exactSession) {
  const file = transcriptFor(agentName, exactSession);
  if (!file) {
    // ⚠️ TWO STATES COLLAPSED INTO ONE `null` HERE. No registry entry means
    // Claude Code has never registered a session for this agent, so there has
    // never been anywhere to look. An entry whose file is GONE is the other
    // thing entirely: it was read once and is not there now, and calling that
    // "not yet" would be false in a specific way rather than merely vague.
    // 🛑 NO TRANSCRIPT IS ALWAYS THE ADMISSION, and three attempts at being
    // cleverer than that were all wrong in the same direction.
    //
    // "No entry" reads like a clean absence and is not one. The registry key is
    // <session>_<window>.<pane> and we only ever build `_0.0`, so an agent in
    // pane 0.1 has one we never look for; a config root with no agent-registry
    // directory has none to find; an entry can be rotated away; the file can be
    // unreadable. Some of those mean the agent never started and some mean it
    // has been running for hours, and NOTHING HERE SEPARATES THEM.
    //
    // ⚠️ I TRIED TO SEPARATE THEM WITH "IS THE PANE RUNNING CLAUDE", which is a
    // fact the caller holds, and it was wrong three ways: `node` is a real
    // Claude install (npm-global fronts as node) and reads as not-running; a
    // truncated tmux line has no command at all and reads as not-running, while
    // `classify` two hundred lines up refuses that same input as "we could not
    // tell what it is doing"; and a crashed agent's pane is a shell, which is a
    // first-class state in this file. Each one produced "it has not started a
    // session yet" on an agent that plainly had.
    //
    // 🔑 The rule was there the whole time: a case that cannot be separated
    // WITHOUT A THRESHOLD resolves to the admission. This one cannot be
    // separated at all, so it resolves there unconditionally, and the two extra
    // registry reads I added to try go with it.
    /**
     * 🔑 AND ONE OF THOSE CASES CAN NOW BE SEPARATED, WHICH THE PARAGRAPH ABOVE
     * COULD NOT DO WHEN IT WAS WRITTEN.
     *
     * Every reason it lists is a REGISTRY reason — a key we never build, a
     * missing agent-registry directory, a rotated entry, an unreadable file —
     * and it is right that none of them separates "never started" from "running
     * for hours". 0.2.21 stopped depending on that registry, and the signal it
     * replaced it with is a different fact: the agent's OWN folder, the one
     * Kosmos created and launched it in.
     *
     * ⚠️ TWO CONDITIONS, AND NEITHER IS SUFFICIENT ALONE:
     *
     *   we wrote its plist AND nothing has been written at its folder
     *       -> Kosmos launched it there, so there is nowhere else it could
     *          have written. It has not started a session.  -> notYet
     *   we wrote its plist AND transcripts exist but none match
     *       -> something IS wrong.                          -> the admission
     *   we did not write its plist
     *       -> we cannot say where it ran.                  -> the admission
     *
     * 🛑 THE PLIST GATE IS LOAD-BEARING AND THE FOLDER CHECK ALONE IS A LIE.
     * Rick, 2026-08-21, diagnosed his own case: no plist at all, never launched
     * by our supervisor, running for hours. His expected folder is empty, so the
     * folder check on its own would announce that a working agent had never
     * started — the wrong-claim direction this file refuses. The gate is a fact
     * about OUR bookkeeping rather than a threshold, which is why it survives
     * the rule that killed the age heuristic.
     *
     * 📌 Mona Lisa ruled this shape and corrected two attempts at the
     * discriminator on the way, including one that 0.2.21 had invalidated
     * ninety minutes earlier: `sessionIdsFor` returning nothing used to mean
     * "never registered" and now means "this is a normal machine".
     */
    if (notYetStarted(agentName)) {
      return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: true,
               /* ⚠️ NOT "it has not started a session yet", which is what this said
                  when it shipped in 0.2.23 and which Mona Lisa's jargon check
                  caught within minutes. "Session" is agent vocabulary; this
                  sentence is read by the person, on the Memory panel. The word
                  arrived from the LAYER the fact was computed in, which is how
                  most of these get in.
                  📌 And the fact is easier to say than the mechanism: nobody
                  needs to know a session exists to understand that nothing has
                  happened yet. Beside `lead: 'memory has nothing recorded yet.'`
                  the pair reads as one thought rather than two vocabularies. */
               because: 'it has not done anything yet' };
    }
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false,
             because: NO_READING.NO_TRANSCRIPT };
  }
  const { text, whole } = tailBytes(file);
  // ⚠️ `text === null` AND `text === ''` ARE NOT THE SAME ANSWER, and `if
  // (!text)` treated them as one. tailBytes returns null when the read threw
  // and '' when the file is there and empty — which is exactly the state a
  // transcript is in the instant Claude Code opens it. So the newest agent on
  // the machine was reported as one we could not read.
  if (text === null) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: NO_READING.UNREADABLE };
  }
  if (text === '') {
    // ⚠️ AN EMPTY FILE IS NOT EVIDENCE THE AGENT IS NEW. It is evidence about
    // the FILE: a write that failed, a file truncated to zero, a path we
    // resolved to the wrong place, or a session whose first line has not landed
    // yet. Only the last of those is "nothing recorded yet", and nothing here
    // separates them, so the admission.
    //
    // ⚠️ AN EARLIER VERSION OF THIS COMMENT SAID "Claude Code opens a FRESH file
    // when it compacts", and that is FALSE on this machine — compact summaries
    // are appended mid-file (measured: `isCompactSummary` rows at lines 3682 and
    // 7579 of a 9575-line transcript). The verdict was right and the reason was
    // invented, which is worse than a wrong verdict: it would have been believed
    // and reused.
    /* ⚠️ THE COMMENT THIS REPLACES SAID AN EMPTY FILE "tells us about the file
       rather than the agent", and that was right when nothing could tell the
       two apart. For an agent KOSMOS STARTED we now can: it was launched in a
       folder we made, so an empty transcript there is an agent that has not
       spoken, not a file we failed to read. Anything we did not start keeps the
       admission, because it could have run anywhere. Same gate as the
       no-transcript branch above, same reason. */
    return notYetStarted(agentName)
      ? { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: true,
          because: 'it has not done anything yet' }
      : { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false,
          because: 'its transcript is empty, which tells us about the file rather than the agent' };
  }

  /**
   * 🔑 A SYNTHETIC ROW'S USAGE IS NOT THE AGENT'S USAGE. Claude Code stamps
   * `"model":"<synthetic>"` on rows it writes itself — a usage-limit notice
   * among them — and those rows can carry a `usage` object of their own. Scanned
   * flat, one of them is the agent's memory reading.
   *
   * ⚠️ THIS IS WHAT JOSH ACTUALLY HIT, 2026-08-21. Ava, seconds after a restart:
   * *"Ava's memory could not be read. Usage data was empty."* She had taken no
   * turns; the only usage in her transcript belonged to a row Claude Code had
   * written. Excluding it leaves NO usage at all, and the branch below already
   * reasons that case correctly — read the whole file and find none, and the
   * agent has not used any memory.
   *
   * 📌 SO THE FIX IS AN EXCLUSION, NOT A NEW RULE. I first tried to make a
   * zero-sum usage mean "nothing yet" and that was wrong: a zero sum is either
   * a fresh agent or bad data, the only separator is age, and that threshold is
   * the thing this split refused. Its test says so by name. This changes what
   * COUNTS as a reading rather than what a reading means.
   *
   * ⚠️ Line by line, because a row is the unit that has a model: JSONL puts one
   * object per line, so a line carrying the placeholder is a row we skip whole.
   */
  const usages = text.split('\n')
    .filter((line) => line && !/"model":"<[^"]*>"/.test(line))
    .flatMap((line) => [...line.matchAll(/"usage":\{([^}]*)\}/g)]);
  if (!usages.length) {
    // 🛑 AND ONLY IF WE READ THE WHOLE FILE. `tailBytes` returns the last 256KB
    // of a transcript that can reach 8MB, so "no usage rows" from a truncated
    // window means "none in the part we looked at" — one oversized tool result
    // at the end is enough. Claiming "not yet" there would put "nothing has
    // been recorded, that is normal for a new agent" on the card of an agent
    // sitting at 95%, which is this whole change's bug with the sign flipped.
    // ⚠️ It is separable WITHOUT A THRESHOLD, which is why it is separated:
    // whether the read covered the file is a fact the read already has.
    return whole
      ? { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: true, because: 'it has not used any memory yet' }
      : { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: 'we could not find a memory reading in the part of the transcript we read' };
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
    // ⚠️ UNKNOWN, NOT "not yet", and this is the tie-breaker doing its work.
    // A usage record that sums to zero could be a session that has genuinely
    // done nothing, or data that is wrong. Separating those needs the agent's
    // age, which is the threshold we refused, so it goes to the admission.
    /* ⚠️ STAYS THE ADMISSION, and I tried to change it and was wrong. A usage
       record summing to zero is either an agent that has done nothing or data
       that is wrong, and the only separator anyone has proposed is the agent's
       AGE — the threshold this whole split refused. Its test says so by name.
       📌 What DID fix Josh's case is one branch up: a synthetic row's usage is
       not the agent's usage, so it is not counted at all, and the no-usage
       branch's existing `whole` reasoning takes over. */
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: 'usage data was empty' };
  }

  const found = limitFor(model);
  const ceiling = found && found.limit;

  if (!ceiling) {
    // ⚠️ A SEVENTH CASE, and it is neither of the two the split is about: we
    // READ the memory and cannot express it as a percentage, because we do not
    // know what this model holds. `notYet` is false because something was read;
    // the card still shows the unknown badge, since pctOf is null. Whether
    // Unknown is the right WORD for a measured-but-unscaled agent is a
    // separate question and belongs with the unknown-model cards (#149/#150).
    return {
      tokens,
      percent: null,
      ceiling: null,
      ceilingSource: null,
      notYet: false,
      // ⚠️ AN EXPLICIT FLAG, not a null the UI has to infer. The surfaces need
      // to tell "we read it and cannot scale it" from "we could not read it",
      // and `ceiling === null` distinguishes those only if you also know that
      // every other shape leaves the field UNDEFINED rather than null. That is
      // a rule nothing states and a test fixture broke within an hour.
      noCeiling: true,
      confidence: CONFIDENCE.STRUCTURED,
      because: `measured, but we do not know how much ${model || 'this model'} can hold`,
    };
  }

  const percent = Math.round((tokens / ceiling) * 100);
  return {
    tokens,
    percent: Math.min(100, percent),
    overCeiling: percent > 100,
    notYet: false,
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

function readModel(agentName, exactSession) {
  const file = transcriptFor(agentName, exactSession);
  if (!file) return { model: null, confidence: CONFIDENCE.NONE };
  const { text } = tailBytes(file, 65536);
  if (!text) return { model: null, confidence: CONFIDENCE.NONE };
  /**
   * 🛑 `<synthetic>` IS NOT A MODEL, AND IT IS THE LAST ONE IN THE FILE EXACTLY
   * WHEN SOMEBODY IS LOOKING.
   *
   * Claude Code writes `"model":"<synthetic>"` on rows it generates itself, and
   * taking the last match blindly rendered that straight onto the page. Josh,
   * 2026-08-21, seconds after switching an agent from Fable to Opus: **"Right
   * now: Claude <synthetic>"**. The restart had worked — her window said
   * `Opus 5 · Claude Max` — and the panel reported a model that does not exist,
   * at the one moment the person is checking whether the change took.
   *
   * ⚠️ MEASURED, NOT GUESSED, across the real transcript tree on this machine:
   *   claude-opus-5   19500     claude-fable-5   18413
   *   claude-opus-4-8   520     opus                45
   *   <synthetic>        45     (109 across all projects)
   * `<synthetic>` is the ONLY bracketed value that occurs. The bracket shape is
   * the rule rather than the literal string, because a sentinel written that way
   * is a placeholder by construction and a model id never is — but the literal
   * is what was observed, and if a second sentinel ever appears it should be
   * added here with its own count rather than assumed to match.
   *
   * 📌 SKIPS BACKWARDS RATHER THAN FILTERING FORWARDS: the most recent REAL
   * model is what the agent is running, and synthetic rows sit on top of it.
   */
  const matches = [...text.matchAll(/"model":"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v) => !/^<.*>$/.test(v));
  if (!matches.length) return { model: null, confidence: CONFIDENCE.NONE };
  /**
   * 🔑 A RECOGNISED ID WINS OVER A MERELY RECENT ONE, which is Mona Lisa's
   * point on this defect and is worth more than the bracket rule above.
   *
   * Last-match is the fragile part: the tail also carries `"model":"opus"`
   * (45 occurrences on this machine against 19500 `claude-opus-5`), a bare
   * short form somebody passed to `--model`. Taking it verbatim renders
   * "Claude opus" — true, ugly, and avoidable when a full id for the same
   * session is sitting a few lines up.
   *
   * ⚠️ AND THE FALLBACK IS DELIBERATELY NOT "REFUSE THE UNRECOGNISED". Mona
   * proposed accepting only ids `MODEL_NAMES` knows; that would report "we
   * could not tell" the day a genuinely new model ships, which is exactly what
   * `modelDisplayName`'s `return id` was written to avoid. A future
   * `claude-opus-6` looks like a model and should be shown; `<synthetic>` does
   * not and is dropped above. The two questions are separated rather than
   * merged: BRACKETS decide "is this an id at all", the table decides "do we
   * have a nicer name for it".
   */
  const known = matches.filter((v) => MODEL_NAMES[v] || MODEL_NAMES[v.replace(/-\d{8}$/, '')]);
  const chosen = known.length ? known[known.length - 1] : matches[matches.length - 1];
  return { model: chosen, confidence: CONFIDENCE.STRUCTURED };
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
 *
 * ⚠️ AND THE DISPLAY NAME IS NOW ON THAT LIST. `readIdentity` reads
 * `store.readProfile(sessionName)` for the name a person typed at creation, and
 * `readProfile` resolves through `safeKey` — while the file read three lines
 * below it joins the session name VERBATIM. So the same split runs through this
 * one function: for a colliding pair, the recorded display name comes from one
 * agent's profile and the instruction file from the other's, and the card would
 * show `mybot`'s name over `my.bot`'s role. It is the mildest consumer of the
 * collision (a wrong label, not a cross-agent write) and it is named here
 * because the list of things this defect reaches is the whole argument for
 * fixing it properly, and a list that quietly stops being complete stops making
 * that argument.
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
  if (override) return { ...override, derived: true };

  /**
   * ⚠️ THE RECORD BEFORE THE FILE, and the order is the point.
   *
   * An agent created as `Casey` runs as `casey` everywhere the machine looks —
   * session, launchd label, folder — and is called Casey everywhere a person
   * looks. `create` writes the display name here as well as into the first line
   * of the instruction file, and this prefers the record because the file
   * belongs to the PERSON: they can rewrite that line, and a display name that
   * vanishes when somebody edits their own instructions is not a name.
   *
   * ⚠️ It cannot make an agent anonymous. A profile with no `displayName` — every
   * agent that existed before this was written — falls straight through to the
   * file exactly as before, which is how `claudebot` still reads `Splinter`.
   * `role` deliberately still comes from the file below: the profile's own
   * `role` field is what a person types into the detail panel, and the board
   * already prefers that separately, one level up.
   */
  /* ⚠️ Known limit, recorded rather than fixed (round 40): readProfile
     swallows read errors and answers as if no record exists, so an
     UNREADABLE profile is indistinguishable from an absent one and the
     name silently falls back to the instruction file's identity line for
     as long as the blip lasts. Accepted because the fallback is the
     agent's own boot name (never an invented one), the record wins again
     on the next poll, and a per-card hedge sentence for a transient read
     failure would flap on and off every five seconds. If profiles ever
     carry state whose stale reading is dangerous rather than cosmetic,
     readProfile needs a third answer before that lands. */
  const remembered = store.readProfile(sessionName);
  const recorded = remembered && typeof remembered.displayName === 'string'
    ? remembered.displayName.trim() : '';

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
  // ⚠️ `derived: true` when we have a recorded name even though the file is
  // unreadable, because `derived` answers "did we find a real name for this
  // one, or is this the machine name?" — and a recorded name IS a real name.
  // Answering false would put the card's "machine name" flag on an agent whose
  // name the person themselves typed.
  if (!got.ok) {
    return recorded
      ? { displayName: recorded, role: null, derived: true }
      : { displayName: sessionName, role: null, derived: false };
  }
  const text = got.buf.toString('utf8').slice(0, 4000);

  const m = text.match(/You are \*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?\s*,?\s*([^.\n]*)/);
  if (!m) {
    return recorded
      ? { displayName: recorded, role: null, derived: true }
      : { displayName: sessionName, role: null, derived: false };
  }

  const displayName = recorded || m[1].trim();
  let role = (m[3] || '')
    .replace(/\*\*/g, '')          // instruction files are markdown; strip emphasis
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^Josh Stone's\s+/i, '')
    .split(/\s+in the\s+|,/)[0]
    .trim();
  if (role.length > 60) role = role.slice(0, 60).trim();

  // No `source` field (round 22): it had no consumer anywhere -- snapshot
  // builds the card from displayName/derived/role, the page never read it,
  // no test pinned it -- and its justifying comment claimed an every-branch
  // completeness two fallbacks did not have. Unread API surface is the same
  // thing round 19 removed from the thread payload; where a name came from
  // is answered by `derived` for the one question the page asks.
  return { displayName, role: role || null, derived: true };
}

function safeAvatar(name) {
  try { return store.avatarPath(name); } catch { return null; }
}

/**
 * Just who is on the board and whether each is tied to its name — no captures.
 *
 * ⚠️ Exists because the gate checks were calling `snapshot()`, which is a
 * synchronous fan-out: one `list-panes` plus one `capture-pane` PER AGENT plus
 * transcript reads, measured at 43-60ms of blocked event loop for thirteen
 * agents. On the avatar route that landed on a polling path — the board
 * refetches every card's picture every five seconds — costing roughly 0.65s of
 * blocked loop and ~170 extra `capture-pane` calls against live agents per tick.
 *
 * A gate needs the NAME and whether it is tied. Both come from the pane list
 * alone, which is ONE tmux call and no captures. Memoising `snapshot()` was the
 * other option and it was wrong: it makes a gate answer from a stale roster,
 * which is exactly the wrong direction for a check that decides whose data to
 * hand out.
 */
function paneRoster() {
  // ⚠️ THROWS when tmux could not be asked, rather than answering "nothing".
  //
  // `sh()` swallows every failure and returns `null`, and `parsePanes(null)`
  // returns `[]` — so tmux dead, tmux missing, or the five-second timeout
  // expiring all arrived at a caller as an empty roster, indistinguishable from
  // a machine with no agents. `borrowedName`'s catch is written to fail CLOSED
  // and its comment says so, but the only input that reached it was an injected
  // throw from a test: **the realistic failure failed open and served the
  // record.** A guard whose closed path production cannot take is not a guard.
  //
  // ⚠️ AND `snapshot()` REFUSES THE SAME WAY NOW, through `listPanes`. This
  // note used to say the opposite at length — that snapshot stayed lenient, so
  // `/api/status` answered 200 with zero agents and a fresh `checkedAt` and the
  // board painted "0 agents, checked just now" — and that it was being left
  // that way deliberately because changing it was a product decision. The
  // product decision was made one round later, in `listPanes`, and this
  // paragraph was not re-read: `/api/status` now 500s with the reason and the
  // board says it cannot read the agents. The sentence outlived the behaviour
  // it described, which is this module's own recurring defect pointed at its
  // own documentation. Both refusals are asserted together in
  // `fixture-discipline.test.js`, so the pair cannot drift silently again.
  //
  // The two functions still are not one, because this one is deliberately
  // stricter about a PARTIAL answer: see the note below.
  const out = paneSource ? paneSource() : tmuxPanes();
  if (out === null || out === undefined) {
    throw new Error('we could not see what is running on this computer');
  }
  /**
   * ⚠️ AND THE SAME POSTURE FOR AN ANSWER WE CANNOT READ.
   *
   * "We could not ask" and "we asked and understood none of it" are the same
   * thing to a gate: in both, the roster is not evidence that a name is free or
   * that a pane is a stranger's. This function is what decides whether a write
   * reaches an agent, so an unreadable answer has to fail CLOSED here rather
   * than become an empty roster — which every caller reads as "nobody is
   * claiming this name".
   *
   * `listPanes` refuses on the same condition for the board. Two readers, one
   * rule, and the reason they are not one function is that this one is
   * deliberately stricter than `snapshot` about being asked at all.
   *
   * ⚠️ A PARTIAL answer does NOT refuse here, and that is a decision rather
   * than an omission. Refusing on any unreadable line would take every
   * name-keyed read and write away from the whole fleet because one pane's line
   * was mangled — a machine-wide outage caused by a cosmetic fault in one line.
   * The gates this feeds are already conservative about a name they cannot
   * find: `knownAgent` answers false, which fails closed.
   *
   * ⚠️ What it costs, said plainly: `borrowedName` also answers false, so a
   * record stays readable on the strength of a roster this module has just
   * admitted was incomplete. That is the weaker half of the trade, and it is
   * bounded — the alternative is refusing every route on the machine for one
   * bad line, which is a worse failure with a wider blast radius.
   */
  const { panes, rejected } = readPanes(out);
  if (rejected > 0 && panes.length === 0) {
    throw new Error('we could not make sense of what came back');
  }
  return onePanePerSession(panes).map((pane) => ({
    sessionName: pane.name,
    // The real tmux session beside the board name, for the same reason
    // `snapshot` publishes it: anything that resolves a per-session artifact
    // needs the name tmux knows, not the one we display.
    session: pane.session,
    isNamedOurs: isNamedOurs(pane),
  }));
}

function snapshot() {
  const { panes: read, rejected: unreadableLines } = listPanes();
  const panes = onePanePerSession(read);
  const agents = panes.map((pane) => {
    const text = capturePane(pane.target);
    const status = classify(pane, text);
    // ⚠️ Identity, model and context are all filed under the NAME, and only a
    // pane whose SESSION NAME says it is ours has been tied to that name.
    //
    // Measured with the real `claudebot-discord` absent and a stranger's
    // `tmux new -s claudebot` running Claude: the card came back named
    // "Splinter", role "Project Manager", model `claude-opus-4-8`, context ring
    // 24% at STRUCTURED confidence — all the REAL agent's, read out of its
    // registry file — while the state and the target were the stranger's. An
    // operator would be looking at a card that is Splinter in every respect
    // except the one that decides what a destructive action reaches.
    //
    // Publishing `isNamedOurs` and leaving another branch to honour it is not
    // enough: this module is what asserts the identity, so this module has to
    // stop asserting it. An inferred pane keeps its raw session name, is marked
    // underived, and carries no model and no context — which is the honest
    // answer, because we do not know whose conversation it is.
    const tied = isNamedOurs(pane);
    const { model } = tied ? readModel(pane.name, pane.session) : { model: null };
    const context = tied
      ? readContext(pane.name, model, pane.session)
      // ⚠️ Unknown, and not because it is ambiguous: this one is a REFUSAL. We
      // can see there is something to read and are declining to read it, so
      // 'not yet' would be false about us as well as about the agent.
      : { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: 'we cannot tell which agent this is, so we will not read another agent\u2019s transcript for it' };
    const identity = tied
      ? readIdentity(pane.name)
      : { displayName: pane.name, role: null, derived: false };
    return {
      name: identity.displayName,
      sessionName: pane.name,
      // ⚠️ The REAL tmux session, beside the board name it is filed under. They
      // differ for every legacy agent (`angel-discord` vs `angel`), and any
      // reader that resolves a per-session artifact -- a transcript, a registry
      // entry -- needs the one tmux knows, not the one we display. Publishing
      // it is what lets a consumer stop guessing between the two spellings.
      session: pane.session,
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
      /* The line the classifier actually matched, when it has one. Null for
         every state that did not read a sentence off the screen. */
      stateEvidence: status.evidence || null,
      because: status.because,
      context,
      model,
      modelName: modelDisplayName(model),
      // Things a person set, which the machine cannot derive. Role in
      // particular: nothing on this machine records what an agent *is*.
      // ⚠️ These two are keyed on the NAME as well, and gating identity, model
      // and context while leaving them open made the first fix incomplete on
      // its own terms. `hasAvatar` renders the real agent's PHOTOGRAPH on the
      // stranger's card, and the detail panel reads `profile.role || role` — so
      // the `role: null` above is only the fallback, and the operator-set role
      // came straight back through the profile store.
      //
      // Every read in this function keyed on `pane.name` needs the same gate.
      // Fixing four of six is not a partial fix, it is the same defect with a
      // smaller surface.
      hasAvatar: tied ? Boolean(safeAvatar(pane.name)) : false,
      profile: tied ? store.readProfile(pane.name) : null,
    };
  });

  agents.sort((a, b) => a.name.localeCompare(b.name));

  return {
    // Freshness is not decoration. An ambient display gets trusted passively,
    // and silence from it reads as "all fine". If this poller dies, the UI can
    // show the stamp going stale instead of freezing on a happy picture.
    checkedAt: new Date().toISOString(),
    counts: countAgents(agents, unreadableLines),
    agents,
  };
}

/**
 * The numbers on the summary line, for a given set of cards.
 *
 * ⚠️ EXPORTED, and it is exported for one reason: the server FILTERS this
 * board — removed agents come off it — and counts computed over the unfiltered
 * set put "12 agents" above 11 cards. The fix is one definition used twice, not
 * a second copy in the server that starts identical and drifts the first time a
 * count is added here.
 *
 * `unreadableLines` is passed in rather than derived: it is a fact about what
 * tmux returned, not about the cards, and it survives filtering unchanged.
 */
function countAgents(agents, unreadableLines) {
  return {
    total: agents.length,
    needsYou: agents.filter((a) => a.state === STATE.NEEDS_YOU).length,
    unknown: agents.filter((a) => a.state === STATE.UNKNOWN).length,
    unreadableTokens: agents.filter((a) => a.context.tokens === null).length,
    unknownFullness: agents.filter((a) => a.context.percent === null).length,
    // ⚠️ Lines tmux gave us that were not panes. Zero is the normal answer;
    // anything else means part of the fleet is missing from this board and the
    // board has to say so rather than presenting what is left as all of it.
    unreadableLines,
  };
}

// `transcriptFor` is exported for the instructions module, which needs a
// session start time. It resolves by session id rather than by guessing a
// directory from the agent's name, for the reason its own comment gives: a
// guess finds *a* transcript every time, so it looks like it worked while
// reporting from the wrong session. One derivation, shared, rather than a
// second copy that can drift.
module.exports = {
  NO_READING,
  countAgents, snapshot, paneRoster, readPanes, isParseable, classify, isNamedOurs,
  rank, paneOrder, modelDisplayName, readIdentity, transcriptFor,
  isAgentPane, isAgentSession, isFleetSession, parsePanes, onePanePerSession,
  setPaneSource, setPaneCapture, tmuxSaidNoServer, shDetail,
  PANE_FORMAT, PANE_COLUMNS, STATE, CONFIDENCE, CONTEXT_LIMITS,
  /* ⚠️ EXPORTED for the restart-survival repair, which has to put the model an
     agent LAST RAN AS into a job that never recorded a choice. Exported rather
     than copied for the reason `countAgents` is: a private second reader of a
     transcript is the most-shipped defect in this codebase, and the two would
     disagree the first time the synthetic-row rule below moves. */
  readModel,
  // ⚠️ EXPORTED so `engine/chat.js` can show the person the part of the screen
  // that produced the NEEDS_YOU verdict. It is exported rather than copied for
  // the reason `countAgents` is: a private second copy is two derivations of
  // one question, this codebase's worst habit, and the copy would drift the
  // first time a marker is added here. The card that says "Needs you" and the
  // thread that shows the question must never be able to disagree.
  NEEDS_YOU_MARKERS,
};

if (require.main === module) {
  process.stdout.write(JSON.stringify(snapshot(), null, 2) + '\n');
}
