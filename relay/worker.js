// Sync relay (Cloudflare Worker + D1): one opaque ciphertext blob per 64-hex id, compare-and-swap on ver.
// It never sees a key or plaintext. env.DB = D1 binding, env.ORIGIN = the site origin allowed by CORS.
const MAX = 256 * 1024, LIMIT = 120, HOUR = 3600000;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin'), ok = !!origin && origin === env.ORIGIN;
    const cors = ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT, OPTIONS',
      'access-control-allow-headers': 'content-type, if-none-match', 'access-control-max-age': '86400', vary: 'Origin' } : { vary: 'Origin' };
    const json = (body, status, h = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors, ...h } });
    if (origin && !ok) return json({ error: 'origin not allowed' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const m = /^\/v1\/b\/([0-9a-f]{64})$/.exec(new URL(req.url).pathname);
    if (!m) return json({ error: 'not found' }, 404);
    const id = m[1], get = () => env.DB.prepare('SELECT ver, data, wcount, wstart FROM blobs WHERE id = ?').bind(id).first();
    const row = await get();

    if (req.method === 'GET') {
      if (!row) return json({ error: 'not found' }, 404);
      const etag = `"${row.ver}"`;
      if ((req.headers.get('if-none-match') || '').replace(/[^\d]/g, '') === String(row.ver)) return new Response(null, { status: 304, headers: { ...cors, etag } });
      return json({ ver: row.ver, data: row.data }, 200, { etag });
    }
    if (req.method !== 'PUT') return json({ error: 'method not allowed' }, 405);

    if (+(req.headers.get('content-length') || 0) > MAX + 1024) return json({ error: 'too large' }, 413);
    const text = await req.text();
    if (text.length > MAX + 1024) return json({ error: 'too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    const { base, data } = body || {};
    if (!Number.isInteger(base) || base < 0 || typeof data !== 'string' || !/^[A-Za-z0-9_-]+$/.test(data)) return json({ error: 'bad body' }, 400);
    if (data.length > MAX) return json({ error: 'too large' }, 413);

    // Fixed one-hour window per id; only successful writes count.
    const now = Date.now(), fresh = !row || now - row.wstart >= HOUR, wcount = fresh ? 1 : row.wcount + 1, wstart = fresh ? now : row.wstart;
    if (wcount > LIMIT) return json({ error: 'too many writes' }, 429, { 'retry-after': String(Math.ceil((wstart + HOUR - now) / 1000)) });
    const r = row
      ? await env.DB.prepare('UPDATE blobs SET ver = ver + 1, data = ?, wcount = ?, wstart = ? WHERE id = ? AND ver = ?').bind(data, wcount, wstart, id, base).run()
      : base === 0 ? await env.DB.prepare('INSERT INTO blobs (id, ver, data, wcount, wstart) VALUES (?, 1, ?, 1, ?) ON CONFLICT(id) DO NOTHING').bind(id, data, now).run()
      : null;
    if (!r || !r.meta.changes) { const cur = await get(); return json(cur ? { ver: cur.ver, data: cur.data } : { ver: 0, data: '' }, 409); }
    return json({ ver: row ? base + 1 : 1 }, 200);
  },
};
