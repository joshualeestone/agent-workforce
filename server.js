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

// Single source of truth for the version. With no support function, "what
// version are you on?" is the first question of every diagnosis, so the number
// on screen has to be the number in the release rather than a hand-typed label
// that drifts.
const { version } = require('./package.json');
const store = require('./engine/store');
const create = require('./engine/create');
const roles = require('./engine/roles');
const commitments = require('./engine/commitments');
const instructions = require('./engine/instructions');
const projects = require('./engine/projects');
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
      body = JSON.stringify({ ...snap, agents, counts, connection, version });
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
      roles: roles.ROLES.map((r) => ({
        key: r.key, label: r.label, blurb: r.blurb, firstAction: r.firstAction,
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

        const result = create.createAgent({ name: body.name, role: body.role });
        // REFUSED is the caller's fault (a bad name, a duplicate); PARTIAL is
        // ours, and it is a 200 because the thing half-happened and the caller
        // needs the detail rather than an error.
        const code = result.outcome === create.OUTCOME.REFUSED ? 400 : 200;
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
      });
      return;
    }
    sendJson(res, 200, checks);
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
        sendJson(res, 200, instructions.write(name, patch.text, patch.version, sessionOf(name)));
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
    // ⚠️ `folderPathFor`, which does NOT create anything. Somebody typing into a
    // name box must not leave a trail of empty directories behind them; the
    // folder is made once, by `create`, when they press the button.
    sendJson(res, 200, { path: projects.folderPathFor(asked), problem: null });
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
        const made = projects.create({ name: body.name, folder: body.folder, agents: body.agents, roster });
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
        projects.rename(id, body.name);
        // The block names the project, so a rename has to reach the agents that
        // were told the old name -- otherwise their instructions describe a
        // project that no longer goes by that.
        // ⚠️ Re-read rather than reusing the row from the existence check: a
        // record removed in between made this `.agents` of `undefined`, and the
        // raw TypeError went out as the person's error message.
        const renamed = projects.readAll().find((p) => p.id === id);
        const roster = safeRoster();
        // Same reason as create and delete: the rename HAPPENED. A failure
        // re-telling the members is a different fact from a failed rename.
        try {
          for (const a of (renamed ? renamed.agents : [])) projects.syncAgent(a, roster);
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
    const asking = member.tied && member.state === STATE.NEEDS_YOU;
    const question = asking && view.text ? chat.questionIn(view.text) : null;
    sendJson(res, 200, {
      project: { id: project.id, name: project.name },
      agent: member,
      agents: project.agents || [],
      messages,
      historyBecause,
      // See the block above: withheld is not unreadable, and the page says a
      // different sentence for each.
      historyOther,
      viewport: view,
      asking,
      question,
      questionBecause: (asking && !question)
        ? 'its card says it is asking something, but we cannot find the question on its screen right now'
        : null,
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
          messages: kept.messages || null,
          agentsUnreadable: roster === null,
        });
      })
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
 * ⚠️ AND IT CREATES AGENTS, which is the most powerful thing behind this bind
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
        process.stderr.write(`Agent Workforce server error: ${String(err && err.message)}\n`);
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
    process.stdout.write(`Agent Workforce on http://127.0.0.1:${server.address().port}\n`);
    process.stdout.write('Local only. It writes, and it has no login yet.\n');
  }).catch((err) => {
    // Say what to do rather than name an exception. A raw EADDRINUSE stack is
    // exactly what start()'s promise exists to replace, and leaving this
    // uncaught made the comment above it a lie.
    const detail = err && err.code === 'EADDRINUSE'
      ? `port ${PORT} is already in use. Is a board already running?`
      : String(err && err.message);
    process.stderr.write(`Agent Workforce could not start: ${detail}\n`);
    process.exit(1);
  });
}

// Exported so the routing tests can drive the real server rather than a
// re-implementation of it. Testing the path helper in isolation would not have
// caught the routing bug, because the helper was never the broken part -- the
// routes reading `req.url` around it were.
module.exports = { server, start, pathOf, decodeSegment };
