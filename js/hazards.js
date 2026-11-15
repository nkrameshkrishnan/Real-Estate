// Property & environmental hazards: flood regulation areas, overhead power lines, radon,
// age-based building risks (asbestos, lead paint, wiring, plumbing), vegetation, gutters/downspouts.
import { fetchJSON, cached, haversine, distToPolyline } from './util.js';

// Conservation Authority regulated-area layers (O. Reg. 41/24 limits incl. flood hazards). All CORS-enabled ArcGIS FeatureServers.
const FLOOD_LAYERS = [
  { bbox: [43.55, -80.2, 44.15, -78.8], name: 'Toronto and Region Conservation Authority (TRCA) — Regulation Limit', url: 'https://services1.arcgis.com/d0ZCwU7eGKVeNiEE/ArcGIS/rest/services/TRCA_Regulation_Limit2/FeatureServer/0/query', map: 'https://trca.ca/planning-permits/' },
  { bbox: [43.85, -79.9, 44.9, -77.9], name: 'Kawartha / Otonabee / Lake Simcoe Region CA — Regulated Area', url: 'https://services3.arcgis.com/RQBDTPtsbT0jebs7/ArcGIS/rest/services/Regulated_Area_AGOL/FeatureServer/0/query', map: 'https://www.lsrca.on.ca/' },
];

async function layerHit(layer, lat, lon, distance) {
  const p = new URLSearchParams({ f: 'json', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnCountOnly: 'true' });
  if (distance) { p.set('distance', String(distance)); p.set('units', 'esriSRUnit_Meter'); }
  const d = await fetchJSON(`${layer.url}?${p}`, {}, 20000);
  if (d.error) throw new Error(d.error.message);
  return d.count || 0;
}

export async function floodCheck(loc, osm) {
  const inBox = L => !L.bbox || (loc.lat >= L.bbox[0] && loc.lon >= L.bbox[1] && loc.lat <= L.bbox[2] && loc.lon <= L.bbox[3]);
  const results = await Promise.all(FLOOD_LAYERS.filter(inBox).map(async L => {
    try {
      const [inside, near] = await Promise.all([layerHit(L, loc.lat, loc.lon, 0), layerHit(L, loc.lat, loc.lon, 100)]);
      return { ...L, inside: inside > 0, near: near > 0, ok: true };
    } catch (e) { return { ...L, ok: false, error: e.message }; }
  }));
  const water = osm.water.map(w => ({ ...w, d: distToPolyline(loc.lat, loc.lon, w.pts) })).filter(w => isFinite(w.d)).sort((a, b) => a.d - b.d);
  const nearestWater = water[0];
  const inside = results.some(r => r.inside), near = results.some(r => r.near);
  let level = covered ? 'good' : 'unknown', label = covered ? 'Not in a mapped regulated area' : 'Outside the conservation-authority layers checked here';
  if (inside) { level = 'bad'; label = 'Inside a Conservation Authority regulated area (flood/erosion hazard)'; }
  else if (near) { level = 'warn'; label = 'Within 100 m of a regulated hazard area'; }
  else if (nearestWater && nearestWater.d < 150) { level = 'warn'; label = `Watercourse ${Math.round(nearestWater.d)} m away`; }
  const covered = results.some(r => r.ok);
  return { level, label, layers: results, nearestWater, covered };
}

export function powerLineCheck(loc, osm) {
  const lines = osm.powerLines.map(l => ({ ...l, d: distToPolyline(loc.lat, loc.lon, l.pts) })).sort((a, b) => a.d - b.d);
  const subs = osm.substations.map(s => ({ ...s, d: haversine(loc.lat, loc.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d);
  const transmission = lines.filter(l => l.kind === 'line');
  const nearestTx = transmission[0], nearestAny = lines[0], nearestSub = subs[0];
  let level = 'good', label = 'No mapped overhead lines within 600 m';
  if (nearestTx && nearestTx.d < 100) { level = 'bad'; label = `High-voltage transmission line ${Math.round(nearestTx.d)} m away`; }
  else if (nearestTx && nearestTx.d < 300) { level = 'warn'; label = `Transmission line ${Math.round(nearestTx.d)} m away`; }
  else if (nearestAny && nearestAny.d < 30) { level = 'warn'; label = `Overhead distribution line ${Math.round(nearestAny.d)} m away`; }
  else if (nearestAny) { level = 'ok'; label = `Nearest mapped line ${Math.round(nearestAny.d)} m away`; }
  if (nearestSub && nearestSub.d < 150 && level === 'good') { level = 'warn'; label = `Substation ${Math.round(nearestSub.d)} m away`; }
  return { level, label, lines: lines.slice(0, 8), nearestTx, nearestSub };
}

export async function radonCheck(loc) {
  const d = await cached('radon', () => fetchJSON('data/radon-ontario.json'));
  const fields = [loc.address?.city, loc.address?.town, loc.address?.village, loc.municipality, loc.address?.county, loc.county, loc.address?.state_district]
    .filter(Boolean).map(s => s.toLowerCase());
  const pairs = Object.entries(d.match).flatMap(([unit, toks]) => toks.map(t => [t, unit])).sort((a, b) => b[0].length - a[0].length);
  let unit = null;
  outer: for (const f of fields) for (const [tok, u] of pairs) {
    if (f === tok || new RegExp(`(^|\\b)${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`).test(f)) { unit = u; break outer; }
  }
  const v = unit ? d.units[unit] : null;
  const pct = v ? v[0] : d.ontario.ge200;
  const level = pct >= 10 ? 'bad' : pct >= 5 ? 'warn' : 'ok';
  return { unit, ge200: v?.[0] ?? null, r100_200: v?.[1] ?? null, ontario: d.ontario, level,
    label: unit ? `${pct.toFixed(1)}% of tested homes in ${unit} were ≥ 200 Bq/m³` : `Ontario average: ${pct}% of tested homes ≥ 200 Bq/m³`,
    source: d.source, url: d.url, note: d.note };
}

// Age-based building risks. year = year built (number) or null; type = 'house' | 'condo'
export function ageRisks(year, type) {
  const y = Number(year) || null;
  const R = (name, level, detail, action) => ({ name, level, detail, action });
  const unknown = (name, detail, action) => R(name, 'unknown', detail, action);
  if (!y) {
    return [
      unknown('Asbestos', 'Possible in homes built before ~1990 (vermiculite attic insulation, pipe/duct wrap, textured ceilings, tiles).', 'Enter the year built for an age-based assessment.'),
      unknown('Lead paint', 'Homes built before 1960 likely have lead paint; 1960–1990 may have some.', 'Enter the year built.'),
      unknown('Outdated wiring', 'Knob-and-tube (pre-1950), aluminum branch wiring (c. 1965–1978), 60 A service (older homes).', 'Enter the year built.'),
      unknown('Outdated plumbing', 'Lead service lines (pre-1955), galvanized steel (pre-1970s), Poly-B (c. 1978–1997), Kitec (c. 1995–2007).', 'Enter the year built.'),
    ];
  }
  const out = [];
  out.push(y < 1990
    ? R('Asbestos', y < 1980 ? 'bad' : 'warn', `Built ${y}: asbestos-containing materials were common until the late 1980s (vermiculite insulation, pipe & duct wrap, popcorn ceilings, floor tiles, plaster).`, 'Ask the seller; if renovating, get a pre-renovation asbestos survey. Don’t disturb suspect materials.')
    : R('Asbestos', 'good', `Built ${y}: asbestos use had largely ended.`, 'Low concern unless older materials were reused.'));
  out.push(y < 1960
    ? R('Lead paint', 'bad', `Built ${y}: Health Canada advises homes built before 1960 likely contain lead-based paint.`, 'Test before sanding or renovating, especially with children or pregnancy in the home.')
    : y < 1990 ? R('Lead paint', 'warn', `Built ${y}: homes built 1960–1990 may contain some lead paint (interior paint lead limits tightened over this period).`, 'Test painted surfaces before renovation.')
    : R('Lead paint', 'good', `Built ${y}: low likelihood of lead paint.`, '—'));
  const wiring = [];
  let wl = 'good';
  if (y < 1950) { wiring.push('knob-and-tube wiring possible'); wl = 'bad'; }
  if (y >= 1965 && y <= 1978) { wiring.push('aluminum branch wiring possible'); wl = 'bad'; }
  if (y < 1975) { wiring.push('60–100 A service and few grounded outlets common'); wl = wl === 'bad' ? 'bad' : 'warn'; }
  if (y < 1990 && !wiring.length) { wiring.push('panel may be near end of life'); wl = 'warn'; }
  out.push(R('Outdated wiring', wl, wiring.length ? `Built ${y}: ${wiring.join('; ')}.` : `Built ${y}: modern wiring expected.`,
    wl === 'good' ? 'Standard inspection.' : 'Get an ESA-licensed electrical contractor inspection; many insurers decline knob-and-tube or ungrounded/aluminum wiring without remediation.'));
  const pl = [];
  let pll = 'good';
  if (y < 1955) { pl.push('lead water service line possible (check municipal records / Toronto lead pipe program)'); pll = 'bad'; }
  if (y < 1975) { pl.push('galvanized steel supply pipes and cast-iron/clay drains possible'); pll = pll === 'bad' ? 'bad' : 'warn'; }
  if (y >= 1978 && y <= 1997) { pl.push('polybutylene (Poly-B) supply lines possible'); pll = 'warn'; }
  if (y >= 1995 && y <= 2007) { pl.push('Kitec (PEX-AL-PEX with brass fittings) possible'); pll = 'warn'; }
  out.push(R('Outdated plumbing', pll, pl.length ? `Built ${y}: ${pl.join('; ')}.` : `Built ${y}: modern copper/PEX expected.`,
    pll === 'good' ? 'Standard inspection.' : 'Ask for a sewer-line camera scope and confirm supply-pipe material; check insurer requirements.'));
  if (type === 'condo') out.forEach(r => { r.action += ' For condos, review the status certificate and reserve fund study for building-wide systems.'; });
  return out;
}

export function vegetationCheck(loc, osm, type) {
  const trees = osm.trees, woods = osm.woods;
  const level = trees >= 6 || woods ? 'warn' : trees >= 1 ? 'ok' : 'good';
  const label = woods ? 'Wooded area within 80 m' : trees ? `${trees} mapped tree(s) within 40 m` : 'No mapped trees within 40 m (OSM tree mapping is incomplete)';
  const checklist = [
    'Branches at least ~3 m (10 ft) from roof, chimney and gutters',
    'No limbs touching or overhanging the service drop (wire from pole to house) — the utility handles line clearing',
    'Large trees close to foundation or sewer lateral (root intrusion) — ask for a sewer camera scope',
    'Dead/leaning trees that could fall on the house',
    /toronto/i.test(loc.municipality) ? 'Toronto: a permit is required to remove or injure a private tree 30 cm or more in diameter' : 'Check your municipality’s private tree by-law before removing large trees',
  ];
  if (type === 'condo') checklist.splice(0, checklist.length, 'Common-element landscaping is the condo corporation’s responsibility — review the reserve fund study');
  return { level, label, trees, woods, checklist };
}

export function guttersCheck(loc, year, type) {
  const items = [
    'Gutters clean, sloped to downspouts, no sagging, leaks or overflow stains on siding',
    'Downspouts discharge well away from the foundation (≈1.8 m / 6 ft is a common guideline) onto a splash pad, not onto a neighbour’s property',
    'Grading slopes away from the house; no pooling near basement windows',
    'Look for efflorescence or water staining in the basement, and ask about past basement flooding',
    'Gutter guards / ice-damming history on north-facing eaves',
  ];
  if (/toronto/i.test(loc.municipality)) items.splice(2, 0, 'Toronto: downspouts must be disconnected from the sewer system (mandatory downspout disconnection by-law) — check for any still connected');
  if (type === 'condo') return { level: 'ok', label: 'Building-managed (condo)', items: ['Roof drainage and exterior envelope are common elements — review the status certificate, reserve fund study and any special assessments'] };
  const old = Number(year) && Number(year) < 1980;
  return { level: old ? 'warn' : 'ok', label: old ? 'Older home — check drainage and connections closely' : 'Inspect during viewing', items };
}
