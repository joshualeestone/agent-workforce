---
branch: app-shell
method: challenge-loop
diff_hash: 99a7bfeae5529d5058debd10ed7ebca2a486a4f19c2ad63db6756097cffe4a43
converged: false
rounds: 8
note: cap of 8 reached (set before round 1, sized to blast radius); the final round's findings were all fixed and verified before this proof, the chat-branch valve precedent
date: 2026-08-15T06:10Z
---

# Challenge-loop proof: app-shell

Eight rounds of fresh, blind reviewers (shell-review-1 through 8), each
with no access to prior findings, most independently running node --test
and the sandboxed render-projects harness with their own measurements.

## Ledger summary (final ledger; every finding below is FIXED and verified
unless marked accepted-and-recorded)

### Final Ledger highlights

[BLOCKER] web/index.html paintArchived -- stale setIfChanged cache made the archive a one-way door (round 1; fixed, 8g kills the mutant by name)
[BLOCKER] web/index.html restore handler -- extra paintProjects overwrote the honest error card (round 2; fixed)
[BLOCKER] web/index.html detail restore arm -- claimed a state nobody read (round 3; fixed)
[BLOCKER] web/index.html .vt.on focus ring -- drew in its own fill at 1.15:1 (round 3; fixed, ring inverts with fill)
[BLOCKER] web/index.html notes -- sentences outliving their truth after poll recovery (rounds 4-6; all three arms now moment sentences, property asserted)
[BLOCKER] web/index.html focus -- keyboard dropped to body on restore-from-detail and on both failed-PUT directions (rounds 7-8; fixed, driven by harness focus assertions)
[BLOCKER] web/index.html disclosure failure sentence -- never retired by its own success (round 8; cleared at entry)
[WARNING] engine/projects.js archivedAt -- healed by flag and VALUE on read and write (rounds 4-5; "Archived 1/1/1970" class killed, tested)
[WARNING] server.js PUT -- validate-all-then-one-write via edit() (rounds 2-4; mixed bodies land neither half, tested)
[WARNING] html scroll pad -- measured per width where the bar wraps (rounds 4-5; 8j asserts pad >= bar)
[CONVENTION] setArchived/rename as test-held wrappers over edit -- accepted and recorded
[NIT] members-box vocabulary mix -- accepted (only the heading and reveal were pinned)
[STRENGTH] -- the archived/active split computed once, counts structurally derived from rendered rows
[STRENGTH] -- the harness asserts properties (no screen references, focus survival) rather than strings, and drives every failure arm

## Ledger narrative

Round 1: 3 BLOCKER (stale setIfChanged cache made the archive a one-way
door; the archive note claimed a list nobody re-read; a failed Restore
was indistinguishable from an untouched button) -- all fixed, the cache
one held by the 8g same-day re-archive step that kills the mutant by
name. 4 WARNING fixed (no-field PUT refusal, focus rescue, archived mark
on agent cards, record-level heal tests).
Round 2: 1 BLOCKER (the Restore handler's extra paintProjects overwrote
the honest error card with a stale list) fixed; PUT validates all before
writing; the detail states its archived fact; Label-in-Name; scroll pad.
Round 3: 2 BLOCKER (the detail restore arm claimed a state nobody read;
the selected toggle's focus ring drew in its own fill, 1.15:1) fixed;
setArchived heals by flag on write; px scroll pad; retried reads.
Round 4: 1 BLOCKER (the round-2 sentence aged into a lie when the poll
recovered) fixed: notes describe moments; one write per save (edit());
archivedAt healed by VALUE both sides; 8h/8i drive both failure arms.
Round 5: 2 BLOCKER (the detail note described the screen; the harness
held the two arms to different standards) fixed; recovery driven; the
pad measured where the bar wraps (8j).
Round 6: 1 BLOCKER (the archive note's healthy branch pointed at the
screen and a LATER failed poll broke it) fixed: all three note arms are
moment sentences, the property (no screen references) asserted at every
note site.
Round 7: 1 BLOCKER (restore-from-detail dropped the keyboard while its
own comment claimed otherwise) fixed; withdrawn sections hold no
invisible controls; every rescue driven by focus assertions.
Round 8 (final): 2 BLOCKER (the failed-PUT direction dropped focus and
left the control unmarked; the disclosure's failure sentence was never
retired by its own success) -- fixed and driven by a stubbed-PUT harness
scenario before this proof.

## Mutants planted and killed (named check red, then restored)

- appLocationCheck-style: n/a here; the shell mutants were: the empty
  branch hiding without clearing (8g reds by name, measured); the PUT
  re-tell gate respelled (mixed-body test); the archivedAt stray
  republished (value-heal tests); each restored and re-verified green.

## Verification at close

node --test: 747 pass. render-projects harness exit 0: all steps
including 8-shell (sticky bar by symptom, K-mark delegation, pinned
member wording, scoped toggles with contrast measured in both fill
states and both schemes, archive/restore round trips, same-day
re-archive, both restore arms and the failed-PUT arm under stubs, focus
assertions on every arm, the scroll pad against the measured bar at
wrapped widths). Evidence shots committed under
docs/screenshots/app-shell-*.
