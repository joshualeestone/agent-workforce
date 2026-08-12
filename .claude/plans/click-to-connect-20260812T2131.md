# Click-to-connect: first-run step 3 connects Claude instead of describing how to

Branch `click-to-connect`, worktree `~/work/agent-workforce-click-to-connect`, off `main` at `e487eb0`.

## Why

The installer deliberately installs no provider (settled with Josh 2026-08-12, recorded
in `install/setup.sh` on the `install` branch): "Choosing a provider inside the app is
what installs that provider, which is also the click that signs you into it." Today the
app holds up its half of that bargain with a sentence: step 3 of first run tells the
user to "sign in to Claude on this computer", which for a non-technical person means
Terminal, which means the flow has a hole exactly where the product promise is.

This is the prerequisite for pass 1 of the three-pass installer test, so the walkthrough
tests the flow we intend to ship rather than one with a known gap.

## What was verified before planning (measured 2026-08-12, this machine, claude v2.1.229)

The prior session claimed "the commands are confirmed to work" but left no record of
which commands. So they were re-verified, and the record is here:

1. **The official install is three plain HTTPS GETs plus a checksum.** Read from
   `https://claude.ai/install.sh` (217 lines): `GET downloads.claude.ai/claude-code-releases/latest`
   returns a version string; `GET .../<version>/manifest.json` carries a SHA256 per
   platform; `GET .../<version>/darwin-arm64/claude` is the self-contained binary.
   Verify checksum, `chmod +x`, then run `<binary> install` to set up the launcher.
   No sudo, no Homebrew, no Xcode. All of it is doable natively in zero-dependency
   Node, which is what gives our UI a real progress bar.
2. **The sign-in is driveable through a pty.** Run in a sandboxed `CLAUDE_CONFIG_DIR`
   inside a throwaway tmux session: fresh `claude` shows theme choice, then login
   method choice ("Claude account with subscription" is option 1), then prints
   "Opening browser to sign in…" and OPENS THE BROWSER ITSELF, then prints the OAuth
   URL as fallback and waits at "Paste code here if prompted >". The redirect URI is
   `platform.claude.com/oauth/code/callback`, which hands the user a code to paste.
   So: the CLI opens the browser, the user authorizes, and the one thing our UI must
   collect is the pasted code, which tmux `send-keys` can deliver to the CLI.
3. **What "connected" means is already decided.** `engine/subscription.check()` reads
   `oauthAccount.organizationType` from `~/.claude.json` (overridable). A completed
   login writes that block. Nothing new to invent on the detection side.

## What this does NOT verify, said now so it cannot look covered later

- **The final hop of a real login.** Completing OAuth here means signing an agent into
  a live account on the fleet machine. Not done. The engine's completion path is
  exercised against a scripted fake CLI; the real end-to-end completion belongs to
  pass 1 on the test machine, and the pass 1 notes must check it explicitly.
- **Anything on a machine that is not this one.** Same standing caveat as the installer.

## Design

### The rule this feature inherits

Three answers, not two, at every step. The driver reads a terminal; a pane whose
content it does not recognise is "we cannot tell", surfaced with what the terminal
actually shows, never guessed past and never rendered as failure or success.

### New engine module: `engine/connect.js`

A state machine persisted to disk (so quit-and-reopen mid-download resumes) with
states:

`idle` → `downloading` (bytes so far / total) → `installing` → `signin-launching` →
`signin-browser-open` (carries the captured OAuth URL) → `signin-awaiting-code` →
`signin-completing` → `checking` → `connected` | `stuck`

- `stuck` is not "failed": it carries `because` plus the tail of the pane so the UI
  can show what actually happened and offer the honest fallback ("open Terminal and
  run claude", the URL, try again).
- **Download:** native `https` gets with redirect-follow, SHA256 verify against the
  manifest before anything is executed, written to a temp path and renamed only
  after verification. Progress from Content-Length; absent Content-Length degrades
  to bytes-so-far. A partial file on resume is discarded and restarted, stated in
  the state rather than silently.
- **Install:** `execFile(<binary>, ['install'])`, arg-array, never a shell.
- **Sign-in:** a dedicated tmux session (`kosmos-connect`), tmux resolved the same
  way `create.js` does (`AGENT_WORKFORCE_TMUX_BIN` first). The driver polls
  `capture-pane` and recognises exactly the screens verified above: theme prompt
  (send Enter), login-method prompt (send Enter on option 1), URL line (capture it),
  paste prompt (wait for the user's code, `send-keys` it), and the post-login state.
  Every recognizer is written against captured fixture text from the real probe, per
  the fixture-discipline rule: no invented pane content in tests.
- **Completion:** poll `subscription.check()` (fresh, not cached) until it answers
  `connected`, with a bounded wait; then kill the connect session and report.
- Every root overridable for tests: config path (`AGENT_WORKFORCE_CLAUDE_CONFIG`),
  tmux bin, download base URL (`AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE`), the claude
  binary itself (`AGENT_WORKFORCE_CLAUDE_BIN`), state file root (`AGENT_WORKFORCE_DATA`).

### Server routes

- `POST /api/connect/start`: begins (or resumes) the flow. Idempotent while running.
- `GET  /api/connect`: current state + progress. Polled by the UI. Never 500s for a
  state question; unknown is an answer.
- `POST /api/connect/code`: `{code}` forwarded to the waiting CLI. Refused (with a
  reason) when the flow is not at `signin-awaiting-code`.
- `POST /api/connect/cancel`: kills the connect session, cleans up partial download,
  returns to `idle`. Nothing on the user's machine is left half-claimed.

POSTs inherit the existing cross-site guard, same as `/api/first-run/complete`.

### UI: first-run step 3 only (scope held deliberately)

- In `none` and `unknown` states, alongside the existing copy: a **"Connect Claude"**
  button. The existing "Continue anyway" and "Check again" stay; connecting is
  offered, never forced (first run never blocks, decision 4 of the first-run plan).
- Clicking walks the state machine on screen: download progress bar with real bytes,
  "Setting up", "Your browser has opened. Sign in there. If it gives you a code,
  paste it here:" with an input, then the re-checked verdict painted by the same
  `frPaintSubscription()` that paints it today.
- `stuck` renders what the terminal said plus the fallback instructions, and never
  claims anything it did not observe.
- The board's connection notice (#31) does NOT grow a connect button in this branch.
  One surface first. Noted as a follow-up.

## Risks, named

- **The app makes network calls for the first time** (the download). This is the
  settled installer design working as intended, but it is a real change to the app's
  character and gets called out in the PR body.
- **Screen-scraping a TUI is version-coupled.** Mitigated by the three-answer rule:
  an unrecognised screen degrades to `stuck` with the pane content shown, and the
  manual path always remains. Recognisers live in one file with their fixture text.
- **The paste-a-code moment is the roughest edge for a non-technical person.** The
  copy has to carry it. Pass 3 (Josh on the Mini) is the real test of that copy.
- **A live-credential machine is the wrong place to test login completion.** Hence
  the fake-CLI completion tests plus sandboxed real-CLI tests up to the paste
  prompt, and explicit deferral of the final hop to pass 1.

## Work items

- [x] 1. `engine/connect.js`: state store + download with SHA256 verify + progress
        (tests: fixture download server, checksum mismatch refuses to execute,
        resume discards partials, progress shape)
- [x] 2. `engine/connect.js`: install step + sign-in driver against captured-fixture
        pane text (tests: every recognised screen, an unrecognised screen goes
        `stuck` with the tail, code forwarding, completion via subscription flip,
        fake CLI end-to-end)
- [x] 3. Server routes + tests (start/status/code/cancel, guard inheritance,
        never-500 on status, refusal reasons) -- `server.connect.test.js`, a
        separate file per the projects precedent (merge-hazard avoidance)
- [x] 4. First-run step 3 UI + browser check -- `render-connect.js`, 34/34,
        light + dark, screenshots in `docs/browser-checks/shots/`
- [x] 5. Live verify, sandboxed -- committed as
        `docs/browser-checks/live-connect.js`. Measured: 281MB download in 9.1s,
        checksum verified; `claude install` exits 0 with NO tty (TERM=dumb), so
        the engine's execFile assumption holds; the real driver walked the real
        v2.1.229 CLI to the paste prompt and captured the OAuth URL; cancel
        cleaned up; no credentials were created.
- [x] 6. README + browser-checks README updated (step 3 now connects; the
        deliberate non-verification of the final hop recorded in both)
- [ ] 7. /challenge-loop to convergence, then PR with screenshots (reviewer
        joshualeestone, screenshot in PR + Discord per standing rule)

## Execution notes (what the plan did not predict)

- **The screenshot caught what 32 green checks did not**: the phase
  announcement (a live region for screen readers) rendered visibly under a
  panel title that already said the same thing -- the said-it-twice copy
  defect class from #31, again. Moved to a visually-hidden live region; a
  check now asserts single-statement visible copy AND that the announcement
  still exists for screen readers.
- **Scope call made during build:** the `unknown` subscription state does NOT
  get a Connect button (the plan said none + unknown). Unknown can be a
  signed-in paying customer we failed to read; pushing them into a sign-in
  flow is the exact asymmetry `engine/subscription.js` exists to prevent.
  Recorded in a comment at the decision site.
- **"Check again" left the `none` state** (two-button bar): Connect Claude
  re-checks reality before doing anything, so the just-signed-in-via-Terminal
  case is covered by the same button.
- **A driver hazard found while designing, not by a test:** a machine whose
  CLI reaches the REPL while the subscription still reads not-connected
  (unknown plan shapes) would have looped forever; it now goes `stuck` with an
  honest sentence.
- The plan guessed the binary at 100-200MB; it is 281MB.
- Two stale browser-check servers from this morning's merged branches were
  squatting ports 4413/4414 and answering with OLD code (`no such endpoint`
  for `/api/connect`). Verified by cwd before killing. The check now runs on
  4437.
- **The org validation helper does not fit this repo and was not gamed to
  pass.** `validation_log_run_or_skip` sees a package.json and runs the org TS
  sequence (`yarn type-check && lint-fix && test && build`); this
  zero-dependency repo deliberately has none of those scripts, and no previous
  branch here has a validation-proof record either (checked
  `~/.cache/claude-validation-proofs/`). The repo's whole validation story is
  `node --test` (555/555), the rendered checks (34/34, light+dark), and the
  sandboxed live check -- all run and green. Adding fake no-op `type-check`
  and `build` scripts to satisfy the log would be tooling theatre; recorded
  here instead.
