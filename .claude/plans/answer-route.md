# answer-route -- the Needs-you button opens the agent's page

## Why

Josh, 2026-08-21, testing 0.2.9:

> *"when I click on the Needs You and click the answer from the agent screen on
> the agent, it jumps me straight back to a project that he is not in or
> assigned to. It's like it's not taking me to the View Agent page."*

He is right. `pjAnswerFrom` did exactly one thing: `showTab('projects')`, find the
projects the agent is on, and `openProject(on[0].id)`.

🔑 **It was written when a project room was the ONLY place a blocking question
could be seen and answered.** #119 shipped that morning and put the question and
the answer controls on the agent's own panel. **The destination moved and the
pointer was never re-read.** So the one control whose entire purpose is "take me
to where I can answer this" went somewhere else.

⚠️ **Nothing about the old body looked stale.** It carried a careful docblock
about the stranded state it exists to prevent, and every ending in it was correct
**for the destination it was written against**, including two refusals for "we
could not check the projects" and "it is on none".

## Two refusals removed on purpose, not by oversight

Neither is a reason to withhold the agent's own page:

- an agent on **no project** still has a question
- a **projects read that failed** says nothing about whether we can show its screen

Withholding on either would be the stranded state the whole path exists to make
impossible. The function no longer reads the projects list at all.

## The one ending it keeps

`openDetail` **returns silently** when the name is not on the board it reads
(`LAST.find` then a bare return), which from the outside is a click that did
nothing. That is the ending this function has always refused to have, so the
caller checks `CURRENT` afterwards and says what happened.

## 🛑 Nothing tested where that button went, which is why it went stale

Replacing the routing wholesale left **1002 tests passing**. The board test
asserts the button EXISTS (`/ansgo/`) and never asserted its destination.

**And one source-pin had gone green about something else.** Its message named
`pjAnswerFrom` and said a failed projects read must not render as a definite "not
on a project yet". That property no longer exists, because the function no longer
reads projects. The regex `if (PJ_READ_FAILED)` kept matching **anywhere in the
file**, and what it matches today is the archive/restore path re-enabling a
button.

> **A pin whose message and whose match can drift apart keeps being green about
> something else, and the message is the only part a reader checks.**

Kept rather than deleted, because the property is real where it now lands, and
re-worded to say what it actually holds.

## Verification

    yarn test    1002 pass, 0 fail

The destination is pinned now, against the source rather than a browser drive,
because it is a function call rather than markup: `openDetail(sessionName)` must
be there, `openProject(` and `showTab('projects')` must not. Proven by restoring
the old routing: it fails with the sentence it carries.
