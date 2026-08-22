'use strict';

/**
 * Telling the Kosmos team that an agent was created (#238).
 *
 * Josh, 2026-08-22: he wants two numbers on the homepage, installs and agents
 * created, and ruled the collection settled ("we've had a lot of discussion
 * around this and it's fine"). A default-checked box on the create page, which
 * anybody can untick.
 *
 * 🛑 WHAT GOES, EXHAUSTIVELY, AND THIS LIST IS THE FEATURE. Nothing about the
 * agent itself: not its name, its role, its instructions, its model, its
 * projects, or anything typed. The EVENT, never its contents.
 *
 *   installId   a random id made on this machine, in this file, once
 *   at          when
 *   version     which Kosmos
 *   os          the macOS version
 *
 * ⚠️ THE IP ARRIVES ON ITS OWN. Every HTTP request carries one; there is no
 * version of this that does not have it, and it is deliberately NOT NAMED on
 * screen (Josh, 22:55: "we're not saying anything about IP to white collar
 * workers"). Recorded here so a future reader does not take the silence for an
 * oversight and change it in either direction without asking him.
 *
 * 🔑 THE INSTALL ID IS WHAT MAKES THE IP UNNECESSARY FOR THE NUMBERS. A shared
 * office undercounts on IP and a roaming laptop overcounts, and you cannot tell
 * which; a per-install id gives both numbers exactly. (Mona Lisa's point, and
 * the reason this file generates one rather than leaning on the address.)
 *
 * 🛑 IT CAN NEVER BLOCK, SLOW OR FAIL A CREATION. The person asked for an
 * agent, not for a report. Every path here is fire-and-forget with a short
 * timeout, every error is swallowed, and the caller is not given a promise it
 * could accidentally await.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const { version: VERSION } = require('../package.json');

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'ping.json');
const DEFAULT_ENDPOINT = 'https://installkosmos.com/api/created';

let sender = null;      // tests inject; production uses global fetch
const endpoint = () => process.env.AGENT_WORKFORCE_PING_URL || DEFAULT_ENDPOINT;

/**
 * The preference and the install id, in one small file.
 *
 * ⚠️ AN UNREADABLE FILE FAILS TO **OFF**, unlike the shipped default. Absent
 * means nobody has been asked yet, which is on; present-but-unreadable means
 * somebody may have turned it off and we cannot see which, and the only action
 * gated here is sending something off the machine. Same split as
 * engine/autoupdate.js, for the same reason and in the opposite direction from
 * engmode.js, which gates only whether a panel is visible.
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, installId: null, ok: true };
    return { on: false, installId: null, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, installId: null, ok: false }; }
  if (!parsed || typeof parsed !== 'object') return { on: false, installId: null, ok: false };
  return {
    on: typeof parsed.on === 'boolean' ? parsed.on : true,
    installId: typeof parsed.installId === 'string' && parsed.installId ? parsed.installId : null,
    ok: true,
  };
}

function write(patch) {
  const next = { ...read(), ...patch };
  delete next.ok;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

function setOn(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  return write({ on });
}

/**
 * This install's id, made once and kept.
 *
 * ⚠️ RANDOM, never derived from anything about the machine. A hash of a
 * hostname or a MAC address would be stable in the same way and would also be
 * a fingerprint that identifies the computer across reinstalls and across
 * products. Random means it identifies an INSTALL and nothing else, which is
 * the only thing the two numbers need.
 */
function installId() {
  const had = read();
  if (had.installId) return had.installId;
  const made = crypto.randomUUID();
  write({ installId: made });
  /* If the write failed the id is still returned: one un-remembered install is
     a small counting error, and refusing to send is a bigger one. */
  return made;
}

/**
 * Everything that leaves. Exported and tested BY NAME, because the screen no
 * longer enumerates it: Josh ruled the IP out of the copy, so a reader cannot
 * check the payload against the words any more, and a test is the only thing
 * left that can. (Mona Lisa's rule 3: the welcome line, the checkbox label and
 * this object cannot disagree. If a field is added here, that test fails until
 * somebody looks at the copy again.)
 */
function payload() {
  return {
    event: 'agent_created',
    installId: installId(),
    at: new Date().toISOString(),
    version: VERSION,
    os: os.release(),
  };
}

/**
 * Send it, if the person has left it on. Returns nothing on purpose: a caller
 * cannot await what it is not given, so no future edit can make a creation wait
 * on a network.
 */
/**
 * 🛑 A TEST RUN MUST NEVER PHONE HOME, AND ONE ALREADY DID. `server.test.js`
 * creates agents through the real route, so the moment this feature was wired
 * the suite began POSTing to installkosmos.com on every `yarn test` -- putting
 * fake installs into the number Josh is going to read off the homepage. Caught
 * by the counter reading 2 after a single deliberate ping.
 *
 * ⚠️ THE SIGNAL HAS TO FAIL IN THE RIGHT DIRECTION, which ruled out the
 * obvious ones. Keying on `AGENT_WORKFORCE_DATA` would work today and would
 * silently disable telemetry for anybody who moves their data folder, since
 * `install/setup.sh` honours that same variable. Requiring an opt-in env var
 * in production inverts it: forget to set it once and nothing is ever sent,
 * with no symptom. `NODE_TEST_CONTEXT` is set by node's own test runner in
 * every test process and by nothing else, so it cannot be true for a real
 * install and cannot be false for a test.
 */
function underTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

function agentCreated({ wanted } = {}) {
  try {
    /* ⚠️ ONLY WHEN NOTHING HAS BEEN INJECTED. The guard is about the real
       network, and a test that has supplied its own sender touches no network
       at all -- so applying it there would make the send path itself
       untestable, which is how a guard against sending becomes a guard against
       knowing whether sending works. */
    if (!sender && underTest()) return;
    /* Two gates, and BOTH must be true. `wanted` is the box on the create page
       for this one agent; the stored preference is the standing answer. An
       unchecked box does not change the setting, and a setting turned off is
       not overridden by a box somebody did not think about. */
    if (wanted === false) return;
    const pref = read();
    if (!pref.on) return;
    const body = JSON.stringify(payload());
    const post = sender || ((url, init) => fetch(url, init));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    Promise.resolve(post(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: ctl.signal,
    })).catch(() => { /* fire and forget: no network, no host, no problem */ })
      .finally(() => clearTimeout(timer));
  } catch { /* nothing here may reach the caller */ }
}

/* Test hooks. Production never calls these. */
function setSender(f) { sender = f; }

module.exports = { FILE, read, setOn, installId, payload, agentCreated, setSender, underTest, DEFAULT_ENDPOINT };
