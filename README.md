# Placement HQ

Your placement season on one screen: every OCCaP form with a live countdown, your tests and interviews, a
calendar that feeds your phone's alarms, a shortlist checker for the OCCaP sheet, a CV-to-JD match, and a DSA
review queue. It runs in the browser, installs like an app on Android, iPhone and laptops, works offline, and
keeps your data on your own devices.

**Site:** https://iisc-placement-helper.github.io (it opens only with your batch's link; see step 1).

Not an official OCCaP service: always confirm dates in the OCCaP mail.

---

## Quick start (2 minutes)

1. **Open your batch link.** Your placement representative shares a link of the form
   `https://iisc-placement-helper.github.io/#k=…` in the batch group. Open it once on each device. The part after
   `#` is the key that unlocks the company list; the app saves it and removes it from the address bar.
   Opened the site without it? Paste the whole link into the box on the locked screen.
2. **Install it** (optional, recommended):
   | Device | How |
   | --- | --- |
   | Android (Chrome) | Tap **Install the app** on Home, or Chrome menu ⋮ → **Install app** / **Add to Home screen**. |
   | iPhone / iPad (Safari) | Share □↑ → **Add to Home Screen**. Then open the new icon and paste your batch link once: iOS keeps the installed app's storage separate from Safari. |
   | Laptop (Chrome / Edge) | The install icon at the right end of the address bar, or menu → **Install Placement HQ**. |
   | Any other browser | Just bookmark the page; everything works in a tab too. |
3. **Tell it who you are** (Settings → *My identifiers*): your name as OCCaP writes it, your email and your SR
   number. They are used only to spot your own rows in pasted shortlists and never leave your devices except
   inside your encrypted sync.
4. **Mark your roles** (Companies): for each form you applied to, set the role's status (applied, shortlisted,
   test, interview, offer…). Home and the calendar now follow *your* season.

## Daily use

| Tab | What you do there |
| --- | --- |
| **Home** | The next 7 days: form deadlines with countdowns, your tests and interviews, a warning if two of them clash, and "what changed since your last visit" (new forms, moved deadlines, new test dates). |
| **Companies** | Search or filter by track (HPC, AIML, SW, DS, HARDWARE, EMBEDDED, MECH, OTHER) or **My roles**. Each card has the deadline, roles, CTC and location where announced, process, notes from the OCCaP mails, and test/interview details. Set status, notes and dates per role. |
| **Calendar** | Month view and list. Each item has **Add to Google Calendar** and **Download .ics**; **Export all (.ics)** adds every deadline, test and interview at once. |
| **Shortlists** | Paste a tab of the OCCaP Excel sheet and press **Check**: schedules go into your calendar, and shortlists are checked for your name, email or SR number with one-click status updates (and undo). |
| **CV** | Choose your CV as a PDF (or paste its text) and press **Score my CV**: every job description is ranked by keyword coverage, with the keywords you match and miss. |
| **DSA** | The NeetCode-style problem list with To do / Done / Revisit and a review queue at 1, 3, 7 and 21 days. |
| **Settings** | Identifiers, device sync, encrypted backup, export, delete. |

### Alarms and calendar
- **Android:** tap **Add to Google Calendar** on an item, or import the exported `.ics` in Google Calendar
  (calendar.google.com → Settings → Import). Turn on notifications for that calendar in the Google Calendar app.
- **iPhone / Mac:** tap **Download .ics** or **Export all (.ics)** and open the file: Calendar adds the events
  with two alerts each, 1 day and 1 hour before.
- **Outlook / others:** open the `.ics` file.
- Dates change? Export again: events keep the same IDs, so calendars that support updates (Apple, Outlook)
  replace them instead of duplicating. Google may add a second copy; delete the old one.

### Shortlists: how to paste
On the OCCaP sheet, open the tab, select all its cells (Ctrl+A / ⌘A), copy, and paste into the Shortlists box.
The app detects whether it is a test schedule, interview schedule or shortlist from the headers (or choose it
yourself). Only the schedule rows and **your own** matches are kept; the pasted text, including other
students' names and emails, is discarded.

### CV match
The PDF is read on your device (pdf.js, bundled with the site); nothing is uploaded. Scanned (image-only) PDFs
have no text: paste the text instead. The score is keyword coverage against each JD, a quick guide for
tailoring, not a prediction of shortlisting.

## Sync your phone and laptop

Your statuses, notes, identifiers, CV text and pasted schedules can follow you across devices through **one
secret, encrypted gist in your own GitHub account**. Only ciphertext goes to GitHub; the key is a sync code that
stays on your devices.

1. On your first device: Settings → *Sync your devices* → **Create a GitHub token with only the gist scope**.
   GitHub opens with only **gist** ticked: set an expiry, press **Generate token**, copy it, paste it into the app
   and press **Start syncing**. The app refuses tokens with wider permissions.
2. On your other device: on the first device open **Show the code and QR for another device** and scan the QR
   with the second device's camera. Or, under **Join your other device instead**, type the sync code and gist id
   with a token from the same GitHub account, and press **Join**.
3. From then on, changes sync on their own: when you open or return to the app, and every minute while it is on
   screen.

Keep the QR to yourself: it contains your token and sync code. Token expired or revoked? The app says so; paste a new one and press **Save token**. **Stop syncing on this device** forgets the token and code on that device; **Delete synced copy**
removes the gist.

**No GitHub account, or prefer not to?** Settings → *Encrypted backup*: choose a passphrase, **Export encrypted
backup**, send the file to your other device, and **Import backup** there. Imports merge; nothing is lost.

## Privacy, in plain words
- **The company list is "not public", not secret.** It is encrypted with your batch's key, which exists only in
  the shared link. Search engines and outsiders cannot read it; anyone with the link can, and can forward it.
- **Your data is yours.** It lives on your device and leaves it only encrypted (backup file or your own gist).
  The site has no server, no accounts, no cookies, no analytics, and loads no third-party scripts or fonts.
- **Other students' data is never kept.** Shortlist checks keep only your own matches.
- **Delete everything on this device** (Settings) wipes the app's data, the key and its caches from that device.

## FAQ
- **"Locked" screen?** Open the latest batch link from your group. Links change when the key is rotated.
- **Dates look old?** Home shows when the feed was last updated; the site refreshes it whenever you are online.
- **Something is wrong in a company entry?** Tell your placement representative; the OCCaP mail is the source of
  truth.
- **Works offline?** Yes, after the first visit. Sync and feed updates resume when you are back online.

---

# For the placement representative and contributors

Everything below is for whoever maintains the site and its feed.

## Privacy model (technical)

- **The batch key is membership gating, not secrecy.** The company feed is encrypted (AES-GCM-256 under a key
  from HKDF-SHA256) with a batch key that travels in the link fragment, `#k=...`. Browsers never send the
  fragment to a server; the app keeps the key on the device and removes it from the address bar (the browser's
  own history list may still hold the link as it was opened). Anyone with the link can read the feed and can
  forward the link, so the feed is "not public", not secret.
- **Personal data stays on the device** (IndexedDB, with a localStorage fallback) and leaves it only as
  ciphertext: in a backup file you export (PBKDF2-SHA256, 600,000 rounds, then AES-GCM), or, if live sync is on,
  as an AES-GCM file in a secret gist in the student's own GitHub account (see "Live sync" below).
- **Nothing identifying is collected.** No accounts, cookies, analytics or telemetry; no third-party script,
  style or font at runtime. pdf.js and the QR generator are vendored (`vendor/`) and pinned with SRI, and a
  Content-Security-Policy allows only this origin, the GitHub API and gist hosts for sync, `blob:` workers and `data:` images.
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
| `test.mjs` | `node test.mjs`: unit tests, crypto, merge, gist sync client (against a fake fetch), publisher, CSP/SRI checks |
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
node tools/publish.mjs --feed <feed.json> --check <checker.js> --upload --site https://iisc-placement-helper.github.io
```

- `--check` is required: a privacy checker of your own, run as `node <checker.js> <feed.json>` on exactly what
  will be encrypted; nothing is written unless it exits 0. Keep personal terms in that checker, not in this repo.
  The publisher also refuses feeds with email addresses, phone numbers or local file paths, and drops `*_raw` fields.
- The batch key is read from `.batch-key` (git-ignored, created on the first run). Back it up.
- `--new-key` rotates the key: share the new link; old links stop opening the feed once it is deployed.
- `--upload` uses the GitHub REST API with `GITHUB_TOKEN`, or the token your git credential helper already holds; the account needs write access to the repository. `--repo owner/name` overrides the `origin` remote.

Feed shape: `{companies: [{slug, company, deadline, max_roles, poc[], ctc, location, test, interview, kind,
process[], info, roles: [{title, track, ctc, location, eligibility}]}], jds: [{id, label, text}], skills: [],
dsa: [{problem, topic, difficulty, pattern}]}`.

## Live sync (GitHub Gist)

Nothing to deploy: each student syncs through one secret gist in their own GitHub account, and the site talks
only to `api.github.com` (plus `gist.githubusercontent.com` when the file is over 1 MB and the API truncates it).

- **Token**: a classic personal access token with only the `gist` scope, pasted in Settings and kept on the
  device. The app checks `x-oauth-scopes` on `GET /user` and refuses tokens that also carry `repo`, `admin`,
  `delete_repo`, `workflow` or `user` scopes. (GitHub's device sign-in flow has no CORS, so a static site cannot use it.)
- **Data**: the gist holds one file, `hq.enc` = base64url(IV + AES-GCM of the gzipped state), described as
  "Placement HQ sync (encrypted)". The key comes from a 16-byte sync code via HKDF (`hq-sync-key`); GitHub
  never sees the code.
- **Rounds**: `GET /gists/{id}` with `If-None-Match` (a 304 is free against the rate limit), decrypt, merge
  (per-record last-writer-wins with tombstones), and `PATCH` back when the gist lacks something this device has.
  A change triggers a round 2 s later; the app also polls on focus and every 60 s while visible, one request at a
  time. Gists have no compare-and-swap; merging on every pull makes devices converge without losing records.
- **Errors**: 401 stops syncing until a new token is pasted; 404 offers to create a new gist; a 403/429 with no
  requests left waits until `x-ratelimit-reset`.
- **Pairing**: the QR in Settings opens `#k=<batch>&sync=<code>&g=<gist id>&t=<token>`; the fragment never
  reaches a server and is removed from the address bar. The QR is a credential: it is for the student's own devices.

## Taking it down

Delete the `feed` release (the site then shows its locked screen) or unpublish GitHub Pages in the repository
settings. Students' data is on their own devices and, if they sync, in an encrypted gist in their own GitHub account; "Delete everything on this device" clears it.

## Licence

MIT (see `LICENSE`). Vendored files keep their own licences (`vendor/LICENSES.txt`).
