// Transit availability score (0-100) computed from OpenStreetMap stops, stations and routes.
// Not the Walk Score® Transit Score — an open, explainable alternative.
import { haversine, clamp } from './util.js';

const RAPID = new Set(['subway', 'train', 'light_rail', 'monorail']);

function stationMode(s) {
  const t = s.tags || {};
  if (t.amenity === 'bus_station' || (t.bus === 'yes' && !t.railway && t.train !== 'yes' && t.subway !== 'yes')) return 'bus_terminal';
  if (t.station === 'subway' || t.subway === 'yes') return 'subway';
  if (t.station === 'light_rail' || t.light_rail === 'yes') return 'light_rail';
  if (t.railway === 'station' || t.railway === 'halt' || t.train === 'yes') return 'train';
  return s.mode || 'train';
}

export function scoreTransit(loc, osm) {
  const { lat, lon } = loc;
  const stations = osm.stations.map(s => ({ ...s, mode: stationMode(s), d: haversine(lat, lon, s.lat, s.lon) }));
  // Drop rail platforms from "stops" (their station is counted separately)
  const stops = osm.stops
    .filter(s => !(s.tags.railway === 'platform' || s.tags.train === 'yes' || s.tags.subway === 'yes'))
    .map(s => ({ ...s, d: haversine(lat, lon, s.lat, s.lon) }));

  // de-duplicate rapid stations that share a name (OSM often has station node + area)
  const rapidByName = new Map();
  for (const s of stations.filter(s => RAPID.has(s.mode))) {
    const k = (s.name || '').toLowerCase() + '|' + s.mode;
    if (!rapidByName.has(k) || rapidByName.get(k).d > s.d) rapidByName.set(k, s);
  }
  const rapid = [...rapidByName.values()].sort((a, b) => a.d - b.d);
  const nearestRapid = rapid[0];

  const busStops400 = stops.filter(s => s.mode === 'bus' && s.d <= 400);
  const tramStops400 = stops.filter(s => s.mode === 'tram' && s.d <= 400);
  const terminals = stations.filter(s => s.mode === 'bus_terminal' && s.d <= 800);
  const routes = osm.routes;
  const routeKey = r => `${r.mode}:${r.ref || r.name}`;
  const uniqueRoutes = [...new Map(routes.map(r => [routeKey(r), r])).values()];
  const rapidRoutes = uniqueRoutes.filter(r => RAPID.has(r.mode));

  // Scoring components
  const rapidPts = nearestRapid ? clamp(40 * (1 - (nearestRapid.d - 300) / 1200), 0, 40) : 0;
  const routePts = clamp(uniqueRoutes.length * 3, 0, 30);
  const stopPts = clamp(busStops400.length * 2 + tramStops400.length * 4, 0, 20);
  const extraPts = clamp(terminals.length * 5 + (rapid.length > 1 ? 5 : 0), 0, 10);
  const score = Math.round(clamp(rapidPts + routePts + stopPts + extraPts, 0, 100));

  const label = score >= 85 ? 'Excellent transit' : score >= 70 ? 'Very good transit' : score >= 50 ? 'Good transit' : score >= 25 ? 'Some transit' : 'Minimal transit';
  const level = score >= 70 ? 'good' : score >= 50 ? 'ok' : score >= 25 ? 'warn' : 'bad';

  return {
    score, label, level,
    components: { rapidPts: Math.round(rapidPts), routePts, stopPts, extraPts },
    nearestRapid, rapid: rapid.slice(0, 6), busStops400: busStops400.length, tramStops400: tramStops400.length,
    terminals, routes: uniqueRoutes.sort((a, b) => (RAPID.has(b.mode) - RAPID.has(a.mode)) || String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true })),
    rapidRoutes,
    stops: stops.filter(s => s.d <= 500),
  };
}
