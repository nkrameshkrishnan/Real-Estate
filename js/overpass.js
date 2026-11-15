// One combined OpenStreetMap Overpass query per address (transit, schools, power, water, trees)
import { cached } from './util.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function buildQuery(lat, lon) {
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
out center tags;
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

async function runQuery(q) {
  let lastErr;
  for (const url of MIRRORS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 70000);
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Overpass unavailable');
}

const center = el => el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null;
const geom = el => (el.geometry || []).map(g => [g.lat, g.lon]);

export function fetchOSM(lat, lon) {
  const key = `osm:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached(key, async () => {
    const data = await runQuery(buildQuery(lat, lon));
    const out = { stops: [], stations: [], routes: [], schools: [], powerLines: [], substations: [], water: [], trees: 0, woods: 0 };
    const seen = new Set();
    for (const el of data.elements || []) {
      const id = `${el.type}/${el.id}`;
      const tg = el.tags || {};
      if (el.type === 'relation' && tg.type === 'route') {
        if (!seen.has(id)) { seen.add(id); out.routes.push({ id, ref: tg.ref || '', name: tg.name || '', mode: tg.route, operator: tg.operator || tg.network || '' }); }
        continue;
      }
      if (tg.amenity === 'school') { const c = center(el); if (c && !seen.has(id)) { seen.add(id); out.schools.push({ id, name: tg.name || '(unnamed school)', tags: tg, lat: c[0], lon: c[1] }); } continue; }
      if (tg.power === 'line' || tg.power === 'minor_line') { out.powerLines.push({ id, kind: tg.power, voltage: tg.voltage || '', operator: tg.operator || '', pts: geom(el) }); continue; }
      if (tg.power === 'substation') { const c = center(el); if (c) out.substations.push({ id, name: tg.name || 'Substation', lat: c[0], lon: c[1] }); continue; }
      if (tg.waterway || tg.natural === 'water') { out.water.push({ id, name: tg.name || tg.waterway || 'water body', kind: tg.waterway || tg.water || 'water', pts: geom(el) }); continue; }
      if (tg.natural === 'tree') { out.trees++; continue; }
      if (tg.natural === 'wood' || tg.landuse === 'forest') { out.woods++; continue; }
      const c = center(el);
      if (!c || seen.has(id)) continue;
      seen.add(id);
      const isStation = /^(station|halt)$/.test(tg.railway || '') || tg.public_transport === 'station';
      const rec = { id, name: tg.name || tg.ref || 'Stop', lat: c[0], lon: c[1], tags: tg };
      if (isStation) {
        rec.mode = tg.station || (tg.subway === 'yes' ? 'subway' : tg.train === 'yes' ? 'train' : tg.light_rail === 'yes' ? 'light_rail' : 'train');
        out.stations.push(rec);
      } else {
        rec.mode = tg.railway === 'tram_stop' || tg.tram === 'yes' ? 'tram' : 'bus';
        out.stops.push(rec);
      }
    }
    return out;
  });
}
