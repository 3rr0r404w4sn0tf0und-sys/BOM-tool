-- Hot-path indexes and OAuth/session schema hardening.
CREATE INDEX IF NOT EXISTS idx_sections_active_order
  ON sections(bom_id, sort_order, created_at, id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_section_active_order
  ON items(section_id, sort_order, created_at, id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_active_scrape_job
  ON items(scrape_job_id) WHERE scrape_job_id IS NOT NULL;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
  ON users(oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL;
