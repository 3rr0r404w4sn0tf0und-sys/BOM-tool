import express from "express";
import { pool } from "../db/pool.js";
import { calculateTotals } from "../db/totals.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const publicRouter = express.Router();

// Auth via API key. Prefer the X-API-Key header, but also accept
// ?api_key=... in the query string -- tools like Google Sheets'
// IMPORTDATA/IMPORTJSON and Odoo's simpler HTTP nodes can't always set
// custom headers, so a URL-embedded key keeps this usable from those.
async function getBomByApiKey(req, res, next) {
  const apiKey = req.header("X-API-Key") || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: "Missing API key (X-API-Key header or ?api_key=)" });

  const bomResult = await pool.query("SELECT * FROM boms WHERE public_api_key = $1", [
    apiKey,
  ]);
  const bom = bomResult.rows[0];
  if (!bom) return res.status(401).json({ error: "Invalid API key" });

  req.bom = bom;
  next();
}

async function loadFullBom(bom) {
  const sectionsResult = await pool.query(
    `SELECT * FROM sections WHERE bom_id = $1 AND deleted_at IS NULL
     ORDER BY sort_order, created_at, id`,
    [bom.id]
  );
  const itemsResult = await pool.query(
    `SELECT items.* FROM items
     JOIN sections ON items.section_id = sections.id
     WHERE sections.bom_id = $1 AND sections.deleted_at IS NULL AND items.deleted_at IS NULL
     ORDER BY items.sort_order, items.created_at, items.id`,
    [bom.id]
  );
  const items = itemsResult.rows;
  const sections = sectionsResult.rows.map((s) => ({
    ...s,
    items: items.filter((i) => i.section_id === s.id),
  }));
  return { sections, items };
}

const SITE_NAME = process.env.SITE_NAME || "BOM Tool";
const SITE_URL = process.env.SITE_URL || "https://example.com";

function footer() {
  return { powered_by: SITE_NAME, url: SITE_URL };
}

function priceLabel(item) {
  if (item.status !== "ok" || item.unit_price === null) {
    return "Link Failed";
  }
  return Number(item.unit_price).toFixed(2);
}

// GET /api/public/bom-clean
// Full formatted BOM with sections + emoji titles, grouped rows, totals.
publicRouter.get("/bom-clean", getBomByApiKey, asyncHandler(async (req, res) => {
  const { sections, items } = await loadFullBom(req.bom);
  const totals = calculateTotals(items, req.bom.tax_rate);

  const formattedSections = sections.map((s) => ({
    title: s.title,
    emoji: s.emoji,
    icon_url: s.icon_url,
    rows: s.items.map((i) => ({
      item: i.name,
      qty: Number(i.qty),
      price: priceLabel(i),
      bold: i.bold,
      italic: i.italic,
      font_size: i.font_size,
    })),
  }));

  res.json({
    title: req.bom.title,
    sections: formattedSections,
    subtotal: totals.subtotal.toFixed(2),
    tax: totals.tax.toFixed(2),
    total: totals.total.toFixed(2),
    excluded_items: totals.excludedCount,
    ...footer(),
  });
}));

// GET /api/public/bom-links
// Flat list: Item, Price (as hyperlink to the original product URL)
publicRouter.get("/bom-links", getBomByApiKey, asyncHandler(async (req, res) => {
  const { items } = await loadFullBom(req.bom);

  const rows = items.map((i) => ({
    item: i.name,
    price: priceLabel(i),
    link: i.url || null,
  }));

  res.json({
    title: req.bom.title,
    rows,
    ...footer(),
  });
}));
