import express from "express";
import crypto from "node:crypto";

import fetch from "node-fetch";
import multer from "multer";
import { pool } from "../db/pool.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { calculateTotals } from "../db/totals.js";
import { parseSheet, buildSheetFromBom } from "../lib/sheetImport.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { optionalString, optionalNumber, optionalBoolean } from "../lib/validation.js";
import { validateProductUrl } from "../lib/urlValidation.js";
import { triggerScrape, triggerBatchScrape } from "../lib/scrapeDispatcher.js";
import rateLimit from "express-rate-limit";

export const bomsRouter = express.Router();
const scrapeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many scrape requests. Try again later." },
});
bomsRouter.use(requireAuth);
bomsRouter.use(requireCsrf);

// Resource-level authorization helpers. UUIDs are identifiers, not secrets:
// every mutation/read of a child resource must still prove that its BOM
// belongs to the authenticated user.
export async function userOwnsBom(bomId, userId) {
  const result = await pool.query(
    "SELECT id FROM boms WHERE id = $1 AND user_id = $2",
    [bomId, userId]
  );
  return !!result.rows[0];
}

export async function getOwnedSection(sectionId, userId) {
  const result = await pool.query(
    `SELECT sections.id, sections.bom_id
     FROM sections
     JOIN boms ON boms.id = sections.bom_id
     WHERE sections.id = $1 AND boms.user_id = $2`,
    [sectionId, userId]
  );
  return result.rows[0] || null;
}

export async function getOwnedItem(itemId, userId) {
  const result = await pool.query(
    `SELECT items.id, items.section_id, sections.bom_id
     FROM items
     JOIN sections ON sections.id = items.section_id
     JOIN boms ON boms.id = sections.bom_id
     WHERE items.id = $1 AND boms.user_id = $2`,
    [itemId, userId]
  );
  return result.rows[0] || null;
}

// Sheet imports (.xlsx / .xls / .csv) — kept small, this isn't for
// uploading giant spreadsheets, just a BOM a few hundred rows long.
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function validateBody(fn, res) {
  try { return fn(); }
  catch (err) {
    res.locals.validationFailed = true;
    res.status(400).json({ error: err.message });
    return null;
  }
}

// --- BOMs ---

bomsRouter.post("/", asyncHandler(async (req, res) => {
  const title = validateBody(() => optionalString(req.body?.title, "title", 200), res);
  if (title === null && req.body?.title !== undefined && req.body?.title !== null) return;
  const apiKey = crypto.randomBytes(24).toString("hex");
  const result = await pool.query(
    `INSERT INTO boms (user_id, title, public_api_key) VALUES ($1, $2, $3) RETURNING *`,
    [req.userId, title || "Untitled BOM", apiKey]
  );
  res.json(result.rows[0]);
}));

bomsRouter.get("/", asyncHandler(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM boms WHERE user_id = $1 ORDER BY updated_at DESC",
    [req.userId]
  );
  res.json(result.rows);
}));

// Full BOM with sections + items + calculated totals
bomsRouter.get("/:id", asyncHandler(async (req, res) => {
  const bomResult = await pool.query(
    "SELECT * FROM boms WHERE id = $1 AND user_id = $2",
    [req.params.id, req.userId]
  );
  const bom = bomResult.rows[0];
  if (!bom) return res.status(404).json({ error: "BOM not found" });

  // These two queries don't depend on each other -- fire them together
  // instead of waiting on one before starting the next.
  const [sectionsResult, itemsResult] = await Promise.all([
    pool.query(
      `SELECT * FROM sections WHERE bom_id = $1 AND deleted_at IS NULL
       ORDER BY sort_order, created_at, id`,
      [bom.id]
    ),
    pool.query(
      `SELECT items.* FROM items
       JOIN sections ON items.section_id = sections.id
       WHERE sections.bom_id = $1 AND sections.deleted_at IS NULL AND items.deleted_at IS NULL
       ORDER BY items.sort_order, items.created_at, items.id`,
      [bom.id]
    ),
  ]);
  const sections = sectionsResult.rows;
  const allItems = itemsResult.rows;

  // Group items by section_id in one pass instead of re-scanning the
  // full item list once per section (was O(sections x items)).
  const itemsBySection = new Map();
  for (const item of allItems) {
    const bucket = itemsBySection.get(item.section_id);
    if (bucket) bucket.push(item);
    else itemsBySection.set(item.section_id, [item]);
  }
  const sectionsWithItems = sections.map((s) => ({
    ...s,
    items: itemsBySection.get(s.id) || [],
  }));

  const totals = calculateTotals(allItems, bom.tax_rate);

  res.json({ ...bom, sections: sectionsWithItems, totals });
}));

bomsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const title = validateBody(() => optionalString(req.body?.title, "title", 200), res);
  if (title === null && req.body?.title !== undefined && req.body?.title !== null) return;
  const tax_rate = validateBody(() => optionalNumber(req.body?.tax_rate, "tax_rate", { min: 0, max: 1 }), res);
  if (tax_rate === null && req.body?.tax_rate !== undefined && req.body?.tax_rate !== null && req.body?.tax_rate !== "") return;
  const result = await pool.query(
    `UPDATE boms SET title = COALESCE($1, title), tax_rate = COALESCE($2, tax_rate),
     updated_at = now() WHERE id = $3 AND user_id = $4 RETURNING *`,
    [title, tax_rate, req.params.id, req.userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "BOM not found" });
  res.json(result.rows[0]);
}));

// Rotate the public API key for this BOM. The old key is overwritten in
// place (not just soft-invalidated), so as soon as this commits the old
// key stops matching any row in Neon and every embed/integration using it
// starts getting 401s until they're updated with the new one.
bomsRouter.post("/:id/regenerate-key", asyncHandler(async (req, res) => {
  const newKey = crypto.randomBytes(24).toString("hex");
  const result = await pool.query(
    `UPDATE boms SET public_api_key = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3 RETURNING *`,
    [newKey, req.params.id, req.userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "BOM not found" });
  res.json(result.rows[0]);
}));

bomsRouter.delete("/:id/public-api-key", asyncHandler(async (req, res) => {
  const result = await pool.query(
    `UPDATE boms SET public_api_key = NULL, public_api_key_last_used_at = NULL, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [req.params.id, req.userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "BOM not found" });
  res.status(204).send();
}));

bomsRouter.delete("/:id", asyncHandler(async (req, res) => {
  await pool.query("DELETE FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.id,
    req.userId,
  ]);
  res.status(204).send();
}));

// --- Sections ---

bomsRouter.post("/:bomId/sections", asyncHandler(async (req, res) => {
  const title = validateBody(() => optionalString(req.body?.title, "title", 200), res);
  if (title === null && req.body?.title !== undefined && req.body?.title !== null) return;
  const emoji = validateBody(() => optionalString(req.body?.emoji, "emoji", 32), res);
  const icon_url = validateBody(() => optionalString(req.body?.icon_url, "icon_url", 4000), res);
  const sort_order = validateBody(() => optionalNumber(req.body?.sort_order, "sort_order", { min: 0, max: 100000000 }), res);
  if (res.locals.validationFailed) return;
  // ownership check
  const owns = await pool.query("SELECT id FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.bomId,
    req.userId,
  ]);
  if (!owns.rows[0]) return res.status(404).json({ error: "BOM not found" });

  // Always land new sections at the end unless a sort_order was
  // explicitly given -- this is the fix for the "new rows appear in
  // random places" bug (everything used to insert at sort_order 0).
  let order = sort_order;
  if (order === undefined || order === null) {
    const maxResult = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM sections WHERE bom_id = $1 AND deleted_at IS NULL",
      [req.params.bomId]
    );
    order = maxResult.rows[0].max_order + 1;
  }

  const result = await pool.query(
    `INSERT INTO sections (bom_id, title, emoji, icon_url, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.bomId, title || "Untitled Section", emoji, icon_url, order]
  );
  res.json(result.rows[0]);
}));

// Bulk reorder -- called after a drag-and-drop of table cards. Body:
// { orderedIds: [sectionId, sectionId, ...] } in the new desired order.
bomsRouter.patch("/:bomId/sections/reorder", asyncHandler(async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: "orderedIds must be a non-empty array" });
  }
  const owns = await pool.query("SELECT id FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.bomId,
    req.userId,
  ]);
  if (!owns.rows[0]) return res.status(404).json({ error: "BOM not found" });

  // Single statement instead of one UPDATE per row -- unnest() zips the
  // id list against its own index, so a 50-row reorder is one round trip
  // to Neon instead of 50 sequential ones.
  await pool.query(
    `UPDATE sections SET sort_order = data.new_order
     FROM (SELECT id, ord - 1 AS new_order
           FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)) AS data
     WHERE sections.id = data.id AND sections.bom_id = $2`,
    [orderedIds, req.params.bomId]
  );
  res.status(204).send();
}));

bomsRouter.patch("/sections/:sectionId", asyncHandler(async (req, res) => {
  const { title, emoji, icon_url, sort_order } = req.body;
  if (!await getOwnedSection(req.params.sectionId, req.userId)) {
    return res.status(404).json({ error: "Section not found" });
  }
  const result = await pool.query(
    `UPDATE sections SET title = COALESCE($1, title), emoji = COALESCE($2, emoji),
     icon_url = COALESCE($3, icon_url), sort_order = COALESCE($4, sort_order)
     WHERE id = $5 RETURNING *`,
    [title, emoji, icon_url, sort_order, req.params.sectionId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Section not found" });
  res.json(result.rows[0]);
}));

// Soft delete -- keeps the row (and its items) around so "undo" can
// bring it straight back by id instead of having to recreate everything
// from scratch with a brand new id.
bomsRouter.delete("/sections/:sectionId", asyncHandler(async (req, res) => {
  if (!await getOwnedSection(req.params.sectionId, req.userId)) {
    return res.status(404).json({ error: "Section not found" });
  }
  await pool.query("UPDATE sections SET deleted_at = now() WHERE id = $1", [req.params.sectionId]);
  res.status(204).send();
}));

bomsRouter.post("/sections/:sectionId/restore", asyncHandler(async (req, res) => {
  if (!await getOwnedSection(req.params.sectionId, req.userId)) {
    return res.status(404).json({ error: "Section not found" });
  }
  const result = await pool.query(
    "UPDATE sections SET deleted_at = NULL WHERE id = $1 RETURNING *",
    [req.params.sectionId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Section not found" });
  res.json(result.rows[0]);
}));

// POST /api/boms/:bomId/import-sheet
// Uploads a .xlsx/.xls/.csv following the fixed column layout (A: link,
// B: optional name override, C: qty, D: always ignored) and creates a new
// section per section-header row found, with its items underneath. Prices
// are left untouched here -- items with a URL get a scrape kicked off the
// same way manually-added items do, so price shows up shortly after.
bomsRouter.post("/:bomId/import-sheet", sheetUpload.single("file"), asyncHandler(async (req, res) => {
  const owns = await pool.query("SELECT id FROM boms WHERE id = $1 AND user_id = $2", [req.params.bomId, req.userId]);
  if (!owns.rows[0]) return res.status(404).json({ error: "BOM not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let parsed;
  try { parsed = parseSheet(req.file.buffer); }
  catch (e) {
    console.error("Failed to parse uploaded sheet:", e);
    return res.status(400).json({ error: "Could not parse file. Supported: .xlsx, .xls, .csv" });
  }
  if (!parsed.sections.length) return res.status(400).json({ error: "No sections or items found in that file" });

  const client = await pool.connect();
  const scrapeTargets = [];
  try {
    await client.query("BEGIN");
    const existingOrder = await client.query(
      "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM sections WHERE bom_id = $1 AND deleted_at IS NULL",
      [req.params.bomId]
    );
    let sortOrder = Number(existingOrder.rows[0].max_order) + 1;
    const createdSections = [];

    for (const section of parsed.sections) {
      const sectionResult = await client.query(
        `INSERT INTO sections (bom_id, title, sort_order) VALUES ($1, $2, $3) RETURNING *`,
        [req.params.bomId, section.title, sortOrder++]
      );
      const newSection = sectionResult.rows[0];
      let createdItems = [];
      if (section.items.length) {
        const names = section.items.map((i) => i.name);
        const urls = section.items.map((i) => i.url ?? null);
        const qtys = section.items.map((i) => i.qty);
        const sortOrders = section.items.map((_, i) => i);
        const itemsResult = await client.query(
          `INSERT INTO items (section_id, name, url, qty, sort_order, status)
           SELECT $1, data.name, data.url, data.qty, data.sort_order, CASE WHEN data.url IS NULL OR data.url = '' THEN 'price_not_found' ELSE 'pending' END
           FROM unnest($2::text[], $3::text[], $4::numeric[], $5::int[])
             AS data(name, url, qty, sort_order) RETURNING *`,
          [newSection.id, names, urls, qtys, sortOrders]
        );
        createdItems = itemsResult.rows.sort((a, b) => a.sort_order - b.sort_order);
        for (const item of createdItems) if (item.url) scrapeTargets.push({ id: item.id, url: item.url });
      }
      createdSections.push({ ...newSection, items: createdItems });
    }
    await client.query("UPDATE boms SET updated_at = now() WHERE id = $1", [req.params.bomId]);
    await client.query("COMMIT");
    // Only dispatch scrapes after the import is committed, so a fast callback
    // can never observe a half-imported BOM.
    for (const target of scrapeTargets) {
      triggerScrape(target.id, target.url).catch((e) => console.error("scrape trigger failed", e));
    }
    res.json({ sections: createdSections });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

// GET /api/boms/:bomId/export-sheet
// Downloads the BOM as a .xlsx in the same fixed column layout import-sheet
// reads, so it round-trips: export, edit in a spreadsheet app, re-import.
bomsRouter.get("/:bomId/export-sheet", asyncHandler(async (req, res) => {
  const bomResult = await pool.query(
    "SELECT * FROM boms WHERE id = $1 AND user_id = $2",
    [req.params.bomId, req.userId]
  );
  const bom = bomResult.rows[0];
  if (!bom) return res.status(404).json({ error: "BOM not found" });

  const [sectionsResult, itemsResult] = await Promise.all([
    pool.query(
      `SELECT * FROM sections WHERE bom_id = $1 AND deleted_at IS NULL
       ORDER BY sort_order, created_at, id`,
      [bom.id]
    ),
    pool.query(
      `SELECT items.* FROM items
       JOIN sections ON items.section_id = sections.id
       WHERE sections.bom_id = $1 AND sections.deleted_at IS NULL AND items.deleted_at IS NULL
       ORDER BY items.sort_order, items.created_at, items.id`,
      [bom.id]
    ),
  ]);
  const itemsBySection = new Map();
  for (const item of itemsResult.rows) {
    const bucket = itemsBySection.get(item.section_id);
    if (bucket) bucket.push(item);
    else itemsBySection.set(item.section_id, [item]);
  }
  const sectionsWithItems = sectionsResult.rows.map((s) => ({
    ...s,
    items: itemsBySection.get(s.id) || [],
  }));

  const buffer = buildSheetFromBom({ ...bom, sections: sectionsWithItems });

  // Keep the download filename readable but safe -- strip anything that
  // isn't a plain filename character so a crafted BOM title can't inject
  // extra header syntax into Content-Disposition.
  const safeTitle = (bom.title || "BOM").replace(/[^a-z0-9 _-]/gi, "").trim().slice(0, 80) || "BOM";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.xlsx"`);
  res.send(buffer);
}));

bomsRouter.post("/:bomId/refresh-items", scrapeLimiter, asyncHandler(async (req, res) => {
  const owns = await pool.query("SELECT id FROM boms WHERE id = $1 AND user_id = $2", [req.params.bomId, req.userId]);
  if (!owns.rows[0]) return res.status(404).json({ error: "BOM not found" });
  const filter = req.body?.filter || "all";
  if (!["amazon", "mouser", "other", "all"].includes(filter)) return res.status(400).json({ error: "filter must be 'amazon', 'mouser', 'other', or 'all'" });
  const result = await triggerBatchScrape(req.params.bomId, filter);
  if (!result) return res.status(500).json({ error: "Failed to start batch refresh job" });
  res.json({ triggered: result.triggered, filter, job_id: result.jobId });
}));

// --- Items ---

bomsRouter.post("/sections/:sectionId/items", asyncHandler(async (req, res) => {
  const name = validateBody(() => optionalString(req.body?.name, "name", 500), res);
  if (name === null) return;
  const url = validateBody(() => {
    const value = optionalString(req.body?.url, "url", 4000);
    return value ? validateProductUrl(value) : value;
  }, res);
  const qty = validateBody(() => optionalNumber(req.body?.qty, "qty", { min: 0, max: 100000000 }), res);
  const bold = validateBody(() => optionalBoolean(req.body?.bold, "bold"), res);
  const italic = validateBody(() => optionalBoolean(req.body?.italic, "italic"), res);
  const font_size = validateBody(() => optionalNumber(req.body?.font_size, "font_size", { min: 8, max: 96 }), res);
  const sort_order = validateBody(() => optionalNumber(req.body?.sort_order, "sort_order", { min: 0, max: 100000000 }), res);
  if (res.locals.validationFailed) return;
  if (!await getOwnedSection(req.params.sectionId, req.userId)) {
    return res.status(404).json({ error: "Section not found" });
  }

  // Same fix as sections: land at the end by default instead of always
  // sort_order 0, which is what caused rows to come back in random order
  // once a table had more than a couple of items.
  let order = sort_order;
  if (order === undefined || order === null) {
    const maxResult = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM items WHERE section_id = $1 AND deleted_at IS NULL",
      [req.params.sectionId]
    );
    order = maxResult.rows[0].max_order + 1;
  }

  const result = await pool.query(
    `INSERT INTO items (section_id, name, url, qty, bold, italic, font_size, sort_order, status)
     VALUES ($1, $2, $3, COALESCE($4, 1), COALESCE($5,false), COALESCE($6,false),
             COALESCE($7,19), $8, 'pending')
     RETURNING *`,
    [req.params.sectionId, name, url, qty, bold, italic, font_size, order]
  );
  const item = result.rows[0];

  // If a URL was given, kick off a scrape right away (fire and forget-ish)
  if (url) {
    triggerScrape(item.id, url).catch((e) => console.error("scrape trigger failed", e));
  }

  res.json(item);
}));

bomsRouter.patch("/items/:itemId", asyncHandler(async (req, res) => {
  if (!await getOwnedItem(req.params.itemId, req.userId)) {
    return res.status(404).json({ error: "Item not found" });
  }
  const name = validateBody(() => optionalString(req.body?.name, "name", 500), res);
  if (name === null && req.body?.name !== undefined && req.body?.name !== null) return;
  const url = validateBody(() => {
    const value = optionalString(req.body?.url, "url", 4000);
    return value ? validateProductUrl(value) : value;
  }, res);
  if (url === null && req.body?.url !== undefined && req.body?.url !== null) return;
  const qty = validateBody(() => optionalNumber(req.body?.qty, "qty", { min: 0, max: 100000000 }), res);
  if (qty === null && req.body?.qty !== undefined && req.body?.qty !== null && req.body?.qty !== "") return;
  const bold = validateBody(() => optionalBoolean(req.body?.bold, "bold"), res);
  const italic = validateBody(() => optionalBoolean(req.body?.italic, "italic"), res);
  const font_size = validateBody(() => optionalNumber(req.body?.font_size, "font_size", { min: 8, max: 96 }), res);
  const sort_order = validateBody(() => optionalNumber(req.body?.sort_order, "sort_order", { min: 0, max: 100000000 }), res);
  if (res.locals.validationFailed) return;
  const before = await pool.query("SELECT url FROM items WHERE id = $1", [req.params.itemId]);
  const previousUrl = before.rows[0]?.url || null;
  const result = await pool.query(
    `UPDATE items SET
       name = COALESCE($1, name), url = COALESCE($2, url), qty = COALESCE($3, qty),
       bold = COALESCE($4, bold), italic = COALESCE($5, italic),
       font_size = COALESCE($6, font_size), sort_order = COALESCE($7, sort_order),
       status = CASE WHEN $2 IS NOT NULL AND $2 IS DISTINCT FROM url THEN 'pending' ELSE status END,
       stale_price = CASE WHEN $2 IS NOT NULL AND $2 IS DISTINCT FROM url THEN false ELSE stale_price END
     WHERE id = $8 RETURNING *`,
    [name, url, qty, bold, italic, font_size, sort_order, req.params.itemId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  const item = result.rows[0];
  if (url && url !== previousUrl) {
    triggerScrape(item.id, url).catch((e) => console.error("scrape trigger failed", e));
  }
  res.json(item);
}));

// Explicit manual-price endpoint. Scraper-owned fields cannot be forged through
// the normal item PATCH endpoint. Manual prices are marked as manual so a later
// scrape can safely replace them when the user refreshes the product.
bomsRouter.patch("/items/:itemId/manual-price", asyncHandler(async (req, res) => {
  if (!await getOwnedItem(req.params.itemId, req.userId)) return res.status(404).json({ error: "Item not found" });
  const unit_price = validateBody(() => optionalNumber(req.body?.unit_price, "unit_price", { min: 0, max: 100000000000 }), res);
  if (unit_price === null && req.body?.unit_price !== undefined && req.body?.unit_price !== null) return;
  const result = await pool.query(
    `UPDATE items SET unit_price = $1, status = CASE WHEN $1 IS NULL THEN 'price_not_found' ELSE 'ok' END,
       source = CASE WHEN $1 IS NULL THEN NULL ELSE 'manual' END, stale_price = false, last_checked = now()
     WHERE id = $2 RETURNING *`,
    [unit_price ?? null, req.params.itemId]
  );
  res.json(result.rows[0]);
}));

bomsRouter.delete("/items/:itemId", asyncHandler(async (req, res) => {
  if (!await getOwnedItem(req.params.itemId, req.userId)) {
    return res.status(404).json({ error: "Item not found" });
  }
  await pool.query("UPDATE items SET deleted_at = now() WHERE id = $1", [req.params.itemId]);
  res.status(204).send();
}));

bomsRouter.post("/items/:itemId/restore", asyncHandler(async (req, res) => {
  if (!await getOwnedItem(req.params.itemId, req.userId)) {
    return res.status(404).json({ error: "Item not found" });
  }
  const result = await pool.query(
    "UPDATE items SET deleted_at = NULL WHERE id = $1 RETURNING *",
    [req.params.itemId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  res.json(result.rows[0]);
}));

// Bulk reorder within a section -- called after a row drag-and-drop.
// Body: { orderedIds: [itemId, itemId, ...] } in the new desired order.
bomsRouter.patch("/sections/:sectionId/items/reorder", asyncHandler(async (req, res) => {
  const { orderedIds } = req.body;
  if (!await getOwnedSection(req.params.sectionId, req.userId)) {
    return res.status(404).json({ error: "Section not found" });
  }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: "orderedIds must be a non-empty array" });
  }
  await pool.query(
    `UPDATE items SET sort_order = data.new_order
     FROM (SELECT id, ord - 1 AS new_order
           FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)) AS data
     WHERE items.id = data.id AND items.section_id = $2`,
    [orderedIds, req.params.sectionId]
  );
  res.status(204).send();
}));

// Manually re-trigger a scrape for one item. Every trigger receives a unique
// scrape_job_id; callbacks must present the same id, preventing an older
// GitHub Actions run from overwriting a newer price.
bomsRouter.post("/items/:itemId/refresh", scrapeLimiter, asyncHandler(async (req, res) => {
  if (!await getOwnedItem(req.params.itemId, req.userId)) return res.status(404).json({ error: "Item not found" });
  const itemResult = await pool.query("SELECT * FROM items WHERE id = $1", [req.params.itemId]);
  const item = itemResult.rows[0];
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (!item.url) return res.status(400).json({ error: "Item has no URL to scrape" });
  const jobId = await triggerScrape(item.id, item.url);
  if (!jobId) return res.status(503).json({ error: "Failed to start scrape job" });
  res.json({ status: "pending", job_id: jobId, message: "Scrape triggered, check back in ~30-60s" });
}));
