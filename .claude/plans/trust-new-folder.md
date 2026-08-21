# Trust the folder we made, before the agent starts (#164)

## The problem, in the shape that decides the priority

Josh made an agent called Dan on 0.2.10 and it was `Needs you` before he
touched it. The blocking question was Claude Code's own trust check, asked
about `/Users/cabal/work/workers/dan` — a folder **Kosmos created a second
earlier**, whose only contents are the instruction file Kosmos wrote.

🔑 **The cost is not the prompt. It is what the prompt consumes.** If every new
agent needs you, the `Needs you` badge stops separating an agent that genuinely
needs an answer from one that was merely born. That is the same failure as the
CLI sentence we fixed an hour before: a true signal made useless by firing when
nothing is wrong. (Splinter's framing, and it is why this outranks its size.)

## What it does

`engine/trust.js` — one function, `trustFolder(dir)`, called from `create.js`
after the folder is made and **before** the job is bootstrapped, because the
question is asked at startup and a later write would land after the prompt it
exists for.

⚠️ **The write is not reverse-engineered.** Claude Code prints this remedy in
its own refusal, verified in the shipped 2.1.238 binary:

    this workspace has not been trusted. Run Claude Code interactively here
    once and accept the trust dialog, or set
    projects[<path>].hasTrustDialogAccepted: true in <config>

So the key, the location and the value are the ones the tool documents. It is
still treated as fragile: nothing throws, and every refusal leaves the file
exactly as it was, which returns the person to today's behaviour.

## The rules, and why each one is there

- **Only a folder Kosmos made.** `mkdirSync(recursive)` returns the first path
  it created and `undefined` when the folder already existed — the one moment
  the two cases are distinguishable. A folder the person chose is the case
  where the safety question is doing its job.
- **Keyed by realpath**, because every one of the 22 entries in the real config
  on this machine is its own resolved path. The unresolved spelling would write
  an entry nothing ever reads, and nothing would report a failure.
- **Merge, never replace** the project entry. An entry can carry a person's
  `allowedTools` and their MCP servers.
- **Refuse an absent or empty config.** No file means Claude Code has never run
  here, so we would be creating another tool's config from nothing. The guard
  fails closed on purpose: refusing costs one prompt, writing invents a file.
- **Refuse a symlinked config**, live or dangling — renaming over it replaces
  somebody's arrangement with a file.
- **Preserve the mode.** The real file sits at 600 and holds account details.
- **Already true is a success that writes nothing**, asserted on the bytes.
- **Skipped entirely under DRY_RUN.**

## The hazard that is stated rather than solved

This is read-modify-write on a file a running Claude Code also writes. A
session that saves between our read and our rename loses that save. The window
is milliseconds and the rename is atomic, so the file is never half-written —
but "never corrupt" is not "never lost", and the comment in the code says which
one we bought. It is the same exposure the installer's `settings.json` write
already takes.

## What testing it changed

- **The suite sandboxed three roots and this made a fourth, and I only did it in
  one file.** A blind reviewer measured the result in my own live config: **93
  entries** keyed to temp directories under `/var/folders` that had not existed
  for hours, in a 114KB file holding my account and my MCP servers. Four test
  files now set `AGENT_WORKFORCE_CLAUDE_CONFIG`, the 93 are cleaned (115 → 22,
  backup kept), and a full suite run afterwards leaves zero litter — measured,
  not assumed. **The fix that matters is the rule in `fixture-discipline.test.js`
  rather than the four lines**: three roots sandboxed and a fourth not is exactly
  how this happened, so the suite now refuses a creating suite that skips it.
- **I named the wrong guard and the test corrected me.** I asserted that a
  pre-existing folder creates an agent without being trusted. It came back
  REFUSED: `createAgent` already turns down a name whose folder exists, so the
  trust write is unreachable on that path. The refusal is the first line and
  `weMadeTheFolder` is the second; the comment now says so, and says that no
  test pins the boolean because nothing can reach it.
- **A test passed with the code it tested deleted.** The temp-file cleanup test
  made the directory read-only, which fails the *write* too — so there was
  never a temp file to leave behind. It asserted litter was absent in the one
  case that cannot produce litter. Replaced with an injected `renameSync`
  failure, which is the only thing that reaches the cleanup.
- **A mutation applied textually and meant something else.** Rewriting the
  ENOENT arm to `{ data = {}; }else` bound the `else` to the next `if` and left
  the final `return` unconditional, so the run "proved" a guard that was still
  refusing for a different reason. Redone by replacing the whole catch body.
- **The dangling-symlink state needs two mutations to go red**, because two
  independent guards cover it. A single-mutation sweep would have reported that
  test as unable to fail.

## Evidence

- `yarn test`: **1023 pass, 0 fail**, plus the installer's ten-state permission-acceptance harness and the shell-syntax pass, all green.
- **Nine deliberate breaks on `trust.js`**, each reverted after the named test
  was watched to fail: realpath key, entry merge, already-true short circuit,
  invent-on-absent, symlink refusal, mode preservation, temp cleanup, the
  `projects` shape guard, and the two-at-once dangling case.
- **One on `create.js`**: removing the call reddens the creation test.

## What the second blind pass found, and where it found it

**Two blockers, and both were inside the first round's own fix.**

1. **The rollback deleted somebody's settings.** `forgetFolder` removed the whole
   `projects[…]` entry, reasoning that `already: false` meant we created it. It
   does not: it means we **set the key**. A person can already have an entry for
   that exact path — Claude Code never prunes them — holding their
   `allowedTools`, their MCP servers and their history. The undo took all of it,
   on the path whose entire job is putting things back. It now deletes the key
   and drops the entry only if nothing of theirs is left.
2. **The test guarding that could not fail.** It seeded the entry with the trust
   key already `true`, which short-circuits before any write, so the undo never
   ran and the guard was never evaluated against a live deletion. The shape that
   loses data is the key **absent**.

Also from that pass: two comments claiming behaviour the code did not have (the
undo's "only ever called for an entry we just created", and a claim that the
`because` string was now surfaced — it is not, and that is recorded as a gap);
a `.includes` check satisfied by a **different variable**
(`AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`); a positive control met only because the
file **matched its own docblock**; and a fixed temp path whose failure cleanup
could delete another process's in-flight file. The temp path is now unique per
process, which removes the choice rather than picking a side of it.

⚠️ **One mutation lied to me during that round.** `String.replace` takes only the
first occurrence, so a break aimed at the rollback's key hit a truthiness check
instead and the suite stayed green — reported as "this guard has no test" until
the replacement was aimed at the call. It has one.

## Not in this change

- The `Unknown` memory badge on a brand-new agent's card. Separate, ruled by
  Mona Lisa, and it needs two falsy-collapses fixed in `status.js` first.
- Anything about folders the person chose. Deliberately untouched.
