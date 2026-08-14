---
pre_challenge: true
method: challenge-loop
branch: open-after-install
diff_hash: a0b45c70f083c463fd57256c92b0c9dbc51d22c2a154799d73b218c7f3e71202
subdir_audit: passed
timestamp: 2026-08-14T01:03:16Z
iterations: 21
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 21 fresh, blind review agents, each with no access to
prior findings, run to convergence on the file real users pipe into sh.
**Converged:** Yes. Rounds 15-21 produced zero blockers except one
sentence-level regression of a round-17 addition, fixed in round 18;
round 21's findings were wording and posture items, all fixed or
recorded as deliberate trades. Harness 22 -> 171 assertions, green.

### Final Ledger (blockers; every one FIXED with a driving pass)

[BLOCKER] iter 1 — install/setup.sh: stale-icon cleanup deleted the app it
had just installed through a symlinked ~/Applications while printing
success. FIXED: physical-path guards, aliased-world passes.
[BLOCKER] iter 1 — install/setup.sh:2: served contract sentences ("nothing
outside your home folder") made false by the /Applications move. FIXED:
header rewritten, exceptions enumerated, kept in agreement.
[BLOCKER] iter 2 — install/setup.sh: install claimed any /Applications
occupant whose executable was not named Kosmos (fail-destructive where
uninstall failed safe). FIXED: positive ownership proof before claiming.
[BLOCKER] iter 3 — install/setup.sh: the divert wrote "to the home folder"
through an aliased symlink onto the foreign bundle it had just refused.
FIXED: aliasing guard on the divert, fail-closed no-icon sentence.
[BLOCKER] iter 6 — tools/test-install.sh: real_apps_fingerprint aborted the
whole harness silently on a Mac with no ~/Applications. FIXED: absent
fingerprints as "absent"; fractional mtime.
[BLOCKER] iter 7 — install/setup.sh: a symlink entry at the system path
whose target could not be stat'd was deleted unproven. FIXED: -e||-L
occupancy gates everywhere.
[BLOCKER] iter 7 — install/setup.sh: rm -rf could gut a bundle into an
unprovable husk wedging the slot against install AND uninstall. FIXED:
rename-aside swap; visible slot always holds a complete bundle.
[BLOCKER] iter 8 — install/setup.sh: the link sweep deleted a user's link
while printing two adjacent contradictory sentences. FIXED: link removal
gated on this run having removed the target.
[BLOCKER] iter 9 — install/setup.sh: the home folder was the one write
path with no ownership proof; a stranger's Kosmos.app there was
destroyed under a success sentence. FIXED: same gate as every other site.
[BLOCKER] iter 9 — install/setup.sh: hidden .old aside residue survived
uninstall silently under a machine-is-back-to-before closing line.
FIXED: checked, ownership-gated residue sweep that names survivors.
[BLOCKER] iter 13 — install/setup.sh: the KOSMOS_APP_DIR uninstall branch
deleted any Kosmos.app by name with no proof. FIXED: bundle_is_ours gate
plus left-alone note.
[BLOCKER] iter 13 — install/setup.sh: a fresh install onto an occupied
port printed "Kosmos is running" and opened ANOTHER install's board in
the browser. FIXED: BOARD_OURS pidfile+ps proof anchored to this
install's server path, gating sentences and the open.
[BLOCKER] iter 16 — tools/test-install.sh: a leaked board made the
sandbox-belt assertion pass under mutation. FIXED: pinned stops,
port-free precondition.
[BLOCKER] iter 18 — install/setup.sh: the occupied-port closing block
claimed an icon that was never created (regression of an iter-17
sentence). FIXED: gated on APP_MADE.

### Warnings and conventions (~60 total, all FIXED or DEFERRED with reasons)

[WARNING] classes fixed across iterations: probe litter and residue
naming; TCC dialog warm-up (anticipatory, marked unmeasured); browser
open narration and failure leg; occupied-port sentences claiming only
observed causes; KOSMOS_HOME newline/quote/dollar/backtick/backslash/
brace/relative/dot-component refusal (each mechanism measured and
recorded); KOSMOS_PORT digit/length/range guard; ps -ww; lsregister
sandbox gating measured against the real machine-global database and
swept on uninstall with re-register on failure; FIFO leaf hang (measured,
one-line -f guard); README and plan kept in exact agreement with
behavior.
[CONVENTION] iter 14 — the ownership predicate was hand-assembled at 12
sites in 4 variations, the root cause of the late blocker tail. FIXED:
one bundle_is_ours() helper, every site routed through it, every guard
level with its own driving pass.
[NIT] deferred with recorded reasons: the two practically-unreachable
fail-closed home legs (kept as defense, commented unreachable); the
undrivable TCC and restore-failure sentences (recorded in the harness as
reasoned-not-pinned); the production open default pinned by literal
rather than executed (a pass would steal the operator's browser).

[STRENGTH] The loop itself: five reviewers reproduced their findings with
standalone sandboxed scripts before reporting; two contaminations of the
real machine during review became permanent guards (the reviewer-brief
sandbox warning, the real-folder fingerprint net, the LaunchServices
gate).

### Validation

sh -n / bash -n clean; canonical validation helper (581 app tests +
shell checks + floor consistency) green at every iteration; 171-assertion
install harness green at HEAD.
