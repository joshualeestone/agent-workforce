# ruled-four -- the four items Josh ruled today, as one release wave

All four are settled decisions with no design review pending; the
thirteen-view build runs separately behind Josh's pair reviews.

## 1. Setup dots (#44)

The pack animates <canvas id="dots"> behind the flow card (its own
docs: one canvas, no library, ~120 lines); the app's first-run
backdrop is plain. Lift the pack's canvas markup + script as drawn,
behind .fr-back, without touching the single-look light card (no dark
mode for setup, Josh's standing ruling). Respect the pack's own
reduced-motion handling; if the pack has none, surface, do not invent.
Render drive: retake fixtures deliberately; the dots must not break
the AA checker.

## 2. App favicon (#45)

Match the SITE's shape exactly: four explicit PNGs, deliberately no
favicon.ico (the site 404s it by design): rel=icon 16/32/48 +
apple-touch-icon 180. Generate the sizes from assets/Kosmos-1024
masters (sips on macOS), serve them from the app, add the link tags
to web/index.html head (currently zero rel=icon). Title is already
'Kosmos'.

## 3. Permissions acceptance at install (#46)

Josh's ruling verbatim: no extra click, no extra screen, installing IS
the permission. install/setup.sh writes skipDangerousModePermissionPrompt
true into ~/.claude/settings.json (merge, never clobber; create the
file if absent). SUPERSEDED IN REVIEW: the merge runs on the bundle's
own verified Node runtime, not python3 -- /usr/bin/python3 is a CLT
shim whose first invocation on a clean Mac can pop Apple's developer-
tools dialog mid-install. Mode-preserving (zero-byte included),
realpath-resolving with dangling symlinks refused, ten states pinned
by the extraction test. The
bulletin's trap: defaultMode bypassPermissions alone is NOT enough;
the acceptance key is what stops the wall. Test protocol: Josh's new
mini deliberately holds the unaccepted state; after this ships, a
fresh install there must never show the wall when messaging an agent.
Mona Lisa's one-sentence header note for the cautious setup.sh reader
is OFFERED but not ruled; include it only if Josh says yes before the
PR (otherwise leave for a follow-up).

## 4. Update notice inline (#47)

Mona Lisa's drawn version (pack 2e4e100): the notice moves INTO the
header's first column beside the K mark, sharing it (an element in
the flow cannot overlap anything; the abspos toast class retires).
Gold selected-state rules do not apply here (that is the theme
toggle); the notice keeps its drawn look. The old top-right toast CSS
and its geometry checks move with it.

## Verification

Suite + render/click first-run drives + the update-toast drive
re-anchored to the header placement. The version bump to 0.1.5 is a
DELIBERATE separate act after this merges (its own one-line branch,
the same shape as the 0.1.4 bump), then the site release. This wave
feeds 0.1.5, which
fires the four-leg update-flag test on Josh's mini (his board must
NOTICE the release; do not press Later; agents must survive the
update; post in channel when cutting so the clock is known).

## 5. MIT license (Josh's ruling, 3:31 PM)

LICENSE + package.json declaration land in this wave. The repo flip
to public is a SEPARATE, staged act gated on the pre-publication
sweep, which must cover git HISTORY, not just the tree (public = every
commit ever; a removed secret is still clonable):
- git log --all --full-history over env/secret/credential/token paths
- a content grep over all revisions for key shapes (sk-ant,
  github_pat, xox[bp]-, AKIA, PRIVATE KEY)
- if anything is found, rewrite history or start the public repo from
  a fresh squashed initial commit BEFORE the flip; a delete commit is
  not a fix
- deliberate keep/prune list for .claude/plans, review files, and
  browser-check docs: prune what identifies the fleet (people,
  machines, channels), keep what shows the work (the plans and review
  notes are an asset for an MIT project)
SUPERSEDED BY EVENTS, recorded: Josh gave the go in channel at 3:33 PM
before the PR; the sweep ran clean (482 revisions, no key shapes, no
credential-named paths, no fleet identifiers) and the repo flipped
public at 3:36 PM with the plan/review files deliberately kept (they
show the work and name no machines or channels). The site's GitHub
button rides the FAQ branch.
