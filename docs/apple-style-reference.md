# Apple macOS Design Reference for HTML/CSS Apps

A concrete, implementable reference for styling a local web UI (later wrapped in Electron or Tauri) so it feels native on macOS.

Compiled 2026-08-06. Measurements taken on macOS **26.5.2** (build 25F84, Apple silicon).

---

## 0. How to read this document

Every number carries a provenance tag. Do not strip these when copying values around.

| Tag | Meaning |
|---|---|
| **[HIG]** | Published verbatim by Apple in the Human Interface Guidelines. Source URL given. |
| **[SAMPLED]** | Apple publishes this value only as a swatch *image*, not as text. I downloaded the published PNG from Apple's docs CDN and sampled its pixels. Accurate to the asset, but Apple never wrote the number down. |
| **[MEASURED]** | Not published by Apple in any form. Read directly off AppKit on this machine via a Swift probe. True for macOS 26.5.2; may shift between OS releases. |
| **[CONVENTION]** | My inference or a widely used community convention. **Apple has not published this.** Treat as a reasonable default, not as fact. |
| **[UNVERIFIED]** | I could not establish this. Stated as a gap, deliberately. |

### Apple's own standing caveat

Apple explicitly warns against baking these numbers in:

> "Avoid hard-coding system color values in your app. Documented color values are for your reference during the app design process. The actual color values may fluctuate from release to release, based on a variety of environmental variables."
> ([HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color))

In a native app you would call the semantic APIs and never see a hex value. **In HTML/CSS you have no access to those APIs**, so hard-coding is unavoidable. Accept that, and isolate every value behind a custom property (Section 7) so a future OS shift is a one-file edit rather than a sweep.

### Points and CSS pixels

macOS measures in **points**. At standard scaling 1pt maps to 1 CSS px, and both double on Retina. So a 13pt system font is `font-size: 13px`, and all point values below can be read directly as px. This is why the type scale looks small compared to web defaults: macOS body text is 13px, not 16px.

---

## 1. Typography

### 1.1 The CSS font stack

macOS's system font is **SF Pro**. [HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography)

> "SF Pro is the system font in macOS. NY is available for Mac apps built with Mac Catalyst. macOS doesn't support Dynamic Type."

You reach it from CSS through a **keyword**, never by naming the font file. The keyword differs by engine, which matters because Electron and Tauri use different ones:

- `-apple-system` is WebKit's keyword. Tauri on macOS uses WKWebView, so this is the one that fires there. Introduced in [WebKit: Using the System Font in Web Content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/).
- `BlinkMacSystemFont` is Chromium's equivalent. **Electron is Chromium, so this is the one that matters for Electron.**
- `system-ui` is the standardized CSS value, supported by both modern engines.

Include all three, in this order, so the same stylesheet is correct in both wrappers:

```css
--font-ui: -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif;
```

**[CONVENTION]** on ordering. Apple documents `-apple-system`; the ordering across all three keywords is community practice, not an Apple publication.

For monospace:

```css
--font-mono: ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace;
```

`ui-monospace` resolves to SF Mono in Safari/WebKit. `Menlo` is the reliable fallback because it ships with every macOS install as a normal user font. **Do not rely on `"SF Mono"` by name**: it ships with macOS but is not installed as a user-visible font in all versions, so name-matching it is unreliable. **[CONVENTION]**

Critically: naming these keywords asks the OS for whatever it has. **You are not shipping a font.** See Section 6.

### 1.2 macOS built-in text styles [HIG]

Verbatim from [HIG: Typography, "macOS built-in text styles"](https://developer.apple.com/design/human-interface-guidelines/typography#macOS-built-in-text-styles). This is the authoritative macOS type scale.

| Text style | Weight | Size (pt) | Line height (pt) | Emphasized weight |
|---|---|---|---|---|
| Large Title | Regular | 26 | 32 | Bold |
| Title 1 | Regular | 22 | 26 | Bold |
| Title 2 | Regular | 17 | 22 | Bold |
| Title 3 | Regular | 15 | 20 | Semibold |
| Headline | **Bold** | 13 | 16 | Heavy |
| Body | Regular | 13 | 16 | Semibold |
| Callout | Regular | 12 | 15 | Semibold |
| Subheadline | Regular | 11 | 14 | Semibold |
| Footnote | Regular | 10 | 13 | Semibold |
| Caption 1 | Regular | 10 | 13 | Medium |
| Caption 2 | **Medium** | 10 | 13 | Semibold |

Notes that trip people up:

- **Headline is not larger than Body.** Both are 13pt. Headline differs only by weight (Bold vs Regular). macOS separates hierarchy by weight at small sizes, not by size. This is the single biggest difference from typical web type scales.
- **Footnote and Caption 1 are identical** (10pt/13pt Regular). They differ only in emphasized weight.
- macOS has no Dynamic Type, so unlike iOS these sizes are fixed.

Named weight to CSS numeric mapping **[CONVENTION]**, matching standard CSS weight names: Regular = 400, Medium = 500, Semibold = 600, Bold = 700, Heavy = 800.

### 1.3 Tracking (letter-spacing) [HIG]

macOS varies tracking by point size. From [HIG: Typography, "macOS tracking values"](https://developer.apple.com/design/human-interface-guidelines/typography#macOS-tracking-values). Apple gives both 1/1000 em and points; the em column is scale-independent so use that in CSS.

Relevant rows for the text styles above:

| Size (pt) | Tracking (1/1000 em) | As CSS `letter-spacing` |
|---|---|---|
| 10 | +12 | `0.012em` |
| 11 | +6 | `0.006em` |
| 12 | 0 | `0` |
| 13 | -6 | `-0.006em` |
| 15 | -16 | `-0.016em` |
| 17 | -26 | `-0.026em` |
| 22 | -12 | `-0.012em` |
| 26 | +8 | `0.008em` |

Full table (6pt through 96pt) is on that page. Note the curve is non-monotonic: it tightens to a minimum around 17-20pt, then loosens again above 23pt.

Apple's note on why this matters for mockups: in a running app the system font adjusts tracking automatically at every point size, but a browser will not do this for you, so **you must set `letter-spacing` explicitly** to match native rendering.

### 1.4 Minimum sizes and when to use each style

[HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) publishes per-platform type sizes:

| Platform | Default size | Minimum size |
|---|---|---|
| **macOS** | **13 pt** | **10 pt** |
| iOS, iPadOS | 17 pt | 11 pt |

Do not go below 10px for any text in a macOS-styled UI.

Usage guidance, condensed from the HIG's general typography and hierarchy sections plus the style names themselves. The specific style-to-context assignments below are **[CONVENTION]**; Apple names the styles and describes hierarchy in prose but does not publish a per-style usage table for macOS.

| Style | Use for |
|---|---|
| Large Title (26) | A single prominent screen or onboarding heading. Rare in a dense app. |
| Title 1 (22) | Primary view heading, empty-state headline. |
| Title 2 (17) | Section heading, sheet or dialog title. |
| Title 3 (15) | Subsection heading, grouped-settings header. |
| Headline (13 Bold) | Row title, list item primary text, inline emphasis at body size. |
| Body (13) | Default UI text and controls. **This is the workhorse.** |
| Callout (12) | Slightly de-emphasized supporting text. |
| Subheadline (11) | Secondary row text, sidebar section labels. |
| Footnote (10) | Explanatory text under a control. |
| Caption 1 / 2 (10) | Timestamps, metadata, table column headers, badges. |

The HIG's own hierarchy advice is worth quoting because it directly contradicts a common web instinct:

> "Adjust font weight, size, and color as needed to emphasize important information and help people visualize hierarchy."
> "Minimize the number of typefaces you use, even in a highly customized interface."

### 1.5 Dynamic font variants [HIG]

macOS exposes font variants matched to specific control contexts. You cannot call these from CSS, but they tell you what native text looks like in each spot. All resolve to SF Pro at a context-appropriate size. From [HIG: Typography, macOS platform considerations](https://developer.apple.com/design/human-interface-guidelines/typography#macOS):

`controlContentFont`, `labelFont`, `menuFont`, `menuBarFont`, `messageFont`, `paletteFont`, `titleBarFont`, `toolTipsFont`, `userFont`, `userFixedPitchFont`, `boldSystemFont`, `systemFont`.

**[MEASURED]** on macOS 26.5.2, the underlying size constants are:

| Constant | Value |
|---|---|
| `NSFont.systemFontSize` | **13.0 pt** |
| `NSFont.smallSystemFontSize` | **11.0 pt** |
| `NSFont.labelFontSize` | **10.0 pt** |
| System font size at control size `large` | 13.0 pt |
| System font size at control size `regular` | 13.0 pt |
| System font size at control size `small` | 11.0 pt |
| System font size at control size `mini` | 9.0 pt |

---

## 2. Color

### 2.1 How Apple handles light/dark semantically

This is the part most web ports get wrong. Apple does not maintain "a light palette" and "a dark palette" that you switch between. Every color is a **single semantic token** whose resolved value depends on the current appearance. [HIG: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode):

> "Semantic colors (like labelColor and controlColor in macOS ...) automatically adapt to the current appearance. When you need a custom color, add a Color Set asset ... Avoid using hard-coded color values or colors that don't adapt."

And from [HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color):

> "Each dynamic color is semantically defined by its purpose, rather than its appearance or color values."
> "Avoid redefining the semantic meanings of dynamic system colors. ... don't use the separator color as a text color, or secondaryLabel color as a background color."

Two direct consequences for your CSS:

1. **Name tokens by role, never by appearance.** `--label-secondary`, not `--gray-500`. The whole system falls apart the moment a token name describes what it looks like.
2. **Dark is not an inversion.** The HIG is explicit: "while many colors are inverted, some are not." You will see this below: `secondaryLabelColor` is 49.8% alpha in light but 54.9% in dark, and `headerTextColor` jumps from 84.7% to 100%.

A third consequence, specific to the label colors: Apple implements them as **black or white at a fractional alpha**, not as solid greys. Reproduce them as `rgba()` with the real alpha rather than flattening to a hex. That way they composite correctly over whatever sits behind them, which is exactly what AppKit does, and it keeps working over a material or an image.

### 2.2 macOS semantic (dynamic) system colors [MEASURED]

Apple names these in [HIG: Color, macOS platform considerations](https://developer.apple.com/design/human-interface-guidelines/color#macOS) but **publishes no values for any of them**. The table below was read directly off AppKit on macOS 26.5.2 by resolving each `NSColor` in `.aqua` and `.darkAqua` appearances and converting to sRGB.

| Semantic color | Light | Dark | Purpose (Apple's wording) |
|---|---|---|---|
| `labelColor` | `rgba(0,0,0,0.847)` | `rgba(255,255,255,0.847)` | Text of a label containing primary content |
| `secondaryLabelColor` | `rgba(0,0,0,0.498)` | `rgba(255,255,255,0.549)` | Subheading or additional information |
| `tertiaryLabelColor` | `rgba(0,0,0,0.259)` | `rgba(255,255,255,0.247)` | Lesser importance than secondary |
| `quaternaryLabelColor` | `rgba(0,0,0,0.098)` | `rgba(255,255,255,0.098)` | Watermark text |
| `textColor` | `#000000` | `#FFFFFF` | Text in a document |
| `placeholderTextColor` | `rgba(0,0,0,0.498)` | `rgba(255,255,255,0.549)` | Placeholder in a control or text view |
| `selectedTextColor` | `#000000` | `#FFFFFF` | Selected text |
| `textBackgroundColor` | `#FFFFFF` | `#1E1E1E` | Background behind text |
| `selectedTextBackgroundColor` | `#B3D7FF` | `#3F638B` | Background of selected text |
| `linkColor` | `#0068DA` | `#419CFF` | A link to other content |
| `separatorColor` | `rgba(0,0,0,0.098)` | `rgba(255,255,255,0.098)` | Separator between sections |
| `gridColor` | `#E6E6E6` | `#1A1A1A` | Gridlines of a table |
| `headerTextColor` | `rgba(0,0,0,0.847)` | `#FFFFFF` | Text of a header cell in a table |
| `controlAccentColor` | `#007AFF` | `#007AFF` | **The accent color chosen in System Settings** |
| `controlColor` | `#FFFFFF` | `rgba(255,255,255,0.247)` | Surface of a control |
| `controlBackgroundColor` | `#FFFFFF` | `#1E1E1E` | Background of a large element (table, browser) |
| `controlTextColor` | `rgba(0,0,0,0.847)` | `rgba(255,255,255,0.847)` | Text of an available control |
| `disabledControlTextColor` | `rgba(0,0,0,0.247)` | `rgba(255,255,255,0.247)` | Text of an unavailable control |
| `selectedControlColor` | `#B3D7FF` | `#3F638B` | Surface of a selected control |
| `selectedControlTextColor` | `rgba(0,0,0,0.847)` | `rgba(255,255,255,0.847)` | Text of a selected control |
| `alternateSelectedControlTextColor` | `#FFFFFF` | `#FFFFFF` | Text on a selected surface in a list/table |
| `selectedContentBackgroundColor` | `#0064E1` | `#0059D1` | Selected content in a key window |
| `unemphasizedSelectedContentBackgroundColor` | `#DCDCDC` | `#464646` | Selected content in a non-key window |
| `unemphasizedSelectedTextBackgroundColor` | `#DCDCDC` | `#464646` | Selected text in a non-key window |
| `windowBackgroundColor` | `#FFFFFF` | `#1E1E1E` | Background of a window |
| `windowFrameTextColor` | `rgba(0,0,0,0.847)` | `rgba(255,255,255,0.847)` | Text in the title bar area |
| `underPageBackgroundColor` | `rgba(150,150,150,0.898)` | `#282828` | Background behind a document |
| `findHighlightColor` | `#FFFF00` | `#FFFF00` | A find indicator |
| `highlightColor` | `#FFFFFF` | `#B4B4B4` | The virtual light source onscreen |
| `shadowColor` | `#000000` | `#000000` | Virtual shadow cast by a raised object |
| `keyboardFocusIndicatorColor` | `rgba(0,103,244,0.498)` | `rgba(26,169,255,0.498)` | Focus ring |
| `selectedMenuItemTextColor` | `#FFFFFF` | `#FFFFFF` | Text of a selected menu item |

Two important reads on this table:

- **`controlAccentColor` is `#007AFF` here because that is this machine's setting.** It is user-configurable in System Settings > Appearance, and multicolor is the default. A real user's accent may be any of the system colors. Design so that swapping `--accent` does not break anything, and never assume blue.
- **`windowBackgroundColor` is `#FFFFFF` in light on macOS 26.** Older macOS used a grey around `#ECECEC`. If you are matching screenshots from an older OS, this is why they will not line up.

### 2.3 Standard system colors [SAMPLED]

The current HIG publishes these as **swatch images with no text values**. I pulled Apple's own published PNGs from `docs-assets.developer.apple.com` (referenced by [HIG: Color, Specifications](https://developer.apple.com/design/human-interface-guidelines/color#Specifications)) and sampled them. Every swatch was verified to be a uniform block of color before sampling.

These are Apple's **unified** colors, shared across platforms as of the 2025+ HIG. They differ from the older per-platform values you may have memorized (classic systemBlue was `#007AFF`, classic systemRed was `#FF3B30`).

| Name | Light | Dark | Increased contrast (light) | Increased contrast (dark) |
|---|---|---|---|---|
| Red | `#FF383C` | `#FF4245` | `#E9152D` | `#FF6165` |
| Orange | `#FF8D28` | `#FF9230` | `#C55300` | `#FFA056` |
| Yellow | `#FFCC00` | `#FFD600` | `#A16A00` | `#FEDF43` |
| Green | `#34C759` | `#30D158` | `#008932` | `#4AD968` |
| Mint | `#00C8B3` | `#00DAC3` | `#008575` | `#54DFCB` |
| Teal | `#00C3D0` | `#00D2E0` | `#008198` | `#3BDDEC` |
| Cyan | `#00C0E8` | `#3CD3FE` | `#007EAE` | `#6DD9FF` |
| Blue | `#0088FF` | `#0091FF` | `#1E6EF4` | `#5CB8FF` |
| Indigo | `#6155F5` | `#6D7CFF` | `#564ADE` | `#A7AAFF` |
| Purple | `#CB30E0` | `#DB34F2` | `#B02FC2` | `#EA8DFF` |
| Pink | `#FF2D55` | `#FF375F` | `#E7124D` | `#FF8AC4` |
| Brown | `#AC7F5E` | `#B78A66` | `#956D51` | `#DBA679` |

The **Increased contrast** columns correspond to the system's Increase Contrast accessibility setting, which you can detect in CSS with `@media (prefers-contrast: more)`. They are also your escape hatch for the AA failures documented in Section 2.4.

### 2.4 Contrast: where Apple's defaults fail WCAG AA

Apple's own stated bar, from [HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility):

| Text size | Text weight | Minimum contrast ratio |
|---|---|---|
| Up to 17 pts | All | 4.5:1 |
| 18 pts | All | 3:1 |
| All | Bold | 3:1 |

Note this is **looser than WCAG AA**, which sets the large-text threshold at 18pt regular or 14pt bold. Apple's "All / Bold / 3:1" row grants a 3:1 pass to bold text at *any* size, including 10pt. WCAG would not.

I computed the actual ratios for Apple's own defaults. **Several fail AA.** These are real and you should decide about them deliberately:

**Light appearance, on `windowBackgroundColor` `#FFFFFF`:**

| Token | Effective color | Ratio | Verdict |
|---|---|---|---|
| `labelColor` | `#272727` | 14.94:1 | Pass |
| `textColor` | `#000000` | 21.00:1 | Pass |
| `linkColor` | `#0068DA` | 5.26:1 | Pass |
| `secondaryLabelColor` | `#808080` | **3.95:1** | **Fails AA for body text** |
| `placeholderTextColor` | `#808080` | **3.95:1** | **Fails AA for body text** |
| `tertiaryLabelColor` | `#BDBDBD` | **1.88:1** | Fails. Decorative only. |
| `disabledControlTextColor` | `#C0C0C0` | **1.82:1** | Fails (disabled text is exempt under WCAG 1.4.3) |
| `quaternaryLabelColor` | `#E6E6E6` | 1.25:1 | Fails. Watermark only. |
| `separatorColor` | `#E6E6E6` | 1.25:1 | N/A (not text; fails 3:1 non-text contrast) |

**Dark appearance, on `windowBackgroundColor` `#1E1E1E`:**

| Token | Effective color | Ratio | Verdict |
|---|---|---|---|
| `labelColor` | `#DDDDDD` | 12.27:1 | Pass |
| `textColor` | `#FFFFFF` | 16.67:1 | Pass |
| `secondaryLabelColor` | `#9A9A9A` | 5.92:1 | Pass |
| `placeholderTextColor` | `#9A9A9A` | 5.92:1 | Pass |
| `linkColor` | `#419CFF` | 5.89:1 | Pass |
| `tertiaryLabelColor` | `#565656` | **2.27:1** | Fails |
| `disabledControlTextColor` | `#565656` | **2.27:1** | Fails (exempt) |
| `quaternaryLabelColor` | `#343434` | 1.34:1 | Fails. Watermark only. |

**The headline finding: secondary label passes in dark and fails in light.** 3.95:1 vs 5.92:1. If you use `--label-secondary` for anything a user must read, light mode is your problem case. Fix by darkening the light-mode alpha from Apple's 0.498. Computed options:

| Alpha | Effective | Ratio |
|---|---|---|
| 0.498 (Apple) | `#808080` | 3.95:1 (fails) |
| **0.55** | `#737373` | **4.74:1** (minimum to clear AA) |
| **0.60** | `#666666` | **5.74:1** (comfortable margin, used below) |

The CSS in Section 7 uses **0.60**, at a small cost in fidelity to the system. Use 0.55 if you want to stay as close to Apple as AA allows.

**Prominent buttons are the other AA problem:**

| Combination | Ratio | Verdict |
|---|---|---|
| White on system Blue light `#0088FF` | **3.52:1** | **Fails AA for normal text** |
| White on system Blue dark `#0091FF` | **3.23:1** | **Fails AA for normal text** |
| White on `controlAccentColor` `#007AFF` | **4.02:1** | **Fails AA for normal text** |
| White on `selectedContentBackgroundColor` `#0064E1` | 5.37:1 | Pass |
| White on increased-contrast Blue `#1E6EF4` | 4.57:1 | Pass |

A default macOS-blue primary button with white 13pt text is **3.5:1 and does not meet AA**. This is a genuine, longstanding tension between Apple's aesthetic and WCAG. Your options, in order of how much they cost:

1. Use `#0064E1` (Apple's own `selectedContentBackgroundColor`) instead of system blue for prominent button fills. 5.37:1, still unmistakably macOS blue. **This is the recommended default and what the CSS in Section 7 does.**
2. Ship `@media (prefers-contrast: more)` overrides using the increased-contrast column.
3. Accept 3.5:1 knowingly and document it.

**Destructive actions:**

| Combination | Ratio | Verdict |
|---|---|---|
| Red `#FF383C` as text on white | 3.57:1 | Fails AA for normal text |
| Increased-contrast red `#E9152D` on white | 4.56:1 | Pass |
| Red `#FF4245` as text on `#1E1E1E` | 4.86:1 | Pass |
| White on red `#FF383C` | 3.57:1 | Fails AA for normal text |

Same shape of problem. Use `#E9152D` for destructive **text** in light mode. Section 7 does this.

The HIG's own advice, which is the right instinct regardless:

> "Convey information with more than color alone."

---

## 3. Layout and spacing

### 3.1 What Apple actually publishes

**Apple does not publish a spacing scale, a margin system, or corner radii for macOS.** The macOS section of [HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) is two sentences of qualitative advice about not putting controls at the bottom of a window. Be suspicious of any "Apple 8pt grid" claim: it is not an Apple publication.

What Apple *does* publish for macOS, both from [HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility):

**Control sizes [HIG]:**

| Platform | Default control size | Minimum control size |
|---|---|---|
| **macOS** | **28x28 pt** | **20x20 pt** |
| iOS, iPadOS | 44x44 pt | 28x28 pt |

Note macOS hit targets are much smaller than iOS. 44px targets will look wrong and waste space in a Mac app. **20x20 is the floor; do not go below it.**

**Padding [HIG], verbatim:**

> "In general, it works well to add about 12 points of padding around elements that include a bezel. For elements without a bezel, about 24 points of padding works well around the element's visible edges."

Those two numbers, 12 and 24, are the only Apple-published spacing figures for macOS. The scale below is built from them.

### 3.2 Spacing scale [CONVENTION]

**Apple has not published this.** It is a 4pt-based scale anchored on the published 12pt and 24pt values, which both fall on it.

| Token | Value | Use |
|---|---|---|
| `--space-1` | 2px | Hairline gaps, icon-to-label nudges |
| `--space-2` | 4px | Tight internal padding |
| `--space-3` | 6px | Control internal vertical padding |
| `--space-4` | 8px | Label-to-control gap, list row padding |
| `--space-5` | 12px | **Padding around bezeled elements [HIG]**, gap between related controls |
| `--space-6` | 16px | Group spacing, card padding |
| `--space-7` | 20px | Window content margin |
| `--space-8` | 24px | **Padding around non-bezeled elements [HIG]**, section spacing |
| `--space-9` | 32px | Major section separation |
| `--space-10` | 40px | Large layout gutters |

### 3.3 Corner radii

**This is my weakest section and I want to be blunt about it.**

Apple publishes no corner radii for macOS. I attempted to measure them off real AppKit controls three ways: offscreen bitmap caching, `CALayer.render(in:)`, and a live on-screen screenshot. All three failed for buttons and segmented controls, because on macOS 26 those controls draw their bezel through a compositing path that offscreen rendering does not reproduce, and screen capture requires a Screen Recording permission this environment does not have. Offscreen capture returned only the glyphs, not the bezel.

What I **did** establish:

- **`NSSwitch` renders as a capsule. [MEASURED]** The 54x24pt switch has a track inset 2pt vertically (so a 20pt-tall track) with a fully rounded end, giving a **10pt radius**. This one is solid.

Everything below is **[CONVENTION]**. These are widely used values that look correct against macOS 26 screenshots, but **I did not verify them and Apple has not published them.** If exactness matters, measure them yourself on-device with Digital Color Meter or a screenshot at 5x.

| Element | Radius | Confidence |
|---|---|---|
| Push button (regular, 24pt tall) | 6px | [CONVENTION] |
| Push button (large, 28pt tall) | 7px | [CONVENTION] |
| Push button (small, 20pt tall) | 5px | [CONVENTION] |
| Text field | 6px | [CONVENTION] |
| Segmented control (outer) | 6px | [CONVENTION] |
| Popup button | 6px | [CONVENTION] |
| Switch / toggle | **10px (capsule)** | **[MEASURED]** |
| Card / grouped box | 8px | [CONVENTION] |
| Sheet / dialog | 12px | [CONVENTION] |
| Popover | 8px | [CONVENTION] |
| Window (macOS 26) | 12px | [CONVENTION] |

One real note on shape: Apple uses **continuous corners** (a squircle), not circular arcs. CSS `border-radius` draws a circular arc and **cannot reproduce this**. The difference is subtle at small radii and essentially invisible below about 8px, but it is visible on windows and sheets. There is no pure-CSS fix; approximating with an SVG mask or `paint()` worklet is possible but rarely worth the complexity.

### 3.4 Window chrome [MEASURED]

Read off `NSWindow.frameRect(forContentRect:styleMask:)` on macOS 26.5.2:

| Element | Height |
|---|---|
| Title bar (`.titled`, with or without close/minimize/resize) | **32 pt** |
| Title bar + toolbar combined | **66 pt** (so the toolbar band adds 34 pt) |

macOS 26 uses a 32pt title bar. Older macOS used 28pt, another reason old screenshots will not line up.

Traffic light buttons: **[UNVERIFIED]**. I did not measure their diameter or inset. Commonly cited as 12pt diameter with 20pt left inset and 8pt spacing, but I could not confirm this and am not asserting it.

### 3.5 Lists, sidebars, and toolbars

**[MEASURED]** on macOS 26.5.2:

| Metric | Value |
|---|---|
| `NSTableView` default `rowHeight` | **24 pt** |
| `NSOutlineView` default `rowHeight` | **24 pt** |
| `NSOutlineView` `indentationPerLevel` | **13 pt** |

**Sidebar widths: [UNVERIFIED].** Apple publishes no sidebar width for macOS. [HIG: Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) says only:

> "A sidebar's row height, text, and glyph size depend on its overall size, which can be small, medium, or large. You can set the size programmatically, but people can also change it by selecting a different sidebar icon size in General settings."

So sidebar row height is **user-configurable** and there is no single correct number. **[CONVENTION]** for a default build: sidebar width 200-260px, default around 220px, resizable, collapsing below roughly 700px total window width. Sidebar row height around 28px at the medium setting. Treat all of these as starting points to tune by eye, not as specifications.

The HIG does give two pieces of real macOS sidebar guidance worth honoring:

> "Consider automatically hiding and revealing a sidebar when its container window resizes."
> "Avoid putting critical information or actions at the bottom of a sidebar. People often relocate a window in a way that hides its bottom edge."

---

## 4. Controls

### 4.1 Control heights [MEASURED]

Read off `intrinsicContentSize` for each `NSControl.ControlSize` on macOS 26.5.2. **These are real and are the most useful numbers in this document**, because getting control heights right does more for "feels native" than almost anything else.

| Control | Large | Regular | Small | Mini |
|---|---|---|---|---|
| Push button | **28** | **24** | **20** | 16 |
| Text field | 24 | **24** | 22 | 19 |
| Segmented control | 28 | **24** | 20 | 16 |
| Popup button | 28 | **24** | 20 | 16 |
| Checkbox | 18 | **16** | 14 | 12 |
| Radio button | 18 | **16** | 14 | 12 |
| Switch (`NSSwitch`) | 24 | **24** | 24 | 24 |

All values in pt (= px). **Regular is the default** and is what you should build against: a **24px** control height for buttons, fields, popups, and segmented controls.

`NSSwitch` is **fixed at 54x24pt regardless of control size**. It does not scale. That is a real AppKit behavior, not a measurement artifact.

Note the regular push button is 24pt tall, which is **below the 28x28 default control size** the accessibility guidance recommends. Apple's own default control is smaller than Apple's own default target guidance. In practice native apps rely on the surrounding padding to make up the difference, which is what the 12pt bezel padding figure is for. If you want to satisfy the 28pt guidance strictly, use the `large` size.

Some measured widths for reference (these vary with content): push button with "Button" label is 65pt at regular; a 2-item popup button is 118pt at regular; a 3-segment control with short labels is 148pt at regular.

### 4.2 Button hierarchy [HIG]

Apple defines four **roles**, from [HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons):

> - Normal. No specific meaning.
> - Primary. The button is the default button, the button people are most likely to choose.
> - Cancel. The button cancels the current action.
> - Destructive. The button performs an action that can result in data destruction.

> "A button's role can have additional effects on its appearance. For example, a primary button uses an app's accent color, whereas a destructive button uses the system red color."

How Apple signals primary vs secondary, verbatim:

> "In general, use a button that has a prominent visual style for the most likely action in a view. ... Keep the number of prominent buttons to one or two per view."

> "**Use style, not size, to visually distinguish the preferred choice among multiple options.** When you use buttons of the same size to offer two or more options, you signal that the options form a coherent set of choices. By contrast, placing two buttons of different sizes near each other can make the interface look confusing and inconsistent."

That is the single most actionable rule in this section: **same size, different fill.** Do not make your primary button bigger. Web design does this constantly and it reads as non-native immediately.

And a safety rule worth enforcing in code review:

> "Don't assign the primary role to a button that performs a destructive action, even if that action is the most likely choice. Because of its visual prominence, people sometimes choose a primary button without reading it first."

Practically, the hierarchy is:

| Level | Appearance | Notes |
|---|---|---|
| Primary / default | Filled with accent color, white label | One per view. Responds to Return key. |
| Secondary | Bezeled, `controlColor` surface, `controlTextColor` label | The standard push button. |
| Plain / tertiary | No bezel, accent-colored or label-colored text | For low-emphasis inline actions. |
| Destructive | Red label on a bezeled button, or red fill if it is also primary | Uses system red. Never also primary. |

macOS-specific button types Apple documents: **push button** (the standard), **square/gradient button** (symbols only, sits inside a view, for things like add/remove rows), **help button** (circular, question mark, at most one per window), and **image button**. Two details worth carrying over:

> "Append a trailing ellipsis to the title when a push button opens another window, view, or app."

> "Include about 10 pixels of padding between the edges of the image and the button edges." (for image buttons)

### 4.3 Other controls

**Text fields.** 24px tall at regular **[MEASURED]**. Use `textBackgroundColor` for the fill (white in light, `#1E1E1E` in dark), a 1px border from `separatorColor`, and `placeholderTextColor` for the placeholder. On focus, macOS draws a focus ring using `keyboardFocusIndicatorColor`, which is the accent color at ~50% alpha. Reproduce it as a `box-shadow` ring of about 3px, not an outline, so it sits outside the border cleanly.

**Switches / toggles.** Fixed 54x24pt, capsule, 10px radius **[MEASURED]**. Off state uses a neutral fill; on state uses the accent color. The knob is a white circle. Apple's guidance is that toggles take effect immediately (no Apply step).

**Segmented controls.** 24px tall at regular **[MEASURED]**. A single bezel containing equal-width segments, with the selected segment raised or filled. Use for mutually exclusive view modes, not for navigation.

**Popup buttons.** 24px tall at regular **[MEASURED]**. A bezeled control with a trailing chevron (`chevron.up.chevron.down`) showing the current selection. Distinct from a **pull-down** button, which shows a fixed title and a downward chevron and lists actions rather than a selection.

**Checkboxes and radio buttons.** 16px at regular **[MEASURED]**, which is notably smaller than the 20px many web frameworks default to. Label sits to the right, vertically centered.

**Tooltips.** From [HIG: Buttons]: "In macOS and visionOS, the system displays a tooltip after people hover over a button for a moment." Icon-only buttons should always have one, and it should carry the same string as your `aria-label`.

---

## 5. Materials and depth

### 5.1 What macOS actually uses

macOS 26 introduced **Liquid Glass** as the material for the functional layer. From [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials):

> "Liquid Glass forms a distinct functional layer for controls and navigation elements, like tab bars and sidebars, that floats above the content layer, establishing a clear visual hierarchy between functional elements and content."

> "**Don't use Liquid Glass in the content layer.** ... Instead, use standard materials for elements in the content layer, such as app backgrounds."

Two variants exist, **regular** and **clear**:

> "The regular variant blurs and adjusts the luminosity of background content to maintain legibility. ... Use the regular variant when background content might create legibility issues, or when components have a significant amount of text, such as alerts, sidebars, or popovers."
> "The clear variant is highly translucent ... Use this variant for components that float above media backgrounds."

And a concrete number for the clear variant:

> "If the underlying content is bright, consider adding a dark dimming layer of **35% opacity**."

For macOS specifically, the HIG notes two blending modes:

> "macOS defines two modes that blend background content: **behind window** and **within window**."

### 5.2 What is and is not reproducible in CSS

**Be realistic here.** This is the area where a web UI most visibly diverges from native, and pretending otherwise leads to a lot of wasted effort.

**Reproducible, reasonably well:**

- **Within-window blur.** `backdrop-filter: blur(20px) saturate(180%)` over a semi-transparent background gets you convincingly close to the standard within-window material. Supported in both WebKit and Chromium.
- **Layered translucency.** Stacking a `rgba()` tint over a blur is exactly how the standard materials are built conceptually.
- **Shadows and elevation.** Plain `box-shadow` is fine.

**Not reproducible:**

- **Behind-window blur.** This is the signature macOS effect: sidebars and toolbars sampling the *desktop and other apps* behind your window. `backdrop-filter` can only sample content **inside your own document**. There is no web API that reaches outside the window. **In Electron you can get this** by setting `vibrancy: 'sidebar'` (or similar) on the `BrowserWindow` and making your CSS background transparent, which hands the effect to AppKit. **In Tauri** the equivalent is `NSVisualEffectView` via `window-vibrancy`. **Neither is a CSS solution.** If behind-window vibrancy matters to you, it is a window-configuration task in the wrapper, not a styling task.
- **Vibrancy proper.** AppKit vibrancy is not just blur; it is a specific blend of foreground content against the sampled backdrop so text stays legible over anything. CSS `mix-blend-mode` gets you a rough gesture, not the real thing.
- **The Liquid Glass lensing/refraction.** The specular edge highlights and the way the material warps content at its boundary are a Metal shader. Not reproducible.
- **Continuous corners.** As noted in 3.3.

**Recommendation:** build the content layer in plain opaque CSS using `windowBackgroundColor`, and if you want vibrancy in the sidebar and toolbar, get it from the Electron/Tauri window API rather than trying to fake it. A crisp opaque UI reads as far more native than a bad blur.

Also honor the accessibility settings. macOS has Reduce Transparency, which maps to `@media (prefers-reduced-transparency: reduce)`. If you use translucency at all, provide an opaque fallback there.

### 5.3 Shadows [CONVENTION]

**Apple publishes no shadow values for macOS.** The HIG names `shadowColor` (which is simply `#000000`) and describes shadow conceptually as "the virtual shadow cast by a raised object onscreen," but gives no offsets, blurs, or opacities.

macOS uses shadow sparingly. Most of the interface is flat, with elevation reserved for genuinely floating things: windows, sheets, popovers, menus. Do not apply web-style shadows to cards and buttons; it reads as Material Design, not macOS.

A conservative set, entirely **[CONVENTION]**:

| Level | Value | Use |
|---|---|---|
| Raised | `0 1px 2px rgba(0,0,0,0.08)` | Buttons, subtle separation. Often none at all. |
| Overlay | `0 4px 12px rgba(0,0,0,0.12)` | Popovers, dropdown menus |
| Modal | `0 12px 32px rgba(0,0,0,0.20)` | Sheets, dialogs |
| Window | `0 24px 64px rgba(0,0,0,0.28)` | Detached windows |

In dark mode, shadows are much less effective because there is less luminance range below the background. macOS compensates with **borders** rather than heavier shadows. In dark mode, prefer a 1px `separatorColor` border over increasing shadow opacity.

---

## 6. What NOT to copy: licensing

**This section matters most for a project going public on GitHub.** Getting it wrong exposes the project to a takedown.

### 6.1 The core distinction

There are two completely different things, and only one is safe:

| Action | Status |
|---|---|
| Writing `font-family: -apple-system, BlinkMacSystemFont, system-ui, ...` in CSS | **Fine.** You are asking the OS for whatever system font it has. You ship no font data. On a non-Apple machine it falls through to the next entry. Nothing Apple owns is in your repo. |
| Committing `SF-Pro.otf` / `.woff2` to the repo, or serving it, or bundling it in the app | **Not permitted.** This redistributes Apple's font. |

That distinction is the whole game. **Use the keyword. Never ship the file.**

### 6.2 SF Pro / San Francisco license terms

From [Apple Developer: Fonts](https://developer.apple.com/fonts/), the license agreements (EA1370 for SF Pro / SF Compact / SF Mono, EA1371 for SF Compact for watchOS) state:

> "THE APPLE SAN FRANCISCO FONT IS TO BE USED SOLELY FOR CREATING MOCK-UPS OF USER INTERFACES TO BE USED IN SOFTWARE PRODUCTS RUNNING ON APPLE'S iOS, OS X OR tvOS OPERATING SYSTEMS, AS APPLICABLE."

> "You may not embed the Apple Font in any software programs or other products."

> "You may not rent, lease, lend, trade, transfer, sell, sublicense or otherwise redistribute the Apple Font in any unauthorized way."

> "You may use this Apple Font only for the purposes described in this License and only if you are a registered Apple Developer, or as otherwise expressly permitted by Apple in writing."

Read plainly, this means:

- The downloadable SF fonts are licensed for **making mockups of UIs for Apple platforms**, by **registered Apple Developers**.
- **Embedding is explicitly prohibited.** A web font file served by your app is embedding.
- **Redistribution is explicitly prohibited.** A font file in a public GitHub repo is redistribution.

A practical consequence people miss: this constrains your **design files** too, not just the repo. Sharing a Figma file with SF Pro embedded, to someone who is not a registered Apple Developer, is outside these terms.

**New York (NY)** is covered by the same font license page and the same restrictions.

### 6.3 SF Symbols

SF Symbols has its own agreement, and it is **more restrictive than people assume**. Per Apple's SF Symbols license (see [SF Symbols](https://developer.apple.com/sf-symbols/) and the [HIG: SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) page):

- Symbols may be used **solely for creating user interfaces for software running on Apple operating systems**.
- **You may not use SF Symbols, or glyphs substantially or confusingly similar to them, in app icons, logos, or any other trademark-related use.**
- All SF Symbols are treated as **system-provided images** under the Xcode and Apple SDK license agreements.
- Apple **reserves the right to require modification or discontinuance** of any symbol used in violation, and you must comply promptly.

For an HTML/CSS app this is a hard blocker in practice: your app is a web UI that may run outside Apple platforms, and you would need to ship the glyphs as SVG or a font, which is redistribution. **Do not extract SF Symbols into SVGs and commit them.**

**Use instead:** [Lucide](https://lucide.dev/) (ISC), [Heroicons](https://heroicons.com/) (MIT), [Phosphor](https://phosphoricons.com/) (MIT), [Feather](https://feathericons.com/) (MIT), or [Bootstrap Icons](https://icons.getbootstrap.com/) (MIT). Lucide and Phosphor both have a clean geometric look that sits comfortably next to SF Pro. Draw your own for anything distinctive.

### 6.4 Other licensing traps for a public repo

- **Apple's swatch PNGs.** The color values in Section 2.3 were sampled from Apple's documentation assets. **The numeric values are facts and are not copyrightable**, so putting hex codes in your CSS is fine. Do not commit the downloaded PNG assets themselves.
- **Screenshots of macOS UI.** Screenshots of Apple's own applications or system UI in your README are Apple's copyrighted material. Screenshots of *your* app are yours.
- **Apple trademarks.** Do not name the project something containing "Apple", "Mac", "macOS", "Aqua", or an Apple product name in a way that implies endorsement. "macOS-style theme" as a description is descriptive fair use; "MacTheme" as a product name is asking for trouble. Apple's [trademark guidelines](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html) are the reference.
- **The HIG text itself.** Do not paste large verbatim sections of Apple's HIG into your docs. The short quotes in *this* document are attributed excerpts for reference; a wholesale copy is not.
- **The word "Liquid Glass"** and other Apple feature names are Apple's. Describe the effect, do not brand your component with the name.

### 6.5 The safe summary

For a public repo, you may ship: **hex/rgba values, point sizes, spacing numbers, the `-apple-system` font-family declaration, and your own CSS.** You may not ship: **Apple font files, SF Symbols glyphs, Apple's image assets, or Apple's trademarks.**

Everything in Section 7 is on the safe side of that line.

---

## 7. Ready-to-use CSS foundation

Self-contained. No external fonts, no CDN, no network requests. Drop in as the first stylesheet.

Choices made, so you can override deliberately:

- Label colors use `rgba()` with Apple's real alphas, so they composite correctly over any backdrop.
- `--label-secondary` in **light** mode is set to **0.60 alpha, not Apple's 0.498**, to clear WCAG AA (5.74:1 vs Apple's 3.95:1). `--label-secondary-exact` carries Apple's true value if you need fidelity over compliance.
- `--fill-accent-strong` (used for primary button fills) defaults to `#0064E1`, Apple's `selectedContentBackgroundColor`, rather than system blue, because white text on system blue is only 3.5:1. `--accent` holds the true system blue for non-text uses.
- Destructive **text** uses the increased-contrast red in light mode for the same reason.
- A `prefers-contrast: more` block swaps in Apple's increased-contrast system colors.
- A `prefers-reduced-transparency` block kills the material blur.

```css
/* ============================================================
   macOS-style foundation
   Values: Apple HIG where published; measured from AppKit on
   macOS 26.5.2 where not. See apple-style-reference.md for
   per-value provenance. No Apple assets are redistributed here.
   ============================================================ */

:root {
  /* ---------- Type families ---------- */
  /* -apple-system: WebKit (Tauri/WKWebView)
     BlinkMacSystemFont: Chromium (Electron)
     system-ui: standard, both engines                         */
  --font-ui: -apple-system, BlinkMacSystemFont, system-ui,
             "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Monaco,
               "Courier New", monospace;

  /* ---------- Type scale [HIG: macOS built-in text styles] ----------
     size / line-height / weight / tracking                     */
  --text-large-title-size: 26px;
  --text-large-title-line: 32px;
  --text-large-title-weight: 400;
  --text-large-title-tracking: 0.008em;

  --text-title-1-size: 22px;
  --text-title-1-line: 26px;
  --text-title-1-weight: 400;
  --text-title-1-tracking: -0.012em;

  --text-title-2-size: 17px;
  --text-title-2-line: 22px;
  --text-title-2-weight: 400;
  --text-title-2-tracking: -0.026em;

  --text-title-3-size: 15px;
  --text-title-3-line: 20px;
  --text-title-3-weight: 400;
  --text-title-3-tracking: -0.016em;

  --text-headline-size: 13px;
  --text-headline-line: 16px;
  --text-headline-weight: 700;
  --text-headline-tracking: -0.006em;

  --text-body-size: 13px;
  --text-body-line: 16px;
  --text-body-weight: 400;
  --text-body-tracking: -0.006em;

  --text-callout-size: 12px;
  --text-callout-line: 15px;
  --text-callout-weight: 400;
  --text-callout-tracking: 0em;

  --text-subheadline-size: 11px;
  --text-subheadline-line: 14px;
  --text-subheadline-weight: 400;
  --text-subheadline-tracking: 0.006em;

  --text-footnote-size: 10px;
  --text-footnote-line: 13px;
  --text-footnote-weight: 400;
  --text-footnote-tracking: 0.012em;

  --text-caption-1-size: 10px;
  --text-caption-1-line: 13px;
  --text-caption-1-weight: 400;
  --text-caption-1-tracking: 0.012em;

  --text-caption-2-size: 10px;
  --text-caption-2-line: 13px;
  --text-caption-2-weight: 500;
  --text-caption-2-tracking: 0.012em;

  /* Weight ramp */
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;
  --weight-heavy: 800;

  /* ---------- Spacing [CONVENTION, anchored on HIG 12pt/24pt] ---------- */
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;   /* HIG: padding around bezeled elements */
  --space-6: 16px;
  --space-7: 20px;
  --space-8: 24px;   /* HIG: padding around non-bezeled elements */
  --space-9: 32px;
  --space-10: 40px;

  /* ---------- Radii [CONVENTION except --radius-switch] ---------- */
  --radius-sm: 5px;    /* small controls (20px tall) */
  --radius-md: 6px;    /* default controls (24px tall), fields */
  --radius-lg: 7px;    /* large controls (28px tall) */
  --radius-card: 8px;
  --radius-popover: 8px;
  --radius-sheet: 12px;
  --radius-window: 12px;
  --radius-switch: 10px;  /* [MEASURED] NSSwitch track is a capsule */
  --radius-pill: 9999px;

  /* ---------- Control metrics [MEASURED, macOS 26.5.2] ---------- */
  --control-h-large: 28px;
  --control-h: 24px;        /* regular: the default */
  --control-h-small: 20px;
  --control-h-mini: 16px;
  --field-h: 24px;
  --checkbox-size: 16px;
  --switch-w: 54px;
  --switch-h: 24px;
  --row-h: 24px;            /* NSTableView default rowHeight */
  --outline-indent: 13px;   /* NSOutlineView indentationPerLevel */
  --titlebar-h: 32px;
  --titlebar-toolbar-h: 66px;
  --hit-target-min: 20px;   /* [HIG] macOS minimum control size */
  --hit-target-default: 28px; /* [HIG] macOS default control size */

  /* ---------- Sidebar [CONVENTION] ---------- */
  --sidebar-w: 220px;
  --sidebar-w-min: 200px;
  --sidebar-w-max: 260px;

  /* ---------- Shadows [CONVENTION] ---------- */
  --shadow-raised:  0 1px 2px rgba(0, 0, 0, 0.08);
  --shadow-overlay: 0 4px 12px rgba(0, 0, 0, 0.12);
  --shadow-modal:   0 12px 32px rgba(0, 0, 0, 0.20);
  --shadow-window:  0 24px 64px rgba(0, 0, 0, 0.28);

  /* ---------- Motion [CONVENTION] ---------- */
  --ease-standard: cubic-bezier(0.4, 0.0, 0.2, 1);
  --duration-fast: 120ms;
  --duration-base: 200ms;
}

/* ============================================================
   LIGHT APPEARANCE (default)
   Semantic colors [MEASURED from AppKit .aqua]
   System colors [SAMPLED from Apple HIG swatches]
   ============================================================ */
:root {
  --label:            rgba(0, 0, 0, 0.847);
  --label-secondary:  rgba(0, 0, 0, 0.60);   /* AA-adjusted, see docs */
  --label-secondary-exact: rgba(0, 0, 0, 0.498); /* Apple's true value */
  --label-tertiary:   rgba(0, 0, 0, 0.259);
  --label-quaternary: rgba(0, 0, 0, 0.098);
  --text:             #000000;
  --text-placeholder: rgba(0, 0, 0, 0.60);   /* AA-adjusted */
  --text-disabled:    rgba(0, 0, 0, 0.247);
  --text-selected:    #000000;
  --text-on-accent:   #FFFFFF;

  --bg-window:        #FFFFFF;
  --bg-content:       #FFFFFF;   /* controlBackgroundColor */
  --bg-text:          #FFFFFF;   /* textBackgroundColor */
  --bg-under-page:    rgba(150, 150, 150, 0.898);
  --bg-raised:        #FFFFFF;
  --bg-sidebar:       #F5F5F5;   /* [CONVENTION] no published value */

  --fill-control:     #FFFFFF;   /* controlColor */
  --fill-selected:    #B3D7FF;   /* selectedControlColor */
  --fill-selected-content: #0064E1;
  --fill-selected-unemphasized: #DCDCDC;
  --fill-accent-strong: #0064E1; /* primary button fill; 5.37:1 w/ white */

  --separator:        rgba(0, 0, 0, 0.098);
  --grid:             #E6E6E6;
  --link:             #0068DA;
  --focus-ring:       rgba(0, 103, 244, 0.498);
  --selection-bg:     #B3D7FF;

  /* Accent. controlAccentColor is user-configurable in System
     Settings; #007AFF is the blue default.                     */
  --accent:           #007AFF;

  /* System colors, light [SAMPLED] */
  --system-red:    #FF383C;
  --system-orange: #FF8D28;
  --system-yellow: #FFCC00;
  --system-green:  #34C759;
  --system-mint:   #00C8B3;
  --system-teal:   #00C3D0;
  --system-cyan:   #00C0E8;
  --system-blue:   #0088FF;
  --system-indigo: #6155F5;
  --system-purple: #CB30E0;
  --system-pink:   #FF2D55;
  --system-brown:  #AC7F5E;

  /* Destructive text uses the higher-contrast red in light mode
     (4.56:1 vs 3.57:1 for --system-red).                        */
  --destructive-text: #E9152D;
  --destructive-fill: #FF383C;
}

/* ============================================================
   DARK APPEARANCE
   [MEASURED from AppKit .darkAqua]
   ============================================================ */
@media (prefers-color-scheme: dark) {
  :root {
    --label:            rgba(255, 255, 255, 0.847);
    --label-secondary:  rgba(255, 255, 255, 0.549);  /* already 5.92:1 */
    --label-secondary-exact: rgba(255, 255, 255, 0.549);
    --label-tertiary:   rgba(255, 255, 255, 0.247);
    --label-quaternary: rgba(255, 255, 255, 0.098);
    --text:             #FFFFFF;
    --text-placeholder: rgba(255, 255, 255, 0.549);
    --text-disabled:    rgba(255, 255, 255, 0.247);
    --text-selected:    #FFFFFF;
    --text-on-accent:   #FFFFFF;

    --bg-window:        #1E1E1E;
    --bg-content:       #1E1E1E;
    --bg-text:          #1E1E1E;
    --bg-under-page:    #282828;
    --bg-raised:        #2A2A2A;   /* [CONVENTION] */
    --bg-sidebar:       #262626;   /* [CONVENTION] */

    --fill-control:     rgba(255, 255, 255, 0.247);
    --fill-selected:    #3F638B;
    --fill-selected-content: #0059D1;
    --fill-selected-unemphasized: #464646;
    --fill-accent-strong: #0A84FF; /* [CONVENTION] readable on dark */

    --separator:        rgba(255, 255, 255, 0.098);
    --grid:             #1A1A1A;
    --link:             #419CFF;
    --focus-ring:       rgba(26, 169, 255, 0.498);
    --selection-bg:     #3F638B;

    --accent:           #007AFF;

    /* System colors, dark [SAMPLED] */
    --system-red:    #FF4245;
    --system-orange: #FF9230;
    --system-yellow: #FFD600;
    --system-green:  #30D158;
    --system-mint:   #00DAC3;
    --system-teal:   #00D2E0;
    --system-cyan:   #3CD3FE;
    --system-blue:   #0091FF;
    --system-indigo: #6D7CFF;
    --system-purple: #DB34F2;
    --system-pink:   #FF375F;
    --system-brown:  #B78A66;

    --destructive-text: #FF4245;  /* 4.86:1 on #1E1E1E, passes */
    --destructive-fill: #FF4245;
  }
}

/* ============================================================
   INCREASED CONTRAST
   Maps to the macOS "Increase Contrast" setting.
   Values from Apple's increased-contrast swatches [SAMPLED].
   ============================================================ */
@media (prefers-contrast: more) {
  :root {
    --label:            rgba(0, 0, 0, 1);
    --label-secondary:  rgba(0, 0, 0, 0.75);
    --separator:        rgba(0, 0, 0, 0.35);
    --system-red:    #E9152D;
    --system-orange: #C55300;
    --system-yellow: #A16A00;
    --system-green:  #008932;
    --system-mint:   #008575;
    --system-teal:   #008198;
    --system-cyan:   #007EAE;
    --system-blue:   #1E6EF4;
    --system-indigo: #564ADE;
    --system-purple: #B02FC2;
    --system-pink:   #E7124D;
    --system-brown:  #956D51;
    --fill-accent-strong: #1E6EF4;
    --destructive-text: #E9152D;
  }
}

@media (prefers-contrast: more) and (prefers-color-scheme: dark) {
  :root {
    --label:            rgba(255, 255, 255, 1);
    --label-secondary:  rgba(255, 255, 255, 0.80);
    --separator:        rgba(255, 255, 255, 0.35);
    --system-red:    #FF6165;
    --system-orange: #FFA056;
    --system-yellow: #FEDF43;
    --system-green:  #4AD968;
    --system-mint:   #54DFCB;
    --system-teal:   #3BDDEC;
    --system-cyan:   #6DD9FF;
    --system-blue:   #5CB8FF;
    --system-indigo: #A7AAFF;
    --system-purple: #EA8DFF;
    --system-pink:   #FF8AC4;
    --system-brown:  #DBA679;
    --fill-accent-strong: #0A84FF;
    --destructive-text: #FF6165;
  }
}

/* ============================================================
   BASE
   ============================================================ */
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--text-body-size);
  line-height: var(--text-body-line);
  font-weight: var(--weight-regular);
  letter-spacing: var(--text-body-tracking);
  color: var(--label);
  background: var(--bg-window);
  /* macOS UI text is not selectable by default. Re-enable on
     content regions with .selectable.                          */
  -webkit-user-select: none;
  user-select: none;
}

.selectable,
input,
textarea {
  -webkit-user-select: text;
  user-select: text;
}

/* ---------- Type utility classes ---------- */
.text-large-title { font-size: var(--text-large-title-size); line-height: var(--text-large-title-line); font-weight: var(--text-large-title-weight); letter-spacing: var(--text-large-title-tracking); }
.text-title-1     { font-size: var(--text-title-1-size);     line-height: var(--text-title-1-line);     font-weight: var(--text-title-1-weight);     letter-spacing: var(--text-title-1-tracking); }
.text-title-2     { font-size: var(--text-title-2-size);     line-height: var(--text-title-2-line);     font-weight: var(--text-title-2-weight);     letter-spacing: var(--text-title-2-tracking); }
.text-title-3     { font-size: var(--text-title-3-size);     line-height: var(--text-title-3-line);     font-weight: var(--text-title-3-weight);     letter-spacing: var(--text-title-3-tracking); }
.text-headline    { font-size: var(--text-headline-size);    line-height: var(--text-headline-line);    font-weight: var(--text-headline-weight);    letter-spacing: var(--text-headline-tracking); }
.text-body        { font-size: var(--text-body-size);        line-height: var(--text-body-line);        font-weight: var(--text-body-weight);        letter-spacing: var(--text-body-tracking); }
.text-callout     { font-size: var(--text-callout-size);     line-height: var(--text-callout-line);     font-weight: var(--text-callout-weight);     letter-spacing: var(--text-callout-tracking); }
.text-subheadline { font-size: var(--text-subheadline-size); line-height: var(--text-subheadline-line); font-weight: var(--text-subheadline-weight); letter-spacing: var(--text-subheadline-tracking); }
.text-footnote    { font-size: var(--text-footnote-size);    line-height: var(--text-footnote-line);    font-weight: var(--text-footnote-weight);    letter-spacing: var(--text-footnote-tracking); }
.text-caption-1   { font-size: var(--text-caption-1-size);   line-height: var(--text-caption-1-line);   font-weight: var(--text-caption-1-weight);   letter-spacing: var(--text-caption-1-tracking); }
.text-caption-2   { font-size: var(--text-caption-2-size);   line-height: var(--text-caption-2-line);   font-weight: var(--text-caption-2-weight);   letter-spacing: var(--text-caption-2-tracking); }

/* ---------- Focus ring ----------
   Matches keyboardFocusIndicatorColor: accent at ~50% alpha,
   drawn outside the control border.                            */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring);
}

/* ---------- Buttons ----------
   HIG: "Use style, not size, to visually distinguish the
   preferred choice." All variants share --control-h.           */
.btn {
  font-family: inherit;
  font-size: var(--text-body-size);
  line-height: var(--text-body-line);
  letter-spacing: var(--text-body-tracking);
  height: var(--control-h);
  min-width: var(--hit-target-min);
  padding: 0 var(--space-5);
  border-radius: var(--radius-md);
  border: 1px solid var(--separator);
  background: var(--fill-control);
  color: var(--label);
  cursor: default;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard);
}
.btn:hover           { filter: brightness(0.97); }
.btn:active          { filter: brightness(0.93); }
.btn[disabled]       { color: var(--text-disabled); pointer-events: none; }

.btn--primary {
  background: var(--fill-accent-strong);
  border-color: transparent;
  color: var(--text-on-accent);
  font-weight: var(--weight-medium);
}
.btn--primary:hover  { filter: brightness(1.08); }
.btn--primary:active { filter: brightness(0.92); }

.btn--plain {
  background: transparent;
  border-color: transparent;
  color: var(--accent);
}

.btn--destructive        { color: var(--destructive-text); }
.btn--destructive-filled {
  background: var(--destructive-fill);
  border-color: transparent;
  color: var(--text-on-accent);
}

.btn--large { height: var(--control-h-large); border-radius: var(--radius-lg); }
.btn--small { height: var(--control-h-small); border-radius: var(--radius-sm); font-size: var(--text-subheadline-size); }

/* ---------- Text fields ---------- */
.field {
  font-family: inherit;
  font-size: var(--text-body-size);
  letter-spacing: var(--text-body-tracking);
  height: var(--field-h);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--separator);
  background: var(--bg-text);
  color: var(--text);
  box-sizing: border-box;
}
.field::placeholder { color: var(--text-placeholder); }
.field:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-ring); }

/* ---------- Switch ----------
   [MEASURED] NSSwitch is fixed 54x24pt at every control size.  */
.switch {
  width: var(--switch-w);
  height: var(--switch-h);
  border-radius: var(--radius-switch);
  background: var(--fill-selected-unemphasized);
  border: none;
  position: relative;
  cursor: default;
  transition: background var(--duration-base) var(--ease-standard);
  flex: none;
}
.switch[aria-checked="true"] { background: var(--accent); }
.switch::after {
  content: "";
  position: absolute;
  top: 2px; left: 2px;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #FFFFFF;
  box-shadow: var(--shadow-raised);
  transition: transform var(--duration-base) var(--ease-standard);
}
.switch[aria-checked="true"]::after { transform: translateX(30px); }

/* ---------- Separator ---------- */
.separator {
  height: 1px;
  background: var(--separator);
  border: none;
  margin: 0;
}

/* ---------- List rows ---------- */
.row {
  height: var(--row-h);
  display: flex;
  align-items: center;
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
}
.row[aria-selected="true"] {
  background: var(--fill-selected-content);
  color: var(--text-on-accent);
}

/* ---------- Sidebar ---------- */
.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w-min);
  max-width: var(--sidebar-w-max);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--separator);
  padding: var(--space-4);
  box-sizing: border-box;
}

/* ---------- Material (within-window only) ----------
   backdrop-filter samples only content inside this document.
   Behind-window vibrancy is NOT achievable in CSS; set it on
   the Electron BrowserWindow (vibrancy) or Tauri window.       */
.material {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}
@media (prefers-color-scheme: dark) {
  .material { background: rgba(30, 30, 30, 0.72); }
}
@media (prefers-reduced-transparency: reduce) {
  .material {
    background: var(--bg-window);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

/* ---------- Reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. Verified vs unverified: the honest ledger

### Solid, sourced to Apple's published docs

- macOS built-in text styles: all 11 styles with size, line height, and weights.
- macOS tracking values, full table 6pt to 96pt.
- macOS default type size (13pt) and minimum (10pt).
- macOS default control size (28x28pt) and minimum (20x20pt).
- Padding guidance: ~12pt around bezeled elements, ~24pt around non-bezeled.
- Contrast minimums (4.5:1 up to 17pt; 3:1 at 18pt; 3:1 all bold).
- The complete list of macOS semantic color *names* and their documented purposes.
- Button roles, the style-not-size rule, and the do-not-make-destructive-primary rule.
- Liquid Glass guidance, the two variants, and the 35% dimming figure.
- SF Pro and SF Symbols license terms, quoted verbatim.

### Solid, but measured rather than published

Read off AppKit on **macOS 26.5.2 only**. Expect drift across OS releases.

- All 33 macOS semantic color values, light and dark.
- All control heights across all four control sizes.
- Title bar (32pt) and title bar + toolbar (66pt) heights.
- `NSTableView` / `NSOutlineView` row height (24pt) and indentation (13pt).
- System font size constants (13 / 11 / 10 pt).
- `NSSwitch` capsule geometry (54x24pt, 10pt radius).

### Sampled from Apple's images, not published as text

- All 12 system colors across all four appearance variants (48 values). Apple ships these only as swatch PNGs. Sampled from Apple's own CDN assets, each verified uniform before sampling.

### Could NOT verify. Treat as convention, not fact.

1. **Corner radii for buttons, fields, segmented controls, popups, cards, sheets, and windows.** Apple publishes none, and all three measurement approaches failed (offscreen bitmap caching and `CALayer.render` capture only the glyphs, not the system-drawn bezel; screen capture needs a permission unavailable here). Only the switch radius is real. **If exact radii matter, measure on-device with a 5x screenshot.**
2. **Sidebar widths.** Apple publishes no number, and the HIG explicitly says sidebar row height is user-configurable via a System Settings size preference. My 200-260px range is convention.
3. **Traffic light button geometry.** Not measured, not asserted.
4. **Shadow values.** Apple publishes none beyond naming `shadowColor` as black. The four-level ramp is entirely convention.
5. **The spacing scale itself.** Only 12pt and 24pt come from Apple. The 4pt ramp around them is convention. There is no published "Apple 8pt grid" for macOS.
6. **Sidebar background colors** (`--bg-sidebar` in both appearances) and `--bg-raised` in dark. No AppKit semantic color maps cleanly to these; the values are eyeballed.
7. **Named-weight to CSS-numeric mapping** (Regular=400 etc.). Standard CSS practice, not an Apple statement.
8. **Font stack ordering.** Apple documents `-apple-system`; the three-keyword ordering is community practice.
9. **`--fill-accent-strong` in dark mode** (`#0A84FF`). This is the legacy iOS/macOS dark systemBlue, chosen for readability, not a current published value.

### Deliberate deviations from Apple, for accessibility

Documented so nobody "fixes" them back:

| Token | Apple's value | This document | Why |
|---|---|---|---|
| `--label-secondary` (light) | 0.498 alpha (3.95:1) | 0.60 alpha (5.74:1) | Apple's fails AA |
| `--text-placeholder` (light) | 0.498 alpha (3.95:1) | 0.60 alpha (5.74:1) | Same |
| `--fill-accent-strong` (light) | `#0088FF` system blue | `#0064E1` | White on system blue is 3.52:1, fails AA |
| `--destructive-text` (light) | `#FF383C` | `#E9152D` | 3.57:1 vs 4.56:1 |

Apple's true values are preserved as `--label-secondary-exact` and `--system-blue` / `--system-red` if you need fidelity over compliance.

---

## Sources

- [HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [HIG: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [HIG: Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- [HIG: Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [HIG: SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)
- [Apple Developer: Fonts](https://developer.apple.com/fonts/) (SF Pro / SF Symbols license text)
- [Apple Developer: SF Symbols](https://developer.apple.com/sf-symbols/)
- [WebKit: Using the System Font in Web Content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/)
- [Apple: Guidelines for Using Apple Trademarks](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html)
- Apple docs CDN (`docs-assets.developer.apple.com`) for the system color swatch assets referenced by the HIG Color specifications section.
