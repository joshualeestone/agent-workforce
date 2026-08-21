# project-name -- the envelope says the name, the record keeps the id

## Why

Josh, 2026-08-21, testing 0.2.9. He made a project called **`test project`**,
posted to its room, and the agent answered:

> *"'testproject' isn't listed in my configured projects (only Office Lease is)"*

🔑 **That was correct.** Its instructions list projects by **name**
(`blockBody`: `- **test project**: \`/folder\``), and the envelope handed it the
**slug**. It compared an argument against an identity, truthfully reported no
match, and the whole exchange read as an agent that had misunderstood him.

⚠️ **This is a sufficient cause on its own.** It is independent of #143 (nothing
makes a running agent re-read its instructions), and **either alone reproduces
the symptom**. An agent whose tell had worked perfectly would still have said
what Johnson said.

## The split

| | carries | why |
|---|---|---|
| the **envelope** an agent reads | the **name** | the only spelling the person will ever recognise |
| the log, the pair counter, `kosmos post <id>` | the **id** | a machine keys on it |

Both come off the same record at the same call site, so they cannot drift.

📌 **Falls back to the id** when no name is supplied, so a caller that has not
been updated is no worse off than before rather than sending an envelope with a
hole in it. The name is validated exactly like the id and the sender, for the
same reason: it rides inside the bracket grammar.

## What this does NOT fix

**The block still carries both spellings with no stated relationship**
(`blockBody` writes the name as the heading and the slug inside a
`kosmos post` example). Mona Lisa's constraint: while that is true, an agent
reasoning about either string can reach the same conclusion by a different
route. Not fixed here because it is a copy decision about the block; recorded on
#139.

**It does not fix #143.** A running agent still never re-reads.

## The shape worth keeping

The codebase already learned this for **agents**. `web/index.html:13146`:

> *"`shownAs`, not `agent`: speak the display name. The raw machine name here
> read "claudebot" about the agent every other surface calls "Splinter"."*

🔑 **A lesson learned about one object does not travel to the next object by
itself.** Projects have the identical two-names problem, the comment explaining
why it matters was written by us, and nobody carried it across. Same family as
the four told-frames: *"where else does this apply?"* asked of a **fix** is
harder to remember than asked of a **finding**, because a solved problem does not
feel like an open question.

## Verification

    yarn test    1002 pass, 0 fail

Two pins that asserted the OLD behaviour caught this, which is how it should
have gone: both required the slug in the envelope. They assert the name now
**and** that the slug does not appear in the sentence, because either half alone
is the bug. Proven by restoring `shownProject = projectId`: both fail with the
sentences they carry.
