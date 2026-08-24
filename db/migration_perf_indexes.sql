-- Migration: covering partial indexes for the hot read path (loading a
-- BOM, i.e. every page load and every poll while items are pending).
--
-- WHY: migration_reorder_undo.sql already added:
--   idx_items_not_deleted    ON items(section_id, sort_order)    WHERE deleted_at IS NULL
--   idx_sections_not_deleted ON sections(bom_id, sort_order)     WHERE deleted_at IS NULL
-- which is a real win (soft-deleted rows never bloat the index, and the
-- planner can use it for the WHERE bom_id/section_id = $1 AND deleted_at
-- IS NULL lookup). But every actual query orders by
--   ORDER BY sort_order, created_at, id
-- (see api/routes/boms.js and api/routes/public.js -- the tie-break was
-- added alongside sort_order itself, see CHANGES.md) and the existing
-- indexes only cover the first column of that ORDER BY. Postgres can use
-- the index to find the rows, but then still runs a separate in-memory
-- sort step on every load to apply the created_at, id tie-break.
--
-- This drops and replaces those two indexes with versions that include
-- the full ORDER BY column list, so the same lookup satisfies the sort
-- for free (index-only ordering, no separate Sort node) -- the bigger a
-- BOM gets (more sections, more items per section), the more this saves,
-- since the old sort step's cost grows with row count while an
-- already-ordered index scan doesn't.
--
-- Safe to re-run.

DROP INDEX IF EXISTS idx_items_not_deleted;
CREATE INDEX IF NOT EXISTS idx_items_not_deleted
  ON items(section_id, sort_order, created_at, id)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_sections_not_deleted;
CREATE INDEX IF NOT EXISTS idx_sections_not_deleted
  ON sections(bom_id, sort_order, created_at, id)
  WHERE deleted_at IS NULL;

-- The full-BOM item fetch joins through sections (items JOIN sections ON
-- items.section_id = sections.id WHERE sections.bom_id = $1 ...), so it
-- also benefits from being able to find "this BOM's sections" via an
-- index-only scan rather than a table lookup per row.
CREATE INDEX IF NOT EXISTS idx_sections_bom_id_not_deleted
  ON sections(bom_id)
  WHERE deleted_at IS NULL;
