-- Adds a per (user, source) "anchor" timestamp: the reference point
-- their interval is phase-aligned to, so "every 6 hours" actually
-- lands at e.g. 3:00, 9:00, 15:00, 21:00 (whatever the user picked as
-- their start time) instead of drifting to whenever the item happened
-- to last get checked.
--
-- Nullable: no anchor set = same as before this migration, aligned to
-- a fixed default origin (see DEFAULT_ANCHOR in scrape_schedule.py).
ALTER TABLE user_scrape_settings
    ADD COLUMN anchor_at TIMESTAMPTZ;
