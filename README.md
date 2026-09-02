# BOM Tool (open source)

Paste a product link, get the price, build a formatted Bill of Materials.

## Architecture (card-free, no paid infra required)

```
bom-tool/
├── api/                        Node/Express — accounts, BOM CRUD, totals, public API
├── frontend/                   React app — the BOM editor UI
├── scraper/                    Python scraping logic, used by GitHub Actions (not a live service)
├── .github/workflows/
│   ├── scrape-on-demand.yml    Triggered per-item when a link is pasted (repository_dispatch)
│   └── nightly-refresh.yml     Cron @ 12:00 AM — re-checks every stored item's price
└── docker-compose.yml          postgres + api + frontend (local dev / self-host)
```

**Why scraping runs in GitHub Actions instead of a container:** Playwright needs
real RAM (500MB-1GB+ per browser instance) that free-tier hosts (Render, Fly, etc.)
don't comfortably offer without a card. GitHub Actions gives public repos free,
unlimited runners with 2 vCPU / 7GB RAM — plenty for headless Chromium — and
supports both scheduled cron jobs and on-demand triggers. Trade-off: on-demand
scrapes take roughly 20-60s (runner startup + scrape time) rather than being
instant, which is an accepted trade-off for this project.

**Flow when a link is pasted:**
1. API inserts the item with `status = 'pending'`.
2. API fires a `repository_dispatch` event to this repo with the item id + URL.
3. GitHub Actions spins up, scrapes with Playwright, POSTs the result to
   `/api/internal/scrape-result` (secured by a shared secret).
4. Item updates to `ok` (with price) or `link_failed` / `price_not_found`.

**Nightly refresh:** a separate scheduled workflow (`nightly-refresh.yml`, cron
`0 0 * * *`) connects to Postgres directly and re-scrapes every item with a URL,
independent of the on-demand path.

## Local dev

```bash
cp .env.example .env      # fill in secrets
docker compose up --build
```

- API: http://localhost:4000
- Frontend: http://localhost:5173
- Postgres: localhost:5432

Note: on-demand/nightly scraping won't run locally unless you also set up the
GitHub Actions secrets below and push to a real GitHub repo — Actions can't
trigger from your laptop.

## Setting up GitHub Actions scraping

1. Push this repo to GitHub (public repo = free unlimited Actions minutes).
2. In repo Settings → Secrets and variables → Actions, add:
   - `DATABASE_URL` — your Postgres connection string (for the nightly job)
   - `INTERNAL_SCRAPE_SECRET` — any random string, must match the API's env var
3. Generate a GitHub Personal Access Token (classic, `repo` scope) and set it
   as `GITHUB_DISPATCH_TOKEN` in your **API's** environment (Render/Coolify/etc,
   NOT a GitHub secret — the API needs it to fire the dispatch event).
4. Set `GITHUB_REPO=yourname/bom-tool` and `API_PUBLIC_URL` (your deployed API's
   public URL, so GitHub Actions can call back to it) in the API's environment.

## Deploying (suggested card-free stack)

- **Frontend** → Vercel or Cloudflare Pages
- **Postgres** → Neon or Supabase
- **API** → Render free Web Service (Dockerfile-based)
- **Scraper** → GitHub Actions (see above, no separate host needed)

## Status

Early scaffold — see inline TODOs, especially in `frontend/` (editor UI,
emoji picker, drag-to-reorder are not built yet).

## Security hardening / database migration

After deploying the hardened API, run `api/db/migrations/006_security_hardening.sql` against the existing Neon database. Fresh installs should use `api/db/schema.sql`.

**Sharing (added after the above):** also run `api/db/migrations/014_sharing.sql`. It adds `boms.public_access` and the `bom_shares` table that per-email viewer/editor sharing and "anyone with the link" access depend on. Nothing else needs to change — existing BOMs default to `public_access = 'private'` with no shares, i.e. unchanged owner-only access.

For Render, set `FRONTEND_URL` to the exact Vercel origin (no trailing slash) and keep `API_PUBLIC_URL` set to the exact Render API origin.

The production session is an HttpOnly cookie; the frontend already sends `credentials: "include"`.

## License

MIT — see LICENSE.
