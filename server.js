'use strict';

/**
 * A local window onto the agents running on this machine.
 *
 * Binds to localhost only, and it WRITES: it stores avatars and roles. It does
 * not yet send input to an agent or start or stop one.
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

function knownAgent(name) {
  try {
    return snapshot().agents.some((a) => a.sessionName === store.safeKey(name));
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
  // ⚠️ This inspects the request TARGET, not the `Host` header, so it is not an
  // origin check and does not stop DNS rebinding: `GET /api/status` with
  // `Host: evil.example` is still answered. That gap is real on an auth-free
  // server and is tracked separately; do not read this guard as protection it
  // does not provide.
  //
  // Checking the parsed host rather than the string shape is deliberate. The
  // obvious guard is `raw.startsWith('//')`, and it does not work: the URL
  // parser treats a backslash as a slash for http, so `/\evil.example/api/status`
  // is authority-form while passing any startsWith check, and resolves to host
  // `evil.example` with pathname `/api/status`. Asserting on what the parser
  // actually produced is the only version that holds, because it tests the
  // property we care about rather than a spelling of it.
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;

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
        commitments: commitments.read(a.sessionName),
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
    sendJson(res, 200, commitments.read(name));
    return;
  }

  if (commits && req.method === 'PUT') {
    const name = decodeSegment(commits[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    readBody(req)
      .then((buf) => {
        const patch = JSON.parse(buf.toString('utf8') || '{}');
        // A bare list is the whole payload: this is an assertion of everything
        // the agent holds, not an addition to it. An append would make "I hold
        // nothing" unsayable, which is the one thing this record exists for.
        if (!Array.isArray(patch.commitments)) {
          throw new Error('send a commitments list, even if it is empty');
        }
        sendJson(res, 200, commitments.report(name, patch.commitments));
      })
      .catch((err) => sendJson(res, 400, { error: String(err.message) }));
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
 * It sets roles and stores avatars, and restart is next. There is no
 * authentication of any kind.
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
module.exports = { server, start, pathOf, decodeSegment };
