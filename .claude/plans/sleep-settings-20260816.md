# sleep-settings: the Open-sleep-settings button, reliability-or-no-button

Task #24. The contract (Josh via the pack, Mona Lisa's phrasing of the
gate): the button lands on the right System Settings pane reliably per
macOS version, and if that cannot be done reliably, the row loses the
button rather than gaining a guess.

## How reliability is achieved rather than assumed

macOS Settings panes are ExtensionKit appexes ON DISK, so existence is
checkable per machine at runtime and the pane id is read from the
appex's own Info.plist, never guessed from a version table:

- Measured on this machine (macOS 26.5.2, desktop): the power pane is
  PowerPreferences.appex carrying com.apple.Battery-Settings.extension.
  Opening x-apple.systempreferences:<id> verified BY PROCESS with a
  negative control: a bogus pane id opens Settings without launching the
  pane appex; the real id launches PowerPreferences with the id in its
  launch arguments. (AppleScript pane enumeration times out on this OS;
  screencapture lacks permission; the process check is the instrument
  that worked and it carries its own control.)
- Accepted-id set: the measured Battery-Settings id plus the pre-merge
  desktop Energy-Saver-Settings id for the 13.5-floor era. A machine
  with NEITHER on disk gets settings:false and no button: the safe
  failure the contract names.

## The pieces

- engine/machine.js: sleepPaneUrl() (dir scan filtered to
  power/energy/battery appexes, defaults-read of CFBundleIdentifier,
  process-lifetime cache with a test-only reset), openSleepSettings()
  (URL always derived server-side so the fronting route can never
  become an open-arbitrary-URL primitive), and the sleep row gains
  `settings: true|false` from the same probe.
- server.js: POST /api/open-sleep-settings, guard-inherited, 200 on
  open, 409 with the engine's sentence when no pane (a race, since the
  button is not rendered then).
- web/index.html: the pack's button on the sleep row of first-run step
  2, rendered only when the row says settings; delegated click (rows
  are repainted wholesale); failure sentence into the step's message
  line; success needs no message, the Settings window is the feedback.

## Deliberate scope edges

- The Settings TAB is a placeholder screen today; the pack's "same row
  in Settings" lands when that screen is built, on this same engine
  flag. Recorded here so the task's second surface is not silently
  dropped.
- The engine's state-specific sleep prose (which power source bites,
  what was and was not read) is richer than the pack's static sentence
  and is kept; the button is the addition. The could-not-read fallback
  prose still names "Lock Screen on a desktop or Battery on a laptop",
  which predates the macOS-26 merge; left as-is tonight since the
  button, when present, is the accurate path.

## Verification

- node --test 786/786 (new: pane-derivation by answered id, unknown-id
  refusal, open receives exactly the derived URL, no-pane refusal runs
  nothing, the row flag from both worlds; route: guard 403, honest 409
  with the engine sentence, 200 opens through the engine).
- Committed drive-through (render-sleep-button.js): on this machine the
  button renders because the pane exists, and clicking it REALLY
  launches the pane process (pgrep, 10s window), with no error message
  written. Kills only what it started; quits Settings after.
