# Cutting a release

```
yarn release 0.2.12
```

Everything below is what that script does and why. It is written down because
the script itself lived in a scratchpad for three releases, and every
improvement it gained would have died with the session that wrote it.

## The order matters, and the reason is one defect each

1. **Clean main, and read the log.** The release ships what is merged, not what
   you remember merging.
2. **Bump `package.json`.** One place. `engine/update.js` compares this against
   the served `latest.json`, numerically rather than lexically.
3. **The whole suite**, on the tree that ships.
4. **Build**, then copy the bundle, `.sha256` and `latest.json` to the site.
   ⚠️ The tarball and `latest.json` must land in the **same deploy**: shipping
   one without the other tells every installed copy to update to a version the
   download does not contain.
5. **Copy `/setup`.** 🛑 It is served from the site **root**, not from `dist/`,
   so copying the bundle does not carry it — and **both** paths run it: a new
   install (`curl … /setup | sh`) and an existing one updating itself
   (`engine/update.js` re-runs `setupUrl()`). It was stale on the site by a
   whole change before this step existed, **while three correct checks of the
   bundle passed.**
6. **Confirm the bundle says the version** before publishing it.
7. **The versions page needs its entry first.** Copy is ruled by Mona Lisa; the
   timestamp is the only field written at release time, and the page's own rule
   is never to edit an existing entry.
8. **Deploy.**
9. **Verify what is SERVED** — `tools/verify-served.sh`, retried, because a
   deploy is live before every edge has it and one read cannot tell "not
   published" from "not yet".

## Why the verification is a separate script

`tools/verify-served.sh` **derives the artifact list from the code that fetches
each one**, and cites the line beside it:

| artifact | who fetches it |
|---|---|
| `/setup` | new installs, and `engine/update.js:189` on every update |
| `/dist/latest.json` | `engine/update.js:82`, every 15 minutes |
| `/dist/kosmos-arm64.tar.gz` + `.sha256` | `install/setup.sh` |
| `/dist/tmux-arm64.tar.gz` + `.sha256` | `install/setup.sh:373` |

🔑 **A hand-maintained list of "things we ship" drifts from the things actually
fetched, and the drift is invisible.** Deriving it means a new fetch in the
product becomes a new line in the check rather than something somebody has to
remember.

⚠️ **It leads with a 404 control.** An empty body and a missing file look
identical, and a wrong URL reads as an outage — that happened to a reviewer
within a minute of 0.2.11 going out. The control's own first version was buggy
(`curl -fsS … || echo 404` printed `404404`, because `-f` makes curl exit
non-zero and the fallback appends), which is the best argument for it.

## Proving a check can fail

```
bash tools/prove-it-fails.sh <test-file> <label> <node-expression>
```

Breaks the code on purpose, runs the named test, and restores.

🛑 **It refuses on a dirty tree, and that refusal is the point.** The loop ends
in `git checkout`, which discards uncommitted work silently. On 2026-08-21 that
ate a real fix **seven times in one day** — twice unnoticed until a test written
minutes later failed, and once a reverted state was committed on top of the loss.

⚠️ **"Commit before you perturb" was written down after the first one and failed
six more times.** A habit that has to hold seven times a day is not a habit, it
is a load-bearing assumption. The tool holds it instead.

## What is deliberately not automated

- **The versions-page copy.** It is ruled, not generated.
- **The merge.** Josh's standing rule is that a ready PR gets merged without
  waiting for him, but *what* goes in a release is a judgement about what has
  been through review.
