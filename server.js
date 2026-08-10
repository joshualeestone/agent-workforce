'use strict';

/**
 * A local window onto the agents running on this machine.
 *
 * Binds to localhost only, and it WRITES: it stores avatars, roles, the
 * commitments each agent says it is holding, and the instruction file each
 * agent reads at startup. It also compacts, clears and restarts them, which
 * are the first operations here that touch a running process rather than a
 * file, and the first that can destroy something no backup covers. See
 * `engine/lifecycle.js`.
 *
 * See the ⚠️ block above `start()` for what protects it, and what does not.
 */

const http = require('node:http');
const { pipeline } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot } = require('./engine/status');

// Single source of truth for the version. With no support function, "what
// version are you on?" is the first question of every diagnosis, so the number
// on screen has to be the number in the release rather than a hand-typed label
// that drifts.
const { version } = require('./package.json');
const store = require('./engine/store');
const commitments = require('./engine/commitments');
const instructions = require('./engine/instructions');
const lifecycle = require('./engine/lifecycle');

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
 * The agent record for a name, or `null`.
 *
 * ⚠️ ONE implementation of "is this a known agent", used by every route.
 *
 * The fresh-start route grew its own inline copy in order to take a single
 * snapshot for both the gate and the action — a correct goal, reached by adding
 * a second derivation of the identity rule, which is the defect this codebase
 * has now found in eight places. This gives that route the record it needs
 * without either route inventing its own idea of who counts.
 *
 * Never throws: `snapshot()` shells out to tmux, and a route that 500s because
 * the machine hiccupped is worse than one that says it does not know the agent.
 */
/**
 * ⚠️ There is deliberately NO server-side in-flight guard here, and the reason
 * is worth writing down because a review asked for one and I built it before
 * checking whether it could fire.
 *
 * `lifecycle.perform` is `execFileSync`. It blocks the event loop for its whole
 * duration, so a second request's handler cannot begin until the first has
 * returned. **Two concurrent destructive actions against one agent are not
 * reachable in this process** — the second request waits, whatever the browser
 * or curl does. A `Set` of in-flight keys could never be observed as occupied,
 * which makes it dead code wearing the costume of a protection, and this
 * codebase has already shipped several of those.
 *
 * The hazard that IS real is **sequential**: request A completes, `launchctl
 * start` has been issued, the service is still settling, and request B arrives
 * immediately after. An in-flight set does nothing about that because A is
 * already finished. The fix for it would be a cooldown, and it is not built
 * because nothing has shown the back-to-back case actually misbehaves —
 * `restart-bot.sh` verifies with `has-session` and reports honestly either way.
 * If it ever does, the shape is a per-agent timestamp, not a busy flag.
 */

/**
 * Can we address this agent by name at all?
 *
 * ⚠️ Its own function so `findAgent` and the `may` field cannot disagree. They
 * did: `may` published `ok: true` for an agent the action route then 404'd,
 * because the name rule lived only inside `findAgent`.
 */
function addressable(sessionName) {
  try {
    const raw = String(sessionName || '');
    // ⚠️ EXACT, not case-folded. The first version allowed case folding on the
    // reasoning that `MyBot` is unambiguous — but `findAgent` resolves against
    // `a.sessionName === key` where `key` is lower-cased, so a session actually
    // named `Mikey-discord` was published with `may.*.ok = true` and its POST
    // answered 404. That is the same promises-what-the-route-refuses state this
    // function was added to remove, reintroduced by the very clause meant to be
    // generous. The roster carried no capitalised name, so the test that pins
    // the agreement passed either way.
    return store.safeKey(raw) === raw;
  } catch {
    return false;
  }
}

function findAgent(name) {
  try {
    const raw = String(name || '');
    const key = store.safeKey(raw);

    // ⚠️ `safeKey` STRIPS illegal characters rather than rejecting them, so two
    // different names can collapse to one key: `my.bot` becomes `mybot`. Left
    // alone, a request for `my.bot` resolves to the agent actually called
    // `mybot` — and on these routes that means `/clear` typed into a different
    // agent's pane and `restart-bot.sh mybot` at a different agent's service.
    //
    // The confirmation token does NOT fail closed here, which is the part worth
    // spelling out: when neither agent has ever reported commitments, both read
    // `unknown` with an empty list, so both produce the identical token and the
    // action proceeds. The guard that looks like it covers this does not.
    //
    // Case folding is still allowed — the roster is lower-case and a hand-typed
    // `MyBot` is unambiguous. Only STRIPPING is refused, because stripping is
    // the part that makes two names one.
    if (!addressable(raw)) return null;

    return snapshot().agents.find((a) => a.sessionName === key) || null;
  } catch {
    return null;
  }
}

function knownAgent(name) {
  return findAgent(name) !== null;
}

/**
 * A stable fingerprint of what an agent is holding.
 *
 * ⚠️ Includes the STATE, not just the items. `unknown` with three items and
 * `holding` with the same three are different situations: the first means we
 * cannot vouch for the list. A token built from the items alone would let a
 * dialog that said "we cannot tell" be approved against a later moment when we
 * could, which is the two-things-one-token conflation the instruction editor
 * had to fix between `absent` and `unreadable`.
 */
function holdingToken(seen) {
  // ⚠️ The TEXT, not just the ids. A commitment can keep its id and change what
  // it says: `resolve(agent, id)` requires ids to be stable across reports, so
  // an agent re-reporting the same item with new wording is ordinary, not
  // exotic. Measured: the dialog showed "Draft the internal memo", the agent
  // re-reported that id as "Wire the 40k payment to the vendor", and the
  // original token was still accepted. The operator approved destroying one
  // thing and destroyed another.
  const items = (seen.commitments || [])
    .map((c) => `${c.id}\u0000${c.what}`)
    .sort()
    .join('\u0001');
  const digest = require('node:crypto').createHash('sha256').update(items, 'utf8').digest('hex').slice(0, 32);
  return `${seen.state}:${digest}`;
}

/**
 * Is this request coming from a page on some OTHER site?
 *
 * ⚠️ Closes a cross-site request forgery hole that the `Host` check does not,
 * and cannot. That check stops DNS REBINDING, where the attacker controls the
 * hostname. This is the other shape: a page on `evil.example` posting straight
 * at `http://127.0.0.1:4317`, where the `Host` header is a perfectly genuine
 * loopback value because the request really is addressed to us.
 *
 * Measured before this existed: a `POST /api/agent/angel/restart` carrying
 * `Content-Type: text/plain` and `Origin: https://evil.example` was answered
 * 200 and reached the restart. A plain HTML `<form>` can emit exactly that,
 * with the JSON body smuggled through the field name, and a form POST is a CORS
 * "simple request" so no preflight ever happens.
 *
 * It matters most for the newest routes and it is applied to every write:
 * `PUT`/`DELETE` are protected today only because a form cannot emit them,
 * which is a property of HTML rather than a decision this code made.
 *
 * Two signals, either sufficient to refuse:
 *
 *   - `Sec-Fetch-Site` is what browsers now send, and `same-origin` is the only
 *     value we accept. It cannot be set by script.
 *   - `Origin` is sent on every cross-origin POST, and on same-origin POSTs by
 *     most browsers. Loopback origins only.
 *
 * A request with NEITHER header is curl, a script, or an old client. Those are
 * already inside the loopback boundary and cannot be aimed by a web page, so
 * they pass: refusing them would break every non-browser caller to stop an
 * attack that needs a browser to happen.
 */
function crossSite(req) {
  const h = (req && req.headers) || {};

  const fetchSite = h['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;

  const origin = h.origin;
  // ⚠️ `null` is NOT a pass. An opaque origin is what a sandboxed iframe sends
  // on a form POST, so treating it as "no origin to check" left the exact
  // cross-site form attack open on browsers that do not send `Sec-Fetch-Site`.
  // An origin we cannot attribute is one we cannot vouch for.
  // ⚠️ NOT currently load-bearing, said out loud rather than implied. The
  // `new URL(origin)` below throws on 'null' and its catch already refuses, so
  // deleting this line changes no behaviour and fails no test. Kept as
  // defence-in-depth against a future refactor that makes the parse lenient,
  // and labelled so nobody reads it as coverage that exists.
  if (origin === 'null') return true;
  if (origin) {
    let host;
    try {
      host = new URL(origin).hostname;
    } catch {
      return true; // unparseable origin is not one we can vouch for
    }
    // ⚠️ The SAME set `pathOf` accepts, loopback plus the deliberate opt-in.
    // Checking loopback alone turned every write route 403 for anyone running
    // behind `AGENT_WORKFORCE_ALLOWED_HOSTS`, with an error message asserting
    // the request "came from another site" when it came from the very origin
    // the operator had allowed. A guard that is stricter than the door it sits
    // behind is a bug, not extra safety.
    if (!LOOPBACK_HOSTS.has(host) && !ALLOWED_HOSTS.has(host)) return true;
  }

  return false;
}

/** The commitment block, with the fingerprint the confirmation compares. */
function withToken(seen) {
  return { ...seen, token: holdingToken(seen) };
}

/**
 * Turn a thrown error into what the operator is told.
 *
 * ⚠️ Only messages we WROTE are echoed back. Everything in the fresh-start
 * chain that throws deliberately does so with a sentence composed for a person,
 * and those all set `code`. Anything else arriving here is an unexpected throw
 * — and `snapshot()` is in that chain, shelling out to tmux and reading
 * transcripts, so it surfaces filesystem errnos and absolute home directory
 * paths. Passing `err.message` through verbatim put those on screen, against
 * the rule stated on `safeTarget` and plan item 1.5.
 *
 * Keyed on a `code` WE set, not on pattern-matching the text, for the same
 * reason `editable` is a structured field rather than a regex over English.
 *
 * Extracted rather than left inline for the same reason `mayTypeInto` was: the
 * inline version could not be pinned, because provoking a genuine unexpected
 * throw from the route means breaking tmux or the filesystem under a live
 * fleet. As a function the refusal is testable directly.
 */
const OUR_ERRORS = new Set(['CONFLICT', 'SAY_WHAT']);

function errorAnswer(err) {
  const code = err && err.code;
  if (!OUR_ERRORS.has(code)) {
    return { status: 500, error: 'something went wrong here, and we could not tell what' };
  }
  return {
    status: code === 'CONFLICT' ? 409 : 400,
    error: String(err.message),
  };
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

const server = http.createServer((req, res) => {
  const pathname = pathOf(req);
  if (pathname === null) {
    // Not addressed to us. Saying so is better than handing back the index,
    // which would look like a successful page load.
    sendJson(res, 400, { error: 'that request was not addressed to this server' });
    return;
  }

  // ⚠️ Every state-changing request, before any route sees it. Placed here
  // rather than per-route so a route added later inherits it by default: the
  // recurring defect in this codebase is one path guarded and a second path on
  // the same fact left open, and a per-route check is that shape waiting to
  // happen.
  if (pathname.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD' && crossSite(req)) {
    sendJson(res, 403, { error: 'that request came from another site' });
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
      const agents = snap.agents.map((a) => ({
        ...a,
        // ⚠️ The confirmation token rides WITH the data the dialog renders
        // from, computed by the same function the route checks against.
        //
        // It used to be recomputed in the browser with `crypto.subtle`, which
        // is undefined outside a secure context: on the very proxy deployment
        // `AGENT_WORKFORCE_ALLOWED_HOSTS` exists to support, the token was
        // never produced, every action answered "say what you were shown this
        // would lose", and nothing on screen explained why. It was also async,
        // so the dialog rendered enabled buttons before the token existed.
        //
        // Handing it down removes both problems and is not weaker: the token
        // describes exactly the payload the dialog was drawn from.
        commitments: withToken(commitments.read(a.sessionName)),
        // Staleness only, NOT the instruction text. The board polls this every
        // five seconds for every agent, and the real files run to several
        // kilobytes each -- carrying them here would put ~90KB on the wire per
        // poll to render a badge. The text is fetched once, by the detail page,
        // when someone actually opens it.
        instructions: instructions.staleness(a.sessionName),
        // ⚠️ Whether each action would be REFUSED, decided by the same function
        // the route decides with.
        //
        // The dialog offered all three whatever the agent's state, so for an
        // agent showing a question or sitting on a rate limit the visually
        // primary GENTLEST button was guaranteed to come back 409. That is the
        // offer-an-action-that-cannot-work state the instruction editor was
        // explicitly changed to remove, reinstated on the more dangerous
        // screen, and it trains exactly the click-through this card exists to
        // prevent.
        //
        // Computed HERE from `lifecycle.mayTypeInto` rather than re-derived in
        // the browser from `state` and `isAgentPane`. Those fields are all in
        // this payload, so the screen could have worked it out itself — and
        // that would be a second copy of the rule that decides whether a
        // destructive action is allowed, drifting from the first. The button is
        // disabled by the answer, not by a lookalike of it.
        // ⚠️ AND the route's own name rule, or `may` promises what the action
        // route then refuses. `findAgent` rejects a name whose characters
        // `safeKey` would strip, because stripping is what makes two names one
        // — so an agent in a session called `my.bot-discord` is on the board and
        // is NOT actionable. Without this clause `may.clear.ok` came back true
        // and the POST answered 404: the exact offer-an-action-that-cannot-work
        // state this field was added to remove, and one fact (is this agent
        // actionable) derived in two places that disagreed.
        may: ['compact', 'clear', 'restart'].reduce((acc, action) => {
          const verdict = addressable(a.sessionName)
            ? lifecycle.mayTypeInto(action, a)
            : {
              ok: false,
              because: 'this agent\u2019s session name has characters we cannot address it by, so we will not act on it under a name that is not exactly its own',
            };
          acc[action] = { ok: verdict.ok, because: verdict.because || null };
          return acc;
        }, {}),
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
  const avatarGet = pathname.match(/^\/api\/agent\/([^/]+)\/avatar$/);
  if (avatarGet && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(avatarGet[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
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

  // --- profile: things the machine cannot derive (role, etc.) -------------
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
      sendJson(res, 200, instructions.read(name));
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
        sendJson(res, 200, instructions.write(name, patch.text, patch.version));
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

  // The engine's own description of each action, so the dialog cannot describe
  // one differently from the code that performs it. The instruction editor
  // shipped a version of that bug and it took two review passes to find.
  if (pathname === '/api/actions' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, lifecycle.ACTIONS);
    return;
  }

  // ---------------------------------------------------------------------
  // Giving an agent a fresh start: compact, clear, restart.
  //
  // ⚠️ The first routes that reach a RUNNING agent. Everything above edits
  // files an agent reads; these interrupt a live session, and two of the three
  // destroy its conversation, which is where every commitment it is holding
  // lives.
  // ---------------------------------------------------------------------
  const life = pathname.match(/^\/api\/agent\/([^/]+)\/(restart|clear|compact)$/);
  if (life && req.method === 'POST') {
    const name = decodeSegment(life[1]);
    const action = life[2];
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }

    // ⚠️ ONE snapshot for the gate AND the action, and one shared definition of
    // which agent that is.
    //
    // This route asked twice: `knownAgent` took a snapshot to decide the agent
    // exists, and the body handler took another to find the record it acts on.
    // Two shell-outs to `tmux list-panes` plus a transcript read per agent, per
    // click — but the reason to fix it was never the cost. Two reads of one fact
    // opened a window where the agent was present for the gate and gone for the
    // lookup, so `agent` reached `mayTypeInto` as undefined after the route had
    // already decided it was real.
    //
    // Through `findAgent`, which `knownAgent` is now also built on: the first
    // attempt at this fix inlined the lookup here and left the other five routes
    // on `knownAgent`, which solved the double snapshot by creating a second
    // definition of identity — trading this codebase's most common defect for
    // its most common defect.
    const agent = findAgent(name);
    if (!agent) { sendJson(res, 404, { error: 'no agent by that name' }); return; }

    readBody(req)
      .then((buf) => {
        let patch;
        try {
          patch = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          // ⚠️ Carries a code. `errorAnswer` only echoes messages we wrote, and
          // this one had none — so the clearest error on the route came back as
          // 500 "something went wrong here, and we could not tell what". The
          // comment on `errorAnswer` asserted every deliberate throw in this
          // chain sets a code; this was the one that did not, which is exactly
          // how a claim in a comment stops being true.
          const err = new Error('send the request as JSON');
          err.code = 'SAY_WHAT';
          throw err;
        }

        // ⚠️ The caller must say what the dialog SHOWED it was about to
        // destroy, and this refuses if that is no longer true.
        //
        // Same shape as the instruction editor's changed-since-read guard, and
        // for a sharper reason: a dialog listing three commitments, approved
        // twenty minutes later, must not quietly destroy a fourth that arrived
        // in between. The whole point of this screen is that you saw the cost
        // before you paid it, and a cost that changed underneath you was never
        // shown.
        //
        // ⚠️ ALL THREE require it now, compact included.
        //
        // Compact was exempt on the grounds that it loses nothing and that
        // requiring confirmation for a harmless action trains people to click
        // through. The first half was wrong: `/compact` replaces the older
        // conversation with a summary, which is lossy by construction, and this
        // card's premise is that commitments live in the conversation. An
        // action that can lose something must not be the one action that can
        // fire with no evidence the operator saw anything.
        // ⚠️ ONE identity, derived once, used for the check AND the action.
        //
        // This read the RAW name while `perform` acted on the sanitised key, so
        // any alias spelling defeated the confirmation entirely: `/api/agent/
        // PROBE/clear` was refused under `probe` and then cleared `probe`
        // anyway, and the answer reported `holding: {state:"unknown",
        // commitments:[]}` — "a record of the cost actually paid" saying nothing
        // was at stake while three commitments were destroyed. `knownAgent`
        // documents that `ANGEL`, `an.gel` and `ang!el` all reach this route.
        //
        // Two derivations of "which agent" is the defect this codebase has now
        // found in six other places. One here.
        const key = store.safeKey(name);
        const seen = commitments.read(key);
        {
          if (typeof patch.holding !== 'string') {
            const err = new Error('say what you were shown this would lose');
            err.code = 'SAY_WHAT';
            throw err;
          }
          if (patch.holding !== holdingToken(seen)) {
            const err = new Error('what this agent is holding changed since you were shown it, look again before going ahead');
            err.code = 'CONFLICT';
            throw err;
          }
        }

        // ⚠️ A pane we are willing to type into. The roster comes from
        // `tmux list-panes -a`, which is EVERY pane on the machine, so without
        // this `/clear` and Enter could be typed into a plain shell or an
        // editor, where the text is executed rather than read as a command.
        const allowed = lifecycle.mayTypeInto(action, agent);
        if (!allowed.ok) {
          sendJson(res, 409, {
            action,
            outcome: lifecycle.OUTCOME.REFUSED,
            because: allowed.because,
            holding: withToken(seen),
          });
          return;
        }

        const result = lifecycle.perform(action, key, agent && agent.target);

        // ⚠️ Reconcile the record with what we just did to it.
        //
        // `clear` and `restart` destroy the conversation, which is where the
        // agent's memory of its own commitments lives. Leaving the record
        // standing made the board go on asserting those commitments at FULL
        // confidence ("it reported these itself") for the next thirty minutes,
        // about work that no longer exists anywhere. A cleared agent will never
        // correct it either, because it has forgotten it ever said them.
        //
        // Forgotten rather than reported-empty: `report(name, [])` would record
        // the agent saying it holds nothing, and it said no such thing. Removing
        // the record leaves `unknown`, which is the true state — we destroyed
        // what it knew, and we cannot know what it holds until it speaks again.
        // ⚠️ The return value is not discarded. `markDestroyed` returns false
        // rather than throwing, so a tombstone that could not be written failed
        // SILENTLY: the conversation destroyed, the record left standing, and
        // the board serving "it reported these itself" at full confidence for
        // the next thirty minutes with nothing anywhere saying so.
        let reconciled = null;
        // Set when we deliberately left the record alone because this pane is
        // not tied to the name it is filed under. Distinct from a failed write.
        let untied = false;
        if (lifecycle.invalidatesCommitments(action, result)) {
          // ⚠️ Only meaningful when there was a record to reconcile.
          // `markDestroyed` also returns false for an agent that never reported,
          // and warning "we could not update our record" when there was nothing
          // to update makes the sentence useless as a signal for the times it
          // matters.
          const hadRecord = (seen.commitments || []).length > 0 || seen.reportedAt;

          // ⚠️ Only tombstone a record we can tie to the pane we just typed
          // into. The commitment record belongs to whoever owns the NAME; the
          // pane is whatever won that name in the roster. When the winner is a
          // pane we merely INFERRED is an agent (a Claude process in a session
          // whose name does not carry the suffix), those two can be different
          // agents entirely — the real one dead, a stranger's session standing
          // in for it.
          //
          // Marking anyway produces the worst output this board can produce: a
          // confident, false claim that the named agent's commitments were
          // destroyed, while that agent is untouched and still holding them.
          // Leaving the record alone is not a missed cleanup — it is the honest
          // answer, because we did not clear that agent.
          // ⚠️ THREE outcomes, not two, and collapsing the third into `false`
          // made the board say something untrue about itself. `false` means "we
          // tried to write the tombstone and could not", and the sentence built
          // from it says "We could not update our record". Here we did not try,
          // deliberately, because the record is not this pane's to speak for.
          // Reporting a considered refusal as a failed write is the same class
          // of defect as the rest of this branch: a confident sentence about
          // something that did not happen the way it says.
          if (!agent.isNamedOurs) {
            // ⚠️ `hadRecord`, for the same reason the `reconciled === false`
            // path six lines down applies it: saying "we left our record alone"
            // when there is no record asserts one exists. An inferred pane
            // under a name that never reported would otherwise be told about
            // the careful handling of something that was never there.
            // Boolean, not the ISO date `hadRecord` can be — it is serialised now.
            untied = Boolean(hadRecord);
          } else {
            const marked = commitments.markDestroyed(key);
            reconciled = hadRecord ? marked : null;
          }
        }

        // A reconciliation we could not perform is said out loud, appended to
        // the engine's own sentence rather than replacing it: what we did still
        // happened, and this is an additional thing the operator needs to know.
        const because = untied
          // `key`, not `name`: `name` is the raw URL segment, so /WREN/clear
          // would answer "what WREN was holding" about a record filed as `wren`.
          // The route collapsed its identity derivations to one for exactly this
          // reason and this line reintroduced a second.
          ? `${result.because}. We left our record of what ${key} was holding alone, because this session is not the one that agent's own session runs in and we cannot say the record is this pane's to destroy.`
          : reconciled === false
            ? `${result.because}. We could not update our record of what it was holding, so the board may still show it for a while.`
            : result.because;

        sendJson(res, result.outcome === lifecycle.OUTCOME.REFUSED ? 409 : 200, {
          // ⚠️ A FIELD, not only a sentence. This outcome existed solely inside
          // the English composed below, so the only way to pin it was to match
          // that prose — the exact anti-pattern this file condemns elsewhere,
          // because rewording the sentence silently unpins the guard. The
          // browser can also render it now instead of parsing a paragraph.
          untied: Boolean(untied),
          action,
          ...result,
          because,
          reconciled,
          // What it was holding when we acted, so the answer is a record of the
          // cost actually paid rather than of the cost quoted.
          holding: withToken(seen),
        });
      })
      .catch((err) => {
        const answer = errorAnswer(err);
        sendJson(res, answer.status, { error: answer.error });
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
 * It sets roles, stores avatars, edits THE FILE AN AGENT BOOTS FROM, and — as
 * of this branch — RESTARTS, CLEARS AND COMPACTS running agents, which
 * irreversibly destroys a conversation and any work it had agreed to do. There
 * is no authentication of any kind.
 *
 * ⚠️ This block said "Restart is next" while restart shipped in the same diff,
 * and `README.md` points the reader here for "what protects it, and what does
 * not". The one paragraph documenting blast radius understated it, in the
 * commit that widened it.
 *
 * What protects it today: the loopback bind and the Host allowlist below, a
 * cross-site check on every write (`Sec-Fetch-Site`, plus an Origin fallback), a
 * confirmation token that pins what the operator was shown.
 *
 * ⚠️ And what does NOT protect it: anything resembling a login, and — read this
 * before adding it to the list again — there is **no server-side single-flight
 * guard**. This paragraph claimed one for a few commits because I wrote the list
 * and then deleted the guard (see the note above `findAgent`, which explains why
 * it could never fire). The browser's `FRESH_INFLIGHT` is per-tab and a second
 * tab or a curl bypasses it entirely.
 *
 * Two ways that protection is lost, and only the first is obvious:
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
module.exports = { server, start, pathOf, decodeSegment, errorAnswer };
