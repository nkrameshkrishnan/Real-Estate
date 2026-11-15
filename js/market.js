// Market context + negotiation range from comparable sales (comps) the user adds.
// Sold-price data is not openly available in Ontario; comps come from the buyer's agent,
// HouseSigma/Zoocasa-type sites, or the MLS® System via a REALTOR®.
import { fetchJSON, cached, median, store } from './util.js';

export const loadMarket = () => cached('market', () => fetchJSON('data/market.json'));

export const TYPE_LABEL = { detached: 'Detached', semi: 'Semi-detached', townhouse: 'Freehold townhouse', condoTownhouse: 'Condo townhouse', condoApt: 'Condo apartment' };

const pct = (arr, p) => { const a = arr.filter(isFinite).sort((x, y) => x - y); if (!a.length) return NaN; const i = (a.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
const roundTo = v => !isFinite(v) ? NaN : Math.round(v / (v >= 1_000_000 ? 5000 : 1000)) * (v >= 1_000_000 ? 5000 : 1000);

export function compsKey(loc) { return `comps:${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`; }
export const getComps = loc => store.get(compsKey(loc), []);
export const setComps = (loc, comps) => store.set(compsKey(loc), comps);

export function parseCompsCsv(text) {
  // Accepts lines: address, sold price, sqft(optional), sold date(optional)
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').trim());
    const nums = parts.map(p => Number(p.replace(/[$,\s]/g, '')));
    const priceIdx = nums.findIndex(n => n > 50000);
    if (priceIdx < 0) return null;
    const sqftIdx = nums.findIndex((n, i) => i !== priceIdx && n >= 300 && n <= 15000);
    const date = parts.find(p => /\d{4}-\d{2}(-\d{2})?|\w{3,9}\s+\d{4}/.test(p)) || '';
    const address = parts.find((p, i) => i !== priceIdx && i !== sqftIdx && isNaN(nums[i]) && p !== date) || '';
    return { address, price: nums[priceIdx], sqft: sqftIdx >= 0 ? nums[sqftIdx] : null, date };
  }).filter(Boolean);
}

export function negotiate({ listPrice, type, sqft, dom, reductions, condition, comps, market }) {
  const L = Number(listPrice) || NaN;
  const notes = [];
  const prices = comps.map(c => +c.price).filter(isFinite);
  const ppsf = comps.filter(c => c.sqft > 0).map(c => c.price / c.sqft);
  let fair = NaN, low = NaN, high = NaN, basis = '', confidence = 'low';

  if (ppsf.length >= 3 && sqft > 0) {
    fair = median(ppsf) * sqft; low = pct(ppsf, 0.25) * sqft; high = pct(ppsf, 0.75) * sqft;
    basis = `median of ${ppsf.length} comps at $${Math.round(median(ppsf))}/sq ft × ${sqft} sq ft`;
    confidence = ppsf.length >= 5 ? 'high' : 'medium';
  } else if (prices.length >= 3) {
    fair = median(prices); low = pct(prices, 0.25); high = pct(prices, 0.75);
    basis = `median of ${prices.length} comparable sale prices`; confidence = prices.length >= 5 ? 'medium' : 'low';
  } else if (market?.averagePrice?.[type]) {
    fair = market.averagePrice[type]; low = fair * 0.85; high = fair * 1.15;
    basis = `${market.area} average ${TYPE_LABEL[type] || type} price (${market.period}) — add at least 3 comps for a meaningful estimate`;
    confidence = 'very low';
  }

  const cond = condition || market?.marketCondition || 'balanced';
  let disc = { buyers: 0.04, balanced: 0.02, sellers: 0 }[cond] ?? 0.02;
  const d = Number(dom) || 0;
  if (d > 60) { disc += 0.03; notes.push(`${d} days on market — the seller is likely motivated; ask why it hasn’t sold.`); }
  else if (d > 30) { disc += 0.015; notes.push(`${d} days on market — above-average time; more room to negotiate.`); }
  else if (d && d < 8) { disc -= 0.01; notes.push('Freshly listed — expect less flexibility for the first week or two.'); }
  const r = Math.min(Number(reductions) || 0, 3);
  if (r) { disc += 0.01 * r; notes.push(`${r} price reduction(s) so far — signals the list price was above what buyers would pay.`); }

  let anchor = isFinite(L) && isFinite(fair) ? Math.min(L, fair) : (isFinite(fair) ? fair : L);
  if (isFinite(L) && isFinite(fair)) {
    const gap = (L - fair) / fair;
    if (gap > 0.05) notes.push(`List price is ${(gap * 100).toFixed(1)}% above the comps-based value — negotiate from the comps, not the list price.`);
    else if (gap < -0.07) { notes.push(`List price is ${(-gap * 100).toFixed(1)}% below the comps-based value — this may be priced low to attract multiple offers (an "offer date"). Decide your maximum before offer night and consider a pre-emptive offer only with conditions you can live without.`); anchor = fair; disc = Math.min(disc, 0); }
  }
  const target = anchor * (1 - Math.max(disc, -0.02));
  const opening = target * 0.97;
  const walkAway = isFinite(high) ? Math.min(high, Math.max(target * 1.03, fair || 0)) : target * 1.03;

  notes.push('Ontario offers usually include conditions (financing, home inspection; status certificate review for condos). Fewer conditions strengthen an offer but shift risk to you.');
  return { fair: roundTo(fair), low: roundTo(low), high: roundTo(high), opening: roundTo(opening), target: roundTo(target), walkAway: roundTo(walkAway), basis, confidence, condition: cond, notes };
}
