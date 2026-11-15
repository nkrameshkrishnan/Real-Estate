// MLS® listing details.
// Three sources, in order of preference:
//  1. REALTOR.ca DDF® Web API through YOUR proxy (needs CREA DDF® data-feed credentials, see proxy/ddf-worker.js).
//     DDF® credentials must never be placed in this static site — CREA requires server-to-server token requests.
//  2. A REALTOR.ca listing URL pasted into the search box (used to locate the address + link back).
//  3. Details typed in by the user (price, type, size, year built, days on market...).
import { fetchJSON, store } from './util.js';

export const settings = {
  get: () => store.get('settings', { ddfProxy: '' }),
  set: s => store.set('settings', s),
};

const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null; };

function guessType(subType = '', structure = '', ownership = '') {
  const s = `${subType} ${structure} ${ownership}`.toLowerCase();
  if (/apartment|condo.*apt|condominium apartment/.test(s)) return 'condoApt';
  if (/condo|strata/.test(s) && /town|row/.test(s)) return 'condoTownhouse';
  if (/semi/.test(s)) return 'semi';
  if (/town|row|attached/.test(s)) return 'townhouse';
  if (/condo/.test(s)) return 'condoApt';
  return 'detached';
}

export function normalizeDDF(p) {
  const subType = pick(p, 'PropertySubType', 'StructureType') || '';
  const listDate = pick(p, 'ListingContractDate', 'OriginalEntryTimestamp');
  const dom = listDate ? Math.max(0, Math.round((Date.now() - new Date(listDate)) / 86400000)) : null;
  return {
    mls: pick(p, 'ListingId'),
    listPrice: pick(p, 'ListPrice'),
    address: pick(p, 'UnparsedAddress') || [p.StreetNumber, p.StreetName, p.StreetSuffix].filter(Boolean).join(' '),
    city: pick(p, 'City'), postal: pick(p, 'PostalCode'),
    lat: pick(p, 'Latitude'), lon: pick(p, 'Longitude'),
    type: guessType(subType, Array.isArray(p.StructureType) ? p.StructureType.join(' ') : p.StructureType, p.CommonInterest),
    beds: pick(p, 'BedroomsTotal'), baths: pick(p, 'BathroomsTotalInteger'),
    sqft: pick(p, 'LivingArea', 'BuildingAreaTotal'),
    yearBuilt: pick(p, 'YearBuilt'),
    taxes: pick(p, 'TaxAnnualAmount'), fee: pick(p, 'AssociationFee'),
    dom, url: pick(p, 'ListingURL', 'MoreInformationLink'),
    brokerage: pick(p, 'ListOfficeName'),
    photo: p.Media?.[0]?.MediaURL || null,
    source: 'ddf',
  };
}

// Find the active DDF® listing at a geocoded address: listings near the point, matched on street number (and unit)
export async function findDDFByAddress(loc) {
  const { ddfProxy } = settings.get();
  if (!ddfProxy) return null;
  const d = await fetchJSON(`${ddfProxy.replace(/\/$/, '')}/nearby?lat=${loc.lat}&lon=${loc.lon}`, {}, 20000);
  const recs = d.value || [];
  const num = String(loc.address?.house_number || '').toLowerCase();
  const unit = String(loc.unit || '').toLowerCase();
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const street = norm(loc.address?.road).slice(0, 6);
  const hits = recs.filter(r => num && String(r.StreetNumber || '').toLowerCase() === num && (!street || norm(r.StreetName).startsWith(street.slice(0, 4)) || norm(r.UnparsedAddress).includes(street)));
  const best = (unit && hits.find(r => norm(r.UnitNumber) === norm(unit))) || (hits.length === 1 ? hits[0] : null);
  return best ? normalizeDDF(best) : (hits.length > 1 ? { many: hits.length } : null);
}

export async function fetchDDF(mls) {
  const { ddfProxy } = settings.get();
  if (!ddfProxy) throw new Error('No DDF® proxy configured. Open “Data sources & settings” to add one.');
  const d = await fetchJSON(`${ddfProxy.replace(/\/$/, '')}/listing?mls=${encodeURIComponent(mls)}`, {}, 20000);
  const rec = d.value?.[0] || d;
  if (!rec || !rec.ListingId) throw new Error(`MLS® ${mls} not found in your DDF® feed (DDF® only includes active listings shared by participating boards).`);
  return normalizeDDF(rec);
}

export const listingKey = loc => `listing:${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;
export const getListing = loc => store.get(listingKey(loc), {});
export const saveListing = (loc, l) => store.set(listingKey(loc), l);

// Parse text copied from a REALTOR.ca listing page (Ctrl/Cmd+A, Ctrl/Cmd+C on the listing, then paste).
// Copying a page you are viewing is not scraping: nothing is fetched from REALTOR.ca by this site.
export function parseListingText(text) {
  const t = '\n' + String(text || '').replace(/\r/g, '');
  const after = (label) => {
    const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*\\n\\s*([^\\n]+)`, 'i');
    const m = t.match(re); return m ? m[1].trim() : null;
  };
  const money = s => s == null ? null : Number(String(s).replace(/[^0-9.]/g, '')) || null;
  const out = { source: 'pasted' };
  const mls = t.match(/MLS®?\s*(?:Number|#)\s*:?\s*([A-Z]?\d{6,9})/i); if (mls) out.mls = mls[1].toUpperCase();
  const price = t.match(/\n\s*\$\s?([\d,]{5,})(?:\s*\n|\s*$)/) || t.match(/\$\s?([\d,]{5,})/); if (price) out.listPrice = money(price[1]);
  const addr = t.match(/\n\s*([^\n]+?)\s*\n\s*([^\n]+?),\s*Ontario\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i);
  if (addr) { out.address = addr[1].trim(); out.city = addr[2].replace(/\s*\([^)]*\)/, '').trim(); out.postal = addr[3].toUpperCase(); }
  // Fallback: the page title the bookmark sends first, e.g. "For sale: 1203 - 25 THE ESPLANADE, Toronto (Waterfront Communities), Ontario M5E1W5 - C1234567 | REALTOR.ca"
  if (!out.address) {
    const tt = t.match(/\n[^\n:]*:\s*(?:([A-Z0-9-]+)\s+-\s+)?([^,\n]+),\s*([^,(\n]+?)\s*(?:\([^)]*\))?,\s*Ontario\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i);
    if (tt) { out.address = tt[2].trim(); out.city = tt[3].trim(); out.postal = tt[4].toUpperCase(); if (tt[1]) out.unit = tt[1]; }
  }
  const building = (after('Building Type') || '').toLowerCase();
  const title = (after('Title') || '').toLowerCase();
  const condo = /condominium|strata/.test(title) || /maintenance fees/i.test(t);
  if (/apartment/.test(building)) out.type = 'condoApt';
  else if (/row|town/.test(building)) out.type = condo ? 'condoTownhouse' : 'townhouse';
  else if (/semi/.test(building) || /semi-detached/i.test(after('Style') || '')) out.type = 'semi';
  else if (/house|detached/.test(building)) out.type = condo ? 'condoTownhouse' : 'detached';
  else if (condo) out.type = 'condoApt';
  const sq = after('Square Footage') || (t.match(/([\d,]{3,5})\s*-\s*([\d,]{3,5})\s*\n\s*Square Feet/i) || [])[0];
  if (sq) { const nums = (sq.match(/[\d,]{3,6}/g) || []).map(n => Number(n.replace(/,/g, ''))).filter(n => n > 200 && n < 20000); if (nums.length) out.sqft = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length); if (nums.length === 2) out.sqftRange = `${nums[0]}–${nums[1]}`; }
  const beds = t.match(/\n\s*(\d+)\s*(?:\+\s*\d+)?\s*\n\s*Bedrooms/i); if (beds) out.beds = Number(beds[1]);
  const taxes = after('Annual Property Taxes'); if (taxes) out.taxes = money(taxes);
  const fee = after('Maintenance Fees'); if (fee) out.fee = money(fee);
  const dom = (after('Time on REALTOR.ca') || '').match(/(\d+)\s*day/i); if (dom) out.dom = Number(dom[1]);
  const built = after('Built in') || after('Year Built'); if (built && /\d{4}/.test(built)) out.yearBuilt = Number(built.match(/\d{4}/)[0]);
  const age = after('Age') || after('Approximate Age');
  if (!out.yearBuilt && age) { const est = yearFromAge(age); if (est) { out.yearBuilt = est.year; out.ageRange = est.range; out.yearBuiltNote = est.note; } }
  const brokerage = t.match(/\n\s*([^\n]+)\n\s*Brokerage\s*\n/i); if (brokerage) out.brokerage = brokerage[1].trim();
  const board = t.match(/Data provided by:\s*([^\n]+)/i); if (board) out.board = board[1].trim();
  const url = t.match(/https:\/\/www\.realtor\.ca\/real-estate\/\d+\/[a-z0-9-]+/i); if (url) out.url = url[0];
  return out;
}

// Many Ontario listings (TRREB especially) give an age range like "31-50", "6-15", "100+" or "New"
// instead of a year built. Convert it to a year so the age-based hazard checks can run.
// We use the OLDEST year in the range on purpose: asbestos, lead paint and wiring risks rise with age,
// so the oldest plausible year avoids understating them. Returns null if the text isn't an age.
export function yearFromAge(text, now = new Date().getFullYear()) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/\b(new|under construction|pre-?construction)\b/.test(t) && !/\d/.test(t)) {
    return { year: now, range: 'New', note: `Age given as “New”; using ${now}.` };
  }
  const m = t.match(/^(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})(?:\s*(?:yrs?|years?))?$/) || t.match(/^(\d{1,3})\s*\+(?:\s*(?:yrs?|years?))?$/) || t.match(/^(\d{1,3})\s*(?:yrs?|years?)$/);
  if (!m) return null;
  const lo = Number(m[1]), hi = m[2] != null ? Number(m[2]) : lo;
  if (hi < lo || hi > 250) return null;
  const year = now - hi, newest = now - lo;
  const plus = /\+/.test(t);
  const range = m[2] != null ? `${lo}–${hi} years` : plus ? `${lo}+ years` : `${lo} years`;
  const note = m[2] != null
    ? `Age given as ${range} (built c. ${year}–${newest}); using ${year}, the oldest in the range, so age-based risks aren’t understated. Replace with the exact year if you have it.`
    : plus ? `Age given as ${range}; using ${year} (built ${year} or earlier). Replace with the exact year if you have it.`
    : `Age given as ${range}; using ${year}.`;
  return { year, range, note };
}
