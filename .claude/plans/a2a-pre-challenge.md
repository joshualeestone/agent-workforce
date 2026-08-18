---
pre_challenge: true
method: challenge-loop
branch: a2a
diff_hash: 966f8e53cbb5d2b5370ed1c78a158f1197e3def41956e79050e8f6a794b25e91
subdir_audit: passed
timestamp: 2026-08-18T04:52:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind passes plus fix passes, per the standing chunk
shape (Splinter, 2026-08-18: one blind pass per chunk, cap by rule at
two consecutive passes with no blocker-class finding). Both passes ran
with an injection-focused brief since this surface is agents typing
into each other's live terminals. ZERO BLOCKERS in either pass; every
warning fixed the same sitting; the cap rule is satisfied.
**Total findings:** 0 BLOCKERs, 8 WARNINGs, 8 NITs (1 deferred)
**Fixed:** 15 | **Deferred with recorded reasons:** 1

### Pass 1 (5 WARNINGs, 4 NITs -- fixed in d595329)
- The envelope prefix laundered an empty/coerced body past chat's own
  contract (measured: '' typed a bare marker line; {} typed
  [object Object]) --> the body is now checked AS ITSELF via chat's own
  messageProblem (sliced under the length rule spill relaxes), with
  nothing-typed pins.
- in_reply_to accepted any m<digits> shape (a sender could assert a
  conversation that never happened) --> must name a real logged message.
- A raw NUL byte in pairKey made the whole security-sensitive module
  binary to git (no reviewable diffs forever) --> spelled as an escape.
- The CLI broke newline-bearing bodies in transit (JSON parse failure
  mis-diagnosed as unreachable) --> newlines/tabs collapse before
  transit; -f dropped so HTTP errors carry the server's own sentence.
- The bracket grammar was forgeable in-band (a body containing the
  marker reads as a second envelope; the born block teaches recipients
  to trust it) --> marker-bearing bodies refused in words;
  envelope-breaking session names refused.
- NITs: pane-comment credited the regex instead of the argv position
  (the operative guard); spill orphans deleted on refusal; null route
  body answered in sentences; valve logs its closing once per window;
  pairCount's fail-open on unparseable dates documented.

### Pass 2 (3 WARNINGs, 4 NITs -- fixed in 4febe58, one deferred)
- The CLI's unconfirmed sentence over-claimed ("reached the session"
  for a state that includes timed-out-mid-flight) --> speaks the
  server's own because, exits 3 (distinct from placed; never 1, which
  would invite the retry the state exists to stop).
- The citation guard was looser than every statement of it (recipient
  participation sufficed) --> the SENDER must have been in the cited
  message; the test's control now proves the author-cites-own case
  delivers and the never-there case refuses.
- Unbounded growth --> a 64KB document ceiling in words ("that is a
  document, not a message; put it in the project folder and send the
  path"); log retention explicitly RECORDED as the screens chunk's
  product decision, with the every-send-re-reads cost documented
  in-module. DEFERRED beyond that: rotation itself.
- NITs: carriage returns collapse with their siblings; the send curl
  gets -m 15; the marker gate's homoglyph limit acknowledged in-module
  (cleanMessage means no forged marker can start its own line); the
  born block teaches the real arrival shape including the id.

### Both passes' strengths (reviewers')
- The attribution chain is derived end to end: a typed from: claim
  provably cannot outrank the pane (route-pinned), charset-gated before
  tmux, roster-tied, the sender's own name refused if it would break
  the envelope.
- Delivery reuses chat.deliver whole: exact-pinned target, at-keystroke
  re-verification, shared three-state vocabulary unnarrowed.
- The tests' controls control: outside-window valve control, short-body
  no-file control, control-of-the-control on citations, every
  nothing-was-typed assertion reading recorded send-keys.

### Live exercise
The CLI ran against a real worktree server three times across the
passes: both refusal paths and the newline case return the server's own
sentences with honest exit codes. The delivered path is engine+route
tested (typing into a real colleague's live composer was not a test).

### Plan
.claude/plans/a2a-20260818.md records the shape rulings (point-to-point
never a board, derived identity with its honest limit, the five ruled
log fields, the valve, spill) and the deliberate exclusions (screens
and copy are Mona Lisa's next chunk; the PM caution stays her ruled
copy until the capability reaches a user; existing agents' boot files
untouched overnight; custom-instruction agents keep their file verbatim).
