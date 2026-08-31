import express from "express";
import crypto from "node:crypto";
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

  // Keys are stored as sha256 hashes (see migrations/012_hashed_api_keys.sql),
  // never raw -- look up by hash, not the incoming plaintext value.
  const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const bomResult = await pool.query("SELECT * FROM boms WHERE public_api_key_hash = $1", [
    keyHash,
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
  // Map-based grouping instead of an O(sections x items) filter() per
  // section -- matters once a public BOM has more than a handful of
  // sections/items, since this route has no auth to slow abuse down.
  const itemsBySection = new Map();
  for (const item of items) {
    const bucket = itemsBySection.get(item.section_id);
    if (bucket) bucket.push(item);
    else itemsBySection.set(item.section_id, [item]);
  }
  const sections = sectionsResult.rows.map((s) => ({
    ...s,
    items: itemsBySection.get(s.id) || [],
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

// Belt-and-suspenders: item.url should already be http(s)-only from
// urlValidation.js at write time, but this route renders straight into
// an href with no further checks, so re-verify the scheme here too --
// a bad value that slipped in through some other path (direct DB edit,
// future import path, etc.) should never become a javascript: link.
function safeHref(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// Shared renderer for both /bom-html (showPrice: true) and
// /bom-links-html (showPrice: false) -- same layout either way, just
// with or without the price column, and the item name as a visibly
// underlined link (instead of an invisible-color one) when there's no
// price column drawing the eye.
function renderBomHtmlPage(bom, sections, totals, { showPrice }) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

  const money = (n) => `$${Number(n).toFixed(2)}`;
  const colspan = showPrice ? 3 : 2;

  const sectionsHtml = sections.map((s) => {
    const rowsHtml = s.items.map((i) => {
      const nameStyle = [
        i.bold ? "font-weight:700;" : "",
        i.italic ? "font-style:italic;" : "",
      ].join("");
      const priceOk = i.status === "ok" && i.unit_price !== null;
      const priceText = priceOk ? money(i.unit_price) : "Link Failed";
      const href = safeHref(i.url);
      const nameHtml = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="${showPrice ? "" : "visible-link"}" style="${showPrice ? "color:inherit;text-decoration:none;" : ""}">${esc(i.name)}</a>`
        : esc(i.name);
      const priceCell = showPrice
        ? `<td class="price${priceOk ? "" : " price-failed"}">${priceText}</td>`
        : "";
      return `
        <tr>
          <td class="name" style="${nameStyle}">${nameHtml}</td>
          <td class="qty">${Number(i.qty)}</td>
          ${priceCell}
        </tr>`;
    }).join("");

    const icon = safeHref(s.icon_url)
      ? `<img src="${esc(s.icon_url)}" alt="" class="section-icon" />`
      : s.emoji ? `<span class="section-icon">${esc(s.emoji)}</span>` : "";

    return `
      <table class="bom-section">
        <thead>
          <tr class="section-title-row">
            <th colspan="${colspan}">${icon}${esc(s.title)}</th>
          </tr>
          <tr class="col-headers">
            <th class="name">Name</th>
            <th class="qty">Qty</th>
            ${showPrice ? `<th class="price">Cost</th>` : ""}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(bom.title)}</title>
<style>
  :root {
    --bg: #f4f5f7;
    --card-bg: #ffffff;
    --header-bg: #1f2430;
    --header-text: #ffffff;
    --border: #d8dbe0;
    --text: #1f2430;
    --muted: #6b7280;
    --failed: #c0392b;
    --accent: #2f6fed;
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
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
  }
  .col-headers .qty, .col-headers .price { text-align: right; }
  td { font-size: 17px; padding: 10px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  td.name { text-align: left; word-break: break-word; }
  td.qty { text-align: right; width: 70px; color: var(--muted); }
  td.price { text-align: right; width: 110px; font-variant-numeric: tabular-nums; }
  td.price-failed { color: var(--failed); font-style: italic; font-size: 14px; }
  a.visible-link { color: var(--accent); text-decoration: underline; }
  .totals {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    font-size: 17px;
  }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row.total { font-weight: 700; border-top: 1px solid var(--border); margin-top: 6px; padding-top: 10px; }
  .totals .muted { color: var(--muted); font-size: 13px; }
  .footer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 16px; }
  .footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
  <div class="bom-wrap">
    <h1>${esc(bom.title)}</h1>
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
}

function sendEmbeddableHtml(res, html) {
  res.set("Content-Type", "text/html; charset=utf-8");
  // Allow this to be framed by any site -- like /api/public/* generally,
  // the security boundary is the api_key in the URL, not the embedding
  // origin, so there's no reason to block embedding here. Both of these
  // are needed: helmet's global CSP sets frame-ancestors 'none' (blocks
  // ALL embedding on its own, regardless of X-Frame-Options) and also
  // adds X-Frame-Options: SAMEORIGIN as a legacy fallback for older
  // browsers that don't understand frame-ancestors.
  res.removeHeader("X-Frame-Options");
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; " +
    "img-src https: http:; style-src 'unsafe-inline'; frame-ancestors *"
  );
  res.send(html);
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
// Ready-to-embed standalone HTML page: Name / Qty / Cost per row, proper
// <table>, right-aligned $ prices, one consistent font size. Meant to be
// dropped into an <iframe> instead of making the host site build its own
// table from the JSON feed -- avoids every embedder reinventing (and
// often mangling) the same layout.
publicRouter.get("/bom-html", getBomByApiKey, asyncHandler(async (req, res) => {
  const { sections, items } = await loadFullBom(req.bom);
  const totals = calculateTotals(items, req.bom.tax_rate);
  sendEmbeddableHtml(res, renderBomHtmlPage(req.bom, sections, totals, { showPrice: true }));
}));

// GET /api/public/bom-links-html
// Same embeddable page, but Name/Qty only, with the name as a clearly
// visible (colored + underlined) link -- for cases where the point is
// "here's where to buy each part," not a live price table. Totals still
// show once at the bottom, same as bom-html.
publicRouter.get("/bom-links-html", getBomByApiKey, asyncHandler(async (req, res) => {
  const { sections, items } = await loadFullBom(req.bom);
  const totals = calculateTotals(items, req.bom.tax_rate);
  sendEmbeddableHtml(res, renderBomHtmlPage(req.bom, sections, totals, { showPrice: false }));
}));

// GET /api/public/bom-links
// Flat list: Item, Price (as hyperlink to the original product URL)
publicRouter.get("/bom-links", getBomByApiKey, asyncHandler(async (req, res) => {
  const { items } = await loadFullBom(req.bom);

  const rows = items.map((i) => ({
    item: i.name,
    price: priceLabel(i),
    link: i.url && /^https?:\/\//i.test(i.url) ? i.url : null,
  }));

  res.json({
    title: req.bom.title,
    rows,
    ...footer(),
  });
}));
