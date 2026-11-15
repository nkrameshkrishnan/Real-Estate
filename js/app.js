import { $, esc, fmtMoney, fmtDist, badge, store } from './util.js';
import { resolveLocation, LookupUnavailable } from './geocode.js';
import { fetchTransitSchools, fetchHazardsOSM } from './overpass.js';
import { scoreTransit } from './transit.js';
import { safetyFor } from './safety.js';
import { schoolsNear, fraserKey, boardLocator, boardsFor, searchSchools } from './schools.js';
import { floodCheck, powerLineCheck, radonCheck, ageRisks, vegetationCheck, guttersCheck } from './hazards.js';
import { loadMarket, negotiate, getComps, setComps, parseCompsCsv, TYPE_LABEL } from './market.js';
import { bookmarkletHref } from './bookmark.js';
import { settings, fetchDDF, findDDFByAddress, getListing, saveListing, parseListingText, yearFromAge } from './mls.js';

const state = { loc: null, osm: null, hz: null, map: null, layers: null, results: {} };
const MLS_RE = /^[A-Z]?\d{7,9}$/i;
const EXAMPLE = '25 The Esplanade, Toronto';
// Map inks: one legend keys every symbol on the map, in the legend rows and in the section headings
const INK = { ink: '#151a17', magenta: '#b4237a', water: '#2c74b3' };
const SYM = { transit: 'transit', safety: 'safety', schools: 'schools', market: 'market', hazards: 'hazards' };
const VERDICT = { good: 'Good', ok: 'Fair', warn: 'Check', bad: 'High priority', unknown: 'No data yet' };
const sym = name => `<svg class="sym" aria-hidden="true"><use href="#sym-${name}"/></svg>`;

// ---------- status ----------
function status(msg, isErr = false, action = null) {
  $('#status').innerHTML = msg ? `<div class="msg ${isErr ? 'err' : ''}"><span>${esc(msg)}</span>${action ? `<button class="btn" type="button" data-status-action>${esc(action.label)}</button>` : ''}</div>` : '';
  if (action) $('#status [data-status-action]').onclick = action.run;
}
// Turn raw network errors into a message that says what happened and what to do
function friendlyError(e) {
  if (e instanceof LookupUnavailable || e?.name === 'AbortError' || e instanceof TypeError) {
    return 'The free address lookup didn’t answer (it’s a shared public service and gets busy). Wait a few seconds and try again. Including the city and postal code helps it find a match.';
  }
  if (/HTTP (429|5\d\d)/.test(e?.message || '')) return 'A data service is busy right now. Wait a few seconds and try again.';
  return e?.message || String(e);
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
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.map);
    state.map.on('moveend zoomend resize', drawTicks);
  }
  state.layers?.remove();
  state.sub = {};
  state.layers = L.layerGroup().addTo(state.map);
  L.circle([loc.lat, loc.lon], { radius: 500, color: INK.magenta, weight: 2, dashArray: '5 5', fillColor: INK.magenta, fillOpacity: 0.035, className: 'lyr-safety' }).addTo(state.layers);
  L.circleMarker([loc.lat, loc.lon], { radius: 11, color: INK.magenta, weight: 3, fillColor: '#fff', fillOpacity: 1, className: 'lyr-home' }).addTo(state.layers);
  L.circleMarker([loc.lat, loc.lon], { radius: 4, stroke: false, fillColor: INK.magenta, fillOpacity: 1, className: 'lyr-home' }).bindPopup(esc(loc.display)).addTo(state.layers);
  state.map.setView([loc.lat, loc.lon], 15);
  setTimeout(() => { state.map.invalidateSize(); drawTicks(); }, 50);
}
// Coordinate ticks on the neat line, like the margin of a map sheet: a tick every 0.005° (0.01° when zoomed out), labelled at the ends
function drawTicks() {
  const wrap = $('#mapWrap'), m = state.map; if (!wrap || !m) return;
  let svg = wrap.querySelector('.grid-ticks');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'grid-ticks'); svg.setAttribute('aria-hidden', 'true'); wrap.appendChild(svg); }
  const b = m.getBounds(), size = m.getSize(), off = 8; // map sits 8px inside the frame (2px border + 6px padding)
  const step = m.getZoom() >= 15 ? 0.005 : m.getZoom() >= 13 ? 0.01 : 0.05;
  const fmt = (v, pos, neg) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;
  let out = '';
  const lons = [], lats = [];
  for (let x = Math.ceil(b.getWest() / step) * step; x <= b.getEast(); x += step) lons.push(x);
  for (let y = Math.ceil(b.getSouth() / step) * step; y <= b.getNorth(); y += step) lats.push(y);
  lons.forEach((lon, i) => {
    const px = m.latLngToContainerPoint([b.getNorth(), lon]).x + off;
    out += `<path d="M${px} ${off}v9M${px} ${off + size.y}v-9"/>`;
    if (i === 1) out += `<text x="${px + 4}" y="${off + 19}">${fmt(lon, 'E', 'W')}</text>`;
  });
  lats.forEach((lat, i) => {
    const py = m.latLngToContainerPoint([lat, b.getWest()]).y + off;
    out += `<path d="M${off} ${py}h9M${off + size.x} ${py}h-9"/>`;
    if (i === lats.length - 2) out += `<text x="${off + 13}" y="${py + 4}">${fmt(lat, 'N', 'S')}</text>`;
  });
  svg.innerHTML = out;
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
let shownTiles = {};
let slowNote = false, slowTimer = null;
const TILE_KEYS = ['transit', 'safety', 'schools', 'market', 'hazards'];
const TILE_NAMES = { transit: 'Transit', safety: 'Safety', schools: 'Schools', market: 'Market value', hazards: 'Hazards' };
// verdict: text for the status chip; pass '' for none, undefined for the default wording of the level
function tile(key, label, value, sub, level, href, verdict) {
  const chip = verdict === '' ? '' : `<span class="verdict">${esc(verdict ?? VERDICT[level] ?? '')}</span>`;
  tiles[key] = `<a class="score ${level}" href="#${href}" data-layer="${key}">${sym(SYM[key])}<span class="k">${esc(label)}</span><span class="v">${value}</span><span class="s">${chip}<span>${sub}</span></span></a>`;
  renderTiles();
}
function renderTiles() {
  const html = TILE_KEYS.map(k => tiles[k] || `<div class="score unknown loading" data-layer="${k}">${sym(SYM[k])}<span class="k">${TILE_NAMES[k]}</span><span class="v"><i class="pulse"></i><span class="sr-only">Loading</span></span><span class="s">${slowNote ? 'Still waiting for OpenStreetMap. This can take up to a minute.' : 'Checking…'}</span></div>`);
  const box = $('#scores');
  const active = document.activeElement?.closest?.('#scores [data-layer]')?.dataset.layer;
  box.innerHTML = html.join('');
  // Rows whose result just changed settle in; untouched rows stay still
  TILE_KEYS.forEach((k, i) => { if (tiles[k] && shownTiles[k] !== tiles[k]) box.children[i].classList.add('fresh'); });
  shownTiles = { ...tiles };
  if (active) box.querySelector(`[data-layer="${active}"]`)?.focus();
}
// Signature: pointing at a legend row shows only that check's layer on the map
function focusLayer(name) {
  const w = $('#mapWrap');
  if (name) w.dataset.focus = name; else delete w.dataset.focus;
}
$('#scores').addEventListener('pointerover', e => focusLayer(e.target.closest('[data-layer]')?.dataset.layer));
$('#scores').addEventListener('pointerleave', () => focusLayer(null));
$('#scores').addEventListener('focusin', e => focusLayer(e.target.closest('[data-layer]')?.dataset.layer));
$('#scores').addEventListener('focusout', () => focusLayer(null));

function section(id, html) {
  const b = $(`#${id} .body`);
  b.innerHTML = html;
  b.classList.remove('enter'); void b.offsetWidth; b.classList.add('enter');
}
function sectionError(id, e, retry) {
  const msg = /busy|HTTP|abort|fetch|timed out|network/i.test(`${e?.name} ${e?.message}`) ? 'The map-data service didn’t answer in time.' : (e.message || String(e));
  section(id, `<p>${badge('unknown', 'Unavailable')} ${esc(msg)}</p><p class="small muted">This uses the free OpenStreetMap servers, which are sometimes overloaded. Retrying usually works within a minute, and results are kept for 14 days once they load.</p>${retry ? '<button class="btn" type="button" data-retry>Retry</button>' : ''}`);
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
  mapAdd('transit', g => t.rapid.forEach(s => L.circleMarker([s.lat, s.lon], { radius: 6, color: INK.ink, weight: 2.5, fillColor: '#fff', fillOpacity: 1, className: 'lyr-transit' }).bindPopup(`${esc(s.name)} (${esc(s.mode)}) — ${fmtDist(s.d)}`).addTo(g)));
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
const withProtocol = u => !u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`;
function schoolRow(s, mine = false) {
  const f = s.fraser;
  const loc = boardLocator(s.board);
  const fraserCell = f
    ? `<strong>${esc(Number(f.rating).toFixed(1))}</strong>/10${f.trend ? `<svg class="trend ${f.trend}" role="img" aria-label="5-year trend ${f.trend}"><title>5-year trend ${f.trend}</title><use href="#sym-${f.trend}"/></svg>` : ''}${f.rank ? `<div class="sub">Rank ${esc(f.rank)}</div>` : ''}${f.rating5 != null && f.rating5 !== '' ? `<div class="sub">5-yr avg ${esc(Number(f.rating5).toFixed(1))}</div>` : ''}<div class="sub">${f.source === 'you' ? 'entered by you' : f.source === 'fraser' ? 'Fraser 2025' : 'from data file'}</div>`
    : `<span class="sub">${s.isPrivate ? 'Not ranked' : 'Not in Fraser report'}</span>`;
  return `<tr>
    <td><strong>${esc(s.name)}</strong>
      <div class="sub">${[s.type, s.board, s.lang && s.lang !== 'English' ? s.lang : '', s.grades && `Gr ${s.grades}`, s.special].filter(Boolean).map(esc).join(' · ') || (s.isPrivate ? 'Private / independent' : 'Not matched to provincial list (may be private)')}</div>
      <div class="sub">${s.website ? `<a href="${esc(withProtocol(s.website))}" target="_blank" rel="noopener">Website</a> · ` : ''}${loc ? `<a href="${loc.url}" target="_blank" rel="noopener">Check catchment</a> · ` : s.boardWebsite ? `<a href="${esc(withProtocol(s.boardWebsite))}" target="_blank" rel="noopener">Board site</a> · ` : ''}<a href="https://www.compareschoolrankings.org/" target="_blank" rel="noopener" title="Search “${esc(s.name)}” on compareschoolrankings.org">Fraser details</a></div>
      <label class="mine-toggle"><input type="checkbox" data-mine="${esc(s.id)}" ${mine ? 'checked' : ''}> My school</label>
    </td>
    <td class="num">${s.d == null ? '—' : fmtDist(s.d)}</td>
    <td class="num">${fraserCell}
      <form class="inline-form fraser-form" ${f && f.source !== 'you' ? 'hidden' : ''} data-key="${esc(fraserKey(s.name, s.city))}"><input name="rating" inputmode="decimal" placeholder="Rating" value="${f?.source === 'you' ? esc(f.rating) : ''}" aria-label="Fraser rating for ${esc(s.name)}"><input name="rank" placeholder="Rank e.g. 120/3052" value="${f?.source === 'you' ? esc(f.rank || '') : ''}" aria-label="Fraser rank"><button class="linkbtn">Save</button></form>
    </td></tr>`;
}

function renderSchools(r) {
  const all = [...r.elementary, ...r.secondary];
  // With no map data yet, an empty list means "not loaded", not "no schools"
  if (!r.osmAvailable && !all.length && !r.other.length) {
    tile('schools', 'Schools', '—', 'Loads with the map data', 'unknown', 'schools', 'Waiting for map data');
    section('schools', `<p>${badge('unknown', 'Waiting for map data')} School locations come from OpenStreetMap, which hasn’t answered yet. They appear here as soon as it does; if Transit shows a Retry button, retrying it loads schools too.</p>`);
    return;
  }
  state.schools = r;
  r.all.forEach(x => schoolPool.set(x.id, x));
  const mine = getMine(state.loc).map(m => schoolPool.get(m.id) || m);
  const mineIds = new Set(mine.map(m => m.id));
  // Highest Fraser rating first; schools without a rating follow, nearest first
  const byRating = rows => [...rows].sort((x, y) => {
    const num = v => (v == null || v === '' ? NaN : Number(v)), rx = num(x.fraser?.rating), ry = num(y.fraser?.rating);
    const hx = Number.isFinite(rx), hy = Number.isFinite(ry);
    if (hx !== hy) return hx ? -1 : 1;
    return hx && ry !== rx ? ry - rx : (x.d ?? 1e9) - (y.d ?? 1e9);
  });
  const levels = rows => [['Elementary', rows.filter(x => x.level === 'Elementary')], ['Secondary', rows.filter(x => x.level === 'Secondary')], ['Other', rows.filter(x => x.level !== 'Elementary' && x.level !== 'Secondary')]];
  const table = (title, rows) => rows.length ? `<h4 class="school-level">${title}</h4><div class="table-wrap"><table class="school-table"><thead><tr><th>School</th><th class="num">Distance</th><th class="num" aria-sort="descending">Fraser rating</th></tr></thead><tbody>${byRating(rows).map(x => schoolRow(x, mineIds.has(x.id))).join('')}</tbody></table></div>` : '';

  // Legend row: about the schools this child can attend, not every school nearby
  const rated = mine.filter(x => x.fraser?.rating != null && x.fraser.rating !== '');
  const best = [...rated].sort((a, b) => b.fraser.rating - a.fraser.rating)[0];
  if (mine.length) tile('schools', 'Your schools', `${mine.length}`, best ? `Best Fraser: ${Number(best.fraser.rating).toFixed(1)} (${esc(best.name)})` : 'None of them has a Fraser rating', best ? (best.fraser.rating >= 7 ? 'good' : best.fraser.rating >= 5.5 ? 'ok' : 'warn') : 'unknown', 'schools');
  else tile('schools', 'Schools', '—', 'Mark the schools this address is zoned for', 'unknown', 'schools', 'Needs your input');

  const boards = boardsFor(r.all);
  const boardList = boards.length ? `<ul class="board-list">${boards.map(b => `<li><span class="sys">${esc(b.system)}</span><span class="bd">${esc(b.board)}</span>${b.locator ? `<a class="btn" href="${b.locator.url}" target="_blank" rel="noopener">Find your school</a>` : b.website ? `<a class="btn ghost" href="${esc(withProtocol(b.website))}" target="_blank" rel="noopener">Board website</a>` : ''}</li>`).join('')}</ul>` : '';
  const nAll = r.all.length;
  const wasOpen = document.querySelector('#schools details.all-schools')?.open;
  section('schools', `
    <div class="zoned">
      <h4 class="zoned-title">Schools your child can attend</h4>
      ${mine.length ? levels(mine).map(([t, rows]) => table(t, rows)).join('') : `<p class="empty-note">No schools marked yet. Each board below sets its own attendance areas: check this address with the boards you’re considering, then tick <strong>My school</strong> next to the schools they name in the list below.</p>`}
    </div>
    <div class="boards">
      <h4>Boards serving this address</h4>
      ${boardList || '<p class="small muted">No publicly funded schools were found within 3 km. Use the <a href="https://www.ontario.ca/page/find-your-school" target="_blank" rel="noopener">Ontario school information finder</a> to find the board for this address.</p>'}
    </div>
    <details class="all-schools" ${(wasOpen ?? !mine.length) ? 'open' : ''}>
      <summary>${mine.length ? 'Change your schools' : 'Pick from schools within 3 km'} <span class="muted">(${nAll})</span></summary>
      ${levels(r.all).map(([t, rows]) => table(t, rows)).join('')}
      ${!nAll ? '<p class="muted">No schools mapped within 3 km.</p>' : ''}
      <form class="school-search" id="schoolSearch" autocomplete="off">
        <label for="schoolQ">Designated school not listed? Search Ontario’s school list by name</label>
        <div class="inline-search"><input id="schoolQ" name="q" placeholder="e.g. Jarvis Collegiate"><button class="btn" type="submit">Search</button></div>
        <div id="schoolResults"></div>
      </form>
    </details>
    <div class="callout"><strong>Nearest is not always designated.</strong> Attendance boundaries are set by each board (public, Catholic, French-language). Confirm with the board’s address lookup${boards.some(b => /toronto dsb/i.test(b.board)) ? ', e.g. <a href="https://www.tdsb.on.ca/Find-your/School/By-Home-Address" target="_blank" rel="noopener">TDSB Find your school</a>,' : ''} or the <a href="https://www.ontario.ca/page/find-your-school" target="_blank" rel="noopener">Ontario school information finder</a>. Your choices are saved in this browser for this address only.</div>
    <p class="sub">Fraser ratings (0–10, rank, 5-year average and trend <svg class="trend up" aria-hidden="true"><use href="#sym-up"/></svg><svg class="trend down" aria-hidden="true"><use href="#sym-down"/></svg>): ${r.fraserMeta?.source ? `<a href="${esc(r.fraserMeta.elementaryUrl)}" target="_blank" rel="noopener">${esc(r.fraserMeta.source)}</a>` : 'Fraser Institute'}. See full school profiles on <a href="https://www.compareschoolrankings.org/" target="_blank" rel="noopener">compareschoolrankings.org</a>. Schools without a Grade 3/6 (elementary) or Grade 9/OSSLT (secondary) EQAO result, and most private schools, aren’t ranked. School list: ${esc(r.meta?.source || '')} (${esc(r.meta?.licence || '')}).</p>`);
  $$fraser();
  const showHits = (q, hits) => {
    const ids = new Set(getMine(state.loc).map(m => m.id));
    $('#schoolQ').value = q;
    $('#schoolResults').innerHTML = hits.length ? `<div class="table-wrap"><table class="school-table"><tbody>${hits.map(x => schoolRow(x, ids.has(x.id))).join('')}</tbody></table></div>` : `<p class="small muted">No Ontario school name contains “${esc(q)}”. Try a shorter part of the name.</p>`;
  };
  if (lastSearch && lastSearch.loc === state.loc) showHits(lastSearch.q, lastSearch.hits);
  $('#schoolSearch').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#schoolQ').value.trim();
    $('#schoolResults').innerHTML = '<p class="small muted">Searching…</p>';
    const hits = await searchSchools(q, state.loc).catch(() => []);
    hits.forEach(x => schoolPool.set(x.id, x));
    lastSearch = { loc: state.loc, q, hits };
    showHits(q, hits);
  });
  mapAdd('schools', g => r.all.concat(mine.filter(m => !r.all.some(x => x.id === m.id))).forEach(x => {
    if (x.lat == null) return;
    const isMine = mineIds.has(x.id);
    L.marker([x.lat, x.lon], { icon: L.divIcon({ className: `mk-school${isMine ? ' mine' : ''}`, iconSize: isMine ? [15, 15] : [9, 9] }), keyboard: false, zIndexOffset: isMine ? 500 : 0 })
      .bindPopup(`<strong>${esc(x.name)}</strong>${isMine ? ' (your school)' : ''}<br>${esc(x.level)}${x.d != null ? ` · ${fmtDist(x.d)}` : ''}${x.fraser ? `<br>Fraser ${esc(x.fraser.rating)}/10` : ''}`).addTo(g);
  }));
}
// "My school" choices, saved per address in this browser
const schoolPool = new Map();
let lastSearch = null;
const mineKey = loc => `myschools:${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;
const getMine = loc => (loc ? store.get(mineKey(loc), []) : []);
function setMine(id, on) {
  const loc = state.loc; if (!loc) return;
  const cur = getMine(loc).filter(m => m.id !== id);
  if (on) {
    const x = schoolPool.get(id); if (!x) return;
    const { name, level, board, type, lang, grades, special, city, website, boardWebsite, d, lat, lon, fraser, publiclyFunded, isPrivate } = x;
    cur.push({ id, name, level, board, type, lang, grades, special, city, website, boardWebsite, d, lat, lon, fraser, publiclyFunded, isPrivate });
  }
  store.set(mineKey(loc), cur);
}
document.getElementById('schools').addEventListener('change', e => {
  const cb = e.target.closest('[data-mine]'); if (!cb) return;
  const id = cb.dataset.mine, where = cb.closest('#schoolResults') ? '#schoolResults' : '.all-schools';
  setMine(id, cb.checked);
  if (state.schools) renderSchools(state.schools);
  document.querySelector(`#schools ${where} [data-mine="${CSS.escape(id)}"]`)?.focus();
});
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
  // Year built also accepts an age range typed straight from a listing ("31-50", "100+", "New")
  const yb = num('yearBuilt') ?? yearFromAge(f.yearBuilt.value)?.year ?? null;
  return { mls: f.mls.value.trim(), listPrice: num('listPrice'), type: f.type.value, yearBuilt: yb, sqft: num('sqft'), dom: num('dom'), reductions: num('reductions'), beds: num('beds'), taxes: num('taxes'), fee: num('fee') };
}
function fillForm(l) {
  const f = $('#listingForm');
  for (const k of ['mls', 'listPrice', 'type', 'yearBuilt', 'sqft', 'dom', 'reductions', 'beds', 'taxes', 'fee']) if (f[k] && l[k] != null) f[k].value = l[k];
}

// Negotiation range drawn like a map scale bar: the filled run is opening offer to walk-away, the magenta tick is the target
function scaleBar(n) {
  if (![n.opening, n.target, n.walkAway].every(isFinite) || n.walkAway <= n.opening) return '';
  const lo = n.opening - (n.walkAway - n.opening) * 0.04, hi = n.walkAway + (n.walkAway - n.opening) * 0.04;
  const pos = v => ((v - lo) / (hi - lo) * 100).toFixed(2);
  return `<figure class="scalebar" aria-label="Negotiation range from ${fmtMoney(n.opening)} to ${fmtMoney(n.walkAway)}, target ${fmtMoney(n.target)}">
      <div class="bar"><span class="seg" style="left:${pos(n.opening)}%;right:${(100 - pos(n.walkAway)).toFixed(2)}%"></span><span class="mk" style="left:${pos(n.target)}%"></span></div>
      <div class="ticks" aria-hidden="true"><span style="left:${pos(n.opening)}%">Open <b>${fmtMoney(n.opening)}</b></span><span style="left:${pos(n.target)}%">Target <b>${fmtMoney(n.target)}</b></span><span style="left:${pos(n.walkAway)}%">Walk away <b>${fmtMoney(n.walkAway)}</b></span></div>
    </figure>`;
}

async function renderMarket() {
  const loc = state.loc, l = listingFromForm();
  let market;
  try { market = await loadMarket(); } catch { market = null; }
  const comps = getComps(loc);
  const cond = store.get('marketCondition', '');
  const n = negotiate({ ...l, condition: cond || undefined, comps, market });
  const typeAvg = market?.averagePrice?.[l.type];
  if (isFinite(n.fair)) tile('market', 'Comps-based value', fmtMoney(n.fair), `Target offer ${fmtMoney(n.target)}`, n.confidence === 'high' ? 'good' : n.confidence === 'medium' ? 'ok' : 'unknown', 'market', `${n.confidence} confidence`);
  else if (isFinite(n.target)) tile('market', 'Target offer', fmtMoney(n.target), `List ${fmtMoney(l.listPrice)}. Add comps for a value estimate`, 'unknown', 'market', 'Estimate');
  else tile('market', 'Market value', '—', 'Add the list price or paste the listing', 'unknown', 'market', 'Needs listing');
  section('market', `
    <div class="kpis">
      <div class="kpi"><div class="v">${fmtMoney(typeAvg)}</div><div class="k">${esc(market?.area || 'Board')} avg. ${esc(TYPE_LABEL[l.type] || '')} · ${esc(market?.period || '')}</div></div>
      ${l.type === 'condoApt' && market?.condoApt416 ? `<div class="kpi"><div class="v">${fmtMoney(/toronto/i.test(loc.municipality) ? market.condoApt416 : market.condoApt905)}</div><div class="k">avg. condo apt (${/toronto/i.test(loc.municipality) ? '416' : '905'})</div></div>` : ''}
      <div class="kpi"><div class="v">${l.listPrice ? fmtMoney(l.listPrice) : '—'}</div><div class="k">list price</div></div>
      ${isFinite(n.low) ? `<div class="kpi"><div class="v">${fmtMoney(n.low)} – ${fmtMoney(n.high)}</div><div class="k">comps range (25th–75th pct.)</div></div>` : ''}
      ${l.fee ? `<div class="kpi"><div class="v">${fmtMoney(l.fee)}</div><div class="k">condo fee / month${l.sqft ? ` ($${(l.fee / l.sqft).toFixed(2)}/sq ft)` : ''}</div></div>` : ''}
      ${l.taxes ? `<div class="kpi"><div class="v">${fmtMoney(l.taxes)}</div><div class="k">annual property taxes</div></div>` : ''}
    </div>
    ${scaleBar(n)}
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
    mapAdd('hazards', g => { p.lines.forEach(x => L.polyline(x.pts, { color: INK.ink, weight: x.kind === 'line' ? 3 : 2, opacity: .9, dashArray: '7 4', className: 'lyr-hazards' }).bindPopup(`${x.kind === 'line' ? 'Transmission' : 'Distribution'} line ${x.voltage ? esc(x.voltage) + ' V' : ''}`).addTo(g)); osm.water.forEach(w => w.pts.length > 1 && L.polyline(w.pts, { color: INK.water, weight: 3, opacity: .85, className: 'lyr-hazards' }).bindPopup(esc(w.name)).addTo(g)); });
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
  const pending = parts.filter(p => /Checking…|Map data busy/.test(p)).length;
  tile('hazards', 'Hazard flags', `${flagged}`, severe ? `${severe} high-priority` : flagged ? 'Worth checking' : pending ? `None flagged; ${pending} still checking` : 'None flagged', severe ? 'bad' : flagged ? 'warn' : pending ? 'unknown' : 'good', 'hazards', !severe && !flagged && pending ? 'In progress' : undefined);
}

// ---------- orchestration ----------
async function runSchools() {
  try { renderSchools(await schoolsNear(state.loc, state.osm)); } catch (e) { sectionError('schools', e); }
}

// With a DDF® proxy set up, look for an active listing at this address and fill the form from it
async function autofillFromDDF(loc) {
  $('#listingMsg').textContent = 'Looking for an active listing at this address in your DDF® feed…';
  try {
    const l = await findDDFByAddress(loc);
    if (state.loc !== loc) return;
    if (!l) { $('#listingMsg').textContent = 'No active DDF® listing found at this address. Paste the REALTOR.ca listing or type the details.'; return; }
    if (l.many) { $('#listingMsg').textContent = `${l.many} active listings share this street number (units in one building?). Enter the MLS® number and press Fetch from DDF®.`; return; }
    fillForm(l); saveListing(loc, { ...getListing(loc), ...l });
    $('#listingEmpty').hidden = true;
    if (l.url) { $('#realtorLink').href = l.url; $('#realtorLink').textContent = 'View listing on REALTOR.ca'; }
    $('#listingMsg').textContent = `Loaded MLS® ${l.mls} from DDF®${l.brokerage ? ' — listed by ' + l.brokerage : ''}.`;
    renderMarket(); renderHazards();
  } catch (e) {
    if (state.loc === loc) $('#listingMsg').textContent = `Couldn’t reach your DDF® proxy (${e.message}). Paste the REALTOR.ca listing or type the details.`;
  }
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
    document.body.classList.add('has-report');
    const a = loc.address || {};
    $('#locTitle').textContent = listing?.address || pending?.address || ((loc.unit ? `Unit ${loc.unit}, ` : '') + (a.road ? [a.house_number, a.road].filter(Boolean).join(' ') : loc.display.split(',')[0]));
    $('#locMuni').textContent = [loc.municipality, loc.county].filter(Boolean).join(' · ') || loc.display;
    const place = [a.neighbourhood || a.quarter || a.suburb, a.postcode].filter(Boolean).join(' · ');
    $('#locMeta').innerHTML = `<b>${Math.abs(loc.lat).toFixed(5)}° ${loc.lat >= 0 ? 'N' : 'S'}&ensp;${Math.abs(loc.lon).toFixed(5)}° ${loc.lon >= 0 ? 'E' : 'W'}</b>${place ? `&ensp;${esc(place)}` : ''}`;
    $('#realtorLink').href = loc.listingUrl || 'https://www.realtor.ca/';
    $('#realtorLink').textContent = loc.listingUrl ? 'View listing on REALTOR.ca' : 'Open REALTOR.ca';
    ['transit', 'safety', 'schools', 'market', 'hazards'].forEach(id => { $(`#${id} .body`).innerHTML = '<div class="skeleton"></div>'; });
    shownTiles = {}; slowNote = false; renderTiles();
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => { if (state.loc === loc) { slowNote = true; renderTiles(); } }, 20000);
    $('#listingForm').reset();
    const saved = getListing(loc);
    const guessedType = (loc.unit || /apartments|condo/i.test(loc.osmBuildingType)) ? 'condoApt' : null;
    // A saved entry with no price and the default "detached" type is just an untouched form — let the condo guess win
    const typeIsDefault = !saved.type || (saved.type === 'detached' && !saved.listPrice && !saved.sqft);
    fillForm({ ...saved, ...(guessedType && typeIsDefault ? { type: guessedType } : {}), ...(pending || {}), ...(listing || {}) });
    if (pending) saveListing(loc, { ...saved, ...pending });
    if (listing) saveListing(loc, { ...getListing(loc), ...listing });
    // REALTOR.ca map centred on this address, for finding the listing to paste
    const box = (dLat, dLon) => `LatitudeMax=${(loc.lat + dLat).toFixed(5)}&LongitudeMax=${(loc.lon + dLon).toFixed(5)}&LatitudeMin=${(loc.lat - dLat).toFixed(5)}&LongitudeMin=${(loc.lon - dLon).toFixed(5)}`;
    $('#realtorMapLink').href = loc.listingUrl || `https://www.realtor.ca/map#ZoomLevel=17&Center=${loc.lat.toFixed(6)}%2C${loc.lon.toFixed(6)}&${box(0.004, 0.008)}&Sort=6-D&PropertyTypeGroupID=1&TransactionTypeId=2&PropertySearchTypeId=0&Currency=CAD`;
    const hasDetails = !!(listing || pending || saved.listPrice || saved.mls);
    $('#listingEmpty').hidden = hasDetails;
    $('#listingMsg').textContent = listing ? `Loaded MLS® ${listing.mls} from DDF®${listing.brokerage ? ' — listed by ' + listing.brokerage : ''}.`
      : pending ? `Read MLS® ${pending.mls || ''} from the pasted listing${pending.brokerage ? ' — listed by ' + pending.brokerage.replace(/\.$/, '') : ''}.${pending.sqftRange ? ` Size given as ${pending.sqftRange} sq ft; using the midpoint.` : ''}${pending.yearBuiltNote ? ' ' + pending.yearBuiltNote : ''}`
      : guessedType && typeIsDefault ? 'Looks like a condo unit — property type set to Condo apartment. Paste the listing to fill in the rest.' : '';
    initMap(loc);
    status('');
    if (!hasDetails && settings.get().ddfProxy) autofillFromDDF(loc);
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
    const retryable = e instanceof LookupUnavailable || e?.name === 'AbortError' || e instanceof TypeError || /HTTP (429|5\d\d)/.test(e?.message || '');
    status(friendlyError(e), true, retryable ? { label: 'Try again', run: () => analyse(input, pending) } : null);
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
  if ($('#listingForm').listPrice.value) $('#listingEmpty').hidden = true;
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
    $('#listingEmpty').hidden = true;
    renderMarket(); renderHazards();
  } catch (e) { $('#listingMsg').textContent = e.message; }
});
$('#heroPasteBtn').addEventListener('click', () => {
  const p = parseListingText($('#heroPasteText').value);
  if (startFromListing(p)) $('#heroPaste').open = false;
});
$('#listingPasteBtn').addEventListener('click', () => {
  if (!state.loc) return;
  const p = parseListingText($('#listingPasteText').value);
  const fields = ['listPrice', 'mls', 'type', 'sqft', 'taxes', 'fee', 'dom', 'beds', 'yearBuilt'].filter(k => p[k] != null);
  if (!fields.length) { $('#listingMsg').textContent = 'Nothing recognised in the pasted text — copy the whole REALTOR.ca listing page.'; return; }
  fillForm(p); saveListing(state.loc, { ...listingFromForm() });
  if (p.url) { $('#realtorLink').href = p.url; $('#realtorLink').textContent = 'View listing on REALTOR.ca'; }
  $('#listingMsg').textContent = `Filled ${fields.length} fields from the listing${p.mls ? ` (MLS® ${p.mls})` : ''}.${p.sqftRange ? ` Size given as ${p.sqftRange} sq ft; using the midpoint.` : ''}${p.yearBuiltNote ? ' ' + p.yearBuiltNote : ''}`;
  $('#listingEmpty').hidden = true; $('#listingPaste').open = false; $('#listingPasteText').value = '';
  renderMarket(); renderHazards();
});
// Reading starts as soon as something is pasted; no extra click needed
$('#listingPasteText').addEventListener('paste', () => setTimeout(() => $('#listingPasteBtn').click(), 0));
$('#openPaste').addEventListener('click', () => {
  const box = $('#listingPaste'); box.open = true;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#listingPasteText').focus({ preventScroll: true });
});
$('#shareBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('#shareBtn').textContent = 'Copied'; } catch { prompt('Copy this link', location.href); }
  setTimeout(() => ($('#shareBtn').textContent = 'Copy link'), 1500);
});
$('#settingsBtn').addEventListener('click', () => { $('#ddfProxy').value = settings.get().ddfProxy || ''; $('#settingsDlg').showModal(); });
$('#saveSettings').addEventListener('click', () => settings.set({ ...settings.get(), ddfProxy: $('#ddfProxy').value.trim() }));

// ---------- landing: contour field behind the title block ----------
function drawContours() {
  const svg = $('#contours'); if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg', cx = 360, cy = 250;
  const ring = (r, i) => {
    const pts = [];
    for (let k = 0; k <= 96; k++) {
      const t = k / 96 * Math.PI * 2;
      const rr = r * (1 + 0.16 * Math.sin(3 * t + 0.6 + i * 0.07) + 0.08 * Math.sin(5 * t + 1.9 - i * 0.05) + 0.05 * Math.cos(2 * t + i * 0.11));
      pts.push([cx + rr * Math.cos(t) * 1.25, cy + rr * Math.sin(t)]);
    }
    return 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join('L') + 'Z';
  };
  let html = '';
  for (let i = 0; i < 16; i++) {
    const r = 24 + i * 19, index = i % 5 === 4;
    html += `<path class="c${index ? ' index' : ''}" d="${ring(r, i)}" style="--d:${i * 45}ms"/>`;
    if (index) html += `<text class="lbl" x="${cx + r * 1.25 * 0.72}" y="${cy - r * 0.62}">${100 + (i + 1) * 5}</text>`;
  }
  html += `<path class="creek" d="M-10 470 C 80 440, 120 400, 190 405 S 300 470, 360 500 S 470 520, 620 470" style="--d:300ms"/>`;
  for (let x = 60; x < 600; x += 60) html += `<path class="tick" d="M${x} 0v10M${x} 520v-10"/>`;
  for (let y = 60; y < 520; y += 60) html += `<path class="tick" d="M0 ${y}h10M600 ${y}h-10"/>`;
  html += `<g class="pin"><circle class="pin-ring" cx="${cx}" cy="${cy}" r="11"/><circle class="pin-dot" cx="${cx}" cy="${cy}" r="4"/></g>`;
  svg.innerHTML = html;
  svg.querySelectorAll('.c, .creek').forEach(p => p.style.setProperty('--len', Math.ceil(p.getTotalLength())));
  document.documentElement.classList.add('draw');
}
drawContours();

renderRecent();
// Start a report from listing text: pasted on the landing page, or sent by the bookmark
function startFromListing(p) {
  if (!p.address) { status('Couldn’t find an address in that listing text. Open a single home’s listing page (not search results) and try again.', true); return false; }
  const q = `${p.unit ? `Unit ${p.unit}, ` : ''}${p.address}, ${p.city || ''} ${p.postal || ''}`.trim();
  $('#q').value = q;
  analyse(q, p);
  return true;
}

// The bookmark: its link is built for wherever this site is hosted
const appUrl = location.origin + location.pathname;
document.querySelectorAll('.bookmarklet').forEach(a => {
  a.href = bookmarkletHref(appUrl);
  a.addEventListener('click', e => { e.preventDefault(); status('Drag the Send to Home Insight button to your bookmarks bar, then click the bookmark while you’re on a REALTOR.ca listing.'); });
});

const hashParams = new URLSearchParams(location.hash.slice(1));
const initial = hashParams.get('q');
if (hashParams.has('paste')) {
  // Sent by the bookmark: read it, then drop the page text from the address bar and history
  const p = parseListingText(hashParams.get('paste') || '');
  const from = hashParams.get('url') || '';
  if (!p.url && /^https:\/\/www\.realtor\.ca\//i.test(from)) p.url = from;
  history.replaceState(null, '', location.pathname);
  startFromListing(p);
} else if (initial) { $('#q').value = initial; analyse(initial); }
