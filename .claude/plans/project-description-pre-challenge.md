---
branch: project-description
method: challenge-loop
diff_hash: d451dc08ab2e255078dda4a4fe89b4595371bd6208c8aee1b155f0971e531547
converged: true
rounds: 6
date: 2026-08-15T05:50Z
---

# Challenge-loop proof: project-description

Six rounds of fresh, blind reviewers (desc-review-1 through desc-review-6),
each with no access to prior findings, each running node --test and most
running the sandboxed render-projects harness independently.

## Ledger summary

Round 1: 7 WARNING, 7 NIT. [WARNING] server.js PUT ran two independent
mutations (fixed: engine edit(), one mutate, validate-all-first).
[WARNING] no-recognized-field PUT answered 200 (fixed: refused).
[WARNING] POST/PUT disagreed on non-string descriptions (fixed: one rule,
words or refused). [WARNING] detail absence arm undriven (fixed).
[WARNING] .pj-desc missing from contrast sweep (fixed). [WARNING]
escaping pin one-armed (fixed: textContent pin). [WARNING] .pj-desc lost
the cascade to .panel p (fixed: element-qualified selectors).
Round 2: 4 WARNING (validation after mkdir left orphan folders -- hoisted
with a counted control; cleanName coerced objects -- words-or-refused
extended; blockBody negative assertion added; harness hung on throws --
browser closes in the tail finally). All fixed, mutation-verified.
Round 3: 2 WARNING (cleanName guard untested -- tested on every writer;
re-tell gate untested -- tested both directions). 
Round 4: 1 BLOCKER (the round-3 re-tell test measured idempotence, not
the gate -- now held by the told stamp; gate-deletion mutant reds it by
name). Fixed.
Round 5: 4 WARNING (clock breath moved to the discriminating assertion;
over-length refused with a sentence like the name; null is absence like
name and folder; detail sentence inked apart from the path). All fixed.
Round 6: 0 BLOCKER. 2 WARNING recorded as decisions (no person-facing
writer until the settings screen; the counting split is deliberate and
documented at the rule). Nits applied. CONVERGED at the cap set before
round 1 (6, sized to blast radius).

## Mutants planted and killed (named check red each time, then restored)

- edit() reverted to sequential mutates: engine + route atomicity tests.
- desc.textContent swapped to innerHTML: the server.test source pin.
- re-tell gate deleted (if true): the told-stamp equality.
- describe's description normalization removed: the legacy READ test.
- cleanDescription moved below makeFolder: the orphan-folder counter.
- desc.hidden forced false: the rendered-absence harness arm.
- Row esc() dropped: harness verbatim-text arm and the source pin.

## Verification at close

node --test: 747 pass, 0 fail. render-projects harness: all steps green
including 2b (rendered escaping with live markup, both absence arms,
row/detail size equality, the one-line cap), WCAG AA light and dark, no
console errors, no overflow. Evidence shots committed under
docs/screenshots/projects-description-*.
