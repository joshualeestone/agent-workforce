'use strict';

/**
 * Click-to-connect: install Claude Code and sign it in, from the app.
 *
 * The installer deliberately installs no provider (its own comment block says
 * so): choosing a provider inside the app is what installs it, and the same
 * click signs you in. This module is that click.
 *
 * ⚠️ THE RULE, inherited from the rest of this codebase and load-bearing here
 * more than anywhere: THREE ANSWERS, NOT TWO. This module drives a terminal
 * program it does not control, over a network it does not control. A screen it
 * does not recognise is `stuck` -- carried with `because` and the tail of what
 * the terminal actually shows -- never a guess, never silently retried past,
 * and never rendered as success. `stuck` is not `failed`: the manual path
 * (open Terminal, run claude) always remains, and the UI says so.
 *
 * What this module verified before it was written (2026-08-12, claude
 * v2.1.229, this machine -- the fixture texts in connect.test.js are captures
 * from those runs, per the fixture-discipline rule):
 *
 *   - The official install is three HTTPS GETs: `<base>/latest` (a version
 *     string), `<base>/<version>/manifest.json` (a SHA256 per platform), and
 *     `<base>/<version>/<platform>/claude` (a self-contained binary). Then
 *     `<binary> install` sets up the launcher at ~/.local/bin/claude. No sudo,
 *     no Homebrew.
 *   - A fresh `claude` asks for a theme, then a login method (option 1 is the
 *     subscription login), then OPENS THE BROWSER ITSELF, prints the OAuth URL
 *     as a fallback, and waits at "Paste code here if prompted >". The one
 *     thing the person must do is paste one code, which `send-keys` delivers.
 *
 * ⚠️ WHAT "CONNECTED" MEANS IS NOT THIS MODULE'S OPINION. The finish line is
 * `subscription.check()` flipping to `connected` -- the same reader the rest
 * of the product trusts -- not any sentence scraped off the terminal. The TUI
 * text is used to know what to press, never to declare victory.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const store = require('./store');
const subscription = require('./subscription');

const HOME = os.homedir();

const PHASE = {
  IDLE: 'idle',
  DOWNLOADING: 'downloading',
  INSTALLING: 'installing',
  SIGNIN_LAUNCHING: 'signin-launching',
  SIGNIN_BROWSER_OPEN: 'signin-browser-open',
  SIGNIN_AWAITING_CODE: 'signin-awaiting-code',
  SIGNIN_COMPLETING: 'signin-completing',
  CONNECTED: 'connected',
  STUCK: 'stuck',
  INTERRUPTED: 'interrupted',
};

/**
 * Everything with a side effect is overridable, same convention as `create`
 * and `subscription`: tests and the sandboxed live-verify never touch the
 * operator's real machine.
 */
function downloadBase() {
  return process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE
    || 'https://downloads.claude.ai/claude-code-releases';
}

function claudeBinPath() {
  return process.env.AGENT_WORKFORCE_CLAUDE_BIN
    || path.join(HOME, '.local', 'bin', 'claude');
}

function tmuxBinPath() {
  return process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux';
}

const STATE_FILE = () => path.join(store.ROOT, 'connect.json');

/**
 * The tmux session the sign-in runs in. Ours, disposable, and named so that
 * the board's roster can never mistake it for an agent (agents are adopted by
 * name; nothing creates one called this).
 */
const SESSION = 'kosmos-connect';
/**
 * ⚠️ EVERY `-t` USES THE `=` EXACT-MATCH PREFIX, the same rule remove.js and
 * the README already treat as mandatory. Without it, tmux resolves a target by
 * PREFIX when no exact session exists -- so after our session dies, a
 * kill/capture/send aimed at `kosmos-connect` could land on an agent somebody
 * named `kosmos-connect2`, typing Enter into a Claude running with permissions
 * bypassed. `create.js` also refuses the name outright, but the exact-match
 * pin must not depend on that gate holding forever.
 *
 * ⚠️ TWO SPELLINGS, MEASURED ON tmux 3.6a, because they are not
 * interchangeable: session-targeted commands (kill-session) take `=name`,
 * but PANE-targeted commands (capture-pane, send-keys) REFUSE the bare form
 * with "can't find pane: =name" -- the exact-match pin needs the trailing
 * colon (`=name:`, the session's active window) to resolve. The bare form
 * shipped on the pane commands for one iteration and the LIVE check caught
 * it: every capture failed and the driver reported the window closed while
 * Claude sat there running.
 */
const TARGET = '=' + SESSION;          // session-targeted commands
const PANE_TARGET = '=' + SESSION + ':'; // pane-targeted commands

/* ── the runner seam ─────────────────────────────────────────────────────── */

/**
 * ⚠️ THE SAME BIDIRECTIONAL INTERLOCK AS `engine/create.js`, for the same
 * reason: `setDryRun(false)` refuses unless a runner is installed, and
 * `setRunner(null)` re-arms dry-run, so no ordering of test teardowns leaves a
 * suite able to spawn a real tmux session or execute a real binary.
 */
let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

function setRunner(fn) {
  runner = fn || null;
  if (!runner) DRY_RUN = true;
}
function setDryRun(on) {
  if (!on && !runner) {
    throw new Error('refusing to leave dry-run with no injected runner: this would run real programs');
  }
  DRY_RUN = Boolean(on);
}

/** async execFile, promisified by hand so the seam stays one function. */
function run(file, args, opts) {
  if (runner) return Promise.resolve(runner(file, args, opts));
  if (DRY_RUN) return Promise.resolve({ ok: true, stdout: '', dryRun: true });
  return new Promise((resolve) => {
    const child = execFile(file, args, {
      encoding: 'utf8',
      timeout: (opts && opts.timeout) || 20000,
      env: { ...process.env, ...(opts && opts.env) },
      maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (activeChild === child) activeChild = null;
      if (err) resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
      else resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
    // ⚠️ Held so cancel can KILL it. Without this, cancelling during
    // `claude install` had no handle: the install finished in the background
    // and put a launcher on the machine of somebody who had said stop.
    if (opts && opts.cancellable) activeChild = child;
  });
}

let activeChild = null;

/* ── persisted state ─────────────────────────────────────────────────────── */

/**
 * One JSON file under app data, written atomically like every other record
 * here. It exists for exactly two readers: the UI polling mid-flight, and a
 * server that restarted mid-flight and needs to say "this was interrupted"
 * instead of resuming a driver it no longer has.
 */
let mem = { phase: PHASE.IDLE };

function writeState(next) {
  mem = { ...next, pid: process.pid, updatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    const tmp = `${STATE_FILE()}.${process.pid}.new`;
    fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
    fs.renameSync(tmp, STATE_FILE());
  } catch { /* the in-memory copy still answers; persistence is for restarts */ }
  return mem;
}

function readPersisted() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); }
  catch { return null; }
}

// ⚠️ Hand-copied into web/index.html frConnActive (the page ships as one file
// with no import mechanism). A phase added here must be added there too.
const ACTIVE_PHASES = [
  PHASE.DOWNLOADING, PHASE.INSTALLING, PHASE.SIGNIN_LAUNCHING,
  PHASE.SIGNIN_BROWSER_OPEN, PHASE.SIGNIN_AWAITING_CODE, PHASE.SIGNIN_COMPLETING,
];

/**
 * What the UI should paint. Never throws; not knowing is an answer.
 *
 * ⚠️ A persisted mid-flight phase from ANOTHER pid is `interrupted`, not the
 * phase itself: the driver that owned it died with its process, so reporting
 * `downloading` would be a progress bar nobody is moving -- a screen asserting
 * a state nobody is producing, the exact shape this codebase is built against.
 */
/**
 * Is this persisted record a LIVE flow belonging to another process?
 *
 * ⚠️ Two rules, both earned. "Another pid" is not "a dead pid": a second
 * server sharing this data dir writes live, progressing records, and
 * declaring its flow interrupted from pid inequality alone asserts a death
 * nobody checked -- signal 0 asks the kernel (EPERM = exists, not ours =
 * alive). And a live pid is not proof of a live FLOW: pids get recycled, so
 * "alive" only counts while the record is also fresh -- an hour without a
 * single write is not a flow anybody is running. (Sign-in phases legitimately
 * sit unwritten while a person dawdles in a browser tab, hence an hour and
 * not a minute.) One helper, because `state()` (reporting) and `cancel()`
 * (refusing to destroy) must agree about whose flow it is.
 */
function foreignLiveFlow(disk) {
  if (!disk || !ACTIVE_PHASES.includes(disk.phase) || disk.pid === process.pid) return false;
  let alive = false;
  try { process.kill(disk.pid, 0); alive = true; }
  catch (err) { alive = Boolean(err && err.code === 'EPERM'); }
  // ⚠️ Said explicitly, not through coercion: no timestamp means NOT fresh.
  // The first version leaned on Date.parse(0) happening to read as ancient;
  // an unparseable stamp would have failed OPEN into "live forever".
  if (!disk.updatedAt) return false;
  const ageMs = Date.now() - Date.parse(disk.updatedAt);
  if (!Number.isFinite(ageMs)) return false;
  return alive && ageMs <= 60 * 60 * 1000;
}

function state() {
  if (mem.phase !== PHASE.IDLE) return publicView(mem);
  /**
   * ⚠️ The disk check runs whenever WE are idle, including after a local
   * flow came and went (`startedOnce`): short-circuiting on that flag hid a
   * foreign live flow behind our stale idle -- the board said idle over a
   * sign-in that exists.
   */
  const disk = readPersisted();
  if (disk && ACTIVE_PHASES.includes(disk.phase) && disk.pid !== process.pid) {
    if (foreignLiveFlow(disk)) return publicView(disk);
    return publicView({ ...disk, phase: PHASE.INTERRUPTED, before: disk.phase });
  }
  if (mem.startedOnce) return publicView(mem);
  if (disk && disk.pid !== process.pid
    && (disk.phase === PHASE.CONNECTED || disk.phase === PHASE.STUCK)) {
    return publicView(disk);
  }
  return publicView(mem);
}

function publicView(s) {
  return {
    phase: s.phase,
    before: s.before || null,
    progress: s.progress || null,
    url: s.url || null,
    plan: s.plan || null,
    because: s.because || null,
    tail: s.tail || null,
  };
}

/* ── the download ────────────────────────────────────────────────────────── */

/**
 * Would following this redirect drop from https to http? Pure, so the rule is
 * testable without standing up a TLS server. The manifest these fetches carry
 * holds the checksum everything else is verified against; a downgrade would
 * make "checksum-verified" mean "verified against an attacker-writable value".
 */
function redirectDowngrades(fromUrl, location) {
  try {
    return fromUrl.startsWith('https:') && new URL(location, fromUrl).protocol === 'http:';
  } catch {
    return true; // an unparseable redirect target is not one we follow
  }
}

/** GET a small text/json body, following redirects. */
function fetchText(url, redirects) {
  const left = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
        if (redirectDowngrades(url, res.headers.location)) {
          reject(new Error('the download service redirected to an insecure address, so we stopped'));
          return;
        }
        resolve(fetchText(new URL(res.headers.location, url).toString(), left - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`the download service answered ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 1024 * 1024) { req.destroy(); reject(new Error('answer too large')); } });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.setTimeout(30000, () => { req.destroy(new Error('the download service did not answer in time')); });
    req.on('error', reject);
    // ⚠️ Tracked like the big fetch: a cancel that lands during the /latest or
    // manifest GET must abort it, or download() runs on to fetch 281MB for a
    // flow nobody wants any more.
    activeRequest = req;
  });
}

/** Stream a large file to disk, hashing as it lands, reporting progress. */
function fetchFile(url, dest, onProgress, redirects) {
  const left = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
        if (redirectDowngrades(url, res.headers.location)) {
          reject(new Error('the download service redirected to an insecure address, so we stopped'));
          return;
        }
        resolve(fetchFile(new URL(res.headers.location, url).toString(), dest, onProgress, left - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`the download service answered ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || null;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(dest);
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        hash.update(c);
        if (onProgress) onProgress(got, total);
      });
      res.pipe(out);
      out.on('finish', () => resolve({ sha256: hash.digest('hex'), bytes: got }));
      res.on('error', (e) => { out.destroy(); reject(e); });
      out.on('error', reject);
      activeRequest = req;
    });
    req.setTimeout(600000, () => { req.destroy(new Error('the download stalled')); });
    req.on('error', reject);
    activeRequest = req;
  });
}

let activeRequest = null;

function platformKey() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  return `darwin-${arch}`;
}

/**
 * Fetch, verify, and return the path of a runnable Claude Code binary.
 *
 * ⚠️ NOTHING DOWNLOADED IS EXECUTED BEFORE ITS CHECKSUM MATCHES THE MANIFEST.
 * The partial lands beside its final name and is renamed only after the hash
 * agrees; a mismatch deletes it and reports, because "we ran a binary we could
 * not verify" is not a state this product is allowed to reach.
 *
 * A leftover partial from an interrupted attempt is discarded and restarted
 * rather than resumed: a byte-range resume would hash clean or dirty the same
 * way, but restart is simpler to reason about and the file downloads once
 * (measured: 281MB, 9 seconds on this machine's connection).
 */
async function download(onProgress) {
  const base = downloadBase();
  const version = (await fetchText(`${base}/latest`)).trim();
  /**
   * ⚠️ FULLY ANCHORED, because this string is interpolated into URLs and into
   * the ON-DISK FILENAME. Prefix-only matching would accept
   * `1.2.3/../../anywhere` and steer the write path (of a file that ends up
   * chmod 755) wherever the answer pointed. The service is trusted for the
   * bytes it serves, never for where we put them.
   */
  if (!/^\d+\.\d+\.\d+[A-Za-z0-9.-]*$/.test(version)) {
    throw new Error('the download service did not answer with a version');
  }
  let manifest;
  try { manifest = JSON.parse(await fetchText(`${base}/${version}/manifest.json`)); }
  catch { throw new Error('the download service answered with something we could not read'); }
  const plat = platformKey();
  // Case-normalised: SHA256 hex is hex whichever case the service prints it
  // in, and rejecting uppercase would blame the Mac ("no build for this
  // kind") for what is really a formatting difference.
  const want = String((manifest && manifest.platforms && manifest.platforms[plat]
    && manifest.platforms[plat].checksum) || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(want)) {
    throw new Error(`the download service has no build for this kind of Mac (${plat})`);
  }

  const dir = path.join(store.ROOT, 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `claude-${version}-${plat}`);
  const part = `${dest}.part`;
  try { fs.unlinkSync(part); } catch { /* no partial to discard */ }

  const got = await fetchFile(`${base}/${version}/${plat}/claude`, part, onProgress);
  if (got.sha256 !== want) {
    try { fs.unlinkSync(part); } catch { /* already gone */ }
    throw new Error('the downloaded file did not match its checksum, so it was not kept');
  }
  fs.chmodSync(part, 0o755);
  fs.renameSync(part, dest);
  return { path: dest, version };
}

/* ── the sign-in driver ──────────────────────────────────────────────────── */

/**
 * What screen is the terminal showing? Pure text in, one verdict out, so the
 * whole recogniser set is testable against captured pane text.
 *
 * ⚠️ ORDER MATTERS AND IS DELIBERATE. The pane ACCUMULATES: by the time the
 * paste prompt is up, the login-method text has scrolled but "Opening browser"
 * and the URL may share the screen with it. Later screens are checked first,
 * so the verdict is the furthest state the terminal has reached, not the first
 * sentence that ever matched.
 */
function classifyPane(text) {
  const t = String(text || '');
  // The REPL outranks everything, including "Login successful": it IS the
  // furthest state, and when both share a mid-clear capture, classifying as
  // repl routes the unreadable-subscription case to its fast honest exit
  // (8s) instead of the 60s catch-up wait.
  if (/\? for shortcuts/.test(t)) return { kind: 'repl' };
  if (/Login successful|Logged in as/i.test(t)) return { kind: 'login-done' };
  if (/Paste code here/i.test(t)) {
    const url = extractOauthUrl(t);
    return { kind: 'awaiting-code', url };
  }
  if (/Opening browser to sign in|Use the url below to sign in/i.test(t)) {
    return { kind: 'browser-open', url: extractOauthUrl(t) };
  }
  if (/Select login method/i.test(t)) return { kind: 'login-method' };
  if (/Choose the text style/i.test(t)) return { kind: 'theme' };
  if (/Press Enter to continue/i.test(t)) return { kind: 'press-enter' };
  if (!t.trim()) return { kind: 'blank' };
  return { kind: 'unknown', tail: tailOf(t) };
}

/**
 * The pane wraps long lines even with `-J` when the URL exceeds the pane
 * width, so the URL is reassembled from the line that starts it plus any
 * continuation lines that look like more URL and not like prose.
 */
function extractOauthUrl(text) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/https:\/\/\S*oauth\S*/i);
    if (!m) continue;
    let url = m[0];
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j].trim();
      if (/^[A-Za-z0-9%&=_.~+#?/-]+$/.test(cont) && cont.length > 0 && !/^Paste/i.test(cont)) {
        url += cont;
      } else break;
    }
    return url;
  }
  return null;
}

function tailOf(text) {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  return lines.slice(-12).join('\n');
}

/* tmux, through the seam */
async function tmux(args, opts) {
  return run(tmuxBinPath(), args, opts);
}

async function killSession() {
  await tmux(['kill-session', '-t', TARGET]);
}

/**
 * The in-process driver. One at a time; `start` while one is alive reports
 * the live state rather than starting a second.
 */
let driver = null;   // { timer, pendingCode, lastActed, unknownTicks, ... }
let TICK_MS = 700;
let UNKNOWN_GRACE_MS = 10000;
function setTickInterval(ms) { TICK_MS = ms; }
function setUnknownGrace(ms) { UNKNOWN_GRACE_MS = ms; }

/**
 * ⚠️ Codes are typed into a terminal by us on the user's behalf, so they are
 * validated like the untrusted input they are: one token, no whitespace, no
 * control characters. `send-keys -l` sends the text literally (no key-name
 * interpretation), and the charset check is belt on top of that brace.
 */
function validCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9#_.~/+=-]{6,512}$/.test(code);
}

async function start() {
  if (driver) return state();

  /**
   * ⚠️ THE SAME FOREIGN-FLOW REFUSAL AS `cancel()`, because start is a write
   * path too: without it, a start POSTed to the non-owning server clobbered
   * the owner's live record with IDLE and then killed the shared-named
   * session out from under the owning flow. All three of state/cancel/start
   * now agree about whose flow it is, through one helper.
   */
  const disk = readPersisted();
  if (foreignLiveFlow(disk)) return publicView(disk);

  /**
   * ⚠️ No "already connected" memo here: the subscription check below IS the
   * guard, and it reads reality. A memoed CONNECTED would refuse to reconnect
   * somebody whose connection broke after the first success -- a long-lived
   * server remembering a state the machine has left.
   */
  writeState({ phase: PHASE.IDLE, startedOnce: true });

  /**
   * Already connected? Then the click's whole job is telling them so. This is
   * also what makes `start` safely idempotent across interruptions: every
   * resume walks the same checks and skips what is already true.
   */
  const sub = subscription.check();
  if (sub.state === subscription.STATE.CONNECTED) {
    return publicView(writeState({ phase: PHASE.CONNECTED, plan: sub.plan, startedOnce: true }));
  }

  const bin = claudeBinPath();
  let haveBinary = false;
  try { fs.accessSync(bin, fs.constants.X_OK); haveBinary = true; } catch { /* not installed yet */ }

  /**
   * ⚠️ EVERY ASYNC ARM OF A FLOW CARRIES ITS OWNING DRIVER, and teardown
   * compares IDENTITY, not existence. The defect this closes: work parked on
   * an await belonged to a flow that was cancelled, a fresh `start` installed
   * a NEW driver during the cancel's own awaits, and the stale work's failure
   * then saw "a driver exists" and tore down the healthy new flow. `!driver`
   * cannot distinguish "cancelled" from "replaced"; `driver !== owner` can.
   */
  const owner = { pendingCode: null, lastActed: null, acted: null, unknownTicks: 0 };
  driver = owner;

  runFlow(owner, haveBinary).catch((err) => {
    becomeStuck(owner, 'something went wrong that we did not plan for', String((err && err.message) || err));
  });
  return state();
}

async function runFlow(owner, haveBinary) {
  if (!haveBinary) {
    writeState({ phase: PHASE.DOWNLOADING, progress: { got: 0, total: null }, startedOnce: true });
    let downloaded;
    try {
      let lastProgressWrite = 0;
      downloaded = await download((got, total) => {
        if (mem.phase !== PHASE.DOWNLOADING) return;
        // ⚠️ Throttled: this fires per network chunk, and writeState is a
        // synchronous write+rename. Unthrottled that is thousands of disk
        // writes for one 281MB file, to persist a number the UI polls once a
        // second. The final size still lands: the phase change to INSTALLING
        // writes, and the poll reads the in-memory copy anyway.
        const now = Date.now();
        if (now - lastProgressWrite < 250) {
          mem.progress = { got, total };
          return;
        }
        lastProgressWrite = now;
        writeState({ ...mem, progress: { got, total } });
      });
    } catch (err) {
      // A death mid-stream leaves a .part behind, and a retry only sweeps the
      // SAME version's partial -- a version bump between attempts would
      // strand up to ~281MB that nothing else ever cleans. Sweep them all.
      // ⚠️ ONLY IF THIS FLOW STILL OWNS THE DIR: a stale flow's late network
      // rejection must not delete the .part a successor flow is mid-writing
      // -- the same guard cancel's own sweep carries, for the same reason.
      // (This sweep shipped one iteration without the guard: the fix for the
      // stranded-partial NIT introduced the race, found on the next pass.)
      if (driver === owner) {
        try {
          const dir = path.join(store.ROOT, 'downloads');
          for (const f of fs.readdirSync(dir)) {
            if (f.endsWith('.part')) fs.unlinkSync(path.join(dir, f));
          }
        } catch { /* nothing partial to clean */ }
      }
      becomeStuck(owner, 'we could not download Claude', String((err && err.message) || err));
      return;
    }
    if (driver !== owner) {
      // Cancelled (or replaced), but the download had already finished: a
      // verified 281MB binary is on disk for a flow nobody wants. Cancel's
      // contract is "own nothing half-claimed", and this is the window its
      // cleanup cannot see.
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      return;
    }

    writeState({ phase: PHASE.INSTALLING, startedOnce: true });
    const inst = await run(downloaded.path, ['install'], { timeout: 180000, env: { TERM: 'dumb' }, cancellable: true });
    if (driver !== owner) {
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      return;
    }
    if (!inst.ok) {
      // ⚠️ The binary goes too: a stuck install otherwise strands 281MB per
      // attempted version in app data, which is exactly what the deletion on
      // the success path below exists to prevent. A retry re-downloads in
      // seconds; the disk does not get the file back on its own.
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      becomeStuck(owner, 'Claude downloaded but did not finish setting itself up',
        tailOf(`${inst.stdout || ''}\n${inst.stderr || ''}`) || 'it stopped without saying why');
      return;
    }
    try { fs.accessSync(claudeBinPath(), fs.constants.X_OK); }
    catch {
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      becomeStuck(owner, 'Claude said it set itself up, but we cannot find it where it should be',
        `expected it at ${claudeBinPath()}`);
      return;
    }
    // The verified download did its job; the installed launcher is what runs
    // from here. The official install script deletes its download too, and
    // keeping ours means ~281MB per version quietly accumulating in app data.
    try { fs.unlinkSync(downloaded.path); } catch { /* disk hygiene, not correctness */ }
  }
  if (driver !== owner) return;
  await launchSignin(owner);
}

async function launchSignin(owner) {
  if (driver !== owner) return; // cancelled before the sign-in ever launched
  writeState({ phase: PHASE.SIGNIN_LAUNCHING, startedOnce: true });

  // A leftover session from an interrupted attempt would be showing a stale
  // screen; start clean instead of guessing where it was.
  await killSession();

  /**
   * ⚠️ DELIBERATELY UNQUOTED, and that is a measurement, not an oversight.
   * A review pass argued these needed shell-quoting ("tmux joins with spaces
   * and runs through a shell"); quoting was tried, and the LIVE check caught
   * it killing the launch outright -- with MULTIPLE arguments this tmux
   * (3.6a) executes them as argv, so added quotes become literal characters
   * in the filename, while a space inside a value already survives unquoted
   * (measured: an env value containing "dir with space" launched fine, the
   * quoted form died instantly). Single-argument commands are the form that
   * goes through a shell; keep this multi-arg and keep it bare.
   */
  const cmd = [];
  if (process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR) {
    cmd.push('env', `CLAUDE_CONFIG_DIR=${process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR}`);
  }
  cmd.push(claudeBinPath());

  const made = await tmux(['new-session', '-d', '-s', SESSION, '-x', '220', '-y', '50', ...cmd]);
  if (!made.ok) {
    becomeStuck(owner, 'we could not open the window Claude signs in through',
      tailOf(`${made.stdout || ''}\n${made.stderr || ''}`) || 'tmux would not start');
    return;
  }
  if (driver !== owner) { await killSession(); return; }
  owner.timer = setInterval(() => { tick(owner).catch(() => { /* next tick retries */ }); }, TICK_MS);
}

/**
 * One look at the pane, one decision. The guard on `lastActed` means a screen
 * is acted on ONCE: a second Enter on the theme screen would land on the next
 * screen and pick whatever was under the cursor.
 */
async function tick(owner) {
  if (driver !== owner) return;
  // ⚠️ ONE tick in flight at a time. The interval fires on schedule whether
  // or not the previous capture came back; a slow tmux otherwise stacks
  // concurrent capture children until their 20s timeouts drain.
  if (owner.ticking) return;
  owner.ticking = true;
  try {
    await tickBody(owner);
  } finally {
    owner.ticking = false;
  }
}

async function tickBody(owner) {
  /**
   * ⚠️ HEARTBEAT. State is otherwise written only on phase changes, so a
   * flow legitimately parked at the paste prompt for over an hour would go
   * stale under the freshness bound -- and a second server would then treat
   * the LIVE flow as interrupted and cancel could kill it. The owning driver
   * proves it is alive by touching the record every few minutes.
   */
  if (mem.pid === process.pid && ACTIVE_PHASES.includes(mem.phase)) {
    const age = Date.now() - Date.parse(mem.updatedAt || 0);
    if (Number.isFinite(age) && age > 5 * 60 * 1000) writeState({ ...mem });
  }
  const cap = await tmux(['capture-pane', '-p', '-J', '-t', PANE_TARGET]);
  if (driver !== owner) return; // cancelled or replaced while we were looking
  if (!cap.ok) {
    becomeStuck(owner, 'the sign-in window closed before Claude finished',
      tailOf(cap.stderr || '') || 'it is no longer there');
    return;
  }
  const seen = classifyPane(cap.stdout);

  if (seen.kind === 'unknown') {
    driver.unknownTicks += 1;
    // ⚠️ A grace period, not tolerance: the TUI redraws between screens and a
    // capture can land mid-paint. ~10s of never recognising anything is a
    // different fact, and it is reported rather than waited out forever.
    if (driver.unknownTicks > Math.max(3, Math.ceil(UNKNOWN_GRACE_MS / TICK_MS))) {
      becomeStuck(owner, 'Claude showed a screen we do not recognise', seen.tail);
    }
    return;
  }
  driver.unknownTicks = 0;
  // ⚠️ NOT reset on blank itself -- the first version of this line ran for
  // every classification including 'blank', so the counter it exists to feed
  // was zeroed on the very tick that incremented it and the escalation could
  // never fire. Caught by the test timing out, not by reading the diff.
  if (seen.kind !== 'blank') driver.blankTicks = 0;

  /**
   * ⚠️ ACT ONCE PER SCREEN, where "screen" is the kind plus the text itself.
   * A guard keyed on kind alone acted once per KIND: the second of two
   * consecutive "Press Enter to continue" screens never got its Enter and the
   * flow sat there. The screens this driver presses keys on are static (no
   * spinner frames), so their text is a stable identity.
   */
  const sig = `${seen.kind}:${crypto.createHash('sha1').update(tailOf(cap.stdout)).digest('hex').slice(0, 12)}`;

  /**
   * ⚠️ A RECOGNISED SCREEN THAT NEVER MOVES IS A THIRD KIND OF HANG. Unknown
   * screens get 10s and blank panes 45s, but a theme screen that we pressed
   * Enter on and that keeps sitting there had NO bound at all -- "Getting
   * the sign-in ready" forever over a wedged CLI. Only the choosing screens
   * count: the paste prompt and the browser wait legitimately sit unchanged
   * for as long as a person dawdles.
   */
  if (seen.kind === 'theme' || seen.kind === 'login-method') {
    if (sig === driver.lastSig) {
      driver.sameTicks = (driver.sameTicks || 0) + 1;
      if (driver.acted === sig && driver.sameTicks > Math.max(5, Math.ceil((UNKNOWN_GRACE_MS * 6) / TICK_MS))) {
        becomeStuck(owner, 'Claude is not moving past its first screens', tailOf(cap.stdout));
        return;
      }
    } else {
      driver.sameTicks = 0;
    }
  } else {
    driver.sameTicks = 0;
  }
  driver.lastSig = sig;

  switch (seen.kind) {
    case 'blank':
      /**
       * ⚠️ A PERMANENTLY BLANK PANE IS AN ANSWER TOO. Blanks are legitimate
       * between screens, so the grace is generous -- but a Claude that clears
       * the screen and hangs must not leave "Getting the sign-in ready" on
       * screen forever, which is progress nobody is producing.
       */
      driver.blankTicks = (driver.blankTicks || 0) + 1;
      // 4.5x the unknown grace (45s in production): blanks are legitimate
      // between screens, so the bound is generous -- but it exists.
      if (driver.blankTicks > Math.max(5, Math.ceil((UNKNOWN_GRACE_MS * 4.5) / TICK_MS))) {
        becomeStuck(owner, 'Claude never drew its sign-in screen', 'the window stayed blank');
      }
      return;
    case 'theme':
      if (driver.acted !== sig) {
        driver.acted = sig;
        await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
      }
      return;
    case 'login-method':
      if (driver.acted !== sig) {
        driver.acted = sig;
        // Option 1, "Claude account with subscription", is already selected.
        await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
      }
      return;
    case 'browser-open':
      if (mem.phase !== PHASE.SIGNIN_BROWSER_OPEN) {
        writeState({ phase: PHASE.SIGNIN_BROWSER_OPEN, url: seen.url || null, startedOnce: true });
      } else if (seen.url && !mem.url) {
        writeState({ ...mem, url: seen.url });
      }
      return;
    case 'awaiting-code': {
      /**
       * ⚠️ A PASTE PROMPT AFTER A CODE WAS TYPED MEANS THE CODE DID NOT TAKE.
       * Without this arm the phase sat at `signin-completing` forever while
       * the terminal literally asked for another code and `submitCode`
       * refused to accept one -- "Finishing the sign-in…" on a screen nobody
       * was finishing, the exact shape this codebase bans. The grace covers
       * the CLI's processing time (the prompt stays up briefly after Enter).
       */
      if (mem.phase === PHASE.SIGNIN_COMPLETING) {
        driver.rejectTicks = (driver.rejectTicks || 0) + 1;
        if (driver.rejectTicks > Math.max(3, Math.ceil(6000 / TICK_MS))) {
          driver.rejectTicks = 0;
          driver.lastActed = null;   // a new code may be typed
          writeState({
            phase: PHASE.SIGNIN_AWAITING_CODE,
            url: seen.url || mem.url || null,
            // ⚠️ Two ways to arrive here, two different true sentences.
            // "Completing" can be reached with no code ever typed (login text
            // seen from the browser flow, then the CLI re-prompted) -- telling
            // that person to re-paste a code they never had is a small lie.
            because: driver.codeTyped
              ? 'that code did not work, so check it and paste it again'
              : 'the sign-in did not finish on its own, so paste the code from your browser here',
            startedOnce: true,
          });
        }
        return;
      }
      driver.rejectTicks = 0;
      if (mem.phase !== PHASE.SIGNIN_AWAITING_CODE) {
        writeState({ phase: PHASE.SIGNIN_AWAITING_CODE, url: seen.url || mem.url || null, startedOnce: true });
      }
      if (driver.pendingCode && driver.lastActed !== 'code') {
        driver.lastActed = 'code';
        driver.codeTyped = true;
        const code = driver.pendingCode;
        driver.pendingCode = null;
        // ⚠️ `--` ends option parsing: the allowed charset includes `-`, and a
        // code starting with one would otherwise be read by tmux as flags.
        const typed = await tmux(['send-keys', '-t', PANE_TARGET, '-l', '--', code]);
        const entered = typed.ok ? await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']) : typed;
        // ⚠️ The one post-await write in this module that shipped WITHOUT the
        // owner re-check: a cancel landing between the sends and this line
        // overwrote the person's IDLE with a driverless "completing" record
        // that nothing would ever advance.
        if (driver !== owner) return;
        if (!typed.ok || !entered.ok) {
          becomeStuck(owner, 'we could not type the code into the sign-in',
            tailOf(`${typed.stderr || ''}\n${entered.stderr || ''}`) || 'the sign-in window did not take it');
          return;
        }
        writeState({ phase: PHASE.SIGNIN_COMPLETING, url: mem.url || null, startedOnce: true });
      }
      return;
    }
    case 'login-done':
    case 'press-enter':
    case 'repl': {
      /**
       * ⚠️ THE FINISH LINE IS THE CONFIG, NOT THE TEXT. `check()` fresh, not
       * `checkCached()`: the cache exists for the 5-second status tick, and
       * here a stale `none` would hold the screen at "completing" after the
       * login already landed.
       */
      const sub = subscription.check();
      /**
       * ⚠️ "ASKS FOR ENTER" IS A PROPERTY OF THE TEXT, NOT OF THE VERDICT.
       * The real post-login screen says BOTH "Login successful" and "Press
       * Enter to continue", and classifies as login-done (the further state)
       * -- so a guard keyed on kind === 'press-enter' never fired on the very
       * screen that asks, and the walk-forward this comment promises never
       * happened.
       */
      const asksEnter = /Press Enter to continue/i.test(cap.stdout);
      if (sub.state === subscription.STATE.CONNECTED) {
        // Claude may still be mid-onboarding in the pane (security notes and
        // the like). Walk it forward so the NEXT run of claude -- an agent's
        // first start -- does not begin at a screen nobody is watching.
        if (asksEnter && driver.acted !== sig) {
          driver.acted = sig;
          await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
          return;
        }
        // ⚠️ Its OWN counter: sharing it with the config-catch-up wait meant
        // a late-flipping config finished on the next tick and killed the
        // session mid-onboarding, skipping the walk-forward this comment
        // promises.
        if (seen.kind === 'repl' || (driver.settleTicks || 0) > 4) {
          await finishConnected(owner, sub);
          return;
        }
        driver.settleTicks = (driver.settleTicks || 0) + 1;
        return;
      }
      if (asksEnter && driver.acted !== sig) {
        driver.acted = sig;
        await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
        return;
      }
      /**
       * ⚠️ LOGIN EVIDENCE CAN ARRIVE FROM ANY SIGN-IN PHASE, not just after a
       * pasted code -- the browser flow can complete on its own. Without
       * this, "Login successful" seen while the phase was still
       * `signin-browser-open` fell into no arm at all and the driver looped
       * forever at "will notice when it is done", noticing nothing.
       *
       * ⚠️ AND "Press Enter to continue" ALONE IS NOT LOGIN EVIDENCE: a
       * pre-login announcement screen carries no login at all, and advancing
       * on it painted "Finishing the sign-in" before sign-in began. Only the
       * screens that SAY logged-in (login-done, or a live REPL) advance.
       */
      if ((seen.kind === 'login-done' || seen.kind === 'repl')
        && (mem.phase === PHASE.SIGNIN_BROWSER_OPEN || mem.phase === PHASE.SIGNIN_AWAITING_CODE
          || mem.phase === PHASE.SIGNIN_LAUNCHING)) {
        writeState({ phase: PHASE.SIGNIN_COMPLETING, url: mem.url || null, startedOnce: true });
        return;
      }
      if (mem.phase === PHASE.SIGNIN_COMPLETING) {
        /**
         * ⚠️ A REPL WITHOUT A READABLE SUBSCRIPTION IS AN ANSWER, not a wait
         * state: Claude is running and signed in as far as it is concerned,
         * and our reader cannot confirm the plan. Waiting the full minute is
         * for the settings file catching up after a login; a live REPL means
         * it already wrote what it was going to write.
         */
        if (seen.kind === 'repl') {
          driver.replTicks = (driver.replTicks || 0) + 1;
          if (driver.replTicks > Math.max(3, Math.ceil(8000 / TICK_MS))) {
            becomeStuck(owner, 'Claude looks signed in here, but we could not confirm a subscription',
              sub.because || 'the settings on this computer do not say which plan it is on');
            return;
          }
        }
        // Text says logged in but the config has not flipped yet; give it a
        // bounded wait rather than forever. Its OWN counter, distinct from
        // the post-connected settle above.
        driver.waitTicks = (driver.waitTicks || 0) + 1;
        if (driver.waitTicks > Math.ceil(60000 / TICK_MS)) {
          becomeStuck(owner, 'Claude says it signed in, but we cannot see the connection yet',
            'the settings file has not caught up; Check again in a moment, or try once more');
        }
      }
      return;
    }
    default:
  }
}

async function finishConnected(owner, sub) {
  if (driver !== owner) return;
  const d = driver;
  driver = null;
  if (d && d.timer) clearInterval(d.timer);
  await killSession();
  writeState({ phase: PHASE.CONNECTED, plan: sub.plan || null, startedOnce: true });
}

function becomeStuck(owner, because, tail) {
  /**
   * ⚠️ ONLY THE OWNING FLOW MAY DECLARE ITSELF STUCK. Every path that lands
   * here crossed an `await`, and during it the flow may have been CANCELLED
   * (driver null) or REPLACED by a fresh start (driver is somebody else). A
   * person who deliberately cancelled must not later find a STUCK record
   * written by the very request their cancel aborted, and a stale flow's
   * failure must never tear down the healthy flow that superseded it --
   * existence checks cannot tell those apart; identity can.
   */
  if (!driver || driver !== owner) return;
  const d = driver;
  driver = null;
  if (d && d.timer) clearInterval(d.timer);
  if (activeRequest) { try { activeRequest.destroy(); } catch { /* already ended */ } activeRequest = null; }
  if (activeChild) { try { activeChild.kill(); } catch { /* already exited */ } activeChild = null; }
  killSession().catch(() => { /* it may never have existed */ });
  writeState({ phase: PHASE.STUCK, because, tail: tail || null, startedOnce: true });
}

/**
 * The user pasted a code. Accepted only while the terminal is actually
 * waiting for one; anything else is refused with the reason, because typing
 * into a screen that is not asking is how a driver corrupts a flow.
 */
function submitCode(code) {
  // `kind` lets the route pick the right refusal status: 'state' conflicts
  // are 409s (right code, wrong moment); 'format' is a 400 (bad input).
  if (!driver) {
    /**
     * ⚠️ THE FOREIGN-FLOW SENTENCE MUST BE TRUE. state() on this server
     * reports the other server's live paste prompt, so the UI renders a
     * paste box -- and "the sign-in is not running" is then false. Say what
     * is actually happening and where the code has to go.
     */
    if (foreignLiveFlow(readPersisted())) {
      return {
        ok: false,
        kind: 'state',
        because: 'this sign-in is running under another Kosmos window on this computer, so paste the code there',
      };
    }
    return { ok: false, kind: 'state', because: 'the sign-in is not running, so there is nowhere to put that code' };
  }
  if (mem.phase !== PHASE.SIGNIN_AWAITING_CODE) {
    return { ok: false, kind: 'state', because: 'Claude is not asking for a code right now' };
  }
  if (!validCode(code)) {
    return { ok: false, kind: 'format', because: 'that does not look like a sign-in code' };
  }
  driver.pendingCode = code;
  return { ok: true };
}

/** Stop everything, clean up everything we made, own nothing half-claimed. */
async function cancel() {
  /**
   * ⚠️ NOT OURS TO CANCEL. `state()` deliberately reports a second server's
   * live flow as it stands; a cancel POSTed to THIS server must then refuse
   * to kill that flow's session, sweep its downloads, and write IDLE over
   * its record -- otherwise the reporting side supports a scenario the
   * destructive side corrupts. With no local driver, a fresh mid-flight
   * record from a live foreign pid stays that flow's property. (A dead or
   * stale record still gets cleaned: that is the orphan case cancel exists
   * for.)
   */
  if (!driver) {
    // Read ONCE: the owning process can replace the file between two reads,
    // and a second read coming back null would throw inside publicView.
    const disk = readPersisted();
    if (foreignLiveFlow(disk)) return publicView(disk);
  }
  const d = driver;
  driver = null;
  if (d && d.timer) clearInterval(d.timer);
  if (activeRequest) { try { activeRequest.destroy(); } catch { /* already ended */ } activeRequest = null; }
  if (activeChild) { try { activeChild.kill(); } catch { /* already exited */ } activeChild = null; }
  await killSession();
  /**
   * ⚠️ A FRESH FLOW MAY HAVE STARTED DURING THE AWAIT ABOVE. Everything past
   * this line belongs to whoever owns `driver` NOW: sweeping the downloads
   * dir would delete the new flow's in-flight .part, and writing IDLE would
   * clobber its live record. The new flow owns the state; this cancel is
   * done. (Residual, documented: the killSession above may have killed a
   * session the new flow just made -- its driver then reports "the sign-in
   * window closed", an honest failure, never silent corruption.)
   */
  if (driver) return state();
  try {
    /**
     * ⚠️ Partials AND finished downloads. A verified binary is only useful to
     * the flow that fetched it; after a cancel it is 281MB of somebody's disk
     * spent on a thing they said no to.
     */
    const dir = path.join(store.ROOT, 'downloads');
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.part') || f.startsWith('claude-')) fs.unlinkSync(path.join(dir, f));
    }
  } catch { /* nothing to clean */ }
  // publicView like every other exit: the raw record carries pid/updatedAt/
  // startedOnce, which no HTTP answer elsewhere leaks.
  return publicView(writeState({ phase: PHASE.IDLE, startedOnce: true }));
}

/** Tests only: forget everything without touching disk records. */
function resetForTests() {
  if (driver && driver.timer) clearInterval(driver.timer);
  driver = null;
  activeRequest = null;
  mem = { phase: PHASE.IDLE };
}

module.exports = {
  PHASE, SESSION, ACTIVE_PHASES,
  state, start, submitCode, cancel,
  classifyPane, extractOauthUrl, tailOf, validCode, redirectDowngrades,
  download, platformKey,
  setRunner, setDryRun, setTickInterval, setUnknownGrace, resetForTests,
  STATE_FILE,
};
