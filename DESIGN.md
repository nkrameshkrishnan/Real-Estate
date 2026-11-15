---
name: Ontario Home Insight
description: A one-property due-diligence report drawn as a Canadian topographic map sheet.
colors:
  survey-magenta: "#b4237a"
  survey-magenta-deep: "#8f1a60"
  survey-magenta-wash: "#f6e3ee"
  sheet-ink: "#151a17"
  ink-secondary: "#48514c"
  ink-tertiary: "#6c746f"
  field-stroke: "#9aa29c"
  hairline-rule: "#cfd3cc"
  map-paper: "#fbfbf9"
  paper-tone-2: "#f0f1ed"
  paper-tone-3: "#e4e6e0"
  field-white: "#ffffff"
  contour-brown: "#9a6235"
  contour-faint: "#d9c2a6"
  water-blue: "#2c74b3"
  water-wash: "#dfeaf5"
  woodland-green: "#2f6b2c"
  woodland-wash: "#dfecd8"
  verdict-ok: "#2a659c"
  verdict-warn: "#8a5300"
  verdict-warn-wash: "#f6e8cf"
  verdict-bad: "#a8261c"
  verdict-bad-wash: "#f8e1de"
  verdict-unknown: "#5a625d"
  verdict-unknown-wash: "#e8eae5"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(2.25rem, 1.4rem + 3vw, 3.75rem)"
    fontWeight: 780
    lineHeight: 1.02
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 92"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 2vw, 2.75rem)"
    fontWeight: 780
    lineHeight: 1.15
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 92"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 750
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
    fontVariation: "'wdth' 85"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  map-lettering:
    fontFamily: "Archivo, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    fontVariation: "'wdth' 78"
rounded:
  sharp: "2px"
  none: "0"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "40px"
  hero: "56px"
components:
  button-primary:
    backgroundColor: "{colors.survey-magenta}"
    textColor: "{colors.field-white}"
    rounded: "{rounded.sharp}"
    padding: "9px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.survey-magenta-deep}"
    textColor: "{colors.field-white}"
  button-secondary:
    backgroundColor: "{colors.map-paper}"
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.sharp}"
    padding: "9px 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.paper-tone-2}"
  button-ghost:
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.sharp}"
    padding: "9px 16px"
  input:
    backgroundColor: "{colors.field-white}"
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.sharp}"
    padding: "9px 11px"
    height: "42px"
  search-field:
    backgroundColor: "{colors.field-white}"
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.sharp}"
    padding: "14px 16px"
    height: "56px"
  chip-recent:
    backgroundColor: "{colors.field-white}"
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.sharp}"
    padding: "5px 12px 5px 10px"
    height: "34px"
  verdict-good:
    backgroundColor: "{colors.woodland-wash}"
    textColor: "{colors.woodland-green}"
    rounded: "{rounded.sharp}"
    padding: "2px 7px"
  verdict-ok:
    backgroundColor: "{colors.water-wash}"
    textColor: "{colors.verdict-ok}"
    rounded: "{rounded.sharp}"
    padding: "2px 7px"
  verdict-warn:
    backgroundColor: "{colors.verdict-warn-wash}"
    textColor: "{colors.verdict-warn}"
    rounded: "{rounded.sharp}"
    padding: "2px 7px"
  verdict-bad:
    backgroundColor: "{colors.verdict-bad-wash}"
    textColor: "{colors.verdict-bad}"
    rounded: "{rounded.sharp}"
    padding: "2px 7px"
  verdict-unknown:
    backgroundColor: "{colors.verdict-unknown-wash}"
    textColor: "{colors.verdict-unknown}"
    rounded: "{rounded.sharp}"
    padding: "2px 7px"
  kpi-strip:
    backgroundColor: "{colors.paper-tone-2}"
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
  offer-target-cell:
    backgroundColor: "{colors.survey-magenta}"
    textColor: "{colors.field-white}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
---

# Design System: Ontario Home Insight

## Overview

**Creative North Star: "The Map Sheet for One Property"**

Every report is a Canadian NTS 1:50 000 topographic sheet drawn for a single address. The page is bright map paper; everything on it is linework and lettering in the inks a cartographer would use: black for the built world, contour brown for terrain and value, water blue for watercourses and flood information, woodland green for good news, and survey magenta for the one thing the sheet is about. The address is the sheet title, the latitude and longitude are its sheet coordinates, and the five checks are a legend whose symbols also mark the map.

Density is that of a working document, not a brochure. Sections are separated by heavy ink rules and paper tone steps, not cards or shadows. One grotesque, Archivo, carries every role, changing width rather than family: condensed for map lettering and figures, normal for reading. Every number is set in tabular figures so prices, distances and ratios align like a margin table.

The system refuses the category default for property tools: white cards with a brand-blue button and a coloured top border on each score tile.

**Key Characteristics:**
- Map-paper ground (#fbfbf9) with black ink linework; no cards, no drop shadows on content.
- Survey magenta marks only the subject property, the primary action and the target price.
- A double neat-line frame (2px outer, 1px inner at 6px inset) with coordinate ticks around map figures.
- One typeface (Archivo variable) using its width axis; tabular figures everywhere.
- One legend keys every symbol and status colour across map, scores and section headings.
- Near-square corners (2px) on controls; zero radius on frames, tables and dialogs.

## Colors

A restrained topographic ink set on near-white map paper, with a single loud survey colour.

### Primary
- **Survey Magenta** (`survey-magenta`): The subject property symbol (ring and dot on the map, the brand mark, the recent-address chip pip), the primary action button, the target-price cell and tick in the negotiation range, the focus outline, link underlines, text selection and caret. Hover and pressed states deepen to **Deep Survey Magenta** (`survey-magenta-deep`); **Magenta Wash** (`survey-magenta-wash`) is the 3px focus halo on fields only.

### Secondary
- **Contour Brown** (`contour-brown`): Terrain and value. Index contours, contour labels, the coordinate figures in the report header, the market legend symbol and the loading pulse. **Contour Faint** (`contour-faint`) draws the intermediate contours behind the landing title block.
- **Water Blue** (`water-blue`): Watercourses on the map and in the hazards symbol. **Water Wash** (`water-wash`) backs informational callouts and status messages.

### Tertiary
- **Woodland Green** (`woodland-green`) with **Woodland Wash** (`woodland-wash`): the "good" verdict and upward trends.

### Neutral
- **Sheet Ink** (`sheet-ink`): All text, neat-line frames, heavy section rules (2px), table header rules, transit and school symbols, power-line dashes, the rapid-transit route chip and the footer ground.
- **Ink Secondary** (`ink-secondary`): Supporting copy, ledes, captions, table headers, map key text.
- **Ink Tertiary** (`ink-tertiary`): Pending values while a check is loading; the scrollbar thumb.
- **Field Stroke** (`field-stroke`): Resting border of form fields.
- **Hairline Rule** (`hairline-rule`): 1px row dividers in tables, legend rows and hazard lists; chip borders.
- **Map Paper** (`map-paper`): The page and frame ground. **Paper Tone 2** (`paper-tone-2`) is the first tone step (hover rows, KPI strips, skeletons, the map tile backing); **Paper Tone 3** (`paper-tone-3`) is the deepest step.
- **Field White** (`field-white`): Inside inputs, chips and meters, so entry surfaces read slightly brighter than the paper.

### Status inks
The verdict scale reuses the map inks so a status colour never means two things: good = woodland green, ok = water-family blue (`verdict-ok`), warn = ochre (`verdict-warn`), bad = brick red (`verdict-bad`), unknown = grey-green (`verdict-unknown`). Each sits as dark text on its own pale wash.

### Named Rules
**The Survey Mark Rule.** Survey magenta is reserved for the subject property, the primary action and the target price (plus focus, selection and link underlines, which point at the same "here"). It never colours a status, a section, a chart series or decoration. If two magenta fills compete in one viewport, one of them is wrong.

**The One Legend Rule.** A colour or symbol means the same thing on the map, in the legend row and in the section heading. Introduce a new ink only together with its legend entry.

## Typography

**Display Font:** Archivo (variable, weight 400–800, width 62–125%, self-hosted, OFL) with system-ui fallback
**Body Font:** Archivo
**Label/Mono Font:** Archivo at condensed widths; a system monospace appears only inside inline `code`.

**Character:** One map-lettering grotesque doing every job, the way a single sans letters an entire topographic sheet. Hierarchy comes from weight and the width axis, never from a second family.

### Hierarchy
- **Display** (780, clamp 2.25–3.75rem, 1.02, wdth 92): The landing sheet name only ("Know the home before you offer."), max 13ch.
- **Headline** (780, clamp 1.75–2.75rem, 1.15, wdth 92): The report's address title.
- **Title** (700, 1.5rem, -0.02em): Section and legend headings, each led by its legend symbol. Hazard and sub-items step down to 1.0625rem.
- **Figure** (750, 1.625rem, line-height 1, wdth 85, tabular): Score values, KPI values, offer cells (1.375rem). Units sit in a 0.55em, 600-weight suffix.
- **Body** (400, 1rem, 1.5): Reading text, kept to 54–62ch for ledes and section intros.
- **Label** (600, 0.875rem): Form labels, offer-cell keys, scale-bar ticks; table headers at 0.8125rem / 650 / wdth 88.
- **Map lettering** (600, 10.5–11px, wdth 78–85): Coordinate ticks, scale line and contour labels, haloed in paper so they read over tiles.

### Named Rules
**The Tabular Figures Rule.** `font-variant-numeric: tabular-nums` is set at the root; never switch it off. Prices, distances, ratios and coordinates must align in columns.

**The Width-Not-Family Rule.** For a denser or more technical register, narrow Archivo (`'wdth' 78–92`) instead of reaching for another typeface.

## Layout

A centred sheet of max 1200px with 24px gutters (16px under 520px). The landing is a title block: a 7:5 grid of copy and a framed contour field. Once a report opens, the title block condenses to a single search strip so the sheet owns the first screen.

The report is a vertical stack at 40px gaps (32px on phones): header strip (address, municipality, coordinates, actions) closed by a 2px ink rule; then the sheet, a 1.55:1 grid with the framed map left and the legend right (min 320px); then the listing form and the five sections, each opened by a 2px ink rule and 18px of space.

Spacing rhythm runs on 4px steps with recurring values of 4, 8, 12–16, 24, 32, 40 and 56px. Forms are four columns, two below 1000px. Hazards are two columns, one below 1000px.

Breakpoints: at 1000px the sheet stacks with the legend moved above the map, the map drops to 380px and the section nav hides; at 760px the hero stacks and the offer table becomes 2x2; at 520px gutters tighten, the search field stacks over a full-width button and the map drops to 300px. Print keeps the map and legend side by side and hides all controls.

## Elevation & Depth

Flat. Depth is expressed the way a printed map expresses it: by linework weight (2px neat lines and section rules over 1px hairlines) and by paper tone steps (map paper, tone 2, tone 3). Content never casts a shadow. Inset 1px box-shadows are used only as hairline dividers between cells, not as elevation.

### Shadow Vocabulary
- **Dialog lift** (`box-shadow: 0 18px 40px -12px rgba(21,26,23,.35)` over a 45% ink backdrop): The settings dialog only, the one layer that genuinely floats above the sheet.

### Named Rules
**The Linework-Not-Lift Rule.** Separate regions with an ink rule or a tone step. A drop shadow is permitted only on a true modal overlay.

## Shapes

Near-square. Interactive controls, chips, verdict tags and focus rings use a 2px corner, just enough to soften a pixel edge; frames, tables, KPI strips, the offer table and dialogs are square. Round forms appear only as map symbols (the property ring, rapid-transit stations, the dashed 500m radius, the chip pip).

The signature form is the **neat line**: a 2px ink border with a 1px inner border at 6px inset, wrapping the map and the landing contour field, with coordinate ticks drawn on the margin and labelled in map lettering.

## Components

### Buttons
Plain, inked and decisive, like a stamped field on a form.
- **Shape:** near-square (2px), 1.5px border, min height 40px (56px in the landing search, 48px once condensed).
- **Primary:** survey magenta fill and border, white 600-weight label. One per region.
- **Secondary:** paper fill with a 1.5px ink border; hovers to tone 2.
- **Ghost / Quiet:** no border or fill; quiet uses 500 weight and secondary ink for chrome like "Data sources".
- **Hover / Focus:** colour shifts at 160ms; a 1% scale on hover, 99% on press, removed under reduced motion. Focus is a 2px magenta outline at 2px offset.
- **Text links and link-buttons:** ink text with a 1.5px magenta underline at 3px offset; hover turns the text deep magenta.

### Chips
- **Recent address:** white fill, 1px hairline border, 2px corners, a small magenta survey ring before the label; border inks on hover.
- **Route tags:** tone-2 fill, condensed 600 text; rapid routes invert to ink fill with white text.

### Cards / Containers
There are no cards. Sections are open regions under a 2px ink top rule. KPI strips are a single tone-2 band divided by 1px paper hairlines. The offer table is a 2px ink-framed row of four cells with ink hairline dividers and the target cell filled in survey magenta.

### Inputs / Fields
- **Style:** white fill, 1.5px field-stroke border, 2px corners, min 42px, magenta caret.
- **Focus:** border turns survey magenta with a 3px magenta-wash halo. The landing search field uses a 2px ink border and no halo.
- **Labels:** always visible above the field, 0.875rem/600.

### Navigation
A sticky 60px top bar on map paper closed by a 2px ink rule: brand mark (the property symbol) and name left, section links in compact-width secondary ink right (hover to ink on tone 2), then "Data sources". Section links hide below 1000px.

### Legend (signature)
The score summary is a map legend: a 2px ink top rule, then rows with a 34x20 symbol, the check name (650), a right-aligned figure value, and below it a verdict tag and a one-line reason, divided by hairlines. Hovering or focusing a row underlines its name in magenta, scales its symbol 12% and fades every other map layer to 12% opacity. Rows settle in (opacity and 4px rise, 240ms) as each check resolves; pending values show a contour-brown pulse bar.

### Scale-bar range (signature)
The negotiation range is drawn as a map scale bar: a 12px white bar with a 1.5px ink outline, the opening-to-walk-away run filled in ink, a 2px magenta tick at the target, and condensed tick labels below.

### Map
Leaflet tiles are desaturated (`saturate(.35)`) so the inks on top dominate. The property is a magenta ring and dot inside a dashed magenta 500m radius; rapid transit is white circles with ink strokes; schools are small ink squares; power lines are dashed ink; watercourses are water blue. Zoom controls are square. The scale line uses an ink bracket and map lettering.

### Contour field
Behind the landing title block, contours draw in once (1400ms, staggered) inside a neat-line frame with margin ticks, then the magenta property pin appears. This is the only decorative motion in the system.

## Do's and Don'ts

### Do:
- **Do** frame every map figure in the neat line (2px ink outer, 1px inner at 6px inset) with coordinate ticks in map lettering.
- **Do** open each report section with a 2px ink rule and its legend symbol beside the title.
- **Do** key every new status or layer to the legend: same symbol and ink on the map, the legend row and the section heading.
- **Do** set every number in tabular Archivo; narrow the width axis for figures and map lettering.
- **Do** separate regions with linework and paper tone steps (map paper, tone 2, tone 3).
- **Do** keep motion to state: 160ms colour shifts, 240ms settles, the one-time contour draw, all collapsed under reduced motion.
- **Do** show unknown as its own grey verdict rather than leaving a gap.

### Don't:
- **Don't** use survey magenta for anything other than the subject property, the primary action, the target price and focus or link marks.
- **Don't** put content in white cards with drop shadows or coloured top borders; the only shadow belongs to the modal dialog.
- **Don't** introduce a second typeface or an icon font; symbols are inline SVG map symbols from the shared set.
- **Don't** round frames, tables or panels; controls stay at 2px.
- **Don't** use a verdict ink outside a verdict tag, badge or trend mark; status colours are not section or chart colours.
