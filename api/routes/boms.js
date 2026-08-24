import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import multer from "multer";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { calculateTotals } from "../db/totals.js";
import { parseSheet } from "../lib/sheetImport.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const bomsRouter = express.Router();
bomsRouter.use(requireAuth);

// Sheet imports (.xlsx / .xls / .csv) — kept small, this isn't for
// uploading giant spreadsheets, just a BOM a few hundred rows long.
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- BOMs ---

bomsRouter.post("/", asyncHandler(async (req, res) => {
  const { title } = req.body;
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
  const { title, tax_rate } = req.body;
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

bomsRouter.delete("/:id", asyncHandler(async (req, res) => {
  await pool.query("DELETE FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.id,
    req.userId,
  ]);
  res.status(204).send();
}));

// --- Sections ---

bomsRouter.post("/:bomId/sections", asyncHandler(async (req, res) => {
  const { title, emoji, icon_url, sort_order } = req.body;
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
  await pool.query("UPDATE sections SET deleted_at = now() WHERE id = $1", [req.params.sectionId]);
  res.status(204).send();
}));

bomsRouter.post("/sections/:sectionId/restore", asyncHandler(async (req, res) => {
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
  const owns = await pool.query("SELECT id FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.bomId,
    req.userId,
  ]);
  if (!owns.rows[0]) return res.status(404).json({ error: "BOM not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let parsed;
  try {
    parsed = parseSheet(req.file.buffer);
  } catch (e) {
    console.error("Failed to parse uploaded sheet:", e);
    return res.status(400).json({ error: "Could not parse file. Supported: .xlsx, .xls, .csv" });
  }

  if (!parsed.sections.length) {
    return res.status(400).json({ error: "No sections or items found in that file" });
  }

  const existingOrder = await pool.query(
    "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM sections WHERE bom_id = $1 AND deleted_at IS NULL",
    [req.params.bomId]
  );
  let sortOrder = existingOrder.rows[0].max_order + 1;

  const createdSections = [];
  for (const section of parsed.sections) {
    const sectionResult = await pool.query(
      `INSERT INTO sections (bom_id, title, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.bomId, section.title, sortOrder++]
    );
    const newSection = sectionResult.rows[0];

    let createdItems = [];
    if (section.items.length) {
      // One multi-row insert for the whole section instead of one
      // round trip per item -- a sheet with a few hundred rows used to
      // mean a few hundred sequential queries.
      const names = section.items.map((i) => i.name);
      const urls = section.items.map((i) => i.url ?? null);
      const qtys = section.items.map((i) => i.qty);
      const sortOrders = section.items.map((_, i) => i);
      const itemsResult = await pool.query(
        `INSERT INTO items (section_id, name, url, qty, sort_order, status)
         SELECT $1, data.name, data.url, data.qty, data.sort_order, 'pending'
         FROM unnest($2::text[], $3::text[], $4::numeric[], $5::int[])
              AS data(name, url, qty, sort_order)
         RETURNING *`,
        [newSection.id, names, urls, qtys, sortOrders]
      );
      createdItems = itemsResult.rows.sort((a, b) => a.sort_order - b.sort_order);
      for (const newItem of createdItems) {
        if (newItem.url) {
          triggerScrape(newItem.id, newItem.url).catch((e) =>
            console.error("scrape trigger failed", e)
          );
        }
      }
    }
    createdSections.push({ ...newSection, items: createdItems });
  }

  await pool.query("UPDATE boms SET updated_at = now() WHERE id = $1", [req.params.bomId]);

  res.json({ sections: createdSections });
}));

// POST /api/boms/:bomId/refresh-items
// Bulk re-trigger scrapes for every item in this BOM that has a URL.
// body: { filter: "amazon" | "non-amazon" | "all" } (defaults to "all")
// Reuses the same per-item scrape-on-demand workflow as a single manual
// refresh -- that workflow (actions_scrape_one.py) already branches on
// Amazon vs non-Amazon internally, this endpoint just decides which rows
// to fire it for.
bomsRouter.post("/:bomId/refresh-items", asyncHandler(async (req, res) => {
  const owns = await pool.query("SELECT id FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.bomId,
    req.userId,
  ]);
  if (!owns.rows[0]) return res.status(404).json({ error: "BOM not found" });

  const filter = req.body?.filter || "all";
  if (!["amazon", "non-amazon", "all"].includes(filter)) {
    return res.status(400).json({ error: "filter must be 'amazon', 'non-amazon', or 'all'" });
  }

  let urlCondition = "";
  if (filter === "amazon") urlCondition = "AND items.url ILIKE '%amazon.%'";
  else if (filter === "non-amazon") urlCondition = "AND items.url NOT ILIKE '%amazon.%'";

  // Mark everything that's about to be scraped as pending right away so
  // the UI shows the "pending…" state immediately instead of waiting for
  // the batch job to touch each row.
  const pendingResult = await pool.query(
    `UPDATE items SET status = 'pending'
     FROM sections
     WHERE items.section_id = sections.id
       AND sections.bom_id = $1
       AND items.url IS NOT NULL AND items.url != '' ${urlCondition}
     RETURNING items.id`,
    [req.params.bomId]
  );

  const ghRepo = process.env.GITHUB_REPO;
  const ghToken = process.env.GITHUB_DISPATCH_TOKEN;
  if (!ghRepo || !ghToken) {
    console.error("GITHUB_REPO / GITHUB_DISPATCH_TOKEN not set, cannot trigger batch scrape");
    return res.status(500).json({ error: "Scraper not configured on the server" });
  }

  try {
    const resp = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "bom-batch-scrape-request",
        client_payload: { bom_id: req.params.bomId, filter },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("GitHub batch dispatch failed:", resp.status, text);
      return res.status(500).json({ error: "Failed to start batch refresh job" });
    }
  } catch (e) {
    console.error("Failed to trigger GitHub Actions batch scrape:", e);
    return res.status(500).json({ error: "Failed to start batch refresh job" });
  }

  res.json({ triggered: pendingResult.rows.length, filter });
}));

// --- Items ---

bomsRouter.post("/sections/:sectionId/items", asyncHandler(async (req, res) => {
  const { name, url, qty, bold, italic, font_size, sort_order } = req.body;

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
  const { name, url, qty, bold, italic, font_size, sort_order, unit_price, status } = req.body;
  const result = await pool.query(
    `UPDATE items SET
       name = COALESCE($1, name),
       url = COALESCE($2, url),
       qty = COALESCE($3, qty),
       bold = COALESCE($4, bold),
       italic = COALESCE($5, italic),
       font_size = COALESCE($6, font_size),
       sort_order = COALESCE($7, sort_order),
       unit_price = COALESCE($8, unit_price),
       status = COALESCE($9, status)
     WHERE id = $10 RETURNING *`,
    [name, url, qty, bold, italic, font_size, sort_order, unit_price, status, req.params.itemId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  const item = result.rows[0];

  // A URL was just set/changed via inline edit -- kick off a scrape right
  // away instead of leaving the item stuck at its default "pending" status
  // until someone notices and hits the manual refresh button.
  if (url) {
    triggerScrape(item.id, url).catch((e) => console.error("scrape trigger failed", e));
  }

  res.json(item);
}));

bomsRouter.delete("/items/:itemId", asyncHandler(async (req, res) => {
  await pool.query("UPDATE items SET deleted_at = now() WHERE id = $1", [req.params.itemId]);
  res.status(204).send();
}));

bomsRouter.post("/items/:itemId/restore", asyncHandler(async (req, res) => {
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

// POST /api/boms/items/:itemId/request-captcha-refresh
// User clicks "Solve CAPTCHA" on a stale Amazon item. Fires the special
// CAPTCHA-aware workflow instead of the normal scrape-on-demand one.
bomsRouter.post("/items/:itemId/request-captcha-refresh", asyncHandler(async (req, res) => {
  const itemResult = await pool.query("SELECT * FROM items WHERE id = $1", [
    req.params.itemId,
  ]);
  const item = itemResult.rows[0];
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (!item.url) return res.status(400).json({ error: "Item has no URL" });

  await pool.query(
    "UPDATE items SET captcha_status = 'awaiting_screenshot' WHERE id = $1",
    [item.id]
  );

  const ghRepo = process.env.GITHUB_REPO;
  const ghToken = process.env.GITHUB_DISPATCH_TOKEN;
  try {
    await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "captcha-scrape-request",
        client_payload: {
          item_id: item.id,
          url: item.url,
          api_base_url: process.env.API_PUBLIC_URL,
        },
      }),
    });
  } catch (e) {
    console.error("Failed to trigger CAPTCHA workflow:", e);
    return res.status(500).json({ error: "Failed to start CAPTCHA-solve job" });
  }

  res.json({ status: "started", message: "Screenshot will appear in ~20-40s" });
}));

// GET /api/boms/items/:itemId/captcha
// Frontend polls this while waiting for the screenshot to show up.
bomsRouter.get("/items/:itemId/captcha", asyncHandler(async (req, res) => {
  const result = await pool.query(
    "SELECT id, captcha_status, captcha_screenshot FROM items WHERE id = $1",
    [req.params.itemId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  res.json(result.rows[0]);
}));

// POST /api/boms/items/:itemId/captcha-solution
// User types the CAPTCHA text and submits it here.
bomsRouter.post("/items/:itemId/captcha-solution", asyncHandler(async (req, res) => {
  const { solution } = req.body;
  if (!solution) return res.status(400).json({ error: "solution required" });

  const result = await pool.query(
    `UPDATE items SET captcha_solution = $1, captcha_status = 'solution_submitted'
     WHERE id = $2 RETURNING id`,
    [solution, req.params.itemId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  res.json({ ok: true });
}));

// Manually re-trigger a scrape for one item (e.g. user clicks "refresh price")
bomsRouter.post("/items/:itemId/refresh", asyncHandler(async (req, res) => {
  const itemResult = await pool.query("SELECT * FROM items WHERE id = $1", [
    req.params.itemId,
  ]);
  const item = itemResult.rows[0];
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (!item.url) return res.status(400).json({ error: "Item has no URL to scrape" });

  await triggerScrape(item.id, item.url);
  res.json({ status: "pending", message: "Scrape triggered, check back in ~30-60s" });
}));

// Fires a GitHub Actions `repository_dispatch` event that runs a single
// Playwright scrape in a fresh Actions VM (2 vCPU / 7GB, real browser,
// no card, free for public repos). The workflow POSTs its result back to
// /api/internal/scrape-result once done -- this function does NOT wait
// for that; it just marks the item "pending" and kicks the job off.
// Expect the price to show up ~20-60s later. See:
//   .github/workflows/scrape-on-demand.yml
async function triggerScrape(itemId, url) {
  await pool.query("UPDATE items SET status = 'pending' WHERE id = $1", [itemId]);

  const ghRepo = process.env.GITHUB_REPO; // e.g. "yourname/bom-tool"
  const ghToken = process.env.GITHUB_DISPATCH_TOKEN; // PAT with repo scope

  if (!ghRepo || !ghToken) {
    console.error("GITHUB_REPO / GITHUB_DISPATCH_TOKEN not set, cannot trigger scrape");
    await pool.query("UPDATE items SET status = 'price_not_found' WHERE id = $1", [itemId]);
    return;
  }

  try {
    const resp = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "scrape-request",
        client_payload: {
          item_id: itemId,
          url,
          callback_url: `${process.env.API_PUBLIC_URL}/api/internal/scrape-result`,
        },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("GitHub dispatch failed:", resp.status, text);
    }
  } catch (e) {
    console.error("Failed to trigger GitHub Actions scrape:", e);
  }
}
