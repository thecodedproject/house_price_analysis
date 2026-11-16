# House Price Analysis

Scrape house sale & listing data for a set of local postcodes into a JSON-file "DB", and
browse it in a static React SPA.

```
 config/area.json ──► yarn scrape:lr ─────┐
                      (Land Registry CSV) │
                                          ├──► data/*.json + data/images/ ──► SPA (Chrome/Edge,
 config/area.json ──► yarn scrape:zoopla ─┘                                    "Open data folder")
                      (Playwright + Chrome)
```

Why scripts and not the web app? Neither site sends CORS headers, browsers don't let pages
set `Cookie`, and Zoopla sits behind a Cloudflare challenge - so scraping runs locally
in Node. The SPA has no backend: it reads (and can later write) the local `data/` folder via
the File System Access API, so it needs a Chromium browser. Scraped data is never deployed.

## ⛔ Personal data

Never commit personal data: no email addresses, no postcodes or addresses from your area,
and nothing from `data/`, `config/area.json` or `config/zoopla.json` (all gitignored).
Tests and fixtures use **only** Westminster properties next to the Houses of Parliament
(`SW1A 0AA`, `SW1P 3BU`, `SW1P 3NG`, `SW1P 3LA`). Run `yarn check:private` before every
commit. `yarn install` also enables a pre-commit hook that runs the check (or run
`git config core.hooksPath .githooks` yourself). The full rules are in [AGENTS.md](AGENTS.md).

## Setup

```sh
yarn install
```

Copy `config/area.example.json` to `config/area.json` (gitignored) and edit it - a list of full postcodes, either plain strings (`"SW1P 3NG"`) or
`{ "postcode": "SW1P 3NG", "zooplaUrl": "..." }`.

`zooplaUrl` (the postcode's house-prices page, whose slug includes town & street, e.g.
`/house-prices/london/barton-street/sw1p-3ng/`) is filled in automatically by the first
`yarn scrape:zoopla` run: it tries the guessed `/house-prices/<postcode>/` URL, then falls back
to Zoopla's search box, and writes the resulting URL back once it has checked that it's a
results page for that exact postcode. A URL you set by hand is never overwritten.

For Zoopla sign-in, copy `config/zoopla.example.json` to `config/zoopla.json` (gitignored)
and set `zoopla_login_email`.

## Scraping

```sh
yarn scrape:lr                          # all configured postcodes
yarn scrape:lr --postcode "SW1P 3NG"

yarn scrape:zoopla --postcode "SW1P 3NG" --limit 3   # try a few properties first
yarn scrape:zoopla --uprn 100022757796                  # just one property (debugging)
yarn scrape:zoopla --no-property-pages             # results pages only (fast)
yarn scrape:zoopla --no-listings --no-images       # skip listing pages / downloads
yarn scrape:zoopla --no-login                      # don't sign in

yarn zoopla:probe <url>                 # debug: log navigation statuses, save the page

yarn merge                              # re-run sale reconciliation / listing chaining
```

- **Land Registry** uses the PPD CSV download
  (`/app/ppd/ppd_data.csv?postcode=…&limit=all`), falling back to the cookie + CSRF form flow.
  All rows are `status: final`.
- **Zoopla** opens your installed Google Chrome with a persistent profile in
  `data/.browser-profile/`. Pages are fetched slowly (3-8 s apart). Zoopla's terms prohibit
  scraping: keep it personal and low-volume.
  - *Sign-in*: if `zoopla_login_email` is set, the script fills it in on Zoopla's sign-in page;
    type the emailed code into the browser window. The session persists in the profile, so
    this is only needed occasionally.
  - *Cloudflare*: a challenge only appears sometimes (e.g. on a VPN). If one does, complete it
    in the window and the script carries on.
  - *HTTP status*: Zoopla can answer with a 403 and then reload into the real page via JS, so
    pages are judged by their content, not the status code.
  - *Data*: read from the pages' embedded JSON - `propertiesSearch` (results), the
    `property` object (sale history, listing history with each listing's beds/baths/photos/
    floor plans) and `ListingData` on live/archived listing pages (description, status,
    agent, EPC, tags). Photos are 1024x768 (the largest the CDN serves).
- Every fetched page is saved under `data/raw/` so extraction (`src/scripts/zoopla/extract.ts`)
  can be tuned without re-scraping; `__fixtures__/` holds trimmed real pages for the tests.
- Re-running is idempotent: unchanged rows keep their timestamps and files aren't rewritten.

## Data model (`src/shared/types.ts`)

| file | key | notes |
| --- | --- | --- |
| `properties.json` | `SW1P3NG_barton_street_12[_flat_a]` | immutable facts: address, type, tenure, UPRN |
| `sales.json` | LR transaction id / `zoopla_{prop}_{yyyy-mm}` | `status` provisional (Zoopla) or final (LR); provisional rows get `supersededBy` once LR catches up |
| `listings.json` | `{prop}_{sale\|rent}_{yyyy-mm}_{price}` | one row per asking price (reductions chained via `previousListingId`), with that listing's own beds/baths/area snapshot, description, status, agent, `images[]` + `floorplans[]` paths and a manual `condition` |

Prices are whole pounds; floor areas are square metres. IDs come from `src/shared/ids.ts`, which normalises both sources'
addresses identically.

## Web app

```sh
yarn start          # build + serve dist/ on http://localhost:8080
```

Open in Chrome/Edge, click **Open data folder** and pick this project's `data/` directory.
The choice is remembered; use **Reload** after a scrape. `yarn build:prod` produces the static
`dist/` deployed by `.github/workflows/pages.yml`.

## Development

```sh
yarn test           # jest
yarn typecheck
```

```
src/shared/    types, ids, Db (JSON tables over a Storage interface), merge rules - used by both sides
src/scripts/   Node: land_registry/, zoopla/, NodeStorage
src/app/       React SPA: FsAccessStorage, data context, pages
```
