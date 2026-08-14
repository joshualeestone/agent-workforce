'use strict';

/**
 * A server for looking at the project thread, with NOTHING pointed at the real
 * machine.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN `node server.js`. The other checks in this
 * directory drive the real routes against the HOST's real tmux, which is fine
 * when the worst a route does is read a pane. This screen SENDS: putting an
 * agent on a project here and pressing Send would type into a live agent's
 * conversation on this machine. So both seams are stubbed before the server is
 * required:
 *
 *   - the pane source, so the board is a fixture fleet and not the real one;
 *   - `chat`'s tmux runner, so a Send reaches this file and no further.
 *
 * ⚠️ AND IT REFUSES TO START UNSANDBOXED. The membership writes this screen
 * makes rewrite the instruction files agents boot from, so an unsandboxed run
 * does not litter — it changes how a working agent behaves at its next start.
 *
 *   SB=$(mktemp -d)
 *   PORT=4421 AGENT_WORKFORCE_DATA="$SB/data" \
 *     AGENT_WORKFORCE_WORKERS="$SB/workers" \
 *     AGENT_WORKFORCE_LAUNCH="$SB/launch" \
 *     AGENT_WORKFORCE_PROJECTS="$SB/kosmos-projects" \
 *     node docs/browser-checks/thread-server.js
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// ⚠️ `AGENT_WORKFORCE_PROJECTS` is in this list because the add screen now
// MAKES folders: creating a project with no folder puts a real directory under
// `~/Kosmos/Projects`. A check that leaves fixture directories in the
// operator's home is not sandboxed, whatever the other three say.
for (const key of ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_WORKERS', 'AGENT_WORKFORCE_LAUNCH', 'AGENT_WORKFORCE_PROJECTS']) {
  const set = process.env[key];
  if (!set) {
    throw new Error(`${key} is not set: this would write into the real fleet's files. Refusing.`);
  }
  // realpathSync of the nearest EXISTING ancestor, not path.resolve (round
  // 40): resolve does not follow symlinks, so /tmp/link -> ~/Kosmos/Projects
  // passed a guard whose stated job is stopping exactly that. Relative
  // values are refused outright rather than resolved under whatever cwd the
  // operator happened to launch from.
  if (!path.isAbsolute(set)) {
    throw new Error(`${key} is relative (${set}): pass an absolute sandbox path. Refusing.`);
  }
  const realOf = (p) => {
    let probe = p;
    for (;;) {
      try { return fs.realpathSync(probe); }
      catch { const up = path.dirname(probe); if (up === probe) return probe; probe = up; }
    }
  };
  const real = realOf(set);
  // ⚠️ `~/Kosmos` is in the refusal list by name: it is the real projects
  // root, the very directory the comment above warns about -- and the first
  // version of this guard rejected only ~/Library and ~ itself, so
  // AGENT_WORKFORCE_PROJECTS=~/Kosmos/Projects sailed through a guard whose
  // whole job was stopping exactly that.
  // ⚠️ `~/work` is refused too -- WORKERS' real default is ~/work/workers,
  // which is where the live fleet's instruction files boot from, and the
  // first version of this list covered every root EXCEPT the one whose harm
  // the header names. Refusals are per-root prefixes rather than a blanket
  // "anything under $HOME" because the sandboxes themselves may legitimately
  // live under $HOME on machines whose tmp is elsewhere.
  for (const banned of ['Library', 'Kosmos', 'work']) {
    const root = path.join(os.homedir(), banned);
    if (real === root || real.startsWith(root + path.sep)) {
      throw new Error(`${key} points at ${real}, which is not a sandbox. Refusing.`);
    }
  }
  if (real === os.homedir()) {
    throw new Error(`${key} points at ${real}, which is not a sandbox. Refusing.`);
  }
}

const status = require('../../engine/status');
const chat = require('../../engine/chat');
const create = require('../../engine/create');
const fleet = require('../../test-support/fleet');

/**
 * The fleet on screen. Built through the fixture, so these are the panes the
 * real classifier reads — a hand-written board would be a picture of a world
 * this product does not produce.
 */
const SPECS = [
  fleet.agent('mara', { displayName: 'Mara', role: 'project manager', state: 'needs_you' }),
  fleet.agent('casey', { displayName: 'Casey', role: 'writer', state: 'working' }),
  fleet.agent('nils', { displayName: 'Nils', role: 'researcher', state: 'idle' }),
  /**
   * ⚠️ A NAME THAT CANNOT BE FILED UNDER, in the fixture so the check can drive
   * that screen. A capital puts a session name outside the store key
   * `chat.threadFile` will file a thread under — which is exactly what adopting
   * the pre-existing -discord fleet produces, and exactly the capitalised names
   * Josh asked to be able to use. Sending works; keeping does not.
   */
  fleet.agent('MyBot', { displayName: 'MyBot', role: 'writer', state: 'idle' }),
  /**
   * ⚠️ A BORROWED NAME in the fixture, so the untied card renders at all.
   * MEASURED (round 13): the full pipeline forces an untied pane's state to
   * `unknown` before the page ever sees it -- capture is refused for a pane
   * we cannot tie, so `needs_you` cannot arrive on an untied card through
   * real routes, and no browser check can drive that shape honestly. The
   * button's `&& a.isNamedOurs` gate is therefore defence-in-depth (the
   * shape only exists if the upstream gating ever changes), and the layer
   * that holds it is the source pin in server.test.js, not a render check.
   * What rook DOES buy here: the untied card's own rendering is on the
   * board and in the screenshots, and the no-button assertion below covers
   * the state the pipeline actually produces for it.
   */
  fleet.stranger('rook', { state: 'needs_you' }),
];

/**
 * What each pane is showing. `mara`'s is a real Claude permission prompt shape:
 * the question the board classifies on, with the run-up above it that says what
 * is being asked about.
 */
const SCREENS = {
  'mara-discord:0.0': [
    // ⚠️ ONE DELIBERATELY WIDE LINE, because a terminal really does produce
    // them and the box has to have somewhere to put it. Without a line wider
    // than the viewport, "the pre scrolls internally" is a property the fixture
    // never creates — so the check asserting it would be measuring nothing, and
    // the page-does-not-scroll-sideways check beside it would pass on a layout
    // that has never been asked a hard question.
    '  ⎿  /Users/someone/Kosmos/Projects/Henderson lease/schedule-of-dilapidations/north-building/appendices/2026-Q3-survey-notes-and-photographic-schedule-with-surveyor-annotations.md',
    '● I have read the lease and drafted the summary.',
    '',
    '● Write(Henderson-summary.md)',
    '  ⎿  Wrote 41 lines',
    '',
    '  I need to replace the old summary file to do that.',
    '',
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. Yes, and do not ask again this session',
    '  3. No, tell me what to do differently',
    '',
  ].join('\n'),
  'casey-discord:0.0': [
    '● Reading the Henderson lease',
    '  ⎿  Read 220 lines',
    '',
    '· Drafting (esc to interrupt)',
    '',
  ].join('\n'),
  'MyBot-discord:0.0': [
    '● Worked for 12s',
    '',
    '> ',
    '⏵⏵ accept edits on                            ? for shortcuts',
    '',
  ].join('\n'),
  'nils-discord:0.0': [
    '● Worked for 1m 02s',
    '',
    '> ',
    '⏵⏵ accept edits on                            ? for shortcuts',
    '',
  ].join('\n'),
};

// The call installs the pane source; its return value is deliberately not
// bound (round 22): nothing here reads it, and the roster the check trusts
// is read back from /api/status (see the announcement below).
fleet.install(SPECS);
// The board's own capture seam answers the same screens, so the card's state
// and the thread's viewport are two readings of ONE fixture rather than two
// inventions that could disagree.
status.setPaneCapture((target) => (target in SCREENS ? SCREENS[target] : null));

/**
 * The send seam. Answers the way tmux does and goes no further.
 *
 * ⚠️ It also RECORDS what a Send would have typed, on stdout, so the check can
 * assert that the text the person wrote is the text that would have reached the
 * pane — the one thing a screenshot cannot show.
 */
chat.setRunner((args) => {
  /**
   * ⚠️ THE JUST-BEFORE-SENDING PROBE, answered from the SAME fleet spec the
   * board is built from.
   *
   * `deliver` asks the pane about itself immediately before typing, because the
   * roster it was authorised against is already hundreds of milliseconds old
   * (see `verifyAtSend`). A fixture that does not answer that question returns
   * an empty string, which reads as "no Claude running" and refuses every send
   * — which is exactly what happened the first time this check ran after the
   * probe landed: the unconfirmed step waited ten seconds for a sentence that
   * was never coming.
   *
   * Answered from `SPECS` rather than hard-coded, so the probe and the board
   * cannot describe different fleets.
   */
  // ⚠️ The target is read from the `-t` FLAG, not a fixed position. The
  // send-keys arm already matches by substring for the same reason: a change
  // to the engine's argv shape would make a positional read answer about the
  // wrong pane, or emit a spurious "can't find pane" that reads as a product
  // defect in every check downstream.
  const targetOf = (argv) => {
    const i = argv.indexOf('-t');
    return i >= 0 ? String(argv[i + 1] || '').replace(/^=/, '') : '';
  };
  if (args[0] === 'display-message') {
    const target = targetOf(args);
    const spec = SPECS.find((s) => `${s.session}:${s.pane}` === target);
    if (!spec) {
      return { ran: true, spawnFailed: false, status: 1, out: '', err: `can't find pane: ${target}` };
    }
    // The field ORDER is the engine's own VERIFY_FORMAT: command, claim, inMode.
    return {
      ran: true,
      spawnFailed: false,
      status: 0,
      out: `${spec.command}\t${spec.claim || ''}\t${spec.inMode || '0'}\n`,
      err: '',
    };
  }
  if (args[0] === 'capture-pane') {
    const target = targetOf(args);
    const screen = SCREENS[target];
    return screen === undefined
      ? { ran: true, spawnFailed: false, status: 1, out: '', err: `can't find pane: ${target}` }
      : { ran: true, spawnFailed: false, status: 0, out: screen, err: '' };
  }
  if (args[0] === 'send-keys') {
    process.stdout.write('SEND-KEYS ' + JSON.stringify(args) + '\n');
    /**
     * ⚠️ ONE AGENT'S SENDS FAIL, ON PURPOSE. A fixture where every send
     * succeeds can only ever photograph the happy path, and the failure sentence
     * is the half of this screen that has to be right — it is what somebody
     * reads when their message did not get there. `nils`'s pane answers the way
     * tmux answers for a session that has gone since the roster was read, which
     * is the commonest real cause.
     */
    if (String(args[2] || '').includes('nils')) {
      return { ran: true, spawnFailed: false, status: 1, out: '', err: "can't find pane: =nils-discord:0.0" };
    }
    /**
     * ⚠️ AND ONE AGENT PRODUCES THE AMBIGUOUS OUTCOME, which is the state that
     * is hardest to get right on screen and therefore the one most worth
     * looking at. `casey` takes the text and then fails on the Enter — so the
     * words are in its composer and we cannot say whether they were submitted.
     * A fixture with only success and only failure would photograph two thirds
     * of this feature.
     */
    // Discriminated by SHAPE, not position (round 28): the Enter call has
    // no -l flag, while the literal-text call does -- so a message whose
    // text is exactly "Enter" no longer matches this arm on the text send
    // and photographs a could_not where the fixture means an unconfirmed.
    if (String(args[2] || '').includes('casey') && !args.includes('-l') && args[args.length - 1] === 'Enter') {
      return { ran: true, spawnFailed: false, status: 1, out: '', err: 'no current session' };
    }
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  }
  return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
});
/**
 * ⚠️ ASSERTED, LIKE THE CREATION SEAM BELOW. `setDryRun(false)` was called here
 * with nothing to check it against — so the seam that TYPES INTO A LIVE AGENT
 * was the unguarded one, while its neighbour (which only makes folders) was
 * the one whose state this file verifies. That asymmetry is backwards. `chat`
 * exports its flag now, and both seams answer for themselves.
 */
chat.setDryRun(false);
if (chat.DRY_RUN !== false) {
  throw new Error('chat is still in dry-run: this fixture would report deliveries it never made. Refusing.');
}

/**
 * The CREATION seam, armed the other way round.
 *
 * ⚠️ `create` is left in DRY-RUN with a recorder installed, which is the one
 * combination where it writes nothing and runs nothing while still answering
 * the way it really answers. That is what makes the last screen of the create
 * flow — the step list, the display name, the background-item notice — safe to
 * look at on a machine with a live fleet on it. Without this, opening that
 * screen in a browser check would put a real folder, a real launchd job and a
 * real tmux session on somebody's Mac.
 */
create.setRunner((file, args) => {
  process.stdout.write('CREATE-RAN ' + JSON.stringify([file, args]) + '\n');
  return { ok: true, stdout: '' };
});
/**
 * ⚠️ SET EXPLICITLY, AND THEN ASSERTED — and the assertion caught the first
 * version of these four lines. `setRunner` re-arms dry-run only when it is
 * handed NULL; installing a runner leaves the flag exactly as it was, which on
 * a fresh process is FALSE. So this file, whose entire purpose is that nothing
 * reaches the machine, was one line away from making a real folder, a real
 * launchd job and a real tmux session the first time anybody opened the create
 * screen against it. The check is cheap and the failure is not.
 */
create.setDryRun(true);
if (create.DRY_RUN !== true) {
  throw new Error('create is not in dry-run: this fixture would make real agents. Refusing.');
}

const { start } = require('../../server');
require('../../engine/firstrun').complete();

start(Number(process.env.PORT) || 4421).then(async () => {
  const port = Number(process.env.PORT) || 4421;
  process.stdout.write(`thread-server: fixture fleet on ${port}\n`);
  // ⚠️ The roster line is read back from the SERVER'S OWN /api/status, not
  // from board.agents: the two can disagree (the route forces an untied
  // pane's state to unknown while the install snapshot carries the spec
  // state), and render-thread.js compares this line against what the
  // driven server serves to prove the server IS this fixture. An
  // announcement the server itself would contradict fails that identity
  // check against the genuine fixture.
  const served = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
  process.stdout.write(`thread-server: ${(served.agents || []).map((a) => `${a.name}=${a.state}`).join(' ')}\n`);
  // ⚠️ Published for the same reason the port is: a check that needs to reach
  // into this server's store must be able to prove WHICH store, rather than
  // being handed a path and trusting it. See assertFixtureServer.
  process.stdout.write(`thread-server: data ${process.env.AGENT_WORKFORCE_DATA}\n`);
});
