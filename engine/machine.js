'use strict';

/**
 * What first run can tell somebody about their own computer.
 *
 * This is the wireframe's "Checking your computer" screen — screen 7, the one
 * the requirements call the highest-risk in the set, because it is where a
 * person finds out whether the thing they just installed will actually work
 * while they are not looking at it.
 *
 * ⚠️ EVERY CHECK HAS THREE ANSWERS: `ok`, `attention`, and `unknown`. That is
 * this codebase's one rule arriving on a new surface. A check that cannot run
 * must not report the machine as fine, because "your agents will keep working"
 * is the single most expensive sentence on this screen to get wrong: somebody
 * closes the lid on a week of work believing it.
 *
 * ⚠️ AND NOTHING HERE CHANGES ANYTHING. The drawn wireframe puts a "Change this
 * for me" button beside the sleep setting. Changing it is `sudo pmset`, and this
 * server runs as the user with no way to ask for a password — so that button
 * offers something it cannot do, which is the exact defect the rest of this
 * codebase is written against. The check says what it found and where to change
 * it. Deliberate deviation from the drawing, not an omission.
 */

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const create = require('./create');

const STATE = { OK: 'ok', ATTENTION: 'attention', UNKNOWN: 'unknown' };

/**
 * ⚠️ Injectable so the tests never depend on the power settings of whatever
 * machine runs the suite — and, more to the point, so the laptop cases can be
 * tested at all on a Mac mini, which has no battery and therefore never prints
 * the section the laptop answer is about.
 */
function run(cmd, args) {
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, because: String((err && err.message) || err) };
  }
}

/* ===========================================================================
   Sleep
   =========================================================================== */

/**
 * ⚠️ `pmset -g` IS THE WRONG COMMAND, AND IT IS WRONG ON THIS MACHINE RIGHT NOW.
 * Measured, on the box this was written on:
 *
 *     $ pmset -g
 *      sleep   0 (sleep prevented by Claude, caffeinate, powerd)
 *
 * That block is headed "Currently in use". It is what some *running process* has
 * asserted, not what the machine is set to. A Mac configured to sleep after ten
 * minutes reports `sleep 0` there for as long as something holds a caffeinate —
 * and the moment that process exits, it sleeps. So a check keyed on `pmset -g`
 * tells somebody their agents will keep working, and they stop that afternoon.
 *
 * `pmset -g custom` is the setting. That is the one to read.
 */
function parsePmset(text) {
  const sections = new Map();
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    const header = raw.match(/^(\S[^:]*):\s*$/);
    if (header) {
      current = header[1].trim();
      sections.set(current, new Map());
      continue;
    }
    if (!current) continue;
    /**
     * ⚠️ EXACTLY TWO TOKENS, AND THE KEY MATCHED WHOLE.
     *
     * `pmset` prints `disksleep 10` and `displaysleep 0` and `Sleep On Power
     * Button 1` in the same block as `sleep`. A substring match for `sleep\s+(\d+)`
     * finds the "sleep 10" inside `disksleep              10` — so a machine with
     * the default disk-sleep setting and no system sleep at all would be told its
     * agents stop after ten minutes. Wrong in the alarming direction, on the
     * screen that is entirely about trust.
     */
    const kv = raw.match(/^\s+(\S+)\s+(\S+)\s*$/);
    if (kv) sections.get(current).set(kv[1], kv[2]);
  }
  return sections;
}

/** Minutes until sleep for one power source, or null when it did not say. */
function sleepMinutes(section) {
  if (!section || !section.has('sleep')) return null;
  const n = Number(section.get('sleep'));
  return Number.isFinite(n) ? n : null;
}

function sleepCheck(text) {
  const sections = parsePmset(text);
  const ac = sections.get('AC Power');
  const battery = sections.get('Battery Power');

  const acSleep = sleepMinutes(ac);
  if (acSleep === null) {
    return {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not tell whether this Mac goes to sleep',
      detail: 'This is the setting that decides whether your agents keep working when you '
        + 'walk away, so it is worth knowing. You can see it in System Settings, under '
        + 'Lock Screen on a desktop or Battery on a laptop.',
    };
  }

  /**
   * ⚠️ THE PRESENCE OF A `Battery Power` SECTION IS HOW WE KNOW IT IS A LAPTOP.
   * `pmset -g custom` prints that block only where there is a battery to print
   * it for. This was measured on a Mac mini, which prints `AC Power` alone.
   *
   * It matters because a laptop has TWO answers and the second one is the one
   * that bites: plugged in at a desk it never sleeps, and the person closes it
   * at five o'clock and carries it home. The wireframe's dashed note is about
   * exactly that case.
   */
  const batterySleep = battery ? sleepMinutes(battery) : null;

  if (battery && batterySleep === null) {
    return {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not tell what this Mac does on battery',
      detail: 'It does not go to sleep while it is plugged in. What it does on battery is the '
        + 'part we could not read, and that is the part that matters if you carry it home.',
    };
  }

  if (acSleep > 0) {
    return {
      key: 'sleep',
      state: STATE.ATTENTION,
      title: `This Mac goes to sleep after ${acSleep} ${acSleep === 1 ? 'minute' : 'minutes'}`,
      detail: 'Your agents stop when it sleeps and start again when you wake it. If you want '
        + 'them getting on with things while you are away, change Sleep to Never in System '
        + 'Settings.',
    };
  }

  if (battery && batterySleep > 0) {
    return {
      key: 'sleep',
      state: STATE.ATTENTION,
      title: 'This Mac keeps working plugged in, and sleeps on battery',
      detail: `Plugged in it never sleeps. On battery it sleeps after ${batterySleep} `
        + `${batterySleep === 1 ? 'minute' : 'minutes'}, and your agents stop with it. `
        + 'A laptop you close at five o\'clock is not a computer that stays on: if you want '
        + 'them working overnight, leave this one open and plugged in, or use a Mac that '
        + 'stays switched on.',
    };
  }

  return {
    key: 'sleep',
    state: STATE.OK,
    title: 'This Mac does not go to sleep',
    detail: battery
      ? 'Plugged in or on battery, it stays awake, so your agents keep working while you are away.'
      : 'So your agents keep working while you are away.',
  };
}

/* ===========================================================================
   The things it needs installed
   =========================================================================== */

/**
 * ⚠️ ASKS `create.binPaths`, WHICH IS WHAT CREATION ITSELF ASKS. Looking up
 * `claude` on PATH instead would be a second definition of "is it installed",
 * and it would disagree: this server runs under launchd with a PATH that does
 * not include `~/.local/bin`, so `which claude` answers no on a machine where
 * creation works perfectly. A check that looks somewhere else than the code it
 * is vouching for is worse than no check.
 */
function installedCheck(opts) {
  const { claudeBin, tmuxBin } = create.binPaths(opts);
  const parts = [['Claude Code', claudeBin], ['tmux', tmuxBin]];

  const missing = [];
  for (const [label, bin] of parts) {
    let there;
    try {
      there = fs.existsSync(bin);
    } catch (err) {
      // We could not look. That is not the same as it not being there.
      return {
        key: 'installed',
        state: STATE.UNKNOWN,
        title: 'We could not check what is installed',
        detail: `Looking for ${label} on this computer did not work (${String((err && err.message) || err)}). `
          + 'That does not mean it is missing, only that we could not see it.',
      };
    }
    if (!there) missing.push({ label, bin });
  }

  if (!missing.length) {
    return {
      key: 'installed',
      state: STATE.OK,
      title: 'Everything it needs to run is installed',
      detail: 'There is nothing else for you to go and find.',
    };
  }

  /**
   * ⚠️ NAMES WHAT IS MISSING AND WHERE IT LOOKED. "Something is missing" sends
   * somebody to a support channel that does not exist; the path is the one piece
   * of information that lets them, or anyone helping them, fix it. It is also the
   * path an agent made right now would be started from, so it is the truth.
   */
  return {
    key: 'installed',
    state: STATE.ATTENTION,
    title: missing.length === 1
      ? `${missing[0].label} is not where we expected it`
      : 'Two things it needs are not where we expected them',
    detail: 'An agent made now would not start. We looked for '
      + missing.map((m) => `${m.label} at ${m.bin}`).join(', and ')
      + '.',
  };
}

/* ===========================================================================
   Starting themselves
   =========================================================================== */

/**
 * Whether the part of macOS that starts things at login can be reached at all.
 *
 * ⚠️ This is a WEAKER claim than the wireframe's "your agents will start
 * themselves", and deliberately so. What we can establish from here is that
 * `launchctl` answers for this login session — which is what every agent's job
 * is registered with. Whether a particular agent comes back after a reboot is a
 * claim about a reboot we have not done.
 */
function restartCheck(runner) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid === null) {
    return {
      key: 'restart',
      state: STATE.UNKNOWN,
      title: 'We could not tell whether your agents will start themselves',
      detail: 'They are set up to, and nothing here says they will not. We just could not check.',
    };
  }
  const got = runner('/bin/launchctl', ['print', `gui/${uid}`]);
  if (got.ok) {
    return {
      key: 'restart',
      state: STATE.OK,
      title: 'Your agents will start themselves',
      detail: 'If this computer restarts, they come back on their own.',
    };
  }
  return {
    key: 'restart',
    state: STATE.ATTENTION,
    title: 'Your agents may not come back on their own',
    detail: 'We could not reach the part of macOS that starts things at login, so an agent '
      + 'made now might need starting by hand after a restart.',
  };
}

/* ===========================================================================
   The screen
   =========================================================================== */

/**
 * @returns {{checks: Array, attention: number, unknown: number}}
 */
function check(opts) {
  const runner = (opts && opts.runner) || run;

  const pm = (opts && typeof opts.pmset === 'string')
    ? { ok: true, stdout: opts.pmset }
    : runner('/usr/bin/pmset', ['-g', 'custom']);

  const checks = [
    installedCheck(opts),
    pm.ok ? sleepCheck(pm.stdout) : {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not read this Mac\'s sleep settings',
      detail: 'That setting decides whether your agents keep working when you walk away. You '
        + 'can see it in System Settings, under Lock Screen on a desktop or Battery on a laptop.',
    },
    restartCheck(runner),
  ];

  return {
    checks,
    // ⚠️ Counted separately, because the screen must never add them together.
    // "Two things need your attention" over one real problem and one thing we
    // could not read is a sentence that is false about half of what it counts.
    attention: checks.filter((c) => c.state === STATE.ATTENTION).length,
    unknown: checks.filter((c) => c.state === STATE.UNKNOWN).length,
  };
}

module.exports = { check, parsePmset, sleepCheck, installedCheck, restartCheck, STATE };
