'use strict';

/**
 * The "Checking your computer" screen, and the two ways it lies if you write it
 * the obvious way.
 *
 *     node --test engine/machine.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const machine = require('./machine');

/* ---------------------------------------------------------------------------
   Fixtures, and where each one came from — because a fixture whose provenance
   nobody recorded is a guess with a filename.
--------------------------------------------------------------------------- */

/**
 * CAPTURED, verbatim, from `pmset -g custom` on the Mac mini this was written
 * on. A desktop: one section, because there is no battery to print a second one
 * for. Note `disksleep 10` sitting two lines under `sleep 0` — that pair is the
 * trap the parser exists to survive.
 */
const DESKTOP_AWAKE = `AC Power:
 Sleep On Power Button 1
 autorestartatconnect 0
 lowpowermode         0
 standby              0
 ttyskeepawake        1
 powernap             1
 displaysleep         0
 womp                 1
 networkoversleep     0
 sleep                0
 tcpkeepalive         1
 autorestart          1
 disksleep            10
`;

/** The same capture with the one value changed, which is the case it is for. */
const DESKTOP_SLEEPS = DESKTOP_AWAKE.replace(' sleep                0', ' sleep                10');

/**
 * ⚠️ RECONSTRUCTED, NOT CAPTURED. This machine is a Mac mini and has no
 * battery, so it can never print a `Battery Power` section — which is precisely
 * why the laptop path needs a fixture rather than a live read. The shape is
 * `pmset -g custom`'s documented two-section output: same keys, printed once
 * per power source, battery first.
 *
 * Said out loud because a fixture presented as measured, that was not, is how a
 * test ends up pinning the author's idea of a laptop instead of a laptop.
 */
const LAPTOP_SLEEPS_ON_BATTERY = `Battery Power:
 lidwake              1
 standby              1
 halfdim              1
 sleep                10
 displaysleep         2
 disksleep            10

AC Power:
 lidwake              1
 standby              1
 halfdim              1
 sleep                0
 displaysleep         10
 disksleep            10
`;

const LAPTOP_ALWAYS_AWAKE = LAPTOP_SLEEPS_ON_BATTERY.replace(' sleep                10', ' sleep                0');

/**
 * ⚠️ A REAL EXECUTABLE, not this test file. These fixtures used `__filename` —
 * a `.js` file with no execute bit — as a stand-in for a binary, which passed
 * for exactly as long as the check only asked whether something existed at the
 * path. It does not stand in for a binary, and the moment the probe started
 * asking whether it could be RUN, three tests were pinning a machine where
 * Claude is a text file.
 */
const REAL_BIN = '/bin/sh';

const okRunner = () => ({ ok: true, stdout: '' });
const deadRunner = () => ({ ok: false, because: 'command not found' });

/* ---------------------------------------------------------------------------
   Sleep
--------------------------------------------------------------------------- */

test('a Mac that never sleeps is reported as never sleeping', () => {
  const got = machine.sleepCheck(DESKTOP_AWAKE);
  assert.equal(got.state, 'ok', got.title);
  assert.match(got.title, /does not go to sleep/);
});

test('`disksleep 10` is not read as "this Mac sleeps after 10 minutes"', () => {
  /**
   * ⚠️ THE ONE THAT WOULD HAVE SHIPPED. `pmset` prints `disksleep`,
   * `displaysleep` and `sleep` in the same block, so a substring match for
   * `sleep\\s+(\\d+)` finds the "sleep            10" inside `disksleep 10` — on
   * a machine set never to sleep at all.
   *
   * The control first: the fixture really does contain the trap, so this test
   * cannot pass by being run against something that never had it.
   */
  assert.match(DESKTOP_AWAKE, /disksleep\s+10/,
    'the fixture no longer contains the trap this test is about');
  assert.match(DESKTOP_AWAKE, /^ sleep\s+0$/m,
    'the fixture no longer has a machine that never sleeps');

  const got = machine.sleepCheck(DESKTOP_AWAKE);
  assert.equal(got.state, 'ok',
    'a Mac set never to sleep was told its agents stop, because a substring of '
    + 'disksleep was read as the sleep setting');
  assert.ok(!/10/.test(got.title), `the disk-sleep value reached the screen: ${got.title}`);
});

test('`Sleep On Power Button 1` is not read as a sleep setting either', () => {
  // A three-word key with a number after it, in the same block. The parser takes
  // two-token lines only, so this one is skipped rather than misread as `sleep 1`.
  assert.match(DESKTOP_AWAKE, /Sleep On Power Button 1/,
    'the fixture no longer contains the second trap');
  assert.equal(machine.sleepCheck(DESKTOP_AWAKE).state, 'ok');
});

test('a Mac that sleeps after ten minutes says so, with the number', () => {
  const got = machine.sleepCheck(DESKTOP_SLEEPS);
  assert.equal(got.state, 'attention');
  assert.match(got.title, /10 minutes/);
  assert.match(got.detail, /System Settings/,
    'told somebody their machine sleeps without telling them where to change it');
});

test('a laptop that sleeps on battery is a warning, not a pass', () => {
  /**
   * ⚠️ THE CASE THE WIREFRAME'S DASHED NOTE IS ABOUT, and the one a check that
   * reads only the first section it finds gets wrong. Plugged in this machine
   * never sleeps; the person closes it at five o'clock and everything stops.
   */
  const got = machine.sleepCheck(LAPTOP_SLEEPS_ON_BATTERY);
  assert.equal(got.state, 'attention',
    'a laptop that stops working the moment it is unplugged was reported as fine, '
    + 'because its AC section says it never sleeps');
  assert.match(got.detail, /on battery/i);
  assert.match(got.detail, /10 minutes/);
});

test('a laptop set never to sleep on either power source passes', () => {
  const got = machine.sleepCheck(LAPTOP_ALWAYS_AWAKE);
  assert.equal(got.state, 'ok', got.title);
  assert.match(got.detail, /battery/i,
    'said nothing about the battery on the one kind of machine that has one');
});

test('output we cannot parse is unknown, never "fine"', () => {
  for (const junk of ['', 'pmset: command not found', 'AC Power:\n', '{"sleep": 0}']) {
    const got = machine.sleepCheck(junk);
    assert.equal(got.state, 'unknown',
      `unreadable pmset output (${JSON.stringify(junk)}) was reported as a state, not as `
      + 'us being unable to read it');
  }
});

test('a laptop whose battery section we cannot read is unknown, not fine', () => {
  // ⚠️ The half-answer. AC says never sleep, so the naive read is "ok" — but the
  // section that decides what happens when they unplug it is the unreadable one.
  const half = 'Battery Power:\n lidwake              1\n\nAC Power:\n sleep                0\n';
  const got = machine.sleepCheck(half);
  assert.equal(got.state, 'unknown',
    'the half we could read was reported as the whole answer');
  assert.match(got.detail, /battery/i);
});

test('a pmset that will not run at all does not become a passing check', () => {
  // appDirs sandboxed like every sibling: nothing here can flip on the real
  // /Applications, but a test that touches the real machine at all is one
  // more thing a reviewer must reason about.
  const os2 = require('node:os');
  const path2 = require('node:path');
  const fs2 = require('node:fs');
  const empty = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'kosmos-pmset-'));
  const got = machine.check({ runner: deadRunner, claudeBin: REAL_BIN, tmuxBin: REAL_BIN, appDirs: [empty, empty] });
  fs2.rmSync(empty, { recursive: true, force: true });
  const sleep = got.checks.find((c) => c.key === 'sleep');
  assert.equal(sleep.state, 'unknown');
  assert.equal(got.unknown >= 1, true);
});

test('the reassuring half of the battery answer is not asserted unchecked', () => {
  /**
   * ⚠️ MEASURED. This branch ran BEFORE the AC value was tested, so a laptop set
   * to sleep after ten minutes on AC, whose battery section could not be read,
   * was told "It does not go to sleep while it is plugged in." The verdict was
   * safely `unknown` the whole time, which is why it went unnoticed for a
   * while: the false thing was the sentence, not the state.
   */
  const acSleeps = 'Battery Power:\n lidwake              1\n\nAC Power:\n sleep                10\n';
  const got = machine.sleepCheck(acSleeps);
  assert.doesNotMatch(got.detail, /does not go to sleep while it is plugged in/,
    'told somebody their Mac stays awake on AC when the reading said it sleeps after ten minutes');

  /**
   * ⚠️ AND THE HALF WE DID READ IS REPORTED. The first correction of this branch
   * fixed the false sentence but left the answer at `unknown` with nothing but
   * the battery mentioned -- so a measured, actionable "this sleeps after ten
   * minutes plugged in" was thrown away because a DIFFERENT reading failed.
   * Half the answer was read and none of it was said.
   */
  assert.equal(got.state, 'attention',
    'a known, actionable sleep setting was demoted to "we could not tell" because the '
    + 'battery section was unreadable');
  assert.match(got.title, /10 minutes/);
  assert.match(got.detail, /battery/i,
    'stopped saying that the battery half is still unread');

  // The control: when AC really was read as never-sleep, it DOES say so.
  const acFine = 'Battery Power:\n lidwake              1\n\nAC Power:\n sleep                0\n';
  const fine = machine.sleepCheck(acFine);
  assert.equal(fine.state, 'unknown');
  assert.match(fine.detail, /does not go to sleep while it is plugged in/,
    'stopped saying the one true half it had actually checked');
});

test('a binary we cannot LOOK at is unknown, not "not installed"', () => {
  /**
   * ⚠️ THE ARM THAT COULD NEVER FIRE. Written around `fs.existsSync`, which
   * never throws — it swallows every error and answers false. So an unreadable
   * parent directory came out as the flat claim "an agent made now would not
   * start", which is cannot-see rendered as a checked negative.
   *
   * A directory with no execute permission is the cheapest real reproduction:
   * stat through it fails EACCES rather than ENOENT.
   */
  const fs = require('node:fs');
  const nodeOs = require('node:os');
  const nodePath = require('node:path');
  const dir = fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aw-perm-'));
  const inner = nodePath.join(dir, 'inner');
  fs.mkdirSync(inner);
  const hidden = nodePath.join(inner, 'claude');
  fs.writeFileSync(hidden, '#!/bin/sh\n');
  fs.chmodSync(hidden, 0o755);   // executable, so the ONLY obstacle is the parent dir
  fs.chmodSync(inner, 0o000);
  try {
    // The control: it really is unreadable in a way that is NOT "absent".
    let code = null;
    try { fs.statSync(hidden); } catch (err) { code = err.code; }
    if (code === null || code === 'ENOENT') return;   // running as root; nothing to test

    const got = machine.installedCheck({ claudeBin: hidden, tmuxBin: REAL_BIN });
    assert.equal(got.state, 'unknown',
      'a path we could not read was reported as a definite "not installed"');
    assert.match(got.detail, /could not see it|did not work/);
  } finally {
    fs.chmodSync(inner, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------------------
   Installed
--------------------------------------------------------------------------- */

test('the installed check asks the same question creation asks', () => {
  /**
   * ⚠️ NOT A SECOND DEFINITION. Creation resolves Claude and tmux through
   * `create.binPaths`; if this check looked them up on PATH instead it would
   * answer "not installed" on this very machine, where the board runs under
   * launchd with a PATH that has no `~/.local/bin` in it — while creation works.
   */
  const create = require('./create');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'machine.js'), 'utf8');
  assert.match(src, /create\.binPaths\(/,
    'machine.js no longer asks create.binPaths, so "is it installed" has been forked');
  // ⚠️ Matched against CODE, not prose. The first version of this line forbade
  // the word "which", which appears in six explanatory comments in that file —
  // so it failed on the sentence explaining why the rule exists. A test that
  // reads the commentary is testing the commentary.
  assert.ok(!/['"]which['"]|process\.env\.PATH|AGENT_WORKFORCE_CLAUDE_BIN/.test(src),
    'machine.js resolves the binaries itself again instead of asking create.binPaths');
  assert.equal(typeof create.binPaths, 'function');
});

test('both present is a pass; a missing one names it and says where we looked', () => {
  const nowhere = '/definitely/not/here/claude';

  const good = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  assert.equal(good.state, 'ok');

  const bad = machine.installedCheck({ claudeBin: nowhere, tmuxBin: REAL_BIN });
  assert.equal(bad.state, 'attention');
  assert.match(bad.title, /Claude Code/);
  assert.match(bad.detail, /\/definitely\/not\/here\/claude/,
    'told somebody something is missing without saying where it looked, which is the '
    + 'one piece of information that lets anybody fix it');
  assert.ok(!/tmux/.test(bad.title), 'named a thing that is present as missing');

  const both = machine.installedCheck({ claudeBin: nowhere, tmuxBin: '/nope/tmux' });
  assert.equal(both.state, 'attention');
  assert.match(both.detail, /Claude Code/);
  assert.match(both.detail, /tmux/);
});

test('something at the path is not the same as something we could run', () => {
  /**
   * ⚠️ BOTH OF THESE PASSED AS "Everything it needs to run is installed" while
   * the probe only asked whether anything was there. A directory called
   * `claude`, or a `claude` with no execute bit, produces a launchd job that
   * starts and fails silently — nothing on screen, nothing running, and a
   * setup screen that said it would work.
   */
  const fs2 = require('node:fs');
  const nodeOs = require('node:os');
  const nodePath = require('node:path');
  const dir = fs2.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aw-exec-'));
  try {
    const asDir = nodePath.join(dir, 'claude');
    fs2.mkdirSync(asDir);
    const notExec = nodePath.join(dir, 'tmux');
    fs2.writeFileSync(notExec, '#!/bin/sh\n');
    fs2.chmodSync(notExec, 0o644);

    // The controls: both really are present, which is what made them pass.
    assert.ok(fs2.existsSync(asDir) && fs2.existsSync(notExec),
      'the fixture no longer contains things that exist but cannot be run');

    const got = machine.installedCheck({ claudeBin: asDir, tmuxBin: notExec });
    assert.equal(got.state, 'attention',
      'a directory named claude and a tmux with no execute bit were both reported as installed');
    assert.match(got.detail, /claude/);
    assert.match(got.detail, /tmux/);
  } finally {
    fs2.rmSync(dir, { recursive: true, force: true });
  }
});

test('a definite finding survives the other probe being unreadable', () => {
  /**
   * ⚠️ THE SIBLING OF THE SLEEP FIX, UNFIXED FOR A WHILE. With Claude
   * genuinely absent and tmux unreadable, the early return on the unreadable
   * one won by arriving first: the whole check came back "We could not check
   * what is installed", naming only tmux, and `attention` fell to zero — so the
   * screen said nothing needed doing while Claude Code was definitively not
   * there. Half the answer was read and none of it was reported.
   */
  const fs2 = require('node:fs');
  const nodeOs = require('node:os');
  const nodePath = require('node:path');
  const dir = fs2.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aw-both-'));
  const inner = nodePath.join(dir, 'inner');
  fs2.mkdirSync(inner);
  const blocked = nodePath.join(inner, 'tmux');
  fs2.writeFileSync(blocked, '#!/bin/sh\n');
  fs2.chmodSync(blocked, 0o755);
  fs2.chmodSync(inner, 0o000);
  try {
    // The control: unreadable in a way that is NOT "absent", or there is no test.
    let code = null;
    try { fs2.statSync(blocked); } catch (err) { code = err.code; }
    if (code === null || code === 'ENOENT') return;    // root; nothing to test

    const got = machine.installedCheck({ claudeBin: '/definitely/not/here/claude', tmuxBin: blocked });
    assert.equal(got.state, 'attention',
      'a definitely-missing Claude was demoted to "we could not check" because the OTHER '
      + 'probe was unreadable');
    assert.match(got.detail, /\/definitely\/not\/here\/claude/,
      'the definite finding was dropped entirely');
    assert.match(got.detail, /could not check tmux/,
      'the unreadable half went unmentioned, so the screen looks like a complete answer');
  } finally {
    fs2.chmodSync(inner, 0o755);
    fs2.rmSync(dir, { recursive: true, force: true });
  }
});

test('a sleep value we cannot interpret is unknown, not "never sleeps"', () => {
  // ⚠️ `Number.isFinite` accepted -5, which is neither zero nor greater than
  // zero, so it fell through every branch into the pass: "This Mac does not go
  // to sleep". A reading we did not understand became a positive assertion.
  for (const v of ['-5', '1.5', 'never', '0x10', '+5', '']) {
    const got = machine.sleepCheck(`AC Power:\n sleep                ${v}\n`);
    assert.equal(got.state, 'unknown', `sleep=${v} was interpreted rather than refused`);
  }
  // The control: a value we DO understand still reads as a pass.
  assert.equal(machine.sleepCheck('AC Power:\n sleep                0\n').state, 'ok');
});

test('the install check refuses the same paths creation refuses', () => {
  /**
   * ⚠️ THE OTHER HALF OF THE SHARED-DEFINITION FIX. `binPaths` made the two
   * agree about WHERE to look; they still disagreed about which paths are
   * usable at all. `createAgent` rejects a path carrying a quote or a newline
   * outright, so such a path passed step 2 as "Everything it needs to run is
   * installed" and was flatly refused by creation two screens later.
   */
  const create = require('./create');
  const nasty = `/opt/homebrew/bin/tm"ux`;
  assert.equal(create.unusablePath(nasty), true,
    'the fixture is no longer a path creation would refuse');

  const got = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: nasty });
  assert.equal(got.state, 'attention',
    'a path creation will refuse was reported as installed and ready');
  assert.match(got.title, /tmux/);
});

/* ---------------------------------------------------------------------------
   Starting themselves
--------------------------------------------------------------------------- */

test('launchctl answering is a pass, and launchctl NOT answering is unknown', () => {
  const alive = machine.restartCheck(okRunner);
  assert.equal(alive.state, 'ok');
  /**
   * ⚠️ AND THE PASS DOES NOT OVERCLAIM. All that was established is that
   * launchctl answers for this login session: no plist was opened, no job was
   * listed, and no reboot has happened. The first version said "Your agents
   * will start themselves ... they come back on their own", directly under a
   * comment saying that claim is deliberately weaker than the wireframe's.
   */
  /**
   * ⚠️ AND IT IS A CLAIM ABOUT KOSMOS, NOT ABOUT ANYBODY'S AGENTS. "Your agents
   * are set to start themselves" was FALSE on the adopt path -- the fleet is
   * counted out of `tmux list-panes`, and an agent some other program started
   * may have no launchd job at all. Nothing here opens a plist or looks at one
   * of them, so the sentence is scoped to the agents this app makes, and says
   * out loud whose it is not talking about.
   */
  assert.match(alive.title, /Agents made here/,
    'the pass claims something about agents nobody looked at');
  assert.doesNotMatch(alive.title, /^Your agents/, 'the pass speaks for the whole fleet again');
  // Josh's one-line rewrite (2026-08-17): the scope caveat about other
  // programs' agents left the row with the pack's one-line rhythm.
  assert.match(alive.detail, /come back on their own after this Mac restarts/,
    'the ok row lost Josh\'s wording');

  /**
   * ⚠️ UNKNOWN, NOT ATTENTION. This test pinned `attention` in its first
   * version, which would have kept the wrong behaviour in place: launchctl not
   * answering means we could not ask, not that something is wrong. Counting it
   * as attention is exactly the miscount `check()` separates the two counters
   * to avoid.
   */
  const dead = machine.restartCheck(deadRunner);
  assert.equal(dead.state, 'unknown',
    'a check we could not run was counted as a problem needing action');
  // The pack's unknown row, at the pack's length (first-run spec, screen 4).
  assert.match(dead.detail, /could not look/);
});

test('the restart check asks launchctl about THIS login session', () => {
  // gui/<uid>, not the system domain: an agent's job is registered per-login, so
  // asking about anything else would answer a question nobody has.
  let asked = null;
  machine.restartCheck((cmd, args) => { asked = [cmd, args]; return { ok: true, stdout: '' }; });
  assert.equal(asked[0], '/bin/launchctl');
  assert.equal(asked[1][0], 'print');
  assert.match(asked[1][1], new RegExp(`^gui/${process.getuid()}$`));
});

/* ---------------------------------------------------------------------------
   The whole screen
--------------------------------------------------------------------------- */

test('three checks come back, and the two kinds of not-ok are counted apart', () => {
  // app-location gets DETERMINISTIC dirs: without appDirs this test would
  // read this machine's real /Applications and pass or fail by whether the
  // machine running the suite happens to have Kosmos installed.
  const os = require('node:os');
  const nodePath = require('node:path');
  const fs = require('node:fs');
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-check-'));
  fs.mkdirSync(nodePath.join(sb, 'Kosmos.app'));
  const got = machine.check({
    pmset: DESKTOP_SLEEPS,             // one real problem
    claudeBin: REAL_BIN,
    tmuxBin: REAL_BIN,
    runner: okRunner,
    appDirs: [sb, sb],
  });
  fs.rmSync(sb, { recursive: true, force: true });
  assert.equal(got.checks.length, 3);
  assert.deepEqual(got.checks.map((c) => c.key), ['installed', 'sleep', 'restart']);
  assert.equal(got.attention, 1);
  assert.equal(got.unknown, 0);
  // Beside the rows, never among them: where the app sits has no bearing on
  // whether an agent runs, so it must not join what step 2 counts and step 4
  // captions as "an agent made now may not run until that is sorted".
  assert.equal(got.appLocation.state, machine.STATE.OK);

  /**
   * ⚠️ NOT ADDED TOGETHER. "Two things need your attention" over one real
   * problem and one thing we could not read is a sentence that is false about
   * half of what it counts — and it is false in the direction that makes a
   * person go looking for a problem that does not exist.
   */
  const sb2 = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-check2-'));
  const mixed = machine.check({
    pmset: 'nonsense',
    claudeBin: '/nope/claude',
    tmuxBin: REAL_BIN,
    runner: okRunner,
    // Deliberately EMPTY, so the app-location answer is attention -- and the
    // counts below prove that attention is not added to the rows'. Folding it
    // in is exactly how the wizard came to state a false cause on the
    // fresh-install path.
    appDirs: [sb2, sb2],
  });
  fs.rmSync(sb2, { recursive: true, force: true });
  assert.equal(mixed.attention, 1);
  assert.equal(mixed.unknown, 1);
  assert.equal(mixed.appLocation.state, machine.STATE.ATTENTION,
    'the premise of the count assertion above: app-location IS attention here, and still not counted');
});

test('every check reports one of exactly three states, and always says something', () => {
  // A guard on the shape rather than on any one message: a check that returns a
  // state the screen has no branch for renders as nothing at all.
  // appDirs pinned to an empty sandbox: a stat of the machine's real
  // /Applications is read-only and shape-safe, but a test that touches the
  // real machine at all is one more thing a reviewer must reason about.
  const os = require('node:os');
  const nodePath = require('node:path');
  const empty = require('node:fs').mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-shape-'));
  const runs = [
    machine.check({ pmset: DESKTOP_AWAKE, claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: okRunner, appDirs: [empty, empty] }),
    machine.check({ pmset: LAPTOP_SLEEPS_ON_BATTERY, claudeBin: '/nope', tmuxBin: '/nope', runner: deadRunner, appDirs: [empty, empty] }),
    machine.check({ pmset: 'junk', claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: deadRunner, appDirs: [empty, empty] }),
  ];
  require('node:fs').rmSync(empty, { recursive: true, force: true });
  for (const got of runs) {
    // The shape rule covers appLocation too: it renders through the same row
    // grammar on step 5, so a state the screen has no branch for is the same
    // nothing-at-all there as in the rows.
    for (const c of [...got.checks, got.appLocation]) {
      assert.ok(['ok', 'attention', 'unknown'].includes(c.state), `bad state: ${c.state}`);
      assert.ok(c.title && c.title.length > 0, `${c.key} has no title`);
      assert.ok(c.detail && c.detail.length > 0, `${c.key} has no detail`);
    }
  }
});

test('nothing in here changes a setting', () => {
  /**
   * ⚠️ The wireframe draws a "Change this for me" button. Doing it needs
   * `sudo pmset`, which this server cannot ask for — so the button would offer
   * something it cannot do. This pins the decision: if somebody adds the write
   * later it has to be a deliberate act, not a quiet one.
   */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'machine.js'), 'utf8');
  assert.ok(!/pmset['"\s,\]]*.*(-a|-b|-c)\b/.test(src.replace(/\*.*$/gm, '')),
    'machine.js now runs pmset with a setting flag, which writes power settings');
  assert.ok(!/\bsudo\b/.test(src.replace(/^\s*\*.*$/gm, '')),
    'machine.js now shells out to sudo');
});

test('an unreadable AC section does not throw away a readable battery one', () => {
  /**
   * ⚠️ THE SAME DEFECT, MIRRORED, IN THE SAME FUNCTION. The "report the known
   * half first" fix was made for an unreadable BATTERY section and not for an
   * unreadable AC one, so a laptop whose battery section says it sleeps after
   * ten minutes came back as a flat "we could not tell whether this Mac goes
   * to sleep" — discarding a measured, actionable finding because a different
   * reading failed.
   */
  const acJunk = 'Battery Power:\n sleep                10\n\nAC Power:\n sleep                x\n';
  const got = machine.sleepCheck(acJunk);
  assert.equal(got.state, 'attention',
    'a known battery sleep setting was demoted to "we could not tell" by an unreadable AC section');
  assert.match(got.title, /battery/i);
  assert.match(got.title, /10 minutes/);
  assert.match(got.detail, /could not read what it does while it is plugged in/,
    'said nothing about the half it genuinely could not read');

  // The control: with BOTH unreadable there really is nothing to report.
  const bothJunk = 'Battery Power:\n sleep                y\n\nAC Power:\n sleep                x\n';
  assert.equal(machine.sleepCheck(bothJunk).state, 'unknown',
    'invented a finding out of two unreadable sections');
});

test('when both power sources sleep, the shorter one is not left unsaid', () => {
  // ⚠️ Reporting only the AC number on a laptop that sleeps after a minute on
  // battery names the longer of the two intervals and hides the one that bites.
  const got = machine.sleepCheck('Battery Power:\n sleep                1\n\nAC Power:\n sleep                5\n');
  assert.equal(got.state, 'attention');
  assert.match(got.title, /5 minutes/);
  assert.match(got.detail, /On battery it sleeps after 1 minute/,
    'the shorter interval went unmentioned');
});

test('a path we refuse on sight is not described as a path we looked at', () => {
  /**
   * ⚠️ "We looked for tmux at <path>" is a sentence about an action nobody
   * took. These are refused on sight — so if the binary really is at that path,
   * the person checks, finds it exactly where the screen says it is not, and
   * the actual cause (a quote in the path) is named nowhere at all.
   */
  const quoted = `/opt/home${String.fromCharCode(39)}brew/bin/tmux`;
  const create = require('./create');
  assert.equal(create.unusablePath(quoted), true, 'the fixture is no longer a refused path');

  const got = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: quoted });
  assert.equal(got.state, 'attention');
  assert.ok(!/We looked for/.test(got.detail),
    'claimed to have looked at a path it refused on sight');
  assert.match(got.detail, /quote|backslash|line break/,
    'never names the character that is actually the problem');
  assert.match(got.title, /not where we can use it/i);
});

test('every bucket gets said, not just the first one that returns', () => {
  /**
   * ⚠️ THE THIRD TIME THIS FUNCTION DROPPED A FINDING BY RETURNING EARLY.
   * `unreadable` beat `missing` first; then `unusable` was added with its own
   * early return AHEAD of both, so a genuinely absent Claude went unmentioned
   * whenever the tmux path happened to carry a quote. Measured, and reachable
   * in real life by a home directory with an apostrophe in it.
   *
   * The two earlier fixes were local; this asserts the structural property, so
   * a fourth bucket added later cannot quietly reintroduce it.
   */
  const quoted = `/opt/home${String.fromCharCode(39)}brew/bin/tmux`;
  const got = machine.installedCheck({ claudeBin: '/definitely/not/here/claude', tmuxBin: quoted });
  assert.equal(got.state, 'attention');
  assert.match(got.detail, /\/definitely\/not\/here\/claude/,
    'a definitely-absent Claude went unmentioned because the OTHER path was refused');
  assert.match(got.detail, /home.brew\/bin\/tmux/,
    'the refused path went unmentioned');
  assert.match(got.title, /Some of what it needs/,
    'the heading names one problem when there are two');
});

test('the app-location check looks in both folders and answers all four states', () => {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-apploc-'));
  const sys = path.join(sb, 'Applications');
  const home = path.join(sb, 'home-Applications');
  fs.mkdirSync(sys); fs.mkdirSync(home);

  // Nowhere: attention, with the absence-is-not-absence sentence.
  const none = machine.appLocationCheck({ appDirs: [sys, home] });
  assert.equal(none.state, machine.STATE.ATTENTION);
  assert.match(none.detail, /not the same as it not being there/);
  assert.match(none.detail, /Spotlight/);

  // In the system folder: ok, the plain Applications title.
  fs.mkdirSync(path.join(sys, 'Kosmos.app'));
  const there = machine.appLocationCheck({ appDirs: [sys, home] });
  assert.equal(there.state, machine.STATE.OK);
  assert.match(there.title, /your Applications folder/);
  assert.ok(!/home folder/.test(there.title));

  // In the home folder only: ok, the home-folder title (the installer's own
  // wording for the fallback that confused the first clean-machine tester).
  fs.rmdirSync(path.join(sys, 'Kosmos.app'));
  fs.mkdirSync(path.join(home, 'Kosmos.app'));
  const homey = machine.appLocationCheck({ appDirs: [sys, home] });
  assert.equal(homey.state, machine.STATE.OK);
  assert.match(homey.title, /inside your home folder/);

  // A FILE named Kosmos.app is not the app: keep looking, find the real one.
  fs.rmdirSync(path.join(home, 'Kosmos.app'));
  fs.writeFileSync(path.join(sys, 'Kosmos.app'), 'not an app');
  fs.mkdirSync(path.join(home, 'Kosmos.app'));
  const past = machine.appLocationCheck({ appDirs: [sys, home] });
  assert.equal(past.state, machine.STATE.OK, 'a file wearing the name must not stop the look');
  assert.match(past.title, /inside your home folder/);

  // An unreadable FIRST folder does not end the look: the app sitting in the
  // second one is still a definite yes. (This is the recovered half of the
  // could-not-look rule; the eager-unknown version told this machine "we
  // could not check" with the answer one iteration away.)
  // ⚠️ Skipped as root, stated loudly: root stats through mode 000, so the
  // sealed folder stops sealing and both this case and the blind one below
  // would assert against a premise that does not hold.
  const sealed = path.join(sb, 'sealed');
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    console.log('  (running as root: sealed-folder cases skipped, mode 000 does not seal for root)');
  } else {
    try {
      fs.mkdirSync(sealed, { mode: 0o000 });
      const recovered = machine.appLocationCheck({ appDirs: [path.join(sealed, 'Applications'), home] });
      assert.equal(recovered.state, machine.STATE.OK,
        'an unreadable first folder must not eat a find in the second');

      // Could not look ANYWHERE it mattered: unknown, and the copy insists
      // nothing is wrong. Home is emptied first -- with the app still there,
      // this case would be the recovered one above.
      fs.rmdirSync(path.join(home, 'Kosmos.app'));
      const blind = machine.appLocationCheck({ appDirs: [path.join(sealed, 'Applications'), home] });
      assert.equal(blind.state, machine.STATE.UNKNOWN);
      assert.match(blind.detail, /Nothing is wrong/);
    } finally {
      // In a finally: an assertion throw between mkdir and here used to leave
      // an unreadable folder in tmp that rmSync could not remove.
      try { fs.chmodSync(sealed, 0o755); } catch { /* never made */ }
    }
  }

  // The injected-extra branch (a third directory) renders copy that names
  // no folder in title OR detail -- reachable only from tests, which is
  // exactly why a test has to be the thing that renders it.
  fs.mkdirSync(path.join(home, 'Kosmos.app'), { recursive: true });
  const extra = machine.appLocationCheck({ appDirs: [sys, sys, home] });
  assert.equal(extra.state, machine.STATE.OK);
  assert.match(extra.title, /found the Kosmos icon on this Mac/);
  assert.ok(!/folder/.test(extra.title), 'the extra-dir title must name no folder');
  assert.match(extra.detail, /from where you found it/);
  fs.rmSync(path.join(home, 'Kosmos.app'), { recursive: true, force: true });

  // A malformed override THROWS rather than silently probing the real machine.
  assert.throws(() => machine.appLocationCheck({ appDirs: [] }), /non-empty list of folders/);
  assert.throws(() => machine.appLocationCheck({ appDirs: sys }), /non-empty list of folders/);
  // A non-string ELEMENT is the half that matters: path.join would TypeError
  // inside the look and fabricate a could-not-look no test would question.
  assert.throws(() => machine.appLocationCheck({ appDirs: [123] }), /non-empty list of folders/);

  fs.rmSync(sb, { recursive: true, force: true });
});

test('the app-location answer rides BESIDE the machine report, never among its rows', () => {
  const os = require('node:os');
  const nodePath = require('node:path');
  const fs = require('node:fs');
  // Deterministic dirs and a stubbed runner: this test used to read the real
  // /Applications and shell out to the real launchctl under a green run.
  const empty = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-join-'));
  const got = machine.check({ pmset: 'sleep 0', claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: okRunner, appDirs: [empty, empty] });
  fs.rmSync(empty, { recursive: true, force: true });
  assert.equal(got.appLocation.key, 'app-location',
    'the /api/machine payload must carry the app-location answer for first-run step 5');
  assert.ok(!got.checks.some((c) => c.key === 'app-location'),
    'in the rows, step 2 counts it and step 4 captions it as a reason an agent may not run');
});

test('the sleep-pane capability: derived from disk by id, refusing honestly, never caller-named', () => {
  const machine = require('./machine');
  try {
    // With a runner that answers the accepted id, the URL is built FROM THE
    // ID THE PLIST ANSWERED, not from a table keyed on anything else.
    machine.resetSleepPaneCache();
    const asked = [];
    const url = machine.sleepPaneUrl((cmd, args) => {
      asked.push([cmd, args]);
      return { ok: true, stdout: 'com.apple.Battery-Settings.extension\n' };
    }, () => ['FakePowerPane.appex']);
    assert.equal(url, 'x-apple.systempreferences:com.apple.Battery-Settings.extension');
    assert.ok(asked.every(([cmd]) => cmd === '/usr/bin/defaults'), 'the probe ran something other than defaults');

    // An id OUTSIDE the accepted set is not a pane we claim: no button, no
    // guessing (reliability-or-no-button).
    machine.resetSleepPaneCache();
    const none = machine.sleepPaneUrl(
      () => ({ ok: true, stdout: 'com.apple.SomethingElse.extension\n' }),
      () => ['FakePowerPane.appex']);
    assert.equal(none, null, 'an unrecognised pane id produced a URL');

    // A dir with no matching appex, and a dir that cannot be read at all:
    // both are the no-button world, never a throw (the safe failure).
    assert.equal(machine.sleepPaneUrl(() => { throw new Error('runner must not be called'); }, () => []), null);
    assert.equal(machine.sleepPaneUrl(() => { throw new Error('runner must not be called'); }, () => { throw new Error('EACCES'); }), null);

    // ⚠️ And an injected world never touches the cache in either direction:
    // the real probe after an injected one answers from the real machine,
    // not from the injection.
    machine.resetSleepPaneCache();
    machine.sleepPaneUrl(() => ({ ok: true, stdout: 'com.apple.Battery-Settings.extension' }), () => ['FakePowerPane.appex']);
    const realAfterInjected = machine.sleepPaneUrl();
    const realFresh = (machine.resetSleepPaneCache(), machine.sleepPaneUrl());
    assert.equal(realAfterInjected, realFresh, 'an injected probe wrote the cache the real world then read');

    // openSleepSettings derives the URL itself and hands `open` exactly that
    // string; with no pane it refuses with its sentence and runs nothing.
    machine.resetSleepPaneCache();
    let opened = null;
    const ok = machine.openSleepSettings((cmd, args) => {
      if (cmd === '/usr/bin/defaults') return { ok: true, stdout: 'com.apple.Energy-Saver-Settings.extension' };
      opened = [cmd, args];
      return { ok: true, stdout: '' };
    }, () => ['FakePowerPane.appex']);
    assert.equal(ok.ok, true);
    assert.deepEqual(opened, ['/usr/bin/open', ['x-apple.systempreferences:com.apple.Energy-Saver-Settings.extension']]);

    machine.resetSleepPaneCache();
    let ran = 0;
    const refused = machine.openSleepSettings((cmd) => {
      if (cmd === '/usr/bin/defaults') return { ok: false, stdout: '' };
      ran += 1;
      return { ok: true, stdout: '' };
    }, () => ['FakePowerPane.appex']);
    assert.equal(refused.ok, false);
    assert.match(refused.because, /could not find the sleep settings screen/);
    assert.equal(ran, 0, 'open ran with no pane found');
  } finally {
    machine.resetSleepPaneCache();
  }
});

test('the sleep row carries the settings flag from the same probe', () => {
  const machine = require('./machine');
  try {
    machine.resetSleepPaneCache();
    const got = machine.check({
      pmset: DESKTOP_AWAKE,
      lister: () => ['FakePowerPane.appex'],
      runner: (cmd) => (cmd === '/usr/bin/defaults'
        ? { ok: true, stdout: 'com.apple.Battery-Settings.extension' }
        : { ok: true, stdout: '' }),
    });
    const sleep = got.checks.find((c) => c.key === 'sleep');
    assert.equal(sleep.settings, true, 'the pane exists but the row does not offer the button');

    machine.resetSleepPaneCache();
    const without = machine.check({
      pmset: DESKTOP_AWAKE,
      lister: () => ['FakePowerPane.appex'],
      runner: (cmd) => (cmd === '/usr/bin/defaults' ? { ok: false, stdout: '' } : { ok: true, stdout: '' }),
    });
    const sleep2 = without.checks.find((c) => c.key === 'sleep');
    assert.equal(sleep2.settings, false, 'no pane found but the row still offers the button');
  } finally {
    machine.resetSleepPaneCache();
  }
});

test('revealApp opens Finder at the icon it re-derives, and refuses honestly when there is none', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-reveal-'));
  fs.mkdirSync(nodePath.join(dir, 'Kosmos.app'));
  let empty = null;
  let args = null;
  machine.setAppRevealRunner((cmd, a) => { args = [cmd, a]; });
  try {
    // Found: open -R at the RE-DERIVED path, nothing from any caller.
    const got = machine.revealApp({ appDirs: [dir] });
    assert.deepEqual(got, { ok: true });
    assert.deepEqual(args, ['/usr/bin/open', ['-R', nodePath.join(dir, 'Kosmos.app')]]);

    // A FILE named Kosmos.app is not the app; the refusal sentence says
    // what to do, not what threw.
    empty = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-reveal-none-'));
    fs.writeFileSync(nodePath.join(empty, 'Kosmos.app'), 'not a bundle');
    args = null;
    assert.throws(() => machine.revealApp({ appDirs: [empty] }), /could not find the Kosmos icon just now/);
    assert.equal(args, null, 'a refusal ran the opener anyway');

    // The same malformed-override guard as the check.
    assert.throws(() => machine.revealApp({ appDirs: [] }), /non-empty list of folders/);

    // Errored is NOT not-found: a folder we cannot read refuses with the
    // could-not-look sentence, never the not-there one. (Mode 000 does not
    // seal for root, same caveat as the render harness's blind fixture.)
    const sealed = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-reveal-sealed-'));
    fs.chmodSync(sealed, 0o000);
    try {
      args = null;
      assert.throws(() => machine.revealApp({ appDirs: [nodePath.join(sealed, 'Applications')] }),
        /could not look just now/);
      assert.equal(args, null, 'a could-not-look refusal ran the opener anyway');
    } finally {
      fs.chmodSync(sealed, 0o755);
      fs.rmSync(sealed, { recursive: true, force: true });
    }
  } finally {
    machine.setAppRevealRunner(null);
    // Leaked sandboxes are how one test's world becomes another's -- the
    // server suite's after-hook says why; this test holds the same line.
    fs.rmSync(dir, { recursive: true, force: true });
    if (empty) fs.rmSync(empty, { recursive: true, force: true });
  }
});
