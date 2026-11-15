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

async function nominatim(q) {
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=5&countrycodes=ca&viewbox=${ON_VIEWBOX}&q=${encodeURIComponent(q)}`;
  return cached('nom:' + q, () => fetchJSON(url, { headers: { 'Accept-Language': 'en-CA' } }, 20000));
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
