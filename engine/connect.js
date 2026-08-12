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
    execFile(file, args, {
      encoding: 'utf8',
      timeout: (opts && opts.timeout) || 20000,
      env: { ...process.env, ...(opts && opts.env) },
      maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
      else resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

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
function state() {
  if (mem.phase !== PHASE.IDLE || mem.startedOnce) return publicView(mem);
  const disk = readPersisted();
  if (disk && ACTIVE_PHASES.includes(disk.phase) && disk.pid !== process.pid) {
    return publicView({ ...disk, phase: PHASE.INTERRUPTED, before: disk.phase });
  }
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

/** GET a small text/json body, following redirects. */
function fetchText(url, redirects) {
  const left = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
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
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error('the download service did not answer with a version');
  }
  let manifest;
  try { manifest = JSON.parse(await fetchText(`${base}/${version}/manifest.json`)); }
  catch { throw new Error('the download service answered with something we could not read'); }
  const plat = platformKey();
  const want = manifest && manifest.platforms && manifest.platforms[plat]
    && manifest.platforms[plat].checksum;
  if (!want || !/^[a-f0-9]{64}$/.test(want)) {
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
  if (/\? for shortcuts/.test(t)) return { kind: 'repl' };
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
  await tmux(['kill-session', '-t', SESSION]);
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
    return writeState({ phase: PHASE.CONNECTED, plan: sub.plan, startedOnce: true });
  }

  const bin = claudeBinPath();
  let haveBinary = false;
  try { fs.accessSync(bin, fs.constants.X_OK); haveBinary = true; } catch { /* not installed yet */ }

  driver = { pendingCode: null, lastActed: null, acted: null, unknownTicks: 0, quietTicks: 0 };

  runFlow(haveBinary).catch((err) => {
    becomeStuck('something went wrong that we did not plan for', String((err && err.message) || err));
  });
  return state();
}

async function runFlow(haveBinary) {
  if (!haveBinary) {
    writeState({ phase: PHASE.DOWNLOADING, progress: { got: 0, total: null }, startedOnce: true });
    let downloaded;
    try {
      downloaded = await download((got, total) => {
        if (mem.phase === PHASE.DOWNLOADING) {
          writeState({ ...mem, progress: { got, total } });
        }
      });
    } catch (err) {
      becomeStuck('we could not download Claude', String((err && err.message) || err));
      return;
    }
    if (!driver) return; // cancelled mid-download

    writeState({ phase: PHASE.INSTALLING, startedOnce: true });
    const inst = await run(downloaded.path, ['install'], { timeout: 180000, env: { TERM: 'dumb' } });
    if (!inst.ok) {
      becomeStuck('Claude downloaded but did not finish setting itself up',
        tailOf(`${inst.stdout || ''}\n${inst.stderr || ''}`) || 'it stopped without saying why');
      return;
    }
    try { fs.accessSync(claudeBinPath(), fs.constants.X_OK); }
    catch {
      becomeStuck('Claude said it set itself up, but we cannot find it where it should be',
        `expected it at ${claudeBinPath()}`);
      return;
    }
  }
  if (!driver) return;
  await launchSignin();
}

async function launchSignin() {
  writeState({ phase: PHASE.SIGNIN_LAUNCHING, startedOnce: true });

  // A leftover session from an interrupted attempt would be showing a stale
  // screen; start clean instead of guessing where it was.
  await killSession();

  const cmd = [];
  if (process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR) {
    cmd.push('env', `CLAUDE_CONFIG_DIR=${process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR}`);
  }
  cmd.push(claudeBinPath());

  const made = await tmux(['new-session', '-d', '-s', SESSION, '-x', '220', '-y', '50', ...cmd]);
  if (!made.ok) {
    becomeStuck('we could not open the window Claude signs in through',
      tailOf(`${made.stdout || ''}\n${made.stderr || ''}`) || 'tmux would not start');
    return;
  }
  if (!driver) { await killSession(); return; }
  driver.timer = setInterval(() => { tick().catch(() => { /* next tick retries */ }); }, TICK_MS);
}

/**
 * One look at the pane, one decision. The guard on `lastActed` means a screen
 * is acted on ONCE: a second Enter on the theme screen would land on the next
 * screen and pick whatever was under the cursor.
 */
async function tick() {
  if (!driver) return;
  const cap = await tmux(['capture-pane', '-p', '-J', '-t', SESSION]);
  if (!cap.ok) {
    becomeStuck('the sign-in window closed before Claude finished',
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
      becomeStuck('Claude showed a screen we do not recognise', seen.tail);
    }
    return;
  }
  driver.unknownTicks = 0;

  /**
   * ⚠️ ACT ONCE PER SCREEN, where "screen" is the kind plus the text itself.
   * A guard keyed on kind alone acted once per KIND: the second of two
   * consecutive "Press Enter to continue" screens never got its Enter and the
   * flow sat there. The screens this driver presses keys on are static (no
   * spinner frames), so their text is a stable identity.
   */
  const sig = `${seen.kind}:${crypto.createHash('sha1').update(tailOf(cap.stdout)).digest('hex').slice(0, 12)}`;

  switch (seen.kind) {
    case 'blank':
      return;
    case 'theme':
      if (driver.acted !== sig) {
        driver.acted = sig;
        await tmux(['send-keys', '-t', SESSION, 'Enter']);
      }
      return;
    case 'login-method':
      if (driver.acted !== sig) {
        driver.acted = sig;
        // Option 1, "Claude account with subscription", is already selected.
        await tmux(['send-keys', '-t', SESSION, 'Enter']);
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
      if (mem.phase !== PHASE.SIGNIN_AWAITING_CODE && mem.phase !== PHASE.SIGNIN_COMPLETING) {
        writeState({ phase: PHASE.SIGNIN_AWAITING_CODE, url: seen.url || mem.url || null, startedOnce: true });
      }
      if (driver.pendingCode && driver.lastActed !== 'code') {
        driver.lastActed = 'code';
        const code = driver.pendingCode;
        driver.pendingCode = null;
        await tmux(['send-keys', '-t', SESSION, '-l', code]);
        await tmux(['send-keys', '-t', SESSION, 'Enter']);
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
      if (sub.state === subscription.STATE.CONNECTED) {
        // Claude may still be mid-onboarding in the pane (security notes and
        // the like). Walk it forward so the NEXT run of claude -- an agent's
        // first start -- does not begin at a screen nobody is watching.
        if (seen.kind === 'press-enter' && driver.acted !== sig) {
          driver.acted = sig;
          await tmux(['send-keys', '-t', SESSION, 'Enter']);
          return;
        }
        if (seen.kind === 'repl' || driver.quietTicks > 4) {
          await finishConnected(sub);
          return;
        }
        driver.quietTicks += 1;
        return;
      }
      if (seen.kind === 'press-enter' && driver.acted !== sig) {
        driver.acted = sig;
        await tmux(['send-keys', '-t', SESSION, 'Enter']);
        return;
      }
      if (mem.phase === PHASE.SIGNIN_COMPLETING) {
        // Text says logged in but the config has not flipped yet; give it a
        // bounded wait rather than forever.
        driver.quietTicks += 1;
        if (driver.quietTicks > Math.ceil(60000 / TICK_MS)) {
          becomeStuck('Claude says it signed in, but we cannot see the connection yet',
            'the settings file has not caught up; Check again in a moment, or try once more');
        }
      }
      return;
    }
    default:
  }
}

async function finishConnected(sub) {
  const d = driver;
  driver = null;
  if (d && d.timer) clearInterval(d.timer);
  await killSession();
  writeState({ phase: PHASE.CONNECTED, plan: sub.plan || null, startedOnce: true });
}

function becomeStuck(because, tail) {
  const d = driver;
  driver = null;
  if (d && d.timer) clearInterval(d.timer);
  if (activeRequest) { try { activeRequest.destroy(); } catch { /* already ended */ } activeRequest = null; }
  killSession().catch(() => { /* it may never have existed */ });
  writeState({ phase: PHASE.STUCK, because, tail: tail || null, startedOnce: true });
}

/**
 * The user pasted a code. Accepted only while the terminal is actually
 * waiting for one; anything else is refused with the reason, because typing
 * into a screen that is not asking is how a driver corrupts a flow.
 */
function submitCode(code) {
  if (!driver) {
    return { ok: false, because: 'the sign-in is not running, so there is nowhere to put that code' };
  }
  if (mem.phase !== PHASE.SIGNIN_AWAITING_CODE) {
    return { ok: false, because: 'Claude is not asking for a code right now' };
  }
  if (!validCode(code)) {
    return { ok: false, because: 'that does not look like a sign-in code' };
  }
  driver.pendingCode = code;
  return { ok: true };
}

/** Stop everything, clean up everything we made, own nothing half-claimed. */
async function cancel() {
  const d = driver;
  driver = null;
  if (d && d.timer) clearInterval(d.timer);
  if (activeRequest) { try { activeRequest.destroy(); } catch { /* already ended */ } activeRequest = null; }
  await killSession();
  try {
    const dir = path.join(store.ROOT, 'downloads');
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.part')) fs.unlinkSync(path.join(dir, f));
    }
  } catch { /* nothing partial to clean */ }
  return writeState({ phase: PHASE.IDLE, startedOnce: true });
}

/** Tests only: forget everything without touching disk records. */
function resetForTests() {
  if (driver && driver.timer) clearInterval(driver.timer);
  driver = null;
  activeRequest = null;
  mem = { phase: PHASE.IDLE };
}

module.exports = {
  PHASE, SESSION,
  state, start, submitCode, cancel,
  classifyPane, extractOauthUrl, tailOf, validCode,
  download, platformKey,
  setRunner, setDryRun, setTickInterval, setUnknownGrace, resetForTests,
  STATE_FILE,
};
