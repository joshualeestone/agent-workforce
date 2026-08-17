# create-agent-pane2: the details form, the mark, the third radio

Continues task #13 on top of merged pane 1 (PR #44). Build source: the
frozen pack (74b88a9f at build time; superseded by the 2026-08-16 re-cut
0856e5b, which changed no create-flow surface) and the role catalogue
(Josh-Brain/Projects/kosmos-role-catalogue.md @ 0ef34cc: the `own` entry
and its two rules). Built 2026-08-16 during the day, reviewed and
hardened the same evening on the post-reset pool.

## Scope

- Pane 2, "Set up your agent": generated mark (ported dotGlyph/MARK_FAMS
  from the pack, whole-name FNV seed, string-color-vs-palette contract
  preserved), Change picture (held client-side, uploaded post-visibility),
  Role label + Instructions editors with dirty-hold semantics (untouched
  fields send nothing; the server-side template is the single copy),
  project multi-pick (absent when no projects), model select.
- The third picker radio: `own` (catalogue: menu false, no default label,
  label gated by the engine with its own sentence, identity opener kept
  parseable by status.readIdentity).
- MODELS in the engine (fable/opus/sonnet default/haiku, full model ids
  as args) wired through an optional SIXTH supervisor argument;
  five-argument plists untouched (append-only contract, tested by exact
  string-count delta).
- Create route: projects validated BEFORE create; membership attached
  after CREATED, non-gating, with per-project outcomes in the response.

## Decisions recorded during review (the ledger is in the proof file)

- The attach keys on `result.name`, the slug the engine publishes; the
  route-level test drives the wire and re-reads persisted membership.
- The avatar upload is STAGED and lands from the watch's success arm
  (the PUT needs a running, known agent; at create time launchd has not
  started it). Same for the project tell: the create route stores told
  as not_tried honestly, and the success arm re-fires the sync through
  the idempotent member route once the roster can see the agent.
- Same-role Back/Next preserves everything the person set; a different
  role resets on purpose. The dirty editor's identity opener (and ONLY
  that token, only while un-edited) follows a corrected name so the
  board never inherits a typo silently.
- Instructions at create enforce the instructions module's own MIN_CHARS
  and MAX_BYTES so create cannot mint a boot file the app itself would
  refuse to read back.
- The mark uploaded is rendered from the SAME seed as the preview (the
  typed name), never the slug.
- Made-screen project lines render membership outcomes; told verdicts
  travel in the response but are deliberately not rendered yet (at that
  moment the honest verdict is usually not_tried; rendering it as a
  failure beside a green watch would mislead). Flagged for Mona Lisa.

## Deferred with reasoning

- Debouncing dotGlyph on name keystrokes: the pack measured the full
  render at 6.5ms, inside one frame; a debounce would trade measured
  headroom for latency on the flagship interaction.

- A note when a blanked label falls back to the role default: the
  fallback is the documented dirty-hold contract, and a second note
  element is new UI copy that routes through Mona Lisa.
- A visible message when a staged picture never lands (watch timeout or
  navigation away): same routing; the detail panel's uploader is the
  existing recovery path.

## Verification

node --test green at every step; sandboxed browser drive-through
(scratchpad ca-fix-drive.js) measuring: same-role round-trip preserves
edited instructions + model + project pick, role change resets, the
picture button is keyboard-focusable, LAST_MARK_SEED records the typed
name, zero page errors. Screenshots in docs/browser-checks/shots/.
