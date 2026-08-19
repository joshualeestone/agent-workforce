/**
 * Update awareness: is there a newer Kosmos published than the one running?
 *
 * The published truth is one tiny file, `latest.json` on the release host
 * (`{ "version": "0.1.1" }`), written by the same publish step that uploads
 * the bundle. This module fetches it RARELY (once per TTL window), NEVER on the
 * request path (the status route calls `poke()`, which returns immediately
 * and refreshes in the background), and fails soft in every direction: no
 * network, bad JSON, a weird shape -- all of them mean "no update showing",
 * never an error a person has to read. An update notice is the one feature
 * whose absence must cost nothing.
 *
 * ⚠️ The comparison is strictly numeric dotted-triple, and UNKNOWN LOSES:
 * a malformed remote version compares as older than anything, so a corrupted
 * manifest cannot pop a toast asking somebody to install it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { version: RUNNING } = require('../package.json');

const DEFAULT_BASE = 'https://installkosmos.com/dist';
// 15 minutes, down from 6 hours (2026-08-18): latest.json is ~25 bytes
// behind a CDN, so a fast pull is indistinguishable from push at this
// scale, and Josh's test hour showed what a 6-hour memory feels like: a
// release nobody's running app would admit existed.
const TTL = 15 * 60 * 1000;
const FETCH_TIMEOUT = 3000;

let base = process.env.AGENT_WORKFORCE_RELEASE_BASE || DEFAULT_BASE;
let fetcher = null;            // tests inject; null means global fetch
// reached: did the LAST look actually get an answer from the host?
// "could not reach the update server" must never render as "up to date",
// so the cache carries the distinction rather than flattening both into
// latest: null. at 0 means we have never looked.
let cache = { at: 0, latest: null, reached: false, readable: false };
let inFlight = null;
let installRunner = null;   // tests inject; production spawns the real installer
let installedRootFn = null; // tests inject; production checks the real layout

function parts(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a is strictly newer than b; unknown on either side is never newer. */
function newer(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

/**
 * The cached verdict, synchronously: `{ version }` when something newer is
 * published, else null. Never touches the network.
 */
function available() {
  return (cache.latest && newer(cache.latest, RUNNING)) ? { version: cache.latest } : null;
}

/** Refresh the cache if stale. Returns immediately; errors stay internal. */
function poke() {
  if (Date.now() - cache.at < TTL) return;
  if (inFlight) return;
  inFlight = refresh().catch(() => { /* fail soft: no update showing */ })
    .finally(() => { inFlight = null; });
}

async function refresh() {
  const doFetch = fetcher || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
  const started = Date.now();
  let landed = false;
  try {
    const res = await doFetch(`${base}/latest.json`, { signal: ctl.signal, cache: 'no-store' });
    if (res && res.ok) {
      const body = await res.json().catch(() => null);
      const v = body && typeof body.version === 'string' && parts(body.version) ? body.version : null;
      // reached true means the host answered with an ok response;
      // readable true means the answer carried a usable version. The
      // split exists because a captive portal answers EVERYTHING with a
      // 200 splash page, and "reached, unreadable, no offer" must not
      // render as "Up to date" -- the exact false sentence this module
      // exists to prevent. Silence, errors, and non-ok statuses land
      // reached false (could-not-reach).
      cache = { at: Date.now(), latest: v, reached: true, readable: v !== null };
      landed = true;
    }
  } finally {
    clearTimeout(timer);
    // ⚠️ A MISS IS AN ANSWER, INCLUDING A THROWN ONE. This stamp used to sit
    // after the await, so a rejecting fetch (offline, DNS, the abort) never
    // stamped, and the five-second status poll asked a down host forever.
    // Keyed on the attempt itself, not a timestamp comparison: two
    // refreshes inside one millisecond made `cache.at < started` skip the
    // stamp, and checkNow (TTL-bypassing) makes back-to-back refreshes a
    // real path, not a test artifact.
    if (!landed) cache = { at: started, latest: null, reached: false, readable: false };
  }
}

/** What the last look established: for the screen's could-not-reach state.
    looked distinguishes "the first look is still in flight" (at 0) from
    "we looked and could not reach": at boot the screen must say Checking,
    not claim a failure that has not happened. */
function lastLook() {
  return {
    reached: cache.reached === true,
    readable: cache.readable === true,
    at: cache.at,
    looked: cache.at > 0,
  };
}

/**
 * Ask the host RIGHT NOW, TTL be damned: the person pressed Check now,
 * and a button that silently serves a 14-minute-old answer is the Later
 * trap wearing a new coat. Coalesces with an in-flight background
 * refresh rather than racing it.
 */
async function checkNow() {
  if (!inFlight) {
    inFlight = refresh().catch(() => { /* reached:false is the record */ })
      .finally(() => { inFlight = null; });
  }
  await inFlight;
  return { running: RUNNING, latest: cache.latest, reached: cache.reached === true, readable: cache.readable === true };
}

/**
 * Where this Kosmos lives, IF it is an installed copy: the bundle layout is
 * $KOSMOS_HOME/{app,runtime,bin,tmux}, and this file runs from app/engine.
 * A from-source checkout has no private runtime beside it, and for that world
 * the answer is null: source updates with git, and the installer must never
 * be pointed at a developer's working tree.
 */
function installedRoot() {
  if (installedRootFn) return installedRootFn();
  const home = path.resolve(__dirname, '..', '..');
  return (fs.existsSync(path.join(home, 'runtime', 'bin', 'node'))
       && fs.existsSync(path.join(home, 'app', 'server.js'))) ? home : null;
}

/** The installer URL, derived from the release base (its sibling /setup).
    ⚠️ Assumes the base ends in /dist, which both the default and the
    installer's own KOSMOS_RELEASE_BASE convention do; an override without
    that suffix yields <base>/setup, so a nonstandard staging base must
    keep the /dist shape. */
function setupUrl() {
  return base.replace(/\/dist\/?$/, '') + '/setup';
}

/**
 * Start the update and return immediately. The updater is the SAME hardened
 * installer every install runs (staged download, checksum verification,
 * atomic rename, board restart) -- not a second, lesser copy of that logic
 * here. Detached and unref'd: the child must outlive this server, because
 * finishing the job is what kills and restarts it. Agents are untouched
 * throughout; only the board restarts (their launchd jobs and tmux sessions
 * are separate process trees).
 */
let installStarted = false;
function alreadyInstalling() { return installStarted; }
function beginInstall() {
  // ⚠️ Single-flight. available() stays truthy until the new server is up,
  // so a double click or a second tab would spawn a SECOND detached
  // installer racing the first through the stage-and-swap. One per server
  // lifetime; the flag dies with the process the installer restarts.
  if (installStarted) return;
  installStarted = true;
  if (installRunner) return installRunner(setupUrl());
  // The URL travels as a positional parameter, never interpolated into the
  // one command in this product that ends in `| sh`; and KOSMOS_RELEASE_BASE
  // rides along so the installer stages its tarballs from the SAME host the
  // script came from (the app's env override and the installer's default
  // could otherwise split-brain a staging deployment).
  const child = spawn('/bin/sh', ['-c', 'curl -fsSL "$1" | sh', 'sh', setupUrl()], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, KOSMOS_RELEASE_BASE: base },
  });
  // ⚠️ 'error' fires ASYNCHRONOUSLY on spawn failure (EMFILE, EAGAIN); with
  // no listener it becomes an uncaught exception, and the failure mode of
  // the one route that runs software would be crashing the board with no
  // installer running to bring it back -- while the single-flight flag,
  // stranded true, answered every retry "already updating". Log, release
  // the flag, and the person's retry gets a real attempt.
  child.on('error', (err) => {
    installStarted = false;
    process.stderr.write(`Kosmos update could not start: ${String((err && err.message) || err)}\n`);
  });
  // ⚠️ And the PIPELINE failing after a clean spawn (release host 404, a
  // dropped download, the installer's checksum refusal): the child exits
  // non-zero while this server is still alive, and a stranded true flag
  // would answer every retry "already updating" -- each retry costing the
  // person a three-minute overlay that reloads into the same toast --
  // until somebody restarts the board. An exit listener works on an
  // unref'd child while the parent lives; a SUCCESSFUL install kills this
  // server before the listener matters, which is why releasing on any
  // non-zero exit cannot double-run a good update.
  child.on('exit', (code) => {
    if (code !== 0) {
      installStarted = false;
      process.stderr.write(`Kosmos update failed before it could restart the board (exit ${code}); Install can be tried again\n`);
    }
  });
  child.unref();
}

/* Test hooks. Production code never calls these. */
function setBase(b) { base = b || (process.env.AGENT_WORKFORCE_RELEASE_BASE || DEFAULT_BASE); }
function setInstallRunner(f) { installRunner = f; }
function setInstalledRoot(f) { installedRootFn = f; }
function setFetcher(f) { fetcher = f; }
function resetCache() { cache = { at: 0, latest: null, reached: false, readable: false }; inFlight = null; installStarted = false; }

module.exports = {
  available, poke, refresh, newer, installedRoot, setupUrl, beginInstall,
  alreadyInstalling, setBase, setFetcher, setInstallRunner, setInstalledRoot,
  resetCache, RUNNING, TTL, lastLook, checkNow,
};
