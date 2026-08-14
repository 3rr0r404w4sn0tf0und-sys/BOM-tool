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

// POST /api/internal/captcha-screenshot
// Called by the CAPTCHA-solve workflow when it hits a CAPTCHA wall.
// Body: { item_id, screenshot_base64 }
internalRouter.post("/captcha-screenshot", requireInternalSecret, async (req, res) => {
  const { item_id, screenshot_base64 } = req.body;
  if (!item_id || !screenshot_base64) {
    return res.status(400).json({ error: "item_id and screenshot_base64 required" });
  }

  const result = await pool.query(
    `UPDATE items SET
       captcha_status = 'needs_solution',
       captcha_screenshot = $1,
       captcha_solution = NULL,
       captcha_requested_at = now()
     WHERE id = $2 RETURNING id`,
    [screenshot_base64, item_id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  res.json({ ok: true });
});

// GET /api/internal/captcha-solution/:itemId
// Polled repeatedly by the CAPTCHA-solve workflow while it waits for the
// user to type the answer on the BOM page. 204 = not solved yet.
internalRouter.get("/captcha-solution/:itemId", requireInternalSecret, async (req, res) => {
  const result = await pool.query(
    "SELECT captcha_solution, captcha_status FROM items WHERE id = $1",
    [req.params.itemId]
  );
  const item = result.rows[0];
  if (!item) return res.status(404).json({ error: "Item not found" });

  if (item.captcha_status === "solution_submitted" && item.captcha_solution) {
    return res.json({ solved: true, solution: item.captcha_solution });
  }
  return res.status(204).send();
});

// POST /api/internal/captcha-timeout
// Called by the workflow if it gives up waiting (user never solved it).
// Falls back to keeping the old price with a stale flag, same as any
// other Amazon scrape failure.
internalRouter.post("/captcha-timeout", requireInternalSecret, async (req, res) => {
  const { item_id } = req.body;
  await pool.query(
    `UPDATE items SET captcha_status = NULL, captcha_screenshot = NULL,
     captcha_solution = NULL, stale_price = true WHERE id = $1`,
    [item_id]
  );
  res.json({ ok: true });
});

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
    `UPDATE items SET unit_price = $1, status = $2, source = $3, last_checked = now(),
       stale_price = false, captcha_status = NULL, captcha_screenshot = NULL, captcha_solution = NULL
     WHERE id = $4 RETURNING *`,
    [found ? price : null, status, source || null, item_id]
  );

  if (!result.rows[0]) return res.status(404).json({ error: "Item not found" });
  res.json(result.rows[0]);
});
