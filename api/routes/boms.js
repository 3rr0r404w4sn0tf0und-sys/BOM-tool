import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { calculateTotals } from "../db/totals.js";

export const bomsRouter = express.Router();
bomsRouter.use(requireAuth);

// --- BOMs ---

bomsRouter.post("/", async (req, res) => {
  const { title } = req.body;
  const apiKey = crypto.randomBytes(24).toString("hex");
  const result = await pool.query(
    `INSERT INTO boms (user_id, title, public_api_key) VALUES ($1, $2, $3) RETURNING *`,
    [req.userId, title || "Untitled BOM", apiKey]
  );
  res.json(result.rows[0]);
});

bomsRouter.get("/", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM boms WHERE user_id = $1 ORDER BY updated_at DESC",
    [req.userId]
  );
  res.json(result.rows);
});

// Full BOM with sections + items + calculated totals
bomsRouter.get("/:id", async (req, res) => {
  const bomResult = await pool.query(
    "SELECT * FROM boms WHERE id = $1 AND user_id = $2",
    [req.params.id, req.userId]
  );
  const bom = bomResult.rows[0];
  if (!bom) return res.status(404).json({ error: "BOM not found" });

  const sectionsResult = await pool.query(
    "SELECT * FROM sections WHERE bom_id = $1 ORDER BY sort_order",
    [bom.id]
  );
  const sections = sectionsResult.rows;

  const itemsResult = await pool.query(
    `SELECT items.* FROM items
     JOIN sections ON items.section_id = sections.id
     WHERE sections.bom_id = $1 ORDER BY items.sort_order`,
    [bom.id]
  );
  const allItems = itemsResult.rows;

  const sectionsWithItems = sections.map((s) => ({
    ...s,
    items: allItems.filter((i) => i.section_id === s.id),
  }));

  const totals = calculateTotals(allItems, bom.tax_rate);

  res.json({ ...bom, sections: sectionsWithItems, totals });
});

bomsRouter.patch("/:id", async (req, res) => {
  const { title, tax_rate } = req.body;
  const result = await pool.query(
    `UPDATE boms SET title = COALESCE($1, title), tax_rate = COALESCE($2, tax_rate),
     updated_at = now() WHERE id = $3 AND user_id = $4 RETURNING *`,
    [title, tax_rate, req.params.id, req.userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "BOM not found" });
  res.json(result.rows[0]);
});

bomsRouter.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.id,
    req.userId,
  ]);
  res.status(204).send();
});

// --- Sections ---

bomsRouter.post("/:bomId/sections", async (req, res) => {
  const { title, emoji, icon_url, sort_order } = req.body;
  // ownership check
  const owns = await pool.query("SELECT id FROM boms WHERE id = $1 AND user_id = $2", [
    req.params.bomId,
    req.userId,
  ]);
  if (!owns.rows[0]) return res.status(404).json({ error: "BOM not found" });

  const result = await pool.query(
    `INSERT INTO sections (bom_id, title, emoji, icon_url, sort_order)
     VALUES ($1, $2, $3, $4, COALESCE($5, 0)) RETURNING *`,
    [req.params.bomId, title || "Untitled Section", emoji, icon_url, sort_order]
  );
  res.json(result.rows[0]);
});

bomsRouter.patch("/sections/:sectionId", async (req, res) => {
  const { title, emoji, icon_url, sort_order } = req.body;
  const result = await pool.query(
    `UPDATE sections SET title = COALESCE($1, title), emoji = COALESCE($2, emoji),
     icon_url = COALESCE($3, icon_url), sort_order = COALESCE($4, sort_order)
     WHERE id = $5 RETURNING *`,
    [title, emoji, icon_url, sort_order, req.params.sectionId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Section not found" });
  res.json(result.rows[0]);
});

bomsRouter.delete("/sections/:sectionId", async (req, res) => {
  await pool.query("DELETE FROM sections WHERE id = $1", [req.params.sectionId]);
  res.status(204).send();
});

// --- Items ---

bomsRouter.post("/sections/:sectionId/items", async (req, res) => {
  const { name, url, qty, bold, italic, font_size, sort_order } = req.body;
  const result = await pool.query(
    `INSERT INTO items (section_id, name, url, qty, bold, italic, font_size, sort_order, status)
     VALUES ($1, $2, $3, COALESCE($4, 1), COALESCE($5,false), COALESCE($6,false),
             COALESCE($7,19), COALESCE($8,0), 'pending')
     RETURNING *`,
    [req.params.sectionId, name, url, qty, bold, italic, font_size, sort_order]
  );
  const item = result.rows[0];

  // If a URL was given, kick off a scrape right away (fire and forget-ish)
  if (url) {
    triggerScrape(item.id, url).catch((e) => console.error("scrape trigger failed", e));
  }

  res.json(item);
});

bomsRouter.patch("/items/:itemId", async (req, res) => {
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
  res.json(result.rows[0]);
});

bomsRouter.delete("/items/:itemId", async (req, res) => {
  await pool.query("DELETE FROM items WHERE id = $1", [req.params.itemId]);
  res.status(204).send();
});

// Manually re-trigger a scrape for one item (e.g. user clicks "refresh price")
bomsRouter.post("/items/:itemId/refresh", async (req, res) => {
  const itemResult = await pool.query("SELECT * FROM items WHERE id = $1", [
    req.params.itemId,
  ]);
  const item = itemResult.rows[0];
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (!item.url) return res.status(400).json({ error: "Item has no URL to scrape" });

  await triggerScrape(item.id, item.url);
  res.json({ status: "pending", message: "Scrape triggered, check back in ~30-60s" });
});

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
