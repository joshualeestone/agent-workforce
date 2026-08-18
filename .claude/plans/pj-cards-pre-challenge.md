---
pre_challenge: true
method: challenge-loop
branch: pj-cards
diff_hash: e8d38729de31a4ddca8f0c90a9dc8e893b7f6f37cf5c42144dafb2113a0c1934
subdir_audit: passed
timestamp: 2026-08-18T15:05:00Z
iterations: 6
converged: true
---

# Challenge Loop Proof: pj-cards

Six review passes over the All Projects pack-card rebuild (view C of the
frozen pack, FROZEN-2026-08-17c). Passes 1-3 are recorded in the plan
file (.claude/plans/pj-cards-20260818.md); passes 4-6 ran 2026-08-18
morning, each a fresh blind agent with no access to prior findings.
Convergence by the fleet's standing cap: passes 5 and 6 were consecutive
blocker-free passes, and every warning, convention, and nit they raised
was fixed rather than deferred.

### Final Ledger (passes 4-6)

| # | Iter | Category   | File:Line | Description | Status | Resolution |
|---|------|------------|-----------|-------------|--------|------------|
| 1 | 4 | [BLOCKER] | docs/browser-checks/render-projects.js | The canonical drive still described the pre-pack page (renamed classes, retired one-line description, controls moved to settings) and could not run | FIXED | 6af38a9 |
| 2 | 4 | [WARNING] | web/index.html renderAvatar | Fallback tint never reset; flashed/persisted behind photos | FIXED | 990ebbb |
| 3 | 4 | [WARNING] | web/index.html .pjfaces | Facepile overlap was an invented idiom; pack draws separate gapped chips | FIXED | 990ebbb |
| 4 | 4 | [CONVENTION] | web/index.html | Disc header comment credited the rejected polynomial | FIXED | 990ebbb |
| 5 | 5 | [WARNING] | render-projects.js contrast sweep | Card tokens (pill/slug/count/name/initials) unmeasured; hand-checked ratios were a one-time verification | FIXED | c4c3ee5 (and the fix surfaced a false red: the sweep's background walk read a 5% translucent wash as opaque black; bgOf now composites, proven in both directions) |
| 6 | 5 | [WARNING] | web/index.html loadProjects | Settings view got no read-failure note while its facts are poll-repainted | FIXED | c4c3ee5 (#pjs-read-msg, with the matched clear on recovery) |
| 7 | 5 | [NIT] | web/index.html projectCard | Slug basename derived without filter(Boolean); settings used it | FIXED | c4c3ee5 |
| 8 | 5 | [NIT] | web/index.html paintOneProject | Orphaned archived-fact comment | FIXED | c4c3ee5 |
| 9 | 5 | [NIT] | web/index.html pjs-save | Guard read loadProjects' truthy recorded-failure answer as a good read; the retry could never fire; stale PROJECTS repainted under "Saved." | FIXED | c4c3ee5 (sibling's retry shape + PJ_READ_FAILED) |
| 10 | 5 | [NIT] | render-projects.js fillers | Read made.project.id, null when the post-write re-read throws | FIXED | c4c3ee5 (made.id, the guaranteed field) |
| 11 | 6 | [WARNING] | web/index.html renderAvatar | Falsy-agent call leaves the previous agent's identity colors on the disc | FIXED | c46173a |
| 12 | 6 | [WARNING] | render-projects.js sweep | .pj-who (the blind-spot sentence, pinned to fixed ink this branch) unmeasured while the comment claimed full coverage | FIXED | c46173a (injected onto a real card for the read, like the toggled attn pill) |
| 13 | 6 | [CONVENTION] | render-projects.js | Composited bgOf copy-pasted into four evaluate blocks | FIXED | c46173a (one window.__kbg per sweep page) |
| 14 | 6 | [NIT] | web/index.html | Dead .pj-headright rule | FIXED | c46173a |
| 15 | 6 | [NIT] | web/index.html | s.total interpolated raw | FIXED | c46173a (Number coercion) |
| 16 | 6 | [NIT] | render-projects.js | Fillers deleted only on the passing path | FIXED | c46173a (finally) |

## Gates proven to fail before their green was trusted

- Faces-row geometry guard: reds on the exact pass-3 stacking defect
  (wrapper blockified) when that defect is reintroduced.
- Extended contrast sweep: a genuinely failing slug ink (#c9c9c9) reds
  at 1.49 after the compositing fix removed the 2.20 false red.
- Description size pins: exact px per surface, so the round-1 cascade
  regression (a bare selector inheriting .panel p) cannot pass.

## Final state

- 846/846 unit tests, shell checks green, validation-log clean for this
  diff (hash e8d38729de31).
- render-projects.js drive fully green against a sandboxed server: all
  nine state groups, WCAG AA light and dark, 18 screenshots, no console
  errors on any state.

## Strengths carried forward

[STRENGTH] markers below summarize what the blind passes called out.

- Honesty boundaries pinned at the claim (pill wording requires every
  member seen; tiles driven at the DOM write; borrowed-name avatar gate
  flipped with a positive control).
- XSS discipline uniform across the string-built card; style values only
  from the two fixed palettes.
- Poll-race handling: settings repaints only its state-derived half, so
  a rename mid-type survives while stale failure marks do not.
