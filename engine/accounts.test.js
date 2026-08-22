'use strict';

/**
 * ⚠️ A SANDBOXED HOME, SET BEFORE THE MODULE LOADS. `accounts.js` resolves HOME
 * once at require time, and this suite writes `.claude*` directories — against
 * the operator's real home that is somebody's actual account tree. The same
 * lesson the status suite learned by writing into a real `~/.claude`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-accounts-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const accounts = require('./accounts');

const write = (rel, obj) => {
  const p = nodePath.join(SANDBOX, rel);
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
};

test('every signed-in account is found, with the default first', () => {
  /**
   * 🛑 THE DEFAULT KEEPS ITS RECORD SOMEWHERE ELSE, and this is the assertion
   * that would have caught it shipping. Measured on a real machine:
   *
   *   ~/.claude.json                     the DEFAULT account's record
   *   ~/.claude-account-b/.claude.json   an overridden config dir keeps its own
   *
   * There is no `~/.claude/.claude.json`. A uniform rule finds two accounts on a
   * machine with three and silently omits the one the product has always meant
   * by "your account".
   */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-two', 'projects'), { recursive: true });
  write('.claude-two/.claude.json', { oauthAccount: { emailAddress: 'second@example.com' } });

  const got = accounts.list();
  assert.deepEqual(got.map((a) => a.email), ['first@example.com', 'second@example.com'],
    'the default account is missing or is not first');
  assert.equal(got[0].isDefault, true);
  assert.equal(got[1].label, 'two', 'the label should be the part a person named');
});

test('a .claude- directory that is not signed in is not an account', () => {
  /**
   * ⚠️ MEASURED RATHER THAN ASSUMED: on the fleet machine `.claude-workers`
   * sits beside two real accounts and carries no `.claude.json` at all. It is a
   * config directory for something else. The presence of an `oauthAccount` is
   * what makes a directory an account, not the name.
   */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-notalogin', 'projects'), { recursive: true });
  const emails = accounts.list().map((a) => a.email);
  assert.ok(!emails.includes(null), 'a directory with no account record was listed as an account');
  assert.equal(emails.length, 2, 'a non-account directory was counted');

  /* And a config that exists but has no oauthAccount is the same answer. */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-halfway', 'projects'), { recursive: true });
  write('.claude-halfway/.claude.json', { somethingElse: true });
  assert.equal(accounts.list().length, 2, 'a config with no account record was counted');
});

test('an account whose memory could not be found says so', () => {
  /**
   * 🔑 THE CONSTRAINT THAT DECIDES WHERE THESE DIRECTORIES LIVE.
   * `status.configRoots()` finds `~/.claude` and any `~/.claude-*` that contains
   * a `projects` directory, and that is how a memory reading is located. So an
   * account directory without one is an account whose agents will all read
   * Unknown — which after today looks exactly like the defect we spent the
   * evening killing.
   *
   * 📌 Reported rather than hidden, because the screen that offers the choice
   * has to be able to say what the choice costs.
   */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-nomem'), { recursive: true });
  write('.claude-nomem/.claude.json', { oauthAccount: { emailAddress: 'third@example.com' } });
  const found = accounts.list().find((a) => a.email === 'third@example.com');
  assert.ok(found, 'the account was not listed at all');
  assert.equal(found.memoryReadable, false,
    'an account with nowhere to keep transcripts is being reported as fine');
});

test('a prepared account shares the one memory tree, so an agent keeps its history', () => {
  /**
   * 🔑 JOSH'S RULE, 2026-08-22: *"her memory should follow her everywhere she
   * goes"* — across models, accounts, and providers. A principle rather than a
   * setting, so it is encoded here rather than offered as a choice.
   *
   * 🛑 WITHOUT IT A SECOND ACCOUNT IS A QUIET AMNESIA, and the fleet has the
   * write-up: *"An agent restarted onto a fresh account comes up with no
   * memory, and nothing on screen says so. It looks like a working agent and
   * behaves like a blank one."*
   */
  const made = accounts.prepare('Work Account');
  assert.equal(made.ok, true, made.because);
  assert.equal(made.label, 'work-account', 'the label was not made safe for a directory name');
  assert.equal(nodePath.basename(made.dir), '.claude-work-account',
    'the directory is named something status.configRoots() will never scan');
  assert.equal(made.memoryShared, true, 'the account got its own empty history');

  /* The link points at the ONE tree, so a transcript written under either
     account is found under both. */
  const shared = nodePath.join(SANDBOX, '.claude', 'projects');
  fs.writeFileSync(nodePath.join(shared, 'proof.txt'), 'x', 'utf8');
  assert.ok(fs.existsSync(nodePath.join(made.dir, 'projects', 'proof.txt')),
    'the new account cannot see history written on the first one');

  /* And it is listed once it is signed in, not before: a directory with no
     account record is not an account. */
  assert.ok(!accounts.list().some((a) => a.dir === made.dir),
    'an empty directory is being offered as a connected account');
  write('.claude-work-account/.claude.json', { oauthAccount: { emailAddress: 'work@example.com' } });
  const now = accounts.list().find((a) => a.dir === made.dir);
  assert.ok(now, 'a signed-in account is not listed');
  assert.equal(now.memoryReadable, true);
});

test('preparing an account twice does not disturb history that is already there', () => {
  /**
   * 🛑 THE AMNESIA ARRIVING FROM THE OTHER DIRECTION. If a `projects` directory
   * is already sitting in an account folder it is somebody's existing history,
   * and replacing it with a link would be this product deleting the thing it
   * exists to protect. Re-running must be safe.
   */
  const first = accounts.prepare('twice');
  assert.equal(first.memoryShared, true);
  const again = accounts.prepare('twice');
  assert.equal(again.ok, true);
  assert.equal(again.memoryShared, true, 're-running lost the shared tree');

  /* A REAL directory there is left exactly alone, and reported honestly. */
  const own = nodePath.join(SANDBOX, '.claude-hasown');
  fs.mkdirSync(nodePath.join(own, 'projects', 'something'), { recursive: true });
  const kept = accounts.prepare('hasown');
  assert.equal(kept.memoryShared, false,
    'an account with its own history is being reported as sharing the common one');
  assert.ok(fs.existsSync(nodePath.join(own, 'projects', 'something')),
    'existing history was destroyed to make room for a link');
});

/* ---- memoryShared, and the repair that makes it true ---------------------
   🔑 THIS IS THE FIELD THE MOVE IS GATED ON. `memoryReadable` only asks whether
   a transcripts tree exists here; an account with its OWN tree passes that and
   still gives any agent moved onto it a blank past. */

test('an account with its own separate history is NOT shared, and the one that is says so', () => {
  const home = accounts.HOME_FOR_TEST;
  fs.mkdirSync(nodePath.join(home, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  // its own tree
  fs.mkdirSync(nodePath.join(home, '.claude-own', 'projects'), { recursive: true });
  write('.claude-own/.claude.json', { oauthAccount: { emailAddress: 'own@example.com' } });

  // pointed at the primary, the way prepare() and this machine's own accounts are
  fs.mkdirSync(nodePath.join(home, '.claude-linked'), { recursive: true });
  write('.claude-linked/.claude.json', { oauthAccount: { emailAddress: 'linked@example.com' } });
  fs.symlinkSync(nodePath.join(home, '.claude', 'projects'), nodePath.join(home, '.claude-linked', 'projects'));

  const by = Object.fromEntries(accounts.list().map((a) => [a.email, a]));
  assert.equal(by['first@example.com'].memoryShared, true, 'the primary is trivially shared with itself');
  assert.equal(by['linked@example.com'].memoryShared, true, 'a link to the primary was not recognised');

  /* ⚠️ THE ONE THAT MATTERS. Both of these accounts have a readable tree, so
     `memoryReadable` cannot tell them apart -- which is exactly why a second
     field exists rather than a stricter reading of the first. */
  assert.equal(by['own@example.com'].memoryReadable, true, 'the premise: its tree is readable');
  assert.equal(by['own@example.com'].memoryShared, false,
    'an account with its own history read as safe to move an agent onto');
});

test('share() points an existing account at the one tree, and refuses to delete real history', () => {
  const home = accounts.HOME_FOR_TEST;
  fs.mkdirSync(nodePath.join(home, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  // empty tree: safe to swap, and the common case for an account that has never run an agent
  fs.mkdirSync(nodePath.join(home, '.claude-empty', 'projects'), { recursive: true });
  write('.claude-empty/.claude.json', { oauthAccount: { emailAddress: 'empty@example.com' } });
  const empty = nodePath.join(home, '.claude-empty');
  assert.equal(accounts.sharesMemory(empty, false), false, 'the premise: it starts unshared');
  assert.deepEqual(accounts.share(empty), { ok: true, already: false });
  assert.equal(accounts.sharesMemory(empty, false), true, 'the repair did not take');

  /* 🛑 AND IT WILL NOT DELETE SOMEBODY'S ACTUAL HISTORY. Replacing a real tree
     with a link is the amnesia this whole area exists to prevent, arriving
     from the other direction. */
  const full = nodePath.join(home, '.claude-full');
  fs.mkdirSync(nodePath.join(full, 'projects', '-Users-someone-work'), { recursive: true });
  fs.writeFileSync(nodePath.join(full, 'projects', '-Users-someone-work', 'a.jsonl'), '{}\n');
  write('.claude-full/.claude.json', { oauthAccount: { emailAddress: 'full@example.com' } });
  const refused = accounts.share(full);
  assert.equal(refused.ok, false);
  assert.match(refused.because, /will not delete it/);
  assert.ok(fs.existsSync(nodePath.join(full, 'projects', '-Users-someone-work', 'a.jsonl')),
    'the refusal still ate the history it refused to eat');

  // and sharing something already shared is a no-op that says so
  assert.deepEqual(accounts.share(empty), { ok: true, already: true });
});
