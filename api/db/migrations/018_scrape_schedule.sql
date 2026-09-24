-- Per-user, per-source scrape refresh interval, configurable from
-- Settings instead of hardcoded in each GitHub Actions workflow.
--
-- This does NOT change how workflows are triggered (they still run on
-- a fixed cron), only how each refresh script decides which items are
-- actually "due". Every scheduled workflow's cron is being tightened
-- to run every 30 minutes -- the finest interval a user can pick -- and
-- each refresh script (actions_refresh_all.py / _amazon_weekly.py /
-- _mouser_weekly.py / _etsy_weekly.py) now filters items by this
-- table instead of a hardcoded "SKIP_IF_CHECKED_WITHIN_DAYS" constant.
-- No row for a given (user, source) = that source's previous default
-- cadence (see DEFAULT_INTERVAL_MINUTES in scrape_schedule.py and
-- DEFAULT_SCRAPE_INTERVALS in api/routes/auth.js -- keep both in sync
-- if you ever change a default).
CREATE TABLE user_scrape_settings (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('generic', 'amazon', 'mouser', 'etsy')),
    interval_minutes INT NOT NULL CHECK (interval_minutes BETWEEN 30 AND 262800), -- 30 min .. ~6 months (182 days)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source)
);
