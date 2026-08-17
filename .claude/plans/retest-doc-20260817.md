# retest-doc -- write down the clean-machine re-test procedure

## Why

The uninstall-for-retest instruction has been given wrong twice on
2026-08-17, both times by someone who had read the relevant code:
--uninstall preserves the store, first-run.json lives in the store, so
uninstall-then-reinstall skips the wizard and reads as a broken
release. Splinter caught the second instance minutes before Josh ran
it and asked for the durable fix: the three-line form in the docs so
it stops depending on someone remembering.

## What

One new file, docs/clean-machine-retest.md: the trap, the destructive
full-clean form, the surgical re-arm-the-wizard form, and why
--uninstall will not take the store itself. No code changes.

## Verification

Doc-only; validation suite green; the commands quoted match
install/setup.sh and engine/firstrun.js (verified in-session against
setup.sh lines 785-807 and firstrun.js line 33).
