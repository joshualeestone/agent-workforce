# Challenge record: show the connection on the board

Branch `auth-visible`. Plan: `.claude/plans/auth-visible-20260812T0845.md`. Closes #30.

`converged: false`. Findings were still arriving at the end: the copy defect (finding 5)
was found after everything was green, by reading a screenshot. Every finding is fixed and
every fix is verified against a render, but the branch did not stop producing findings.

## Method

528 unit tests plus a committed rendered check
(`docs/browser-checks/render-connection.js`, 26 checks) driving a real server against a
sandboxed config in all three states. Every new guard mutation-tested.

## Findings

**1. My own edit script reported success without applying anything.** Not on this branch,
but the same morning and worth recording: a find-and-replace printed "both updated" while
matching nothing, because another agent had concurrently changed the anchor text. Python's
`str.replace` no-ops silently. Every scripted edit here asserts its anchor and exits
non-zero when it is missing.

**2. The sandbox guard refused a valid sandbox.** It compared against `os.tmpdir()` alone,
which on macOS is the per-user `/var/folders/...`, so a perfectly good sandbox in `/tmp`
was rejected. The guard failing safe is the right direction, but it was wrong. Fixed to
resolve through `realpath` across all three temp roots, since `/tmp` is a symlink to
`/private/tmp` and a raw prefix compare cannot see that. **Controls kept:** it still
refuses the real config and still refuses anything under `$HOME`.

**3. The contrast check read a 3.5% black wash as solid black.** It took the first three
numbers out of `rgba(0,0,0,0.035)` and threw the alpha away, reporting **1.00:1**, a figure
describing nothing on screen. Fixed by compositing the notice background over the page
background, which is what a reader actually sees. After the fix the real numbers are 17.23
and 17.80.

**4. ⚠️ ALL THREE SCREENSHOTS WERE THE SAME PICTURE OF THE FIRST-RUN WIZARD, and the run
reported 17/19 passing.** The DOM assertions were true: the notice existed, with the right
text and class. It was behind a full-screen overlay, because a sandboxed board with no
completion flag opens onboarding over everything. **Byte-identical files across three
supposedly different states is what gave it away**, not any assertion.

This is the same defect that hit the Projects branch last night, and the fix already
existed in `render-projects.js`: complete first-run through the engine's own `complete()`,
and assert the board is on screen before believing anything. Adopted verbatim rather than
reinvented, including the note that `offsetParent` cannot be used, since a fixed overlay's
`offsetParent` is always null.

**5. The rendered copy said the same thing twice, with a lower-case sentence.** On screen:
*"Kosmos cannot reach a Claude subscription on this computer. no Claude subscription is
connected on this computer yet."* Every keyword assertion passed. The `because` strings are
written for a different sentence and were being pasted after a headline that already said
it. Fixed to append the reason only when it adds information, sentence-cased and
terminated, plus two new checks that read the whole sentence rather than looking for words.

**6. The size arm of the cache key was untested, and the inode test was theatre.** The
mutation run showed removing `st.ino` broke nothing, because the test copied the old mtime
with `utimesSync`, which does not preserve sub-millisecond precision:

    before  mtimeMs 1786542542019.6838
    after   mtimeMs 1786542542020

The timestamps differed, so an mtime-only key caught the swap and the test passed with the
guard deleted. Rewritten to pin mtime to a whole second and pad both payloads to identical
byte length, so the inode is the only distinguishing signal, and it now asserts its own
setup before asserting behaviour. A separate test was added for `size`, which had no
coverage at all. **All three arms are now load-bearing:** removing them breaks 4, 2 and 2
tests respectively, measured.

## What the shape says

Four of six findings were in the **checking** code, not the feature: a guard that refused
valid input, a measurement that ignored alpha, a suite photographing the wrong screen, and
a test that did not test its subject. The feature itself was mostly right.

That is the third day running this pattern has held. The check is newer than the thing it
checks, so it is the least proven code in the diff, and it is reported as evidence, which
makes a wrong one worse than none.

Finding 4 is the one to carry: **it had already happened, on another branch, less than
twenty-four hours earlier, and the remedy was sitting in a sibling file.** I did not think
to look until byte-identical screenshots forced it.

## Deliberately not built

- **Detecting a revoked or expired token.** The config carries no token validity field,
  verified by reading the real account block. Closing it needs an authenticated call to
  the provider, which is a product decision for a local-first app that currently makes no
  network calls, not a detail to slip in. **Stated plainly to Josh rather than glossed.**
- **Relabelling agent cards as stranded.** When the connection is down we do not know a
  given idle agent is dead. Asserting it across thirteen cards would replace one confident
  wrong answer with another. Offered to Josh as a hedged option instead.
- **Reading auth failure off the pane.** The regex trap. Needs an observation nobody has.
