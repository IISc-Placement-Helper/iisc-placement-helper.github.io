// Per-student OCCaP status for "My status": encrypt the records and ship them as the `status` release asset.
// The records and the key never go in git; the asset is AES-256-GCM ciphertext that only the site's API can open.
//   node tools/status.mjs --refresh       run the ingest, then encrypt and upload if the records changed (the usual command)
//   node tools/status.mjs --upload        encrypt and upload the current records (if changed; --force to upload anyway)
//   node tools/status.mjs --out <file>    only write the encrypted file
//   node tools/status.mjs --show-key      print STATUS_KEY for the Azure app setting (never paste it anywhere public)
// --dir <folder>: where status_ingest.py and status/records.json live (default ../_work/hq_public, outside the repo).
// --records <file>, --key-file <file> (default .status-key, git-ignored, created on first use), --repo owner/name, --python <exe>.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { github } from './release.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; }, flag = n => argv.includes('--' + n);
const die = m => { console.error('status: ' + m); process.exit(1); };
const { seal, open } = createRequire(import.meta.url)('../api/shared/status.js');

const keyFile = resolve(opt('key-file') || join(ROOT, '.status-key'));
const key = () => {
  if (!existsSync(keyFile)) {
    writeFileSync(keyFile, randomBytes(32).toString('base64') + '\n');
    console.log('New status key saved in ' + keyFile + ' (git-ignored). Back it up, and put it in the Azure app setting STATUS_KEY.');
  }
  return readFileSync(keyFile, 'utf8').trim();
};
if (flag('show-key')) { console.log(key()); process.exit(0); }

const dir = resolve(opt('dir') || join(ROOT, '..', '_work', 'hq_public'));
const recFile = resolve(opt('records') || join(dir, 'status', 'records.json')), sent = join(dirname(recFile), '.uploaded');
if (flag('refresh')) {
  const py = opt('python') || process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(py, [join(dir, 'status_ingest.py'), '--records', recFile], { stdio: 'inherit' });
  if (r.status !== 0) die('the ingest failed; nothing uploaded');
}
if (!existsSync(recFile)) die('no records at ' + recFile + ': run the ingest first (--refresh)');
const text = readFileSync(recFile, 'utf8'), recs = JSON.parse(text);

// What may leave this machine, even encrypted: IISc addresses as keys, entries without phone numbers.
const EMAIL = /^[a-z0-9][a-z0-9._%+'-]*@iisc\.ac\.in$/, PHONE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/;
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
