import { pool } from "../db/pool.js";

export function auditMutations(req, res, next) {
  res.on("finish", () => {
    if (!req.userId || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    // Do not block or change the response if audit logging fails.
    pool.query(
      `INSERT INTO audit_logs (user_id, method, path, status_code, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.userId,
        req.method,
        req.originalUrl.split("?")[0],
        res.statusCode,
        req.ip || null,
        req.get("user-agent") || null,
      ]
    ).catch((err) => console.error("Audit log write failed:", err));
  });
  next();
}
