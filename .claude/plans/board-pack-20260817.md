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
