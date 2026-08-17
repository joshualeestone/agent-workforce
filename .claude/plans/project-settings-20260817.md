# project-settings: the pack's settings screen (section 3099)

Task #36, built 2026-08-17 ~11:20 PM under Josh's ship-fast directive
(lean rigor: suite + one drive + one review round). From the frozen pack
via CURRENT-FREEZE.

## What lives here (the pack's rule: what has nowhere else to live)

- Name + Description, editable, Save (gold) via the existing PUT edit
  route; only changed fields travel, and a no-change save says "Nothing
  has changed." rather than a false Saved (the engine's own refusal
  class).
- Where the work lives: folder NAME in code style + the location as a
  plain sentence under Mona Lisa's one-rule ruling (2026-08-16 11:14
  PM): name the IMMEDIATE PARENT ("In your Kosmos folder." falls out of
  the same rule; "In your Clients folder."; fallback "In a folder you
  chose." for volume-root parents). No tilde, no full path, a recorded
  ruling. "Show me where it is" = the pack's own button, POST
  /api/project/:id/reveal-folder: guard-inherited, path ALWAYS the
  stored record's (never the request's), open -R so Finder SELECTS the
  folder in its parent, refused with the folder-state's own sentence
  when there is nothing to show. folderInKosmos served by describe (the
  server is the only side that knows the root).
- Archive and Remove: MOVED from the project page with their ids and
  battle-tested wiring untouched (the old placement's own comment
  flagged it provisional pending exactly this screen). Copy updated to
  the pack's settings-screen sentences ("Your folder and everything in
  it stay exactly where they are.").
- The filesystem path is OFF the project page (task #36's debt), with
  the pack's reasoning kept in the source.

## Not here, per the pack

Members and tasks stay on the project page; a settings page that
restates the screen it was opened from is a second copy of it.

## Verification (lean)

node --test 793/793 (new wire test: reveal route guard by count,
open -R receives exactly the stored folder, 404 honesty; the folder
state constant is the ENGINE'S (FOLDER.READABLE), caught when my
guessed 'ok' vocabulary 409ed the happy path). Committed drive
(render-pjsettings.js): door, paint, parent-sentence shape, save round
trip landing on all three surfaces, honest no-op save, relocated blocks
present, no path on the project page, zero page errors. Reveal is not
clicked in the drive (real Finder side effect); its route is
wire-tested.

## Review round 1 (2 BLOCKERs, 4 WARNINGs, 2 NITs; all fixed, none deferred)

- BLOCKER: execFileSync was never imported; every production click of
  Show-me-where-it-is would have answered "Finder did not open" forever,
  and the runner-injected tests replaced the exact broken line. Fixed
  three ways: the import (verified absent first), the catch now THROWS
  programming errors instead of dressing them as open failures, and a
  new test drives the PRODUCTION path with no injected runner.
- BLOCKER: the remove flow's failure sentence rendered into the project
  page's hidden element after the relocation (a click that visibly did
  nothing). It writes to the settings-local line now.
- The archive-state painting followed its elements into
  paintProjectSettings (the old painter was repainting the project-page
  copy over the pack's sentence every poll tick, so the pack's words
  could never be seen).
- Caps follow the engine: name 120 (was a borrowed 60; a 61-120-char
  name could be created but not edited), and NO maxlength on the
  description per the engine's recorded code-point decision.
- The save re-read retries and never repaints stale values under
  "Saved." (the typed values are the saved values; only a successful
  fresh read may replace them).
- folderInKosmos means DIRECT child of the projects root, and a folder
  sitting on a volume root gets the fallback sentence, keeping the
  location rule one rule.
