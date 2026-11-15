/**
 * REALTOR.ca DDF® proxy — Cloudflare Worker (free tier is enough).
 *
 * Why: the DDF® Web API needs OAuth client credentials from a CREA DDF® data feed.
 * CREA requires server-to-server token requests, so the credentials can't live in the
 * static GitHub Pages site. This Worker holds them as secrets and exposes one read-only,
 * CORS-restricted endpoint to your site.
 *
 * Setup:
 *   npm i -g wrangler
 *   wrangler init ddf-proxy   (use this file as src/index.js)
 *   wrangler secret put DDF_CLIENT_ID       # DDF® data feed username
 *   wrangler secret put DDF_CLIENT_SECRET   # DDF® data feed password
 *   wrangler secret put ALLOWED_ORIGIN      # e.g. https://<user>.github.io
 *   wrangler deploy
 * Then paste the Worker URL into the site's ⚙ settings.
 *
 * Compliance (CREA DDF® Policy & Rules): show the listing brokerage, link back to the
 * listing on REALTOR.ca ("Powered by REALTOR.ca"), keep data current, and only use the
 * feed for purposes your DDF® agreement permits. DDF® contains active listings only.
 */
const TOKEN_URL = 'https://identity.crea.ca/connect/token';
const API = 'https://ddfapi.realtor.ca/odata/v1';
let tokenCache = { value: null, exp: 0 };

async function getToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.DDF_CLIENT_ID, client_secret: env.DDF_CLIENT_SECRET, scope: 'DDFApi_Read' });
  const r = await fetch(TOKEN_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return tokenCache.value;
}

function cors(env, res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
    if (req.method !== 'GET') return cors(env, json({ error: 'GET only' }, 405));
    const origin = req.headers.get('Origin');
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'origin not allowed' }, 403);
    try {
      if (url.pathname === '/listing') {
        const mls = (url.searchParams.get('mls') || '').replace(/[^A-Za-z0-9]/g, '');
        if (!mls) return cors(env, json({ error: 'mls required' }, 400));
        const token = await getToken(env);
        const q = `${API}/Property?$filter=ListingId eq '${mls}'&$top=1`;
        const r = await fetch(q, { headers: { Authorization: `Bearer ${token}` } });
        return cors(env, json(await r.json(), r.status));
      }
      return cors(env, json({ ok: true, endpoints: ['/listing?mls=<MLS number>'] }));
    } catch (e) {
      return cors(env, json({ error: String(e.message || e) }, 502));
    }
  },
};
