// Neighbourhood Safety Index. Pluggable adapters per police service.
// Toronto: Toronto Police Service open data (Community Safety Indicators, ArcGIS FeatureServer, CORS-enabled).
import { fetchJSON, cached, clamp } from './util.js';

const TPS = 'https://services.arcgis.com/S9th0jAJ7bqgIRjw/ArcGIS/rest/services/Major_Crime_Indicators_Open_Data/FeatureServer/0/query';
const TORONTO_LAND_KM2 = 630.2;
const RADIUS_M = 500;
const WHERE = 'REPORT_DATE >= CURRENT_TIMESTAMP - 365';

async function tpsStats(params) {
  const p = new URLSearchParams({ f: 'json', where: WHERE, ...params });
  const d = await fetchJSON(`${TPS}?${p}`, {}, 30000);
  if (d.error) throw new Error(d.error.message || 'TPS query failed');
  return d.features.map(f => f.attributes);
}

const torontoAdapter = {
  id: 'tps',
  name: 'Toronto Police Service — Community Safety Indicators (last 12 months)',
  sourceUrl: 'https://data.torontopolice.on.ca/',
  covers(loc) {
    const fields = [loc.address?.city, loc.address?.town, loc.municipality, loc.county, loc.address?.state_district];
    return fields.some(f => /^(city of )?toronto$|^old toronto$/i.test(String(f || '').trim()));
  },
  async run(loc) {
    const count = JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]);
    const geo = { geometry: `${loc.lon},${loc.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', units: 'esriSRUnit_Meter' };
    const [local, city, hood] = await Promise.all([
      tpsStats({ ...geo, distance: String(RADIUS_M), outStatistics: count, groupByFieldsForStatistics: 'CSI_CATEGORY' }),
      cached('tps:city', () => tpsStats({ outStatistics: count, groupByFieldsForStatistics: 'CSI_CATEGORY' })),
      tpsStats({ ...geo, distance: '250', outStatistics: count, groupByFieldsForStatistics: 'NEIGHBOURHOOD_158' }).catch(() => []),
    ]);
    const areaKm2 = Math.PI * (RADIUS_M / 1000) ** 2;
    const cats = {};
    for (const r of city) cats[r.CSI_CATEGORY] = { city: r.n, local: 0 };
    for (const r of local) (cats[r.CSI_CATEGORY] ||= { city: 0, local: 0 }).local = r.n;
    const rows = Object.entries(cats).map(([cat, v]) => {
      const expected = v.city / TORONTO_LAND_KM2 * areaKm2;
      return { cat, local: v.local, expected, ratio: expected ? v.local / expected : 0 };
    }).sort((a, b) => b.local - a.local);
    const totalLocal = rows.reduce((s, r) => s + r.local, 0);
    const totalExpected = rows.reduce((s, r) => s + r.expected, 0);
    const ratio = totalExpected ? totalLocal / totalExpected : 0;
    // Index: 50 = city average density; each doubling of incidents costs 12 points
    const index = Math.round(clamp(50 - 12 * Math.log2(Math.max(ratio, 0.05)), 0, 100));
    const neighbourhood = hood.sort((a, b) => b.n - a.n)[0]?.NEIGHBOURHOOD_158 || '';
    const level = index >= 65 ? 'good' : index >= 45 ? 'ok' : index >= 30 ? 'warn' : 'bad';
    const label = index >= 65 ? 'Lower than city average' : index >= 45 ? 'Around city average' : index >= 30 ? 'Above city average' : 'Well above city average';
    return { index, level, label, ratio, totalLocal, rows, neighbourhood, radius: RADIUS_M,
      method: `Reported incidents (assault, break & enter, auto theft, robbery, theft over) within ${RADIUS_M} m in the past 12 months, compared with the city-wide average density. Busy commercial areas score lower because incidents are counted per area, not per resident.` };
  },
};

const ADAPTERS = [torontoAdapter];

// Links for regions without an adapter yet (open data portals of the police services)
export const OTHER_SOURCES = [
  { re: /peel|mississauga|brampton|caledon/i, name: 'Peel Regional Police', url: 'https://www.peelpolice.ca/' },
  { re: /york|vaughan|markham|richmond hill|newmarket|aurora/i, name: 'York Regional Police', url: 'https://www.yrp.ca/' },
  { re: /durham|pickering|ajax|whitby|oshawa|clarington/i, name: 'Durham Regional Police', url: 'https://www.drps.ca/' },
  { re: /halton|oakville|burlington|milton/i, name: 'Halton Regional Police', url: 'https://www.haltonpolice.ca/' },
  { re: /ottawa/i, name: 'Ottawa Police Service', url: 'https://www.ottawapolice.ca/' },
  { re: /hamilton/i, name: 'Hamilton Police Service', url: 'https://hamiltonpolice.on.ca/' },
];

export async function safetyFor(loc) {
  const a = ADAPTERS.find(x => x.covers(loc));
  if (!a) {
    const hay = [loc.municipality, loc.county, loc.display].join(' ');
    return { supported: false, links: OTHER_SOURCES.filter(s => s.re.test(hay)) };
  }
  return { supported: true, source: { name: a.name, url: a.sourceUrl }, ...(await a.run(loc)) };
}
