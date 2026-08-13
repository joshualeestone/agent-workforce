---
pre_challenge: true
method: challenge-loop
branch: install
diff_hash: 0c65efca08380d036b96100744b5dc2546f9a996f16ac1e1ec4982db480a5e4b
subdir_audit: passed
timestamp: 2026-08-13T16:19:54Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (each a fresh, blind reviewer; several ran their own
sandboxed lifecycles with every root overridden)
**Converged:** Yes. Severity fell monotonically: 2 BLOCKERs -> 4 -> 3 -> 0
-> 0 -> 1 -> 0 -> 0, with the final round finding two small WARNINGs, both
fixed and re-verified in-iteration. Remaining NITs are deferred with
reasons below.
**Total findings:** 10 BLOCKERs, 47 WARNINGs, 10 CONVENTIONs, ~40 NITs
**Fixed:** all BLOCKERs, all WARNINGs, all CONVENTIONs, most NITs
**Deferred (with reasons):** concurrent-run locking (measured worst case is
a confusing message, not corruption), log rotation (Phase 1 volumes), the
icon-failure message naming the URL fallback, osascript-vs-exotic-home
quoting (the path no longer appears in the dialog), fuller libevent
notice text (named in the plan for the public-repo gate).

### The blockers, by iteration (what the loop caught)

1. **(iter 1)** No integrity check on the user-facing downloads, and
   --uninstall left a dangling `kosmos` on PATH every time (`-e` follows
   symlinks; measured). -> checksum sidecars emitted by the builders and
   REQUIRED by the installer; symlink removed before the folder with -L.
2. **(iter 2)** The Homebrew-copied tmux stamps the build machine's OS as
   its minimum (minos 26.0, measured with otool) and would load on no
   supported Mac; no runtime probe; no macOS floor gate; uninstall
   recreated the launchd disable-override trap. -> per-artifact minos
   gates in both builders (refusing what they cannot read), a 13.5 floor
   gate in the installer, `tmux -V` probes at build and install, and
   enable-before-bootout. The tmux re-source against the floor is named
   remaining work; release builds refuse to pack until it lands.
3. **(iter 3)** Updates never restarted the running board (old process
   kept serving the previous version while the installer printed
   success); uninstall's session kill prefix-matched (this repo has
   measured `kill-session -t sam` killing samantha-discord); the bundled
   Node shipped without its licence. -> stop-before-swap + `kosmos
   restart`; `=name` exact kills; Node's LICENSE rides in the bundle,
   gated.
4. **(iter 6)** The app resolves its tmux as /opt/homebrew/bin/tmux by
   default and nothing exported AGENT_WORKFORCE_TMUX_BIN, so on a clean
   Mac the first agent creation refuses -- unfindable from any machine
   with Homebrew, found by reading the resolution chain. -> exported by
   the kosmos command beside PATH and TERMINFO_DIRS, verified by reading
   the live server's environment.

### The warning-class themes (all fixed)

- curl|sh correctness under the REAL interpreter: process substitution is
  a syntax error under macOS sh (the page's own line died on line one of
  real use; fifo+tee now), a detached server inheriting fd 3 held the
  terminal open forever, and everything side-effectful now lives in
  main() invoked on the last line so a truncated download parses without
  having done anything (verified by piping a truncated copy into sh).
- Honest sentences everywhere: reachability probed before downloads (HEAD
  with a ranged-GET fallback), refusals name who is actually on the port
  (identity checks, not bare 200s, in the installer AND across
  start/stop/status), non-retryable failures no longer invite retry
  loops, unobserved outcomes are not claimed.
- Destructive paths bounded by evidence: uninstall refuses to rm -rf a
  home with no Kosmos evidence in it; session kills prove ownership via
  @kosmos_agent (verified against this machine's live fleet: a leftover
  plist named claudebot-discord did NOT kill the live session).
- Update semantics: fetch-to-stage-and-swap (failed updates cannot report
  success off the old tree; deleted files do not survive), board paused
  before the tmux swap, tmux refreshed on update instead of frozen at
  first install, stage leftovers swept.
- Drift made mechanically impossible: the macOS floor lives in
  tools/macos-floor + a consistency check inside yarn test covering all
  five floor sites and the board's identity tokens; the floor gate is one
  shared lib; SIGPIPE-under-pipefail replaced with case statements in
  every site after the bundle smoke test failed its own healthy bundle
  that way (measured).
- Regression guard: tools/test-install.sh (yarn test:install) runs the
  full sandboxed lifecycle including the download path over file:// and
  the checksum-tamper refusal; 22 assertions.

### Validation note

This branch's surface is shell + build tooling; validation is the
529-test app suite (green throughout), the shell parse gate + floor and
identity consistency checks wired into yarn test, the 22-assertion
lifecycle harness, and per-iteration sandboxed batteries (every root
overridden; the real board on 4317 verified untouched after each).

### Process note, recorded on purpose

Five iteration-7 fixes were silently lost when an edit script asserted
after mutating memory but before writing the file; the loss was caught
because the round's battery verified BEHAVIOUR (the stranger-on-port
sentence) rather than trusting that the edit had applied. The fixes were
re-applied and the full battery re-run green.

### Strengths carried through

FRESH_INSTALL keyed on the installed launcher (not the directory a failed
run leaves), computed before start_log creates evidence; the clean-Mac
tool audit (nothing on the user path can trigger the Xcode CLT dialog);
notices completeness asserted against the dynamically collected dylib
set; reversibility measured end-to-end repeatedly, leaving user data and
naming what remains.
