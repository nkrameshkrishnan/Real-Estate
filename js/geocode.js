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
    county: a.county || a.state_district || '',
    postcode: a.postcode || '',
    ...extra,
  };
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

  const q = /ontario|\bON\b/i.test(raw) ? raw : `${raw}, Ontario`;
  let hit = pickOntario(await nominatim(q));
  if (!hit) {
    // Strip unit numbers like "1201-55 Main St" or "Unit 5,"
    const simplified = q.replace(/^\s*(unit|suite|apt|#)\s*\w+\s*,?\s*/i, '').replace(/^\s*\w+\s*-\s*(?=\d)/, '');
    if (simplified !== q) {
      await new Promise(r => setTimeout(r, 1100));
      hit = pickOntario(await nominatim(simplified));
    }
  }
  if (!hit) throw new Error('No Ontario match for that address. Check spelling, or include the city and postal code.');
  return shape(hit, { source: 'address' });
}
