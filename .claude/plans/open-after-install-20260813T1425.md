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
2. **A fresh install ends by opening the dashboard** (`/usr/bin/open` by
   default; KOSMOS_OPEN_CMD substitutes the harness's recording stub;
   best-effort, fresh installs only). Updates stay quiet. Suppressed by
   KOSMOS_NO_OPEN or by the verbatim KOSMOS_APP_DIR sandbox override
   (KOSMOS_SYS_APP_DIR alone does not suppress it; the harness's global
   `export KOSMOS_NO_OPEN=1` is what keeps every pass quiet, and it is
   load-bearing).
3. **Uninstall sweeps both default icon locations** (pre-change installs
   wrote the home folder), each bounded by the fixed leaf name, and a
   surviving icon is named, never silently skipped.
4. **The generated .app refuses clicks from a different account**, by a
   baked-uid compare (not an under-HOME proxy, which false-alarmed on
   KOSMOS_HOME overrides). On a multi-account Mac the shared icon shows a
   dialog pointing the other account at the install line instead of
   starting the installing account's private tree. This is the one
   user-visible modal the distributed .app ships. Relatedly, the swap
   that replaces an existing icon renames it aside
   (.Kosmos.app.old.<pid>) rather than rm -rf'ing in place, so a
   partially-deletable old bundle can never be gutted into an unprovable
   husk; the visible slot always holds a complete bundle.

## Testability constraints (the design's spine)

- KOSMOS_APP_DIR (verbatim override) means sandbox: no probing, no home
  reach, no browser. Unchanged contract.
- KOSMOS_SYS_APP_DIR exists ONLY so the harness can drive the probe AND its
  fallback against disposable directories; the fallback leg is what a
  standard (non-admin) user lives on, and a fallback that can only run where
  the primary works is untested by construction.
- tools/test-install.sh grew from 22 assertions to the count the harness
  itself prints (root runs skip the chmod-denial legs loudly). The core
  additions: probe success (system folder, honest sentences, stale-icon
  cleanup with the move named, no residue, the fresh-install open via a
  recording stub), probe failure (home folder, no residue in the
  read-only dir, the KOSMOS_NO_OPEN suppressor), the override-bypasses-
  probe invariant, the ownership-checked uninstall sweep (non-owner
  refuses in a sentence, owner takes), the aliased-folders world
  (~/Applications symlinked to the system folder: install survives its
  own cleanup, a foreign uninstall cannot delete through the link), and
  the foreign-bundle divert (a Kosmos.app this installer did not create
  is never claimed, never modified, and the divert speaks its own
  sentence). Later review rounds added: the foreign-plus-aliased world
  (no icon at all rather than writing through the symlink onto a
  stranger's app), the staged bundle build (a bundle write that dies
  partway can no longer wedge the Applications slot), the wedge-retry
  leg, positive controls for every could-not-remove and left-alone note,
  an mtime pin proving the override bypasses the probe, and before/after
  fingerprints (name + mtime + size) of the operator's REAL Applications
  folders.

## Out of scope

Publishing the new /setup to chaoskosmos.com (separate site-side publish
step after merge, same verbatim-copy + provenance-header process as today's
publish), and the rest of the launch-debt list (signing, icns artwork,
13.x boot test).
