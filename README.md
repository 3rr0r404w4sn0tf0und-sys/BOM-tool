# Printed Parts Material Calc (Cloudflare + GitHub Actions edition)

Same tool as before, rebuilt to run on **Cloudflare only** for hosting,
plus **GitHub Actions** for the scraping (since Playwright needs a real
browser process that Cloudflare Workers can't run).

## Architecture

```
frontend/   Next.js, static export -> Cloudflare Pages
worker/     Hono app -> Cloudflare Worker (upload/parse/thumbnail/calc + job orchestration)
scraper/    unchanged from your BOM-tool -- runs inside GitHub Actions, not the Worker
.github/workflows/scrape-on-demand.yml   triggered by the Worker via repository_dispatch
```

### Why the scraper lives in GitHub Actions, not the Worker

Workers can't spawn a headless browser or run Python, so Playwright and
the Apify Python client can't execute there. GitHub Actions already
gave you real Chromium (see your BOM-tool nightly-refresh workflow), so
scraping still happens there -- the Worker just triggers it and collects
the result:

1. Frontend calls `POST /api/price/start` on the Worker with the product URL.
2. Worker generates a `job_id`, stores `{status: "pending"}` in KV, and
   fires a `repository_dispatch` event (`scrape-request`) to your repo
   via the GitHub API.
3. `.github/workflows/scrape-on-demand.yml` runs, calling the same
   `scrape_logic.py` / `apify_scrape.py` you already have, then POSTs
   the result to `POST /api/price/callback` on the Worker (protected by
   a shared secret header).
4. Worker writes the result into KV under the `job_id`.
5. Frontend polls `GET /api/price/status/:job_id` every few seconds
   until it flips to `"done"`.

Expect price lookups to take 20-60s (Actions runner cold start + the
scrape itself) -- the UI shows a "Scraping via GitHub Action..." state
and polls for up to 90s before giving up.

### Geometry / thumbnail

- STEP/IGES parsing: `occt-import-js` (WASM build of OpenCascade) --
  runs natively in Workers since it's WASM, no native bindings.
  **Verify the wasm-loading path** against whatever `occt-import-js`
  version you install -- Node-style `fs`-based init won't work on
  Workers, it needs the `.wasm` bytes imported/fetched directly. This
  is flagged in `worker/src/lib/stepParser.js`.
- Thumbnail: no canvas or GPU available on Workers, so
  `worker/src/lib/svgThumbnail.js` projects mesh triangles into an
  isometric view and flat-shades them as plain SVG polygons
  (painter's-algorithm depth sort). Good enough for a small upload
  preview, not a real renderer -- large meshes get subsampled to ~4000
  triangles to keep it fast.
- Parsed geometry + the SVG are stored in KV for 24h, keyed by upload id.

## Setup

### 1. GitHub repo secrets
In your repo's Settings > Secrets and variables > Actions, add:
- `APIFY_TOKEN`, `APIFY_AMAZON_ACTOR_ID` -- same as BOM-tool
- `INTERNAL_SCRAPE_SECRET` -- any random string, must match the Worker secret below

### 2. Cloudflare Worker
```
cd worker
npm install
wrangler kv namespace create GEOMETRY_KV   # copy the id into wrangler.toml
wrangler secret put GITHUB_TOKEN            # fine-grained PAT: Actions:write, Contents:read on this repo
wrangler secret put INTERNAL_SCRAPE_SECRET  # same value as the GitHub secret above
wrangler deploy
```
Update `GITHUB_REPO` in `wrangler.toml` to `your-username/your-repo`.

### 3. Cloudflare Pages (frontend)
Connect the repo in the Cloudflare dashboard, set:
- Build command: `npm run build`
- Build output directory: `out`
- Root directory: `frontend`
- Env var: `NEXT_PUBLIC_API_BASE` = your deployed Worker URL (e.g. `https://printed-parts-calc.<subdomain>.workers.dev`)

### 4. Test
Open the Pages URL, upload a small STEP/STL, confirm the SVG thumbnail
and volume show up. Paste a filament link, hit "Fetch price", and watch
the Actions tab in GitHub -- you should see a `scrape-on-demand` run
kick off within a few seconds.

## Known gaps

- No JS-rendering fallback beyond what `scrape_logic.py`'s Playwright
  step already does inside Actions -- that part is unchanged from
  BOM-tool, so coverage should match what you already get there.
- `occt-import-js`'s WASM init path on Workers needs to be verified/adjusted
  once you actually deploy -- flagged inline in `stepParser.js`.
- Support density factors are still rough starting estimates (see old
  README note) -- calibrate against real slices.
- Single-part only, same as before.
