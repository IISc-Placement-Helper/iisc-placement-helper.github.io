// GET /api/status, pure parts: who is calling, opening the encrypted records, and keeping only the caller's
// entries. No network or logging of its own: the function passes fetch, the clock and a logger, and the tests
// pass fakes. Never log an email address, a name or anything from the records.
'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');

// The `status` release asset (AES-256-GCM ciphertext, written by tools/status.mjs). STATUS_URL overrides it.
const STATUS_URL = 'https://github.com/IISc-Placement-Helper/iisc-placement-helper.github.io/releases/download/status/status';
const AAD = 'hq-status-v1', TTL = 5 * 60 * 1000;
const EMAIL = /^[a-z0-9][a-z0-9._%+'-]*@iisc\.ac\.in$/;
const ITEM = ['id', 'kind', 'company', 'role', 'list', 'position', 'note', 'first_seen', 'withdrawn_from_list'];
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

// x-ms-client-principal: base64 JSON {identityProvider, userId, userDetails, userRoles}. The Free plan's built-in
// Microsoft sign-in accepts any Microsoft account, so the IISc rule is enforced here.
function principal(header) {
  const signIn = { status: 401, error: 'Sign in with your IISc Microsoft account first.' };
  if (!header) return signIn;
  let p;
  try { p = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8')); } catch { return signIn; }
  if (!p || typeof p !== 'object') return signIn;
  const email = String(p.userDetails || '').trim().toLowerCase();
  if (p.identityProvider !== 'aad' || !EMAIL.test(email))
    return { status: 403, error: 'My status works only with your IISc Microsoft account (yourname@iisc.ac.in). Sign out, then sign in with that account.' };
  return { status: 200, email };
}

function keyBytes(b64) {
  const k = Buffer.from(String(b64 || '').trim(), 'base64');
  if (k.length !== 32) throw new Error('STATUS_KEY must be 32 bytes in base64');
  return k;
}
// records -> gzip -> AES-256-GCM (12-byte IV, tag appended). {v, alg, iv, ct} in base64.
function seal(records, keyB64) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyBytes(keyB64), iv);
  c.setAAD(Buffer.from(AAD));
  const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(records)))), c.final(), c.getAuthTag()]);
  return { v: 1, alg: 'AES-256-GCM', iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function open(file, keyB64) {
  if (!file || file.v !== 1 || !file.iv || !file.ct) throw new Error('not a status file');
  const all = Buffer.from(file.ct, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', keyBytes(keyB64), Buffer.from(file.iv, 'base64'));
  d.setAAD(Buffer.from(AAD));
  d.setAuthTag(all.subarray(all.length - 16));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()])).toString('utf8'));
}

// Only the caller's entries, plus company-level facts every student can see on the OCCaP sheet anyway (which
// lists exist, which companies have published results, test and interview schedules). No other student's data.
function answer(records, email) {
  const r = records || {}, mine = Object.prototype.hasOwnProperty.call(r.students || {}, email) ? r.students[email] : [];
  return {
    email, updated: r.updated || null,
    items: (Array.isArray(mine) ? mine : []).map(it => pick(it, ITEM)),
    lists: (r.lists || []).map(x => pick(x, ['stage', 'company', 'role', 'list'])),
    results: (r.results || []).map(x => pick(x, ['company', 'slot'])),
    schedule: (r.schedule || []).map(x => pick(x, ['stage', 'company', 'date', 'time', 'mode', 'venue', 'tentative'])),
  };
}

// Fetch + decrypt with an in-memory cache; one fetch at a time; a stale copy beats an error.
function loader({ url, key, fetch, now = Date.now, ttl = TTL }) {
  let hit = null, at = 0, pending = null;
  return async () => {
    if (hit && now() - at < ttl) return hit;
    pending = pending || (async () => {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error('status file: HTTP ' + res.status);
      hit = open(await res.json(), key);
      at = now();
      return hit;
    })().finally(() => { pending = null; });
    try { return await pending; } catch (e) { if (hit) return hit; throw e; }
  };
}

const reply = (status, body) => ({ status, body: JSON.stringify(body),
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const header = (h, n) => !h ? '' : typeof h.get === 'function' ? h.get(n) : h[n] || h[n.toLowerCase()] || '';

// (request headers) -> {status, headers, body}. env is read on every call (STATUS_KEY, STATUS_URL).
function makeHandler({ env = process.env, fetch = globalThis.fetch, now = Date.now, log = () => {} } = {}) {
  let load = null, cfg = '';
  return async headers => {
    const who = principal(header(headers, 'x-ms-client-principal'));
    if (who.status !== 200) return reply(who.status, { error: who.error });
    const key = env.STATUS_KEY, url = env.STATUS_URL || STATUS_URL;
    if (!key) { log('status: STATUS_KEY is not set'); return reply(503, { error: 'My status is not set up yet. Try again later.' }); }
    if (!load || cfg !== url + '\n' + key) { load = loader({ url, key, fetch, now }); cfg = url + '\n' + key; }
    try { return reply(200, answer(await load(), who.email)); }
    catch (e) { log('status: ' + e.message); return reply(503, { error: 'Could not load the latest OCCaP lists. Try again in a few minutes.' }); }
  };
}

module.exports = { STATUS_URL, TTL, principal, seal, open, answer, loader, makeHandler };
