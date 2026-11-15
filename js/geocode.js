// Address resolution: free-text address, REALTOR.ca listing URL, or lat,lon
import { fetchJSON, cached } from './util.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Ontario bounding box (approx) used to bias results
const ON_VIEWBOX = '-95.16,56.86,-74.32,41.67';

export function parseRealtorUrl(input) {
  // e.g. https://www.realtor.ca/real-estate/28912345/123-main-street-toronto-moss-park
  const m = String(input).match(/realtor\.ca\/real-estate\/(\d+)\/([a-z0-9-]+)/i);
  if (!m) return null;
  return { realtorId: m[1], slug: m[2], text: m[2].replace(/-/g, ' ') };
}

const PHOTON = 'https://photon.komoot.io/api/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A lookup that failed because the service was unreachable or busy, as opposed to "no such address"
export class LookupUnavailable extends Error {
  constructor(cause) { super('The address lookup service is not responding right now.'); this.name = 'LookupUnavailable'; this.cause = cause; }
}
const isServiceError = e => e?.name === 'AbortError' || e instanceof TypeError || /HTTP (429|5\d\d)/.test(e?.message || '');

// Retry once on a network error or busy reply (Nominatim allows 1 request/second; it rate-limits bursts)
async function withRetry(fn, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!isServiceError(e)) throw e;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

// Photon (komoot) is a second free OpenStreetMap geocoder; its answers are reshaped to look like Nominatim's
async function photon(q) {
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=43.7&lon=-79.4&bbox=-95.16,41.67,-74.32,56.86`;
  const d = await fetchJSON(url, {}, 15000);
  return (d.features || []).filter(f => f.properties?.countrycode === 'CA').map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    const address = { house_number: p.housenumber, road: p.street || (p.housenumber ? p.name : undefined), neighbourhood: p.district, suburb: p.locality, city: p.city, county: p.county, state: p.state, postcode: p.postcode, country: p.country };
    Object.keys(address).forEach(k => address[k] == null && delete address[k]);
    const display = [[p.housenumber, p.street].filter(Boolean).join(' ') || p.name, p.district, p.city, p.state, p.postcode, p.country].filter(Boolean).join(', ');
    return { lat, lon, display_name: display, type: p.osm_value, category: p.osm_key, address };
  });
}

// Nominatim first; if it can't be reached or is busy, Photon answers instead
async function nominatim(q) {
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=5&countrycodes=ca&viewbox=${ON_VIEWBOX}&q=${encodeURIComponent(q)}`;
  return cached('nom:' + q, async () => {
    try {
      return await withRetry(() => fetchJSON(url, { headers: { 'Accept-Language': 'en-CA' } }, 15000));
    } catch (e) {
      if (!isServiceError(e)) throw e;
      try { return await withRetry(() => photon(q)); } catch (e2) { throw new LookupUnavailable(e2); }
    }
  });
}

function pickOntario(results) {
  return (results || []).find(r => (r.address?.state || '').toLowerCase() === 'ontario') || null;
}

function shape(r, extra = {}) {
  const a = r.address || {};
  return {
    lat: +r.lat, lon: +r.lon,
    display: r.display_name,
    type: r.type,
    address: a,
    municipality: a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || '',
    community: a.suburb || a.city_district || a.borough || '',
    osmBuildingType: r.category === 'building' || r.class === 'building' ? r.type : '',
    county: a.county || a.state_district || '',
    postcode: a.postcode || '',
    ...extra,
  };
}

// Normalise MLS®-style addresses: "207 - 4101 SHEPPARD AVENUE E Toronto (Agincourt South-Malvern West), Ontario M1S3H3"
export function cleanAddress(raw) {
  let s = String(raw).trim();
  let unit = '';
  let m = s.match(/^\s*(?:unit|suite|apt\.?|ph|#)\s*([\w-]+)\s*[,-]?\s*/i);
  if (m) { unit = m[1]; s = s.slice(m[0].length); }
  m = s.match(/^\s*([A-Z]?\d+[A-Z]?)\s*-\s*(?=\d)/i); // "207 - 4101 ..." or "1201-55 ..."
  if (m) { unit = unit || m[1]; s = s.slice(m[0].length); }
  m = s.match(/[,\s]+(?:unit|suite|apt\.?|#)\s*([\w-]+)/i); // "4101 Sheppard Ave E, Unit 207"
  if (m) { unit = unit || m[1]; s = s.replace(m[0], ''); }
  s = s.replace(/\([^)]*\)/g, ' ')          // "(Agincourt South-Malvern West)" community names
       .replace(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i, '$1 $2')
       .replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
  return { query: s, unit };
}

export async function resolveLocation(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter an Ontario address, an MLS® listing URL from REALTOR.ca, or coordinates.');

  // Coordinates "43.65,-79.38"
  const ll = raw.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (ll) {
    const lat = +ll[1], lon = +ll[2];
    const rev = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}`, {}, 20000).catch(() => null);
    return shape(rev ? { ...rev, lat, lon } : { lat, lon, display_name: raw, address: {} }, { source: 'coordinates' });
  }

  const rurl = parseRealtorUrl(raw);
  if (rurl) {
    // Slugs end with a neighbourhood; try progressively shorter text until something in Ontario matches
    const words = rurl.text.split(' ');
    for (let n = words.length; n >= Math.min(4, words.length); n--) {
      const q = words.slice(0, n).join(' ') + ', Ontario';
      const hit = pickOntario(await nominatim(q));
      if (hit) return shape(hit, { source: 'realtor.ca', realtorId: rurl.realtorId, listingUrl: raw });
      await new Promise(r => setTimeout(r, 1100)); // Nominatim policy: max 1 request/second
    }
    throw new Error('Could not locate the address in that REALTOR.ca link. Paste the street address instead.');
  }

  const { query, unit } = cleanAddress(raw);
  const q = /ontario|\bON\b/i.test(query) ? query : `${query}, Ontario`;
  let hit = pickOntario(await nominatim(q));
  if (!hit) {
    // Retry without the postal code (OSM postal codes are often missing or different)
    const noPostal = q.replace(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i, '').replace(/\s+,/g, ',').trim();
    if (noPostal !== q) {
      await new Promise(r => setTimeout(r, 1100));
      hit = pickOntario(await nominatim(noPostal));
    }
  }
  if (!hit) throw new Error('No Ontario match for that address. Check spelling, or include the city and postal code.');
  return shape(hit, { source: 'address', unit, inputAddress: raw });
}
