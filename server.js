'use strict';

/**
 * A local window onto the agents running on this machine.
 *
 * Binds to localhost only, and it WRITES: it stores avatars, roles, the
 * commitments each agent says it is holding, and the instruction file each
 * agent reads at startup. It also MAKES agents: `POST /api/agents` writes a
 * worker directory, a startup script and a launchd job, and loads that job.
 * It can now stop and remove an agent, and put one back. And it TYPES INTO
 * ONE: `POST /api/project/:id/thread/:agent` places a line of text into that
 * agent's own tmux session. That is the strongest thing in this file, so read
 * `engine/chat.js`'s header for what it may and may not claim about it — the
 * short version is that a keystroke reaching a terminal is never evidence that
 * an agent read anything.
 *
 * See the ⚠️ block above `start()` for what protects it, and what does not.
 */

const http = require('node:http');
const { pipeline } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
// `STATE` travels with them: the thread route compares a member's state, and a
// literal there is a comparison that silently stops matching the day the engine
// renames one.
const { snapshot, paneRoster, countAgents, STATE } = require('./engine/status');
const removal = require('./engine/remove');
const firstrun = require('./engine/firstrun');
const subscription = require('./engine/subscription');
const connect = require('./engine/connect');
const machine = require('./engine/machine');
const updates = require('./engine/update');

// Single source of truth for the version. With no support function, "what
// version are you on?" is the first question of every diagnosis, so the number
// on screen has to be the number in the release rather than a hand-typed label
// that drifts.
const { version } = require('./package.json');
const store = require('./engine/store');
const create = require('./engine/create');
const roles = require('./engine/roles');
const commitments = require('./engine/commitments');
const you = require('./engine/you');
const instructions = require('./engine/instructions');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const chat = require('./engine/chat');
const os = require('node:os');

/**
 * The agent CARDS a project row is described against, or null if we could not
 * look.
 *
 * ⚠️ A SECOND DOCBLOCK USED TO SIT ABOVE THIS ONE describing `paneRoster`'s
 * fail-closed contract, left over from when this helper called it. It has not
 * called it since the defect below was fixed, so the paragraph documented a
 * function this code does not use, immediately above a paragraph saying so in
 * capitals. Removed rather than reworded: an outlived sentence is the defect
 * this file keeps finding, and keeping two is not better than keeping one.
 *
 * What survives from it, because it is still true of THIS helper: refusing is
 * right for the board, whose job is to say how agents ARE, and wrong for a
 * project's own record, which is readable either way — the members are still
 * ours to list, and `describe` marks each one `present: false` with a reason.
 * So this degrades to "we could not see them", never to "you have no projects",
 * and the route that reports fleet state alongside the list says so explicitly
 * with `agentsUnreadable` rather than pretending the roster is empty.
 *
 * ⚠️ `snapshot()`, NOT `paneRoster()`, and this was a real shipped defect for
 * the whole of this branch's life. `paneRoster` returns exactly
 * `{sessionName, session, isNamedOurs}` — it has never carried `name`, `state`
 * or `because`. `describe` reads all three, so every member row rendered with
 * the machine name instead of the display name (`claudebot`, never
 * `Splinter` — the ONE thing this feature's own docstring promises), with
 * `state: undefined` showing as a bare "Can't tell", and with `needsYou` and
 * `working` permanently zero, so the "1 needs you" the list exists to draw
 * could never appear. It is visible in the committed screenshots.
 *
 * It survived six rounds of review because THE TEST FIXTURE INVENTED THE
 * FIELDS. `ROSTER` in the engine suite carried `name`/`state`/`because`, which
 * nothing in this repo produces, so the tests measured a world that does not
 * exist. Measuring against the wrong world is worse than not measuring: it
 * produces confidence.
 *
 * ⚠️ RETURNS NULL, NOT [], when the look fails. An empty array is a claim — it
 * says we looked and there was nobody — and every consumer treats a non-array
 * roster as "we could not look" and says so.
 */
function safeRoster() {
  try {
    const board = snapshot();
    const agents = (board && board.agents) || [];
    // ⚠️ REMOVED AGENTS COME OFF HERE TOO, exactly as they do on the board. Two
    // derivations of "the fleet" is this codebase's worst habit, and this was
    // one: an agent the person had removed -- which the board calls "the whole
    // user-visible half of a removal" -- still showed on a project row as
    // present, with a live state, and the write gate still let us splice the
    // managed block into its boot file. So Kosmos would have edited the
    // instructions of an agent it had told the person was gone, and the row
    // would have said "Kosmos told it where this folder is" about it.
    const gone = new Set(removal.removedAgents().filter((r) => r.stopped !== false).map((r) => r.name));
    return agents.filter((a) => !gone.has(a.sessionName));
  } catch {
    return null;
  }
}

// Reads the body of an upload. Capped, because an unbounded read on a local
// server is still a way to fill someone's memory by accident.
const MAX_UPLOAD = 6 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) { reject(new Error('file is too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Is this a name the board actually knows?
 *
 * ⚠️ Known limitation, written down rather than left to be discovered. This
 * compares against `safeKey(name)`, so an agent whose tmux session name is not
 * already its own sanitised form (a capital, a dot, a space) is rejected by
 * every route here, even though the status poll publishes a real staleness
 * verdict for it. The card would show "running on older instructions" and
 * clicking through would 404.
 *
 * ⚠️ And a correction to what an earlier version of this comment claimed. It
 * said that NOT widening the gate avoided accepting two names that sanitise to
 * the same directory. That was wrong: the gate compares against `safeKey(name)`
 * and `fileFor` resolves through `safeKey` too, so it ALREADY accepts every
 * spelling that sanitises to a live agent. Verified against the live roster:
 * `an.gel`, `ANGEL`, `a n g e l` and `ang!el` all pass and all resolve to
 * `angel/CLAUDE.md`. That is harmless while it is the same agent.
 *
 * The real latent risk, stated accurately: if two agents ever exist whose names
 * sanitise to the SAME key (sessions `mybot` and `my.bot`), the gate cannot
 * tell them apart and both read and write one file. Nothing detects that today.
 * There are currently no such collisions and no agent whose name differs from
 * its own sanitised form, both checked rather than assumed. The real fix is one
 * identity per agent instead of a name that is sanitised in one place and
 * verbatim in another, which is a change to the avatar and profile stores too.
 */
/**
 * Is this name currently claimed by a pane that is NOT tied to it?
 *
 * The precise question for a READ keyed on an agent name. `knownAgent` asks
 * whether the agent is on the board, which is the wrong question for a record
 * meant to outlive the agent's conversation.
 */
/**
 * The card that answers for this spelling, or `null` if none does.
 *
 * ⚠️ ONE predicate, because two of them diverged and the divergence was the
 * worst defect on this branch. `borrowedName` was corrected three times until
 * it asked the right question — **which CARD answers for the spelling asked
 * for**, not which cards share a sanitised key — and `knownAgent` was left on
 * the old per-key form. So with the real `angel-discord` up and a bystander's
 * `tmux new -s Angel` open, the reads refused correctly while the WRITES
 * accepted: `PUT /api/agent/Angel/instructions` rewrote the real agent's boot
 * file, `PUT .../profile` overwrote its role, `DELETE .../avatar` deleted its
 * picture, and `GET .../instructions` handed back its full text and path.
 *
 * That is the fifth time on this work that a fix stopped one layer short, and
 * it is the reason these are wrappers rather than two implementations: a lesson
 * learned by one gate has to be structurally impossible for the other to miss.
 *
 * The rule, re-derived: if a card's OWN session name is exactly what was asked
 * for, that card answers — nobody else's spelling is relevant. Only when no
 * card spells it that way do we fall back to the sanitised key, which is what
 * keeps a healthy agent reachable under its normalised name.
 */
function claimantFor(name) {
  const roster = paneRoster();
  const asked = String(name);

  const exact = roster.filter((a) => a.sessionName === asked);
  if (exact.length) return exact.find((a) => a.isNamedOurs === true) || exact[0];

  const key = store.safeKey(asked);
  const claimants = roster.filter((a) => {
    try { return store.safeKey(a.sessionName) === key; } catch { return false; }
  });
  if (!claimants.length) return null;
  return claimants.find((a) => a.isNamedOurs === true) || claimants[0];
}

/**
 * Is this spelling answered by a card we cannot tie to the name it is filed
 * under? The question for a READ.
 *
 * ⚠️ Fails CLOSED. `paneRoster` throws when tmux cannot be asked, rather than
 * answering "nothing" — the realistic failure used to arrive here as an empty
 * roster and serve the record.
 */
function borrowedName(name) {
  try {
    const card = claimantFor(name);
    return Boolean(card) && card.isNamedOurs !== true;
  } catch {
    return true;
  }
}

/**
 * Is this spelling answered by a card we CAN tie to its name? The question for
 * a WRITE, and the strictly stronger one: a name nobody is running is not
 * writable, while its record stays readable.
 */
/**
 * The REAL tmux session behind a board name.
 *
 * ⚠️ Every reader that resolves a per-session artifact needs this rather than
 * the displayed name, and the fix reached them one at a time: the model and the
 * memory ring first, then the card's staleness, and this is the fourth. Until
 * it did, the panel and the card could date the same agent from two different
 * conversations -- one fact with two derivations, which is what this whole
 * branch is about.
 */
function sessionOf(name) {
  try {
    const card = claimantFor(name);
    return (card && card.session) || undefined;
  } catch {
    return undefined;
  }
}
// ⚠️ Two roster reads per request is two SNAPSHOTS: the gate can be decided
// against one and the session resolved against another, which is the same
// one-fact-two-derivations problem one level up. Both callers below run
// `knownAgent` first, so this is noted rather than fixed here — the shape that
// removes it is a single `claimantFor` whose card both the gate and the session
// come from, and that is a change to how every name-keyed route resolves.

function knownAgent(name) {
  try {
    const card = claimantFor(name);
    return Boolean(card) && card.isNamedOurs === true;
  } catch {
    return false;
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const PORT = Number(process.env.PORT || 4317);

/**
 * The path, with any query string removed.
 *
 * Routing used to match `req.url` directly, which includes the query string, so
 * an anchored pattern stopped matching the moment a caller appended anything.
 * The request then fell past every route to the catch-all and was answered with
 * the HTML page, at status 200.
 *
 * That is how a working avatar looked broken for an afternoon: the detail page
 * cache-busts with `?t=<now>` so a freshly uploaded picture appears immediately,
 * and that query string was the exact reason the picture never appeared. The
 * card grid, which requests the same avatar without one, showed it correctly --
 * so it read as a bad image format rather than a bad route.
 *
 * Matching on the pathname makes a query string unable to change which handler
 * runs, which is the only sane rule. Callers are free to append whatever they
 * like.
 */
const ROUTING_BASE = 'http://localhost';
// Loopback identities this server will answer to. Compared on HOSTNAME, not
// host: the port is deliberately ignored, because a proxy or tunnel in front of
// this process legitimately names a different one, and the earlier host-based
// check got it exactly backwards -- routing `//localhost/x` (port 80, not us)
// while refusing `//localhost:4317/x` (us).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Extra hostnames this server will answer to, comma-separated.
 *
 * Empty by default. Set it only if you are deliberately putting a proxy in
 * front of this port, and read the warning above `start()` first: there is no
 * authentication here, and the writes include the file an agent boots from.
 */
const ALLOWED_HOSTS = new Set(
  String(process.env.AGENT_WORKFORCE_ALLOWED_HOSTS || '')
    .split(',')
    // ⚠️ The PORT is stripped, because the incoming value is compared as a bare
    // hostname and an operator copying `host:port` out of their proxy config
    // would otherwise get a silently dead entry and a 400 with nothing pointing
    // at the cause. Trailing dot and case too, matching how the header is
    // normalised below: an allowlist that only works if you spell it the way
    // the code happens to expect is not an allowlist.
    .map((h) => h.trim().replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase())
    .filter(Boolean),
);

/**
 * Returns the request's path with any query string removed, or `null` when the
 * target is not one we should route at all.
 *
 * `null` is distinct from `'/'` on purpose. `'/'` means "no route matched, show
 * the page", which is right for an ordinary unknown path in a single-page app.
 * A target we cannot place -- one carrying someone else's authority -- is not
 * an unknown page, it is a request that was not for us, and answering it with
 * the index at 200 is the same silent-success shape as the bug below.
 */
function pathOf(req) {
  const raw = req && req.url;
  if (typeof raw !== 'string' || raw === '') return null;

  // Parse first, judge after. An earlier version rejected anything not starting
  // with '/', which threw out absolute-form (`GET http://host/path`) before the
  // loopback check could see it -- and absolute-form is exactly what a proxy in
  // front of this port sends, the deployment the warning above start() says is
  // live on this machine. Origin-form and absolute-form both parse here; only
  // the resolved host decides.
  let parsed;
  try {
    parsed = new URL(raw, ROUTING_BASE);
  } catch {
    return null;
  }

  // Only route targets whose own authority is us. A target carrying an
  // authority -- `//host/path`, or an absolute `http://host/path` -- otherwise
  // has its host silently discarded and gets routed on the path alone.
  //
  // ⚠️ This inspects the request TARGET, not the `Host` header. Those are
  // different questions and this one is not an origin check. The `Host` check
  // that closes DNS rebinding is a separate block further down, added later;
  // this comment used to say the gap was "tracked separately" and left that
  // standing after it was closed, which understates the protection rather than
  // overstating it but is the same defect either way.
  //
  // Checking the parsed host rather than the string shape is deliberate. The
  // obvious guard is `raw.startsWith('//')`, and it does not work: the URL
  // parser treats a backslash as a slash for http, so `/\evil.example/api/status`
  // is authority-form while passing any startsWith check, and resolves to host
  // `evil.example` with pathname `/api/status`. Asserting on what the parser
  // actually produced is the only version that holds, because it tests the
  // property we care about rather than a spelling of it.
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;

  // ⚠️ And the `Host` HEADER, which is a different question from the target's
  // authority and closes a different hole.
  //
  // The check above inspects what the client ASKED FOR. This one inspects what
  // it thinks it is talking to, and without it the server answers
  // `Host: evil.example.com` with the full agent roster. That is DNS rebinding:
  // a page on some other site, whose DNS then points at 127.0.0.1, becomes
  // same-origin with this server, so no CORS preflight is involved and the
  // response is readable. The attacker enumerates the agents and then PUTs a
  // new instruction file for any of them.
  //
  // This gap predates the branch and was survivable while the writes were an
  // avatar and a job title. It is not survivable now: this server edits the
  // file an agent boots from, so the same hole is remote code execution by the
  // agent, one restart later. The comment above `start()` used to enumerate
  // "two ways that protection is lost" and this was not one of them.
  //
  // ⚠️ This REFUSES a proxied request, and that is deliberate rather than an
  // oversight. Said plainly because it is a behaviour change: a reverse proxy
  // forwards its own hostname in `Host`, so nginx or a Tailscale Funnel in
  // front of this port now gets a 400 where it used to get the board.
  //
  // That is the posture the warning above `start()` already describes: this
  // server has no authentication, so a tunnel pointed at it exposes every write
  // route to whoever finds the URL, and it now edits the file an agent boots
  // from. Refusing is the honest default for a thing that was only ever safe
  // because it was unreachable.
  //
  // `AGENT_WORKFORCE_ALLOWED_HOSTS` is the deliberate opt-in for someone who
  // genuinely wants that, comma-separated hostnames. It exists so the choice is
  // made on purpose rather than discovered, and so this change does not
  // silently break a deployment that already relies on it.
  //
  // Only the HOSTNAME is compared: a proxy legitimately names a different port.
  // A request with no `Host` at all is HTTP/1.0 or a raw socket, neither of
  // which is a browser being rebound.
  const sent = req.headers && req.headers.host;
  if (sent) {
    let asked;
    try {
      asked = new URL(`http://${sent}`).hostname;
    } catch {
      return null;
    }
    // A trailing dot is the same host, and a browser will send one.
    const bare = asked.replace(/\.$/, '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(bare) && !ALLOWED_HOSTS.has(bare)) return null;
  }

  return parsed.pathname;
}

/**
 * Percent-decode one path segment, or null if it is malformed.
 *
 * `decodeURIComponent` throws on a stray `%`, and a throw inside the request
 * handler is an uncaught exception that takes the process down. So a single
 * unauthenticated `GET /api/agent/%/avatar` was enough to kill the board.
 *
 * This existed before routing moved to the pathname, but that move made it
 * reachable from more requests: the anchored patterns previously stopped
 * matching as soon as a query string was appended, so `/api/agent/%/avatar?t=1`
 * fell harmlessly to the catch-all and only the bare form crashed. Widening
 * which requests reach a decode is exactly the kind of second-order effect a
 * routing change is prone to.
 */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Is this write coming from a page on some OTHER website?
 *
 * ⚠️ THE HOST CHECK DOES NOT COVER THIS, and the create route's own comment
 * said it did. Measured, against the real server: a page on any site can run
 *
 *     fetch('http://127.0.0.1:4317/api/agents',
 *           { method: 'POST', headers: { 'content-type': 'text/plain' },
 *             body: '{"name":"theirs","role":"pm"}' })
 *
 * and that is a CORS *simple request* — POST with a `text/plain` body needs no
 * preflight. `Host` is `127.0.0.1:4317`, which is exactly what a legitimate
 * request looks like, so the Host check passes. The attacker cannot READ the
 * answer, and does not need to: the side effect is the attack. A real worker
 * directory and a real launchd job were created on this machine by that
 * request while this was being written.
 *
 * It is worse than a drive-by write because of what the job is: `RunAtLoad`,
 * `KeepAlive`, and an agent started with `--dangerously-skip-permissions` that
 * comes back on every reboot, whose instruction file any subsequent write can
 * rewrite.
 *
 * ⚠️ Why the EXISTING writes were not reachable this way, which is the thing
 * the old comment got wrong: they are all `PUT` and `DELETE`, and those are
 * never simple requests, so a browser preflights them, this server answers the
 * `OPTIONS` with a 404 carrying no CORS headers, and the browser drops the real
 * request. `POST /api/agents` was the first route on this server a stranger's
 * page could actually reach. "No worse than what is here" was false, and it was
 * false in the direction that matters.
 *
 * Two checks, because either alone leaves a gap:
 *
 *   1. `Origin`, when present, must be loopback. A browser attaches it to every
 *      cross-origin request and to same-origin POSTs, so this is the direct
 *      signal — but a non-browser client sends none at all.
 *   2. The `content-type` must NOT be one a form can produce. Those three types
 *      are the whole simple-request set, and being outside it is what forces
 *      the preflight this server does not answer — so a page that manages to
 *      omit `Origin` still cannot get a write through.
 *
 * ⚠️ The rule is "not a simple type", NOT "must be JSON", and the difference is
 * a real one this nearly shipped wrong: the avatar upload PUTs an IMAGE, and
 * `store.saveAvatar` reads that content type to decide the format. A blanket
 * JSON requirement would have refused every picture in the product while
 * reading, in review, exactly like the stricter and therefore safer choice.
 *
 * A request with no content type at all is left alone rather than broken,
 * because refusing it would break every non-browser caller (curl, a script) and
 * a form cannot produce one.
 * ⚠️ This used to justify itself with "a `fetch` with a body always sets one",
 * which is FALSE: `fetch(url, {method:'POST', body: new Blob(['…'])})` with a
 * typeless Blob sends no content type at all and is still a simple request.
 * What actually covers that case is the Origin arm above — a browser attaches
 * `Origin` to every POST — so the guard holds, and the sentence that said why
 * did not. Correcting it matters because the next person to touch the Origin
 * arm needs to know it is load-bearing here.
 *
 * Applied to every state-changing method, not only the new route: the others
 * are protected by preflight today, and depending on the browser's method
 * classification rather than saying so ourselves is how this was missed once.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// The CORS simple-request set, in full. Anything outside it is preflighted.
const FORM_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

function crossSiteWrite(req) {
  if (!req || !WRITE_METHODS.has(req.method)) return null;

  const origin = req.headers && req.headers.origin;
  // `null` is what a sandboxed iframe or a `file://` page sends, and it is
  // never this board.
  if (origin && origin !== 'null') {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return 'that request came from somewhere this board does not answer';
    }
    const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(host) && !ALLOWED_HOSTS.has(host)) {
      return 'that request came from another website, so we will not act on it';
    }
    /**
     * ⚠️ AND THE PORT, for a loopback origin.
     *
     * Comparing the hostname alone made every other page on this machine
     * same-site: a dev server on `http://127.0.0.1:3000` rendering somebody
     * else's content, or an XSS in any other local app, could POST here and
     * install a launchd job. "A page on another website" is the threat this
     * guard names, and a page on another local port is one.
     *
     * The port is deliberately NOT compared for an `ALLOWED_HOSTS` name: that
     * list is the explicit opt-in for a reverse proxy, and a proxy legitimately
     * renumbers ports — the same reasoning the `Host` check gives. The
     * difference is that a loopback origin has an exact right answer, which is
     * this server's own.
     */
    // Compared against the `Host` the browser actually used, NOT against the
    // module's `PORT` constant: this server can be started on any port, and a
    // guard that tests a configured default refuses legitimate writes on every
    // other one. Origin and Host being the same host:port is precisely what
    // same-origin means, so this asks the real question.
    const sentHost = String((req.headers && req.headers.host) || '')
      .toLowerCase().replace(/\.(?=:|$)/, '');
    const originHost = `${host}${parsed.port ? `:${parsed.port}` : ''}`;
    // ALLOWED_HOSTS is the explicit reverse-proxy opt-in, and a proxy
    // legitimately renumbers ports — the same exception the `Host` check makes.
    // ⚠️ A missing `Host` alongside an `Origin` FAILS CLOSED. No browser omits
    // Host, so this is not a live bypass — but the alternative is the strongest
    // arm of this guard degrading silently, which is the posture everything
    // else in this file refuses.
    if (originHost !== sentHost && !ALLOWED_HOSTS.has(host)) {
      return 'that request came from another program on this computer, so we will not act on it';
    }
  } else if (origin === 'null') {
    return 'that request came from somewhere this board does not answer';
  }

  // ⚠️ A request whose Origin we have already recognised as our own does not
  // need the content-type arm: that arm exists to catch a page that sent no
  // Origin at all. Refusing a same-origin POST for its content type is a trap
  // for the next route somebody adds here.
  if (req.headers && req.headers.origin && req.headers.origin !== 'null') return null;

  // ⚠️ POST ONLY. A simple request is a METHOD and a content type together —
  // `PUT`, `DELETE` and `PATCH` are never simple whatever body they carry, so
  // they are already preflighted and refusing them on their content type buys
  // nothing. The first version applied this to every write and broke
  // `PUT /avatar` with a plain-text body, which an existing test caught: a
  // guard stricter than the threat is still a guard that breaks the product.
  if (req.method !== 'POST') return null;

  const type = String((req.headers && req.headers['content-type']) || '').split(';')[0].trim().toLowerCase();
  if (type && FORM_TYPES.has(type)) {
    return 'that request is shaped like one another website could send, so we will not act on it';
  }
  return null;
}

const server = http.createServer((req, res) => {
  const pathname = pathOf(req);
  if (pathname === null) {
    // Not addressed to us. Saying so is better than handing back the index,
    // which would look like a successful page load.
    sendJson(res, 400, { error: 'that request was not addressed to this server' });
    return;
  }

  // ⚠️ BEFORE every route, so a write added later is covered by default rather
  // than by whoever adds it remembering. The one that was missed was the one
  // written last.
  const refusal = crossSiteWrite(req);
  if (refusal) {
    sendJson(res, 403, { error: refusal });
    return;
  }

  if (pathname === '/api/status' && (req.method === 'GET' || req.method === 'HEAD')) {
    let body;
    try {
      const snap = snapshot();
      // Attach what each agent says it is holding. Read here rather than in the
      // status engine, which derives state from tmux and transcripts; this is a
      // separate record that the agent wrote about itself.
      //
      // Every agent gets a commitment block, including ones that have never
      // reported -- they come back `unknown`, and it is that value the restart
      // confirmation needs. Omitting the field for silent agents would leave
      // the caller unable to tell "nothing pending" from "never asked".
      // ⚠️ BOTH of these are keyed on the NAME, so both need the same gate the
      // snapshot applies to identity, model, context, avatar and profile.
      // Without it the leak `status.js` closes is reopened one layer up: an
      // untied stranger's card came back carrying the real agent's commitment
      // TEXT, its boot-file hash, and a `startedAt` read out of the real
      // agent's transcript — while the snapshot's own sentence promises "we
      // will not read another agent's transcript for it".
      //
      // It also reinstates the measured wrong-card-cost failure: the restart
      // dialog reads these, so the cost shown would be the real agent's while
      // the pane acted on is a stranger's.
      // ⚠️ REMOVED AGENTS COME OFF THE BOARD HERE, and this filter is the whole
      // user-visible half of a removal. Everything else the engine does is
      // invisible: the launchd job is disabled, the session ended. If a removed
      // agent still appeared in this list, the person who removed it would have
      // clear evidence the product ignored them, and no way to tell that
      // anything had happened at all.
      //
      // Filtering the SNAPSHOT rather than the pane source is deliberate: a
      // removed agent's session is gone, but a foreign agent whose session was
      // not ours to end can still be running, and it must vanish from the board
      // regardless. "Removed" is a fact this product keeps, not something it
      // infers from what tmux happens to show.
      // ⚠️ `sessionName`, NOT `name`. They are different fields and they differ
      // for exactly the agents this feature was rebuilt to support. `name` is
      // the DISPLAY name, parsed out of "You are **Angel**" in the agent's own
      // instructions or supplied by an override; `sessionName` is what tmux and
      // launchd know it as, and it is what a removal records. For an agent this
      // app created the two coincide, which is why filtering on the wrong one
      // passed every test — and why removing `claudebot`, whose card reads
      // "Splinter", would have left it on the board and in the removed list at
      // the same time. Every other name-keyed reader in this block already uses
      // `sessionName`; this was the one that did not.
      // ⚠️ Only the ones that actually STOPPED come off the board. A removal
      // that half-worked is recorded — so there is a Restore button — but its
      // agent may still be running, and hiding a running agent is the one thing
      // this board must never do.
      // ⚠️ The predicate is read off the records already in hand, not by calling
      // `isHidden` per agent -- that re-read and re-parsed `removed.json` once
      // per removed agent, on top of the read `removedAgents()` just did, on
      // every five-second poll. `stopped !== false` is `isHidden`'s own test;
      // if the two ever diverge this is the copy that is wrong.
      const gone = new Set(removal.removedAgents().filter((r) => r.stopped !== false).map((r) => r.name));
      const agents = snap.agents.filter((a) => !gone.has(a.sessionName)).map((a) => ({
        ...a,
        commitments: a.isNamedOurs
          ? commitments.read(a.sessionName)
          : { state: 'unknown', commitments: [], reportedAt: null, because: 'we cannot tie this pane to an agent by name, so we will not speak for what that name is holding' },
        // Staleness only, NOT the instruction text. The board polls this every
        // five seconds for every agent, and the real files run to several
        // kilobytes each -- carrying them here would put ~90KB on the wire per
        // poll to render a badge. The text is fetched once, by the detail page,
        // when someone actually opens it.
        // ⚠️ `editable: false` matters as much as hiding the hash. The board
        // renders an Edit affordance from this, so gating `knownAgent` without
        // gating this left the card ADVERTISING an edit the route then 404s —
        // offer-an-action-that-cannot-work, which is worse than refusing plainly.
        instructions: a.isNamedOurs
          // ⚠️ The pane's REAL session, so the staleness verdict resolves the
          // same transcript the model and the memory ring did. Without it this
          // reader falls back to preferring the `-discord` spelling, and a
          // lingering registry entry for a long-gone `<name>-discord` dates the
          // card from one conversation while its other numbers come from
          // another. The fix reached two of the three readers and stopped one
          // short.
          ? instructions.staleness(a.sessionName, undefined, a.session)
          : { state: 'unknown', editable: false, version: null, startedAt: null, because: 'we cannot tie this pane to an agent by name' },
      }));
      // ⚠️ THE COUNTS DESCRIBE THE CARDS THAT ARE LEFT. Computed over the
      // unfiltered snapshot they put "12 agents" above 11 cards, and can put
      // "1 needs you" on screen with no card anywhere to click. Recomputed with
      // the ENGINE's own counter rather than a copy of its predicates here, so
      // a count added there cannot quietly stop being recomputed here.
      const counts = countAgents(agents, snap.counts && snap.counts.unreadableLines);
      // ⚠️ A MACHINE-LEVEL FACT, DELIBERATELY NOT A PER-AGENT ONE. Whether this
      // computer can reach a Claude subscription is one fact about the machine,
      // not thirteen facts about thirteen agents, and putting it on every card
      // would bury the one thing the reader needs to see.
      //
      // Before this, `subscription.check()` was called in exactly one place --
      // first-run -- so Kosmos checked the connection during onboarding and then
      // never looked again. An agent stranded by a broken sign-in produces no
      // output, lands in `idle`, and reads identically to a healthy agent
      // waiting for work. The board rendered a dead fleet as a resting one.
      //
      // `checkCached` and not `check`: this runs every 5 seconds and the config
      // is ~95KB. See the cache's own comment for why its key is paranoid.
      const connection = subscription.checkCached();
      // Update awareness rides the status tick the screen already polls:
      // poke() returns immediately (six-hour cache, background refresh) and
      // available() is the cached verdict -- the request path never waits on
      // the release host, and a down host just means no toast.
      updates.poke();
      body = JSON.stringify({ ...snap, agents, counts, connection, version, update: updates.available() });
    } catch (err) {
      // Failing loudly beats serving a stale or empty board that looks healthy.
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err && err.message) }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  // --- avatar: read -------------------------------------------------------
  // ⚠️ The FOURTH name-keyed consumer. The comment introducing the third calls
  // itself "the THIRD", and the `knownAgent` comment that exists specifically to
  // correct an earlier claim of completeness enumerates the set — both were
  // incomplete again, in this same file. Three corrections, each missing one.
  //
  // Measured: with the only card under `angel` being an untied stranger,
  // `GET /api/agent/angel/avatar` served the real agent's stored image at 200.
  // The snapshot sets `hasAvatar: false` so today's board does not request it,
  // but "the real agent's photograph on a stranger's card" is closed at the
  // snapshot and open at the route, and a caller that guesses the URL gets it.
  const avatarGet = pathname.match(/^\/api\/agent\/([^/]+)\/avatar$/);
  if (avatarGet && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(avatarGet[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    // Same gate as the commitments read, for the same reason: refuse only when
    // a pane on the board is CLAIMING this name without being tied to it.
    if (borrowedName(name)) { sendJson(res, 404, { error: 'no picture for that agent' }); return; }
    let file = null;
    try { file = store.avatarPath(name); } catch { /* invalid name */ }
    if (!file) { sendJson(res, 404, { error: 'no picture for that agent' }); return; }
    const ext = path.extname(file);
    const type = Object.keys(store.ALLOWED_IMAGES).find((k) => store.ALLOWED_IMAGES[k] === ext) || 'application/octet-stream';
    // Three things have to hold here, and each failed a different way before.
    //
    // 1. The status is withheld until we know the read will work. Writing 200
    //    first and catching the error after commits the header, so a file that
    //    is not there answers 200 with an empty body -- a picture reported as
    //    fine, rendering as a broken image, which is the symptom this branch
    //    exists to remove.
    // 2. `open` succeeding is not enough: a directory opens fine and fails on
    //    first read, past the header. So the entry is stat'd and must be a
    //    regular file. `store.avatarPath` prefix-scans the directory and will
    //    return any matching entry, including a directory.
    // 3. `pipeline` rather than `pipe`, because `pipe` neither forwards the
    //    source's errors (an unhandled 'error' event exits the process) nor
    //    destroys the source when the client goes away (60 aborted requests
    //    leaked 49 file descriptors, which walks to EMFILE on a server anyone
    //    can reach).
    fs.stat(file, (statErr, stat) => {
      if (statErr || !stat.isFile() || stat.size === 0) {
        // Size matters as much as existence here. store.saveAvatar writes
        // non-atomically, so an interrupted save leaves a zero-byte file that
        // is a perfectly good file and a perfectly useless picture.
        sendJson(res, 404, { error: 'no picture for that agent' });
        return;
      }
      const stream = fs.createReadStream(file);
      stream.once('readable', () => {
        // The client may already be gone. Deferring the header to 'readable'
        // is what stops an empty 200, but it opens a window in which `res` can
        // be destroyed before we get here -- and `pipeline` THROWS
        // synchronously on a destroyed destination, which from inside this
        // handler is an uncaught exception that exits the process.
        //
        // This is ordinary use, not an attack: a browser cancels in-flight
        // <img> loads routinely, and the detail page re-sets img.src with a
        // fresh ?t= on every render. Cancelled avatar requests killed the
        // board.
        if (res.destroyed || res.writableEnded) { stream.destroy(); return; }
        // Deliberately no content-length. It would have to come from the stat,
        // while the bytes come from a separate read of the same file, and
        // store.saveAvatar writes non-atomically -- so a stat that under-reports
        // yields a clean 200 truncated to the declared length, with the surplus
        // bytes landing on the wire afterwards and desyncing a keep-alive
        // connection. Chunked costs a few bytes and cannot do that.
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        // Belt and braces: the check above closes the window we know about, and
        // a throw here would still be fatal, so it is caught rather than
        // trusted not to happen.
        try {
          pipeline(stream, res, () => {
          // A failure after the header is committed cannot be reported as a
          // status. Destroying the response cuts the connection mid-chunk, so
          // the client sees a broken transfer rather than a clean short body it
          // would treat as the whole picture.
            if (!res.writableEnded) res.destroy();
          });
        } catch {
          stream.destroy();
          if (!res.writableEnded) res.destroy();
        }
      });
      stream.once('error', () => {
        if (!res.headersSent) sendJson(res, 404, { error: 'that picture could not be read' });
        else res.destroy();
      });
    });
    return;
  }

  // --- avatar: set or clear ----------------------------------------------
  if (avatarGet && (req.method === 'PUT' || req.method === 'DELETE')) {
    const name = decodeSegment(avatarGet[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // Only agents that actually exist. The name is already sanitised against
    // path traversal, but without this you can still accumulate pictures for
    // agents nobody has — junk rather than a hole, and cheap to refuse.
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    if (req.method === 'DELETE') {
      try { sendJson(res, 200, { removed: store.removeAvatar(name) }); }
      catch (err) { sendJson(res, 400, { error: String(err.message) }); }
      return;
    }
    readBody(req)
      .then((buf) => {
        store.saveAvatar(name, req.headers['content-type'], buf);
        sendJson(res, 200, { ok: true });
      })
      // The message is shown to the person verbatim, so it has to say what to
      // do rather than name an exception.
      .catch((err) => sendJson(res, 400, { error: String(err.message) }));
    return;
  }

  // --- the roles a new agent can be ----------------------------------------
  //
  // Read-only and unkeyed: it is a menu, not an agent. It carries the blurb and
  // the suggested first action so the screen cannot invent either — the copy a
  // person reads while choosing has to be the copy the agent is actually
  // created from.
  if (pathname === '/api/roles' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, {
      // The models an agent can be created on, from the engine's own list,
      // so the menu and the flag the job runs with cannot drift.
      models: create.MODELS.map((m) => ({ key: m.key, label: m.label, default: m.default === true })),
      // The third radio's prefill, served whole so the screen and the
      // engine cannot hold two versions of the example. No label field:
      // that is the person's own words, gated at create.
      own: (() => {
        const o = roles.byKey('own');
        return o ? { key: o.key, blurb: o.blurb, firstAction: o.firstAction, instructions: o.instructions } : null;
      })(),
      // ⚠️ MENU roles only: `own` (menu: false) prefills the third radio's
      // editor and must not appear in the grouped list or raise any count.
      roles: roles.ROLES.filter((r) => r.menu !== false).map((r) => ({
        key: r.key, label: r.label, blurb: r.blurb, firstAction: r.firstAction,
        // The template itself, {{NAME}} and all: the details screen prefills
        // its editor from this so the words a person reads before creating
        // are the words the agent boots from. An untouched editor sends
        // nothing back and the engine writes this same template server-side;
        // only edited text travels.
        instructions: r.instructions,
        // The catalogue's section, so the picker's menu can group without a
        // second copy of the grouping living in the page.
        group: r.group || null,
        // ⚠️ The limit travels WITH the role. A caution that lives only in the
        // agent's instruction file is read after the person has chosen, which
        // is exactly too late for the two roles that have one.
        caution: r.caution || null,
      })),
    });
    return;
  }

  // --- create an agent -----------------------------------------------------
  //
  // ⚠️ The most powerful route here, and the reasoning for shipping it on a
  // server with no login is worth stating rather than assuming.
  //
  // ⚠️ THIS COMMENT USED TO SAY "it does NOT cross a new line", on the argument
  // that the server already lets a local process rewrite an agent's boot file.
  // That was FALSE, and measurably so: every other write is PUT or DELETE, which
  // a browser always preflights, so this was the first route on this server a
  // page on another website could actually reach. Running that request created a
  // worker directory and installed a launchd job on this machine. See
  // `crossSiteWrite`, which exists because of it.
  //
  // What it adds beyond the writes that were already here is PERSISTENCE: a
  // launchd job outlives the session that made it, and starts Claude with
  // `--dangerously-skip-permissions` at every login. So the containment is in
  // `engine/create`: the name is validated hard and early, no caller-supplied
  // path is honoured, every command is `execFile` with an argument array, and
  // any failure rolls the whole thing back rather than leaving half of it.
  //
  // ⚠️ Three things hold this up, not two: the loopback bind, the Host check,
  // and the cross-site guard. It should be behind a login the moment one
  // exists. The honest summary is that it is the largest thing here and it is
  // contained, not that it is safe.
  if (pathname === '/api/agents' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          // No error code: the catch below answers in our own words whatever
          // this is, and a code nothing reads is a hint that something does.
          throw new Error('we could not read that request');
        }

        /**
         * ⚠️ The projects the new agent should join are validated HERE,
         * BEFORE the engine writes anything: a refusal after the folder
         * exists would need the rollback nobody should pay for a typo. The
         * ATTACH happens after CREATED and is non-gating, exactly like the
         * project-create route's own telling: a recorded agent whose
         * membership write failed is a real, reportable state, never a
         * reason to un-make the agent.
         */
        let wantProjects;
        if (body.projects !== undefined) {
          if (!Array.isArray(body.projects)
              || body.projects.some((p) => typeof p !== 'string' || !p.trim())) {
            sendJson(res, 400, { error: 'projects has to be a list of project ids' });
            return;
          }
          wantProjects = [...new Set(body.projects.map((p) => p.trim()))];
          // ⚠️ Wrapped separately: an UNREADABLE projects store is OUR fact
          // (500, the engine's own sentence), not a malformed request, and
          // the route's shared catch would have answered "we could not read
          // that request" about a file the person never touched.
          let known;
          try {
            known = projects.readAll();
          } catch (err) {
            const code = (err && err.code === 'UNREADABLE') ? 500 : 400;
            sendJson(res, code, { error: String((err && err.message) || 'we could not read your projects') });
            return;
          }
          const missing = wantProjects.filter((id) => !known.some((p) => p.id === id));
          if (missing.length) {
            sendJson(res, 400, { error: `there is no project by that name (${missing.join(', ')})` });
            return;
          }
        }

        const result = create.createAgent({
          name: body.name, role: body.role,
          label: body.label, instructions: body.instructions, model: body.model,
        });
        // REFUSED is the caller's fault (a bad name, a duplicate); PARTIAL is
        // ours, and it is a 200 because the thing half-happened and the caller
        // needs the detail rather than an error.
        const code = result.outcome === create.OUTCOME.REFUSED ? 400 : 200;
        if (result.outcome === create.OUTCOME.CREATED && wantProjects && wantProjects.length) {
          // One roster read for the whole request, same rule as the project
          // routes: syncAgent refuses to write without an exact match in it.
          const roster = safeRoster();
          // ⚠️ `result.name`, the slug the engine PUBLISHES for exactly this
          // reason (its comment: act on the machine name). The first version
          // read `result.sessionName`, a field the CREATED result has never
          // carried, so every attach refused with "choose an agent" while the
          // suite stayed green -- nothing exercised this route with projects.
          // The route test now creates through here and asserts added: true.
          result.projects = wantProjects.map((id) => {
            try {
              projects.addAgent(id, result.name, roster);
              return { id, added: true };
            } catch (err) {
              return { id, added: false, because: String((err && err.message) || 'we could not put it on that project') };
            }
          });
          // ⚠️ NO syncAgent here, on purpose. This code runs milliseconds
          // after `launchctl bootstrap` returns, which is the one moment a
          // tell is near-guaranteed to fail: the tmux session and its
          // @kosmos_agent claim do not exist yet (create.js's own comment:
          // they happen inside the job, after this function has returned).
          // Syncing now STORED could_not against every create-with-project.
          // So membership is recorded, told is honestly `not_tried`, and the
          // creation screen re-fires the tell through the member route the
          // moment the board can actually see the agent running.
          for (const p of result.projects) {
            if (p.added) p.told = { state: projects.TOLD.NOT_TRIED, because: null };
          }
        }
        sendJson(res, code, result);
      })
      // ⚠️ OUR sentence, never the raw message. The first version called
      // `errorAnswer`, which does not exist on this branch — it is from another
      // one — so the catch path would have thrown at runtime, and the suite went
      // green because nothing exercised it. A route's error path needs a test as
      // much as its happy path does.
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  /**
   * --- removing an agent ---------------------------------------------------
   *
   * ⚠️ REMOVE IS NOT DELETE, and every route here is shaped by that. Removing
   * takes an agent off this board and stops it coming back; it does not touch
   * one byte of what is on disk. That is what makes RESTORE possible, and
   * restore is the reason the removal is safe to offer at all.
   *
   * ⚠️ `GET` returns the QUESTION the confirmation asks — not a list of steps.
   * Josh's wording, deliberately: a person removing an agent does not want to
   * read that a launchd job will be disabled. They want to be asked once, by
   * name, and told nothing of theirs is being destroyed. The screen must not
   * compose that sentence itself, because a screen that writes its own
   * description of the work can drift from the work.
   *
   * ⚠️ It removes agents this product did NOT create, on purpose. An earlier
   * design refused them, reasoning that whatever set an agent up is what should
   * take it away. Josh reversed it: managing the fleet you actually have is the
   * point of the product, and an agent it cannot manage is a hole, not a
   * safeguard. What survives from that caution is that nothing of theirs is
   * deleted — a foreign job is DISABLED and its exact label recorded, so
   * restore puts back precisely what was taken away.
   */
  const rm = pathname.match(/^\/api\/agent\/([^/]+)\/removal$/);
  if (rm && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(rm[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
  /**
   * ⚠️ GUARDED, like every other engine call in this file.
   *
   * These four are the only routes that STOP things, and they were the four
   * handed straight to the socket. `plan` reads the filesystem (the removed
   * list, the plists, the agent's instruction file for its display name),
   * `remove` and `restore` shell out to launchctl and tmux, and any of that can
   * throw. An uncaught throw here does not fail the request, it exits the
   * process -- so the board goes down at the exact moment somebody is halfway
   * through removing an agent, with no way to see what happened. The convention
   * is stated a hundred lines below at `/api/agent/:name/commitments`, and
   * these routes were written without it.
   */
    let plan;
    try { plan = removal.plan(name); }
    catch (err) { sendJson(res, 500, { error: 'we could not work out whether this agent can be removed', detail: String(err && err.message || err) }); return; }
    sendJson(res, plan.ok ? 200 : 400, plan);
    return;
  }
  if (rm && req.method === 'DELETE') {
    const name = decodeSegment(rm[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let done;
    // ⚠️ Guarded for the reason given on the route above, and it matters most
    // here: this is the call that has already disabled a launchd job by the
    // time anything downstream can throw.
    try { done = removal.remove(name); }
    catch (err) { sendJson(res, 500, { error: 'the removal failed partway and we cannot tell you how far it got', detail: String(err && err.message || err) }); return; }
    // ⚠️ A PARTIAL answers 200, deliberately: the request was understood and
    // acted on, and what happened is in the body, which is where a removal's
    // outcome has to be read anyway (a removal that half-worked is not an
    // error, it is a state). The screen branches on `outcome` rather than on
    // status for exactly that reason.
    sendJson(res, done.outcome === removal.OUTCOME.REFUSED ? 400 : 200, done);
    return;
  }

  // --- putting one back ------------------------------------------------------
  //
  // ⚠️ This route is the whole reason the removal is allowed to be casual. If
  // restore did not genuinely work, "remove" would be a destructive act wearing
  // a light confirmation, which is the exact defect this codebase keeps
  // cataloguing. It re-enables the SPECIFIC label that was disabled — read back
  // from the record, never re-derived — so a foreign agent goes back onto the
  // job that actually starts it.
  const rs = pathname.match(/^\/api\/agent\/([^/]+)\/restore$/);
  if (rs && req.method === 'POST') {
    const name = decodeSegment(rs[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let back;
    try { back = removal.restore(name); }
    catch (err) { sendJson(res, 500, { error: 'we could not put this agent back', detail: String(err && err.message || err) }); return; }
    sendJson(res, back.outcome === removal.OUTCOME.REFUSED ? 400 : 200, back);
    return;
  }

  /**
   * What first run should show, and whether it should show at all.
   *
   * ⚠️ One GET, answered by the engine, so the screen cannot disagree with the
   * code about which path somebody is on or whether they are connected. The
   * instruction editor shipped a version of that bug and it took two review
   * passes to find.
   */
  if (pathname === '/api/first-run' && (req.method === 'GET' || req.method === 'HEAD')) {
    let state;
    try { state = firstrun.state(); }
    catch (err) {
      sendJson(res, 500, { error: 'we could not work out whether this machine has been set up yet', detail: String(err && err.message || err) });
      return;
    }
    sendJson(res, 200, state);
    return;
  }

  /**
   * What this computer will and will not do — the "Checking your computer" step.
   *
   * ⚠️ ITS OWN ROUTE, not folded into /api/first-run, for two reasons. It shells
   * out twice, so folding it in would make the decision about which screen to
   * open wait on two subprocesses; and the screen offers to run it again, which
   * needs something to call.
   *
   * ⚠️ AND IT NEVER 500s. Every check already answers `unknown` when it cannot
   * look, so an error here would mean the check-runner itself broke -- and a
   * screen with no answers at all is worse than three that say "we could not
   * tell". The catch turns that into exactly that.
   */
  if (pathname === '/api/machine' && (req.method === 'GET' || req.method === 'HEAD')) {
    let checks;
    try { checks = machine.check(); }
    catch (err) {
      sendJson(res, 200, {
        checks: [{
          key: 'all', state: 'unknown',
          title: 'We could not check this computer',
          detail: 'That does not mean anything is wrong with it, only that we could not look. ('
            + String((err && err.message) || err) + ')',
        }],
        attention: 0,
        unknown: 1,
        // The degraded answer keeps the healthy answer's shape: step 5 reads
        // this field, and the honest state when the check-runner itself broke
        // is could-not-look here too -- the ENGINE'S OWN row, not a copied
        // literal that goes stale the moment the wording moves.
        appLocation: machine.appLocationUnknown(),
      });
      return;
    }
    sendJson(res, 200, checks);
    return;
  }

  /**
   * Open the Mac's sleep settings screen. POST, so it inherits the
   * cross-site guard: it launches an app on the person's machine. The pane
   * URL is derived server-side from what is on disk, never taken from the
   * request, so this cannot become an open-arbitrary-URL primitive; and when
   * the pane was not found the button was never rendered, so the 409 here is
   * a race (an update changed the world) rather than a normal path.
   */
  if (pathname === '/api/open-sleep-settings' && req.method === 'POST') {
    const opened = machine.openSleepSettings();
    if (opened.ok) { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 409, { error: opened.because });
    return;
  }

  // Marking it done. ⚠️ POST, because it writes -- so it inherits the
  // cross-site guard above rather than being reachable from any page.
  if (pathname === '/api/first-run/complete' && req.method === 'POST') {
    let ok;
    try { ok = firstrun.complete(); }
    catch (err) {
      sendJson(res, 500, { error: 'we could not remember that you have set this up', detail: String(err && err.message || err) });
      return;
    }
    /**
     * ⚠️ Reports whether it STUCK, read back, rather than whether the write
     * threw. A flag that did not persist means onboarding reappears on the next
     * launch, and the screen would rather say so now than surprise them then.
     */
    sendJson(res, ok ? 200 : 500, ok
      ? { done: true }
      : { error: 'we could not remember that, so this may appear again next time' });
    return;
  }

  // --- connect: the click that installs Claude and signs it in -------------

  /**
   * Where the connect flow is right now. Polled by first run while a connect
   * is in flight.
   *
   * ⚠️ NEVER 500s for a state question, same contract as /api/machine: every
   * phase, including stuck, is an ANSWER. An error here would blank the one
   * screen whose job is telling somebody what is happening.
   */
  if (pathname === '/api/connect' && (req.method === 'GET' || req.method === 'HEAD')) {
    let st;
    try { st = connect.state(); }
    catch (err) {
      /**
       * ⚠️ NOT `stuck`: the page paints stuck as "we could not finish
       * connecting Claude", a settled sentence about an attempt that may
       * never have happened. "We cannot tell where the flow is" is a third
       * answer; the page has no panel for `unsure` on purpose, so the static
       * verdict stands. (Defensive only -- state() never throws today.)
       */
      st = {
        phase: 'unsure',
        because: 'we could not work out where the connection attempt is',
        tail: String((err && err.message) || err),
      };
    }
    sendJson(res, 200, st);
    return;
  }

  /**
   * Install the published update. POST, so it inherits the cross-site guard:
   * this one downloads and runs software, the same class as /api/connect/start.
   *
   * Two refusals, two different facts, both 409 (a state conflict, not a
   * malformed request):
   *  - nothing newer is published: a stray POST must not reinstall the same
   *    version and restart the board for nothing;
   *  - a from-source run: the installer must never be pointed at a working
   *    tree; source updates with git.
   * Past those, the answer is 200 BEFORE anything happens, because what
   * happens next kills this server on purpose: the detached installer stages,
   * verifies, swaps, and restarts the board. Agents keep working throughout;
   * their launchd jobs and tmux sessions are separate process trees this
   * update never touches.
   */
  if (pathname === '/api/update' && req.method === 'POST') {
    const avail = updates.available();
    if (!avail) { sendJson(res, 409, { error: 'there is no update to install right now' }); return; }
    if (!updates.installedRoot()) {
      sendJson(res, 409, { error: 'this Kosmos runs from its source code, so it updates from git, not from here' });
      return;
    }
    if (updates.alreadyInstalling()) {
      // Idempotent: the first POST started it; a retry, a double click, or a
      // second tab gets the same true answer without a second installer
      // racing the first through the stage-and-swap.
      sendJson(res, 200, { ok: true, updating: avail.version, already: true });
      return;
    }
    try { updates.beginInstall(); }
    catch (err) {
      sendJson(res, 500, { error: 'we could not start the update', detail: String((err && err.message) || err) });
      return;
    }
    sendJson(res, 200, { ok: true, updating: avail.version });
    return;
  }

  // Begin (or, after an interruption, begin again -- `start` re-checks
  // reality and skips whatever is already true). POST, so it inherits the
  // cross-site guard: this one downloads and runs software.
  if (pathname === '/api/connect/start' && req.method === 'POST') {
    connect.start()
      .then((st) => sendJson(res, 200, st))
      .catch((err) => sendJson(res, 500, {
        error: 'we could not start connecting',
        detail: String((err && err.message) || err),
      }));
    return;
  }

  /**
   * The pasted sign-in code. Refused with the reason whenever the terminal is
   * not actually asking for one -- typing into a screen that is not asking is
   * how a driver corrupts a flow.
   */
  if (pathname === '/api/connect/code' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let code;
        try { code = JSON.parse(buf.toString('utf8') || '{}').code; }
        catch { sendJson(res, 400, { error: 'we could not read that' }); return; }
        const put = connect.submitCode(typeof code === 'string' ? code.trim() : code);
        // A malformed code is the caller's input being wrong (400); asking at
        // the wrong moment is a state conflict (409). Different fixes.
        const status = put.ok ? 200 : (put.kind === 'format' ? 400 : 409);
        sendJson(res, status, put.ok ? { ok: true } : { error: put.because });
      })
      .catch((err) => sendJson(res, 400, { error: String((err && err.message) || err) }));
    return;
  }

  // Stop, clean up what we made, own nothing half-claimed.
  if (pathname === '/api/connect/cancel' && req.method === 'POST') {
    connect.cancel()
      .then((st) => sendJson(res, 200, st))
      .catch((err) => sendJson(res, 500, {
        error: 'we could not stop it cleanly',
        detail: String((err && err.message) || err),
      }));
    return;
  }

  // The removed ones, for the list at the bottom of the agents tab. Removing
  // something must never mean losing track of it.
  if (pathname === '/api/removed' && (req.method === 'GET' || req.method === 'HEAD')) {
    let agents;
    // ⚠️ A throw here is the worst of the four: this list IS the undo path, and
    // taking the process down while somebody looks for it is how a reversible
    // removal stops being reversible.
    try { agents = removal.removedAgents(); }
    catch (err) { sendJson(res, 500, { error: 'we could not read the removed list', detail: String(err && err.message || err) }); return; }
    /**
     * ⚠️ Only the fields the screen uses. The stored record also carries the
     * absolute plist path, the launchd label and whether the job is ours --
     * none of which the browser reads, and all of which are machine detail this
     * product's whole vocabulary rule says a person is never shown.
     */
    sendJson(res, 200, {
      agents: agents.map((a) => ({
        name: a.name,
        shownAs: a.shownAs || a.name,
        removedAt: a.removedAt,
        stopped: a.stopped,
      })),
    });
    return;
  }

  // --- profile: things the machine cannot derive (role, etc.) --------------
  const prof = pathname.match(/^\/api\/agent\/([^/]+)\/profile$/);
  if (prof && req.method === 'PUT') {
    const name = decodeSegment(prof[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    readBody(req)
      .then((buf) => {
        const patch = JSON.parse(buf.toString('utf8') || '{}');
        const clean = {};
        // Only fields we know. An unrecognised key is dropped rather than
        // stored, so the profile cannot become a junk drawer.
        if (typeof patch.role === 'string') clean.role = patch.role.slice(0, 80);
        // ⚠️ displayName is writable HERE because the record now WINS over
        // the instruction file (round 32): creation writes it, readIdentity
        // prefers it, and with no route accepting it a Kosmos-created agent
        // had a permanently unchangeable name -- editing the file's
        // identity line, which used to rename the board, silently did
        // nothing with no sentence saying why. One-line trim: an
        // empty-after-trim name is dropped rather than stored, so a person
        // cannot blank an agent into anonymity by accident; the file line
        // remains the fallback for agents with no record.
        if (typeof patch.displayName === 'string' && patch.displayName.trim()) {
          clean.displayName = patch.displayName.trim().slice(0, 80);
        }
        sendJson(res, 200, store.writeProfile(name, clean));
      })
      .catch((err) => sendJson(res, 400, { error: String(err.message) }));
    return;
  }

  // --- commitments: what an agent says it is holding -----------------------
  //
  // Matches on `pathname`, not `req.url`, and decodes with `decodeSegment`.
  // This branch was written before the routing fix landed, so its original
  // form used both of the things that fix removed -- a raw `req.url` match
  // (broken by any query string) and a bare `decodeURIComponent` (a stray `%`
  // exits the process). Rebasing it unchanged would have reintroduced both on
  // a brand-new endpoint.
  //
  // Ordered BEFORE the /api/ fallthrough below, or that guard would answer
  // this route with a 404 before it was ever reached.
  const commits = pathname.match(/^\/api\/agent\/([^/]+)\/commitments$/);
  if (commits && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(commits[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    // Guarded on its own merit. Every other engine call in this file is inside
    // a try or a promise catch; this one was handed straight to the socket, so
    // any future throw from the store would exit the process rather than answer
    // an error. read() is documented never to throw, and it did once.
    // ⚠️ The THIRD name-keyed consumer, and the comment at `knownAgent` that
    // exists specifically to correct an earlier claim of completeness listed
    // two and missed this one — in the same file. Twice now a correction has
    // itself been incomplete.
    //
    // The board does not call this route today. The restart dialog will, and it
    // is the caller that would fetch the real agent's commitment text by name
    // to display as the cost of clearing a stranger's pane, which is the exact
    // measured failure this branch closes elsewhere. Gating it now costs
    // nothing and closes it before the consumer arrives.
    // ⚠️ NOT `knownAgent`, which was the first attempt and was too strict: it
    // requires the agent to be on the board right now, and a record's whole
    // purpose is to outlive the conversation — an agent that is stopped
    // entirely must still be readable. Two tests caught that immediately.
    //
    // The danger is narrower than "is it running". It exists only when a pane
    // IS on the board under this name and that pane is NOT tied to it: then the
    // caller asking for `angel` gets the real Angel's commitment text while the
    // card in front of them is a stranger's. If no pane claims the name at all,
    // there is nobody to be confused with.
    if (borrowedName(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    try {
      sendJson(res, 200, commitments.read(name));
    } catch {
      sendJson(res, 500, { error: 'that agent record could not be read' });
    }
    return;
  }

  if (commits && req.method === 'PUT') {
    const name = decodeSegment(commits[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    readBody(req)
      .then((buf) => {
        const patch = JSON.parse(buf.toString('utf8') || '{}') || {};
        // A bare list is the whole payload: this is an assertion of everything
        // the agent holds, not an addition to it. An append would make "I hold
        // nothing" unsayable, which is the one thing this record exists for.
        if (!Array.isArray(patch.commitments)) {
          throw new Error('send a commitments list, even if it is empty');
        }
        commitments.report(name, patch.commitments);
        // Answer with the READ shape, not the raw record. The raw record has no
        // state and no `because`, so a client that asserted "I hold nothing"
        // got back a bare empty list -- exactly the shape this module exists to
        // keep out of callers' hands. Both verbs now speak the same
        // three-state vocabulary.
        sendJson(res, 200, commitments.read(name));
      })
      .catch((err) => sendJson(res, 400, { error: String(err.message) }));
    return;
  }

  // --- the person the agents work for --------------------------------------
  //
  // Answered once on the About-you step (no skip, at Josh's call); PUT also
  // re-teaches every tied agent, because "answer once and every agent you
  // make will know it" is the step's own sentence and a record nobody was
  // told about does not make it true. The read shape is three-state
  // (saved / absent / unknown-with-reason): absent is the wizard's normal
  // starting state, not an error, so it is a 200 like its commitments
  // sibling, never a 404 the screen has to special-case.
  if (pathname === '/api/you' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, you.read()); }
    catch { sendJson(res, 500, { error: 'that record could not be read' }); }
    return;
  }
  if (pathname === '/api/you' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        // Parsed HERE, refused in OUR sentence: letting JSON.parse's own
        // message ride the shared catch answers "Unexpected token" where the
        // sibling routes say what to do.
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = you.save({ name: body.name, does: body.does, know: body.know });
        // Non-gating, same as every tell: answers that could not be announced
        // are still saved, and each agent's verdict is carried, never invented.
        let told;
        try { told = you.syncEveryone(safeRoster()); }
        catch (err2) { told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: String((err2 && err2.message) || 'we could not tell the agents') }]; }
        sendJson(res, 200, { you: saved, told });
      })
      .catch((err) => {
        // A refusal speaks the field's own sentence at 400; a disk failure
        // (ENOSPC, EACCES on the rename) is OURS and answers 500, because a
        // raw errno presented as something the person can fix aims the
        // complaint at the wrong party.
        if (err && err.code) { sendJson(res, 500, { error: 'we could not save that record' }); return; }
        sendJson(res, 400, { error: String((err && err.message) || 'we could not save that') });
      });
    return;
  }

  // --- instructions: the file an agent reads to know what it is for --------
  //
  // ⚠️ The most powerful write in the product. It changes how a live agent
  // behaves the next time it starts, which is why engine/instructions.js guards
  // it harder than anything else here.
  const instr = pathname.match(/^\/api\/agent\/([^/]+)\/instructions$/);
  if (instr && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(instr[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    // Guarded the same way PUT is. Without this, GET answers 200 for any name
    // at all and hands back the absolute path it would have used, which turns
    // the route into a "does ~/work/workers/<x> exist" oracle for names that
    // are not agents. There is no reason for the read and the write to disagree
    // about which names exist.
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    try {
      sendJson(res, 200, instructions.read(name, sessionOf(name)));
    } catch {
      sendJson(res, 500, { error: 'those instructions could not be read' });
    }
    return;
  }

  if (instr && req.method === 'PUT') {
    const name = decodeSegment(instr[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    readBody(req)
      .then((buf) => {
        let patch;
        try {
          patch = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          // A raw SyntaxError here reads "Unexpected token } in JSON at
          // position 4", which is an exception name and an offset rather than
          // anything a person can act on. Every other refusal on this route
          // says what to send instead, and unparseable input was the one hole.
          throw new Error('send the instructions as JSON, like {"text": "..."}');
        }
        if (typeof patch.text !== 'string') {
          throw new Error('send the instructions as text');
        }
        // `version` is the sha256 the editor was last shown. Passing it through lets
        // the engine refuse a save that would overwrite an edit made since,
        // rather than silently picking the version in the textarea.
        /* ⚠️ The rename-follow keys on the LINE CHANGING, not on the line
           disagreeing with the record (round 37). "Parses to a name that
           differs from the record" is also true when the person renamed
           through the PROFILE route and then saved an unrelated paragraph
           edit: the untouched identity line still reads the old name, and
           following it silently reverted the profile rename. So the
           pre-save file's identity line is read first, and the record
           follows only a save in which that line itself moved -- the one
           observable act that distinguishes "they edited the name" from
           "they edited something else". Read-before-write is not atomic
           with the write, but the same person racing their own two saves
           lands on whichever save carried the line change, which is the
           behaviour either order promises. */
        const wrote = instructions.write(name, patch.text, patch.version, sessionOf(name));
        /* The pre-save line comes from the WRITE's own read (round 39), not
           a second read here: the round-37 version read the file twice, and
           in the window between them a transient read failure came back as
           exists:false -- which this parse would take for "no identity
           line", making an unrelated paragraph save satisfy "the line
           changed" and revert a profile-route rename through the
           could-not-look path. write.hadIdentityText is null ONLY for a
           positively absent file (unreadable pre-files make write throw),
           so the create path still follows and the unknown state cannot. */
        const lineHad = (() => {
          const m = wrote.hadIdentityText && wrote.hadIdentityText.match(/You are \*\*([^*]+)\*\*/);
          return m ? m[1].trim().slice(0, 80) : null;
        })();
        /* ⚠️ A DELIBERATE rename through the identity line updates the
           RECORD (round 33): the record wins over the file so an
           accidental mangle cannot un-name an agent, but that made the
           in-product edit of `You are **X**` -- the only rename path a
           person had -- a silent no-op that still reported "Saved." The
           split that honours both: a saved line that PARSES to a
           different name is a deliberate act and the record follows it;
           a line that no longer parses updates nothing, so the name
           survives exactly the accident the record exists for. */
        // (No wrote.ok guard: instructions.write THROWS on every failure
        // path, so reaching here means the save landed -- round 34
        // removed a decorative precondition that could never be false.)
        {
          const m = String(patch.text).slice(0, 4000).match(/You are \*\*([^*]+)\*\*/);
          // Same 80-char cap the profile route applies (round 34): the
          // identity line can carry ~3,900 characters into the capture,
          // and uncapped it became the agent's name on every card.
          const typed = m && m[1].trim().slice(0, 80);
          if (typed && typed !== lineHad) {
            /* ⚠️ Guarded, because the SAVE ALREADY LANDED (round 40): a
               throw out of the profile store here fell to the route's
               .catch, which answered 400 with the raw message -- so a
               committed instructions save was reported as a failed one,
               with an errno and an internal temp path printed into the
               editor's message line. Two rules broken at once (recording
               failure reported as act failure; errnos on screen). Same
               posture as create.js's own display-name write: a rename we
               could not record is a card that keeps its old name, not a
               failure. */
            try {
              const had = store.readProfile(name);
              if (had && typeof had.displayName === 'string' && had.displayName !== typed) {
                store.writeProfile(name, { displayName: typed });
              }
            } catch { /* the save succeeded; the follow is best-effort */ }
          }
        }
        sendJson(res, 200, wrote);
      })
      // The message reaches the person verbatim, so it says what to do rather
      // than naming an exception.
      .catch((err) => {
        // A conflict is not a malformed request. 409 is what a non-browser
        // client keys on to offer a reload rather than a retry.
        //
        // Keyed on `err.code`, not on the wording: this used to regex-match the
        // engine's English, so rewording one sentence silently downgraded the
        // status to 400.
        sendJson(res, err.code === 'CONFLICT' ? 409 : 400, { error: String(err.message) });
      });
    return;
  }

  /**
   * --- projects ------------------------------------------------------------
   *
   * A project is a folder the person already has, plus the agents they have put
   * on it. Both halves are read against reality on every request rather than
   * reported from the record: the folder is stat'd, and the members are joined
   * to the live roster so one we cannot see comes back as unknown instead of
   * being quietly dropped from its own project.
   *
   * ⚠️ NOTHING HERE IS A PERMISSION. Membership is an organising fact and never
   * a boundary (§4, 2026-08-11). No response carries an access level, because
   * there are none, and a level that is not enforced is worse than none.
   *
   * ⚠️ `snapshot()` THROWS when tmux cannot be asked, and that is deliberate
   * upstream — the realistic failure used to arrive as an empty roster, which
   * here would mean answering "none of your agents are there" when the truth is
   * "we could not look". So `safeRoster` catches it and these routes report a
   * failure to SEE, distinct from a failure to READ THE RECORD.
   *
   * (This named `paneRoster` until iteration 8. These routes describe members
   * against `snapshot().agents` and have not called `paneRoster` since the
   * display-name defect was fixed — the sentence outlived the code it was
   * written about, which is this file's own recurring failure.)
   */
  if (pathname === '/api/projects' && (req.method === 'GET' || req.method === 'HEAD')) {
    // ⚠️ An unreadable projects FILE is answered as an error, never as an empty
    // list. Serving `{projects: []}` there put "No projects yet. Point Kosmos at
    // a folder you already have" on screen for somebody who has projects we
    // simply could not read -- the exact "asserting a state nobody checked"
    // failure, arriving through the quietest path there is.
    try {
      projects.readAll();
    } catch (err) {
      sendJson(res, 500, {
        error: String((err && err.message) || 'we cannot read your projects right now'),
        projectsUnreadable: true,
      });
      return;
    }
    const roster = safeRoster();
    try {
      sendJson(res, 200, { projects: projects.list(roster), agentsUnreadable: roster === null });
    } catch {
      // The record is still readable when the roster is not, so the projects
      // themselves are served with every member marked unseen rather than the
      // whole page failing. `describe` already says `present: false` for each.
      // ⚠️ WRAPPED TOO, though `readAll` was proven readable a few lines above.
      // An external writer can corrupt the file in between, and this arm
      // running unguarded is the same class as the crash the route below it was
      // measured and fixed for — the process exiting on a plain read.
      let listed;
      try {
        listed = projects.list(null);
      } catch (err) {
        sendJson(res, 500, {
          error: String((err && err.message) || 'we cannot read your projects right now'),
          projectsUnreadable: true,
        });
        return;
      }
      sendJson(res, 200, {
        projects: listed,
        agentsUnreadable: true,
        because: 'we cannot read the agents on this computer right now, so we are not saying anything about how they are doing',
      });
    }
    return;
  }

  /**
   * Where a project of this name WOULD go, before anything is made.
   *
   * ⚠️ ONE derivation, and this route is why. The add screen has to show the
   * exact path before it creates anything — a folder name derived from what was
   * typed, without showing the derivation, is a folder the person cannot find.
   * The page could compute it, and then the string on screen and the directory
   * on disk would be two answers to one question, drifting the first time the
   * rule changes. So the engine answers and the page renders.
   *
   * ⚠️ ANSWERS 200 EITHER WAY. A name we cannot make a folder out of is a
   * renderable state — the sentence goes under the field the person is still
   * typing in — not an error the screen has to catch.
   */
  if (pathname === '/api/project-folder' && (req.method === 'GET' || req.method === 'HEAD')) {
    let asked = '';
    try { asked = new URL(req.url, ROUTING_BASE).searchParams.get('name') || ''; } catch { asked = ''; }
    const problem = projects.folderNameProblem(asked);
    if (problem) { sendJson(res, 200, { path: null, problem }); return; }
    // ⚠️ `folderPathPreview`, which does NOT create anything (it only lists
    // the parent). Somebody typing into a name box must not leave a trail of
    // empty directories behind them; the folder is made once, by `create`,
    // when they press the button. The preview carries makeFolder's own
    // case correction, so the path shown is the path the act produces.
    const preview = projects.folderPathPreview(asked);
    // `exists` rides along so the page can say ADOPT instead of MAKE for a
    // folder that is already there -- two different acts, one sentence each.
    // `blocked` is the third arm (a FILE at the path): the preview speaks
    // makeFolder's refusal before the button is pressed, instead of
    // promising a make the engine will refuse (round 23).
    sendJson(res, 200, { path: preview.path, exists: preview.exists, blocked: preview.blocked || null, problem: null });
    return;
  }

  if (pathname === '/api/projects' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          throw new Error('we could not read that request');
        }
        // One roster for the whole request: the same observation decides
        // `everSeen`, the write permission, and what the response reports.
        const roster = safeRoster();
        const made = projects.create({ name: body.name, folder: body.folder, agents: body.agents, roster, description: body.description });
        // ⚠️ Told AFTER the record is written, never before. If announcing it
        // failed first, a membership the person asked for would not exist at
        // all -- and the whole point of the three-valued verdict is that a
        // recorded membership we could not announce is a real, reportable
        // state rather than a reason to refuse the request.
        // ⚠️ ONE roster read for the whole request, threaded into every sync.
        // `syncAgent` REFUSES to write without an exact match in it, so passing
        // it is not an optimisation -- it is the permission.
        // ⚠️ The record is written; from here the project EXISTS. A throw while
        // telling its members must not come back as "we could not create that
        // project" -- DELETE was split into two try blocks for exactly this
        // ("the person was told their removal failed for a removal that
        // happened") and create had the same shape.
        let told = [];
        try {
          told = made.agents.map((a) => ({ agent: a, ...projects.syncAgent(a, roster) }));
        } catch (err) {
          told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: String((err && err.message) || 'we could not reach the agents you put on it') }];
        }
        let project = null;
        try { project = projects.get(made.id, roster); } catch { project = null; }
        sendJson(res, 200, { project, told, id: made.id, agentsUnreadable: roster === null });
      })
      .catch((err) => sendJson(res, (err && err.code === 'UNREADABLE') ? 500 : 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  const proj = pathname.match(/^\/api\/project\/([^/]+)$/);
  if (proj && (req.method === 'GET' || req.method === 'HEAD')) {
    const id = decodeSegment(proj[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ WRAPPED, because `readAll` THROWS on a store it cannot read and this
    // was the one read that did not catch it. Measured: with a corrupt
    // projects.json the list route answered its honest 500 and the very next
    // request for one project took the whole board process down — exit 9,
    // nothing serving. The app that watches the fleet dying on a plain read is
    // worse than every state the guard family around it protects.
    // ⚠️ ONE roster read per request. Two `tmux list-panes` calls can disagree,
    // and the disagreement is exactly the sentence this app exists not to say:
    // the response could carry every member as "we cannot see this agent right
    // now" while asserting `agentsUnreadable: false` -- claiming those agents
    // are missing on the strength of a look that had in fact failed.
    const roster = safeRoster();
    let found;
    try {
      found = projects.get(id, roster);
    } catch (err) {
      sendJson(res, 500, {
        error: String((err && err.message) || 'we cannot read your projects right now'),
        projectsUnreadable: true,
      });
      return;
    }
    if (!found) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    sendJson(res, 200, { project: found, agentsUnreadable: roster === null });
    return;
  }

  if (proj && req.method === 'PUT') {
    const id = decodeSegment(proj[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          throw new Error('we could not read that request');
        }
        // ⚠️ A missing project is a 404 here as it is on GET and DELETE. It
        // used to be a 400 for the identical condition, which told a caller
        // its request was malformed when the request was fine.
        if (!projects.readAll().some((p) => p.id === id)) {
          const missing = new Error('there is no project by that name');
          missing.status = 404;
          throw missing;
        }
        /* ⚠️ Each field moves only when the request CARRIES it, and every
           carried field is applied in ONE engine write. Two separate
           mutations here meant a failure in the second answered "your save
           failed" about a rename that had already persisted. An EXPLICIT
           empty description clears the field -- deliberately unlike the
           profile displayName's blank-drop, because a description is
           optional by design and the settings screen offers clearing; the
           never-delete rule protects a person's words in composition, not a
           field they chose to empty. A carried field of the WRONG TYPE is
           refused loudly by the engine (cleanName throws on nothing,
           cleanDescription on non-words), and a body carrying NO field we
           recognise is refused too -- {"descrption": "..."} answering
           "saved" is a save the person believes happened. */
        const fields = {};
        if (body.name !== undefined) fields.name = body.name;
        if (body.description !== undefined) fields.description = body.description;
        /* archived is a carried field like the others: the engine's edit
           validates every carried field before its ONE write (a non-boolean
           archived is refused there, because `!!` would turn
           {"archived": "false"} into an archive), so a mixed body either
           applies whole or not at all. */
        if (body.archived !== undefined) fields.archived = body.archived;
        projects.edit(id, fields);
        // The block names the project, so a rename has to reach the agents that
        // were told the old name -- otherwise their instructions describe a
        // project that no longer goes by that. Archiving does NOT re-tell: the
        // name did not change, and the engine's own rule is that archiving
        // changes nothing about the members.
        // ⚠️ Re-read rather than reusing the row from the existence check: a
        // record removed in between made this `.agents` of `undefined`, and the
        // raw TypeError went out as the person's error message.
        const reRead = projects.readAll().find((p) => p.id === id);
        const roster = safeRoster();
        // Same reason as create and delete: the rename HAPPENED. A failure
        // re-telling the members is a different fact from a failed rename.
        // (Only when the name moved: the managed block carries the name and
        // the folder, and neither the description, the archived flag, nor
        // anything else this route can change, so a name-less save has
        // nothing to re-tell.)
        try {
          if (body.name !== undefined) {
            for (const a of (reRead ? reRead.agents : [])) projects.syncAgent(a, roster);
          }
        } catch { /* reported by the row's own told verdict on the next read */ }
        let project = null;
        try { project = projects.get(id, roster); } catch { project = null; }
        // ⚠️ ONE roster read, and `agentsUnreadable` reported — PUT was the one
        // route that read it twice and told nobody, so a failed second look
        // came back asserting every member was unseen.
        sendJson(res, 200, { project, agentsUnreadable: roster === null });
      })
      .catch((err) => sendJson(res, (err && err.status) || ((err && err.code === 'UNREADABLE') ? 500 : 400), { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  if (proj && req.method === 'DELETE') {
    const id = decodeSegment(proj[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ TWO try blocks, because they answer different questions. Removing the
    // record and re-telling the members were in ONE, so a failure while
    // re-telling was answered "there is no project by that name" -- 404, after
    // the project had actually been removed. The person was told their removal
    // failed for a removal that happened.
    let gone;
    try {
      gone = projects.remove(id);
    } catch (err) {
      sendJson(res, (err && err.code === 'UNREADABLE') ? 500 : 404,
        { error: String((err && err.message) || 'there is no project by that name') });
      return;
    }
    // The members are re-told AFTER the project is gone, so the block in their
    // instructions stops naming a project that no longer exists.
    let told = [];
    try {
      const roster = safeRoster();
      // ⚠️ THE DISPLAY NAME TRAVELS WITH THE VERDICT. `gone.agents` are machine
      // names, and the list's failure note printed them raw -- so for the exact
      // fleet this feature was built for, the person read "claudebot still
      // mentions it in their instructions" about the agent whose card everywhere
      // else says "Splinter". The module's own rule is act on the machine name,
      // SPEAK the display name, and the roster that resolves the two is already
      // in hand here. `shownAs` falls back to the machine name, because a name
      // we cannot resolve is still the only name we have.
      told = gone.agents.map((a) => {
        const card = Array.isArray(roster) ? roster.find((c) => c && c.sessionName === a) : null;
        return { agent: a, shownAs: (card && card.name) || a, ...projects.syncAgent(a, roster) };
      });
    } catch (err) {
      told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: String((err && err.message) || 'we could not reach the agents that were on it') }];
    }
    sendJson(res, 200, { removed: gone.id, name: gone.name, told });
    return;
  }

  /**
   * The Success screen's "Show me where it is" (the pack draws it; Josh
   * asked for it by name). POST like its reveal-folder sibling below, same
   * cross-site posture: this opens an app on the person's machine. The
   * engine re-derives the location itself; nothing from the request is
   * honoured, and a location that cannot be found right now refuses with a
   * sentence instead of opening nothing.
   */
  if (pathname === '/api/reveal-app' && req.method === 'POST') {
    // Cross-site writes were already refused by the global guard that runs
    // BEFORE every route; an inline re-check here could never fire and only
    // implied the sibling routes were less covered than they are.
    try {
      sendJson(res, 200, machine.revealApp());
    } catch (err) {
      // The engine rethrows programming errors so a bug does not wear the
      // failure's clothes; the route keeps that split. A ReferenceError
      // painted into the dock as an honest refusal is the same lie one
      // layer up, so it answers 500 with the sibling routes' shape.
      if (err instanceof ReferenceError || err instanceof TypeError) {
        sendJson(res, 500, { error: 'something went wrong on our side showing it', detail: String((err && err.message) || err) });
        return;
      }
      sendJson(res, 409, { error: String((err && err.message) || 'we could not show it') });
    }
    return;
  }

  /**
   * Reveal the project's folder in Finder. POST, guard-inherited (it opens
   * an app). The path is ALWAYS the stored record's, never the request's,
   * same rule as the sleep-settings opener: this must not become an
   * open-arbitrary-path primitive. Refused with the state's own sentence
   * when the folder is not there to show.
   */
  const reveal = pathname.match(/^\/api\/project\/([^/]+)\/reveal-folder$/);
  if (reveal && req.method === 'POST') {
    const id = decodeSegment(reveal[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let record;
    try {
      record = projects.readAll().find((x) => x.id === id) || null;
    } catch (err) {
      sendJson(res, 500, { error: String((err && err.message) || 'we cannot read your projects right now') });
      return;
    }
    if (!record) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    const state = projects.folderState(record.folder);
    if (!state || state.state !== projects.FOLDER.READABLE) {
      sendJson(res, 409, { error: (state && state.because) || 'we cannot find that folder right now, so there is nothing to show' });
      return;
    }
    const opened = projects.revealFolder(record.folder);
    if (opened.ok) { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 409, { error: opened.because });
    return;
  }

  // --- tasks: things that need doing on THIS project -----------------------
  // POSTs, so they inherit the cross-site guard. The number is issued by the
  // project inside the engine's atomic write; closing is a record edit and
  // never an act on an agent (engine/tasks.js carries the reasoning, the
  // screen carries the sentence).
  const taskMake = pathname.match(/^\/api\/project\/([^/]+)\/tasks$/);
  if (taskMake && req.method === 'POST') {
    const id = decodeSegment(taskMake[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const roster = safeRoster();
        try {
          const made = tasks.create(id, { sentence: body.sentence, detail: body.detail, who: body.who }, roster);
          // The assignee's managed block now lists this task in the exact
          // spelling the join matches on, so the agent is TOLD, not merely
          // recorded. Non-gating, same as every tell: a task that could not
          // be announced is still a task. (Shape note: `told` here is ONE
          // bare verdict -- a task has one assignee -- where the project
          // create/remove routes carry an array of {agent, ...} entries.)
          let told;
          if (made.who) {
            try { told = projects.syncAgent(made.who, roster); }
            catch (err2) { told = { state: projects.TOLD.COULD_NOT, because: String((err2 && err2.message) || 'we could not reach that agent') }; }
          }
          sendJson(res, 200, { task: made, told });
        } catch (err) {
          // Three answers for three facts, same split as the member route:
          // our unreadable store (500), a project that is not there (404),
          // the person's input (400).
          const code = (err && err.code === 'UNREADABLE') ? 500
            : (/no project by that name/.test(String(err && err.message)) ? 404 : 400);
          sendJson(res, code, { error: String((err && err.message) || 'we could not add that task') });
        }
      })
      .catch((err) => sendJson(res, 400, { error: String((err && err.message) || err) }));
    return;
  }

  const taskAct = pathname.match(/^\/api\/project\/([^/]+)\/task\/(\d+)\/(close|reopen)$/);
  if (taskAct && req.method === 'POST') {
    const id = decodeSegment(taskAct[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    try {
      const t = taskAct[3] === 'close' ? tasks.close(id, taskAct[2]) : tasks.reopen(id, taskAct[2]);
      // Close and reopen change what the assignee's block should list, so
      // the block follows the record. Non-gating.
      let told;
      if (t.who) {
        const roster = safeRoster();
        try { told = projects.syncAgent(t.who, roster); }
        catch (err2) { told = { state: projects.TOLD.COULD_NOT, because: String((err2 && err2.message) || 'we could not reach that agent') }; }
      }
      sendJson(res, 200, { task: t, told });
    } catch (err) {
      const msg = String((err && err.message) || '');
      const code = (err && err.code === 'UNREADABLE') ? 500
        : (/no project by that name|no task by that number/.test(msg) ? 404 : 400);
      sendJson(res, code, { error: msg || 'we could not change that task' });
    }
    return;
  }

  const member = pathname.match(/^\/api\/project\/([^/]+)\/agent\/([^/]+)$/);
  if (member && (req.method === 'POST' || req.method === 'DELETE')) {
    const id = decodeSegment(member[1]);
    const name = decodeSegment(member[2]);
    if (id === null || name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ TWO try blocks, for the same reason delete and create have them: once
    // the membership change has landed it HAPPENED, and a later failure while
    // telling the agent or reading the project back must not come back as "we
    // could not change that project".
    const roster = safeRoster();
    try {
      if (req.method === 'POST') projects.addAgent(id, name, roster);
      else projects.removeAgent(id, name);
    } catch (err) {
      // ⚠️ Three different answers, because they are three different facts. A
      // store we cannot read is ours (500), a project that is not there is a
      // 404 like every sibling route, and only a genuinely bad request is a
      // 400. Answering 400 for an unreadable store put "we will not overwrite
      // your projects file while we cannot read it" in front of somebody as if
      // it were a complaint about what they had typed.
      const code = (err && err.code === 'UNREADABLE') ? 500
        : (/no project by that name/.test(String(err && err.message)) ? 404 : 400);
      sendJson(res, code, { error: String((err && err.message) || 'we could not change that project') });
      return;
    }
    let verdict;
    try {
      verdict = projects.syncAgent(name, roster);
    } catch (err) {
      verdict = { state: projects.TOLD.COULD_NOT, because: String((err && err.message) || 'we could not reach that agent') };
    }
    let project = null;
    try { project = projects.get(id, roster); } catch { project = null; }
    sendJson(res, 200, { project, told: verdict, agentsUnreadable: roster === null });
    return;
  }

  /**
   * --- talking to ONE agent on ONE project ---------------------------------
   *
   * ⚠️ THE MEMBERSHIP CHECK IS A ROUTING RULE, NOT A PERMISSION, and the
   * difference has to be said out loud on this branch. Nothing in this product
   * confines an agent to a project (`engine/projects.js` says so at length),
   * and this does not start. What it does is refuse to make THIS route a
   * general "type into any agent on the machine" endpoint that merely happens
   * to take a project id: a thread belongs to a project and an agent on it, so
   * an agent that is not on the project has no thread here to read or write.
   * The gate that decides whether a keystroke may reach a session at all is
   * `chat.addressable`, and it is about the PANE, not the project.
   *
   * ⚠️ Both halves answer renderable state on every path. A viewport we could
   * not capture, a history file we could not read, and an agent we cannot tie
   * to a session are each a sentence rather than a blank screen.
   */
  const thread = pathname.match(/^\/api\/project\/([^/]+)\/thread\/([^/]+)$/);
  if (thread && (req.method === 'GET' || req.method === 'HEAD')) {
    const id = decodeSegment(thread[1]);
    const name = decodeSegment(thread[2]);
    if (id === null || name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ ONE roster read for the whole request, like every sibling route here.
    // Two `tmux list-panes` calls can disagree, and the disagreement is exactly
    // the sentence this app exists not to say — a viewport captured from one
    // look reported beside a membership described from another.
    const roster = safeRoster();
    let project;
    try {
      project = projects.get(id, roster);
    } catch (err) {
      sendJson(res, 500, {
        error: String((err && err.message) || 'we cannot read your projects right now'),
        projectsUnreadable: true,
      });
      return;
    }
    if (!project) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    const member = (project.agents || []).find((m) => m.sessionName === name) || null;
    if (!member) { sendJson(res, 404, { error: 'that agent is not on this project' }); return; }

    /**
     * ⚠️ THE HISTORY AND THE VIEWPORT FAIL SEPARATELY, because they are
     * different objects with different owners. The messages are OURS — we wrote
     * them — and an unreadable record is reported as unreadable rather than as
     * an empty conversation, the same refusal `/api/projects` makes for the
     * projects file. The viewport is the AGENT's screen, live-only, and its
     * failure says so in its own sentence.
     */
    let messages = null;
    let historyBecause = null;
    /**
     * ⚠️ "WE WITHHELD IT" IS NOT "WE COULD NOT READ IT", and collapsing the two
     * put three false sentences on one screen.
     *
     * A thread belonging to an EARLIER project of this name is one we read
     * perfectly well and chose not to show. Reported through the same channel as
     * a corrupt file, the page said "We cannot read what you have sent this
     * agent" (false — we read it) and then "this is not saying you have sent
     * nothing" (false the other way — for THIS project they have sent nothing,
     * and that is exactly the fact to state).
     *
     * So the two travel separately. `historyOther` means: this project's own
     * conversation is empty, and an earlier one of the same name has messages
     * kept aside.
     */
    let historyOther = false;
    /**
     * ⚠️ A THIRD CHANNEL, because a name we CANNOT FILE UNDER is a third fact.
     *
     * `chat.threadFile` refuses an agent whose session name is not already its
     * own store key — a capital or a dot, which is exactly what the pre-existing
     * `-discord` agents adoption produces and exactly what Josh asked for when
     * he asked for capitalised names. The refusal is right (relaxing it would
     * reintroduce the `MyBot`/`mybot` collision this branch already killed), but
     * routing it into `historyBecause` produced, again, the two false sentences
     * `historyOther` exists to have removed: "We cannot read what you have sent
     * this agent" (there is no file to read) and "this is not saying you have
     * sent nothing" (nothing is kept, here or anywhere).
     *
     * So it gets its own channel and its own vocabulary. Sending still WORKS —
     * `deliver` places the words in the agent's session — and the send-time line
     * already says the message was not added to the conversation. What this
     * flags is the standing fact behind that: for this agent, nothing is kept,
     * and nothing will be.
     */
    let historyUnfilable = false;
    try {
      // ⚠️ The project's own birth date goes in, so a thread written for an
      // EARLIER project that had this name is refused rather than shown under
      // this one. Ids are derived from names and a removal frees the id.
      messages = chat.readThread(id, name, project.createdAt).messages;
    } catch (err) {
      if (err && err.code === 'OTHER_PROJECT') {
        historyOther = true;
        // Empty is the TRUE answer for this project: it is a new project and
        // nothing has been sent to this agent from it.
        messages = [];
      } else if (err && err.code === 'BAD_THREAD') {
        historyUnfilable = true;
        // There is no file and there never will be one, so an empty list is
        // the honest shape — the sentence beside it carries the standing fact.
        // ⚠️ BAD_THREAD can also mean a bad PROJECT id (chat.js throws it for
        // either half of the key), and the page renders this channel as a
        // sentence about the AGENT'S name. Unreachable today with ~3 chars of
        // margin: cleanName caps a project name at 120, safeKey only strips,
        // idFor adds a short counter, and PROJECT_ID allows 128 (the raised
        // bound is pinned by a test). If ids ever grow, branch this on which
        // half failed before the margin is spent.
        messages = [];
        // Set for API consumers and pinned by the route test's own-words
        // assertion; the PAGE does not read it on this arm (it composes the
        // named sentence itself and branches on historyUnfilable first).
        // ⚠️ This is a STATED EXCEPTION to the no-unread-surface rule that
        // removed the payload's agents copy (round 19) and readIdentity's
        // source (round 22): those had no reader anywhere, while this field
        // keeps the GET contract uniform across its three history arms for
        // any non-page consumer -- the field exists on the other two arms
        // for the page, so absence HERE would be the special case (round
        // 26, kept deliberately).
        historyBecause = String((err && err.message) || 'we cannot keep a conversation under this agent’s name');
      } else {
        historyBecause = String((err && err.message) || 'we cannot read what you have sent this agent');
      }
    }
    const view = chat.viewport(name, roster);
    /**
     * ⚠️ The question region is offered only when the BOARD says this agent is
     * asking one, so the thread cannot contradict the card that sent the person
     * here. And when the board says so while the markers are not in the capture
     * — the pane redraws, and the two reads are milliseconds apart — that is
     * said plainly rather than rendered as no question at all.
     */
    // The engine's own constant, not a literal: a state renamed there must move
    // this with it rather than leaving a comparison that silently never matches.
    // ⚠️ The `member.tied &&` conjunct is defence-in-depth the same way the
    // page's button gate is: today's pipeline forces an untied member's
    // state to `unknown` upstream, so no fixture can drive tied=false
    // together with NEEDS_YOU and no test can hold this conjunct (round 14
    // measured its removal green). It stays for the day the upstream gating
    // changes; there is no route-level pin for it, on purpose recorded here.
    const asking = member.tied && member.state === STATE.NEEDS_YOU;
    const question = asking && view.text ? chat.questionIn(view.text) : null;
    /**
     * ⚠️ TWO DIFFERENT FACTS, TWO SENTENCES. "We read its screen and the
     * question is not in the capture" and "we could not read its screen at
     * all" were one string here, so a failed capture rendered as a claim
     * about what IS on a screen nobody read -- with the page then adding
     * "its whole screen is below" over a screen it was hiding. The exact
     * collapse this branch fixed three times elsewhere, on the one screen
     * the feature exists for.
     */
    // The page composes "<name> is waiting on an answer, and <clause>", so
    // the clause must not restate that premise -- "its card says it is
    // asking something, and we could not read..." doubled back on itself on
    // screen (round 15). One derivation of the sentence, on this side.
    const questionBecause = (asking && !question)
      ? (view.text == null
        ? 'we could not read its screen just now to show the question'
        : 'we cannot find the question on its screen right now')
      : null;
    /* ⚠️ The poll gets a BOUNDED tail (round 36): at the engine's own
       ceilings a full thread is a ~2MB parse-and-stringify every five
       seconds on a synchronous server that can already block on tmux in
       the same request path. The last 200 ride; `olderCount` says how
       many the file still keeps, so the page can state the truth instead
       of implying the visible list is everything. */
    const TAIL = 200;
    const olderCount = Array.isArray(messages) && messages.length > TAIL
      ? messages.length - TAIL : 0;
    if (olderCount) messages = messages.slice(-TAIL);
    sendJson(res, 200, {
      project: { id: project.id, name: project.name },
      agent: member,
      messages,
      olderCount,
      historyBecause,
      // See the block above: withheld is not unreadable, and the page says a
      // different sentence for each.
      historyOther,
      // The third channel: this agent's name cannot be filed under at all.
      historyUnfilable,
      // (An `agents` copy of the membership used to ride here; nothing read
      // it -- the picker builds from the projects poll -- so it was dropped
      // rather than left as surface with no consumer. Round 19.)
      viewport: view,
      asking,
      question,
      questionBecause,
      // Carried for contract parity with the projects routes and held by
      // the blind-roster test; the page's fleet-unreadable sentence on this
      // screen is rendered from the projects payload (PJ_AGENTS_UNREADABLE),
      // not from this field.
      agentsUnreadable: roster === null,
    });
    return;
  }

  if (thread && req.method === 'POST') {
    const id = decodeSegment(thread[1]);
    const name = decodeSegment(thread[2]);
    if (id === null || name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          throw new Error('we could not read that request');
        }
        // Refused before anything is looked up, so a message we would never
        // send does not cost a tmux fan-out.
        const problem = chat.messageProblem(body.text);
        if (problem) throw new Error(problem);

        const roster = safeRoster();
        let project;
        try {
          project = projects.get(id, roster);
        } catch (err) {
          const unreadable = new Error(String((err && err.message) || 'we cannot read your projects right now'));
          unreadable.status = 500;
          throw unreadable;
        }
        if (!project) {
          const missing = new Error('there is no project by that name');
          missing.status = 404;
          throw missing;
        }
        if (!(project.agents || []).some((m) => m.sessionName === name)) {
          const notOn = new Error('that agent is not on this project');
          notOn.status = 404;
          throw notOn;
        }

        /**
         * ⚠️ DELIVER FIRST, THEN RECORD THE VERDICT WITH IT — and record even a
         * failure. "I asked casey this and it did not get there" is a thing the
         * person needs to be able to see later; a thread that remembers only
         * the successes quietly rewrites its own history.
         *
         * ⚠️ AND THE TWO ANSWERS ARE REPORTED SEPARATELY. A message that WAS
         * placed and could not be written down must not come back looking like
         * a message that was not sent, which is what one merged boolean would
         * have done. Same reason create and delete each carry two try blocks.
         */
        /**
         * ⚠️ THE VERDICT IS PASSED THROUGH WHOLE, three states and all, and
         * nothing here narrows it to a boolean. `unconfirmed` is not a flavour
         * of failure: it means the text may already be in that agent's
         * composer, so a screen that folded it into `could_not` would invite
         * the re-send that duplicates it. See `DELIVERY` in engine/chat.js.
         */
        const delivery = chat.deliver(name, body.text, roster);
        const kept = chat.appendMessage(id, name, { text: body.text, at: delivery.at, delivery }, project.createdAt);
        sendJson(res, 200, {
          delivery,
          recorded: kept.recorded === true,
          recordedBecause: kept.because || null,
          // Said out loud when an earlier project of this name had a
          // conversation: it was kept, and it is not this project's.
          supersededBecause: kept.supersededBecause || null,
          // No `messages` here (round 38): nothing read it -- the page
          // refreshes through the GET, which is also where the round-36
          // TAIL bound lives. Carrying the whole record on the POST was
          // both an unread API surface and an unbounded ~2MB payload the
          // GET had already been bounded against.
          agentsUnreadable: roster === null,
        });
      })
      // The UNREADABLE arm here is defensive, not live: deliver and
      // appendMessage never throw by contract, and projects.get's failure is
      // rewrapped with an explicit .status above, which wins first. Kept so
      // this catch matches its siblings if a throwing read is ever added.
      .catch((err) => sendJson(res, (err && err.status) || ((err && err.code === 'UNREADABLE') ? 500 : 400),
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /**
   * --- choosing a folder ---------------------------------------------------
   *
   * A browser cannot hand back a real path. `<input webkitdirectory>` withholds
   * it deliberately, so the only options are "make the person type a path" or
   * "let the server list folders" — and typing a path is exactly the wall §0
   * exists to remove for a non-technical person. Hence this: read-only,
   * directories only, one level at a time, rooted at the home folder.
   *
   * ⚠️ THIS IS NEW SAFETY CODE, WHICH IS THE LEAST TRUSTWORTHY CODE IN ANY DIFF
   * OF MINE. Five of nine blockers in a previous challenge loop were in guards
   * added during that loop. So containment is asserted on the RESOLVED path and
   * nowhere else: `..` is not stripped, spelling is not inspected, and no
   * prefix is compared before `realpathSync` has run. A symlink inside the home
   * folder pointing outside it is the case every string-level check misses.
   */
  if (pathname === '/api/folders' && (req.method === 'GET' || req.method === 'HEAD')) {
    // ⚠️ RESOLVED, because `real` below is resolved and the two are compared.
    // With an un-resolved `home`, a machine whose home directory is reached
    // through a symlink (which is ordinary) failed its OWN containment check:
    // the browser refused the home folder it had just been asked for, and the
    // whole add-project flow was dead. The route's test compared against
    // `realpathSync(homedir())` too, so it could only pass.
    let home;
    try { home = fs.realpathSync(os.homedir()); } catch { home = os.homedir(); }
    // Parsed here rather than threaded down from `pathOf`, which deliberately
    // returns the path alone -- routing on anything that carries a query string
    // is the bug that function exists to have fixed.
    let asked = null;
    try { asked = new URL(req.url, ROUTING_BASE).searchParams.get('path'); } catch { asked = null; }
    let real;
    try {
      const target = asked ? String(asked) : home;
      // A null byte throws out of `realpathSync` rather than truncating the
      // path somewhere the check no longer applies.
      if (target.includes('\0')) throw new Error('bad path');
      real = fs.realpathSync(target);
    } catch {
      sendJson(res, 400, { error: 'we cannot see a folder there' });
      return;
    }
    // ⚠️ Containment on the RESOLVED path, expressed as "the relative route
    // from home does not climb". `startsWith(home)` is the wrong test twice
    // over: `/Users/agentine` starts with `/Users/agent1`... only by accident of
    // spelling, and it says nothing about a symlink.
    // ⚠️ CASE, on macOS: `realpath` resolves symlinks but does NOT canonicalise
    // case on a case-insensitive volume, so `/users/agent1/x` stays lowercase
    // and `path.relative('/Users/agent1', …)` yields a climb. The containment
    // check then refuses a path that is genuinely inside home. Left as-is
    // rather than case-folded: it FAILS CLOSED (a false refusal, never an
    // escape), the browser only ever hands back paths this route itself
    // produced, and case-folding a path comparison is exactly the kind of
    // loosening that turns a containment check into a hole. Recorded so the
    // next person to meet it knows it is a known false refusal, not a bug in
    // their typing.
    const rel = path.relative(home, real);
    // `rel.startsWith('..')` alone also refuses a folder legitimately named
    // `..archive`. The climb is the segment `..`, not the two characters.
    const climbs = rel === '..' || rel.startsWith('..' + path.sep);
    if (real !== home && (climbs || path.isAbsolute(rel))) {
      sendJson(res, 403, { error: 'we only look inside your home folder' });
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      sendJson(res, 400, { error: 'we cannot read that folder' });
      return;
    }
    const folders = entries
      // Directories the person would recognise: no dotfiles, and a symlinked
      // directory is offered because it is a perfectly ordinary way to keep
      // work — it just gets resolved again when it is opened or chosen.
      .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink()))
      .map((e) => ({ name: e.name, path: path.join(real, e.name), sure: e.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const LIMIT = 500;
    // ⚠️ Only the entries that will actually be SHOWN get a `stat`, and only
    // the ones `readdir` could not already type as directories. A synchronous
    // stat per entry blocked the single-threaded server across the whole
    // folder, including the thousands past the limit that nobody sees.
    const shown = [];
    // ⚠️ Tracked explicitly, not inferred from `folders.length > shown.length`.
    // That comparison also counts entries dropped for NOT BEING FOLDERS, so a
    // directory holding one link-to-a-file reported itself as truncated -- a
    // warning about missing folders when nothing was missing. "We stopped
    // early" is the fact; "some entries were not folders" is a different one.
    let hitLimit = false;
    for (const e of folders) {
      if (shown.length >= LIMIT) { hitLimit = true; break; }
      if (!e.sure) {
        try { if (!fs.statSync(e.path).isDirectory()) continue; } catch { continue; }
      }
      shown.push({ name: e.name, path: e.path });
    }
    sendJson(res, 200, {
      path: real,
      home,
      // ⚠️ Said out loud. A silent cut made a folder that exists but sorts past
      // the limit indistinguishable from one that is not there — the page's
      // "nothing else in here" would be a claim nobody checked.
      truncated: hitLimit,
      showing: shown.length,
      // ⚠️ NO TOTAL WHEN WE STOPPED EARLY, because we do not have one.
      //
      // This read `hitLimit ? folders.length : shown.length`, with a comment
      // correctly explaining that `folders.length` counts entries that never
      // reached the directory check -- and then using it in exactly the branch
      // where that is true. `readdir` gives 520 entries; we typed the first
      // 500 and stopped; the other 20 may be files, links to files, or
      // anything else. So "the first 500 of 520" was a count of things we had
      // not looked at, and a directory of 500 folders plus 20 links-to-files
      // announced 20 folders that do not exist.
      //
      // `null` is the honest answer and the page says "there are more" rather
      // than inventing a number. Counting them properly would mean stat-ing
      // every entry past the limit, which is the synchronous-blocking cost the
      // limit exists to avoid.
      total: hitLimit ? null : shown.length,
      // Null AT home rather than at the filesystem root, so "up" can never walk
      // out of the only place this route will serve.
      parent: real === home ? null : path.dirname(real),
      folders: shown,
    });
    return;
  }

  // Anything under /api/ that reached here matched no handler -- usually a
  // method the route does not implement, e.g. PATCH on an avatar. Falling
  // through to the page would answer an API call with HTML at 200, which is the
  // same silent-success failure the query-string bug produced. Different way
  // in, identical signature, so it is closed here rather than route by route.
  //
  // Compared against the DECODED path. `/api%2fstatus` does not start with
  // `/api/` as a string, so an un-decoded check let it through to the page --
  // the invariant failing on the one spelling a syntactic check gets wrong,
  // which is the same mistake pathOf documents for `//`.
  const apiPath = decodeSegment(pathname) || pathname;
  if (apiPath === '/api' || apiPath.startsWith('/api/')) {
    sendJson(res, 404, { error: 'no such endpoint' });
    return;
  }

  /* The tab icons (#45, Josh 2026-08-17). An explicit allowlist of the four
     shipped sizes, because everything else below falls through to the page:
     without this route, /icons/kosmos-32.png would answer HTML at 200 with
     the wrong content type, the same silent-success signature the API guard
     above exists to stop. A name outside the allowlist 404s as JSON rather
     than serving the page as an image. */
  const iconGet = pathname.match(/^\/icons\/(kosmos-(?:16|32|48|180)\.png)$/);
  if (iconGet && (req.method === 'GET' || req.method === 'HEAD')) {
    fs.readFile(path.join(__dirname, 'web', 'icons', iconGet[1]), (err, buf) => {
      if (err) { sendJson(res, 404, { error: 'no such icon' }); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return;
  }
  // Compared against the DECODED path, the same lesson the /api/ guard
  // above records: /icons%2fx does not start with /icons/ as a string, and
  // an un-decoded check would hand the encoded spelling the page at 200.
  if (apiPath.startsWith('/icons/') || apiPath === '/icons') {
    sendJson(res, 404, { error: 'no such icon' });
    return;
  }
  // /favicon.ico 404s BY DESIGN, matching the site: the icon set is the
  // four explicit PNGs above, and a probe for the .ico must not receive
  // the page dressed as an icon (the silent-success signature again).
  if (apiPath === '/favicon.ico') {
    sendJson(res, 404, { error: 'no favicon.ico: the icons are /icons/kosmos-<size>.png' });
    return;
  }

  const file = path.join(__dirname, 'web', 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('could not read the page');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(buf);
  });
});

/**
 * ⚠️ Bound to localhost deliberately. This server writes and has no auth.
 *
 * It sets roles, stores avatars, records the commitments the restart
 * confirmation will read, and EDITS THE FILE AN AGENT BOOTS FROM. There is no
 * authentication of any kind.
 *
 * ⚠️ AND IT TYPES INTO RUNNING AGENTS. `POST /api/project/:id/thread/:agent`
 * puts arbitrary text plus a separate Enter into a live agent's Claude
 * session -- on a permission prompt, that is an unauthenticated caller
 * answering on behalf of an agent started with
 * `--dangerously-skip-permissions`. Added 2026-08-14, and added to THIS
 * paragraph the same day, for the reason the next paragraph records about
 * the last capability that went unlisted.
 *
 * ⚠️ AND IT CREATES AGENTS, which was the most powerful thing behind this bind
 * and was missing from this list while it was true. `POST /api/agents` installs
 * a launchd job with RunAtLoad and KeepAlive that starts Claude with
 * `--dangerously-skip-permissions` at every login, and whose instruction file
 * any subsequent write here can rewrite. This paragraph is what README points
 * a reader at for "what protects it, and what does not", so leaving the newest
 * and largest capability out of it made the canonical statement of the posture
 * the least accurate thing about it.
 *
 * THREE ways that protection is lost, and only the first is obvious:
 *
 *   1. Changing this to '0.0.0.0'. A one-line edit that looks harmless and
 *      exposes every write endpoint to whatever network the machine is on.
 *
 *   2. A reverse proxy or tunnel pointed at this port. **Binding to localhost
 *      is not sufficient on a machine running one.** Tailscale Funnel, for
 *      instance, proxies `127.0.0.1` ports straight to the public internet —
 *      it is already enabled on the mini this was built on, publishing three
 *      localhost ports. Adding a route for this one would publish it too,
 *      without touching a line of this file.
 *
 *   3. ⚠️ A page on ANOTHER SITE, which needs no misconfiguration at all. A
 *      POST with a form content type is a CORS simple request: no preflight,
 *      and the loopback `Host` a legitimate request carries. Measured against
 *      this server before `crossSiteWrite` existed — a page on any origin
 *      created a worker directory and installed a launchd job. That guard is
 *      now the third thing holding this up, and it is the only one that
 *      protects a machine whose owner did nothing wrong.
 *
 * So localhost is a *default*, not a guarantee. Reachability and login arrive
 * together or not at all.
 *
 * ---
 *
 * Binds and resolves once listening. Port 0 asks the OS for a free one, which
 * is how the tests get a port without colliding with a board someone is using.
 */
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    // Without this, a bind failure -- EADDRINUSE when a board is already
    // running on 4317, which is the common case -- is an unhandled 'error'
    // event that exits with a raw stack trace. Returning a Promise implies the
    // caller can be told; this makes that true.
    const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => {
      server.removeListener('error', onError);
      // Keep a listener attached for the life of the process. Without one, an
      // error after a successful bind is uncaught and exits with a raw stack.
      server.on('error', (err) => {
        process.stderr.write(`Kosmos server error: ${String(err && err.message)}\n`);
      });
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

// Only boot when run directly. Requiring this module -- which the routing tests
// do, so they can drive the real server -- must not bind a port as a side
// effect of the import. Same guard as engine/status.js.
if (require.main === module) {
  start().then(() => {
    // Report the port actually bound, not the one requested, or a `PORT=0` run
    // would announce itself on port 0.
    process.stdout.write(`Kosmos on http://127.0.0.1:${server.address().port}\n`);
    process.stdout.write('Local only. It writes, and it has no login yet.\n');
  }).catch((err) => {
    // Say what to do rather than name an exception. A raw EADDRINUSE stack is
    // exactly what start()'s promise exists to replace, and leaving this
    // uncaught made the comment above it a lie.
    const detail = err && err.code === 'EADDRINUSE'
      ? `port ${PORT} is already in use. Is a board already running?`
      : String(err && err.message);
    process.stderr.write(`Kosmos could not start: ${detail}\n`);
    process.exit(1);
  });
}

// Exported so the routing tests can drive the real server rather than a
// re-implementation of it. Testing the path helper in isolation would not have
// caught the routing bug, because the helper was never the broken part -- the
// routes reading `req.url` around it were.
module.exports = { server, start, pathOf, decodeSegment };
