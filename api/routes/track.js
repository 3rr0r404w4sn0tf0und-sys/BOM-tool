import express from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";

// Scrape tracker backing the /track page: for every scrape method
// (amazon / mouser / etsy / generic), when it last ran, how many items are
// ok / stale / failed / pending, and the list of items that are currently
// stale or failed along with the last recorded failure reason.
//
// Read-only, scoped to BOMs the caller OWNS (scrapes run on the owner's
// schedule + Apify token, so "my scrapes" == "my BOMs"). Sheet docs are
// excluded -- they have no scrape UI. No schema changes: everything is
// derived from existing items columns (url, status, stale_price,
// unit_price, last_error, last_checked, source).
//
// KEEP IN SYNC with frontend/src/scrapeTrack.js -- the per-BOM debug
// panel classifies method/state client-side with the same rules.

export const trackRouter = express.Router();
trackRouter.use(requireAuth);

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." },
});
trackRouter.use(trackLimiter);

const FAILURE_LIST_LIMIT = 500;

// Same host patterns the scrapers/dispatcher use (ILIKE '%amazon.%' etc.),
// so an item lands in the same bucket here as it does when scraped.
// `state` is the one classification the UI cares about:
//   pending -> a scrape is in flight
//   stale   -> scrape failed but an older price is being kept
//   failed  -> no usable price (link_failed / price_not_found)
//   ok      -> everything else
const SCOPED_ITEMS_CTE = `
  WITH scoped AS (
    SELECT
      items.id,
      items.name,
      items.url,
      items.status,
      items.source,
      items.last_error,
      items.last_checked,
      boms.id AS bom_id,
      boms.title AS bom_title,
      CASE
        WHEN items.url ILIKE '%amazon.%' THEN 'amazon'
        WHEN items.url ILIKE '%mouser.%' THEN 'mouser'
        WHEN items.url ILIKE '%etsy.%'   THEN 'etsy'
        ELSE 'generic'
      END AS method,
      CASE
        WHEN items.status = 'pending' THEN 'pending'
        WHEN items.stale_price AND items.unit_price IS NOT NULL THEN 'stale'
        WHEN items.status IN ('link_failed', 'price_not_found') THEN 'failed'
        ELSE 'ok'
      END AS state
    FROM items
    JOIN sections ON items.section_id = sections.id
    JOIN boms ON sections.bom_id = boms.id
    WHERE boms.user_id = $1
      AND boms.doc_type = 'bom'
      AND sections.deleted_at IS NULL
      AND items.deleted_at IS NULL
      AND items.url IS NOT NULL
      AND items.url <> ''
  )
`;

trackRouter.get("/", asyncHandler(async (req, res) => {
  const [summaryResult, failuresResult] = await Promise.all([
    // Hand-typed prices (source = 'manual') set last_checked too, but they
    // aren't scrapes -- keep them out of the "last scrape" timestamps.
    pool.query(
      `${SCOPED_ITEMS_CTE}
       SELECT
         method,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE state = 'ok')::int AS ok,
         COUNT(*) FILTER (WHERE state = 'stale')::int AS stale,
         COUNT(*) FILTER (WHERE state = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE state = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE last_checked IS NULL AND state <> 'pending')::int AS never_checked,
         MAX(last_checked) FILTER (WHERE source IS DISTINCT FROM 'manual') AS last_scrape,
         MAX(last_checked) FILTER (WHERE state = 'ok' AND source IS DISTINCT FROM 'manual') AS last_success
       FROM scoped
       GROUP BY method`,
      [req.userId]
    ),
    pool.query(
      `${SCOPED_ITEMS_CTE}
       SELECT id, name, url, status, state, method, last_error, last_checked, bom_id, bom_title
       FROM scoped
       WHERE state IN ('failed', 'stale')
       ORDER BY last_checked DESC NULLS LAST, name
       LIMIT ${FAILURE_LIST_LIMIT}`,
      [req.userId]
    ),
  ]);

  // Always return a row for every method (even with zero items) so the
  // table on the page has a stable shape.
  const byMethod = new Map(summaryResult.rows.map((r) => [r.method, r]));
  const methods = ["amazon", "mouser", "etsy", "generic"].map((method) => (
    byMethod.get(method) || {
      method, total: 0, ok: 0, stale: 0, failed: 0, pending: 0,
      never_checked: 0, last_scrape: null, last_success: null,
    }
  ));

  const lastScrape = methods.reduce((latest, m) => {
    if (!m.last_scrape) return latest;
    return !latest || new Date(m.last_scrape) > new Date(latest) ? m.last_scrape : latest;
  }, null);

  const totalFailures = methods.reduce((n, m) => n + m.failed + m.stale, 0);

  res.json({
    methods,
    failures: failuresResult.rows,
    failures_truncated: totalFailures > failuresResult.rows.length,
    last_scrape: lastScrape,
    generated_at: new Date().toISOString(),
  });
}));
