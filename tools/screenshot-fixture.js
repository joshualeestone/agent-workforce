'use strict';

/**
 * Serves the UI against a SYNTHETIC roster, so a screenshot can be taken
 * without capturing live fleet state.
 *
 * ⚠️ This file exists because of a review finding, and the finding was mine.
 * I committed two screenshots of the fresh-start dialog rendered against the
 * real machine: thirteen real agent names, a real person's photograph, live
 * task lines, and a commitment naming a person, a domain and a dated
 * obligation. The repo's own `.gitignore` header forbids exactly that
 * ("Screenshots of live data go to Discord or the private vault, never here.
 * Agent names plus task lines are already a business disclosure").
 *
 * The reason it happened is worth more than the fix: the house rule requires a
 * screenshot on every frontend PR, and until now the ONLY way to produce one
 * was to point a browser at the real server. The rule and the mechanism were
 * in direct conflict, and the rule lost quietly. So the fix is not "remember
 * harder", it is a second way to render the screen.
 *
 * ⚠️ This is the FORWARD fix only. Three screenshots taken the same way are
 * already merged to `main` and remain in its history; re-shooting at the tip
 * does not remove a blob. That is tracked in the plan file for this branch and
 * has to be settled before the repo is made public. Read this comment as "it
 * cannot happen again", not as "it has been undone".
 *
 * It reads nothing. No tmux, no launchd, no commitment store, no worker
 * directory, no `~/Library/Application Support`. The roster below is invented,
 * which is the whole point: there is no path from this process to anything
 * real, so it cannot leak by accident the way a redaction pass can.
 *
 *   node tools/screenshot-fixture.js [port]
 *   open http://127.0.0.1:9971/?fresh=aria
 *
 * The `?fresh=<name>` parameter is the app's own deep link to the dialog, so
 * what you photograph is the real component, not a mock of it.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 9971);

// A fixed instant, so re-running this produces the same picture rather than a
// diff in every "3 minutes ago" on the page.
const NOW = '2026-01-15T10:00:00.000Z';

const AGENTS = [
  {
    sessionName: 'aria',
    name: 'Aria',
    nameDerived: true,
    role: 'research assistant',
    modelName: 'Claude Opus 5',
    state: 'idle',
    stateConfidence: 'scraped',
    because: 'it finished and is waiting for you',
    task: 'Summarise the Q3 supplier quotes',
    isAgentPane: true,
    isAgentSession: true,
    hasAvatar: false,
    target: 'aria-discord:0.0',
    context: {
      tokens: 412000,
      percent: 41,
      confidence: 'structured',
      because: 'read from the transcript',
    },
    // Holding three items while visibly idle: the case the whole card exists
    // for. A dialog that only checked whether the agent was busy would call
    // this safe.
    commitments: {
      state: 'holding',
      because: 'it reported these itself',
      reportedAt: NOW,
      token: 'holding:fixture000000000000000000000000',
      commitments: [
        { id: 'c1', what: 'Redrawing the supplier comparison table', createdAt: NOW, source: 'agent' },
        { id: 'c2', what: 'Draft the follow-up note to the shortlisted vendors', createdAt: NOW, source: 'agent' },
        { id: 'c3', what: 'Check the delivery window before Friday', createdAt: NOW, source: 'agent' },
      ],
    },
    instructions: {
      state: 'current',
      because: 'this agent started after the file was last edited',
      version: 'sha256:fixture',
    },
  },
  {
    sessionName: 'bram',
    name: 'Bram',
    nameDerived: true,
    role: 'bookkeeping',
    modelName: 'Claude Sonnet 5',
    state: 'working',
    stateConfidence: 'scraped',
    because: 'it is producing output right now',
    task: 'Reconciling the July statements',
    isAgentPane: true,
    isAgentSession: true,
    hasAvatar: false,
    target: 'bram-discord:0.0',
    context: {
      tokens: 120000,
      percent: 12,
      confidence: 'structured',
      because: 'read from the transcript',
    },
    // The state that must never render as an empty list.
    commitments: {
      state: 'unknown',
      because: 'this agent has never reported what it is holding',
      reportedAt: null,
      token: 'unknown:fixture000000000000000000000000',
      commitments: [],
    },
    instructions: { state: 'unknown', because: 'it has no instruction file yet', editable: true },
  },
  {
    sessionName: 'cleo',
    name: 'Cleo',
    nameDerived: true,
    role: 'scheduling',
    modelName: 'Claude Opus 5',
    state: 'idle',
    stateConfidence: 'scraped',
    because: 'it finished and is waiting for you',
    task: 'Confirm the Thursday slot with the venue',
    isAgentPane: true,
    isAgentSession: true,
    hasAvatar: false,
    target: 'cleo-discord:0.0',
    context: { tokens: 60000, percent: 6, confidence: 'structured', because: 'read from the transcript' },
    commitments: {
      state: 'clear',
      because: 'it reported that it is holding nothing',
      reportedAt: NOW,
      token: 'clear:fixture0000000000000000000000000',
      commitments: [],
    },
    // Edited after it started, so the detail panel shows the staleness note and
    // the fresh-start button that note now carries. This state has been the
    // source of three separate wrong sentences, so it needs to be photographable.
    instructions: {
      state: 'stale',
      because: 'the file was edited after this agent started',
      editedAt: '2026-01-15T09:40:00.000Z',
      startedAt: '2026-01-14T16:02:00.000Z',
      version: 'sha256:fixture',
    },
  },
  {
    sessionName: 'dov',
    name: 'dov',
    nameDerived: false,
    role: '',
    modelName: 'Claude Sonnet 5',
    state: 'idle',
    stateConfidence: 'scraped',
    because: 'it finished and is waiting for you',
    task: 'Waiting',
    isAgentPane: true,
    isAgentSession: true,
    hasAvatar: false,
    target: 'dov-discord:0.0',
    context: { tokens: null, percent: null, confidence: 'unknown', because: 'no transcript was found for it' },
    commitments: {
      state: 'unknown',
      because: 'this agent has never reported what it is holding',
      reportedAt: null,
      token: 'unknown:fixture111111111111111111111111',
      commitments: [],
    },
    // The file exists but cannot be shown, so it must not be offered for
    // editing: a Save here would overwrite something the screen never displayed.
    // That was a real blocker in #9 and it is the reason this state has a
    // screenshot at all.
    instructions: {
      state: 'unknown',
      because: 'its instruction file is not UTF-8 text',
      editable: false,
    },
  },
];

function serve(req, res) {
  const url = req.url.split('?')[0];

  if (url === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    // ⚠️ `checkedAt` is the ONE field that must be the real current time, while
    // everything else stays pinned to NOW for reproducibility.
    //
    // Pinning it too made the shipped documentation screenshot render "206 days
    // ago" under the stale squiggle: the board's headline honesty signal, caught
    // displaying its own failure state, in the image meant to show the product
    // working.
    //
    // ⚠️ This is NOT fully deterministic, and an earlier version of this comment
    // claimed it was ("a fresh timestamp always renders 'just now'"). It does
    // not: `ageText` only says "just now" below five seconds, and every
    // committed screenshot in fact reads "5 seconds ago" because the capture
    // takes longer than that. The stamp can therefore differ by a word between
    // runs. That is a one-line diff in an image, and worth far less than the
    // honesty signal being wrong — but a false claim in a comment is how the
    // next person stops checking.
    // ⚠️ `counts` is DERIVED from the roster with the engine's own predicates,
    // not hand-written. The hand-written version disagreed with the agents
    // beside it — it claimed `unknown: 1` when every fixture agent is idle or
    // working, and `unknownFullness: 0` when `dov` has no readable percentage —
    // and that contradiction shipped in `docs/screenshots/board.png`, which
    // reads "4 agents · 1 we cannot read" above four cards none of which is in
    // that state.
    //
    // A fixture that misstates the board's own honesty summary is worse than no
    // fixture: the summary line is the product's headline claim about what it
    // does and does not know, and the documentation image showed it lying.
    // ⚠️ `may` from the REAL `mayTypeInto`, like `/api/actions` above. Hand-
    // writing it here would be a fixture asserting the product allows something
    // it does not, which is the failure mode a fixture is most able to hide.
    const lifecycle = require(path.join(ROOT, 'engine', 'lifecycle'));
    const agents = AGENTS.map((a) => ({
      ...a,
      may: ['compact', 'clear', 'restart'].reduce((acc, action) => {
        const verdict = lifecycle.mayTypeInto(action, a);
        acc[action] = { ok: verdict.ok, because: verdict.because || null };
        return acc;
      }, {}),
    }));
    res.end(JSON.stringify({
      agents,
      version: '0.1.0',
      checkedAt: new Date().toISOString(),
      counts: {
        total: AGENTS.length,
        needsYou: AGENTS.filter((a) => a.state === 'needs_you').length,
        unknown: AGENTS.filter((a) => a.state === 'unknown').length,
        unreadableTokens: AGENTS.filter((a) => a.context.tokens === null).length,
        unknownFullness: AGENTS.filter((a) => a.context.percent === null).length,
      },
    }));
    return;
  }

  // The real action list, not a copy of it. If the engine's wording changes,
  // the screenshot changes with it rather than going quietly out of date.
  if (url === '/api/actions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(require(path.join(ROOT, 'engine', 'lifecycle')).ACTIONS));
    return;
  }

  // The instruction editor's read. Invented prose, deliberately about nothing:
  // the three instruction screenshots already on main were shot against real
  // worker files and carry a real agent's name, its live task line and a
  // sentence naming a commercial partner. Same class of leak as the dialog
  // shots, one release earlier.
  const instr = url.match(/^\/api\/agent\/([^/]+)\/instructions$/);
  if (instr && req.method === 'GET') {
    const who = decodeURIComponent(instr[1]);
    const found = AGENTS.find((a) => a.sessionName === who);
    if (!found) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no such agent' }));
      return;
    }
    // ⚠️ This must mirror `engine/instructions.read()`'s SHAPE exactly, and the
    // first version did not: it returned `state` at the top level instead of a
    // nested `staleness`, and invented a `showable` field the page has never
    // read. The screenshot that came out showed an empty editable box for a file
    // the app actually refuses — the precise defect #9's loop existed to kill.
    // A fixture that renders a state the product does not have is worse than no
    // fixture: it produces a convincing picture of a bug that isn't there, or
    // hides one that is.
    const bodies = {
      aria: '# Aria\n\nYou help with reading and summarising documents.\nAsk before sending anything to anyone.\n',
      cleo: '# Cleo\n\nYou keep the calendar.\nNever accept an invitation on my behalf without asking.\n',
    };

    // `unreadable` is the case where a file IS there but cannot be shown, so it
    // must come back not-editable with a token that can never match.
    const unreadable = found.instructions.state === 'unknown'
      && /not UTF-8|cannot read|too large/.test(found.instructions.because || '');
    const body = bodies[found.sessionName] || '';

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body
      ? {
        exists: true,
        editable: true,
        path: `/example/workers/${found.sessionName}/CLAUDE.md`,
        text: body,
        version: 'sha256:fixture',
        hasPrevious: found.sessionName === 'cleo',
        editedAt: found.instructions.editedAt || NOW,
        staleness: found.instructions,
      }
      : {
        exists: false,
        editable: !unreadable,
        version: unreadable ? 'UNREADABLE' : 'ABSENT',
        path: `/example/workers/${found.sessionName}/CLAUDE.md`,
        text: '',
        because: found.instructions.because,
        staleness: found.instructions,
      }));
    return;
  }

  // ⚠️ Every write route is absent on purpose. A POST from this page 404s.
  // A fixture server that could actually restart something would be a far
  // worse hazard than the screenshots it exists to replace.
  if (url.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'the fixture server serves reads only' }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(ROOT, 'web', 'index.html')));
}

if (require.main === module) {
  http.createServer(serve).listen(PORT, '127.0.0.1', () => {
    console.log(`fixture roster on http://127.0.0.1:${PORT}`);
    console.log(`  holding: http://127.0.0.1:${PORT}/?fresh=aria`);
    console.log(`  unknown: http://127.0.0.1:${PORT}/?fresh=bram`);
  });
}

module.exports = { serve, AGENTS, PORT };
