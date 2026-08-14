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
 *     node docs/browser-checks/thread-server.js
 */

const os = require('node:os');
const path = require('node:path');

for (const key of ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_WORKERS', 'AGENT_WORKFORCE_LAUNCH']) {
  const set = process.env[key];
  if (!set) {
    throw new Error(`${key} is not set: this would write into the real fleet's files. Refusing.`);
  }
  const real = path.resolve(set);
  if (real.startsWith(path.join(os.homedir(), 'Library')) || real === os.homedir()) {
    throw new Error(`${key} points at ${real}, which is not a sandbox. Refusing.`);
  }
}

const status = require('../../engine/status');
const chat = require('../../engine/chat');
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
];

/**
 * What each pane is showing. `mara`'s is a real Claude permission prompt shape:
 * the question the board classifies on, with the run-up above it that says what
 * is being asked about.
 */
const SCREENS = {
  'mara-discord:0.0': [
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
  'nils-discord:0.0': [
    '● Worked for 1m 02s',
    '',
    '> ',
    '⏵⏵ accept edits on                            ? for shortcuts',
    '',
  ].join('\n'),
};

const board = fleet.install(SPECS);
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
  if (args[0] === 'capture-pane') {
    const target = String(args[args.length - 3] || '').replace(/^=/, '');
    const screen = SCREENS[target];
    return screen === undefined
      ? { ran: true, status: 1, out: '', err: `can't find pane: ${target}` }
      : { ran: true, status: 0, out: screen, err: '' };
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
      return { ran: true, status: 1, out: '', err: "can't find pane: =nils-discord:0.0" };
    }
    return { ran: true, status: 0, out: '', err: '' };
  }
  return { ran: true, status: 0, out: '', err: '' };
});
chat.setDryRun(false);

const { start } = require('../../server');
require('../../engine/firstrun').complete();

start(Number(process.env.PORT) || 4421).then(() => {
  process.stdout.write(`thread-server: fixture fleet on ${process.env.PORT || 4421}\n`);
  process.stdout.write(`thread-server: ${board.agents.map((a) => `${a.name}=${a.state}`).join(' ')}\n`);
});
