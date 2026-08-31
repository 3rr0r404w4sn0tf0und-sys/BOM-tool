import crypto from "node:crypto";
import express from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { hostnameMatches } from "../lib/urlValidation.js";
import { decryptSecret } from "../lib/secretCrypto.js";

export const internalRouter = express.Router();

// Constant-time comparison, same approach as the CSRF check in
// middleware/auth.js -- a plain !== leaks timing info about how many
// leading bytes of the secret an attacker has guessed correctly.
function requireInternalSecret(req, res, next) {
  const configured = process.env.INTERNAL_SCRAPE_SECRET || "";
  const provided = req.header("X-Internal-Secret") || "";
  const configuredBuf = Buffer.from(configured, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  const valid =
    configured.length > 0 &&
    configuredBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(configuredBuf, providedBuf);
  if (!valid) return res.status(401).json({ error: "Invalid internal secret" });
  next();
}

// GET /api/internal/apify-credential?job_id=...
// Lets the GitHub Actions runner fetch the BOM owner's Apify token for a
// specific, currently-active scrape job, authenticated with the same
// internal secret as the result callback below -- instead of the token
// being placed directly into the repository_dispatch client_payload
// (visible in GitHub's event/workflow metadata). The credential is only
// returned while some item still has this exact job_id set, which
// happens to double as a natural expiry: once every item in the job has
// been reported back (scrape-result clears scrape_job_id) or a newer
// refresh has replaced it, this stops returning anything for that job.
internalRouter.get("/apify-credential", requireInternalSecret, asyncHandler(async (req, res) => {
  const jobId = req.query.job_id;
  if (!jobId || typeof jobId !== "string") return res.status(400).json({ error: "job_id required" });

  const ownerResult = await pool.query(
    `SELECT boms.user_id FROM items
     JOIN sections ON items.section_id = sections.id
     JOIN boms ON sections.bom_id = boms.id
     WHERE items.scrape_job_id = $1
     LIMIT 1`,
    [jobId]
  );
  const userId = ownerResult.rows[0]?.user_id;
  if (!userId) return res.status(404).json({ error: "No active job with that id" });

  const tokenResult = await pool.query("SELECT apify_token_encrypted FROM users WHERE id = $1", [userId]);
  const encrypted = tokenResult.rows[0]?.apify_token_encrypted;
  if (!encrypted) return res.json({ apify_token: null });

  try {
    res.json({ apify_token: decryptSecret(encrypted) || null });
  } catch (e) {
    console.error("Failed to decrypt Apify token for internal credential fetch:", e);
    res.json({ apify_token: null });
  }
}));

internalRouter.post("/scrape-result", requireInternalSecret, asyncHandler(async (req, res) => {
  const { item_id, job_id, found, price, source, error } = req.body;
  if (!item_id || !job_id) return res.status(400).json({ error: "item_id and job_id required" });

  const itemResult = await pool.query("SELECT id, url, unit_price FROM items WHERE id = $1", [item_id]);
  const item = itemResult.rows[0];
  if (!item) return res.status(404).json({ error: "Item not found" });

  // A callback from an older Actions run is harmless: the item has already
  // been assigned a different job id by a newer refresh. Never let it change
  // the price/status of the current job.
  const validJob = await pool.query("SELECT id FROM items WHERE id = $1 AND scrape_job_id = $2", [item_id, job_id]);
  if (!validJob.rows[0]) return res.status(409).json({ error: "Stale scrape result ignored" });

  let numericPrice = null;
  if (found) {
    numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice > 100000000000) {
      return res.status(400).json({ error: "Invalid scrape price" });
    }
  }

  const keepOldPrice = hostnameMatches(item.url, ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.ca", "amazon.nl", "mouser.com"]);
  let status = "price_not_found";
  if (found) status = "ok";
  else if (keepOldPrice && item.unit_price !== null) status = "ok";
  else if (error && String(error).toLowerCase().includes("link_failed")) status = "link_failed";

  // Truncate defensively -- this is a diagnostic string from an external
  // API response, not something we want able to bloat a row indefinitely.
  const errorText = found ? null : (error ? String(error).slice(0, 500) : null);

  const result = await pool.query(
    `UPDATE items SET
       unit_price = CASE WHEN $1 THEN $2 WHEN $6 AND $3 = 'ok' THEN unit_price ELSE NULL END,
       status = $3,
       source = CASE WHEN $1 THEN $4 ELSE source END,
       last_checked = now(),
       stale_price = CASE WHEN $1 THEN false WHEN $6 THEN true ELSE false END,
       last_error = $8,
       scrape_job_id = NULL
     WHERE id = $5 AND scrape_job_id = $7
     RETURNING *`,
    [Boolean(found), numericPrice, status, source || null, item_id, keepOldPrice, job_id, errorText]
  );

  if (!result.rows[0]) return res.status(409).json({ error: "Stale scrape result ignored" });
  res.json(result.rows[0]);
}));
