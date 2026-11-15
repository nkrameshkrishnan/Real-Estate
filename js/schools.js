// Nearby schools: OpenStreetMap locations enriched with the Ontario Ministry of Education
// publicly-funded schools list (board, grades, language) and Fraser Institute ratings.
import { fetchJSON, cached, haversine, normName, store } from './util.js';

const loadProvincial = () => cached('schools-on', () => fetchJSON('data/schools-on.json'));
const loadFraser = () => cached('fraser', () => fetchJSON('data/fraser.json').catch(() => ({ elementary: [], secondary: [] })));

// Fraser lists schools by community ("Scarborough", "Thornhill"), the Ministry list by mailing city.
const CITY_GROUPS = [
  ['toronto', 'scarborough', 'north york', 'etobicoke', 'east york', 'york', 'agincourt', 'willowdale', 'don mills', 'west hill', 'rexdale', 'weston', 'islington', 'downsview', 'malvern', 'rouge'],
  ['vaughan', 'thornhill', 'concord', 'maple', 'woodbridge', 'kleinburg'],
  ['markham', 'thornhill', 'unionville', 'markham village', 'cornell'],
  ['mississauga', 'streetsville', 'port credit', 'meadowvale'],
  ['ottawa', 'kanata', 'nepean', 'orleans', 'gloucester', 'barrhaven', 'stittsville', 'manotick'],
  ['hamilton', 'stoney creek', 'ancaster', 'dundas', 'waterdown', 'binbrook'],
  ['richmond hill', 'oak ridges'], ['clarington', 'bowmanville', 'courtice', 'newcastle'],
];
const cityKey = c => String(c || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
function cityCompatible(a, b) {
  const x = cityKey(a), y = cityKey(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return CITY_GROUPS.some(g => g.includes(x) && g.includes(y));
}

let fraserIdx;
async function getFraserIndex() {
  if (fraserIdx) return fraserIdx;
  const d = await loadFraser();
  fraserIdx = { meta: d.meta || {}, byName: new Map(), legacy: d.schools || [] };
  for (const level of ['elementary', 'secondary']) for (const r of d[level] || []) {
    const k = level + ':' + normName(r[1]);
    if (!fraserIdx.byName.has(k)) fraserIdx.byName.set(k, []);
    fraserIdx.byName.get(k).push({ rank: r[0], name: r[1], city: r[2], rating: r[3], rating5: r[4], trend: r[5], level,
      total: level === 'elementary' ? d.meta?.elementaryTotal : d.meta?.secondaryTotal });
  }
  return fraserIdx;
}

let index;
async function getIndex() {
  if (index) return index;
  const d = await loadProvincial();
  index = new Map();
  for (const s of d.schools) {
    const k = normName(s.n);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(s);
  }
  index.meta = d.meta;
  index.all = d.schools;
  return index;
}

function sameCity(a, b) { return cityCompatible(a, b); }

function matchProvincial(idx, osm, loc) {
  const t = osm.tags || {};
  const city = t['addr:city'] || loc.municipality;
  const candNames = [osm.name, t.official_name, t.alt_name, t.short_name].filter(Boolean);
  for (const nm of candNames) {
    const list = idx.get(normName(nm));
    if (list?.length) return list.find(s => sameCity(s.c, city)) || (list.length === 1 ? list[0] : list[0]);
  }
  // Fuzzy: containment within same city
  const k = normName(osm.name);
  if (k.length < 4) return null;
  return idx.all.find(s => sameCity(s.c, city) && (normName(s.n).includes(k) || k.includes(normName(s.n)) && normName(s.n).length >= 4)) || null;
}

function guessLevel(name, tags, prov) {
  if (prov?.lvl) return prov.lvl;
  const s = `${name} ${tags['isced:level'] || ''} ${tags['school:level'] || ''}`.toLowerCase();
  if (/secondary|collegiate|high school|\bss\b|\bci\b|\b(2|3)\b/.test(s)) return 'Secondary';
  if (/elementary|public school|junior|middle|\bps\b|\bjr\b|primary|\b1\b/.test(s)) return 'Elementary';
  return 'Unknown';
}

export const fraserKey = (name, city) => `fraser:${normName(name)}|${String(city || '').toLowerCase()}`;

export function fraserFor(fi, names, cities, level) {
  const [name] = names;
  const manual = store.get(fraserKey(name, cities[0]), null);
  if (manual) return { ...manual, source: 'you' };
  const levels = level === 'Elementary' ? ['elementary'] : level === 'Secondary' ? ['secondary'] : ['elementary', 'secondary'];
  for (const lv of levels) for (const n of names) {
    const cands = fi.byName.get(lv + ':' + normName(n)) || [];
    const hit = cands.find(c => cities.some(ct => cityCompatible(c.city, ct)));
    if (hit) return { ...hit, rank: `${hit.rank}/${hit.total || '?'}`, source: 'fraser' };
  }
  const k = normName(name);
  const legacy = fi.legacy.find(s => normName(s.name) === k && (!s.city || cities.some(c => cityCompatible(s.city, c))));
  return legacy ? { ...legacy, source: 'data/fraser.json' } : null;
}

export const fraserSearchUrl = name => `https://www.google.com/search?q=${encodeURIComponent(`site:compareschoolrankings.org "${name}"`)}`;

export async function schoolsNear(loc, osm) {
  const [idx, fraser] = await Promise.all([getIndex(), getFraserIndex()]);
  const list = osm.schools
    .map(s => {
      const prov = matchProvincial(idx, s, loc);
      const t = s.tags || {};
      const name = prov?.n || s.name;
      const city = prov?.c || t['addr:city'] || loc.municipality;
      const level = guessLevel(name, t, prov);
      const cities = [prov?.c, t['addr:city'], loc.community, loc.municipality, loc.address?.suburb, loc.address?.city_district].filter(Boolean);
      const isPrivate = !prov && /private|independent/i.test(`${t.operator || ''} ${t['operator:type'] || ''} ${t['school:type'] || ''}`);
      return {
        id: s.id, name, osmName: s.name, lat: s.lat, lon: s.lon,
        d: haversine(loc.lat, loc.lon, s.lat, s.lon),
        level,
        board: prov?.b || t.operator || '', type: prov?.t || (isPrivate ? 'Private' : ''),
        lang: prov?.lang || '', grades: prov?.g || t.grades || '', special: prov?.sp && prov.sp !== 'Not applicable' ? prov.sp : '',
        city, website: prov?.w || t.website || '', boardWebsite: prov?.bw || '', phone: prov?.ph || '',
        address: prov ? `${prov.st}, ${prov.c} ${prov.pc}` : [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
        publiclyFunded: !!prov, isPrivate,
        fraser: fraserFor(fraser, [name, s.name, t.official_name].filter(Boolean), cities, level),
      };
    })
    // ignore colleges/admin buildings that slipped in, keep within 3 km
    .filter(s => s.d <= 3000 && !/board office|education centre|adult/i.test(s.name))
    .sort((a, b) => a.d - b.d);

  // De-duplicate (OSM can have node + building for the same school)
  const uniq = [];
  for (const s of list) if (!uniq.some(u => normName(u.name) === normName(s.name) && Math.abs(u.d - s.d) < 400)) uniq.push(s);

  return {
    elementary: uniq.filter(s => s.level === 'Elementary').slice(0, 10),
    secondary: uniq.filter(s => s.level === 'Secondary').slice(0, 8),
    other: uniq.filter(s => s.level !== 'Elementary' && s.level !== 'Secondary').slice(0, 6),
    meta: idx.meta,
    fraserMeta: fraser.meta,
  };
}

// Board "find your designated school" tools (catchment checks need the board's own lookup)
export function boardLocator(board) {
  if (/toronto dsb/i.test(board)) return { name: 'TDSB — Find your school by address', url: 'https://www.tdsb.on.ca/Find-your/School/By-Home-Address' };
  return null;
}
