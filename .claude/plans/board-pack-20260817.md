# board-pack -- the Agents board built to the pack (view 1 of 13)

First of the thirteen views, per the settled order: build to the pack,
post a pack-vs-build pair, Mona Lisa verdicts copy, Josh rules, she
reconciles rulings into the pack. Delta source: a 59-item measured
survey (pack FROZEN-2026-08-17 vs the app), plus Mona Lisa's
kosmos-pack-conformance.md (the three string kinds; demo data never
ships; annotations never ship).

## What this branch builds (the pack's drawing)

- The pack's board TOKENS into the app (--k-bg/-surface/-ink/-ink-2/
  -rule + the three golds), applied to the board surfaces; the app's
  legacy tokens remain for views not yet rebuilt.
- Header restructure: three-column sticky grid (left group | centered
  .apptabs | right group), the burger collapse under 56rem, gold
  selected tab (underline) and gold .vt.on segments (the pack's rule:
  ink flips, gold does not).
- Stats row: .stat.action New agent dashed tile (moves out of the
  header), Agents/Working/Idle .stats tiles, .stat.alert Needs you
  with the .haz triangle.
- Agent cards rebuilt to the pack column: .aname, .astate pill with
  per-state borders and GLYPHs (act/haz/rest/pause/stop/qmark with the
  vh could-not-check prefix), .atask, .acut rule, .ameta role line,
  .amodel line, .pres presence dot with PRESSAY (third axis, absent
  today), .membadge >=80% chip, .acard.attn/.unk/.off/.hot modifiers,
  Answer -> inside the attn pill.
- The real list rows: .lrow grid with .lav, .lname, .lstate, .ltask,
  .lmem bar + .pct, narrow-screen collapse.
- Removed list: the pack's .member rows + the ruled hint sentence
  ("Nothing was deleted...") + .removedwrap rule and spacing.
- Copy conformance: "Agent status / Refreshed just now" stamp shape
  (keeping the app's honest failed variant), Answer ->, the vh
  could-not-check prefix, Show removed agents label pinned per pack
  (label does not flip; the expanded state is carried by aria).

## Decisions of record (deltas NOT built, each surfaced in the pair)

1. FOUR tabs stay (My Projects, Joint Projects) though the pack draws
   three: the app genuinely has a joint-projects surface. RULING
   NEEDED from Josh/Mona Lisa on folding; not invented here.
2. The THEME SWITCH is deliberately not built: it arrives with #40
   when dark exists across the app, because a switch that dark-modes
   one view is a lie in chrome. The header leaves its slot.
3. Honest-state app extras SURVIVE with no pack home: the #summary
   residual clause (unreadable lines = agents may be missing), #build
   beta stamp, #conn banner, .flag machine-name chip, .card-stale,
   .removed-msg alert. Each flagged in the pair for Mona Lisa to give
   a pack home or rule them exceptions.
4. The card .why line and notes: the pack retired explanation from the
   card ("the card carries signals, the panel carries explanation").
   The why-line goes; the unknown-note's honest content moves into the
   pill's title/vh and the detail panel keeps the explanation. The
   fullness/unknown notes go with the same rule. If review shows an
   honesty regression, they return and the pair flags it.
5. Demo data never ships: counts, names, memory bars all render from
   live status exactly as today.

## Verification

Suite + a board render drive extended to pin the pack pieces (pill
classes per state, glyphs, presence dot, membadge threshold, lrow
columns, gold selections, removed hint), plus the existing drives
re-anchored where markup moved. Pair shot posted in channel.

## Stages 3-6, built 2026-08-17 evening (Josh's pair verdict: pass)

- card() renders the pack .acard column; lrow() the pack list; BOTH read one
  set of derivations (cardStOf/taskLine/modelLine/roleLine/answerBtn) so the
  views cannot disagree. CARD_ST maps app states to pack st/pres; the card
  treatment follows the PACK, not STATE_COPY.attn (red = needs_you only;
  paused/stopped/unknown get their own quieter shapes).
- hot = percent>=80 && not attn (the pack renders 88%-attn without hot);
  membadge at >=80 regardless; presence three-state (unsure != off).
- The layout toggle flips hidden between #grid/#alist; BOARD_LAYOUT +
  boardApplyVisibility(onAgents) + onAgentsTab() decouple the tab signal
  from grid.hidden (three proxies re-anchored; failure path paints both
  containers).
- Gold selected on the view toggle (Josh's ruling; ink flips in dark).
- Removed section restyled to the pack (constant Show label, name-over-meta
  rows, hairlines between, the nothing-was-deleted hint inside the list).
- Machine-name chip OFF the card (pack records Josh's audience ruling; the
  fact moved to the detail meta: "shown by its machine name"). Stale badge
  and unknown note SURVIVE on the card by recorded reasons.
- Checks re-anchored: render-projects.js aslist -> hidden-flip;
  render-thread.js .card/.card-answer -> .acard/.ansgo; server.test.js
  summary control follows the residual-only design (positive controls kept:
  partial shows+says, clean is empty AND hides); paintRemoved pin ->
  onAgentsTab(). 815/815 green.
- Old card family CSS removed with dated records (not left as green noise).

## Rider of record (round 1 CONVENTION, kept deliberately)

- engine/roles.js PM caution + create.test.js BOUNDARY entry rode this
  branch from its first WIP commit (they were in flight when the board work
  paused and resumed around them). Unbraiding a merged-in ruled copy change
  costs more than recording it: the caution is Mona Lisa's ruled text, the
  test follows the suite's both-places rule, and this line is the plan's
  record that the rider was chosen, not smuggled.

## Round 2 pack-ruling flag (surfaced, not fixed here)

- The selected tab's gold underline measures ~2.1:1 on --k-bg, under the
  3:1 non-text floor the drives enforce elsewhere; the co-carrier ink
  shift is subtle. It is PACK-VERBATIM (.apptab.on), so it is Mona Lisa's
  ruling to make in the pack, not this branch's deviation to invent a fix
  for; flagged to her in-channel with the board pair follow-ups.

## Round 3 record

- The re-anchored 8d reload assertion false-failed a correct build (the
  drive reloads onto ?tab=projects, where BOTH agent containers hide, so
  container visibility cannot witness the agents choice). Fixed: persistence
  read from the store + the toggle's pressed state, visibility asserted
  after clicking back to agents; probe-verified on the sandbox.
- The plan's promised renderer pins now exist: server.test.js drives the
  extracted card()/lrow() with REAL fleet.install cards (fixture-discipline
  honored; the axes fleet cannot arrange are spread onto real cards), plus
  source pins for the gold selected state and the removed-list reassurance.
  The escaping control was re-aimed once (its first cut asserted the
  absence of inert escaped text and failed a correct renderer).
- Stale comments folded (removed-wrap grid tricks, ring's caption block);
  the dead summary-slice guard became a real assertion.
- ENVIRONMENTAL, control-proven on main: the projects drive's 6a
  (#pj-one-remove not visible after opening quarterclose) reproduces
  byte-identically on MAIN's page against this sandbox, so it is sandbox
  data drift from tonight's repeated drive runs, not this branch. The 8d
  logic this branch changed is probe-verified instead.
- Surfaced for the pack (Mona Lisa), not fixed here: burger DOM order
  (menu precedes trigger, pack-verbatim), the unknown note's dark island,
  the gold tab underline contrast.

## Round 4 record

- The 8d cleanup ordering broke by my own round-3 insertion (reset clicked
  the hidden projects toggle from the agents tab); reordered to follow
  visibility and noted in the drive. The lesson the round named: the
  assertions were probed, the cleanup path after them was not.
- focusBoardHome grew the visible middle rung: agents tab when rendered,
  else the burger (visible exactly where the tabs are not), else the vh h1.
- Deferred to the next drive touch (recorded NIT): render-update-toast's
  no-re-spacing pin still measures #new-agent, which left the header with
  the statsrow; that half is vacuous and #checked is the real witness.

## Round 5 record

- The dark hold-the-line block was CASCADE-DEAD for the removed section and
  the shared .linkish (declared earlier than the pack rules it overrode at
  equal specificity), which also regressed the projects tab in dark. Fixed
  by POSITION: the block now sits after every rule it overrides, with the
  defeat recorded in its comment as the guard against re-tidying; hover's
  higher specificity got its own dark ground; measured back to
  theme-following values on the live sandbox.
- The one-stage-width cap (1320px) restored to .cards/.alist/.removed-wrap;
  measured exact left/right alignment with the statsrow at 1920.

## Round 6 record

- The shared .removed-row restyle had a second consumer: paintArchived on
  My Projects still emitted the old flat markup, floating the date mid-row
  under space-between. Both surfaces now emit one inner-div grammar,
  updated together (the same shared-class hazard round 5 caught on
  .linkish, this one in layout).
- The .linkish 24px SC 2.5.8 floor is now duplicated into the pack rule
  with the coupling named, so tidying the earlier rule cannot silently
  drop the target floor.
- The pack's burger open-state X ported onto the app's aria-expanded
  carrier (was an unrecorded fidelity delta).

## Round 7 record (post-restart; the confirmation round in flight at the
## account move was lost and respawned blind)

- The burger's choose path (the common one) display:none'd the menu with
  focus inside it, dropping the keyboard to <body>; it now carries the
  Escape path's guard (back to the burger), gated on the menu being open
  so wide-screen clicks keep natural focus.
- The menu precedes its trigger in the DOM (pack order, ruling stays
  surfaced to the pack): opening now focuses the first tab, giving the
  keyboard its forward path without touching the pack's DOM.
- A failed poll blanked nothing: the four stat tiles kept last-success
  counts beside "we cannot see them". They now blank to "?" and the alert
  tile hides (red reserved for known alarms).
- All three behaviors driven by new slice-and-drive tests, each
  mutation-proven (fix reverted, its test failed, restored).

## Round 8 record

- The failed-poll honesty rule stopped short of #summary: last-tick
  residual claims sat beside the blanked tiles. The catch now clears and
  hides it, seeded-then-blanked in the test.
- The SVG clip id slugs the session name (id attribute + url() reference:
  esc() decodes in one context and not the other, so a slug is correct in
  both; collisions harmless, every clipPath is the same circle). Driven
  through the real producer with a seeded collision avatar after the
  fixture lint rightly rejected a hand-built card.
- Two dead tokens (--k-track/--k-knob) out; their comment claimed the
  wizard pinned them and it had not.
- Deferred on recorded rulings: gold-underline contrast (pack-verbatim,
  with Mona Lisa), roles.js rider (rider of record), Escape-over-modal
  edge (marginal reachability).

## Round 9 record

- THE CATCH OF THE LOOP: decision #4 promised the because sentence to the
  detail panel when the why-line left the cards, and it had landed
  nowhere. The panel now carries it (d-why, empty hides), slice-driven
  both sides. Second instance of the removal pattern (machine-name chip
  was the first): a removal is two changes and only one is visible where
  you made it.
- The pm intro contradicted its own ruled bullet ("brief the other
  agents" vs "you do not brief other agents yourself"); intro reconciled,
  ruled bullet and caution untouched.
- Four hand-written 80/60 thresholds became one memBand; the list bar's
  boundaries pinned at 79/80/59 so the views cannot drift one number
  apart.
- Dark dashed add-border made visible (light rgba ink was near-invisible
  on the dark elevated ground).

## Round 10 record

- Zero blockers/warnings. The machine-name disclosure (promise kept in
  code, unprotected in tests) got its both-sides pin at Mona Lisa's
  prompt: a quiet revert of the meta line would have passed the suite.
- modelLine's comment claimed the provider prefix helps "the day a second
  provider lands"; it does the opposite (would stamp Claude onto foreign
  names) and the comment now says so as a must-change marker.
- Refuted NIT, recorded: .boardbar class is NOT dead;
  docs/browser-checks/render-projects.js selects it.

## Round 11 record

- The Answer control (.ansgo) had lost the 24px SC 2.5.8 floor its
  predecessor .card-answer carried: it is the ONE card control whose
  function nothing else duplicates (the card body opens detail, not the
  thread), so the undersized-target exceptions do not apply. Floor
  restored (underline moved to an inner span) and pinned in source next
  to the gold pin.
- The detail meta line now reads modelLine (the shared derivation), so no
  surface can disagree on a model; the panel gains the honest "Unknown
  Model" over a silent omission.
- Hot-on-stopped recorded as a DECISION: a tied stopped pane still reads
  its own transcript, the figure is real (the memory the session would
  resume into), heat rides the figure, not the process.

## Round 12 record

- Defence-in-depth: context.percent lands in markup (membadge text, bar
  width style, ring aria-label) and was interpolated raw. One pctOf
  coercion (Number.isFinite, else the honest unknown) now feeds boardMods,
  card, lrow and ring; a spoofed string percent renders as unknown,
  pinned.
- The unknown note gates on the TREATMENT (m.st), not the state spelling,
  so an unrecognised future server state carries the whole honesty
  payload; pinned with a perturbed 'martian' state.
- Rounds 7-11 appended to this record (the plan is the decision record;
  they lived only in commits).
- Deferred with reasons: tiles' working/idle client-side second
  derivation (agrees today, both read the same array, filters pinned);
  d-why staleness while the panel sits open (consistent with the
  pre-existing d-state model, a panel-refresh rework is its own task);
  burger focusout-close (focusout/relatedTarget subtleties are not
  midnight work; outside-click already covers the pointer case).
