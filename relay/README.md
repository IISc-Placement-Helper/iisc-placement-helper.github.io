# Sync relay

A Cloudflare Worker with a D1 table. It stores one encrypted blob per sync id and nothing else: no accounts,
no keys, no plaintext, no IP logging by this code. Clients derive the id and the AES key from the sync code
with HKDF under different labels, so the relay can look a blob up but cannot read it.

## API

| Request | Result |
| --- | --- |
| `GET /v1/b/:id` (64 hex) | `200 {ver, data}`, `404` if none, `304` when `If-None-Match` equals the stored `ver` |
| `PUT /v1/b/:id` body `{base, data}` | `200 {ver}` when `base` equals the stored `ver` (or no row and `base` is 0); else `409 {ver, data}` |
| | `413` if `data` (base64url) is over 256 KB, `429` after 120 writes in an hour for that id, `400` for a bad body |
| `OPTIONS` | CORS preflight; only `ORIGIN` gets CORS headers, any other `Origin` gets `403` |

## Deploy (once, free tier)

```sh
cd relay
npx wrangler login
npx wrangler d1 create hq-relay            # copy the database_id into wrangler.toml
# edit wrangler.toml: ORIGIN = "https://<your-org>.github.io"
npx wrangler d1 execute hq-relay --remote --file=schema.sql
npx wrangler deploy                        # prints https://hq-relay.<account>.workers.dev
```

Then set the repository variable `RELAY_URL` to that URL (Settings, Secrets and variables, Actions,
Variables) and re-run the Pages workflow; the site's CSP and sync settings pick it up.

## Free-tier budget

Workers allow 100k requests a day and D1 100k row writes a day. Clients poll every 60 s only while the page
is visible (and on focus), and an unchanged blob answers `304`, so a few hundred active students stay well
inside the limit. Blobs are capped at 256 KB.

## Local test

`node ../test.mjs` runs this handler against an in-memory D1 stub. Wrangler also runs it locally without a
Cloudflare login:

```sh
npx wrangler d1 execute hq-relay --local --file=schema.sql
npx wrangler dev --local --port 8787 --var ORIGIN:http://localhost:4400
```
