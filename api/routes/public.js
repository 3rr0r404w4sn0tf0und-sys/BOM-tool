import express from "express";
import { pool } from "../db/pool.js";
import { calculateTotals } from "../db/totals.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import rateLimit from "express-rate-limit";

export const publicRouter = express.Router();
const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many API requests. Try again shortly." },
});
publicRouter.use(publicApiLimiter);

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
  pool.query("UPDATE boms SET public_api_key_last_used_at = now() WHERE id = $1", [bom.id])
    .catch((err) => console.error("API key last-used update failed:", err));
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
      link: i.url || null,
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

// GET /api/public/bom-html
// Same data as bom-clean, rendered as a ready-to-embed standalone HTML
// page (proper <table>, right-aligned $ prices, one consistent font
// size). Meant to be dropped into an <iframe> (e.g. on an Odoo page)
// instead of making the host site build its own table from the JSON
// feed -- avoids every embedder reinventing (and often mangling) the
// same layout.
publicRouter.get("/bom-html", getBomByApiKey, asyncHandler(async (req, res) => {
  const { sections, items } = await loadFullBom(req.bom);
  const totals = calculateTotals(items, req.bom.tax_rate);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

  const money = (n) => `$${Number(n).toFixed(2)}`;

  const sectionsHtml = sections.map((s) => {
    const rowsHtml = s.items.map((i) => {
      const nameStyle = [
        i.bold ? "font-weight:700;" : "",
        i.italic ? "font-style:italic;" : "",
      ].join("");
      const priceOk = i.status === "ok" && i.unit_price !== null;
      const priceText = priceOk ? money(i.unit_price) : "Link Failed";
      const nameHtml = i.url
        ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">${esc(i.name)}</a>`
        : esc(i.name);
      return `
        <tr>
          <td class="name" style="${nameStyle}">${nameHtml}</td>
          <td class="qty">${Number(i.qty)}</td>
          <td class="price${priceOk ? "" : " price-failed"}">${priceText}</td>
        </tr>`;
    }).join("");

    const icon = s.icon_url
      ? `<img src="${esc(s.icon_url)}" alt="" class="section-icon" />`
      : s.emoji ? `<span class="section-icon">${esc(s.emoji)}</span>` : "";

    return `
      <table class="bom-section">
        <thead>
          <tr class="section-title-row">
            <th colspan="3">${icon}${esc(s.title)}</th>
          </tr>
          <tr class="col-headers">
            <th class="name">Name</th>
            <th class="qty">Qty</th>
            <th class="price">Cost</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(req.bom.title)}</title>
<style>
  :root {
    --bg: #14171f;
    --card-bg: #1c202b;
    --header-bg: #0d0f16;
    --header-text: #ffffff;
    --border: #333947;
    --text: #e7e9ee;
    --muted: #9095a3;
    --failed: #ff7a6b;
    --accent: #5b9cff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 17px;
    line-height: 1.4;
  }
  .bom-wrap { max-width: 900px; margin: 0 auto; }
  h1 {
    font-size: 17px;
    font-weight: 700;
    text-align: center;
    margin: 0 0 20px;
  }
  .bom-section {
    width: 100%;
    border-collapse: collapse;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 18px;
    table-layout: fixed;
  }
  .section-title-row th {
    background: var(--header-bg);
    color: var(--header-text);
    font-size: 17px;
    font-weight: 700;
    text-align: left;
    padding: 12px 16px;
    border: none;
  }
  .section-icon { margin-right: 8px; }
  .col-headers th {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    padding: 8px 16px;
  }
  .col-headers th:last-child { border-right: none; }
  .col-headers .qty, .col-headers .price { text-align: right; }
  td {
    font-size: 17px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    vertical-align: middle;
  }
  td:last-child { border-right: none; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
  td.name { text-align: left; word-break: break-word; }
  td.qty { text-align: right; width: 70px; color: var(--muted); }
  td.price { text-align: right; width: 110px; font-variant-numeric: tabular-nums; }
  td.price-failed { color: var(--failed); font-style: italic; font-size: 14px; }
  .totals {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    font-size: 17px;
  }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 6px; border: 3px solid var(--bg); }
  ::-webkit-scrollbar-thumb:hover { background: var(--muted); }
  html { scrollbar-color: var(--border) var(--bg); scrollbar-width: thin; }
  .totals .row.total { font-weight: 700; border-top: 1px solid var(--border); margin-top: 6px; padding-top: 10px; }
  .totals .muted { color: var(--muted); font-size: 13px; }
  .footer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 16px; }
  .footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
  <div class="bom-wrap">
    <h1>${esc(req.bom.title)}</h1>
    ${sectionsHtml}
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>
      <div class="row"><span>Tax</span><span>${money(totals.tax)}</span></div>
      <div class="row total"><span>Total</span><span>${money(totals.total)}</span></div>
      ${totals.excludedCount ? `<div class="muted">${totals.excludedCount} item(s) excluded from totals</div>` : ""}
    </div>
    <div class="footer">Powered by <a href="${esc(SITE_URL)}" target="_blank" rel="noopener noreferrer">${esc(SITE_NAME)}</a></div>
  </div>
</body>
</html>`;

  res.set("Content-Type", "text/html; charset=utf-8");
  // Allow this to be framed by any site -- like /api/public/* generally,
  // the security boundary is the api_key in the URL, not the embedding
  // origin, so there's no reason to block embedding here. Both of these
  // are needed: helmet's global CSP sets frame-ancestors 'none' (blocks
  // ALL embedding on its own, regardless of X-Frame-Options) and also
  // adds X-Frame-Options: SAMEORIGIN as a legacy fallback for older
  // browsers that don't understand frame-ancestors.
  res.removeHeader("X-Frame-Options");
  res.set("Content-Security-Policy", "frame-ancestors *");
  res.send(html);
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
