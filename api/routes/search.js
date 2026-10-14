import express from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";

// Cross-document search backing the /search page.
//
// Two distinct searches, picked with ?type=bom|sheet:
//   bom   -> line items of BOM docs (name, product URL, section title, BOM title)
//   sheet -> rows of Sheet docs (any cell, section title, sheet title)
//
// Scope: every doc the caller owns PLUS docs shared with them (by user id, or
// by email for invites sent before they had an account) -- the same access
// set as GET /api/boms. Public-link access is deliberately NOT included; a
// link you merely opened isn't "yours" to browse.
//
// An empty ?q= is "browse": returns everything in scope, paginated.
// Read-only, no schema changes (no migration needed).

export const searchRouter = express.Router();
searchRouter.use(requireAuth);

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." },
});
searchRouter.use(searchLimiter);

const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

// Escape LIKE wildcards so "50%" or "a_b" are searched literally.
function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

searchRouter.get("/", asyncHandler(async (req, res) => {
  const type = req.query.type === "sheet" ? "sheet" : req.query.type === "bom" ? "bom" : null;
  if (!type) return res.status(400).json({ error: "type must be 'bom' or 'sheet'" });

  const q = String(req.query.q ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const pattern = q ? likePattern(q) : null;

  const result = await pool.query(
    `WITH accessible AS (
       SELECT boms.id, boms.title, boms.column_labels, boms.column_count, boms.updated_at, 'owner' AS role
         FROM boms
         WHERE boms.user_id = $1 AND boms.doc_type = $2
       UNION
       SELECT boms.id, boms.title, boms.column_labels, boms.column_count, boms.updated_at, bom_shares.role
         FROM boms
         JOIN bom_shares ON bom_shares.bom_id = boms.id
         WHERE boms.user_id <> $1
           AND boms.doc_type = $2
           AND (bom_shares.user_id = $1
                OR bom_shares.email = (SELECT lower(email) FROM users WHERE id = $1))
     )
     SELECT
       items.id, items.name, items.url, items.qty, items.unit_price, items.status,
       items.stale_price, items.sheet_data, items.checked,
       sections.title AS section_title, sections.emoji AS section_emoji,
       a.id AS bom_id, a.title AS bom_title, a.role,
       a.column_labels, a.column_count,
       COUNT(*) OVER()::int AS total
     FROM accessible a
     JOIN sections ON sections.bom_id = a.id AND sections.deleted_at IS NULL
     JOIN items ON items.section_id = sections.id AND items.deleted_at IS NULL
     WHERE $3::text IS NULL
        OR items.name ILIKE $3
        OR items.url ILIKE $3
        OR sections.title ILIKE $3
        OR a.title ILIKE $3
        OR CASE
             WHEN jsonb_typeof(items.sheet_data) = 'array'
             THEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(items.sheet_data) AS cell(v) WHERE cell.v ILIKE $3)
             ELSE false
           END
     ORDER BY a.updated_at DESC, a.id, sections.sort_order, items.sort_order
     LIMIT $4 OFFSET $5`,
    [req.userId, type, pattern, limit, offset]
  );

  const total = result.rows[0]?.total ?? 0;
  const results = result.rows.map(({ total: _t, ...row }) => row);
  res.json({
    type,
    q,
    results,
    total,
    has_more: offset + results.length < total,
    offset,
    limit,
  });
}));
