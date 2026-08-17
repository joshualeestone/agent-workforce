/**
 * Update awareness: is there a newer Kosmos published than the one running?
 *
 * The published truth is one tiny file, `latest.json` on the release host
 * (`{ "version": "0.1.1" }`), written by the same publish step that uploads
 * the bundle. This module fetches it RARELY (six-hour cache), NEVER on the
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
const TTL = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 3000;

let base = process.env.AGENT_WORKFORCE_RELEASE_BASE || DEFAULT_BASE;
let fetcher = null;            // tests inject; null means global fetch
let cache = { at: 0, latest: null };
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
  try {
    const res = await doFetch(`${base}/latest.json`, { signal: ctl.signal, cache: 'no-store' });
    if (!res || !res.ok) return;
    const body = await res.json().catch(() => null);
    const v = body && typeof body.version === 'string' && parts(body.version) ? body.version : null;
    cache = { at: Date.now(), latest: v };
  } finally {
    clearTimeout(timer);
    // ⚠️ A MISS IS AN ANSWER, INCLUDING A THROWN ONE. This stamp used to sit
    // after the await, so a rejecting fetch (offline, DNS, the abort) never
    // stamped, and the five-second status poll asked a down host forever --
    // the exact once-per-TTL promise the comment made and the code broke.
    if (cache.at < started) cache = { at: started, latest: null };
  }
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

/** The installer URL, derived from the release base (its sibling /setup). */
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
  child.unref();
}

/* Test hooks. Production code never calls these. */
function setBase(b) { base = b || (process.env.AGENT_WORKFORCE_RELEASE_BASE || DEFAULT_BASE); }
function setInstallRunner(f) { installRunner = f; }
function setInstalledRoot(f) { installedRootFn = f; }
function setFetcher(f) { fetcher = f; }
function resetCache() { cache = { at: 0, latest: null }; inFlight = null; installStarted = false; }

module.exports = { available, poke, refresh, newer, installedRoot, setupUrl, beginInstall, alreadyInstalling, setBase, setFetcher, setInstallRunner, setInstalledRoot, resetCache, RUNNING };
