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
const os = require('node:os');
const path = require('node:path');
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
    /**
     * ⚠️ `maxBuffer` RAISED. `launchctl print gui/<uid>` emits 107 KB on this
     * machine against a 1 MB default, and a busier login session can pass it --
     * at which point `execFileSync` throws and a perfectly healthy machine
     * reports "we could not tell whether your agents will start themselves".
     * It fails to the safe side, but it fails for a reason that has nothing to
     * do with the question.
     */
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
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
  const raw = section.get('sleep');
  /**
   * ⚠️ PLAIN DECIMAL DIGITS, WHICH IS WHAT `pmset` PRINTS. Anything else is a
   * reading we did not understand, and this module's whole job is not turning
   * one of those into an assertion.
   *
   * Two versions of this were too generous. `Number.isFinite` accepted `-5`,
   * which is neither zero nor greater than zero, so it fell through every
   * branch into "This Mac does not go to sleep". Tightening to
   * `Number.isInteger(n) && n >= 0` then still accepted `0x10`, which `Number`
   * happily reads as 16 — so an uninterpretable value came out as the confident
   * sentence "This Mac goes to sleep after 16 minutes". Both failed by being
   * clever about input, in the direction of saying something.
   */
  if (!/^\d+$/.test(String(raw))) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function sleepCheck(text) {
  const sections = parsePmset(text);
  const ac = sections.get('AC Power');
  const battery = sections.get('Battery Power');

  const acSleep = sleepMinutes(ac);
  const battFirst = battery ? sleepMinutes(battery) : null;

  if (acSleep === null) {
    /**
     * ⚠️ AND THE OTHER HALF, IN THIS DIRECTION TOO. The "report the known half
     * first" fix was made below for an unreadable BATTERY section and not here
     * for an unreadable AC one — so a laptop whose battery section says it
     * sleeps after ten minutes, with an AC section we could not parse, came
     * back as a flat "we could not tell whether this Mac goes to sleep",
     * throwing away a measured and actionable finding. The same defect,
     * mirrored, in the same function.
     */
    if (battFirst !== null && battFirst > 0) {
      return {
        key: 'sleep',
        state: STATE.ATTENTION,
        title: `This Mac goes to sleep on battery after ${battFirst} ${battFirst === 1 ? 'minute' : 'minutes'}`,
        detail: 'Your agents stop when it sleeps. We could not read what it does while it is '
          + 'plugged in, which may be different. You can see both in System Settings, under '
          + 'Battery.',
      };
    }
    return {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not tell whether this Mac goes to sleep',
      detail: (battFirst === 0
        // ⚠️ The half we DID read, for the same reason the branches below say
        // theirs. Discarding a clean battery reading because the AC section was
        // unreadable is the same shape, one more time.
        ? 'It does not go to sleep on battery. What it does while it is plugged in is the part '
          + 'we could not read. '
        : 'This is the setting that decides whether your agents keep working when you '
          + 'walk away, so it is worth knowing. ')
        + 'You can see it in System Settings, under Lock Screen on a desktop or Battery on '
        + 'a laptop.',
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

  /**
   * ⚠️ THE KNOWN HALF IS REPORTED FIRST. This test used to sit BELOW the
   * unreadable-battery branch, so a laptop set to sleep after ten minutes on AC
   * whose battery section could not be read said only "we could not tell what
   * this Mac does on battery" -- dropping a measured, actionable finding
   * because a *different* reading failed. Half the answer was read and none of
   * it was reported.
   */
  if (acSleep > 0) {
    return {
      key: 'sleep',
      state: STATE.ATTENTION,
      title: `This Mac goes to sleep after ${acSleep} ${acSleep === 1 ? 'minute' : 'minutes'}`,
      detail: 'Your agents stop when it sleeps and start again when you wake it. If you want '
        + 'them getting on with things while you are away, change Sleep to Never in System '
        + 'Settings.'
        // ⚠️ The other power source, when there is one and it differs. Reporting
        // only the AC number on a laptop that sleeps after one minute on battery
        // names the longer of the two intervals and leaves the biting one unsaid.
        + (battery && batterySleep === null
          ? ' We could not read what it does on battery, which may be different again.'
          : (battery && batterySleep > 0 && batterySleep !== acSleep
            ? ` On battery it sleeps after ${batterySleep} ${batterySleep === 1 ? 'minute' : 'minutes'}.`
            : '')),
    };
  }

  if (battery && batterySleep === null) {
    /**
     * ⚠️ THE REASSURING HALF OF THIS SENTENCE IS ITSELF A CLAIM, AND IT USED TO
     * BE MADE WITHOUT CHECKING.
     *
     * This branch ran before `acSleep > 0` was tested, so on a laptop set to
     * sleep after ten minutes on AC — with an unreadable battery section — it
     * said "It does not go to sleep while it is plugged in." Measured. The
     * *state* was safely `unknown` the whole time, which is exactly why it went
     * unnoticed: the wrong thing was the prose, not the verdict.
     *
     * So the plugged-in half is only asserted when it was actually read as zero.
     */
    return {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not tell what this Mac does on battery',
      detail: (acSleep === 0
        ? 'It does not go to sleep while it is plugged in. What it does on battery is the '
        : 'What this Mac does on battery is the ')
        + 'part we could not read, and that is the part that matters if you carry it home.',
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
  const unreadable = [];
  const unusable = [];
  for (const [label, bin] of parts) {
    /**
     * ⚠️ `statSync`, NOT `existsSync`, AND THE DIFFERENCE IS THE WHOLE POINT OF
     * THE CATCH.
     *
     * `fs.existsSync` never throws: it swallows every error internally and
     * answers `false`. So the `unknown` arm written around it was unreachable
     * code, and an unreadable parent directory — a permissions error, a
     * disconnected mount — came out of it as the flat claim "Claude Code is not
     * where we expected it. An agent made now would not start."
     *
     * That is *we could not look* rendered as a checked negative, in the module
     * whose header says that is the one thing not to do. It shipped because the
     * guard was new code and nothing tested it, which is the other rule.
     *
     * `statSync` throws, so the three answers are real: ENOENT is genuinely
     * absent, anything else is us being unable to see.
     */
    /**
     * ⚠️ AND THE SAME PATH RULE CREATION USES. `createAgent` refuses a path
     * carrying a quote or a newline outright; without this, such a path passed
     * step 2 as "Everything it needs to run is installed" and was refused by
     * creation two screens later.
     */
    /**
     * ⚠️ ITS OWN BUCKET, because "We looked for tmux at <path>" is a sentence
     * about an action nobody took. We refuse these on sight; if the binary
     * really is sitting at that path, the person checks, finds it exactly where
     * the screen says it is not, and the actual cause -- a quote or a newline in
     * the path -- is never named anywhere.
     */
    if (create.unusablePath(bin)) { unusable.push({ label, bin }); continue; }

    /**
     * ⚠️ TWO PROBES, BECAUSE `EACCES` MEANS TWO DIFFERENT THINGS HERE and
     * collapsing them puts one of them on the wrong side of the rule.
     *
     *   - `EACCES` from the STAT means we could not traverse to the path at all
     *     — an unreadable parent, a disconnected mount. That is *we could not
     *     look*, and it must not render as a finding.
     *   - `EACCES` from the ACCESS means we looked, we found it, and it is not
     *     runnable. That is a real finding.
     *
     * The first version of this ran them in one try and treated every `EACCES`
     * as "missing", which quietly undid the whole reason the probe moved off
     * `existsSync` in the first place.
     */
    let st;
    try {
      st = fs.statSync(bin);
    } catch (err) {
      if (err && err.code === 'ENOENT') { missing.push({ label, bin }); continue; }
      /**
       * ⚠️ RECORDED, NOT RETURNED. Returning here threw away whatever the OTHER
       * probe had already established: with Claude genuinely absent and tmux
       * unreadable, the whole check came back "We could not check what is
       * installed", naming only tmux — and `attention` dropped to zero, so the
       * screen said nothing needed doing while Claude was definitively missing.
       *
       * That is the identical defect `sleepCheck` above documents fixing, in
       * its sibling function, written the same afternoon. Half the answer was
       * read and none of it was reported.
       */
      unreadable.push({ label, bin, because: String((err && err.message) || err) });
      continue;
    }

    /**
     * ⚠️ A FILE WE COULD ACTUALLY RUN, not merely something at that path.
     * `statSync` alone succeeds for a DIRECTORY named `claude` and for a file
     * with no execute bit — both of which came back as "There is nothing else
     * for you to go and find", on the screen whose job is promising the thing
     * will work. launchd would then start the job and it would fail silently,
     * which is the worst available outcome: nothing on screen, nothing running.
     */
    if (!st.isFile()) { missing.push({ label, bin }); continue; }
    try {
      fs.accessSync(bin, fs.constants.X_OK);
    } catch {
      missing.push({ label, bin });
    }
  }

  if (!missing.length && !unreadable.length && !unusable.length) {
    return {
      key: 'installed',
      state: STATE.OK,
      title: 'Everything it needs to run is installed',
      detail: 'There is nothing else for you to go and find.',
    };
  }

  /**
   * ⚠️ THREE BUCKETS, AND EVERY ONE OF THEM GETS SAID.
   *
   * This is the third time this one function has dropped a finding on the
   * floor by returning early. `unreadable` beat `missing` first; then
   * `unusable` was added as its own bucket — with its own early return, ahead
   * of both — so `installedCheck({claudeBin: '/nowhere/claude', tmuxBin:
   * "/opt/home'brew/bin/tmux"})` reported ONLY the quoted tmux path and never
   * mentioned that Claude Code was absent. Measured. Reachable in real life by
   * a home directory with an apostrophe in it.
   *
   * `sleepCheck` above documents fixing this same shape twice. The lesson that
   * did not travel is that the fix has to be structural: assemble the sentence
   * from whatever is in each bucket, rather than picking a winner and
   * returning.
   */
  const problems = missing.length || unusable.length;
  const parts_ = [];
  if (missing.length) {
    parts_.push('We looked for ' + missing.map((m) => `${m.label} at ${m.bin}`).join(', and ') + '.');
  }
  if (unusable.length) {
    parts_.push('The path set for '
      + unusable.map((u) => `${u.label} is ${u.bin}`).join(', and the one for ')
      + ' — a quote, a backslash or a line break in a path is something we will not pass on to '
      + 'the parts of macOS that start an agent, whatever is at the end of it.');
  }
  if (unreadable.length) {
    parts_.push(`We could not check ${unreadable.map((u) => u.label).join(' or ')} at all.`);
  }

  if (!problems) {
    return {
      key: 'installed',
      state: STATE.UNKNOWN,
      title: 'We could not check what is installed',
      detail: unreadable.map((u) => `Looking for ${u.label} at ${u.bin} did not work (${u.because})`).join(', and ')
        + '. That does not mean anything is missing, only that we could not see it.',
    };
  }

  const named = [...missing, ...unusable].map((x) => x.label);
  return {
    key: 'installed',
    state: STATE.ATTENTION,
    title: named.length === 1
      ? `${named[0]} is not where we can use it`
      : 'Some of what it needs is not where we can use it',
    detail: 'An agent made now would not start. ' + parts_.join(' '),
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
    /**
     * ⚠️ "SET TO", NOT "WILL". The comment above this function already said this
     * claim is deliberately weaker than the wireframe's, and then the string
     * underneath it said "Your agents will start themselves. If this computer
     * restarts, they come back on their own." What was actually established is
     * that `launchctl` answers for this login session. No plist was opened, no
     * job was listed, no agent was inspected, and no reboot has happened.
     *
     * A safety comment that disagrees with the sentence beside it is worse than
     * neither, because the next reader trusts the comment.
     */
    /**
     * ⚠️ IT IS A CLAIM ABOUT WHAT KOSMOS DOES, NOT ABOUT ANYBODY'S AGENTS, and
     * the difference is not pedantry.
     *
     * "Your agents are set to start themselves" was FALSE on the adopt path,
     * which is the path this machine is on. `firstrun.fleet()` counts agents out
     * of `tmux list-panes` -- thirteen of them here -- and an agent some other
     * program started may have no launchd job at all. Nothing in this function
     * opened a plist, listed a job, or looked at a single one of them. On the
     * create path it was a claim about zero agents.
     *
     * What was actually established is that `launchctl` answers for this login
     * session, which is exactly enough to say that an agent KOSMOS makes will be
     * registered. So that is what it says, and it says out loud whose agents it
     * is not talking about.
     */
    return {
      key: 'restart',
      state: STATE.OK,
      title: 'Agents made here will start themselves',
      detail: 'An agent you set up here is registered with the part of macOS that starts things '
        + 'at login, so it comes back on its own after a restart. Agents another program set up '
        + 'are that program\'s business, and we have not looked at them.',
    };
  }
  /**
   * ⚠️ UNKNOWN, NOT ATTENTION, and this one was miscounted by the module that
   * documents the miscount. `launchctl` failing to answer does not establish
   * that anything is wrong with the jobs — it establishes that we could not ask.
   * Reporting it as `attention` puts a thing-we-could-not-read into the count of
   * things-that-need-doing, which `check()` keeps separate precisely so that
   * "two things need your attention" is never half false.
   */
  return {
    key: 'restart',
    state: STATE.UNKNOWN,
    title: 'We could not tell whether your agents will start themselves',
    detail: 'The part of macOS that starts things at login did not answer, so we could not '
      + 'check. They are set up to come back after a restart, and nothing here says they '
      + 'will not.',
  };
}

/* ===========================================================================
   The screen
   =========================================================================== */

/**
 * The could-not-look answer, defined ONCE. The /api/machine route's degraded
 * catch path publishes this same row, and a second hand-copied literal there
 * went stale the moment this wording moved.
 */
function appLocationUnknown() {
  return {
    key: 'app-location',
    state: STATE.UNKNOWN,
    title: 'We could not check where the Kosmos icon is',
    detail: 'Nothing is wrong. Type Kosmos into Spotlight, the magnifying glass at the '
      + 'top right of your screen, and it will find it.',
  };
}

/**
 * Where the Kosmos icon actually IS, looked up rather than remembered.
 *
 * ⚠️ WHY THIS EXISTS (orientation spec, 2026-08-14): the installer's APP_DIR
 * is a shell variable that was never persisted, so the app had no idea where
 * its own icon landed -- and the icon legitimately lands in three places:
 * /Applications (the account could write there), ~/Applications (fallback,
 * measured on the first real clean-machine run when the tester concluded the
 * install "did not put it in my applications"), or nowhere. A screen saying
 * "it is in your Applications folder" without looking would be a state
 * nobody checked rendered as fact.
 *
 * ⚠️ EXISTENCE, not provenance, deliberately: this check says "we found a
 * Kosmos here" when a Kosmos.app directory is present, and does not try to
 * prove the bundle is this install's the way install/kosmos's bundle_is_ours
 * does. The spec weighed this: an honest "we found one" beats a provenance
 * proof that lands a healthy machine in unknown.
 *
 * Four answers, per the spec's table, in this module's check shape:
 * found in /Applications (ok), found in ~/Applications (ok, its own title,
 * because the path differs and the installer already words it this way),
 * found in neither (attention -- with the sentence that absence-of-finding
 * is not absence: "That is not the same as it not being there"), and could
 * not look (unknown -- "Nothing is wrong").
 *
 * `opts.appDirs` overrides the two real folders so tests never depend on
 * this machine's actual /Applications -- the same injection shape as
 * opts.runner and opts.pmset.
 *
 * Known limit, not an oversight: the installer accepts KOSMOS_SYS_APP_DIR
 * and KOSMOS_APP_DIR overrides, and those shell variables are never
 * persisted -- so a machine installed to a custom folder reads attention
 * here. The copy stays honest about exactly that ("That is not the same as
 * it not being there").
 */
function appLocationCheck(opts) {
  // ⚠️ A malformed override THROWS rather than silently probing the real
  // machine. The fallback used to require length exactly 2, so a test passing
  // one or three directories by mistake read the operator's real
  // /Applications under a green run -- the exact leak the override exists to
  // prevent.
  let dirs;
  if (opts && opts.appDirs !== undefined) {
    if (!Array.isArray(opts.appDirs) || opts.appDirs.length === 0
        || !opts.appDirs.every((d) => typeof d === 'string' && d.length > 0)) {
      // Non-string elements included: path.join would TypeError inside the
      // look's try, read as errored, and answer a fabricated could-not-look
      // -- the one state this guard exists to keep honest.
      throw new Error('appDirs override must be a non-empty array of directory paths');
    }
    dirs = opts.appDirs;
  } else {
    dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  }
  const TITLES = [
    'Kosmos is in your Applications folder',
    'Kosmos is in the Applications folder inside your home folder',
  ];
  const OPEN_FROM_THERE = 'Open it from there whenever you want it. Clicking it starts '
    + 'Kosmos if it is not already running.';
  // ⚠️ An unreadable FIRST folder no longer ends the look. A machine whose
  // /Applications errors EACCES but whose home Applications holds the app was
  // told "we could not check" when a definite yes was one iteration away --
  // could-not-look is the honest LAST answer, never the eager one.
  let errored = false;
  for (let i = 0; i < dirs.length; i++) {
    try {
      const st = fs.statSync(path.join(dirs[i], 'Kosmos.app'));
      // A FILE named Kosmos.app is not the app; keep looking rather than
      // pointing somebody at a thing that will not open.
      if (st.isDirectory()) {
        // Index 0 and 1 are the two real folders; an injected extra gets a
        // title AND detail that name no folder ("from there" would point at
        // a place the title deliberately declines to name).
        const named = i < TITLES.length;
        const title = named ? TITLES[i] : 'We found the Kosmos icon on this Mac';
        const detail = named ? OPEN_FROM_THERE
          : 'Open it from where you found it. Clicking it starts Kosmos if it is not already running.';
        return { key: 'app-location', state: STATE.OK, title, detail };
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      // Anything but a clean "not there" means we could not complete this
      // look -- remember it and keep going, because a find anywhere is still
      // a find.
      errored = true;
    }
  }
  if (errored) {
    // "Could not look" must never render as "it is not there".
    return appLocationUnknown();
  }
  return {
    key: 'app-location',
    state: STATE.ATTENTION,
    title: 'We could not find the Kosmos icon',
    detail: 'That is not the same as it not being there. Type Kosmos into Spotlight, the '
      + 'magnifying glass at the top right of your screen, and it will find it.',
  };
}

/**
 * @returns {{checks: Array, attention: number, unknown: number,
 *            appLocation: {key: string, state: string, title: string, detail: string}}}
 */

/* ---- the Open-sleep-settings capability ---------------------------------

   ⚠️ RELIABILITY-OR-NO-BUTTON is the contract (Josh's rule for this row): a
   button that lands a person on the wrong System Settings pane is worse than
   no button, so the capability is claimed ONLY when the pane provably exists
   on THIS machine. macOS panes are ExtensionKit appexes on disk, so presence
   is checkable, and the pane id is read from the appex's own Info.plist
   rather than guessed from a version table:

     macOS 26.5.2 (measured on this machine, 2026-08-16): the power pane is
     PowerPreferences.appex carrying com.apple.Battery-Settings.extension,
     desktop and laptop alike. Opening x-apple.systempreferences:<that id>
     was verified by PROCESS, with a negative control: a bogus pane id opens
     Settings without launching the pane appex; the real id launches
     PowerPreferences with the id in its launch arguments.

     Older macOS (the 13.5 floor through the pre-merge layouts) shipped
     com.apple.Energy-Saver-Settings.extension on desktops. Not verifiable on
     this machine; it is in the accepted set, and a machine with NEITHER
     extension on disk simply gets no button, which is the safe failure the
     contract asks for.

   The scan is cached for the process lifetime: the OS does not change under
   a running board, and the alternative is two `defaults` subprocesses per
   /api/machine call. */
const SLEEP_PANE_IDS = [
  'com.apple.Battery-Settings.extension',
  'com.apple.Energy-Saver-Settings.extension',
];
const EXTENSIONS_DIR = '/System/Library/ExtensionKit/Extensions';
let SLEEP_PANE_CACHE;   // undefined = not probed; null = probed, none found

function sleepPaneUrl(runner) {
  if (SLEEP_PANE_CACHE !== undefined) return SLEEP_PANE_CACHE;
  const r = runner || run;
  let names;
  try {
    names = fs.readdirSync(EXTENSIONS_DIR)
      .filter((n) => n.endsWith('.appex') && /power|energy|battery/i.test(n));
  } catch {
    SLEEP_PANE_CACHE = null;
    return null;
  }
  for (const n of names) {
    const res = r('/usr/bin/defaults', ['read', path.join(EXTENSIONS_DIR, n, 'Contents', 'Info'), 'CFBundleIdentifier']);
    if (!res.ok) continue;
    const id = String(res.stdout || '').trim();
    if (SLEEP_PANE_IDS.includes(id)) {
      SLEEP_PANE_CACHE = 'x-apple.systempreferences:' + id;
      return SLEEP_PANE_CACHE;
    }
  }
  SLEEP_PANE_CACHE = null;
  return null;
}

/** Open the pane. The URL is ALWAYS derived here, never taken from a caller:
    the route that fronts this must not become a way for a page to `open`
    arbitrary URLs on the machine. */
function openSleepSettings(runner) {
  const url = sleepPaneUrl(runner);
  if (!url) return { ok: false, because: 'we could not find the sleep settings screen on this Mac' };
  const r = runner || run;
  const res = r('/usr/bin/open', [url]);
  return res.ok
    ? { ok: true }
    : { ok: false, because: 'System Settings did not open' };
}

/* Test hook: the cache makes the probe once-per-process, which is right in
   production and wrong in a test that wants to exercise both worlds. */
function resetSleepPaneCache() { SLEEP_PANE_CACHE = undefined; }

function check(opts) {
  const runner = (opts && opts.runner) || run;

  const pm = (opts && typeof opts.pmset === 'string')
    ? { ok: true, stdout: opts.pmset }
    : runner('/usr/bin/pmset', ['-g', 'custom']);

  const sleepRow = pm.ok ? sleepCheck(pm.stdout) : {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not read this Mac\'s sleep settings',
      detail: 'That setting decides whether your agents keep working when you walk away. You '
        + 'can see it in System Settings, under Lock Screen on a desktop or Battery on a laptop.',
  };
  // The button's gate travels ON the row (reliability-or-no-button): true
  // only when the pane was found on disk by id, whatever the row's state.
  sleepRow.settings = sleepPaneUrl(runner) !== null;

  const checks = [
    installedCheck(opts),
    sleepRow,
    restartCheck(runner),
  ];

  return {
    checks,
    // ⚠️ Counted separately, because the screen must never add them together.
    // "Two things need your attention" over one real problem and one thing we
    // could not read is a sentence that is false about half of what it counts.
    attention: checks.filter((c) => c.state === STATE.ATTENTION).length,
    unknown: checks.filter((c) => c.state === STATE.UNKNOWN).length,
    // ⚠️ Its OWN field, deliberately not one of `checks`. Where the app sits
    // has no bearing on whether an agent runs, so folding it into the rows
    // step 2 counts and step 4 filters made the wizard state a false cause:
    // "We could not find the Kosmos icon. An agent made now may not run until
    // that is sorted" -- on exactly the fresh-install path this check exists
    // for. Step 5 (getting back to Kosmos) is its one consumer. Separating it
    // at the SOURCE means no screen has to remember to exclude it.
    appLocation: appLocationCheck(opts),
  };
}

module.exports = { check, parsePmset, sleepCheck, installedCheck, appLocationCheck, appLocationUnknown, restartCheck, sleepPaneUrl, openSleepSettings, resetSleepPaneCache, STATE };
