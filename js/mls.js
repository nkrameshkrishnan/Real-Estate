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
