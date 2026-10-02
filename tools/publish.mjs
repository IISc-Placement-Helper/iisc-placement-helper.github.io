// Encrypt the batch feed for the site. Neither the feed nor the key ever goes in git.
//   node tools/publish.mjs --feed <feed.json> --check <checker.js> [--upload --site https://<org>.github.io] [--new-key] [--key <k>] [--out <file>]
// --check (or HQ_FEED_CHECK): a privacy checker run as `node <checker> <feed.json>` on exactly what will be
//   encrypted; nothing is written unless it exits 0. Generic leak checks run here as well.
// Key: --key, else HQ_BATCH_KEY, else .batch-key in the repo root (git-ignored; created on first run, --new-key rotates).
// Output: feed.enc.json in the repo root (git-ignored), which `npx serve` serves for local testing.
// --upload [--repo owner/name]: replace the `feed` release asset and re-run the Pages workflow (GitHub REST API;
//   token from GITHUB_TOKEN or the git credential helper).
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sealFeed, openFeed, newBatchKey, TRACKS } from '../core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; }, flag = n => argv.includes('--' + n);
const die = m => { console.error('publish: ' + m); process.exit(1); };

const src = opt('feed') || process.env.HQ_FEED, check = opt('check') || process.env.HQ_FEED_CHECK;
if (!src) die('--feed <feed.json> is required');
if (!check || !existsSync(check)) die('--check <checker.js> is required: the feed is never encrypted without the privacy check');

// *_raw fields hold unreviewed free text: never shipped.
const strip = v => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.endsWith('_raw')).map(([k, x]) => [k, strip(x)])) : v;
const feed = strip(JSON.parse(readFileSync(src, 'utf8')));

const errs = [], cos = Array.isArray(feed.companies) ? feed.companies : [], DATE = /^\d{4}-\d\d-\d\d$/;
if (!cos.length) errs.push('companies must be a non-empty array');
for (const c of cos) {
  if (!c.slug || !c.company || !Array.isArray(c.roles)) { errs.push('bad entry ' + JSON.stringify(c).slice(0, 60)); continue; }
  if (c.deadline != null && !(/\+05:30$/.test(c.deadline) && !isNaN(Date.parse(c.deadline)))) errs.push('deadline must be ISO +05:30: ' + c.slug);
  for (const k of ['test', 'interview']) if (c[k] && !DATE.test(c[k].date)) errs.push(k + ' date ' + c.slug);
  for (const r of c.roles) if (!r.title || !TRACKS.includes(r.track)) errs.push(`role ${c.slug} "${r.title}" track ${r.track}`);
  if (new Set(c.roles.map(r => r.title)).size !== c.roles.length) errs.push('duplicate role titles ' + c.slug);
}
if (new Set(cos.map(c => c.slug)).size !== cos.length) errs.push('duplicate slugs');
for (const k of ['jds', 'skills', 'dsa']) if (!Array.isArray(feed[k])) errs.push(k + ' must be an array');
// Emails, phone numbers, local file paths: none belong in a shared feed.
const LEAK = /[\w.+-]+@[\w-]+\.[a-z]{2,}|\+91[\s-]?\d|(?<![\d,])[6-9]\d{9}(?!\d)|\b[A-Za-z]:[\\/]|[\\/]Users[\\/]|resume_variant/i;
const walk = (v, p) => {
  if (typeof v === 'string') { const i = v.search(LEAK); if (i >= 0) errs.push(`looks private at ${p}: ...${v.slice(Math.max(0, i - 20), i + 30)}...`); }
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p + '.' + k);
};
walk(feed, 'feed');
if (errs.length) die('feed rejected:\n  ' + errs.slice(0, 20).join('\n  '));

// The external check sees exactly the stripped feed that gets encrypted.
const tmp = mkdtempSync(join(tmpdir(), 'hq-')), plain = join(tmp, 'feed.json');
writeFileSync(plain, JSON.stringify(feed));
const ck = spawnSync(process.execPath, [check, plain], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
if (ck.status !== 0) die('privacy check failed (' + basename(check) + '); nothing written');

const keyFile = join(ROOT, '.batch-key');
let key = opt('key') || process.env.HQ_BATCH_KEY || (!flag('new-key') && existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
if (!key) {
  key = newBatchKey();
  writeFileSync(keyFile, key + '\n');
  console.log('New batch key saved in .batch-key (git-ignored). Back it up: without it you must send everyone a new link.');
}

const out = opt('out') || join(ROOT, 'feed.enc.json'), file = await sealFeed(key, feed);
if (JSON.stringify(await openFeed(key, file)) !== JSON.stringify(feed)) die('round trip failed');
writeFileSync(out, JSON.stringify(file));
console.log(`${basename(out)}: ${cos.length} entries, ${feed.jds.length} JDs, ${feed.dsa.length} DSA problems; ${(JSON.stringify(file).length / 1024).toFixed(0)} KB encrypted; updated ${file.updated}`);

const site = (opt('site') || process.env.HQ_SITE || 'http://localhost:4400').replace(/\/+$/, '');
if (flag('upload')) {
  if (basename(out) !== 'feed.enc.json') die('--upload needs the default output name');
  // GitHub REST API; token from GITHUB_TOKEN or the git credential helper (no gh CLI needed).
  const repo = opt('repo') || execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT }).toString().trim().replace(/^.*github\.com[/:]|\.git$/g, '');
  const token = process.env.GITHUB_TOKEN || (spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' }).stdout.toString().match(/^password=(.+)$/m) || [])[1];
  if (!token) die('no GitHub token: set GITHUB_TOKEN or sign in to git once');
  const api = async (url, init = {}) => {
    const r = await fetch(url.startsWith('http') ? url : `https://api.github.com/repos/${repo}${url}`,
      { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...init.headers } });
    if (!r.ok && r.status !== 404) die(`${init.method || 'GET'} ${url}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.status === 404 ? undefined : r.json();
  };
  const rel = (await api('/releases/tags/feed')) || await api('/releases', { method: 'POST',
    body: JSON.stringify({ tag_name: 'feed', name: 'Encrypted feed', body: 'AES-GCM ciphertext of the batch feed; the key is only in the shared link.' }) });
  for (const a of rel.assets || []) if (a.name === 'feed.enc.json') await api(`/releases/assets/${a.id}`, { method: 'DELETE' });
  await api(`https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=feed.enc.json`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: readFileSync(out) });
  await api('/actions/workflows/pages.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  console.log(`Uploaded to ${repo}; the Pages workflow is deploying it.`);
}
console.log('Batch link: ' + site + '/#k=' + key);
