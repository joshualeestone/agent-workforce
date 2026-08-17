---
pre_challenge: true
method: challenge-loop
branch: pack-onboarding
diff_hash: 37e86c925c1eeaee96432f572b38c1bfe0c831664bb1cd4fbc58dc88f9e093d2
subdir_audit: passed
timestamp: 2026-08-17T18:31:02Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (round 6 found zero BLOCKERs, WARNINGs, or CONVENTIONs)
**Total findings:** 50 (0 BLOCKERs, 10 WARNINGs, 12 CONVENTIONs, 28 NITs)
**Fixed:** 44 | **Deferred:** 5 (plus 1 duplicate confirmed against a deferral)

### Per-Iteration Breakdown

#### Iteration 1 (fixes in e9014de)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 4 CONVENTIONs, 5 NITs
- [WARNING] docs/browser-checks/render-pjsettings.js:38 (+render-tasks, render-update-toast x2) — sibling drives still dismissed the overlay with the removed #fr-skip; would time out whenever the overlay appears --> FIXED: Escape press (the surviving exit)
- [WARNING] web/index.html Escape handler — no isComposing guard on the now-sole exit; a CJK composition-cancel would tear down setup --> FIXED: the composer's two-spelling guard (isComposing || keyCode 229)
- [WARNING] web/index.html About-you — no on-screen sentence that the profile travels to the provider --> DEFERRED: Josh's decision of record (he ruled the Welcome line final and cut the intro line himself, 2026-08-17)
- [CONVENTION] frPaintSubscription comment contradicted the static Connect button --> FIXED (reconciled; later narrowed further in iter 4)
- [CONVENTION] dead CSS for removed elements (#fr-back, .fr-skip, .fr-names, .fr-bar) --> FIXED: swept
- [CONVENTION] five stale comments describing deleted Back/Skip/drag-variant behavior --> FIXED
- [CONVENTION] plan still listed Back/Skip as a shipped deviation --> FIXED: records the later removal ruling
- [NIT] provider discs role="img" duplicating visible text --> FIXED: aria-hidden
- [NIT] inline style in JS-built reveal wrapper --> FIXED: .fr-revealrow rule
- [NIT] reveal routes' divergent success shapes (opened vs ok) --> FIXED: one shape
- [NIT] nested live region in frRevealSay --> FIXED: child role removed
- [NIT] reveal test leaked mkdtemp sandboxes --> FIXED: cleanup in finally

#### Iteration 2 (fixes in 274174c)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 3 CONVENTIONs, 3 NITs
- [WARNING] engine/machine.js reveal opener had no timeout; a hung `open` blocks the single-threaded server --> FIXED: sibling's { timeout: 5000, stdio: 'ignore' }
- [WARNING] reveal catch swallowed programming errors into the refusal sentence --> FIXED: ReferenceError/TypeError rethrow (the pattern revealFolder documents)
- [WARNING] connect sub-screens painted app-scheme tokens onto the forced-light card in dark --> FIXED: pack-ink pins for .btn, code input, log tail, action-row hairline
- [WARNING] no harness pinned reliability-or-no-button or the reveal failure path --> FIXED: render drive asserts #fr-reveal presence per state and exercises the 409-speaks / success-clears round trip
- [CONVENTION] dead .chk/.fc-word CSS (second copy of the row styling) --> FIXED: removed
- [CONVENTION] thirteen comments still numbering the machine screen step 2 --> FIXED: renumbered
- [CONVENTION] plan's one-COPY-table promise did not match the inline-copy reality --> FIXED: deviation recorded with reasoning
- [NIT] failure sentence outlived a working reveal --> FIXED: cleared on ok
- [NIT] unreachable inline crossSiteWrite in the reveal route --> FIXED: removed, global-guard comment
- [NIT] "FILE named Kosmos.app" test comment over an empty-dir fixture --> FIXED: fixture is now genuinely a file

#### Iteration 3 (fixes in fd365ea)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs
- [WARNING] route catch flattened the engine's programming-error split back into a 409 refusal --> FIXED: 500 in the sibling shape, tested both directions
- [NIT] inline re-require of child_process --> FIXED: module-level execFileSync
- [NIT] errored non-ENOENT branch unpinned at the engine; 409 mapping untested --> FIXED: sealed-dir engine test + route-level refusal/500 tests
- [NIT] fleetNames still shipped on the wire with no reader --> FIXED: pruned (count only, per Josh's 600-agent ruling); hygiene pins moved to fleet()
- [NIT] plannedRefusals allowance could leak into later shots --> FIXED (superseded in iter 6 by the URL-keyed exemption)
- [NIT] stale ".fr-bar above" AA reference, frFinish Skip mention, intro scaffolding --> FIXED

#### Iteration 4 (fixes in 7e6d4e2)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs, 3 NITs
- [WARNING] asymmetry comments overstated the unknown-verdict guarantee --> FIXED: comments state precisely what start() delivers (CONNECTED short-circuits; unknown enters a drive whose REPL detection stays honest)
- [WARNING] Escape-only exit is not touch-accessible --> DEFERRED: Josh's documented ruling plus the pack's decisions table; macOS desktop product; recorded as residual risk
- [CONVENTION] stale ?fr-step=4 deep link, orphaned reveal-folder comment, stale drive comment --> FIXED
- [NIT] .fr-primary:hover opacity leaked onto the gold primary --> FIXED: opacity pinned
- [NIT] 500 detail carries the raw internal message --> DEFERRED: matches the sibling routes' established shape on a localhost-only server (reviewer noted for awareness, not change)
- [NIT] 12-cap rationale unrecorded --> FIXED: comment

#### Iteration 5 (fixes in c1da41d)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 4 NITs
- [CONVENTION] restart-check comments contradicted Josh's ruled copy --> FIXED: comments record the ruling superseding the hedge, and what survives of it ("made here" scope)
- [CONVENTION] appLocation comment's pre-redesign step numbers --> FIXED
- [NIT] dead .btn-gold/.btn-quiet classes --> FIXED: removed (ID rules carry the real styling)
- [NIT] fleet() derived-and-discarded names on every call (600 file reads in the motivating case) --> FIXED: withNames option
- [NIT] Escape discoverability for sighted pointer-only users --> DEFERRED: same ruling as the iter-4 residual, recorded
- [NIT] empty p.fr-msg parked in the live region --> FIXED: cleared message removes its node

#### Iteration 6 (fixes in c70247b)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Converged** — no new actionable findings.
- [NIT] stale step-5 fork comment in the render drive --> FIXED
- [NIT] plannedRefusals counter racing the async console handler --> FIXED: exemption keyed on the resource URL, counter gone
- [NIT] #fr-llm-connect lacked the one-press guard --> FIXED (start() idempotency already backstopped it)
- [NIT] checking placeholder lost its dashed in-progress look in the reskin --> FIXED: dash restored in pack palette
- [NIT] Escape-only residual --> duplicate of the iter-4/5 deferral, confirmed deferred
- [NIT] fleet({withNames}) has no production caller --> DEFERRED: kept knowingly as the tested seam for future callers, comment says so

### Final Ledger (deferred items)

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html (About-you) | No on-screen profile-travels disclosure | DEFERRED | Josh's decision of record, 2026-08-17 |
| 2 | 4 | WARNING | web/index.html (Escape exit) | No touch/pointer exit | DEFERRED | Josh + pack ruling; macOS desktop product |
| 3 | 4 | NIT | server.js (500 detail) | Raw message in detail field | DEFERRED | Sibling shape, localhost-only |
| 4 | 5 | NIT | web/index.html (vh hint) | Escape hint visually hidden | DEFERRED | Same ruling as #2 |
| 5 | 6 | NIT | engine/firstrun.js | withNames has no production caller | DEFERRED | Kept knowingly, documented |

### Strengths (across all iterations)
- revealApp called a model addition by four independent reviewers: engine re-derives the path, nothing from the request honoured, ENOENT-vs-errored discipline, programming-error split at both layers, tested end to end
- Test movement matched behavior movement: real frForkActions instead of stubs, absence pins for the removed chips in both directions, exact-string ending buttons, Escape proven from keyboard-land
- Every ruled copy change anchored to its authority (pack verbatim, spec ruling, or Josh's dated word) at the point of use, including the two deliberate pack deviations
- The IME guard landed at exactly the moment Escape became the only exit
