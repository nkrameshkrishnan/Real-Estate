// OpenStreetMap Overpass queries, built to survive a slow or overloaded public Overpass service:
//  - two smaller queries (transit+schools, hazards) instead of one big one, so each section renders independently
//  - hedged requests: the main server first, backup mirrors join in if it is slow; first good answer wins
//  - retry on 429/502/503/504; results cached in localStorage for 14 days
import { cached } from './util.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const HEDGE_DELAY_MS = 15000;   // start the next mirror if no answer after this long
const REQUEST_TIMEOUT_MS = 90000;
const CACHE_TTL_MS = 14 * 86400000;
const CACHE_PREFIX = 'osm:v2:';

function transitSchoolsQuery(lat, lon) {
  const p = `${lat},${lon}`;
  return `[out:json][timeout:60];
(
  node(around:1000,${p})[highway=bus_stop];
  node(around:1000,${p})[public_transport=platform];
  node(around:700,${p})[railway=tram_stop];
  nwr(around:1500,${p})[railway~"^(station|halt)$"];
  nwr(around:1500,${p})[public_transport=station];
)->.transit;
.transit out center tags;
node.transit(around:500,${p})->.near;
rel(bn.near)[type=route][route~"^(bus|tram|subway|train|light_rail|trolleybus)$"];
out tags;
nwr(around:3000,${p})[amenity=school];
out center tags;`;
}

function hazardsQuery(lat, lon) {
  const p = `${lat},${lon}`;
  return `[out:json][timeout:60];
way(around:600,${p})[power~"^(line|minor_line)$"];
out tags geom;
nwr(around:600,${p})[power=substation];
out center tags;
way(around:400,${p})[waterway~"^(river|stream|canal|drain|ditch)$"];
out tags geom;
way(around:300,${p})[natural=water];
out tags geom;
node(around:40,${p})[natural=tree];
out;
nwr(around:80,${p})[~"^(natural|landuse)$"~"^(wood|forest)$"];
out center tags;`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchMirror(url, q, outerSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    outerSignal.addEventListener('abort', onAbort);
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      if ([429, 502, 503, 504].includes(res.status) && attempt === 0) { await sleep(4000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark) && !(json.elements || []).length) throw new Error(json.remark);
      return json;
    } finally {
      clearTimeout(t);
      outerSignal.removeEventListener('abort', onAbort);
    }
  }
  throw new Error('busy');
}

// Hedged request: mirror i starts after i * HEDGE_DELAY_MS (or immediately once an earlier one fails)
async function runQuery(q) {
  const master = new AbortController();
  const errors = [];
  return new Promise((resolve, reject) => {
    let pending = MIRRORS.length, settled = false;
    const startNext = (() => { let i = 0; return () => { if (settled || i >= MIRRORS.length) return; const url = MIRRORS[i++]; launch(url); }; })();
    const timers = [];
    function launch(url) {
      fetchMirror(url, q, master.signal).then(json => {
        if (settled) return;
        settled = true; timers.forEach(clearTimeout); master.abort(); resolve(json);
      }).catch(e => {
        errors.push(`${new URL(url).host}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
        if (--pending === 0 && !settled) { settled = true; reject(new Error(`OpenStreetMap (Overpass) servers are busy — ${errors.join('; ')}`)); }
        else startNext();
      });
    }
    startNext();
    for (let k = 1; k < MIRRORS.length; k++) timers.push(setTimeout(startNext, k * HEDGE_DELAY_MS));
  });
}

function cacheGet(key) {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_PREFIX + key));
    if (v && Date.now() - v.t < CACHE_TTL_MS) return v.d;
  } catch { /* ignore */ }
  return null;
}
function cacheSet(key, data) {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    if (keys.length > 16) keys.map(k => [k, (JSON.parse(localStorage.getItem(k)) || {}).t || 0]).sort((a, b) => a[1] - b[1]).slice(0, keys.length - 16).forEach(([k]) => localStorage.removeItem(k));
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), d: data }));
  } catch { /* storage full or unavailable — fine */ }
}

const center = el => el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null;
const geom = el => (el.geometry || []).map(g => [+g.lat.toFixed(6), +g.lon.toFixed(6)]);

function parseTransitSchools(data) {
  const out = { stops: [], stations: [], routes: [], schools: [] };
  const seen = new Set();
  for (const el of data.elements || []) {
    const id = `${el.type}/${el.id}`, tg = el.tags || {};
    if (seen.has(id)) continue;
    seen.add(id);
    if (el.type === 'relation' && tg.type === 'route') { out.routes.push({ id, ref: tg.ref || '', name: tg.name || '', mode: tg.route, operator: tg.operator || tg.network || '' }); continue; }
    const c = center(el); if (!c) continue;
    if (tg.amenity === 'school') { out.schools.push({ id, name: tg.name || '(unnamed school)', tags: tg, lat: c[0], lon: c[1] }); continue; }
    const isStation = /^(station|halt)$/.test(tg.railway || '') || tg.public_transport === 'station';
    const rec = { id, name: tg.name || tg.ref || 'Stop', lat: c[0], lon: c[1], tags: tg };
    if (isStation) { rec.mode = tg.station || (tg.subway === 'yes' ? 'subway' : tg.light_rail === 'yes' ? 'light_rail' : 'train'); out.stations.push(rec); }
    else { rec.mode = tg.railway === 'tram_stop' || tg.tram === 'yes' ? 'tram' : 'bus'; out.stops.push(rec); }
  }
  return out;
}

function parseHazards(data) {
  const out = { powerLines: [], substations: [], water: [], trees: 0, woods: 0 };
  for (const el of data.elements || []) {
    const id = `${el.type}/${el.id}`, tg = el.tags || {};
    if (tg.power === 'line' || tg.power === 'minor_line') out.powerLines.push({ id, kind: tg.power, voltage: tg.voltage || '', operator: tg.operator || '', pts: geom(el) });
    else if (tg.power === 'substation') { const c = center(el); if (c) out.substations.push({ id, name: tg.name || 'Substation', lat: c[0], lon: c[1] }); }
    else if (tg.waterway || tg.natural === 'water') out.water.push({ id, name: tg.name || tg.waterway || 'water body', kind: tg.waterway || tg.water || 'water', pts: geom(el) });
    else if (tg.natural === 'tree') out.trees++;
    else if (tg.natural === 'wood' || tg.landuse === 'forest') out.woods++;
  }
  return out;
}

function cachedQuery(kind, lat, lon, build, parse) {
  const key = `${kind}:${lat.toFixed(4)},${lon.toFixed(4)}`;
  return cached(key, async () => {
    const hit = cacheGet(key);
    if (hit) return { ...hit, fromCache: true };
    const data = parse(await runQuery(build(lat, lon)));
    cacheSet(key, data);
    return data;
  });
}

export const fetchTransitSchools = (lat, lon) => cachedQuery('ts', lat, lon, transitSchoolsQuery, parseTransitSchools);
export const fetchHazardsOSM = (lat, lon) => cachedQuery('hz', lat, lon, hazardsQuery, parseHazards);
