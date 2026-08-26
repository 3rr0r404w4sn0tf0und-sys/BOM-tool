-- Scrape job correlation + remove obsolete CAPTCHA hand-off storage.
ALTER TABLE items ADD COLUMN IF NOT EXISTS scrape_job_id UUID;
CREATE INDEX IF NOT EXISTS idx_items_active_scrape_job ON items(scrape_job_id) WHERE scrape_job_id IS NOT NULL;
ALTER TABLE items DROP COLUMN IF EXISTS captcha_status;
ALTER TABLE items DROP COLUMN IF EXISTS captcha_screenshot;
ALTER TABLE items DROP COLUMN IF EXISTS captcha_solution;
ALTER TABLE items DROP COLUMN IF EXISTS captcha_requested_at;
