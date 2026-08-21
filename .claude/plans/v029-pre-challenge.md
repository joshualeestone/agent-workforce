---
pre_challenge: true
method: challenge-loop
branch: v029
diff_hash: 2157993ca45599e619e61611ea4c432a3f016ad0ea28af7b8e97a122ed119895
subdir_audit: passed
timestamp: 2026-08-21T08:55:00-05:00
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Findings:** 2 WARNINGs, 1 CONVENTION, 1 NIT, 3 STRENGTHs
**Fixed:** 4 | **Deferred:** 0

### Why one iteration

The code diff is **one character**: `0.2.8` to `0.2.9` in `package.json`. The
risk in a release bump is not in the diff, it is in the pipeline around it, so
the pass was aimed there: does the version have a second home, does anything
verify it, are the plan's factual claims true, and does this depart from how
previous bumps were done. **All four of its findings were about the plan and the
pipeline, and none about the line.** A second pass over one character would be
ceremony; the artifact-level verification below is the real check and it runs
after the merge.

### The findings

**[WARNING] the version has a SECOND HOME and it is not in this repo.**
`engine/update.js:82` fetches `latest.json` from the release host and compares
it against `require('../package.json').version`. 🛑 **A 0.2.9 bundle published
while `latest.json` still reads 0.2.8 is offered to nobody**, and every check
inside this repo stays green while it happens. The plan claimed "the version
lives in exactly one place", which is true of the tree and false of the release.
Corrected, with the failure named.

**[WARNING] nothing was committed.** `v029` carried zero commits: the bump and
the plan were working-tree state only, so there was nothing to review as a PR.
Committed.

**[CONVENTION] the pipeline section was dropped.** `v028-20260820.md` ends with
the full chain (build, dist, `versions.html`, deploy, then read `latest.json`
AND the version inside the SERVED tarball with the previous tarball as a
positive control). I had replaced it with "this does not publish", which removes
**the one recorded procedure that catches the exact failure this release exists
to fix**. Carried forward and expanded with why the order matters and why the
positive control is not ceremony.

**[NIT] "1002 pass" is the `node --test` half only.** `yarn test` also runs the
shell suite, the floor gate and the permission states. Both halves are now named
separately and both pass.

**[STRENGTH]** Every checkable factual claim in the plan verified independently:
`e1fdeaf` is the 0.2.8 bump, #105/#106/#107 merged after it, the published
`latest.json` still reads 0.2.8, and the four overlapping files between #119 and
#128 are exactly `engine/chat.js`, `engine/chat.test.js`, `server.test.js` and
`web/index.html`.

**[STRENGTH]** The single-source claim holds where it matters for the build:
`install/setup.sh:1350` and `tools/build-kosmos-bundle.sh:216` both parse the
version out of `package.json` at runtime, so `Info.plist` and the bundle's
`VERSION` cannot drift from the bump.

**[STRENGTH]** The bump direction was verified by comparing both sides rather
than assumed, which is the trap the v028 plan records as having hit six releases
in a row. ⚠️ **Nothing pins the version in any test**, so that comparison is the
only guard there is.

### One finding of the author's, RETRACTED

I reported `kosmos-x64.tar.gz` as a 404 that "would bite an Intel Mac". It is
neither, on two independent counts: `install/setup.sh:974` refuses a non-arm64
Mac with a named sentence before any download, and `uname -m` returns `x86_64`,
so that filename is one **no installer ever constructs**.

🔑 **I tested a URL instead of the code path that builds URLs.** The 404 was a
true measurement of nothing. Kept in the plan as a retraction rather than
deleted, so the next person does not spend an hour building a bundle nobody
asks for.

### Why `converged: false`

A second blind pass has not run. The stopping rule for a one-character diff was
that the pass be aimed at the pipeline rather than the line, and the real
verification is the post-deploy artifact read, which cannot run until the deploy
has happened. Recorded honestly rather than claiming a convergence nobody tested.
