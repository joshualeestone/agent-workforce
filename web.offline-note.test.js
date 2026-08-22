'use strict';

/**
 * What Kosmos says when nothing is answering at all (#269, Mona Lisa).
 *
 * 🛑 BAKING THE VERSION FIXED THE FACT AND NOT THE DEAD END. Josh's screen on
 * 2026-08-22 had five panels all correctly refusing and nothing anywhere to say
 * whether the app was broken, the machine had been asleep, or he should wait.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function slotAfter(calls, { baked = '0.2.87', host = '127.0.0.1:16180' } = {}) {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = {
    getElementById: (id) => (id === 'uoffline-slot' ? slot : null),
    querySelector: () => (baked === undefined ? null : { getAttribute: () => baked }),
  };
  const fn = new Function('document', 'esc', 'location',
    `${page.lift(SCRIPT, 'bakedVersion')}\n${page.lift(SCRIPT, 'paintOfflineNote')}\nreturn paintOfflineNote;`)(
    doc, (x) => String(x == null ? '' : x), host === null ? null : { host },
  );
  for (const down of calls) fn(down);
  return slot;
}

test('a poll that came back failing says so, with what it can still know', () => {
  const slot = slotAfter([true]);
  assert.match(slot.innerHTML, /Kosmos is not answering on this computer/);
  /* Both details survive a dead server: the version is baked into this page and
     the host is what the page was loaded from. */
  assert.match(slot.innerHTML, /Version 0\.2\.87 is loaded\./);
  assert.match(slot.innerHTML, /Nothing answered at 127\.0\.0\.1:16180\./);
});

test('it names no cause, because every cause produces the same failed fetch', () => {
  /* 🔑 A STOPPED SERVER, A CHANGED PORT, A FIREWALL AND A MACHINE THAT HAS JUST
     WOKEN are indistinguishable from here. If one of these words ever appears
     it is because somebody decided the page can tell, and that decision should
     be visible rather than arriving inside a copy tweak. */
  const said = slotAfter([true]).innerHTML.toLowerCase();
  for (const word of ['server', 'crashed', 'stopped', 'offline', 'restart', 'down', 'firewall', 'quit']) {
    assert.ok(!said.includes(word), `the note names a cause it cannot know: ${word}`);
  }
  /* ⚠️ And "not answering" rather than "not running": not running is a cause,
     not answering is what was observed. */
  assert.ok(!/not running/.test(said));
});

test('it is absent while the first poll is merely in flight', () => {
  /* 🛑 THE ARM WORTH WRITING, and the one most likely to be got wrong: on a slow
     machine the in-flight state and the failed state look identical to whoever
     is writing the code. A test that only asserts the note appears on rejection
     passes on a build that shows it immediately, which is the actual bug.

     Held open here by driving `tick` with a fetch that never settles, so the
     assertion is about the real caller rather than about my own restraint. */
  const slot = { dataset: {}, innerHTML: '' };
  const painted = [];
  let asked = 0;
  new Function('paintOfflineNote', 'fetch', 'document', 'INSTR_EPOCH',
    `${page.lift(SCRIPT, 'tick')}\ntick();`)(
    (down) => painted.push(down),
    () => { asked += 1; return new Promise(() => {}); },
    { getElementById: () => ({ dataset: {}, innerHTML: '', className: '', textContent: '', hidden: false, closest: () => null }) },
    0,
  );
  /* ⚠️ THE POSITIVE CONTROL FIRST. An empty `painted` also describes a `tick`
     that threw on line one, which would make this assertion pass for a reason
     that has nothing to do with the rule. */
  assert.equal(asked, 1, 'tick never reached the fetch, so its restraint proves nothing');
  assert.deepEqual(painted, [], 'something drew the note before any poll had answered');
  assert.equal(slot.innerHTML, '');
});

test('a poll that works clears it in the same paint', () => {
  /* ⚠️ A STALE FAILURE NOTICE OVER A WORKING BOARD is this note inverted: the
     board says everything is fine and the chrome says nothing is answering, and
     a person believes the alarming half. */
  const slot = slotAfter([true, false]);
  assert.equal(slot.innerHTML, '');
});

test('a second outage draws it again', () => {
  /* 🛑 THE FLAG THAT STOPS IT RE-ANNOUNCING EVERY FIVE SECONDS becomes a trap if
     a recovery does not clear it: the note would be permanently silent from the
     second outage on. The removed-list cache shipped exactly this bug. */
  const slot = slotAfter([true, false, true]);
  assert.match(slot.innerHTML, /not answering/);
});

test('it does not re-announce itself on every poll while the condition holds', () => {
  const slot = slotAfter([true]);
  const first = slot.innerHTML;
  slot.innerHTML = 'MARKED';
  slotAfterAgain(slot);
  assert.equal(slot.innerHTML, 'MARKED', 'the note rewrote itself over an unchanged state');
  assert.ok(first.length > 0);
});
function slotAfterAgain(slot) {
  const doc = { getElementById: () => slot, querySelector: () => ({ getAttribute: () => '0.2.87' }) };
  new Function('document', 'esc', 'location',
    `${page.lift(SCRIPT, 'bakedVersion')}\n${page.lift(SCRIPT, 'paintOfflineNote')}\nreturn paintOfflineNote;`)(
    doc, (x) => String(x), { host: 'h' },
  )(true);
}

test('it offers nothing to press', () => {
  /* The board already carries Try again and now says when it is looking, so a
     second retry here is two controls doing one job; a dismiss on a live
     condition is a note that lies on the next glance; and a countdown would
     imply the page knows something about the recovery. */
  const said = slotAfter([true]).innerHTML;
  assert.ok(!/<button/.test(said));
  assert.ok(!/Later|Dismiss|Retry|Try again/i.test(said));
});

test('a page with no version or no host still says the part it holds', () => {
  /* ⚠️ THE FAILURE DIRECTION. This runs when things are already wrong, so the
     path where a detail is unavailable is ordinary rather than exotic, and the
     primary sentence must never depend on one. */
  assert.match(slotAfter([true], { baked: '__KOSMOS_VERSION__' }).innerHTML, /not answering on this computer/);
  assert.ok(!/Version/.test(slotAfter([true], { baked: '__KOSMOS_VERSION__' }).innerHTML));
  assert.match(slotAfter([true], { host: null }).innerHTML, /not answering on this computer/);
});

test('it has its own slot, so it cannot overwrite the post-update note', () => {
  /* Both can be true at once, and in that order: a person who updates and then
     loses the server should see the update note explaining the outage. */
  assert.match(PAGE, /<div id="unote-slot"><\/div>/);
  assert.match(PAGE, /<div id="uoffline-slot"><\/div>/);
  assert.ok(PAGE.indexOf('id="unote-slot"') < PAGE.indexOf('id="uoffline-slot"'));
  assert.match(PAGE, /#uoffline-slot:empty \{ display: none; \}|#uoffline-slot:empty/);
});

test('nothing outside the poll ever paints it', () => {
  /* 🛑 THE OTHER WAY TO BREAK THE IN-FLIGHT RULE, and the test above cannot see
     it: that one drives `tick` in isolation, so a call added to the page's BOOT
     sequence paints the note on every load and every assertion still passes.
     Measured by adding exactly that and watching all nine stay green.

     🔑 So the claim is about WHERE the calls are, not about what one call does.
     Both live inside `tick`: one on the success path, one in the catch. A third
     anywhere else is a decision to draw this without a failed poll behind it. */
  const body = page.lift(SCRIPT, 'tick');
  const inTick = (body.match(/paintOfflineNote\(/g) || []).length;
  const inPage = (SCRIPT.match(/paintOfflineNote\(/g) || []).length;
  assert.equal(inTick, 2, 'the poll no longer both draws and clears the note');
  assert.equal(inPage - 1, inTick,
    'something outside the poll calls it, so the note can appear with no failed poll behind it');
});
