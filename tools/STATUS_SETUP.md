# My status: one-time setup on Azure Static Web Apps

My status needs a sign-in and one small server function, which GitHub Pages cannot host. The same app therefore
also runs on Azure Static Web Apps (Free plan), at an address like `https://<name>.azurestaticapps.net`. GitHub
Pages keeps serving everything else. Until these steps are done, the Status tab says the feature is being set up
and the `swa` workflow is skipped (not failed).

You need: an IISc Microsoft account, write access to this repository, Node 20+ and Python 3 with openpyxl on the
machine that holds the OCCaP files.

## 1. Get an Azure subscription (free for students)

1. Activate **Azure for Students**: through the GitHub Student Developer Pack (education.github.com/pack, offer
   "Microsoft Azure"), or directly at azure.microsoft.com/free/students. Sign in with your IISc account. No credit
   card is needed.
2. Open the Azure portal (portal.azure.com) and check that the subscription "Azure for Students" is listed.

## 2. Create the Static Web App

1. Portal: **Create a resource**, search **Static Web App**, press **Create**.
2. Fill in:
   - Subscription: *Azure for Students*; Resource group: **Create new**, e.g. `placement-hq`.
   - Name: e.g. `placement-hq` (it becomes part of the address).
   - Plan type: **Free**.
   - Region (for the API): the nearest offered, e.g. *East Asia* or *Central India* if listed.
   - Deployment source: **Other** (the GitHub workflow in this repository deploys; do not let Azure add its own).
3. **Review + create**, then **Create**. Open the new resource and note its **URL** on the Overview page.

## 3. Let GitHub deploy to it

1. Static Web App, Overview: **Manage deployment token**, copy the token.
2. GitHub: this repository, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**:
   name `AZURE_STATIC_WEB_APPS_API_TOKEN`, value the token. Never put the token anywhere else.

## 4. Give the API its key

The per-student lists are uploaded encrypted; the API needs the same 32-byte key to read them.

1. On your machine, in the repository folder, print the key (it is created on first use and kept in `.status-key`,
   which git ignores):

   ```sh
   node tools/status.mjs --show-key
   ```

2. Azure portal, the Static Web App, **Settings**, **Environment variables** (called *Configuration* or
   *Application settings* on some portal versions), environment **Production**, **Add**:
   - `STATUS_KEY` = the printed value, exactly.
   - Optional `STATUS_URL`: only if the encrypted file lives somewhere other than the default
     `https://github.com/IISc-Placement-Helper/iisc-placement-helper.github.io/releases/download/status/status`.
3. **Apply** / **Save**.

Keep `.status-key` backed up somewhere private (a password manager). Never paste the key in a chat, an issue, a
commit or a screenshot. Anyone with the key and the public `status` file can read every student's entries.

## 5. Deploy

GitHub: **Actions**, workflow **swa**, **Run workflow** on `main` (every push to `main` also deploys). The run
tests the code, assembles the site with the encrypted feed, and deploys it with `api/`. The `deploy` job should
now run instead of being skipped.

## 6. Point the app at the new address

1. In `core.js`, set the address from step 2, without a trailing slash:

   ```js
   export const STATUS_ORIGIN = 'https://<name>.azurestaticapps.net';
   ```

2. Run `node test.mjs --fix` (it updates the integrity hashes in `index.html` and the CSP copy in
   `staticwebapp.config.json`), then `node test.mjs`, commit and push. Both workflows redeploy.

## 7. Upload the lists

```sh
node tools/status.mjs --refresh
```

It runs the ingest (`../_work/hq_public/status_ingest.py`; on screen you see counts only), checks the records,
encrypts them with `.status-key` and uploads the `status` release asset. If the records have not changed since the
last upload it says so and stops; add `--force` to upload anyway (for example after changing the key).

## 8. Test

1. On the GitHub Pages site, open the **Status** tab and press **Open My status**: the Azure address opens,
   unlocked (the batch key travels in the link fragment).
2. **Sign in with Microsoft (IISc account)** with an `@iisc.ac.in` account: your cards appear. Press **Enable
   notifications** if you want alerts.
3. Checks:
   - A personal Microsoft account gets "My status works only with your IISc Microsoft account".
   - `https://<name>.azurestaticapps.net/.auth/login/github` answers 404.
   - `https://<name>.azurestaticapps.net/api/status` in a private window sends you to the Microsoft sign-in.

Troubleshooting: "My status is not set up yet" means `STATUS_KEY` is missing. "Could not load the latest OCCaP
lists" means the `status` release asset is missing or was encrypted with another key: compare
`node tools/status.mjs --show-key` with the app setting, then run `node tools/status.mjs --refresh --force`.

## Refreshing the data (every time OCCaP updates the sheet)

1. Drop the new OCCaP files in `_work/hq_public/status/inbox/` (the workbook, or CSV/TSV exports of its sheets such
   as *Shortlist For Test* or the selection status table), or overwrite the interview-shortlist CSV the ingest reads
   from the folder above `_work`.
2. Run `node tools/status.mjs --refresh`.

That is all: no redeploy. Students see the new entries within about 5 minutes of the upload (the API caches the
file for 5 minutes), the next time their app checks. The ingest keeps the date each entry first appeared, marks
entries that disappear from a re-supplied list as withdrawn instead of deleting them, and writes malformed email
cells (typos such as `@isc.ac.in`) to `_work/hq_public/status/ingest_report.txt` so you can ask OCCaP to fix them.
That report and `records.json` name students: keep them on your machine.

## Rotating the key

Delete `.status-key`, run `node tools/status.mjs --refresh --force` (a new key is created and the file re-uploaded),
then put the new `node tools/status.mjs --show-key` value in `STATUS_KEY`. My status shows an error between the two
steps, so do them together.
