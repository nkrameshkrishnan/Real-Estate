// Shared helpers
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function fetchJSON(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const cache = new Map();
export function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn().catch(e => { cache.delete(key); throw e; }));
  return cache.get(key);
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Distance (m) from point to polyline [[lat,lon],...] using a local equirectangular projection
export function distToPolyline(lat, lon, pts) {
  if (!pts?.length) return Infinity;
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  const P = pts.map(([a, b]) => [(b - lon) * kx, (a - lat) * ky]);
  if (P.length === 1) return Math.hypot(...P[0]);
  let best = Infinity;
  for (let i = 0; i < P.length - 1; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[i + 1];
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? -(x1 * dx + y1 * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy));
  }
  return best;
}

export const fmtMoney = n => (n == null || isNaN(n)) ? '—' : n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
export const fmtDist = m => !isFinite(m) ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function median(arr) {
  const a = arr.filter(x => isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function normName(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(st\.?|saint)\b/g, 'st')
    .replace(/\b(ecole|elementaire|secondaire|catholique|publique|intermediaire|jr & sr|junior and senior|junior & senior|alternative|french immersion)\b/g, ' ')
    .replace(/\b(public school|ps|elementary school|catholic school|cs|catholic elementary school|ces|junior|jr|senior|sr|middle school|ms|secondary school|ss|collegiate institute|ci|high school|school|the|and|&|of|catholic|elementary|public|secondary|collegiate|institute|academy)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// Traffic-light helper
export function badge(level, text) {
  return `<span class="badge ${level}">${esc(text)}</span>`;
}
