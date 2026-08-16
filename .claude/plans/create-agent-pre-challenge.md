---
method: challenge-loop
branch: create-agent
diff_hash: f171ab429f9b4a76569611023331609096dfcbf1f97358149ac76becace74427
date: 2026-08-16
iterations: 1
stop_reason: Josh's standing review-depth rule (2026-08-15, reaffirmed for
  today's build wave by Splinter's relay, "build, do not verify in rounds"):
  stop when a round finds no open blockers. Round 1's single blocker and
  every warning were fixed and re-verified by measurement; the fixes were
  checked with the reviewer's own instruments (reflow sweep, mutation tests
  on the pins, pill-truth paths), not by a second blind round.
plan: .claude/plans/create-agent-20260816.md
---

# Challenge-loop proof: create-agent

One blind, fresh review agent (ca-review-1) reviewed the full
origin/main...HEAD diff with no prior context, measured its findings in a
real browser against a sandboxed server, and mutation-tested the pins it
suspected. The orchestrator fixed everything and re-verified each fix with
the same instruments.

## Ledger

| # | Category | Where | Finding | Status |
|---|----------|-------|---------|--------|
| 1 | [BLOCKER] | web/index.html .pick2 | No wrap path: SC 1.4.10 reflow failure at 320-440px (measured overflow table) | FIXED (no nowrap, min-width 0, stacked <=560px; re-measured 0 overflow 320-600; residual 9px at 320 is main's own .tab bar, stash-compared) |
| 2 | [WARNING] | web/index.html Recommended pill | Computed once: deep-link race showed it over a full board; second visits kept it stale | FIXED (BOARD_SEEN + updateRecPill on every open and tick; measured false on a 14-agent board) |
| 3 | [WARNING] | server.test.js pin | Loose substring matched a second occurrence; both mutations stayed green | FIXED (anchored to the PICKED assignment + pickMode('pm')) |
| 4 | [WARNING] | recommended row | No caution slot: a re-keyed pm falling back to ea would hide its limit | FIXED (slot renders any caution) |
| 5 | [WARNING] | create.test.js both-places | 3 of 8 cautions pinned; support really had no instruction boundary | FIXED (derived loop over all cautioned roles, per-role boundary map, fail-loud on unregistered, positive control; support's boundary routed through Mona Lisa, doc 297fc04, applied verbatim) |
| 6 | [WARNING] | radiogroup | Owned a non-radio child (the menu) | FIXED (radiogroup wraps only the radios) |
| 7 | [WARNING] | roledesc | No live region: browsing options could skip the caution | FIXED (aria-live polite) |
| 8 | [WARNING] | name-step headline | toLowerCase destroyed acronyms ("seo specialist") | FIXED (all-caps words survive; measured "Name your SEO specialist") |
| 9 | [CONVENTION] | caution CSS | Third border-token variant; greyscale comment on the dead selector | FIXED (unified on the established rule, comment moved) |
| 10 | [NIT] | .pick .caution | Dead rule | FIXED (removed) |

[STRENGTH] recorded by the reviewer: the fetch-failure path measured clean
(no fallback menu, honest message, full recovery); the catalogue transfer
mechanically verified 26/26 against the spec doc including the deliberate
oddities, with finance's and legal's cautions byte-identical to main.

## Verification at proof time (tip 6ce6d48)

- node --test: 768/768.
- Measured drive-through of every fix: reflow sweep 320-600 (0 row
  overflow), radiogroup children radio,radio, pill false on a seen
  14-agent board, "Name your SEO specialist", roledesc aria-live polite,
  zero page errors.
