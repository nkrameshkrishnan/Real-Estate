// Nearby schools: OpenStreetMap locations enriched with the Ontario Ministry of Education
// publicly-funded schools list (board, grades, language) and Fraser Institute ratings.
import { fetchJSON, cached, haversine, normName, store } from './util.js';

const loadProvincial = () => cached('schools-on', () => fetchJSON('data/schools-on.json'));
const loadFraser = () => cached('fraser', () => fetchJSON('data/fraser.json').catch(() => ({ schools: [] })));

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

function sameCity(a, b) {
  const n = x => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
  return n(a) && n(b) && (n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a)));
}

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

export function fraserFor(fraserData, name, city) {
  const manual = store.get(fraserKey(name, city), null);
  if (manual) return { ...manual, source: 'you' };
  const k = normName(name);
  const hit = (fraserData.schools || []).find(s => normName(s.name) === k && (!s.city || sameCity(s.city, city)));
  return hit ? { ...hit, source: 'data/fraser.json' } : null;
}

export const fraserSearchUrl = name => `https://www.google.com/search?q=${encodeURIComponent(`site:compareschoolrankings.org "${name}"`)}`;

export async function schoolsNear(loc, osm) {
  const [idx, fraser] = await Promise.all([getIndex(), loadFraser()]);
  const list = osm.schools
    .map(s => {
      const prov = matchProvincial(idx, s, loc);
      const t = s.tags || {};
      const name = prov?.n || s.name;
      const city = prov?.c || t['addr:city'] || loc.municipality;
      const isPrivate = !prov && /private|independent/i.test(`${t.operator || ''} ${t['operator:type'] || ''} ${t['school:type'] || ''}`);
      return {
        id: s.id, name, osmName: s.name, lat: s.lat, lon: s.lon,
        d: haversine(loc.lat, loc.lon, s.lat, s.lon),
        level: guessLevel(name, t, prov),
        board: prov?.b || t.operator || '', type: prov?.t || (isPrivate ? 'Private' : ''),
        lang: prov?.lang || '', grades: prov?.g || t.grades || '', special: prov?.sp && prov.sp !== 'Not applicable' ? prov.sp : '',
        city, website: prov?.w || t.website || '', boardWebsite: prov?.bw || '', phone: prov?.ph || '',
        address: prov ? `${prov.st}, ${prov.c} ${prov.pc}` : [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
        publiclyFunded: !!prov, isPrivate,
        fraser: fraserFor(fraser, name, city),
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
    fraserEdition: fraser.edition,
  };
}

// Board "find your designated school" tools (catchment checks need the board's own lookup)
export function boardLocator(board) {
  if (/toronto dsb/i.test(board)) return { name: 'TDSB — Find your school by address', url: 'https://www.tdsb.on.ca/Find-your/School/By-Home-Address' };
  return null;
}
