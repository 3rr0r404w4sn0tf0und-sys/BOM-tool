-- Surface the actual scrape failure reason (Apify error, missing env var,
-- unrecognized price field, etc.) instead of discarding it after the
-- internal callback -- needed so a failed item's reason is visible on the
-- site (tooltip) without having to go dig through GitHub Actions logs.
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_error TEXT;
