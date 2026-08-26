import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../db/pool.js";

const IS_PROD = process.env.NODE_ENV === "production";
const COOKIE_NAME = IS_PROD ? "__Host-bom-session" : "bom-session";
const COOKIE_SECURE = IS_PROD;
// Vercel frontend + Render API are different sites, so production must use
// SameSite=None. The readable CSRF cookie + Origin check below protects
// state-changing requests from cross-site forgery.
const COOKIE_SAMESITE = IS_PROD ? "none" : "lax";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function makeCsrfToken(sessionId) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`csrf:${sessionId}`).digest("hex");
}

export function getCsrfTokenForSession(sessionId) {
  if (!sessionId) return null;
  return makeCsrfToken(sessionId);
}

export async function createSession(userId) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [sessionId, userId, expiresAt]
  );
  return sessionId;
}

export async function revokeSession(sessionId) {
  if (!sessionId) return;
  await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId]
  );
}

export function issueSessionToken(userId, sessionId) {
  return jwt.sign({ userId, sid: sessionId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    path: "/",
  });
}

export function getAuthToken(req) {
  return req.cookies?.[COOKIE_NAME] || null;
}

export async function getSessionFromRequest(req) {
  const token = getAuthToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload?.userId || !payload?.sid) return null;
    const result = await pool.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM sessions
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.sid, payload.userId]
    );
    if (!result.rows[0]) return null;
    return { payload, session: result.rows[0] };
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  getSessionFromRequest(req)
    .then((auth) => {
      if (!auth) return res.status(401).json({ error: "Missing or invalid session" });
      req.userId = auth.payload.userId;
      req.sessionId = auth.payload.sid;
      next();
    })
    .catch((err) => {
      console.error("Session lookup failed:", err);
      res.status(500).json({ error: "Authentication service unavailable" });
    });
}

// Browsers send Origin on normal fetch/XHR requests. Allowing requests with
// no Origin keeps curl/server-to-server API clients working while rejecting
// cross-site browser form/fetch attempts before they reach a mutating route.
export function requireAllowedOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("Origin");
  if (!origin) return next();
  const allowed = (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",").map((v) => v.trim()).filter(Boolean);
  if (allowed.includes(origin)) return next();
  return res.status(403).json({ error: "Origin not allowed" });
}
