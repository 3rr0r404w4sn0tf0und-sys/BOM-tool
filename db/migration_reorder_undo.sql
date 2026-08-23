-- Migration: soft delete + reliable ordering (fixes random insert/delete,
-- enables drag-to-reorder and undo/redo).
--
-- WHY: items/sections were being inserted with sort_order always 0, and
-- ORDER BY sort_order alone has no defined tie-break in Postgres -- ties
-- come back in whatever physical order the rows happen to sit in, which
-- silently changes as the table is written to. That's the "rows appear
-- in random spots" bug. Hard DELETE also means an id is gone forever,
-- which makes undo impossible. This migration fixes both.
--
-- Safe to re-run.

-- 1. Soft delete instead of hard delete, so ids stay valid and "undo
--    delete" is just clearing this column back to NULL.
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_items_not_deleted ON items(section_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sections_not_deleted ON sections(bom_id, sort_order) WHERE deleted_at IS NULL;

-- 2. One-time repair: renumber every existing row by created_at so
--    existing BOMs that already got scrambled (everything sitting at
--    sort_order 0) snap back into a sane, stable order right away.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY section_id ORDER BY sort_order, created_at, id) - 1 AS rn
  FROM items
  WHERE deleted_at IS NULL
)
UPDATE items SET sort_order = ranked.rn
FROM ranked
WHERE items.id = ranked.id AND items.sort_order IS DISTINCT FROM ranked.rn;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY bom_id ORDER BY sort_order, created_at, id) - 1 AS rn
  FROM sections
  WHERE deleted_at IS NULL
)
UPDATE sections SET sort_order = ranked.rn
FROM ranked
WHERE sections.id = ranked.id AND sections.sort_order IS DISTINCT FROM ranked.rn;
