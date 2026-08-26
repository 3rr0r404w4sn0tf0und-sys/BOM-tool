-- BOM Tool schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    verification_token TEXT,
    verification_token_expires TIMESTAMPTZ,
    oauth_provider TEXT,
    oauth_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_active ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);

-- One BOM = one document a user builds (can have many sections)
CREATE TABLE boms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled BOM',
    tax_rate NUMERIC(6,4) NOT NULL DEFAULT 0, -- e.g. 0.08 for Philly
    public_api_key TEXT UNIQUE, -- used by Odoo / external calls
    public_api_key_last_used_at TIMESTAMPTZ,
    zip_code TEXT, -- optional, used for location-accurate Amazon pricing via Apify
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sections group rows under a title + emoji, e.g. "🔋 Power System"
CREATE TABLE sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled Section',
    emoji TEXT,              -- unicode emoji, e.g. "🔋"
    icon_url TEXT,           -- optional custom drawn icon, overrides emoji if set
    sort_order INT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT sections_sort_order_nonnegative CHECK (sort_order >= 0)
);

-- Individual BOM line items
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT,                            -- product link (nullable: manual entry allowed)
    qty NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2),            -- null if not yet scraped / failed
    status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | link_failed | price_not_found
    source TEXT,                         -- og_meta | json_ld | pricing_table | apify | manual
    stale_price BOOLEAN NOT NULL DEFAULT false, -- true when a protected-store refresh failed and the old price was kept
    scrape_job_id UUID,                   -- active GitHub Actions scrape; callbacks must match it
    bold BOOLEAN NOT NULL DEFAULT false,
    italic BOOLEAN NOT NULL DEFAULT false,
    font_size INT NOT NULL DEFAULT 19,
    sort_order INT NOT NULL DEFAULT 0,
    last_checked TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT items_qty_nonnegative CHECK (qty >= 0),
    CONSTRAINT items_unit_price_nonnegative CHECK (unit_price IS NULL OR unit_price >= 0),
    CONSTRAINT items_font_size_reasonable CHECK (font_size BETWEEN 8 AND 96),
    CONSTRAINT items_sort_order_nonnegative CHECK (sort_order >= 0)
);

CREATE INDEX idx_sections_bom_id ON sections(bom_id);
CREATE INDEX idx_items_section_id ON items(section_id);
CREATE INDEX idx_boms_user_id ON boms(user_id);
CREATE INDEX idx_boms_api_key ON boms(public_api_key);
CREATE INDEX idx_items_active_scrape_job ON items(scrape_job_id) WHERE scrape_job_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL;
