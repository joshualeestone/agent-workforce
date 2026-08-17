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
file if absent; jq if available, else a careful fallback). The
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
re-anchored to the header placement. This wave cuts 0.1.5, which
fires the four-leg update-flag test on Josh's mini (his board must
NOTICE the release; do not press Later; agents must survive the
update; post in channel when cutting so the clock is known).
