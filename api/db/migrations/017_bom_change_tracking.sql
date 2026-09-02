-- Keep BOM updated_at in sync with nested content changes. This enables
-- cheap ETag/304 polling: unchanged 200+ row BOMs no longer serialize their
-- entire sections/items payload every few seconds.

CREATE OR REPLACE FUNCTION touch_parent_bom_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_bom UUID;
BEGIN
  IF TG_TABLE_NAME = 'sections' THEN
    target_bom := COALESCE(NEW.bom_id, OLD.bom_id);
  ELSE
    SELECT bom_id INTO target_bom
    FROM sections
    WHERE id = COALESCE(NEW.section_id, OLD.section_id);
  END IF;

  IF target_bom IS NOT NULL THEN
    UPDATE boms SET updated_at = clock_timestamp() WHERE id = target_bom;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sections_touch_bom ON sections;
CREATE TRIGGER trg_sections_touch_bom
AFTER INSERT OR UPDATE OR DELETE ON sections
FOR EACH ROW EXECUTE FUNCTION touch_parent_bom_updated_at();

DROP TRIGGER IF EXISTS trg_items_touch_bom ON items;
CREATE TRIGGER trg_items_touch_bom
AFTER INSERT OR UPDATE OR DELETE ON items
FOR EACH ROW EXECUTE FUNCTION touch_parent_bom_updated_at();

CREATE INDEX IF NOT EXISTS idx_items_section_sort_active
  ON items(section_id, sort_order, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sections_bom_sort_active
  ON sections(bom_id, sort_order, created_at, id)
  WHERE deleted_at IS NULL;
