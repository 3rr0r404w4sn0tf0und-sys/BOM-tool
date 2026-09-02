import { pool } from "../db/pool.js";

// Role ranking used for "at least" checks (requireBomRole('editor') also
// admits owners).
const RANK = { viewer: 1, editor: 2, owner: 3 };

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function roleAtLeast(role, min) {
  return !!role && (RANK[role] || 0) >= (RANK[min] || 0);
}

// Resolves the caller's effective role on a BOM, checking (in order):
// ownership, an explicit share tied to their user id, an explicit share
// invited by email that hasn't been claimed yet (and opportunistically
// links it to their account + records acceptance), then the BOM's public
// link setting. Returns null if the caller has no access at all.
//
// This never trusts a "bom exists" signal from the caller -- the row
// itself is only ever fetched scoped to a role check, so a bad guess at
// someone else's BOM id can't be used to enumerate titles/contents.
export async function getBomRole(bomId, userId) {
  const bomResult = await pool.query(
    "SELECT user_id, public_access FROM boms WHERE id = $1",
    [bomId]
  );
  const bom = bomResult.rows[0];
  if (!bom) return null;

  if (bom.user_id === userId) return "owner";

  // Matching by email is resolved server-side against the caller's own
  // account row -- the client never gets to assert its own email.
  const shareResult = await pool.query(
    `SELECT bom_shares.id, bom_shares.role, bom_shares.user_id, bom_shares.accepted_at
     FROM bom_shares
     WHERE bom_shares.bom_id = $1
       AND (bom_shares.user_id = $2
            OR bom_shares.email = (SELECT lower(email) FROM users WHERE id = $2))`,
    [bomId, userId]
  );
  const share = shareResult.rows[0];
  if (share) {
    // First time this invite is actually used: claim it for this account
    // so future lookups are by user_id (works even if they change email)
    // and so the owner can see it's been accepted.
    if (!share.user_id || !share.accepted_at) {
      await pool.query(
        `UPDATE bom_shares SET user_id = COALESCE(user_id, $1), accepted_at = COALESCE(accepted_at, now())
         WHERE id = $2`,
        [userId, share.id]
      );
    }
    return share.role;
  }

  if (bom.public_access === "edit") return "editor";
  if (bom.public_access === "view") return "viewer";
  return null;
}

// Express middleware factory for routes shaped /:paramName (a direct BOM
// id in the URL). Sets req.bomRole and req.bomId on success.
export function requireBomRole(minRole, paramName = "id") {
  return async function (req, res, next) {
    try {
      const bomId = req.params[paramName];
      const role = await getBomRole(bomId, req.userId);
      if (!role) return res.status(404).json({ error: "BOM not found" });
      if (!roleAtLeast(role, minRole)) {
        return res.status(403).json({ error: "You don't have permission to do that" });
      }
      req.bomRole = role;
      req.bomId = bomId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Same idea, but for routes that only have a section id or item id in the
// URL and need to resolve up to the owning BOM first.
export async function resolveSectionBomId(sectionId) {
  const result = await pool.query("SELECT bom_id FROM sections WHERE id = $1", [sectionId]);
  return result.rows[0]?.bom_id || null;
}

export async function resolveItemBomId(itemId) {
  const result = await pool.query(
    `SELECT sections.bom_id FROM items JOIN sections ON sections.id = items.section_id WHERE items.id = $1`,
    [itemId]
  );
  return result.rows[0]?.bom_id || null;
}

export function requireSectionRole(minRole, paramName = "sectionId") {
  return async function (req, res, next) {
    try {
      const bomId = await resolveSectionBomId(req.params[paramName]);
      if (!bomId) return res.status(404).json({ error: "Section not found" });
      const role = await getBomRole(bomId, req.userId);
      if (!role) return res.status(404).json({ error: "Section not found" });
      if (!roleAtLeast(role, minRole)) {
        return res.status(403).json({ error: "You don't have permission to do that" });
      }
      req.bomRole = role;
      req.bomId = bomId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireItemRole(minRole, paramName = "itemId") {
  return async function (req, res, next) {
    try {
      const bomId = await resolveItemBomId(req.params[paramName]);
      if (!bomId) return res.status(404).json({ error: "Item not found" });
      const role = await getBomRole(bomId, req.userId);
      if (!role) return res.status(404).json({ error: "Item not found" });
      if (!roleAtLeast(role, minRole)) {
        return res.status(403).json({ error: "You don't have permission to do that" });
      }
      req.bomRole = role;
      req.bomId = bomId;
      next();
    } catch (err) {
      next(err);
    }
  };
}
