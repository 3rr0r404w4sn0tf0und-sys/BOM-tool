import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import { validateProductUrl } from "./urlValidation.js";
import { decryptSecret } from "./secretCrypto.js";

async function githubDispatch(event_type, client_payload) {
  const ghRepo = process.env.GITHUB_REPO;
  const ghToken = process.env.GITHUB_DISPATCH_TOKEN;
  if (!ghRepo || !ghToken) throw new Error("Scraper is not configured");

  const resp = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type, client_payload }),
  });
  if (!resp.ok) throw new Error(`GitHub dispatch failed (${resp.status}): ${await resp.text()}`);
}

// Looks up and decrypts the BOM owner's own Apify token, if they've set
// one. Returns undefined (not null) when absent so it's easy to spread/
// omit from a client_payload object rather than sending an explicit null.
// There is no shared/site-wide Apify token anymore -- every user brings
// their own (Settings -> Apify API key). If this returns undefined, the
// workflow simply has no Apify token to work with: apify_scrape.py etc.
// report "Apify not configured" and actions_scrape_one.py falls back to
// the plain HTTP fetch path, same as any other Apify failure.
async function getOwnerApifyToken(userId) {
  if (!userId) return undefined;
  const result = await pool.query("SELECT apify_token_encrypted FROM users WHERE id = $1", [userId]);
  const encrypted = result.rows[0]?.apify_token_encrypted;
  if (!encrypted) return undefined;
  try {
    return decryptSecret(encrypted) || undefined;
  } catch (e) {
    console.error("Failed to decrypt user's Apify token:", e);
    return undefined;
  }
}

export async function triggerScrape(itemId, url) {
  validateProductUrl(url);
  const jobId = crypto.randomUUID();
  await pool.query(
    "UPDATE items SET status = 'pending', stale_price = false, scrape_job_id = $2 WHERE id = $1",
    [itemId, jobId]
  );
  try {
    const ownerResult = await pool.query(
      `SELECT boms.user_id FROM items
       JOIN sections ON items.section_id = sections.id
       JOIN boms ON sections.bom_id = boms.id
       WHERE items.id = $1`,
      [itemId]
    );
    const apifyToken = await getOwnerApifyToken(ownerResult.rows[0]?.user_id);
    await githubDispatch("scrape-request", {
      item_id: itemId,
      job_id: jobId,
      url,
      callback_url: `${process.env.API_PUBLIC_URL}/api/internal/scrape-result`,
      ...(apifyToken ? { apify_token: apifyToken } : {}),
    });
    return jobId;
  } catch (error) {
    console.error("Failed to trigger GitHub Actions scrape:", error);
    await pool.query(
      "UPDATE items SET status = 'price_not_found', scrape_job_id = NULL WHERE id = $1 AND scrape_job_id = $2",
      [itemId, jobId]
    );
    return null;
  }
}

export async function triggerBatchScrape(bomId, filter) {
  const jobId = crypto.randomUUID();
  let urlCondition = "";
  if (filter === "amazon") urlCondition = "AND items.url ILIKE '%amazon.%'";
  else if (filter === "mouser") urlCondition = "AND items.url ILIKE '%mouser.%'";
  else if (filter === "other") urlCondition = "AND items.url NOT ILIKE '%amazon.%' AND items.url NOT ILIKE '%mouser.%'";

  const pendingResult = await pool.query(
    `UPDATE items SET status = 'pending', stale_price = false, scrape_job_id = $2
     FROM sections WHERE items.section_id = sections.id AND sections.bom_id = $1
       AND sections.deleted_at IS NULL AND items.deleted_at IS NULL
       AND items.url IS NOT NULL AND items.url != '' ${urlCondition}
     RETURNING items.id`,
    [bomId, jobId]
  );

  try {
    const ownerResult = await pool.query("SELECT user_id FROM boms WHERE id = $1", [bomId]);
    const apifyToken = await getOwnerApifyToken(ownerResult.rows[0]?.user_id);
    await githubDispatch("bom-batch-scrape-request", {
      bom_id: bomId,
      filter,
      job_id: jobId,
      ...(apifyToken ? { apify_token: apifyToken } : {}),
    });
    return { triggered: pendingResult.rows.length, jobId };
  } catch (error) {
    console.error("Failed to trigger GitHub Actions batch scrape:", error);
    await pool.query(
      "UPDATE items SET status = 'price_not_found', scrape_job_id = NULL WHERE scrape_job_id = $1",
      [jobId]
    );
    return null;
  }
}
