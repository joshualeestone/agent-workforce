# reach-the-command: agents (and people) can actually run kosmos

Date: 2026-08-18 ~5:40 PM. Branch `reach-the-command`. Root cause of
Josh's silent agents tonight: the instruction block teaches bare
`kosmos post`, the installer leaves the command off PATH (a note, not a
fix), so on a stock installed Mac BOTH the person and every agent get
"command not found", and the agent's failure is silent (nothing reaches
the engine, so no refusal row can exist).

## What

1. engine/projects.js `kosmosCli()`: the kosmos command as THIS machine
   can actually run it. Installed layout (`$KOSMOS_HOME/app/engine` with
   `../../bin/kosmos` and `../server.js` present) teaches the absolute
   `$KOSMOS_HOME/bin/kosmos`; a source checkout teaches
   `<repo>/install/kosmos`; when neither is provable, falls back to bare
   `kosmos` (never invents a path it did not verify). Paths carrying
   whitespace are double-quoted in the taught line.
2. blockBody teaches that command in the room line, and adds one line of
   failure guidance (Splinter's class note: pre-engine failures are
   silent, but the agent KNOWS it failed and sits in a pane it can speak
   from): if the post command fails, say so in your own words rather
   than staying silent.
3. install/setup.sh: the PATH case stops being a note. When $BIN_DIR is
   not on PATH, append a marker-guarded export line to ~/.zprofile
   (macOS default shell; created if absent), say what was done and that
   it takes effect in NEW terminal windows. Idempotent (marker check);
   --uninstall removes the marker block it added.

## Added scope (Mona Lisa's rulings, 5:35 PM)

- The verdict-family em dashes are semicolons now: the singular told
  line, the group line, and the unknown-state join in pjMember (her
  ruling on the group sentence, extended over the family she shaped;
  the GROUP_BECAUSE drafts themselves counted zero).
- Map row 2 takes her blessed shorter draft: "...and we will not create
  them".
- web/index.html:4725 (the card label-to-task join) was initially held
  back as unruled; her full eight-row table (5:37 PM) then ruled it
  explicitly (colon, a separator whose second half explains the first),
  and it is CHANGED in this branch with the rest of the table. The
  earlier held-back note is superseded.

## Why the block re-teaches existing agents

blockBody re-splices on every membership change, so the corrected
command reaches EXISTING agents' instruction files on the next sync, not
only newborns. No migration needed.

## Tests

- kosmosCli: source checkout resolves to install/kosmos (this repo,
  provable); the bare fallback fires when neither layout probe passes
  (exercised via the exported function against a temp dir masquerade is
  NOT possible since __dirname is fixed; instead the installed-layout
  probe is tested by its observable: the taught line in blockBody
  contains the resolved CLI and never a bare `kosmos` on this checkout).
- blockBody: the room line carries the resolved command; the failure
  line present; quoting arm pinned by a direct call with a
  whitespace-bearing fake (kosmosCli accepts an injected root for
  testability if needed, else the quoting branch is covered by string
  test on the helper's output shape).
- Installer: bash -n (suite); test-install.sh covers the wiring when run
  (needs staged dist trees); the wiring block itself is
  marker-idempotent by construction and the uninstall sweep mirrors the
  marker.

## Build notes (what changed while building)

- The taught-command helper became its own module (engine/clipath.js):
  BOTH teaching surfaces need it (projects blockBody and the colleagues
  block in messages.js), and projects->messages is the only safe require
  direction, so a shared leaf module keeps the graph acyclic.
- The colleagues block is spliced at BIRTH only; nothing ever refreshed
  it, so the corrected command would have reached newborn agents only.
  tellAgent now heals it, piggybacked on the one event that already
  writes the file: drift-gated (byte-equality short-circuit), and only
  where the markers already exist (spliceBlock APPENDS when absent,
  which would grow an adopted agent's file nobody asked us to grow).
- The colleagues block gains the failure line (Splinter's class note):
  a pre-engine failure draws nothing anywhere, so the agent is taught to
  say it failed in its own words.
- Mona Lisa's full em-dash table applied (8 rows, her ruling per row;
  comments exempt per her note). The block header separator (name /
  folder) also moved to a colon under her separator rule.
- Her row 3 rewrite applied: "we cannot match any of their names exactly
  to a session on this computer, so we did not write to anything".
- ⚠️ MEASURED during build: the install harness's first run with the
  wiring LEAKED a sandbox bin path into the operator's real ~/.zprofile
  (the harness overrides every root the installer knew about; the
  profile was a root it did not know). Cleaned (backup at
  ~/.zprofile.bak-kosmos-leak), then closed structurally: setup.sh
  skips the profile entirely when a sandbox app-dir override is present
  without an explicit KOSMOS_PROFILE_FILE (same keying as the lsregister
  gate), the harness names its own sandbox profile and asserts wiring,
  single-write idempotency, uninstall removal, survivor lines, AND the
  gate's skip arm. 178/178.

## Recorded limits (review deferrals with reasoning)

- The heal can grow a file: on an agent already at the instructions size
  limit, the joint write (projects block + heal in one write) is refused
  and REPORTED as the size-limit could_not; the projects update that
  would have fit alone waits until a human shrinks the file. Reported,
  not silent; rare; accepted.
- The installer's non-zsh hedge arm has no harness check: exercising it
  requires a run that is neither sandbox-keyed (the gate fires first)
  nor profile-overridden (the hedge yields to an explicit ask), and such
  a run writes real machine surfaces (Applications icon). Three-line
  case arm, syntax-checked; accepted untested with this reasoning.
- An ambiguous colleagues pair disables the heal with no surface saying
  so (tested as the refusal it is): refuse-don't-guess on a non-verdict
  surface; the agent keeps its stale command until a human resolves the
  duplicate markers.
- The BIN_DIR unsafe-character case matches the existing KOSMOS_HOME
  guard's class (no carriage return); a CR-bearing bin dir writes a
  broken PATH entry, not code. Consistency with the sibling guard kept.
- The sandbox profile gate keys on app-dir overrides only, matching the
  established lsregister keying; a hypothetical harness overriding only
  HOME/BIN_DIR could still reach a real profile. Consistency kept over
  broadening.

## Out of scope

- The update-control chunk (Mona Lisa's spec: four states, Check now,
  15-minute TTL, honest finish line, toast label rule).
- The full-app em-dash copy sweep beyond the verdict family (hers to
  spec).
