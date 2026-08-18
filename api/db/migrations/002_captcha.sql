-- Migration: CAPTCHA hand-off support + stale-price flag for Amazon items.
-- Run this against your existing Neon database (SQL Editor, paste + run).
-- Also folded into api/db/schema.sql for fresh installs.

ALTER TABLE items ADD COLUMN IF NOT EXISTS stale_price BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS captcha_status TEXT; -- null | 'awaiting_screenshot' | 'needs_solution' | 'solution_submitted'
ALTER TABLE items ADD COLUMN IF NOT EXISTS captcha_screenshot TEXT; -- base64 PNG, cleared once solved
ALTER TABLE items ADD COLUMN IF NOT EXISTS captcha_solution TEXT;  -- user's typed answer, cleared once consumed
ALTER TABLE items ADD COLUMN IF NOT EXISTS captcha_requested_at TIMESTAMPTZ;
