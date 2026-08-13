-- BOM Tool schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- One BOM = one document a user builds (can have many sections)
CREATE TABLE boms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled BOM',
    tax_rate NUMERIC(6,4) NOT NULL DEFAULT 0, -- e.g. 0.08 for Philly
    public_api_key TEXT UNIQUE, -- used by Odoo / external calls
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
    created_at TIMESTAMPTZ DEFAULT now()
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
    source TEXT,                         -- og_meta | json_ld | playwright | bookmarklet | manual
    bold BOOLEAN NOT NULL DEFAULT false,
    italic BOOLEAN NOT NULL DEFAULT false,
    font_size INT NOT NULL DEFAULT 19,
    sort_order INT NOT NULL DEFAULT 0,
    last_checked TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sections_bom_id ON sections(bom_id);
CREATE INDEX idx_items_section_id ON items(section_id);
CREATE INDEX idx_boms_user_id ON boms(user_id);
CREATE INDEX idx_boms_api_key ON boms(public_api_key);
