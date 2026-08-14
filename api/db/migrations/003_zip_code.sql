-- Migration: per-BOM zip code, used to get location-accurate Amazon pricing
-- (Apify Actor accepts a zipCode input -- prices can vary by delivery location).
-- Run this against your existing Neon database (SQL Editor, paste + run).
-- Also folded into api/db/schema.sql for fresh installs.
--
-- NOTE: this column alone does not make zip-code-aware scraping work end to
-- end. As of this migration, nothing reads or writes it yet:
--   - api/routes/boms.js triggerScrape doesn't fetch/pass it to GH dispatch
--   - actions_scrape_one.py doesn't read a ZIP_CODE env var
--   - actions_refresh_amazon_weekly.py doesn't join items->sections->boms for it
--   - there's no frontend field to set it
-- Those are separate follow-up changes.

ALTER TABLE boms ADD COLUMN IF NOT EXISTS zip_code TEXT;
