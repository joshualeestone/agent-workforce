# update-toast: the toast, the confirm, and a real update pipeline

Task #26, built 2026-08-16 evening from the CURRENT-FREEZE pack
(kosmos-app-style.FROZEN-2026-08-16.html, sha256 4091b009..., read via the
CURRENT-FREEZE pointer per its own rule). Also carries the product-name
correction and two create-flow feedback sentences ruled by Mona Lisa in
channel tonight.

## Scope

1. THE NAME. Every visible "Agent Workforce" becomes Kosmos: tab title,
   header h1, first-run bar + welcome, one body sentence, three server
   console lines. Identifiers untouched by the four-way test: the repo
   name, AGENT_WORKFORCE_* env vars, launchd labels, and the install
   scripts' health-check matchers (which already accept both strings).
   The pack's first recorded decision, made urgent by the domain switch:
   a person installing from installkosmos.com must not open an app with a
   different name.

2. THE TOAST (pack-drawn). Ported CSS/markup: red #b3261e per Josh's
   twice-made call, gold Install, absolute inside the sticky header so
   appearing moves nothing. Position measured against THIS header rather
   than copied from the pack (its -29px was pack geometry): top 79px
   right 24px floats over the tabs strip's empty right side, clearing
   the checked stamp by 2px; the drive-through asserts non-overlap by
   bounding box, and that assertion caught the first guess. Shown only
   when the status payload carries a published newer version; Later
   remembers PER VERSION in localStorage (quiet until the next release,
   never forever).

3. THE CONFIRM (pack-drawn, Josh's gate, Mona Lisa's copy verbatim):
   "Update Kosmos? / Kosmos closes for a few seconds while it updates.
   Your agents keep working the whole time. / [Not now] [Update]". Built
   on the rm-modal idiom. NOT a warning; the engine fact behind it was
   measured 2026-08-16 (only the board server restarts; agent launchd
   jobs and tmux sessions are separate process trees).

4. THE PIPELINE. engine/update.js: latest.json on the release host is
   the published truth ({"version":"0.1.1"}, written by the same publish
   step that uploads the bundle); six-hour cache, never on the request
   path (poke()/available()), fail-soft in every direction, and unknown
   LOSES the version comparison so a corrupted manifest cannot pop a
   toast. POST /api/update: 409 when nothing is newer, 409 with the git
   sentence for from-source runs, else spawns the SAME hardened
   installer every install runs (staged, checksummed, atomic swap,
   board restart), detached, and answers 200 before dying on purpose.
   The route inherits the cross-site guard, asserted by test rather than
   assumed. Client during-state: full overlay "Updating. Your agents
   keep working.", poll for down-then-up, reload; at the 3-minute
   deadline reload anyway and let the fresh page's toast say what is
   true rather than the overlay guessing.

5. THE TWO SENTENCES (Mona Lisa in channel, verbatim): a blanked Role
   label gates with "Say what this agent does. One or two words." and
   focus moves to the field; a failed FILE avatar upload falls back to
   uploading the generated mark and says "That picture did not load.
   The mark drawn from the name is still there." ONLY once the mark
   actually landed (the sentence was false as previously built; the
   behaviour changed rather than the sentence weakening). If even the
   mark fails: silence, per the three-states rule.

6. Version 0.1.1. The bundle republish + latest.json land on
   installkosmos.com/dist at ship time (site side), which also picks up
   pane 2 from #46.

## Verification

- node --test 783/783 (new: engine/update.test.js incl. unknown-loses
  and soft-failure sweeps; wire tests for the status verdict, guard
  inheritance, from-source refusal, happy-path runner + setup URL,
  no-op refusal).
- Toast drive-through (sandboxed server + local release host): render,
  bounding-box clearance, frozen copy verbatim, from-source 409
  surfaced inside the modal, Later per-version persistence across
  ticks, zero page errors. Screenshots committed.

## Review round 2 additions (all fixed in-branch)

- The toast's Install had silently lost its gold to the scoped neutral
  button rule (specificity), visible in the branch's own screenshot; the
  gold rule now carries a toast-scoped selector and the drive-through
  asserts the computed colour.
- BOTH dialogs' focus traps intercepted at the first tab stop (which
  natural tabbing never exits by) and leaked one keystroke onto the live
  board behind the backdrop from the last; both now intercept at the last
  stop in the traversal direction, rm-modal's arriving-lands-on-Keep rule
  preserved, and the drive-through presses real Tab/Shift+Tab at both
  boundaries. The pinned regex test moved to the new mechanism and gained
  a wrong-end pin.
- Mobile (<=720px) is IN-FLOW below the tabs, deliberately breaking the
  desktop float rule: at 375 both float positions measured onto controls
  (New agent first, then three of four tabs). A header that grows beats
  unclickable tabs.
- The detached installer child now has an 'error' listener: a spawn
  failure logged and the single-flight flag released, instead of an
  uncaught exception crashing the board with no installer running.
- Dark mode lightens --utone to #F0665A (the app's established dark red;
  #b3261e measured ~2.1:1 on the dark ground).
- The updating overlay inerts everything behind it, same rule as
  first-run; every exit from that state is a reload.
- Deferred: the toast's role="status" with buttons inside it is the
  pack's own specified role; flagged for Mona Lisa rather than changed.

## Review round 3 additions (closing round, zero blockers)

- An exit listener releases the single-flight flag when the installer
  pipeline fails AFTER a clean spawn (host 404, dropped download,
  checksum refusal); a successful install kills the server before the
  listener matters, so a good update cannot double-run.
- The stale 'Welcome to Agent Workforce' assertion in the committed
  click-first-run.js check repointed (the one consumer the name sweep
  missed).
- The toast drive-through is committed as
  docs/browser-checks/render-update-toast.js (portable path, header),
  so the verification is re-runnable rather than a timestamp; a round-3
  reviewer independently re-implemented its assertions and passed 26/26
  before this was committed.
- The confirm opens with focus on Not now, the safe answer, same rule
  as every dialog here: Josh's deliberate-click gate must not be one
  Enter wide. Recorded as the decision.
- setupUrl's /dist-suffix assumption documented for nonstandard staging
  bases.
