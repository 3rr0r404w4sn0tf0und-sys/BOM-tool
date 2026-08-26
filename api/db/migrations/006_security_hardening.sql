-- Security hardening: revocable sessions, audit log, API-key usage tracking, and DB constraints.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);

ALTER TABLE boms ADD COLUMN IF NOT EXISTS public_api_key_last_used_at TIMESTAMPTZ;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Normalize any legacy values before adding strict constraints so an existing
-- database can migrate without failing on older rows.
UPDATE sections SET sort_order = 0 WHERE sort_order < 0;
UPDATE items SET qty = 0 WHERE qty < 0;
UPDATE items SET unit_price = NULL WHERE unit_price < 0;
UPDATE items SET font_size = LEAST(96, GREATEST(8, font_size)) WHERE font_size < 8 OR font_size > 96;
UPDATE items SET sort_order = 0 WHERE sort_order < 0;

ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_sort_order_nonnegative;
ALTER TABLE sections ADD CONSTRAINT sections_sort_order_nonnegative CHECK (sort_order >= 0);
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_qty_nonnegative;
ALTER TABLE items ADD CONSTRAINT items_qty_nonnegative CHECK (qty >= 0);
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_unit_price_nonnegative;
ALTER TABLE items ADD CONSTRAINT items_unit_price_nonnegative CHECK (unit_price IS NULL OR unit_price >= 0);
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_font_size_reasonable;
ALTER TABLE items ADD CONSTRAINT items_font_size_reasonable CHECK (font_size BETWEEN 8 AND 96);
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_sort_order_nonnegative;
ALTER TABLE items ADD CONSTRAINT items_sort_order_nonnegative CHECK (sort_order >= 0);
