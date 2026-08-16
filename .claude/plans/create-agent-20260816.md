# create-agent: the 26-role catalogue and the pack's picker

Built 2026-08-16 on Josh's start-today directive, from the frozen pack
(sha 74b88a9fb37dfd7e) and the role catalogue spec
(Josh-Brain/Projects/kosmos-role-catalogue.md at a1ef071: Mona Lisa
writes, this branch builds, Josh decides).

## Slice 1: engine/roles.js, 6 roles -> 26

- Catalogue entered verbatim; the six existing keys preserved (pm ea
  writer researcher finance legal) so recorded agent roles stay valid.
  Labels Title Case (Josh, in-channel). Group field added per catalogue
  section; /api/roles serves it.
- Eight cautions in the refusal-then-value shape; legal's and finance's
  existing sentences untouched (Josh's 2026-08-10 shipping condition).
  Spec gaps routed through Mona Lisa before build, not improvised: five
  a/an articles + SEO casing (her fix, applied from her updated doc),
  the chip-to-caution question (she wrote six sentences), label casing
  (Josh: Title Case).
- Tests: books joins the both-places caution check; the no-caution list
  updated (ea gained one); new guard that under half the catalogue may
  carry a caution.

## Slice 2: pane 1, the two-radio picker

- Per the pack: recommended radio (pm, by NAME) + "Pick another role"
  opening a grouped native select of the other 25, description under the
  menu, the FULL caution sentence rendered at the moment of choice.
- DEFERRED to the details-step slice: the pack's third radio ("Describe
  it yourself") -- it needs that screen's Role label field to create
  truthfully-labelled agents; a radio that ships before its label field
  creates agents labelled wrong.
- Derived copy: the menu-count sentence computes from the fetched list
  (digits, not the pack's "Twenty-five" word form) so catalogue growth
  cannot make it lie. Flagged for Mona Lisa's veto in the PR.
- Recommended pill only when the board is empty (pack's rule; LAST is
  the board's own cache).
- The positional default pin in server.test.js re-pinned to the by-name
  mechanism its own title asked for.

## Verification (build + one pass, per the day's shape)

- node --test: 768/768 on the branch tip.
- Browser drive-through against a sandboxed server: both radios, 7
  optgroups / 25 options, legal shows its full caution at choice time,
  Continue lands on "Name your contract reviewer", zero page errors.
  Screenshots committed under docs/browser-checks/shots/.

## Not in this branch (next slices, tasks pinned)

- Pane 2 (Set up your agent): avatar mark generator, Role label,
  instructions editor, project multi-pick, model select + the "own"
  radio. The About-you step (task #14), consent checkbox (task #12).

## Review round 1 (blind, 2026-08-16 morning) and its fixes

One round per Josh's stop-at-no-blockers rule. 1 BLOCKER + 7 WARNINGS +
1 CONVENTION + 1 NIT, all fixed except one pre-existing item recorded:

- BLOCKER FIXED (SC 1.4.10): the pack-copied nowrap name column gave the
  picker rows no wrap path (375px drew the blurb outside the row; 320px
  scrolled the document 54px). Fix: no nowrap, min-width:0 on the
  description column, stacked description under 560px. Re-measured
  320-600px: row overflow 0 everywhere. The 9px document overflow left at
  320 is the app's OWN .tab bar, present on unmodified main (measured by
  stash-compare), out of this branch's scope.
- Recommended pill kept TRUE, not computed once: BOARD_SEEN flag ("not
  heard yet" is not "empty"), updateRecPill re-runs on every panel open
  and every status tick. Measured: deep link with a 14-agent board now
  shows no pill.
- Test teeth restored: the by-name default pin anchors the ASSIGNMENT and
  the default MODE (the loose substring stayed green under both mutations
  the reviewer ran); the both-places caution rule now DERIVES over every
  cautioned role with a per-role boundary map, fails loud on an
  unregistered caution, and carries a positive control (stripping the
  matched boundary must un-match).
- Catalogue defect found by the widened rule and routed to Mona Lisa:
  support's caution promised "never replies" with no instruction boundary.
  Her doc fix (297fc04) applied verbatim: "Draft, never send. The customer
  hears from them, not from you," with the craft bullet folded rather
  than dropped.
- The recommended row gained a caution slot (a re-keyed pm falling back to
  a cautioned role now renders its limit instead of hiding it).
- radiogroup owns only radios (the menu is a sibling); roledesc is a
  polite live region; the acronym-safe headline ("Name your SEO
  specialist"); caution CSS unified on the file's established rule with
  the comment moved to the live selector; dead .pick .caution removed.
- Verified after fixes: full suite 768/768; measured drive-through of
  every fix (reflow sweep, radiogroup children, pill truth after tick,
  headline, aria-live), zero page errors.
