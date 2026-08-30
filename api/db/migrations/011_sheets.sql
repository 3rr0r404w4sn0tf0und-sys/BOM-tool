-- Adds a lightweight "Sheet" document type alongside BOMs. Sheets reuse
-- the same boms/sections/items tables and table UI, but have no scraper,
-- no link/qty/price columns -- instead a flexible set of generic text
-- columns (3-7, default 3) plus a per-row checkbox.

ALTER TABLE boms
  ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'bom'
    CONSTRAINT boms_doc_type_valid CHECK (doc_type IN ('bom', 'sheet')),
  ADD COLUMN column_count INT NOT NULL DEFAULT 3
    CONSTRAINT boms_column_count_range CHECK (column_count BETWEEN 1 AND 7),
  ADD COLUMN column_labels TEXT[]; -- optional custom headers for sheet columns, e.g. {"Item","Owner","Notes"}

ALTER TABLE items
  ADD COLUMN sheet_data JSONB, -- array of up to 7 strings, one per sheet column; null/unused for doc_type='bom' rows
  ADD COLUMN checked BOOLEAN NOT NULL DEFAULT true; -- sheet row checkbox; irrelevant for doc_type='bom' rows

CREATE INDEX idx_boms_doc_type ON boms(user_id, doc_type);
