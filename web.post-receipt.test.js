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

/**
 * The page's own script, evaluated whole, with a DOM stub.
 *
 * 🛑 THIS FILE USED TO SLICE INDIVIDUAL FUNCTIONS OUT BY BRACE-MATCHING, and
 * that is why the renderer had no test: `pjRoomRow` reaches nine helpers and
 * two module-level values, and each one discovered by a ReferenceError was
 * another guess about what the page contains. A harness that is hard to point
 * at the real thing gets pointed at a fragment instead — and the fragment
 * passed while the hop that makes the feature visible was never executed.
 *
 * ⚠️ Evaluating the whole script is also the only version that CANNOT drift:
 * there is no list of dependencies to keep in step with the page.
 */
function pageScope() {
  const src = PAGE.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(src, 'the page has no script block');
  const el = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'textContent' || k === 'innerHTML' || k === 'value' ? '' : el()),
    set: () => true,
    apply: () => el(),
  });
  const document = {
    getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el(),
    documentElement: el(), body: el(), readyState: 'complete',
  };
  const window = {
    addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { hash: '', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  // eslint-disable-next-line no-new-func
  return new Function(
    'document', 'window', 'navigator', 'fetch', 'setInterval', 'setTimeout',
    'clearInterval', 'EventSource', 'location', 'localStorage',
    src[1] + `
    return { pjJoinNames, pjJoinOr, pjNameOf, pjSilentSince, pjSilences,
             pjReceiptSentence, pjOldEnoughToJudge, pjRoomRow, PJ_SILENCE_AFTER_MS };`,
  )(document, window, {}, () => new Promise(() => {}), () => 0, () => 0, () => {},
    function EventSource() {}, window.location, window.localStorage);
}

const api = pageScope();
const renderer = () => api.pjRoomRow;

test('the threshold this file tests is the one the page ships', () => {
  /**
   * ⚠️ Read, then asserted, so a change to the page is a FAILURE here rather
   * than a silently different pass. Two minutes is the number the design
   * settled on: under it, silence is the normal shape of a working room.
   */
  assert.equal(api.PJ_SILENCE_AFTER_MS, 2 * 60 * 1000,
    'the page changed the silence threshold; the tests below describe two minutes');
});

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

/* ⚠️ SESSION NAMES, which is what the page passes now. It used to map them to
   display names first — and display names are not unique, so two agents both
   showing "Rick" merged into one match. */
const sentence = (silentSessionNames) => api.pjReceiptSentence(ALL_PLACED, P, silentSessionNames || []);

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
  const s = api.pjReceiptSentence(one, P, ['rick']);
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
  const s = api.pjReceiptSentence(mixed, P, ['johnson', 'rick', 'bob']);
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

test('the silence map is built from the whole room, and only under the person’s posts', () => {
  /**
   * 🛑 THE HOP THAT USED TO BE UNTESTABLE. This lived inline in `paintRoom`,
   * so the two-minute gate at the point it is APPLIED was reachable only by
   * rendering the screen — delete `pjOldEnoughToJudge` from the condition and
   * every test stayed green while the sentence fired on a post one second old.
   */
  const post = { operator: true, from: 'you', at: ago(5), outcomes: ALL_PLACED };
  const fresh = { operator: true, from: 'you', at: ago(0), outcomes: ALL_PLACED };
  const agentPost = { from: 'rick', at: ago(5), outcomes: { johnson: 'placed' } };
  const rows = [post, fresh, agentPost];

  const map = api.pjSilences(rows);

  /* ⚠️ Rick is NOT in this list, and that is the fixture doing two jobs: his
     post comes after the person's, so he has spoken. An agent's message counts
     as an answer even though it gets no verdict of its own. */
  assert.deepEqual(map.get(post).sort(), ['bob', 'johnson'], 'an old post got no verdict');
  assert.equal(map.has(fresh), false, 'a post seconds old was judged; the two-minute gate is not applied here');
  assert.equal(map.has(agentPost), false,
    'an agent’s own post got a silence verdict, so the room says "nothing back from Johnson" under something RICK said');
});

test('the map is keyed on the row, so a filtered view reads the same verdicts', () => {
  /**
   * ⚠️ The verdict is about the ROOM. Typing in the search box must not change
   * what a receipt claims: filtering out an agent's reply would otherwise turn
   * a working exchange into "nothing back from Rick".
   */
  const r = room([said('rick'), said('bob'), said('johnson')]);
  const map = api.pjSilences(r.rows);
  assert.deepEqual(map.get(r.post), [], 'everyone spoke and somebody was still called silent');

  // THE CONTROL: the same function over only the surviving rows really does
  // answer differently, so passing the whole room is what has to be right.
  const filtered = [r.post];
  assert.deepEqual(api.pjSilences(filtered).get(r.post).sort(), ['bob', 'johnson', 'rick']);
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
  assert.match(body, /pjSilences\(allRows\)/, 'the silence is no longer computed from the whole room');
  assert.doesNotMatch(body, /pjSilences\(shown/, 'the silence is computed from the filtered rows');
});

test('the sentence actually reaches the rendered row', () => {
  /**
   * 🛑 NOTHING IN THIS FILE EXECUTED `pjRoomRow`, so the one hop that makes the
   * feature VISIBLE was uncovered: change its call to
   * `pjReceiptSentence(m.outcomes, p)` — dropping the silence argument — and
   * every other test here still passes while the second sentence never renders.
   * That is the "ships dead" failure this file's own header claims to prevent,
   * and it was live in the file that claimed it.
   *
   * ⚠️ So the renderer is executed, with its helpers taken from the page rather
   * than stubbed, and the assertion is on the HTML a person would receive.
   */
  const render = renderer();

  const post = { operator: true, from: 'you', at: ago(5), outcomes: ALL_PLACED, text: 'anyone there?' };

  const withSilence = render(post, P, ['rick', 'bob']);
  assert.match(withSilence, /Placed with Johnson, Rick and Bob\./);
  assert.match(withSilence, /Nothing back from Rick or Bob\./,
    'the row rendered without the sentence, so the receipt still cannot tell a working room from a broken one');

  // ⚠️ AND THE OTHER HALF, or this passes for a renderer that always appends it.
  const quiet = render(post, P, []);
  assert.match(quiet, /Placed with Johnson, Rick and Bob\./);
  assert.doesNotMatch(quiet, /Nothing back/, 'a room where everyone answered still got the sentence');
});

test('an agent’s own post renders no silence sentence, whatever it is handed', () => {
  /**
   * 🛑 THE VERSION BEFORE THIS CERTIFIED NOTHING. Its fixture was an agent post
   * whose outcomes were all `placed`, and `showReceipt` suppresses the entire
   * receipt span for that — so `doesNotMatch(/Nothing back from/)` was
   * satisfied by pre-existing delivery-pill logic, before any silence code ran.
   *
   * ⚠️ The shape that DOES render a receipt on an agent's post is a partly
   * unreachable room, which is what the `/room` route emits when one recipient
   * timed out. With that fixture and the old code, the room drew
   * "Placed with Johnson. Bob could not be reached. Nothing back from Johnson."
   * underneath a message RICK sent.
   */
  const render = renderer();
  const agentPost = { from: 'rick', at: ago(5), outcomes: { johnson: 'placed', bob: 'could_not' }, text: 'on it' };

  const html = render(agentPost, P, ['johnson']);
  assert.match(html, /class="delivery/, 'no receipt rendered at all, so this tests nothing');
  assert.match(html, /Bob could not be reached/, 'the receipt is not the one this fixture is for');
  assert.doesNotMatch(html, /Nothing back from/,
    'the room told the person nobody answered, underneath a message somebody else sent');

  // ⚠️ THE CONTROL: the same outcomes on the PERSON's post do get the sentence,
  // so the assertion above is about who sent it and not about the shape.
  const ownPost = { operator: true, from: 'you', at: ago(5), outcomes: { johnson: 'placed', bob: 'could_not' }, text: 'anyone?' };
  assert.match(render(ownPost, P, ['johnson']), /Nothing back from Johnson\./,
    'the person’s own post lost the sentence too, so the gate is not about the sender');
});

test('"any of them" never sweeps in the agent we just said could not be reached', () => {
  /**
   * 🛑 "THEM" POINTS AT THE LIST ALREADY ON SCREEN, and that list is the whole
   * receipt, not the placed half of it. Comparing against the placed group
   * alone produced:
   *
   *   Placed with Johnson and Rick. Bob could not be reached.
   *   Nothing back from any of them.
   *
   * which sweeps Bob in one sentence after saying his message never arrived.
   * The two clauses then contradict each other about what we know: one says it
   * never got there, the other implies it did and was ignored.
   */
  const mixed = { johnson: 'placed', rick: 'placed', bob: 'could_not' };
  const s = api.pjReceiptSentence(mixed, P, ['johnson', 'rick']);
  assert.match(s, /Placed with Johnson and Rick\. Bob could not be reached\./);
  assert.match(s, /Nothing back from Johnson or Rick\.$/,
    'the sentence swept in the agent the clause before said never received it');
  assert.doesNotMatch(s, /any of them/);
});

test('"any of them" IS used when the receipt named nobody else', () => {
  /**
   * ⚠️ The control on the rule above: without it, comparing against a wider set
   * would simply never say "any of them" and the branch would be dead.
   */
  const s = api.pjReceiptSentence(ALL_PLACED, P, ['johnson', 'rick', 'bob']);
  assert.match(s, /Nothing back from any of them\.$/);
});

test('two agents showing the same display name are not merged into one verdict', () => {
  /**
   * 🛑 DISPLAY NAMES ARE NOT UNIQUE. Creation collides only on the SLUG, and
   * a display name is recorded separately with no uniqueness check anywhere, so
   * two agents can both show "Rick". An earlier version matched the silent list
   * against the receipt in DISPLAY-NAME space: one Rick answers, the other does
   * not, both match, the count says everybody is silent, and the person is told
   * "Nothing back from any of them" about a room where somebody answered.
   *
   * ⚠️ The visible sentence still reads oddly here ("Rick or Rick"), and that
   * is honest: two agents really are showing one name. What must not happen is
   * a WRONG claim about how many of them answered.
   */
  const twoRicks = { agents: [member('rick', 'Rick'), member('rick-2', 'Rick')] };
  const outcomes = { rick: 'placed', 'rick-2': 'placed' };

  const s = api.pjReceiptSentence(outcomes, twoRicks, ['rick-2']);
  assert.match(s, /Placed with Rick and Rick\./);
  assert.match(s, /Nothing back from Rick\.$/, 'one silent of two was reported as both');
  assert.doesNotMatch(s, /any of them/, 'a room where one of two answered was reported as nobody answering');
});
