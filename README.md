# Placement HQ

A small web app for one placement batch: deadlines with live countdowns, tests and interviews, clash warnings,
a month calendar with "Add to Google Calendar" links and `.ics` export, a shortlist checker for pasted OCCaP
sheet tabs, a CV-to-JD keyword match, and a DSA review queue. Static files, no build step, no accounts, and it
works offline after the first visit. Install it from the browser to get a home-screen app.

Not an official OCCaP service: always confirm dates from the OCCaP mail.

## Privacy model

- **The batch key is membership gating, not secrecy.** The company feed is encrypted (AES-GCM-256 under a key
  from HKDF-SHA256) with a batch key that travels in the link fragment, `#k=...`. Browsers never send the
  fragment to a server; the app keeps the key on the device and removes it from the address bar and history.
  Anyone with the link can read the feed and can forward the link, so the feed is "not public", not secret.
- **Personal data stays on the device** (IndexedDB, with a localStorage fallback) and leaves it only as
  ciphertext: in a backup file you export (PBKDF2-SHA256, 600,000 rounds, then AES-GCM), or, if live sync is on,
  as an AES-GCM blob on the relay. The sync code is never sent: the relay lookup id and the encryption key are
  derived from it with HKDF under different labels, so the relay can find a blob but cannot read it.
- **Nothing identifying is collected.** No accounts, cookies, analytics or telemetry; no third-party script,
  style or font at runtime. pdf.js and the QR generator are vendored (`vendor/`) and pinned with SRI, and a
  Content-Security-Policy allows only this origin, the relay, `blob:` workers and `data:` images.
- **Only your own rows are kept from a shortlist.** A pasted tab is analysed in memory and the text box is
  cleared. What is stored: the schedule rows (company, date, time, mode) and, per shortlist, whether you are on
  it. Other students' names, emails and SR numbers are never stored.
- **No company data in this repository**, in clear or encrypted. The encrypted feed is a release asset that the
  Pages workflow copies into the deployed site, so rotating the key leaves nothing decryptable in git history.
- "Delete everything on this device" (Settings) removes the stored data, the key, the caches and the service worker.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The shell and all CSS; CSP and SRI hashes live here |
| `core.js` | Pure logic shared by the app, the publisher and the tests: events, ICS, sheet parsing, shortlist detection, merge, spaced repetition, CV match, crypto |
| `app.js` | UI, on-device storage, feed decryption, sync client |
| `sw.js` | Service worker: shell precached, `vendor/` cached on first use, feed network-first |
| `manifest.webmanifest`, `icons/` | Install metadata and the "HQ" icon |
| `vendor/` | pdf.js 4.10.38 and qrcode-generator 2.0.4, unmodified; licences in `vendor/LICENSES.txt` |
| `tools/publish.mjs` | Encrypts a feed file into `feed.enc.json` and, with `--upload`, ships it as the `feed` release asset |
| `relay/` | Optional sync relay: Cloudflare Worker + D1 (see `relay/README.md`) |
| `test.mjs` | `node test.mjs`: unit tests, crypto, merge, relay handler, publisher, CSP/SRI checks |
| `.github/workflows/pages.yml` | Tests, then deploys the code plus the encrypted feed to GitHub Pages |

## Develop

```sh
node test.mjs                       # no dependencies
node tools/publish.mjs --feed <feed.json> --check <checker.js>   # writes feed.enc.json (git-ignored), prints a local link
npx -y serve -l 4400 .              # open the printed http://localhost:4400/#k=... link
```

After editing the CSS in `index.html`, `app.js`, `core.js` or anything in `vendor/`, run `node test.mjs --fix`
to update the CSP and SRI hashes (the tests fail until you do).

## Publish or update the feed

```sh
node tools/publish.mjs --feed <feed.json> --check <checker.js> --upload --site https://<org>.github.io
```

- `--check` is required: a privacy checker of your own, run as `node <checker.js> <feed.json>` on exactly what
  will be encrypted; nothing is written unless it exits 0. Keep personal terms in that checker, not in this repo.
  The publisher also refuses feeds with email addresses, phone numbers or local file paths, and drops `*_raw` fields.
- The batch key is read from `.batch-key` (git-ignored, created on the first run). Back it up.
- `--new-key` rotates the key: share the new link; old links stop opening the feed once it is deployed.
- `--upload` needs the GitHub CLI (`gh`) logged in with access to the repository.

Feed shape: `{companies: [{slug, company, deadline, max_roles, poc[], ctc, location, test, interview, kind,
process[], info, roles: [{title, track, ctc, location, eligibility}]}], jds: [{id, label, text}], skills: [],
dsa: [{problem, topic, difficulty, pattern}]}`.

## Live sync (optional)

Without a relay the app offers encrypted backup export and import, which is also how to move data between
devices. To turn on live sync, deploy `relay/` (free tier, one Cloudflare login; see `relay/README.md`), then set
the repository variable `RELAY_URL` and re-run the Pages workflow.

## Install on a phone

- Android (Chrome): menu, then **Install app** (or **Add to Home screen**).
- iPhone (Safari): Share, then **Add to Home Screen**. iOS keeps the installed app's storage apart from Safari,
  so open the installed app and paste the batch link once.

## Taking it down

Delete the `feed` release (the site then shows its locked screen) or unpublish GitHub Pages in the repository
settings. Students' data is only on their own devices; "Delete everything on this device" clears it.

## Licence

MIT (see `LICENSE`). Vendored files keep their own licences (`vendor/LICENSES.txt`).
