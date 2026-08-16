# domain-switch (app repo): repoint installer sources to installkosmos.com

The app-repo half of Phase 1 of the domain changeover
(Josh-Brain/Projects/kosmos-domain-changeover.md section 2c; Josh's go
2026-08-16 5:54 PM). The site repo's `setup` and `dist/` are republished
FROM this commit, so this lands first and the site branch's provenance
header names this branch's commit.

## Changes (domain strings only; identifiers untouched)

- install/setup.sh: six occurrences of chaoskosmos.com become
  installkosmos.com (two header comments, KOSMOS_RELEASE_BASE default,
  the resume line printed on interrupted install, the wrong-account
  osascript alert, the uninstall hint). KEPT: the CFBundleIdentifier
  `com.chaoskosmos.kosmos` and the comment describing it; both are
  identifiers naming existing state (changeover doc section 1b fourth
  row): renaming them is a migration that would orphan the icon
  registration and launchd overrides on existing installs.
- install/kosmos: the three "Kosmos looks incomplete" die messages'
  reinstall lines.
- README.md: the install line and the dist reference.

## Why wholesale (no old-domain fallback)

Josh's 1:41 PM decision plus twice-measured fact: every remote fetch in
these scripts uses curl -L, and chaoskosmos.com now 308s wholesale to
installkosmos.com, so any old line or old installed copy follows the
redirect. The new sources simply name the canonical domain directly.

## Verification

- bash -n on both scripts after the sweep.
- grep proves the only remaining chaoskosmos strings in sources are the
  two identifier lines.
- tools/build-kosmos-bundle.sh run from this commit: checksum ok, smoke
  test boots and serves (the bundle embeds install/kosmos, which is why
  the rebuild is part of the same pass).
