// Per-student OCCaP status for "My status": encrypt the records and ship them as the `status` release asset, and
// make each student's personal code. The records, the key, the code secret and the codes never go in git; the asset
// is AES-256-GCM ciphertext that only the site's API can open.
//   node tools/status.mjs --refresh       run the ingest, then encrypt and upload if the records changed (the usual command)
//   node tools/status.mjs --upload        encrypt and upload the current records (if changed; --force to upload anyway)
//   node tools/status.mjs --out <file>    only write the encrypted file
//   node tools/status.mjs --codes [--roster <csv>]   write status/codes.csv (email[,name],code) for the mail merge
//   node tools/status.mjs --show-key           print STATUS_KEY for the Azure app setting
//   node tools/status.mjs --show-code-secret   print CODE_SECRET for the Azure app setting
// Never paste the key, the code secret or the codes anywhere public.
// --dir <folder>: where status_ingest.py and status/ (records.json, codes.csv) live (default ../_work/hq_public,
// outside the repo). --records <file>, --key-file <file> (default .status-key), --code-secret-file <file> (default
// .code-secret): both git-ignored, created on first use, owner-only (see tools/secrets.mjs). --repo owner/name, --python <exe>.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { github } from './release.mjs';
import { secretFile } from './secrets.mjs';
import { parseDelim, toCsv } from '../core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; }, flag = n => argv.includes('--' + n);
const die = m => { console.error('status: ' + m); process.exit(1); };
const { seal, open, codeFor } = createRequire(import.meta.url)('../api/shared/status.js');
const EMAIL = /^[a-z0-9][a-z0-9._%+'-]*@iisc\.ac\.in$/, PHONE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/;
const b64 = () => randomBytes(32).toString('base64');

const keyFile = resolve(opt('key-file') || join(ROOT, '.status-key')), secFile = resolve(opt('code-secret-file') || join(ROOT, '.code-secret'));
const key = () => secretFile(keyFile, b64, `New status key saved in ${keyFile} (git-ignored). Back it up, and put it in the Azure app setting STATUS_KEY.`);
const codeSecret = () => secretFile(secFile, b64, `New code secret saved in ${secFile} (git-ignored). Back it up, and put it in the Azure app setting CODE_SECRET.`);
if (flag('show-key')) { console.log(key()); process.exit(0); }
if (flag('show-code-secret')) { console.log(codeSecret()); process.exit(0); }

const dir = resolve(opt('dir') || join(ROOT, '..', '_work', 'hq_public'));
const recFile = resolve(opt('records') || join(dir, 'status', 'records.json')), sent = join(dirname(recFile), '.uploaded');
const readRecs = () => JSON.parse(readFileSync(recFile, 'utf8'));

// The mail-merge file: every address in the records plus a roster (lower case, de-duplicated), one code each.
// Only counts go to the screen; the file stays next to the records, outside the repo.
if (flag('codes')) {
  const fromRecs = existsSync(recFile) ? Object.keys(readRecs().students || {}) : [], names = new Map();
  let rostered = 0, skipped = 0;
  if (opt('roster')) {
    if (!existsSync(opt('roster'))) die('no roster at ' + opt('roster'));
    const rows = parseDelim(readFileSync(opt('roster'), 'utf8')).filter(r => r.some(c => c.trim()));
    const head = (rows[0] || []).map(c => c.trim().toLowerCase()), ec = head.findIndex(c => /e-?mail/.test(c)), nc = head.findIndex(c => /name/.test(c));
    for (const r of ec >= 0 ? rows.slice(1) : rows) {
      const e = String(ec >= 0 ? r[ec] || '' : r.find(c => c.includes('@')) || '').replace(/[\s"'`]+/g, '').toLowerCase();
      if (!EMAIL.test(e)) { skipped++; continue; }
      rostered++;
      if (!names.has(e) || !names.get(e)) names.set(e, nc >= 0 ? String(r[nc] || '').replace(/\s+/g, ' ').trim() : '');
    }
  }
  if (!fromRecs.length && !names.size) die('no addresses: run the ingest first, or pass --roster <csv>');
  const all = [...new Set([...fromRecs, ...names.keys()])].sort(), s = codeSecret(), withNames = [...names.values()].some(Boolean);
  const csv = toCsv(all.map(email => withNames ? { email, name: names.get(email) || '', code: codeFor(s, email) } : { email, code: codeFor(s, email) }));
  const out = join(dir, 'status', 'codes.csv');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(out, 0o600);
  console.log(`codes: ${all.length} addresses (${fromRecs.length} from the records, ${rostered} roster rows, ${fromRecs.length + rostered - all.length} duplicates merged, ${skipped} roster rows skipped: not an IISc address) -> ${basename(out)} (local only; delete it after the mail merge)`);
  process.exit(0);
}

if (flag('refresh')) {
  const py = opt('python') || process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(py, [join(dir, 'status_ingest.py'), '--records', recFile], { stdio: 'inherit' });
  if (r.status !== 0) die('the ingest failed; nothing uploaded');
}
if (!existsSync(recFile)) die('no records at ' + recFile + ': run the ingest first (--refresh)');
const text = readFileSync(recFile, 'utf8'), recs = JSON.parse(text);

// What may leave this machine, even encrypted: IISc addresses as keys, entries without phone numbers.
if (recs.v !== 1 || !recs.students || typeof recs.students !== 'object') die('records: not a status records file');
const emails = Object.keys(recs.students), bad = emails.filter(e => !EMAIL.test(e));
if (bad.length) die(`records: ${bad.length} keys are not IISc addresses; fix the ingest`);
const looks = v => typeof v === 'string' ? PHONE.test(v) : v && typeof v === 'object' ? Object.entries(v).some(([n, x]) => n !== 'id' && looks(x)) : false;
if (looks(recs)) die('records: something looks like a phone number; nothing written');
const items = Object.values(recs.students).flat();
console.log(`records: ${emails.length} students, ${items.length} entries, ${(recs.lists || []).length} list columns; updated ${recs.updated}`);

const k = key(), file = seal(recs, k), body = JSON.stringify(file);
if (JSON.stringify(open(file, k)) !== JSON.stringify(recs)) die('round trip failed');
if (opt('out')) { writeFileSync(opt('out'), body); console.log(`${opt('out')}: ${(body.length / 1024).toFixed(0)} KB encrypted`); }

if (flag('upload') || flag('refresh')) {
  // Skip when these exact records (and key) were uploaded last time.
  const hash = createHash('sha256').update(text).update(createHash('sha256').update(k).digest()).digest('hex');
  if (!flag('force') && existsSync(sent) && readFileSync(sent, 'utf8').trim() === hash) { console.log('status: unchanged since the last upload; nothing to do.'); process.exit(0); }
  try {
    const gh = github(ROOT, opt('repo'));
    await gh.replaceAsset('status', 'status', { name: 'Encrypted status',
      body: 'AES-256-GCM ciphertext of per-student OCCaP entries for My status. Only the site\'s API holds the key.' }, Buffer.from(body), 'application/json');
    mkdirSync(dirname(sent), { recursive: true });
    writeFileSync(sent, hash + '\n');
    console.log(`status: uploaded to ${gh.repo} (release "status"); the API serves it within 5 minutes. No redeploy needed.`);
  } catch (e) { die(e.message); }
}
