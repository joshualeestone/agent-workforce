'use strict';

/**
 * A local window onto the agents running on this machine.
 *
 * Binds to localhost only, and it WRITES: it stores avatars, roles, the
 * commitments each agent says it is holding, and the instruction file each
 * agent reads at startup. It also MAKES agents: `POST /api/agents` writes a
 * worker directory, a startup script and a launchd job, and loads that job.
 * It cannot yet send input to an agent, or stop or remove one.
 *
 * See the ⚠️ block above `start()` for what protects it, and what does not.
 */

const http = require('node:http');
const { pipeline } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot, paneRoster } = require('./engine/status');

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
      const agents = snap.agents.map((a) => ({
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
      body = JSON.stringify({ ...snap, agents, version });
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
