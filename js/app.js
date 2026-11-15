import { $, esc, fmtMoney, fmtDist, badge, store } from './util.js';
import { resolveLocation } from './geocode.js';
import { fetchTransitSchools, fetchHazardsOSM } from './overpass.js';
import { scoreTransit } from './transit.js';
import { safetyFor } from './safety.js';
import { schoolsNear, fraserKey, boardLocator } from './schools.js';
import { floodCheck, powerLineCheck, radonCheck, ageRisks, vegetationCheck, guttersCheck } from './hazards.js';
import { loadMarket, negotiate, getComps, setComps, parseCompsCsv, TYPE_LABEL } from './market.js';
import { settings, fetchDDF, getListing, saveListing, parseListingText } from './mls.js';

const state = { loc: null, osm: null, hz: null, map: null, layers: null, results: {} };
const MLS_RE = /^[A-Z]?\d{7,9}$/i;
const EXAMPLE = '25 The Esplanade, Toronto';

// ---------- status ----------
function status(msg, isErr = false) {
  $('#status').innerHTML = msg ? `<div class="msg ${isErr ? 'err' : ''}">${esc(msg)}</div>` : '';
}

// ---------- recent searches ----------
function renderRecent() {
  const rec = store.get('recent', []);
  $('#recent').innerHTML = rec.map(r => `<button type="button" class="chip" data-q="${esc(r)}">${esc(r.length > 48 ? r.slice(0, 46) + '…' : r)}</button>`).join('');
}
function pushRecent(q) {
  const rec = [q, ...store.get('recent', []).filter(r => r !== q)].slice(0, 6);
  store.set('recent', rec); renderRecent();
}

// ---------- map ----------
function initMap(loc) {
  if (!window.L) return;
  if (!state.map) {
    state.map = L.map('map', { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(state.map);
  }
  state.layers?.remove();
  state.sub = {};
  state.layers = L.layerGroup().addTo(state.map);
  L.circle([loc.lat, loc.lon], { radius: 500, color: '#1f5f8b', weight: 1, fillOpacity: 0.04 }).addTo(state.layers);
  L.circleMarker([loc.lat, loc.lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#b3261e', fillOpacity: 1 }).bindPopup(esc(loc.display)).addTo(state.layers);
  state.map.setView([loc.lat, loc.lon], 15);
  setTimeout(() => state.map.invalidateSize(), 50);
}
// Named sub-layers so re-renders replace (not duplicate) markers
function mapAdd(name, fn) {
  if (!state.layers || !window.L) return;
  state.sub ||= {};
  if (state.sub[name]) state.layers.removeLayer(state.sub[name]);
  state.sub[name] = L.layerGroup().addTo(state.layers);
  fn(state.sub[name]);
}

// ---------- score tiles ----------
const tiles = {};
function tile(key, label, value, sub, level, href) {
  tiles[key] = `<a class="score ${level}" href="#${href}"><div class="k">${esc(label)}</div><div class="v">${value}</div><div class="s">${sub}</div></a>`;
  $('#scores').innerHTML = ['transit', 'safety', 'schools', 'market', 'hazards'].map(k => tiles[k] || `<div class="score unknown"><div class="k">${k[0].toUpperCase() + k.slice(1)}</div><div class="v">…</div><div class="s muted">Loading</div></div>`).join('');
}

function section(id, html) { $(`#${id} .body`).innerHTML = html; }
function sectionError(id, e, retry) {
  section(id, `<p>${badge('unknown', 'Unavailable')} ${esc(e.message || e)}</p><p class="small muted">The free OpenStreetMap servers are sometimes overloaded. Results are cached for 14 days once they load.</p>${retry ? '<button class="btn" type="button" data-retry>Retry</button>' : ''}`);
  const b = document.querySelector(`#${id} [data-retry]`);
  if (b && retry) b.onclick = () => { section(id, '<div class="skeleton"></div>'); retry(); };
}

// ---------- TRANSIT ----------
function renderTransit(t) {
  tile('transit', 'Transit score', `${t.score}<small>/100</small>`, esc(t.label), t.level, 'transit');
  const rapid = t.rapid.length ? `<table><thead><tr><th>Rapid transit station</th><th>Mode</th><th class="num">Distance</th><th class="num">Walk</th></tr></thead><tbody>${t.rapid.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.mode.replace('_', ' '))}</td><td class="num">${fmtDist(s.d)}</td><td class="num">${Math.round(s.d * 1.3 / 80)} min</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No subway, GO/rail or LRT station within 1.5 km.</p>';
  const routes = t.routes.slice(0, 40).map(r => `<span class="route ${['subway', 'train', 'light_rail'].includes(r.mode) ? 'rapid' : ''}" title="${esc(r.name)}">${esc(r.ref || r.name)}${r.mode !== 'bus' ? ` · ${esc(r.mode.replace('_', ' '))}` : ''}</span>`).join('');
  section('transit', `
    <div class="kpis">
      <div class="kpi"><div class="v">${t.score}/100</div><div class="k">${esc(t.label)}</div><div class="meter"><i style="width:${t.score}%"></i></div></div>
      <div class="kpi"><div class="v">${t.nearestRapid ? fmtDist(t.nearestRapid.d) : '—'}</div><div class="k">to nearest rapid transit</div></div>
      <div class="kpi"><div class="v">${t.routes.length}</div><div class="k">routes stop within 500 m</div></div>
      <div class="kpi"><div class="v">${t.busStops400 + t.tramStops400}</div><div class="k">stops within 400 m</div></div>
    </div>
    ${rapid}
    ${routes ? `<h4 class="small" style="margin-top:12px">Routes serving stops within 500 m</h4><div class="routes">${routes}</div>` : ''}
    <p class="sub">Score = rapid-transit proximity (max 40) + number of routes (30) + nearby stops (20) + terminals/multiple stations (10), from OpenStreetMap data. Frequency/schedules are not included yet (next step: GTFS feeds from TTC, GO, YRT, MiWay, Brampton Transit).</p>`);
  mapAdd('transit', g => t.rapid.forEach(s => L.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#6a3fa0', fillOpacity: 1 }).bindPopup(`${esc(s.name)} (${esc(s.mode)}) — ${fmtDist(s.d)}`).addTo(g)));
}

// ---------- SAFETY ----------
function renderSafety(s, loc) {
  if (!s.supported) {
    tile('safety', 'Safety index', '—', 'Not yet available here', 'unknown', 'safety');
    section('safety', `<p>${badge('unknown', 'Not covered yet')} The safety index is currently computed from Toronto Police Service open data. ${esc(loc.municipality || 'This area')} isn’t covered yet.</p>
      ${s.links.length ? `<p>Check: ${s.links.map(l => `<a href="${l.url}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(' · ')}</p>` : '<p class="small">Check your local police service’s crime map or open-data portal.</p>'}
      <p class="sub">Adding a region means writing one adapter in <code>js/safety.js</code> for that police service’s open-data API.</p>`);
    return;
  }
  tile('safety', 'Safety index', `${s.index}<small>/100</small>`, esc(s.label), s.level, 'safety');
  section('safety', `
    <div class="kpis">
      <div class="kpi"><div class="v">${s.index}/100</div><div class="k">${esc(s.label)}</div><div class="meter"><i style="width:${s.index}%"></i></div></div>
      <div class="kpi"><div class="v">${s.ratio.toFixed(2)}×</div><div class="k">city-average incident density</div></div>
      <div class="kpi"><div class="v">${s.totalLocal}</div><div class="k">incidents within ${s.radius} m, last 12 months</div></div>
      ${s.neighbourhood ? `<div class="kpi"><div class="v" style="font-size:1rem">${esc(s.neighbourhood)}</div><div class="k">TPS neighbourhood</div></div>` : ''}
    </div>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Within ${s.radius} m</th><th class="num">City-average equivalent</th><th class="num">Ratio</th></tr></thead>
    <tbody>${s.rows.map(r => `<tr><td>${esc(r.cat)}</td><td class="num">${r.local}</td><td class="num">${r.expected.toFixed(1)}</td><td class="num">${badge(r.ratio < 0.8 ? 'good' : r.ratio < 1.25 ? 'ok' : r.ratio < 2 ? 'warn' : 'bad', r.ratio.toFixed(2) + '×')}</td></tr>`).join('')}</tbody></table></div>
    <p class="sub">${esc(s.method)} Source: <a href="${s.source.url}" target="_blank" rel="noopener">${esc(s.source.name)}</a>. Locations are offset to the nearest intersection by TPS for privacy.</p>`);
}

// ---------- SCHOOLS ----------
function schoolRow(s) {
  const f = s.fraser;
  const loc = boardLocator(s.board);
  const fraserCell = f
    ? `<strong>${esc(Number(f.rating).toFixed(1))}</strong>/10${f.trend ? `<span class="trend ${f.trend}" title="5-year trend">${f.trend === 'up' ? '▲' : '▼'}</span>` : ''}${f.rank ? `<div class="sub">Rank ${esc(f.rank)}</div>` : ''}${f.rating5 != null && f.rating5 !== '' ? `<div class="sub">5-yr avg ${esc(Number(f.rating5).toFixed(1))}</div>` : ''}<div class="sub">${f.source === 'you' ? 'entered by you' : f.source === 'fraser' ? 'Fraser 2025' : 'from data file'}</div>`
    : `<span class="sub">${s.isPrivate ? 'Not ranked' : 'Not in Fraser report'}</span>`;
  return `<tr>
    <td><strong>${esc(s.name)}</strong>
      <div class="sub">${[s.type, s.board, s.lang && s.lang !== 'English' ? s.lang : '', s.grades && `Gr ${s.grades}`, s.special].filter(Boolean).map(esc).join(' · ') || (s.isPrivate ? 'Private / independent' : 'Not matched to provincial list (may be private)')}</div>
      <div class="sub">${s.website ? `<a href="${esc(s.website)}" target="_blank" rel="noopener">Website</a> · ` : ''}${loc ? `<a href="${loc.url}" target="_blank" rel="noopener">Check catchment</a> · ` : s.boardWebsite ? `<a href="${esc(s.boardWebsite)}" target="_blank" rel="noopener">Board site (boundaries)</a> · ` : ''}<a href="https://www.compareschoolrankings.org/" target="_blank" rel="noopener" title="Search “${esc(s.name)}” on compareschoolrankings.org">Fraser details</a></div>
    </td>
    <td class="num">${fmtDist(s.d)}</td>
    <td class="num">${fraserCell}
      <form class="inline-form fraser-form" ${f && f.source !== 'you' ? 'hidden' : ''} data-key="${esc(fraserKey(s.name, s.city))}"><input name="rating" inputmode="decimal" placeholder="Rating" value="${f?.source === 'you' ? esc(f.rating) : ''}" aria-label="Fraser rating for ${esc(s.name)}"><input name="rank" placeholder="Rank e.g. 120/3052" value="${f?.source === 'you' ? esc(f.rank || '') : ''}" aria-label="Fraser rank"><button class="linkbtn">Save</button></form>
    </td></tr>`;
}

function renderSchools(r) {
  const all = [...r.elementary, ...r.secondary];
  const rated = all.filter(s => s.fraser?.rating);
  const best = rated.sort((a, b) => b.fraser.rating - a.fraser.rating)[0];
  tile('schools', 'Schools', `${r.elementary.length + r.secondary.length}`, best ? `Top Fraser: ${Number(best.fraser.rating).toFixed(1)} (${esc(best.name)})` : `${r.elementary.length} elementary · ${r.secondary.length} secondary within 3 km`, rated.length ? (best.fraser.rating >= 7 ? 'good' : best.fraser.rating >= 5.5 ? 'ok' : 'warn') : 'unknown', 'schools');
  const table = (title, rows) => rows.length ? `<h4 style="margin-top:14px">${title}</h4><div class="table-wrap"><table><thead><tr><th>School</th><th class="num">Distance</th><th class="num">Fraser rating</th></tr></thead><tbody>${rows.map(schoolRow).join('')}</tbody></table></div>` : '';
  section('schools', `
    <div class="callout"><strong>Nearest is not always designated.</strong> Attendance boundaries are set by each board (public, Catholic, French-language). Confirm with the board’s address lookup${r.elementary.some(s => /toronto dsb/i.test(s.board)) ? ' — e.g. <a href="https://www.tdsb.on.ca/Find-your/School/By-Home-Address" target="_blank" rel="noopener">TDSB Find your school</a>' : ''} or the <a href="https://www.ontario.ca/page/find-your-school" target="_blank" rel="noopener">Ontario school information finder</a>.</div>
    ${table('Elementary', r.elementary)}${table('Secondary', r.secondary)}${table('Other / unclassified', r.other)}
    ${!all.length && !r.other.length ? '<p class="muted">No schools mapped within 3 km.</p>' : ''}
    <p class="sub">Fraser ratings (0–10, rank, 5-year average and trend ▲▼): ${r.fraserMeta?.source ? `<a href="${esc(r.fraserMeta.elementaryUrl)}" target="_blank" rel="noopener">${esc(r.fraserMeta.source)}</a>` : 'Fraser Institute'} — see full school profiles on <a href="https://www.compareschoolrankings.org/" target="_blank" rel="noopener">compareschoolrankings.org</a>. Schools without a Grade 3/6 (elementary) or Grade 9/OSSLT (secondary) EQAO result, and most private schools, aren’t ranked. School list: ${esc(r.meta?.source || '')} (${esc(r.meta?.licence || '')}).</p>`);
  $$fraser();
  mapAdd('schools', g => all.concat(r.other).forEach(s => L.circleMarker([s.lat, s.lon], { radius: 6, color: '#fff', weight: 1.5, fillColor: '#2f6f9f', fillOpacity: 1 }).bindPopup(`<strong>${esc(s.name)}</strong><br>${esc(s.level)} · ${fmtDist(s.d)}${s.fraser ? `<br>Fraser ${esc(s.fraser.rating)}/10` : ''}`).addTo(g)));
}
function $$fraser() {
  document.querySelectorAll('.fraser-form').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const rating = parseFloat(f.rating.value);
    if (isNaN(rating)) store.set(f.dataset.key, null);
    else store.set(f.dataset.key, { rating: Math.max(0, Math.min(10, rating)), rank: f.rank.value.trim() });
    runSchools();
  }));
}

// ---------- MARKET ----------
function listingFromForm() {
  const f = $('#listingForm');
  const num = n => { const v = Number(String(f[n].value).replace(/[$,\s]/g, '')); return f[n].value.trim() === '' || isNaN(v) ? null : v; };
  return { mls: f.mls.value.trim(), listPrice: num('listPrice'), type: f.type.value, yearBuilt: num('yearBuilt'), sqft: num('sqft'), dom: num('dom'), reductions: num('reductions'), beds: num('beds'), taxes: num('taxes'), fee: num('fee') };
}
function fillForm(l) {
  const f = $('#listingForm');
  for (const k of ['mls', 'listPrice', 'type', 'yearBuilt', 'sqft', 'dom', 'reductions', 'beds', 'taxes', 'fee']) if (f[k] && l[k] != null) f[k].value = l[k];
}

async function renderMarket() {
  const loc = state.loc, l = listingFromForm();
  let market;
  try { market = await loadMarket(); } catch { market = null; }
  const comps = getComps(loc);
  const cond = store.get('marketCondition', '');
  const n = negotiate({ ...l, condition: cond || undefined, comps, market });
  const typeAvg = market?.averagePrice?.[l.type];
  if (isFinite(n.fair)) tile('market', 'Comps-based value', fmtMoney(n.fair), `Target offer ${fmtMoney(n.target)} · ${esc(n.confidence)} confidence`, n.confidence === 'high' ? 'good' : n.confidence === 'medium' ? 'ok' : 'unknown', 'market');
  else if (isFinite(n.target)) tile('market', 'Target offer', fmtMoney(n.target), `List ${fmtMoney(l.listPrice)} · add comps for a value estimate`, 'unknown', 'market');
  else tile('market', 'Market value', '—', 'Paste the listing to get started', 'unknown', 'market');
  section('market', `
    <div class="kpis">
      <div class="kpi"><div class="v">${fmtMoney(typeAvg)}</div><div class="k">${esc(market?.area || 'Board')} avg. ${esc(TYPE_LABEL[l.type] || '')} · ${esc(market?.period || '')}</div></div>
      ${l.type === 'condoApt' && market?.condoApt416 ? `<div class="kpi"><div class="v">${fmtMoney(/toronto/i.test(loc.municipality) ? market.condoApt416 : market.condoApt905)}</div><div class="k">avg. condo apt (${/toronto/i.test(loc.municipality) ? '416' : '905'})</div></div>` : ''}
      <div class="kpi"><div class="v">${l.listPrice ? fmtMoney(l.listPrice) : '—'}</div><div class="k">list price</div></div>
      ${isFinite(n.low) ? `<div class="kpi"><div class="v">${fmtMoney(n.low)} – ${fmtMoney(n.high)}</div><div class="k">comps range (25th–75th pct.)</div></div>` : ''}
      ${l.fee ? `<div class="kpi"><div class="v">${fmtMoney(l.fee)}</div><div class="k">condo fee / month${l.sqft ? ` ($${(l.fee / l.sqft).toFixed(2)}/sq ft)` : ''}</div></div>` : ''}
      ${l.taxes ? `<div class="kpi"><div class="v">${fmtMoney(l.taxes)}</div><div class="k">annual property taxes</div></div>` : ''}
    </div>
    <div class="offer">
      <div><div class="k">Opening offer</div><div class="v">${fmtMoney(n.opening)}</div></div>
      <div class="target"><div class="k">Target price</div><div class="v">${fmtMoney(n.target)}</div></div>
      <div><div class="k">Walk-away max</div><div class="v">${fmtMoney(n.walkAway)}</div></div>
      <div><div class="k">Comps-based value</div><div class="v">${fmtMoney(n.fair)}</div></div>
    </div>
    <p class="sub">Basis: ${esc(n.basis || 'enter a list price and comparable sales')}. Market condition:
      <select id="condSel" aria-label="Market condition" style="width:auto;padding:2px 6px">${['buyers', 'balanced', 'sellers'].map(c => `<option value="${c}" ${n.condition === c ? 'selected' : ''}>${c === 'buyers' ? "Buyer's" : c === 'sellers' ? "Seller's" : 'Balanced'}</option>`).join('')}</select></p>
    <ul class="small">${n.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h4 style="margin-top:14px">Comparable sales (${comps.length})</h4>
    ${comps.length ? `<div class="table-wrap"><table><thead><tr><th>Address</th><th class="num">Sold</th><th class="num">Sq ft</th><th class="num">$/sq ft</th><th>Date</th><th></th></tr></thead><tbody>${comps.map((c, i) => `<tr><td>${esc(c.address)}</td><td class="num">${fmtMoney(c.price)}</td><td class="num">${c.sqft || '—'}</td><td class="num">${c.sqft ? '$' + Math.round(c.price / c.sqft) : '—'}</td><td>${esc(c.date || '')}</td><td><button class="linkbtn" data-del="${i}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    <label class="small muted" for="compsIn">Paste sold comps — one per line: <code>address, sold price, sq ft, sold date</code> (from your agent or a sold-data site; tab-separated also works)</label>
    <textarea id="compsIn" placeholder="12 Example St, 1185000, 1500, 2026-09-14&#10;40 Sample Ave, 1240000, 1620, 2026-10-02"></textarea>
    <div class="form-actions"><button class="btn" id="addComps" type="button">Add comps</button>${comps.length ? '<button class="btn ghost" id="clearComps" type="button">Clear all</button>' : ''}<a class="btn ghost" href="${esc(market?.communityReports || 'https://trreb.ca/')}" target="_blank" rel="noopener">TRREB community reports</a></div>
    <p class="sub">Sold prices aren’t open data in Ontario, and REALTOR.ca DDF® carries active listings only — comps must come from your REALTOR® or a sold-data service. Board averages: <a href="${esc(market?.url || '#')}" target="_blank" rel="noopener">${esc(market?.source || '')}</a>. Estimates only — not an appraisal or advice.</p>`);
  $('#condSel').onchange = e => { store.set('marketCondition', e.target.value); renderMarket(); };
  $('#addComps').onclick = () => { const add = parseCompsCsv($('#compsIn').value); if (!add.length) return alert('No rows with a sold price found.'); setComps(loc, [...comps, ...add]); renderMarket(); };
  const clr = $('#clearComps'); if (clr) clr.onclick = () => { setComps(loc, []); renderMarket(); };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { comps.splice(+b.dataset.del, 1); setComps(loc, comps); renderMarket(); });
}

// ---------- HAZARDS ----------
function hazardCard(title, level, label, body) {
  return `<div class="hazard"><div class="hazard-head"><h4>${esc(title)}</h4>${badge(level, label)}</div>${body}</div>`;
}
async function renderHazards() {
  const loc = state.loc, osm = state.hz, l = listingFromForm();
  const isCondo = /^condo/.test(l.type);
  const r = state.results;
  const parts = [];
  if (r.flood) {
    const f = r.flood;
    parts.push(hazardCard('Flood zone / regulated area', f.level, f.label, `
      <ul class="small">${f.layers.map(x => `<li>${esc(x.name)}: ${x.ok ? (x.inside ? '<strong>inside</strong>' : x.near ? 'within 100 m' : 'not in mapped area') : 'service unavailable'}</li>`).join('')}
      ${f.nearestWater ? `<li>Nearest mapped watercourse/water body: ${esc(f.nearestWater.name)} (${fmtDist(f.nearestWater.d)})</li>` : ''}</ul>
      ${f.level === 'bad' ? `<p class="small"><strong>What this means:</strong> the property falls within the mapped regulation limit, which is the greatest extent of the flood plain, valley slope/erosion hazard and wetland setbacks (plus a 15–30 m buffer). It does not by itself mean the building floods. Ask the conservation authority which hazard applies; development or additions here need a permit.${isCondo ? ' For a condo, check the status certificate and reserve fund study for past water events, and check that the unit isn’t below grade.' : ' Ask about past basement water and check flood insurance availability and price.'}</p>` : ''}
      <p class="sub">Conservation Authority regulation limits include river/shoreline flood and erosion hazards and wetlands (O. Reg. 41/24). ${f.covered ? '' : 'This address may be outside the layers checked here — '}Confirm with your <a href="https://conservationontario.ca/" target="_blank" rel="noopener">local conservation authority</a>, and ask the seller about basement water, sump pump and backwater valve; check whether the municipality offers a basement flooding protection subsidy.</p>`));
  } else parts.push(hazardCard('Flood zone / regulated area', 'unknown', 'Checking…', ''));
  if (!osm) parts.push(hazardCard('Overhead power lines & nearby water', 'unknown', state.results.hzError ? 'Map data busy' : 'Checking…', state.results.hzError ? '<p class="small">The OpenStreetMap servers didn’t answer in time.</p><button class="btn" type="button" id="hzRetry">Retry</button>' : ''));
  if (osm) {
    const p = powerLineCheck(loc, osm);
    parts.push(hazardCard('Overhead power lines', p.level, p.label, `
      ${p.lines.length ? `<ul class="small">${p.lines.slice(0, 4).map(x => `<li>${x.kind === 'line' ? 'Transmission line' : 'Distribution line'}${x.voltage ? ` (${esc(x.voltage.split(';').map(v => Math.round(v / 1000) + ' kV').join(', '))})` : ''}${x.operator ? ` — ${esc(x.operator)}` : ''}: ${fmtDist(x.d)}</li>`).join('')}${p.nearestSub ? `<li>Substation: ${fmtDist(p.nearestSub.d)}</li>` : ''}</ul>` : ''}
      <p class="sub">From OpenStreetMap; local pole-mounted distribution lines are often not mapped, so look at the street. Hydro corridors can affect resale appeal, noise and tree-trimming access.</p>`));
    mapAdd('hazards', g => { p.lines.forEach(x => L.polyline(x.pts, { color: '#d9480f', weight: x.kind === 'line' ? 4 : 2, opacity: .85 }).bindPopup(`${x.kind === 'line' ? 'Transmission' : 'Distribution'} line ${x.voltage ? esc(x.voltage) + ' V' : ''}`).addTo(g)); osm.water.forEach(w => w.pts.length > 1 && L.polyline(w.pts, { color: '#1c7ed6', weight: 3, opacity: .7 }).bindPopup(esc(w.name)).addTo(g)); });
  }
  if (r.radon) {
    const d = r.radon;
    parts.push(hazardCard('Radon exposure', d.level, d.unit ? `${d.ge200}% ≥ 200 Bq/m³ locally` : 'Regional data', `
      <p class="small">${esc(d.label)}${d.r100_200 != null ? `; another ${d.r100_200}% were 100–200 Bq/m³ (WHO reference level is 100)` : ''}. Ontario overall: ${d.ontario.ge200}% ≥ 200.</p>
      <p class="sub">${esc(d.note)} ${isCondo ? 'Units above the ground floor are generally at lower risk. ' : ''}Source: <a href="${d.url}" target="_blank" rel="noopener">${esc(d.source)}</a>.</p>`));
  }
  const ages = ageRisks(l.yearBuilt, isCondo ? 'condo' : 'house');
  for (const a of ages) parts.push(hazardCard(a.name, a.level, { good: 'Low', ok: 'Low', warn: 'Possible', bad: 'Likely / high', unknown: 'Need year built' }[a.level], `<p class="small">${esc(a.detail)}</p><p class="sub">${esc(a.action)}</p>`));
  if (osm) {
    const v = vegetationCheck(loc, osm, isCondo ? 'condo' : 'house');
    parts.push(hazardCard('Vegetation clearance', v.level, v.label, `<ul class="small">${v.checklist.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`));
  }
  const gt = guttersCheck(loc, l.yearBuilt, isCondo ? 'condo' : 'house');
  parts.push(hazardCard('Gutters & downspouts', gt.level, gt.label, `<ul class="small">${gt.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`));
  section('hazards', `<div class="hazard-list">${parts.join('')}</div>`);
  const hzr = document.getElementById('hzRetry');
  if (hzr) hzr.onclick = () => { state.results.hzError = false; renderHazards(); state.retryHazards?.(); };

  const flagged = parts.filter(p => /badge (bad|warn)/.test(p)).length;
  const severe = parts.filter(p => /badge bad/.test(p)).length;
  tile('hazards', 'Hazard flags', `${flagged}`, severe ? `${severe} high-priority` : flagged ? 'Worth checking' : 'None flagged so far', severe ? 'bad' : flagged ? 'warn' : 'good', 'hazards');
}

// ---------- orchestration ----------
async function runSchools() {
  try { renderSchools(await schoolsNear(state.loc, state.osm)); } catch (e) { sectionError('schools', e); }
}

async function analyse(input, pending = null) {
  const btn = $('#goBtn');
  btn.disabled = true;
  status('Locating address…');
  try {
    let listing = null;
    let query = input.trim();
    if (MLS_RE.test(query.replace(/\s/g, ''))) {
      const mls = query.replace(/\s/g, '').toUpperCase();
      if (!settings.get().ddfProxy) throw new Error(`Looking up MLS® ${mls} needs a REALTOR.ca DDF® proxy (see ⚙ settings). Paste the street address or the REALTOR.ca listing link instead.`);
      status(`Fetching MLS® ${mls} from your DDF® feed…`);
      listing = await fetchDDF(mls);
      query = listing.lat && listing.lon ? `${listing.lat},${listing.lon}` : `${listing.address}, ${listing.city}`;
    }
    const loc = await resolveLocation(query);
    if (listing) { loc.display = `${listing.address}, ${listing.city} ${listing.postal || ''}`; loc.listingUrl = listing.url; }
    if (pending?.url) loc.listingUrl = pending.url;
    state.loc = loc; state.osm = null; state.hz = null; state.results = {};
    Object.keys(tiles).forEach(k => delete tiles[k]);
    pushRecent(input.trim());
    history.replaceState(null, '', `#q=${encodeURIComponent(input.trim())}`);

    $('#report').hidden = false;
    const a = loc.address || {};
    $('#locTitle').textContent = listing?.address || pending?.address || ((loc.unit ? `Unit ${loc.unit}, ` : '') + (a.road ? [a.house_number, a.road].filter(Boolean).join(' ') : loc.display.split(',')[0]));
    $('#locMuni').textContent = [loc.municipality, loc.county].filter(Boolean).join(' · ');
    $('#locMeta').textContent = `${loc.display} · ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`;
    $('#realtorLink').href = loc.listingUrl || 'https://www.realtor.ca/';
    $('#realtorLink').textContent = loc.listingUrl ? 'View listing on REALTOR.ca' : 'Open REALTOR.ca';
    ['transit', 'safety', 'schools', 'market', 'hazards'].forEach(id => section(id, '<div class="skeleton"></div>'));
    tile('transit', 'Transit score', '…', 'Loading', 'unknown', 'transit');
    $('#listingForm').reset();
    const saved = getListing(loc);
    const guessedType = (loc.unit || /apartments|condo/i.test(loc.osmBuildingType)) ? 'condoApt' : null;
    // A saved entry with no price and the default "detached" type is just an untouched form — let the condo guess win
    const typeIsDefault = !saved.type || (saved.type === 'detached' && !saved.listPrice && !saved.sqft);
    fillForm({ ...saved, ...(guessedType && typeIsDefault ? { type: guessedType } : {}), ...(pending || {}), ...(listing || {}) });
    if (pending) saveListing(loc, { ...saved, ...pending });
    if (listing) saveListing(loc, { ...getListing(loc), ...listing });
    $('#listingMsg').textContent = listing ? `Loaded MLS® ${listing.mls} from DDF®${listing.brokerage ? ' — listed by ' + listing.brokerage : ''}.`
      : pending ? `Read MLS® ${pending.mls || ''} from the pasted listing${pending.brokerage ? ' — listed by ' + pending.brokerage.replace(/\.$/, '') : ''}.${pending.sqftRange ? ` Size given as ${pending.sqftRange} sq ft; using the midpoint.` : ''}`
      : guessedType && typeIsDefault ? 'Looks like a condo unit — property type set to Condo apartment. Paste the listing to fill in the rest.' : '';
    initMap(loc);
    status('');
    document.getElementById('report').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const safetyP = safetyFor(loc);
    const radonP = radonCheck(loc);
    renderMarket();
    renderHazards();
    runSchools(); // bundled school list renders right away; OSM adds private schools when it arrives

    safetyP.then(s => renderSafety(s, loc)).catch(e => { sectionError('safety', e); tile('safety', 'Safety index', '—', 'Unavailable', 'unknown', 'safety'); });
    radonP.then(r => { state.results.radon = r; renderHazards(); }).catch(() => {});
    const runFlood = () => floodCheck(loc, state.hz || { water: [] })
      .catch(e => ({ level: 'unknown', label: 'Unavailable', layers: [], error: e.message }))
      .then(f => { if (state.loc === loc) { state.results.flood = f; renderHazards(); } });
    runFlood();

    const loadTransit = () => fetchTransitSchools(loc.lat, loc.lon).then(osm => {
      if (state.loc !== loc) return;
      state.osm = osm;
      renderTransit(scoreTransit(loc, osm));
      runSchools();
    }).catch(e => {
      if (state.loc !== loc) return;
      sectionError('transit', e, loadTransit);
      tile('transit', 'Transit score', '—', 'Map data busy — retry', 'unknown', 'transit');
    });
    const loadHazards = () => fetchHazardsOSM(loc.lat, loc.lon).then(hz => {
      if (state.loc !== loc) return;
      state.hz = hz; renderHazards(); runFlood();
    }).catch(() => { if (state.loc === loc) { state.results.hzError = true; renderHazards(); } });
    state.retryHazards = loadHazards;
    loadTransit();
    loadHazards();
  } catch (e) {
    status(e.message || String(e), true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- events ----------
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); analyse($('#q').value); });
$('#exampleLink').addEventListener('click', e => { e.preventDefault(); $('#q').value = EXAMPLE; analyse(EXAMPLE); });
$('#recent').addEventListener('click', e => { const q = e.target.closest('[data-q]')?.dataset.q; if (q) { $('#q').value = q; analyse(q); } });
$('#listingForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!state.loc) return;
  saveListing(state.loc, listingFromForm());
  $('#listingMsg').textContent = 'Saved. Report updated.';
  renderMarket(); renderHazards();
});
$('#ddfBtn').addEventListener('click', async () => {
  const mls = $('#listingForm').mls.value.trim();
  if (!mls) { $('#listingMsg').textContent = 'Enter the MLS® number first.'; return; }
  try {
    $('#listingMsg').textContent = 'Fetching from DDF®…';
    const l = await fetchDDF(mls);
    fillForm(l); saveListing(state.loc, { ...listingFromForm() });
    $('#listingMsg').textContent = `Loaded MLS® ${l.mls}.`;
    renderMarket(); renderHazards();
  } catch (e) { $('#listingMsg').textContent = e.message; }
});
$('#heroPasteBtn').addEventListener('click', () => {
  const p = parseListingText($('#heroPasteText').value);
  if (!p.address) { status('Couldn’t find an address in the pasted text. Make sure you copied the whole REALTOR.ca listing page.', true); return; }
  const q = `${p.address}, ${p.city || ''} ${p.postal || ''}`.trim();
  $('#q').value = q; $('#heroPaste').open = false;
  analyse(q, p);
});
$('#listingPasteBtn').addEventListener('click', () => {
  if (!state.loc) return;
  const p = parseListingText($('#listingPasteText').value);
  const fields = ['listPrice', 'mls', 'type', 'sqft', 'taxes', 'fee', 'dom', 'beds', 'yearBuilt'].filter(k => p[k] != null);
  if (!fields.length) { $('#listingMsg').textContent = 'Nothing recognised in the pasted text — copy the whole REALTOR.ca listing page.'; return; }
  fillForm(p); saveListing(state.loc, { ...listingFromForm() });
  if (p.url) { $('#realtorLink').href = p.url; $('#realtorLink').textContent = 'View listing on REALTOR.ca'; }
  $('#listingMsg').textContent = `Filled ${fields.length} fields from the listing${p.mls ? ` (MLS® ${p.mls})` : ''}.${p.sqftRange ? ` Size given as ${p.sqftRange} sq ft; using the midpoint.` : ''}`;
  renderMarket(); renderHazards();
});
$('#shareBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('#shareBtn').textContent = 'Copied'; } catch { prompt('Copy this link', location.href); }
  setTimeout(() => ($('#shareBtn').textContent = 'Copy link'), 1500);
});
$('#settingsBtn').addEventListener('click', () => { $('#ddfProxy').value = settings.get().ddfProxy || ''; $('#settingsDlg').showModal(); });
$('#saveSettings').addEventListener('click', () => settings.set({ ...settings.get(), ddfProxy: $('#ddfProxy').value.trim() }));

renderRecent();
const initial = new URLSearchParams(location.hash.slice(1)).get('q');
if (initial) { $('#q').value = initial; analyse(initial); }
