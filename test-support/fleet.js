'use strict';

/**
 * ONE fixture, for every test on either side of the status seam.
 *
 * ⚠️ WHY THIS FILE EXISTS, and it is worth reading before using it.
 *
 * Three challenge-loop rounds in a row found the same defect, and none of them
 * were in the code under test. They were in the FIXTURES:
 *
 *   - The projects suite handed `describe()` a roster carrying `name`, `state`
 *     and `because`. `paneRoster()` has never returned those fields. Every test
 *     was green while production rendered machine names, a permanently zero
 *     "needs you" count, and "Can't tell" with no reason.
 *   - The route suite stubbed tmux with `/bin/echo`, which is not the seam the
 *     status engine reads at all, so its roster was permanently null and not one
 *     route test ever asserted a present member.
 *   - Pane lines are hand-typed tab-separated strings, so the column a value
 *     lands in is maintained by counting `\t` by eye. One line in `server.test.js`
 *     puts a pane TITLE in the `claim` column, where a matching value would have
 *     made a stranger's session read as ours.
 *
 * All three are one shape: **a test measuring a world the producer does not
 * produce.** Measuring against the wrong world is worse than not measuring,
 * because it manufactures confidence. So the fix is not another comment. It is a
 * mechanism: every fleet in the suite is described HERE, and everything this
 * module hands back was built by the REAL producers — `snapshot()` and
 * `paneRoster()` — from a pane listing assembled out of `PANE_COLUMNS` by NAME.
 *
 * ⚠️ SAID PRECISELY, because the first version of this paragraph claimed this is
 * "the only sanctioned way for a test to obtain a fleet" and that is not true.
 * There are two tiers, and only the first gets all four guarantees below:
 *
 *   - `install()` — the full fixture. Sets the seam, runs the real producers,
 *     verifies its own arrangement, hands back strict cards and rows. Used where
 *     a test asserts on what the board SAYS.
 *   - `line()` alone — the pane listing only, for the ~19 places that install
 *     the seam themselves because they need to change the answer between two
 *     reads (tied when the plan looks, untied by the time the write happens) or
 *     to have it throw. Those get guarantee 2 (named columns) and NOT 1, 3 or 4.
 *
 * That second tier is a real gap rather than a completed job, and the lint in
 * `fixture-discipline.test.js` is scoped to what it actually enforces: no
 * hand-typed pane line, no hand-built card. It does not claim every test goes
 * through `install()`, because they do not.
 *
 * What that buys, concretely:
 *
 *   1. A test cannot carry a field the producer does not emit, because it never
 *      writes the object. It asks for one.
 *   2. A test cannot put a value in the wrong column, because it names the
 *      column instead of counting tabs.
 *   3. Production code that reads a field off a fixture object the producer does
 *      not emit THROWS, loudly, naming the producer (see `strict` below) —
 *      rather than reading `undefined` and passing. That alone would have caught
 *      the worst defect on this branch the first time it was written.
 *   4. A test cannot silently get a state it did not ask for: `install` verifies
 *      each spec's intended state against what the real classifier actually
 *      answered, and throws if they disagree. A fixture that means to arrange
 *      "an agent asking a question" and arranges `unknown` instead is a vacuous
 *      test, and vacuous tests are the other half of this same class.
 *
 * ⚠️ REQUIRE IT AFTER THE SANDBOX, like every other engine module. It pulls in
 * `engine/status`, which reads its roots ONCE at require time. Requiring this
 * before `process.env.AGENT_WORKFORCE_*` is set sandboxes nothing.
 *
 *   const fleet = require('../test-support/fleet');   // from engine/
 *   const board = fleet.install([
 *     fleet.agent('mara', { state: 'working' }),
 *     fleet.agent('claudebot', { displayName: 'Splinter', state: 'needs_you' }),
 *   ]);
 *   try {
 *     projects.list(board.agents);          // the real snapshot() cards
 *     gate(board.roster);                   // the real paneRoster() rows
 *   } finally {
 *     board.restore();
 *   }
 */

const fs = require('node:fs');
const path = require('node:path');

const status = require('../engine/status');

/**
 * The command tmux reports for a Claude pane installed by the native installer.
 *
 * ⚠️ NOT a free choice. `isClaudeCommand` accepts a three-segment version string,
 * `claude`, `claude.exe` or `node`, and `rank` treats `node` as ambiguous. This
 * is the unambiguous one, which is what a test that means "an agent is running
 * here" is asking for. `install` verifies the classification either way, so a
 * change to that rule surfaces here rather than silently reclassifying a fleet.
 */
const CLAUDE_COMMAND = '2.1.212';

/**
 * What is on an agent's screen, per state we know how to arrange.
 *
 * ⚠️ These are the only invented strings in this module, and they are invented
 * in the one place where invention is honest: this is terminal output, whose
 * real producer is a running Claude, not one of our functions. What keeps them
 * from drifting is that `install` asserts the state each one actually produces
 * — so if `classify`'s markers change, these fail loudly instead of quietly
 * becoming `unknown`.
 */
const SCREEN = {
  working: 'Reading the lease\n· Working (esc to interrupt)\n',
  needs_you: 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n',
  idle: 'Worked for 1m 02s\n> \n',
  rate_limited: 'You have hit your usage limit. Try again later.\n',
};

/**
 * A spec for one pane. Nothing here is a card: it is what tmux would say.
 *
 * @param {string} name        the board name (`claudebot`, not `claudebot-discord`)
 * @param {object} [opts]
 * @param {string} [opts.state]        'working' | 'needs_you' | 'idle' |
 *                                     'stopped' | 'unknown' | 'rate_limited'.
 *                                     VERIFIED against the real classifier.
 * @param {boolean|string} [opts.ours] true (default) ties the pane by session
 *                                     suffix; 'claim' ties it by the tmux claim
 *                                     Kosmos writes at creation; false makes it
 *                                     a stranger holding the name.
 * @param {string} [opts.displayName]  writes a real worker instruction file so
 *                                     `readIdentity` derives this name, the way
 *                                     `claudebot` displays as `Splinter`.
 * @param {string} [opts.role]         the role in that same file.
 * @param {string} [opts.command]      overrides the pane command.
 * @param {string} [opts.title]        the pane title.
 * @param {string} [opts.pane]         `window.pane`, for one-pane-per-session tests.
 * @param {string} [opts.screen]       overrides the screen text outright.
 */
function agent(name, opts = {}) {
  const key = String(name);
  const ours = opts.ours === undefined ? true : opts.ours;
  const session = ours === true ? `${key}-discord` : key;
  const state = opts.state === undefined ? 'idle' : opts.state;
  return {
    name: key,
    session,
    pane: opts.pane || '0.0',
    // 'stopped' means the pane is alive and Claude is not in it. A login shell
    // is what that really looks like, and it is what the board must not read a
    // healthy state off.
    command: opts.command !== undefined ? opts.command
      : (state === 'stopped' ? '-zsh' : CLAUDE_COMMAND),
    inMode: opts.inMode || '0',
    // ⚠️ The claim must equal the pane's own NAME to tie it. A claim naming
    // somebody else is somebody else's claim, and `isNamedOurs` says so.
    claim: ours === 'claim' ? key : (opts.claim || ''),
    title: opts.title || '',
    screen: opts.screen !== undefined ? opts.screen : SCREEN[state],
    state,
    displayName: opts.displayName || null,
    role: opts.role || null,
  };
}

/** A pane holding somebody else's session under one of our names. */
function stranger(name, opts = {}) {
  return agent(name, { ...opts, ours: false });
}

/**
 * Build the `list-panes` line for one spec.
 *
 * ⚠️ FROM `PANE_COLUMNS`, BY KEY. Every hand-typed fixture line in this repo
 * maintains its column positions by counting tab characters by eye, and one of
 * them already miscounted: `'Angel\t0.0\t2.1.212\t0\tunrelated work'` puts a
 * pane title in the CLAIM column. That one is harmless only because the value
 * does not happen to equal the session name — had it, a stranger's pane would
 * have read as ours, in a test written to prove the opposite.
 *
 * Building the line from the column list means a reordered, added or removed
 * column moves every fixture in the suite at once, and no fixture can address a
 * column by accident.
 */
function line(spec) {
  if (!spec || !spec.session) {
    throw new Error('test-support/fleet: a pane line needs at least a `session`');
  }
  // Defaulted here as well as in `agent()`, so a test that needs a shape
  // `agent()` does not offer — a session name that is not derived from an agent
  // name, somebody else's claim — can still name its columns rather than
  // counting tabs.
  const value = {
    session: spec.session,
    pane: spec.pane || '0.0',
    command: spec.command === undefined ? CLAUDE_COMMAND : spec.command,
    inMode: spec.inMode || '0',
    claim: spec.claim || '',
    title: spec.title || '',
  };
  return status.PANE_COLUMNS.map((col) => {
    if (!(col.key in value)) {
      // A column was added to the engine and nothing here fills it. Refusing is
      // the point: the alternative is a fixture that silently stops exercising
      // whatever the new column decides.
      throw new Error(
        `test-support/fleet does not know how to fill the pane column \`${col.key}\`. `
        + 'A column was added to PANE_COLUMNS — teach this fixture about it, and '
        + 'check what it changes about every fleet the suite builds.',
      );
    }
    return String(value[col.key]);
  }).join('\t');
}

/**
 * Where worker instruction files live, resolved the way `engine/status` resolves
 * it, and REFUSED unless it is a sandbox.
 *
 * ⚠️ This is the one thing in this module that writes to disk, and the root it
 * writes to is where live agents keep the file they boot from. An unsandboxed
 * write here does not litter, it changes how a working agent behaves the next
 * time it starts. The suite's own rule is to sandbox every root the code writes
 * to; this refuses rather than trusting that the rule was followed.
 */
function workersRoot() {
  const root = process.env.AGENT_WORKFORCE_WORKERS;
  if (!root) {
    throw new Error(
      'test-support/fleet refuses to write a worker instruction file: '
      + 'AGENT_WORKFORCE_WORKERS is not set, so this would write into the real '
      + 'fleet’s workers directory and change what a live agent boots from.',
    );
  }
  return root;
}

function writeIdentity(spec) {
  const root = workersRoot();
  const dir = path.join(root, spec.name);
  fs.mkdirSync(dir, { recursive: true });
  const role = spec.role ? `, ${spec.role}.` : '.';
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    `You are **${spec.displayName}**${role}\n\nWritten by test-support/fleet.\n`,
  );
}

/**
 * Fields every object reachable from a fixture is allowed to be asked for even
 * though a producer never emits them: the ones the language and the test
 * runner themselves reach for.
 */
const HOUSEKEEPING = new Set([
  'then', 'toJSON', 'inspect', 'constructor', 'valueOf', 'toString',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'nodeType',
  'length', '_isMockFunction', 'asymmetricMatch',
]);

/**
 * Wrap a producer's output so that reading a field it does not emit THROWS.
 *
 * ⚠️ THIS IS THE MECHANISM, and it is aimed at exactly one failure. `describe()`
 * read `card.name`, `card.state` and `card.because` off a `paneRoster()` row for
 * the entire life of this branch. In production those are `undefined`, so the
 * feature's headline promise — that `claudebot` shows as `Splinter` — was dead,
 * silently, while every test passed. `undefined` is what a wrong-shape read
 * looks like, and `undefined` is indistinguishable from a legitimately absent
 * value, so no assertion downstream can be trusted to notice.
 *
 * A throw is distinguishable. Passing these into the code under test means the
 * code cannot read a field the real producer will not give it without failing
 * the test on the spot, naming the producer and the field.
 */
/**
 * ⚠️ IT WRAPS NESTED OBJECTS TOO, and the first version did not while this
 * paragraph already claimed it did. A card carries `context` and `profile`, and
 * a top-level-only wrapper handed those back raw — so `card.context.pct` (the
 * real field is `percent`) read `undefined` and passed, which is verbatim the
 * failure this mechanism is for, one level down. Nested wrapping is memoised so
 * `card.context === card.context` stays true; a fixture that broke identity
 * would be a new way for a test to be wrong.
 *
 * ⚠️ AND ONE KIND OF NESTED OBJECT MUST NOT BE WRAPPED: a FREE-FORM RECORD,
 * where an absent key is a legitimate value rather than a producer gap.
 * `store.readProfile` answers `{}` for an agent nobody has set a role on, and
 * the page correctly reads `profile.role` off it. Throwing there would report
 * the fixture doing its job as a defect, which is the mirror of the failure
 * this mechanism exists for and every bit as misleading.
 *
 * 🔑 NAMED BY THE CALLER, never guessed here. `strict(row, producer, { freeForm:
 * ['profile'] })` says: this key holds a bag, its absent keys mean nothing.
 * A list this file maintained on its own would be an exemption nobody sees.
 */
function strict(value, producer, opts) {
  const freeForm = new Set((opts && opts.freeForm) || []);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => strict(v, producer, opts));
  const nested = new Map();
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target || HOUSEKEEPING.has(prop)) {
        const got = Reflect.get(target, prop, receiver);
        if (got === null || typeof got !== 'object' || typeof prop === 'symbol') return got;
        /* A named free-form record is handed back RAW, at any depth: its
           absent keys are a fact about the person, not about the producer. */
        if (freeForm.has(prop)) return got;
        if (!nested.has(prop)) nested.set(prop, strict(got, `${producer}.${String(prop)}`, opts));
        return nested.get(prop);
      }
      throw new Error(
        `${producer} does not emit \`${String(prop)}\`. It emits: `
        + `${Object.keys(target).join(', ')}. `
        + 'Reading a field the real producer never returns is the defect this '
        + 'fixture exists to make impossible — in production that read is '
        + '`undefined`, and nothing fails.',
      );
    },
  });
}

/**
 * Install a fleet, and hand back what the REAL producers say about it.
 *
 * @param {object[]} specs  from `agent()` / `stranger()`
 * @param {object} [opts]
 * @param {boolean} [opts.strict=true]  wrap the returned cards and rows so an
 *                                      unemitted field throws. Turn it off only
 *                                      with a reason, in the test.
 * @returns {{agents: object[], roster: object[], card: Function, row: Function,
 *            snapshot: Function, restore: Function}}
 */
function install(specs, opts = {}) {
  const list = Array.isArray(specs) ? specs : [specs];
  const wrap = opts.strict === false ? (v) => v : strict;

  for (const spec of list) {
    if (spec.displayName) writeIdentity(spec);
  }

  const text = list.map(line).join('\n');
  const screens = new Map(list.map((s) => [`${s.session}:${s.pane}`, s.screen]));

  status.setPaneSource(() => text);
  status.setPaneCapture((target) => {
    const screen = screens.get(target);
    // `null` is the engine's "we could not read this pane", which is a real
    // case. Answering it for a pane the fixture did not describe is honest, and
    // it keeps an unnamed pane from inheriting another's screen.
    return screen === undefined ? null : screen;
  });

  let board;
  try {
    board = status.snapshot();
    verify(list, board);
  } catch (err) {
    restore();
    throw err;
  }

  // ⚠️ INSIDE the same guard as `snapshot()`. Left outside it, a throw here
  // would leave both seams installed for every test that runs afterwards — the
  // restore guarantee this module advertises would be resting on the
  // coincidence that `paneRoster` happens to refuse only on conditions
  // `listPanes` already refused a few lines earlier.
  let agents;
  let roster;
  try {
    agents = wrap(board.agents, 'snapshot().agents');
    roster = wrap(status.paneRoster(), 'paneRoster()');
  } catch (err) {
    restore();
    throw err;
  }

  return {
    agents,
    roster,
    // Wrapped for the same reason as the cards: `counts.needsyou` is not a
    // field, `needsYou` is, and an unwrapped miss reads as zero.
    counts: wrap(board.counts, 'snapshot().counts'),
    /** The real card for a name, or a throw. Never `undefined` — see below. */
    card: (name) => found(agents, name, 'card'),
    /** The real roster row for a name, or a throw. */
    row: (name) => found(roster, name, 'roster row'),
    /** A fresh snapshot, for a test that changes the world underneath. */
    snapshot: () => wrap(status.snapshot().agents, 'snapshot().agents'),
    restore,
  };
}

/**
 * ⚠️ THROWS rather than returning `undefined`, and that is the same rule as
 * `strict`. A lookup that misses is a fixture that did not arrange what the
 * test believes it arranged, and `undefined` flowing into an assertion is how a
 * vacuous test passes.
 */
function found(cards, name, what) {
  const hit = cards.find((c) => c.sessionName === name);
  if (!hit) {
    throw new Error(
      `test-support/fleet has no ${what} for “${name}”. `
      + `The fleet holds: ${cards.map((c) => c.sessionName).join(', ') || '(nothing)'}.`,
    );
  }
  return hit;
}

/**
 * Did the real engine classify this fleet the way the test asked for?
 *
 * ⚠️ THE ANTI-VACUITY HALF. A fixture asking for "an agent that needs you" and
 * getting `unknown` still passes any assertion that only checks the row exists —
 * and every "needs you" count on this branch was permanently zero for a whole
 * feature's life without a single test noticing. So the fixture checks its own
 * arrangement against the classifier rather than assuming its screens still
 * mean what they meant when they were written.
 */
function verify(specs, board) {
  const wrong = [];
  for (const spec of specs) {
    if (!spec.state) continue;
    const card = board.agents.find((a) => a.sessionName === spec.name);
    if (!card) {
      wrong.push(`“${spec.name}” never reached the board at all`);
      continue;
    }
    if (card.state !== spec.state) {
      wrong.push(
        `“${spec.name}” was asked for as “${spec.state}” and the engine `
        + `classified it “${card.state}” (${card.because})`,
      );
    }
    if (spec.displayName && card.name !== spec.displayName) {
      wrong.push(
        `“${spec.name}” was asked to display as “${spec.displayName}” `
        + `and the board reads “${card.name}”`,
      );
    }
  }
  if (wrong.length) {
    throw new Error(
      'test-support/fleet did not arrange the fleet this test asked for:\n  - '
      + wrong.join('\n  - ')
      + '\nThe fixture is measuring a different world than the test believes.',
    );
  }
}

/**
 * A fleet we could not look at, which is NOT an empty fleet.
 *
 * `setPaneSource` answering null is "tmux could not be asked", and BOTH readers
 * refuse it: `paneRoster` by its own guard, `snapshot` through `listPanes`.
 *
 * ⚠️ This said "`snapshot` stays lenient" until iteration 9, which stopped being
 * true one commit before the sentence was written — and
 * `fixture-discipline.test.js` asserts the opposite two directories away. A
 * reader arranging a blind fleet for a snapshot-based test would have expected
 * an empty board and got a throw.
 *
 * ⚠️ NOT the same thing as a machine with no sessions. tmux answering
 * "no server running" is an EMPTY fleet and does not come through here — see
 * `tmuxSaidNoServer` in `engine/status.js`. This seam is the harder case: no
 * answer at all.
 */
function blind() {
  status.setPaneSource(() => null);
  status.setPaneCapture(() => null);
  return { restore };
}

/** tmux answering with something no line of which can be read. */
function unreadable(text = 'not_a_pane_line_at_all') {
  status.setPaneSource(() => text);
  status.setPaneCapture(() => null);
  return { restore };
}

/** tmux not answering at all — the source itself throwing. */
function refuses(message = 'tmux is not answering') {
  status.setPaneSource(() => { throw new Error(message); });
  status.setPaneCapture(() => null);
  return { restore };
}

/** Put the engine back on the real tmux. Safe to call twice. */
function restore() {
  status.setPaneSource(null);
  status.setPaneCapture(null);
}

module.exports = {
  agent, stranger, install, blind, unreadable, refuses, restore,
  line, strict, workersRoot,
  SCREEN, CLAUDE_COMMAND, HOUSEKEEPING,
};
