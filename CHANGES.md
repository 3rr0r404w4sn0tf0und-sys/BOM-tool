# What was actually wrong

1. **`sort_order` was never computed.** Both `POST /sections/:id/items` and
   `POST /:bomId/sections` defaulted new rows to `sort_order = 0` no matter
   how many rows already existed. Postgres does **not** guarantee any
   particular order for rows that tie on `ORDER BY sort_order` — it returns
   whatever physical order they happen to be in, which shifts every time
   the table is written to (inserts, updates, autovacuum). With every row
   sitting at `0`, that "tie order" *is* the display order — which is why
   things looked fine with a few rows, then went random as the table grew,
   and why delete looked like it hit a random row (the row you saw at
   position 4 wasn't actually the 4th row anymore).

2. **Every add/edit/delete refetched the whole BOM.** `onChange()` called
   `loadBom(bom.id)`, a full re-fetch of every section + item, after every
   single keystroke-commit. That round trip is your lag.

3. **Hard deletes** meant an id was gone forever the moment you deleted a
   row, which makes undo impossible and makes any reorder/undo system
   built on ids fragile.

# What changed

**`db/migration_reorder_undo.sql`** (run this against your Neon DB):
- Adds `deleted_at` to `items` and `sections` — deletes are now soft
  (`UPDATE ... SET deleted_at = now()`), so ids never disappear and undo
  is just "clear `deleted_at` again."
- One-time repair query that renumbers every existing row's `sort_order`
  by `created_at`, so BOMs that are *already* scrambled snap back into a
  sane order the moment you run this — you don't need to manually fix
  existing data.

**`api/routes/boms.js`** / **`api/routes/public.js`**:
- Inserts now compute `sort_order` as `MAX(sort_order) + 1` (scoped to the
  section/BOM) when the caller doesn't pass one explicitly — new rows/
  tables always land at the end, deterministically.
- All `ORDER BY` clauses now break ties with `created_at, id` so the order
  is 100% stable even for old rows still sitting at duplicate sort_orders.
- `DELETE` routes now soft-delete; added `POST /items/:id/restore` and
  `POST /sections/:id/restore`.
- New `PATCH /sections/:sectionId/items/reorder` and
  `PATCH /:bomId/sections/reorder` — take `{ orderedIds: [...] }` and
  persist a full reorder in one transaction. This is what the new drag
  handles call.

**Frontend (`App.jsx`, `SectionTable.jsx`, new `totals.js`, `useUndoRedo.js`)**:
- Every mutation (add row, delete row, edit a cell, rename/delete a table,
  reorder) is now applied to local state immediately and the network call
  fires in the background — no more full-BOM refetch per action. Totals
  are recalculated client-side (mirrors `api/db/totals.js` exactly) so
  they stay correct without a round trip either.
- Six-dot grip handle on every row (drag to reorder within its table) and
  on every table header (drag to reorder tables). Uses native HTML5 drag
  and drop, no extra dependency.
- `Ctrl+Z` / `Ctrl+Y` (and `Ctrl+Shift+Z`) undo/redo, plus buttons in the
  toolbar. Built as a command stack — every action pushes `{ undo, redo }`
  — and because deletes are soft, undo/redo stay correct no matter how
  many times a row gets deleted, undone, redone, edited, etc. Typing in a
  cell still gets normal browser text-undo (Ctrl+Z inside an input isn't
  intercepted).
- The still-necessary periodic poll for async price scrapes (GitHub
  Actions callback) is untouched — that one genuinely needs to hit the
  server since the result doesn't exist yet when you save.

# To deploy

1. Run `db/migration_reorder_undo.sql` against your Neon database.
2. Deploy the updated `api/` (Express) and `frontend/` (Vite) as usual —
   `npm install && npm run build` in `frontend/` was verified to build
   clean.
