# dark-tokens: the pack's dark k-token set

Trigger: Mona Lisa's measurement (2026-08-18, in-channel): dark mode
flipped only the page ground; card interior, header band and stats tile
stayed literal light. Root cause: the app's dark block flips the legacy
tokens but never defined dark values for the k-tokens, so every surface
riding --k-surface/--k-ink held its light value in both schemes. The
deferral was recorded ("dark inverses with the theme pass, #40"); her
measurement pulls the surface flip forward. The manual data-theme toggle
remains #40's.

Decisions:

- The pack's own dark set (17c line 49) lands verbatim in the existing
  prefers-color-scheme block: k-bg #0c0d0f, k-surface #17191c, k-ink
  #f5f5f4, k-ink-2 #a9adb3, k-rule #2a2d31, track/knob. No data-theme
  arms: the app has no manual toggle yet.
- Compensations for the missing flip return to theme tokens: the two
  #7a5200 warn literals (pj-warn border, card-stale) go back to
  --warn-ink, correct on each surface now that the surface flips.
- The pack's attn red #b3261e measures 2.69:1 on the dark card: a pack
  defect, recorded here with the arithmetic. Dark override uses the
  pack's own dark-red family (its dark .pending is rgba(255,140,130,*)):
  #ff8c82 text (8.0:1), rgba(255,140,130,.55) border.
- First-run holds its recorded single-look ruling by re-pinning the
  light k-values on the #firstrun subtree; without that the flip turned
  the wizard light-on-white (measured 1.09:1). First-run drive green in
  both schemes after.
- The "fixed ink" convention across the app rides the k-tokens
  themselves, so surfaces and inks flip together with no per-rule work;
  the stale hold-the-line comments were left where they still describe
  position-dependent cascade facts and corrected where they claimed the
  tokens do not flip.

Instrument: render-projects gains 7b-theme-flip: ground, card, band and
tile computed backgrounds must CHANGE between schemes, with transparent
reads refused. This is the property a contrast sweep structurally cannot
see (dark ink on literal white passes AA in both themes), which is how
six passes missed the defect. Proven to fail: re-pinning --k-surface to
white reds the check on the exact reintroduced defect.

Coverage note, honest gap: the sibling drives (tasks, thread, connect,
special-purpose, sleep-button, update-toast) render no dark contexts at
all, so their surfaces are eyeball-verified only (board and agent page
shot dark and reviewed). Adding dark contexts to those drives is
follow-up work, not claimed here.
