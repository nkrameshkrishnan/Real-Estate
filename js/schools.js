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

function provRecord(p, loc, fraser, d, lat, lon, extra = {}) {
  const level = p.lvl || 'Unknown';
  const cities = [p.c, loc.community, loc.municipality, loc.address?.suburb, loc.address?.city_district].filter(Boolean);
  return {
    id: 'on:' + p.id, provId: p.id, name: p.n, osmName: '', lat, lon, d, level,
    board: p.b, type: p.t, lang: p.lang, grades: p.g, special: p.sp && p.sp !== 'Not applicable' ? p.sp : '',
    city: p.c, website: p.w, boardWebsite: p.bw, phone: p.ph, address: `${p.st}, ${p.c} ${p.pc}`,
    publiclyFunded: true, isPrivate: false,
    fraser: fraserFor(fraser, [p.n], cities, level), ...extra,
  };
}

// osm may be null when Overpass is unavailable: publicly funded schools still come from the bundled list.
export async function schoolsNear(loc, osm) {
  const [idx, fraser] = await Promise.all([getIndex(), getFraserIndex()]);
  const list = [];
  const usedProv = new Set();
  // 1. Publicly funded schools with bundled coordinates
  for (const p of idx.all) {
    if (p.y == null) continue;
    if (Math.abs(p.y - loc.lat) > 0.03 || Math.abs(p.x - loc.lon) > 0.045) continue;
    const d = haversine(loc.lat, loc.lon, p.y, p.x);
    if (d > 3000) continue;
    usedProv.add(p.id);
    list.push(provRecord(p, loc, fraser, d, p.y, p.x));
  }
  // 2. OpenStreetMap schools: fills gaps (private/independent schools, or schools without bundled coordinates)
  for (const s of osm?.schools || []) {
    const prov = matchProvincial(idx, s, loc);
    if (prov && usedProv.has(prov.id)) continue;
    const d = haversine(loc.lat, loc.lon, s.lat, s.lon);
    if (prov) { usedProv.add(prov.id); list.push(provRecord(prov, loc, fraser, d, s.lat, s.lon)); continue; }
    const t = s.tags || {};
    const level = guessLevel(s.name, t, null);
    const cities = [t['addr:city'], loc.community, loc.municipality, loc.address?.suburb].filter(Boolean);
    const isPrivate = /private|independent/i.test(`${t.operator || ''} ${t['operator:type'] || ''} ${t['school:type'] || ''}`);
    list.push({
      id: s.id, name: s.name, osmName: s.name, lat: s.lat, lon: s.lon, d, level,
      board: t.operator || '', type: isPrivate ? 'Private' : '', lang: '', grades: t.grades || '', special: '',
      city: t['addr:city'] || loc.municipality, website: t.website || '', boardWebsite: '', phone: '',
      address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
      publiclyFunded: false, isPrivate,
      fraser: fraserFor(fraser, [s.name, t.official_name].filter(Boolean), cities, level),
    });
  }
  const uniq = list
    .filter(s => s.d <= 3000 && !/board office|education centre|adult|continuing education/i.test(`${s.name} ${s.special}`))
    .sort((a, b) => a.d - b.d)
    .filter((s, i, arr) => arr.findIndex(u => normName(u.name) === normName(s.name) && Math.abs(u.d - s.d) < 400) === i);

  return {
    elementary: uniq.filter(s => s.level === 'Elementary').slice(0, 10),
    secondary: uniq.filter(s => s.level === 'Secondary').slice(0, 8),
    other: uniq.filter(s => s.level !== 'Elementary' && s.level !== 'Secondary').slice(0, 6),
    meta: idx.meta,
    all: uniq, // every school within 3 km, for picking the ones this address is zoned for
    fraserMeta: fraser.meta,
    osmAvailable: !!osm,
  };
}

// Search the provincial list by name, for a designated school that is farther than 3 km or not on the map
export async function searchSchools(q, loc) {
  const k = normName(q);
  if (k.length < 3) return [];
  const [idx, fraser] = await Promise.all([getIndex(), getFraserIndex()]);
  return idx.all
    .filter(p => normName(p.n).includes(k))
    .sort((a, b) => (cityCompatible(b.c, loc.municipality) - cityCompatible(a.c, loc.municipality)) || a.n.localeCompare(b.n))
    .slice(0, 8)
    .map(p => {
      const has = p.y != null;
      return provRecord(p, loc, fraser, has ? haversine(loc.lat, loc.lon, p.y, p.x) : null, has ? p.y : null, has ? p.x : null);
    });
}

// Which boards serve this address: for each school system, the board running most of the nearby schools
const SYSTEMS = [
  { key: 'en-pub', label: 'English public', test: s => s.type === 'Public' && s.lang !== 'French' },
  { key: 'en-cat', label: 'English Catholic', test: s => s.type === 'Catholic' && s.lang !== 'French' },
  { key: 'fr-pub', label: 'French public', test: s => s.type === 'Public' && s.lang === 'French' },
  { key: 'fr-cat', label: 'French Catholic', test: s => s.type === 'Catholic' && s.lang === 'French' },
];
export function boardsFor(schools) {
  const out = [];
  for (const sys of SYSTEMS) {
    const counts = new Map();
    for (const s of schools) if (s.publiclyFunded && s.board && sys.test(s)) {
      const c = counts.get(s.board) || { board: s.board, website: s.boardWebsite, n: 0, nearest: Infinity };
      c.n++; c.nearest = Math.min(c.nearest, s.d); counts.set(s.board, c);
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n || a.nearest - b.nearest)[0];
    if (best) out.push({ system: sys.label, board: best.board, locator: boardLocator(best.board), website: best.website });
  }
  return out;
}

// Board "find your designated school" tools (catchment checks need the board's own lookup)
// Each board's own "find your school by address" tool, where one is known; other boards link to their website
const LOCATORS = [
  [/^toronto dsb$/i, 'https://www.tdsb.on.ca/Find-your/School/By-Home-Address'],
  [/^toronto cdsb$/i, 'https://www.tcdsb.org/findmyschool'],
  [/^york region dsb$/i, 'https://schoollocator.yrdsb.ca/'],
  [/^halton dsb$/i, 'https://www.hdsb.ca/schools/find-local-school'],
  [/^durham dsb$/i, 'https://www.ddsb.ca/en/our-schools/find-a-school.aspx'],
  [/^ottawa csb$/i, 'https://www.ocsb.ca/our-schools/'],
  [/viamonde/i, 'https://csviamonde.ca/nos-ecoles/trouver-une-ecole/'],
];
export function boardLocator(board) {
  const hit = LOCATORS.find(([re]) => re.test(String(board || '').trim()));
  return hit ? { name: `${board}: find your school by address`, url: hit[1] } : null;
}
