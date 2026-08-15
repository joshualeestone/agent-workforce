# orientation-step: the fifth first-run step, "Getting back to Kosmos"

Date: 2026-08-15 (overnight run). Owner: Angel. Spec:
Josh-Brain/Projects/kosmos-orientation-screens-spec.md (Mona Lisa,
2026-08-14), pinned by PIN-2026-08-14-1913CDT ("five setup steps --
welcome, model, this computer, your agents, getting back"). Scope ruling
from Splinter + Mona Lisa in the overnight channel: the app-location
CHECK only; the Show-me-where reveal endpoint is explicitly out (its
fallback needs a fresh decision after Josh cut paths from the UI three
times tonight), and the drawn button does not bind this branch. Loop cap
for this branch: 15, set before starting (launch-critical UI, no new
powerful writes).

## What this adds

- `engine/machine.js appLocationCheck`: looks for `Kosmos.app` in
  /Applications then ~/Applications and answers the spec's four states in
  the existing `{key, state, title, detail}` shape, joining the
  `/api/machine` payload. Existence, not provenance, per the spec's own
  lean. `opts.appDirs` injects the folders so no test reads the real
  machine; a FILE wearing the name is skipped; anything but a clean
  ENOENT is `unknown`, because could-not-look must never render as
  is-not-there.
- First-run becomes five steps: `FR_STEPS = 5`, pane 5, and
  `frPaintReturn` rendering the spec's copy verbatim: the intro, the
  check row through the existing `frCheckRow` grammar (pre-painted as
  could-not-look so the pane is never blank during the fetch, upgraded in
  place), the DRAG Dock instruction (never "Keep in Dock": the tile
  exits before it can be right-clicked, per the spec's two installer
  citations), and the narrow closing-tab promise (agents keep working).
- The fork moves whole from step 4 to step 5's actions via
  `frForkActions` (one holder for the three path pairs); step 4 gets a
  plain Continue on every path including the broken-payload one.
- Harnesses: click-first-run walks the fifth step (four checks painted,
  the drag guard, the create-path handoff now two clicks); render-first-run
  gains four engine-generated app-location fixtures with premise
  controls, eight committed step-5 shots, and per-shot assertions
  (fixture title present, drag present, Keep-in-Dock absent).
- Contrast: `.fr-bar` and `.fr-mark` move from --label-3 to --label-2.
  Pre-existing AA failures (3.0-4.0:1, measured; main fails its own
  render harness with 32 problems tonight) surfaced by running the
  harness; fixed where the branch was standing. The clear fixture also
  became engine-generated: the live-route premise ("this machine is
  all-clear") stopped being satisfiable on any machine without Kosmos.app
  installed the moment app-location joined the checks, while every real
  post-install machine still satisfies it; the fixture follows the
  premise and keeps its control.

## Verification

node --test (machine + server suites green), render-first-run (no
rendering problems, all shots regenerated and committed),
click-first-run (all clear, exit 0), against a fully sandboxed server.

## Known and deliberate

- Step 1 still says "Welcome to Agent Workforce" while the new step says
  Kosmos: the product rename is the terminology sheet's own sweep, a
  separate branch; new copy follows the spec's naming.
- The removed-shots renumbering the spec warned about did not arise: the
  fork's CONTENT stayed on step 4, so firstrun-4-* names remain accurate,
  and step 5's shots are new files.

## Review round 1 (2026-08-14 evening)

The reviewer found one BLOCKER and it was the branch's own design error:
appLocationCheck had joined the shared `checks` array, so step 4's create
path captioned a missing Kosmos.app with "An agent made now may not run
until that is sorted" (a false cause) and step 2 counted it. Fixed at the
SOURCE: `check()` now publishes `appLocation` beside the rows, never among
them, so no screen has to remember to exclude it; tests pin both the field
and its absence from the rows, and pin that its attention state is not
added to the counts.

Also from the round: the look no longer gives up on the first unreadable
folder (could-not-look is the last answer, not the eager one); a malformed
appDirs override throws instead of silently probing the real machine; the
step-5 pre-paint is a distinct "checking" state instead of a byte-identical
copy of the engine's unknown row (placeholder, engine answer, and
could-not-ask fallback are now three distinguishable wordings, asserted);
the Dock drag instruction tracks whether a folder was FOUND (the spec wrote
"out of that folder" under the found case; missing and unknown get a
Spotlight-anchored variant, my wording, flagged for the designer);
frPaintReturn gained unit coverage through the harness (fetch stubbed,
async supported); the live region moved off the pane wrapper onto the row;
the shape test that read the real machine is sandboxed; step 4 asserts
Continue is the ONLY button on every path; stale four-step comments and
the Step 1 of 4 crumb corrected.
