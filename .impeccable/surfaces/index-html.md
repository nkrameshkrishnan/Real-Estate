---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Report app (index.html)

Scope: the whole single-page app: search, report header, map, listing form, score summary, five report sections, settings dialog. Visitor mode: Operate.

Audience and job: Ontario home buyers checking one property before a viewing or offer, at a desk (comparing several listings) and on a phone (at viewings). Task: enter an address or listing, read the five scores, fill gaps (listing details, comps, Fraser ratings), then print or share.

Constraints: static HTML/CSS/ES modules, no build step, Leaflet map, all existing JS behaviour, ids and data flow preserved. CREA trademark notices and DDF display rules stay. Prints cleanly.

## Direction contract

THESIS: The report is a map sheet for one property. Refuses the category default of white cards with a brand-blue button and coloured top-borders on score tiles.

OWN-WORLD: Canadian NTS 1:50 000 topographic sheet. Bright map-paper white ground, black ink, contour brown, water blue, woodland green, survey magenta for the subject property and primary action. Thin neat-line frame with UTM-style coordinate ticks at the margins of the map and the report header. Sections are separated by tone steps and grid, not shadows. One grotesque throughout (map-lettering sans), tabular figures for every number.

STORY: The buyer sees where the home is, reads five verdicts as a legend keyed to the map, and goes straight to what needs checking.

FIRST VIEWPORT: Landing: the search is the title block of a map sheet: sheet name "Ontario Home Insight", one large address field, primary action in survey magenta, example link and recent addresses below, a faint contour field behind on the right half. Report: header strip with address, municipality and lat/long as sheet coordinates; left 60% the map in a neat-line frame with tick marks; right 40% the legend: five scores as legend rows (symbol swatch, verdict, value). Listing form below.

FORM: Grounded candidate 1 of 7 (topographic map), chosen by the user as the pick over assigned candidate 4 (utility locate marks). seed:8664b5b5f82c11a0. Raise from the orienteering challenger: one legend keys every symbol and status colour across map, scores and sections. Raise from the design-annual challenger: one typeface, one grid, no ornaments outside the map system. Signature move: the legend. Each score is a legend entry whose symbol also marks the map; hovering or focusing a legend row highlights its layer on the map. Motion: contour lines draw in behind the title block once on first load; legend rows settle in as each check resolves (state, 180 ms); nothing else moves.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
