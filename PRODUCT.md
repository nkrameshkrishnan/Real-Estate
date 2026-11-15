# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Home buyers anywhere in Ontario, Canada (a public tool, not tied to one agent or brokerage). They are checking a specific house or condo before booking a viewing or making an offer. They use it equally at a desk (researching and comparing several listings, usually in the evening) and on a phone (at open houses and viewings, in the car between them).

## Product Purpose
Turn one Ontario address, REALTOR.ca listing link, MLS® number or pasted listing page into a single due-diligence report: transit availability, neighbourhood safety, nearby schools with Fraser Institute ratings, market value and a negotiation range, and property and environmental hazards. Success: the buyer knows what to ask, what to inspect and what to offer before they commit.

## Positioning
Free, static and private: everything runs in the buyer's browser from open public data, nothing is tracked, and entered details stay in localStorage. It pulls Ontario-specific sources together in one place (conservation-authority flood layers, Health Canada radon survey, Ontario school list, Fraser report cards, TRREB Market Watch) instead of sending the buyer to a dozen sites.

## Operating Context
- Input: a street address, a REALTOR.ca URL, an MLS® number (via an optional DDF® proxy), or the whole text of a REALTOR.ca listing page pasted in.
- Output: a printable, shareable report (copy link, print to PDF) with a map, a summary row of five scores, an editable listing-details form, and five detailed sections.
- Buyers fill gaps themselves: comps from their agent, Fraser ratings, year built or age range from the listing.

## Capabilities and Constraints
- Static site on GitHub Pages; plain HTML, CSS and ES modules, no build step, no backend. Leaflet map from unpkg.
- Data: OpenStreetMap (Nominatim, Overpass), Toronto Police open data (safety is Toronto-only for now), Ontario publicly funded schools list, Fraser Institute 2025 report cards (`data/fraser.json`), TRREB Market Watch (`data/market.json`), conservation-authority flood layers, Health Canada radon survey, age-based building-risk rules.
- REALTOR.ca has no public API and is never scraped; sold prices are not open data in Ontario.
- Must follow CREA DDF® display rules and trademark notices (MLS®, REALTOR®).

## Brand Commitments
- Name: Ontario Home Insight.
- Voice: plain, factual, cautious about certainty; always points to the professional who can confirm (home inspector, school board, conservation authority, REALTOR®).

## Evidence on Hand
- Real open datasets in `data/` (schools, Fraser ratings, market figures).
- No testimonials, users, press or partners. None may be invented.

## Product Principles
1. Every score shows where it came from and how sure it is.
2. Say what to do next: who to call, what to test, what to ask the seller.
3. The buyer's data stays with the buyer.
4. Works as well on a phone at a viewing as on a laptop at home.
5. Unknown is shown as unknown, never guessed silently.

## Accessibility & Inclusion
No product-specific standard was set; the general WCAG AA floor applies. The report must print cleanly.
