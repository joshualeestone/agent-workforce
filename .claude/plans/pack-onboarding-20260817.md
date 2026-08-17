# pack-onboarding: first-run rebuilt to the pack (task #39)

Josh, on his fresh 0.1.3 install: "Everything about it is not what we
designed in the pack at all... We need to sync up the entire setup
process to be exactly like what Mona Lisa and I designed on the pack
side." The finding is correct: the wizard that shipped is the
0.1.0-era skeleton with new features grafted in; the pack's Saturday
redesign of first-run (FROZEN-2026-08-16, sha 4091b009) was never
built.

## The pack's flow, which is the target structure

1. Success (intro, no progress segments): gold K mark, SUCCESS
   eyebrow, "Kosmos is now installed on this computer.", the
   Applications-folder check row, Show me where it is, the drag-to-
   Dock line, gold "Set up Kosmos" primary. The app's current LAST
   step (getting back / app-location machinery) moves HERE.
2. Welcome: three short lines under a Welcome eyebrow.
3. Model: the llm provider list (Claude live with Connect, the
   coming-soon rows), wired to the EXISTING connect flow and
   subscription verdict.
4. This computer: the existing machine checks in the pack's chk rows,
   with the sleep button.
5. About you: the existing gated step in the pack's field styling.
6. Your agents: the three ENDINGS (adopt / create / could-not-count).

## Division of authority (settled in channel, 10:25 AM)

- STRUCTURE and LOOK: the pack, confirmed by Josh. Built now.
- COPY: Mona Lisa's per-screen build spec (pack says / app does /
  final ruled copy), because the pack is a frozen Saturday record and
  some of its sentences predate the About-you privacy ruling; shipping
  the pack's Welcome verbatim would reintroduce the exact claim killed
  at 9 AM. Every screen's sentences live in one COPY table in the
  wizard code, spliced from her document when it lands, so copy
  arrives as data rather than as surgery.

## What survives untouched underneath

The connect flow's server-side machinery and resume, the machine
check rows' live route, the About-you gate + FR_YOU_GEN generation
guard + save-before-advance, the fleet endings logic, the completion
flag semantics, deep links (?first-run=1&fr-step=N), the focus trap,
and every honesty rule. The return-step generation machinery
(FR_RETURN_GEN) moves with its content to step 1.

## Spec corrections folded in mid-build (the pack outranks inventions)

Mona Lisa's ed29b78: the pack DOES define all three endings (her spec's
"no zero state" was a partial-search zero); the endings ship verbatim:
adopt ("You already have N agents here." with the real count declining
at one, single Take-me-to-my-agents action), create ("Create your first
agent." / "There are none on this computer yet." / "Two questions: what
it is for, and what to call it.", single Create-my-first-agent action),
and unknown (the only two-action screen in the flow, "Show me my
agents" / "Create an agent", because either single guess would lie).
Her e9d3d5a lists every remaining spec-vs-pack delta as questions for
Josh; none block this branch. Josh's standing rule, recorded: the pack
is the source for design AND functionality; gaps surface to him, never
get invented; and screens post for his verdict BEFORE packaging (the
conformance pairs in channel are that checkpoint).

Known deviations of record, flagged in channel with the pairs: the two
ruled honest-sending sentences (screens 2 and 5); the real count and
names list on screen 6; the engine's three states on screen 4; the
darker glyph ink on the check marks (AA floor, the
pack's gold-deep on its own tint is 2.78). Back and Skip were shipped
as a trap-escape deviation in the first pass and then REMOVED at Josh's
word (2026-08-17, every step) and the pack's own decisions table; the
surviving exit is Escape, which marks first run seen.

## Verification

Suite + both first-run drives updated to the new order and re-run
against a live sandboxed server; render shots retaken (the SHOTS list
renames to the new step numbers); server.test.js pins re-anchored.
Screenshots posted to channel as pack-versus-built pairs per screen.
