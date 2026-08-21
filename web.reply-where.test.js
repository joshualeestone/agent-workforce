'use strict';

/**
 * 🛑 THE LINE THIS FILE WAS WRITTEN FOR IS GONE, and its removal is the point.
 *
 * 0.2.12 shipped "Replies come back there rather than here, for now" because an
 * agent had nowhere to write. The reply path gave it somewhere, so the sentence
 * became false four hours after it shipped — and leaving it would have told
 * somebody not to look at the box the answer had just landed in.
 *
 * ⚠️ AND THE LABEL DID NOT WORK EVEN WHILE IT WAS TRUE. Josh read it, waited,
 * apologised to his agent and asked again, with the sentence directly above the
 * box he typed into. A sentence explaining why a box does not do the thing it
 * looks like it does loses to the box looking like it does that thing. The
 * remedy was never better copy.
 *
 * What survives here are the checks that outlived it: the Settings row, and the
 * box's own two standing sentences.
 *
 * The line that stopped the direct box implying a reply it could not carry.
 *
 * 🛑 WHY IT EXISTS. An agent cannot write into a direct thread: the stored
 * record has no field for a sender, so every entry is the person's message to
 * the agent (#175). Meanwhile the box heads itself "Just between you and
 * <name>", which describes a two-way place. Josh said hello to a new agent,
 * saw the answer in her terminal, saw nothing here, and waited.
 *
 * ⚠️ IT FIXES NOTHING, and the test is written to that: it pins that the screen
 * stops implying the conversation, and that it says where the answer actually
 * is. An admission that leaves somebody with nowhere to go is half a fix.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('the element sits above the persistence note, not below it', () => {
  /**
   * ⚠️ PLACEMENT IS THE POINT (Mona Lisa): by the time somebody reaches the
   * bottom of a box they have already decided what it does. The restart note
   * has been at the foot all along and Josh never mentioned it.
   */
  const reply = PAGE.indexOf('id="d-reply-where"');
  const persist = PAGE.indexOf('id="d-persist"');
  const composer = PAGE.indexOf('id="d-send"');
  assert.notEqual(reply, -1);
  /* ⚠️ MEASURED AND THE COMMENT WAS WRONG ABOUT ITS OWN PLACEMENT. DOM order is
     composer → send-result alert → this line → the restart note. It is BELOW
     the composer, second to last. The claim that it "sits by the composer,
     above the foot" was not true of where it landed.
     🔑 What it IS adjacent to is the send button and the result of sending,
     which is where a person looks after pressing it — so the position is
     defensible and the sentence describing it was not. Pinning what is true. */
  assert.ok(composer < reply, 'the line moved above the composer; the comment describes it as following the send controls');
  assert.ok(reply < persist, 'the line was moved below the restart note, which is where notes go to be unread');
});

test('the box still says the two things it said before', () => {
  /**
   * ⚠️ A CONTROL ON THE EDIT, not decoration. Both sentences are ruled copy and
   * neither is what was wrong: "just between you and <name>" is true, and the
   * thread really does outlive the agent's recollection. The defect was
   * something MISSING, so nothing should have been removed.
   */
  assert.match(PAGE, /Just between you and ' \+ name \+ '\. Nothing here belongs to a project\./);
  /* 🛑 THE SENTENCE, NOT THE ELEMENT. This read /id="d-persist"/, which is the
     markup's id attribute — MEASURED: deleting the whole
     `d-persist.textContent = 'This stays here after a restart. '…` assignment
     left an empty <p> and passed. A control that an empty element satisfies is
     not a control on the words.
     ⚠️ And it must be pinned at the ASSIGNMENT, because the phrase occurs twice
     in the file and the second is inside a comment about it, which survives the
     deletion on its own. */
  const persistAt = PAGE.indexOf("document.getElementById('d-persist').textContent");
  assert.notEqual(persistAt, -1, 'the persistence sentence is no longer written anywhere');
  assert.match(PAGE.slice(persistAt, persistAt + 200), /stays here after a restart/,
    'the persistence sentence was removed or changed');
});

// ─────────────────────────────────────────────────────────────────────────────
// "<name> is working…" (#176)
// ─────────────────────────────────────────────────────────────────────────────

function fn(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page`);
  let d = 0; let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') d++;
    else if (PAGE[i] === '}') { d--; if (d === 0) break; }
  }
  // eslint-disable-next-line no-new-func
  return PAGE.slice(at, i + 1);
}

test('it says WORKING, and never that the agent is replying to you', () => {
  /**
   * 🔑 THE ONE CONSTRAINT ON THIS FEATURE. We can see that Claude is producing
   * output. We cannot see WHAT it is working on, and "<name> is typing" claims
   * it is composing a reply to YOU — the same row of `engine/chat.js`'s claim
   * table as "the agent received it", which that table marks never.
   *
   * ⚠️ It matters MORE here than in a chat app, not less: this box is the one
   * surface where nothing comes back at all (#175), so a person reads the line
   * as evidence rather than as decoration.
   */
  /* ⚠️ RE-POINTED WHEN THE ROOM GREW THE SAME LINE (#176): the sentence moved
     into `busyRow`, the shared builder, and this read `paintBusy`'s source —
     so it went red for a refactor that changed no behaviour, and would have
     gone GREEN for one that kept the words in paintBusy and shipped a room line
     saying something else entirely.
     🔑 So it reads the BUILDER, and the vocabulary rule below is checked over
     every function that can put words on either surface — which is the property
     the test is actually about.
     ⚠️ Still a source read, said plainly: `fn` returns text, not a callable,
     so this pins the words rather than the output. It is the same instrument
     the rest of this file uses; what changed is that it is now aimed at the
     function that holds the sentence and at all three that could reintroduce
     the claim. */
  /* ⚠️ RE-POINTED AGAIN when the room grew a GROUPED line (Josh, 2026-08-21):
     the verb became a shared constant, so `busyRow`'s source no longer contains
     the word and this went red for a refactor that changed no behaviour — the
     second time this test has been aimed at the wrong thing in one day.
     🔑 The constant IS the claim now, so that is what is pinned, and the
     vocabulary rule below covers every function that could reintroduce the
     stronger word on either surface. */
  const decl = PAGE.match(/const WORKING_VERB = '([^']+)'/);
  assert.ok(decl, 'the shared verb vanished; the two surfaces can drift again');
  assert.equal(decl[1], 'working', 'the line no longer says what it can see');
  /* And the vocabulary rule holds over the source of every function that can
     put words on either surface, so a future arm cannot introduce the claim on
     a path this render does not reach. */
  /* ⚠️ COMMENTS STRIPPED FIRST, and that is not a loophole — it is the rule
     stated correctly. What must never say "typing" is what the page EMITS. The
     comment above `paintRoomBusy` quotes Josh's reference ("Splinter, Mona
     Lisa, and Angel are typing...") precisely in order to record why we do not
     use the word, and an unstripped check called that a violation. A check that
     cannot tell a word USED from a word DISCUSSED punishes the explanation and
     would be silenced by deleting it, which is the opposite of what it is for. */
  const code = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (const name of ['busyRow', 'paintBusy', 'paintRoomBusy']) {
    assert.doesNotMatch(code(fn(name)), /typing|replying|composing|answering/i,
      name + ' claims to know what the agent is working ON');
  }
  /* 🔑 AND THE STRIPPER IS PROVED, or it could be silently eating everything:
     the forbidden word in real code must still be caught. */
  assert.match(code("const x = 'is typing'; /* typing */"), /typing/,
    'the comment stripper ate the code as well, so this check certifies nothing');
  assert.doesNotMatch(code('/* is typing */ const x = 1;'), /typing/,
    'the comment stripper did not strip a comment');
});

test('only a card that positively says working produces the line', () => {
  /**
   * ⚠️ UNKNOWN SHOWS NOTHING — not working, not idle. An agent we cannot read
   * must not be rendered as either, which is the same rule as the stale badge
   * and the memory caption. So the test is on the COMPARISON, not on the
   * absence of an else-branch.
   */
  const src = fn('paintBusy');
  assert.match(src, /fresh\.state === 'working'/,
    'the line is derived from something other than a positive working state');
  assert.match(src, /!!\(fresh && /, 'a missing card no longer resolves to not-busy');
});

test('it is painted on open AND on the poll, off the poll’s existing lookup', () => {
  /**
   * ⚠️ ON OPEN, because painted only by the poll it is absent for up to five
   * seconds after somebody opens the page — the exact moment they are looking.
   * ⚠️ AND OFF THE POLL'S EXISTING `fresh`, because a second `find()` for the
   * same card is the one-fact-two-derivations habit this file keeps paying for.
   */
  assert.equal(PAGE.split('paintBusy(').length - 1, 3,
    'expected exactly one definition and two callers (open, poll)');
  const at = PAGE.indexOf("const fresh = data.agents.find");
  assert.notEqual(at, -1);
  assert.match(PAGE.slice(at, at + 3400), /paintBusy\(fresh,/,
    'the poll no longer paints it, or paints it from its own lookup');
  /* ⚠️ The window is 3400 chars because the block between the lookup and this
     call is largely comment; it is a bound on "same block", not a measurement
     of anything. A tighter number would fail on a comment edit. */
  const open = PAGE.indexOf('function openDetail(');
  assert.match(PAGE.slice(open, open + 900), /paintBusy\(a, a\.name\)/,
    'opening the page no longer paints it');
});

test('Settings no longer claims the chat carries what an agent says', () => {
  /**
   * 🛑 THE FALSE CLAIM STATED OUTRIGHT. The Engineering-mode row read "Off by
   * default. Your chat shows what an agent says to you." — while an agent
   * cannot write into a direct thread at all (#175). A person read it, believed
   * the chat would carry the answer, and waited.
   *
   * ⚠️ IT SURVIVED BECAUSE IT IS HALF TRUE: agents do post into a project room,
   * and this screen is global, so it generalised from the case that works.
   *
   * ⚠️ AND THE ASSERTION IS SCOPED TO THE RENDERED ROW, not to the file: the
   * sentence still appears once, inside the comment that records removing it,
   * and a count of zero would force deleting the record of why.
   */
  const row = PAGE.indexOf('id="eng-row"');
  assert.notEqual(row, -1, 'the Engineering-mode row has moved');
  const end = PAGE.indexOf('</div>', PAGE.indexOf('<p class="dhint"', row));
  const rendered = PAGE.slice(row, end).replace(/<!--[\s\S]*?-->/g, ' ');

  assert.doesNotMatch(rendered, /chat shows what an agent says/,
    'the row claims the chat carries what an agent says, which is false of the direct box');
  assert.match(rendered, /Off by default/, 'the row no longer says the toggle is off by default');
  assert.match(rendered, /raw session/, 'the row no longer says what the toggle actually shows');
});

test('the reply-location line is gone, and gone rather than reworded', () => {
  /**
   * 🛑 IT SAID "Replies come back there rather than here", which this branch
   * makes false. A reworded version would be a new apology for a box that no
   * longer needs one, and the element is kept only so nothing else that touches
   * it throws.
   */
  /* ⚠️ COMMENTS STRIPPED FIRST, and the first version of this failed on the
     RECORD OF THE REMOVAL — the comments explaining why the sentence went do
     quote it, which is exactly what they are for. A check a correct
     implementation cannot satisfy is not a check, and this is the third time
     today that shape has appeared. Both comment forms, because this file
     carries HTML and JS ones. */
  const code = PAGE.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.doesNotMatch(code, /Replies come back there rather/,
    'the box still tells the person the reply is somewhere else');
  assert.doesNotMatch(code, /will see this in their own window/,
    'a reworded version of the same apology came back');
  /* ⚠️ AND THE STRIPPER NEEDS ITS OWN CONTROL, or a regex that ate the file
     would make every absence above vacuous. */
  assert.ok(code.includes("getElementById('d-reply-where')"), 'the comment stripper removed code');

  const at = PAGE.indexOf("document.getElementById('d-reply-where').hidden = true;");
  assert.notEqual(at, -1, 'the element is no longer hidden, so an empty line may take space');
});

test('the Settings row can say what the chat holds again, and still does not overclaim', () => {
  /**
   * ⚠️ THE SENTENCE DROPPED THIS AFTERNOON — "Your chat shows what an agent says
   * to you" — became TRUE with this branch. It is deliberately NOT restored: it
   * was doing a reassurance job on a screen that cannot know which surface you
   * mean, and it is true of the direct box and still false of nothing else that
   * matters. Mona Lisa's ruling was to drop rather than correct, and the reason
   * she gave (the row's job is what the toggle does) did not depend on the
   * sentence being false.
   */
  const row = PAGE.indexOf('id="eng-row"');
  const end = PAGE.indexOf('</div>', PAGE.indexOf('<p class="dhint"', row));
  const rendered = PAGE.slice(row, end).replace(/<!--[\s\S]*?-->/g, ' ');
  assert.match(rendered, /raw session/, 'the row no longer says what the toggle shows');
  assert.doesNotMatch(rendered, /chat shows what an agent says/,
    'the row went back to explaining the chat instead of the toggle');
});
