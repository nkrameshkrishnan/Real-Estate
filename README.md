# Ontario Home Insight

A static web app (GitHub Pages, no backend) that builds a due-diligence report for an Ontario home or condo from an **address**, a **REALTOR.ca (MLS®) listing link**, or an **MLS® number** (with a DDF® proxy).

| Section | What it shows | Source |
|---|---|---|
| Transit score (0–100) | Rapid-transit distance, routes and stops nearby | OpenStreetMap via Overpass API |
| Neighbourhood safety index (0–100) | Incidents within 500 m in the last 12 months vs. the city-wide average, by category | Toronto Police Service open data (Toronto only for now) |
| Schools + Fraser ratings | Elementary/secondary schools within 3 km, with board, grades, language, catchment links, and Fraser rating, rank, 5-year average and trend | OSM + Ontario *Publicly Funded Schools* list (OGL-Ontario) + Fraser Institute Report Cards 2025 (`data/fraser.json`) |
| Market value & negotiation | Board average by type, comps-based value, opening/target/walk-away offer | `data/market.json` (TRREB Market Watch) + comps you paste in |
| Hazards | Flood/erosion regulated area, overhead power lines, radon, asbestos, lead paint, wiring, plumbing, vegetation clearance, gutters & downspouts | TRCA / LSRCA / Kawartha / Otonabee CA layers, OSM, Health Canada radon survey, age-based rules |

All data is fetched in the browser from CORS-enabled public APIs. Listing details, comps and Fraser ratings you enter stay in `localStorage`.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
(ES modules need to be served over HTTP; opening `index.html` as a file won't work.)

## Deploy to GitHub Pages
1. Create a repo and push this folder to `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. The `Deploy to GitHub Pages` workflow publishes on every push. `Refresh Ontario school list` updates `data/schools-on.json` monthly.

## Listing details
Paste the whole REALTOR.ca listing page (select all → copy) into **"Or paste a whole REALTOR.ca listing page"** (home page) or **"Fill from a REALTOR.ca listing page"** (listing card). The parser in `js/mls.js` reads price, MLS® number, building type/title (condo detection), square-footage range (midpoint), bedrooms, taxes, maintenance fee, days on REALTOR.ca and brokerage. Nothing is fetched from REALTOR.ca by the site. Addresses in MLS® format (`207 - 4101 SHEPPARD AVENUE E Toronto (Agincourt South-Malvern West), Ontario M1S3H3`) are cleaned before geocoding, and a unit number sets the type to condo apartment.

## Fraser ratings
`data/fraser.json` holds the 2025 Ontario elementary (3,051 of 3,052) and secondary (747) ratings from the Fraser Institute's published Report Card PDFs. compareschoolrankings.org has no public API (its internal API encrypts responses), so the data comes from the PDFs: run `scripts/extract_fraser.js` in the browser console on fraserinstitute.org (it downloads `fraser.tsv`), then `python3 scripts/build_fraser.py fraser.tsv data/fraser.json`. Update the PDF paths in the script for each new edition. Ratings © Fraser Institute; shown with attribution and links to compareschoolrankings.org.

## MLS® data — what's possible
- **REALTOR.ca has no public API**, and scraping it breaches its terms of use. The app accepts a pasted REALTOR.ca listing URL, takes the address from the URL and links back to the listing.
- **CREA DDF® Web API** (`ddfapi.realtor.ca`) gives active listings, but only with data-feed credentials created by a REALTOR® (CREA member) or their authorized technology provider. CREA requires server-to-server token requests, so `proxy/ddf-worker.js` (Cloudflare Worker) holds the credentials and the site calls the worker. Add the worker URL under ⚙ in the app. Follow the DDF® display rules: show the brokerage, link back to REALTOR.ca, keep data current.
- **Sold prices** are not in DDF® and are not open data in Ontario. Paste comps from your agent or a sold-data service into the Market section.

## Extending
- **Safety in other cities:** add an adapter object to `ADAPTERS` in `js/safety.js` (`covers(loc)` + `run(loc)`), e.g. for Peel, York, Ottawa or Hamilton police open data.
- **Flood layers:** add conservation-authority FeatureServer URLs (with a bbox) to `FLOOD_LAYERS` in `js/hazards.js`.
- **Market data:** update `data/market.json` monthly, or add district-level figures from TRREB Community Market Reports.
- **Fraser ratings:** add entries to `data/fraser.json` (`name`, `city`, `level`, `rating`, `rank`).
- Ideas: GTFS frequency for transit, land transfer tax calculator, Toronto street-tree data, noise (airport/rail/highway) exposure.

## Limits
This report is informational. It is not a home inspection, appraisal, or legal/financial advice. OSM coverage varies (pole-mounted distribution lines and trees are often unmapped). The safety index counts incidents per area, not per resident, so busy commercial areas score lower. The radon data is regional, so only a long-term test tells you the level in a specific home.

MLS®, Multiple Listing Service® and REALTOR® are trademarks controlled by The Canadian Real Estate Association (CREA).
