'use strict';

/**
 * The second sentence under a room post: who has said nothing back.
 *
 * 🛑 WHY IT EXISTS. Josh posted into a room three times and got
 * "Placed with Johnson, Rick and Bob." every time while nothing came back. The
 * receipt was TRUE each time — the keystrokes were placed — and it was useless,
 * because it read identically whether the agents had answered or not. A true
 * sentence that cannot tell working from broken is the same failure as the CLI
 * saying everyone received it, and it cost him most of a morning (#145).
 *
 * ⚠️ THE FUNCTIONS ARE EXECUTED, not grepped for. A test that reads index.html
 * as text can prove a sentence is present somewhere in a 15,000-line file and
 * nothing about whether the branch producing it is reachable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1);
}

const NAMES = ['pjJoinNames', 'pjJoinOr', 'pjNameOf', 'pjSilentSince', 'pjReceiptSentence', 'pjOldEnoughToJudge'];
const PJ_SILENCE_AFTER_MS = 2 * 60 * 1000;
// eslint-disable-next-line no-new-func
const api = new Function(
  `const PJ_SILENCE_AFTER_MS = ${PJ_SILENCE_AFTER_MS};`
  + NAMES.map(slice).join('\n')
  + `; return { ${NAMES.join(', ')} };`,
)();

/**
 * A project's member list, in the shape `engine/projects.js` really emits.
 *
 * ⚠️ NOT A BOARD CARD, which is what the suite's hand-built-fixture rule is
 * about — these come from `describe()`, not from `snapshot()`. But the shape is
 * still pinned to the producer rather than invented, below, so it cannot drift
 * into a stand-in carrying fields nothing emits.
 *
 * ⚠️ And built with shorthand, which is how `describe()` builds it too.
 */
const member = (sessionName, name) => ({ sessionName, name });
const P = { agents: [member('johnson', 'Johnson'), member('rick', 'Rick'), member('bob', 'Bob')] };

test('the member fixture is the shape the engine actually emits', () => {
  /**
   * ⚠️ THE FIXTURE IS PINNED TO ITS PRODUCER. Every test below reads a member's
   * `name` through `pjNameOf`, and a fixture free to invent fields is how a
   * display name ships dead: the tests pass against a shape the engine never
   * produces.
   */
  const src = fs.readFileSync(nodePath.join(__dirname, 'engine', 'projects.js'), 'utf8');
  const at = src.indexOf('const members = (project.agents || []).map(');
  assert.notEqual(at, -1, 'describe() no longer builds members here, so this fixture is unanchored');
  const block = src.slice(at, at + 900);
  assert.match(block, /\n\s+sessionName,/, 'members no longer carry sessionName');
  assert.match(block, /\n\s+name: card && card\.name/, 'members no longer carry a display name');
});
const ALL_PLACED = { johnson: 'placed', rick: 'placed', bob: 'placed' };
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

/** A room: the person's post, then whatever came after it. */
function room(after) {
  /* ⚠️ `from: 'you'`, NOT null. That is what `sendPost` writes for an operator
     post, and the first version of this fixture invented `null` — which made
     the operator test unable to fail, because a null name matches no agent
     whatever the code does. */
  const post = { operator: true, from: 'you', at: ago(5), outcomes: ALL_PLACED, text: 'hello' };
  return { rows: [post, ...after], post };
}
const said = (who) => ({ from: who, at: ago(4), text: 'here' });

const sentence = (silentSessionNames) =>
  api.pjReceiptSentence(ALL_PLACED, P, (silentSessionNames || []).map((w) => api.pjNameOf(P, w)));

test('nobody has answered: the receipt says so instead of only saying it was placed', () => {
  assert.equal(sentence(['johnson', 'rick', 'bob']),
    'Placed with Johnson, Rick and Bob. Nothing back from any of them.');
});

test('one silent of three is named, and the other two are not', () => {
  assert.equal(sentence(['rick']), 'Placed with Johnson, Rick and Bob. Nothing back from Rick.');
});

test('two silent are joined with OR, because it is a different list from the one above', () => {
  /**
   * ⚠️ The base receipt is an AND list: all of them got it. The silence clause
   * is not — "nothing back from Rick and Bob" reads as one joint absence rather
   * than two separate ones.
   */
  assert.equal(sentence(['rick', 'bob']), 'Placed with Johnson, Rick and Bob. Nothing back from Rick or Bob.');
});

test('everyone answering leaves the receipt exactly as it was', () => {
  /**
   * ⚠️ THE CASE THAT MUST NOT GROW A SENTENCE. A healthy room is the common
   * one, and a second clause on every post would be the CLI overclaim with the
   * sign flipped: noise that people learn to stop reading.
   */
  assert.equal(sentence([]), 'Placed with Johnson, Rick and Bob.');
  assert.equal(sentence(undefined), 'Placed with Johnson, Rick and Bob.');
});

test('"any of them" is only for ALL of them, and never for a single recipient', () => {
  /**
   * ⚠️ A one-agent room whose one agent is silent must say the NAME. "Nothing
   * back from any of them" about one person is a sentence nobody would write.
   */
  const one = { rick: 'placed' };
  const s = api.pjReceiptSentence(one, P, ['Rick']);
  assert.equal(s, 'Placed with Rick. Nothing back from Rick.');
});

test('an agent we could not reach is not also reported as silent', () => {
  /**
   * ⚠️ It is already named in its own clause. Saying it twice invents a second
   * failure, and the two sentences would contradict each other about what we
   * know: one says the message never got there, the other implies it did and
   * was ignored.
   */
  const mixed = { johnson: 'placed', rick: 'could_not', bob: 'unconfirmed' };
  const s = api.pjReceiptSentence(mixed, P, ['Johnson', 'Rick', 'Bob']);
  assert.match(s, /Nothing back from Johnson\./);
  assert.doesNotMatch(s, /Nothing back from[^.]*Rick/);
  assert.doesNotMatch(s, /Nothing back from[^.]*Bob/);
});

test('anything an agent says afterwards counts, and it does not have to be a reply', () => {
  /**
   * 🔑 THE RULING THIS PINS: "back" means ANY message from that agent in this
   * room after this one, NOT an answer to this specific message. We cannot see
   * intent and must not pretend to, and the wording matches exactly that —
   * "nothing back from Rick" is true of "Rick has said nothing since".
   *
   * ⚠️ If this is ever tightened to reply-threading, the SENTENCE has to change
   * with it, or it becomes a claim about whether somebody chose to answer.
   */
  const r = room([said('rick'), said('bob')]);
  assert.deepEqual(api.pjSilentSince(r.post, r.rows, 0), ['johnson']);
});

test('the person talking to themselves is not an agent answering', () => {
  const r = room([{ operator: true, from: 'you', at: ago(4), text: 'anyone?' }]);
  assert.deepEqual(api.pjSilentSince(r.post, r.rows, 0).sort(), ['bob', 'johnson', 'rick']);
});

test('an agent actually named "you" is not mistaken for the person', () => {
  /**
   * 🛑 THE ENGINE'S OWN WARNING, made into a test. `sendPost` writes
   * `from: 'you'` for an operator post and adds an explicit `operator: true`
   * "because a NAME alone cannot carry the distinction: 'you' is a legal tmux
   * session name, and the one thing the screens must never do is promote an
   * agent to operator on a string match."
   *
   * ⚠️ This runs it in the other direction. If the silence check keyed on the
   * name rather than the flag, the PERSON's own follow-up post would count as
   * this agent having answered, and a room where nobody replied would read as
   * a working one. It is also what makes the test above able to fail at all.
   */
  const outcomes = { you: 'placed', rick: 'placed' };
  const p = { agents: [member('you', 'You'), member('rick', 'Rick')] };
  const post = { operator: true, from: 'you', at: ago(5), outcomes };
  const rows = [post, { operator: true, from: 'you', at: ago(4), text: 'anyone?' }];

  assert.deepEqual(api.pjSilentSince(post, rows, 0).sort(), ['rick', 'you'],
    'the person’s own post was read as the agent called "you" answering');
  assert.equal(api.pjNameOf(p, 'you'), 'You');
});

test('a valve notice is not an agent answering', () => {
  /**
   * ⚠️ It carries no `from`, but a version of this that trusted the row shape
   * rather than the kind would count it. The valve is the product speaking.
   */
  const r = room([{ kind: 'valve', from: 'rick', at: ago(4), because: 'held' }]);
  assert.deepEqual(api.pjSilentSince(r.post, r.rows, 0).sort(), ['bob', 'johnson', 'rick']);
});

test('what an agent said BEFORE the post does not answer it', () => {
  /**
   * ⚠️ THE DIRECTION, and it is decided by POSITION rather than timestamps —
   * two messages can land in the same millisecond, and a clock that steps
   * backwards would otherwise turn an earlier remark into an answer.
   */
  const post = { operator: true, at: ago(5), outcomes: ALL_PLACED };
  const rows = [said('rick'), post, said('bob')];
  assert.deepEqual(api.pjSilentSince(post, rows, 1).sort(), ['johnson', 'rick']);
});

test('a post with no delivery record has nothing to be silent about', () => {
  const m = { operator: true, at: ago(5) };
  assert.deepEqual(api.pjSilentSince(m, [m], 0), []);
});

test('two minutes is a floor, and a message with no timestamp is not "long ago"', () => {
  /**
   * ⚠️ THE DEFAULT ON A MISSING TIMESTAMP IS THE QUIET ONE. Treating an
   * unparseable date as old would put "nothing back from all of them" under a
   * post that was sent a second earlier — a false alarm produced by our own
   * missing data.
   */
  assert.equal(api.pjOldEnoughToJudge(ago(5)), true);
  assert.equal(api.pjOldEnoughToJudge(ago(1)), false);
  assert.equal(api.pjOldEnoughToJudge(new Date().toISOString()), false);
  for (const bad of [undefined, null, '', 'not a date', {}]) {
    assert.equal(api.pjOldEnoughToJudge(bad), false, `${JSON.stringify(bad)} was treated as long ago`);
  }
});

test('the verdict is computed against the whole room, never a filtered view', () => {
  /**
   * 🛑 THE DEFECT THIS SHAPE EXISTS TO PREVENT. If the silence were computed
   * from the rows currently on screen, typing in the search box would delete an
   * agent's reply from the calculation and turn a working exchange into
   * "nothing back from Rick" — the receipt lying because of what somebody typed
   * somewhere else.
   */
  const r = room([said('rick'), said('bob'), said('johnson')]);
  assert.deepEqual(api.pjSilentSince(r.post, r.rows, 0), [], 'everyone spoke');

  const filtered = [r.post];        // what a search for something else would leave
  assert.deepEqual(api.pjSilentSince(r.post, filtered, 0).sort(), ['bob', 'johnson', 'rick'],
    'the control: against a filtered list the answer really is different, so paintRoom must pass the whole room');
});

test('paintRoom indexes the silence against allRows and not against the filtered rows', () => {
  /**
   * ⚠️ AND THIS IS THE HALF THE UNIT TEST ABOVE CANNOT SEE. It proves the
   * function is sensitive to which list it gets; only the CALL SITE decides
   * which one it gets. Read structurally rather than by wording, because the
   * comment beside it could be edited without the code changing.
   */
  const at = PAGE.indexOf('function paintRoom(');
  assert.notEqual(at, -1);
  const body = PAGE.slice(at, at + 2000);
  assert.match(body, /allRows\.forEach\(\(m, i\) => \{[\s\S]*?pjSilentSince\(m, allRows, i\)/,
    'the silence is no longer computed from the whole room');
  assert.doesNotMatch(body, /pjSilentSince\(m, shown/, 'the silence is computed from the filtered rows');
});
