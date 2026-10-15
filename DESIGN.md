---
name: Race Week
description: One F1 race weekend's model predictions set against what happened, printed as a paddock credential.
colors:
  laminate: "#f3f4f1"
  ink: "#121314"
  card-white: "#ffffff"
  ultramarine-band: "#2337e6"
  band-foreground: "#ffffff"
  plate-grey: "#e8e9e5"
  muted-ink: "#5c5f5a"
  subtle-ink: "#74776f"
  rule-grey: "#d6d8d2"
  input-grey: "#c9cbc5"
  flag-yellow: "#ffc800"
  flag-red: "#d40a1c"
  gain-green: "#0a7f45"
  stale-ochre: "#8a6400"
  tyre-soft: "#e0251b"
  tyre-medium: "#ffcf24"
  tyre-hard: "#ffffff"
  tyre-inter: "#2f9e3a"
  tyre-wet: "#1268c9"
typography:
  verdict-display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(4.5rem, 9vw, 7rem)"
    fontWeight: 900
    lineHeight: 0.8
    fontVariation: "'wdth' 62"
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5.5vw, 4.5rem)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 62"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4rem)"
    fontWeight: 900
    lineHeight: 1
    fontVariation: "'wdth' 62"
  numeral:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 900
    lineHeight: 1
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 62"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.05em"
    fontVariation: "'wdth' 68"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 75"
  stamp:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 62"
rounded:
  none: "0px"
spacing:
  hairline: "2px"
  card-x-mobile: "20px"
  card-x: "24px"
  gutter: "24px"
  section-gap: "40px"
  page-x-mobile: "16px"
  page-x: "48px"
  page-max: "1440px"
components:
  credential-band:
    backgroundColor: "{colors.ultramarine-band}"
    textColor: "{colors.band-foreground}"
    rounded: "{rounded.none}"
  zone-cleared:
    backgroundColor: "{colors.band-foreground}"
    textColor: "{colors.ultramarine-band}"
    size: "32px"
  zone-selected:
    backgroundColor: "{colors.laminate}"
    textColor: "{colors.ink}"
  zone-punch:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.laminate}"
    size: "32px"
  prediction-section:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "20px 24px"
  context-section:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  model-footer:
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    padding: "10px 24px"
  segmented-option:
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  segmented-option-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.laminate}"
  stamp-won:
    textColor: "{colors.ink}"
    typography: "{typography.stamp}"
  stamp-void:
    textColor: "{colors.flag-red}"
    typography: "{typography.stamp}"
  stamp-stale:
    textColor: "{colors.stale-ochre}"
    typography: "{typography.stamp}"
  model-scores-chip:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
---

# Design System: Race Week

## Overview

**Creative North Star: "The Paddock Credential"**

The weekend is printed as a credential hung on a lanyard: a matte laminate card, engraved in near-black ink, crossed by a single ultramarine role band. The zones printed on the band are the sessions of the weekend; a zone is filled once the model has seen that session and punched through when the reader is looking at it. Everything below the band reads like the back of the pass: ruled, dense, square, set in one heavy narrow face.

The page is light and flat. Depth comes from ink rules, not light: a 3px ink strip heads every section, 1px rules divide rows, and the prediction sections sit on a white card that is one step brighter than the laminate. Race-control state is spoken in marshal-flag colours, and the states of the data itself (pending, void, stale, won, beaten) are rubber stamps pressed slightly off square, never silently removed.

The system refuses the dark broadcast-card grid every F1 dashboard ships: no black ground, no glow, no rounded tiles, no gradient team livery behind numbers.

**Key Characteristics:**
- One light laminate ground with ink type; white card only for prediction sections.
- Ultramarine means the model's prediction (and the credential band that carries the weekend). Nothing else is ultramarine.
- Archivo variable at 62-68% width and 800-900 weight for every head and numeral; 100% width for prose.
- Square corners everywhere; the only circles are punched holes, tyre and incident markers.
- State is stamped, not hidden.

## Colors

A cool off-white laminate and a near-black ink carry the page; one saturated ultramarine is reserved for prediction, and fixed sporting codes (marshal flags, Pirelli compounds) speak in their own colours.

### Primary
- **Credential Ultramarine** (ultramarine-band): the header band, the selection highlight, the focus ring, and inside sections only the model's prediction: the favourite's score in the verdict, the pole score, heatmap probability fills and probability bars. If a mark is not the model speaking, it is not ultramarine.

### Secondary
- **Marshal Yellow** (flag-yellow): safety car. VSC is the same yellow striped with ink in 6px bands (the black-and-yellow board). It also tints the stale notice box at 20% and turns the header clock yellow while a race is live.
- **Marshal Red** (flag-red): red flag, retirements (DNF), a place lost against the prediction, a failed backtest metric, the BEATEN and VOID stamps, and the circuit's start marker. It doubles as the destructive token.
- **Gain Green** (gain-green): a place gained against the prediction, a backtest metric that beats its baseline. Green and red are only ever a delta pair.

### Tertiary
- **Pirelli compounds** (tyre-soft, tyre-medium, tyre-hard, tyre-inter, tyre-wet): stint bars and compound dots in the strategy section. The white hard compound always carries a 1px ink border; on lines it draws in ink. Rain in the weather chart borrows the wet-compound blue.

### Neutral
- **Laminate** (laminate): page ground and the selected zone on the band.
- **Engraving Ink** (ink): all text, section head strips, the punched zone, active segmented option, the site footer ground.
- **Card White** (card-white): prediction section surface, popovers, tooltips.
- **Plate Grey** (plate-grey): bar tracks and secondary fills.
- **Muted Ink** (muted-ink) and **Subtle Ink** (subtle-ink): notes, axis ticks, meta lines; subtle for the PENDING / NO SNAPSHOT stamps and missing-team fallback.
- **Rule Grey** (rule-grey): every 1px rule and card border. **Input Grey** (input-grey): field borders.
- **Stale Ochre** (stale-ochre): the STALE stamp only.

### Named Rules
**The One Band Rule.** Ultramarine marks the model's prediction and the credential band that carries it. Results, context, links, charts of observed data and decoration never use it.

**The Flag Code Rule.** Yellow is safety car, yellow-and-ink stripes are VSC, red is red flag. These colours are not available for generic warning or emphasis outside race-control meaning, retirements and losses.

## Typography

**Display Font:** Archivo variable, width axis 62-125, weight 400-900 (with ui-sans-serif, system-ui)
**Body Font:** Archivo at 100% width
**Label Font:** Archivo at 75% width, uppercase

**Known gap:** Archivo is still loaded from the Google Fonts CDN (`wdth,wght@62..125,400..900`) rather than self-hosted with the site.

**Character:** One family doing all the work through its width axis: heavy, narrow 62-68% lettering for names, codes and numerals, like the stamped type on a pass; normal width for sentences so they stay readable. All numbers are tabular.

### Hierarchy
- **Verdict display** (900, clamp(4.5rem, 9vw, 7rem), 0.8, 62% width): the favourite's three-letter driver code. One per page.
- **Display** (900, clamp(2.5rem, 5.5vw, 4.5rem), 0.9, 62% width): the event name on the band. The countdown / FINISHED clock uses the same cut at 2.25-3rem, uppercase.
- **Headline** (900, clamp(2.5rem, 5vw, 4rem), 62% width, ultramarine): the favourite's score beside the verdict code.
- **Numeral** (900, 1.875rem, 62% width, tabular): scorecard and risk figures.
- **Title** (800, 1.125rem, 0.05em tracking, uppercase, 68% width): section names. All h1-h4 default to 68% width with balanced wrapping.
- **Body** (400, 1rem-1.125rem, 1.625 line height, max 60ch): the verdict sentence and notes; supporting copy steps down to 0.875rem and 0.75rem in muted ink.
- **Label** (700, 0.72rem, 0.12em, uppercase, 75% width, muted ink): sub-block headings inside a section, table heads, definition terms.
- **Stamp** (900, 62% width, 0.12em, uppercase, 2px currentColor border, rotated -2.5deg): data-state marks, sized to context (11px in a header, 1rem in an empty state, 1.5-1.875rem in the verdict).

### Named Rules
**The Width Axis Rule.** Hierarchy is set by width and weight before size: heads and numerals go narrow and heavy (62-68%, 800-900), prose stays at 100%. Never bring in a second display family.

**The Tabular Rule.** Every number on the page is tabular; the body sets `tnum` globally.

## Layout

A single 1440px column with 16px side margin on mobile and 48px from md. The header band runs full bleed; its content aligns to the same 1440px measure. Below it, a 12-column grid from lg (1024px) with a 24px gutter and 40px between rows; everything stacks to one column below lg. Story order sets placement: the verdict spans all 12, then finishing order (8) beside race control risk (4), then strategy, weather, circuit, qualifying (12), championship (7) with notes (5), and results (12). Sections use container queries (@3xl, 48rem) to split their own internals when wide enough. The six-zone stage strip is always six equal columns; on mobile each zone stacks its number over a short code. Prediction section bodies pad 20px (24px from md). Density is high: tables run 8-10px row padding on 1px rules.

## Elevation & Depth

Flat. Depth is printed, not lit: a 3px ink top rule heads every section, 1px rule-grey borders frame prediction cards, and the white card sits one tone above the laminate. The only shadows are on floating layers (popover and cursor tooltip), which also carry a 1px ink border; nothing at rest on the page casts a shadow.

### Named Rules
**The Printed Depth Rule.** Hierarchy between surfaces comes from ink rules and the laminate-to-white step. Do not add shadows to sections, rows or controls.

## Shapes

Radius is zero everywhere (all radius tokens resolve to 0px). Edges are ruled: 1px for borders and row dividers, 2px for stamps and the focus outline, 3px for section head strips. Circles appear only where the thing is round in the world: the punched hole in a selected zone, tyre-compound dots, and the incident-history pips. Pit windows are hatched (45deg ink lines at 55%, 1.5px on a 5px pitch) inside a dashed ink border.

## Components

### Credential Band
The header. Full-bleed ultramarine with white text: a top line (RACE WEEK at 68% width, 900, 0.18em tracking; a "How it's built" link), the event name in display, a facts line at 85% white, and on the right the race clock (countdown with a "Lights out in" label, LIVE in flag yellow, or FINISHED) and the run barcode. Internal dividers are white at 25%.

### Zone Strip
The weekend's six stages as numbered access zones in an ordered list along the bottom of the band, divided by 25% white rules. Each zone is a 32px square numeral: **cleared** zones are filled white with ultramarine numerals, **uncleared** are outlined at 50% white with dimmed text, and the **selected** zone turns the whole cell laminate with ink text and swaps its square for a 32px ink circle, the punched hole, which arrives with the punch-in motion. The current zone carries a tiny NOW (or FINAL) tag. Only zones with a snapshot are clickable; hover lifts them to 10% white.

### Run Barcode
The publish run id rendered as an SVG barcode (bar widths derived from the id's characters, max 200px, 26px tall, currentColor) above "Run <id>" in 11px tabular text. Decorative to assistive tech; the id is in the text.

### Verdict
The first answer under the band: the favourite's code in verdict display, the ultramarine score with a muted caption, and once the race is run a WON (ink) or BEATEN (marshal red) stamp. A sentence follows at up to 60ch. On the right, a three-line scorecard: each line a label, a numeral and a muted note on 1px rules.

### Section Tiers
- **Prediction section:** white card, 1px rule-grey border with a 3px ink top, header row ruled off below, 20/24px padding, a MODEL SCORES chip in the header while the model is uncalibrated, and the model footer. Reserved for model output.
- **Context section:** no card; laminate ground under a 3px ink top rule, header and body flush to the column. Used for weather, circuit, championship, notes and results.

### Model Footer
The last row of every prediction section: 1px top rule, laminate at 60% over the card, 12px muted text naming the model and version (in ink, semibold), its training cut-off, and a Backtest popover trigger aligned right. Backtest metrics colour gain green or marshal red against their baseline.

### State Stamps
PENDING and NO SNAPSHOT (subtle ink), VOID (marshal red), STALE (ochre, in the section header, with a yellow-tinted notice box below), WON and BEATEN in the verdict. A section in any of these states keeps its frame and title; the body becomes a centred stamp with one line of explanation.

### Segmented Control
A 1px ink-bordered group of uppercase 68%-width buttons (700, 0.875rem, 0.06em tracking, 6px 12px). The pressed option inverts to ink with laminate text; others hover to 8% ink; disabled options fall to 30%. Pressed state is exposed with `aria-pressed`.

### Popover and Tooltip
White, 1px ink border, square, 12px text. Popovers hold the uncalibrated-model note and the backtest; the cursor tooltip follows the pointer on charts and works on tap.

### Motion
- **Punch-in** (420ms, cubic-bezier(0.16, 1, 0.3, 1)): the selected zone's hole scales down from 1.6x as it fades in.
- **Stage-fade** (360ms, same curve): when the viewed stage changes, section bodies fade up from 35% opacity and a 2px blur.
- Colour and opacity transitions run at 200ms. Under `prefers-reduced-motion: reduce` every animation and transition collapses to 1ms.

## Do's and Don'ts

### Do:
- **Do** keep ultramarine (the One Band Rule) for the band and the model's prediction only.
- **Do** head every section with a 3px ink rule, and put model output on the white prediction card with its model footer.
- **Do** set heads and numerals in Archivo at 62-68% width and 800-900 weight, and keep every number tabular.
- **Do** show data states as stamps that keep the section in place.
- **Do** use marshal-flag colours with their race-control meaning, and pair gain green with marshal red only for deltas.
- **Do** border the white hard compound in ink, and draw it in ink on lines.

### Don't:
- **Don't** round corners; radius is 0px. Circles only for the punched hole, tyres and incident pips.
- **Don't** put shadows on sections, rows or controls.
- **Don't** use ultramarine for links, results, observed data or decoration.
- **Don't** put the page on a dark ground; the laminate is the world. The ink fill is for the site footer and inverted controls.
- **Don't** add a second display typeface.
