import express from "express";
import { pool } from "../db/pool.js";

export const internalRouter = express.Router();

// Shared-secret auth -- only the GitHub Actions workflow should call this,
// never the browser. Not a JWT/user route.
function requireInternalSecret(req, res, next) {
  const secret = req.header("X-Internal-Secret");
  if (!secret || secret !== process.env.INTERNAL_SCRAPE_SECRET) {
    return res.status(401).json({ error: "Invalid internal secret" });
  }
  next();
}

// POST /api/internal/scrape-result
// Body: { item_id, found, price, source, error }
// Called by the on-demand GitHub Actions workflow once a single-item
// scrape finishes (see .github/workflows/scrape-on-demand.yml).
internalRouter.post("/scrape-result", requireInternalSecret, async (req, res) => {
  const { item_id, found, price, source, error } = req.body;
  if (!item_id) return res.status(400).json({ error: "item_id required" });

  let status = "price_not_found";
  if (found) {
    status = "ok";
  } else if (error && error.toLowerCase().includes("link_failed")) {
    status = "link_failed";
  }

  const result = await pool.query(
    `UPDATE items SET unit_price = $1, status = $2, source = $3, last_checked = now()
     WHERE id = $4 RETURNING *`,
    [found ? price : null, status, source || null, item_id]
  );

  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  res.json(result.rows[0]);
});
