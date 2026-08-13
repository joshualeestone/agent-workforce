# open-after-install: the first clean-machine run's two findings

Date: 2026-08-13. Branch: open-after-install.

## What happened

The first real clean-machine test of `curl -fsSL https://chaoskosmos.com/setup | sh`
ran on a never-touched Mac mini (macOS 26.6.1, arm64). Every installer step
succeeded: checksums verified, tmux loaded, board started, transcript clean,
exit 0 in about ten seconds. The tester's report opened with two findings,
both discoverability, neither mechanical:

1. "It did not open the window or the app, just brought me back to a prompt."
2. "It also did not put it in my applications." (The icon went to
   ~/Applications; Finder's sidebar Applications shows /Applications.)

The board itself was confirmed working: the URL typed into a browser brought
up the welcome screen. For this installer's audience, both findings are real
failures: a product that is running but not visible is indistinguishable
from one that failed.

## The changes

1. **The icon goes to /Applications when this user can write there without a
   password** (macOS gives admin users group write there), falling back to
   ~/Applications otherwise. The probe is an actual mkdir/rmdir, not `-w`,
   because ACLs make `-w` lie in both directions. The closing sentence names
   where the icon actually went. A stale pre-change icon in ~/Applications is
   cleaned up when the system-folder install succeeds.
2. **A fresh install ends by opening the dashboard** (`/usr/bin/open`,
   best-effort, fresh installs only). Updates stay quiet. Any sandbox
   override or KOSMOS_NO_OPEN suppresses it.
3. **Uninstall sweeps both default icon locations** (pre-change installs
   wrote the home folder), each bounded by the fixed leaf name, and a
   surviving icon is named, never silently skipped.

## Testability constraints (the design's spine)

- KOSMOS_APP_DIR (verbatim override) means sandbox: no probing, no home
  reach, no browser. Unchanged contract.
- KOSMOS_SYS_APP_DIR exists ONLY so the harness can drive the probe AND its
  fallback against disposable directories; the fallback leg is what a
  standard (non-admin) user lives on, and a fallback that can only run where
  the primary works is untested by construction.
- tools/test-install.sh grew from 22 to 55 assertions (the count the
  harness itself prints): probe success (system folder, honest sentences,
  stale-icon cleanup with the move named, no residue, the fresh-install
  open via a recording stub), probe failure (home folder, no residue in
  the read-only dir, the KOSMOS_NO_OPEN suppressor), the override-bypasses-
  probe invariant, the ownership-checked uninstall sweep (non-owner
  refuses in a sentence, owner takes), the aliased-folders world
  (~/Applications symlinked to the system folder: install survives its own
  cleanup, a foreign uninstall cannot delete through the link), and the
  foreign-bundle divert (a Kosmos.app this installer did not create is
  never claimed, never modified, and the divert speaks its own sentence).

## Out of scope

Publishing the new /setup to chaoskosmos.com (separate site-side publish
step after merge, same verbatim-copy + provenance-header process as today's
publish), and the rest of the launch-debt list (signing, icns artwork,
13.x boot test).
