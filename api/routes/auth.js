import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { setAuthCookie, clearAuthCookie, requireCsrf, getAuthToken, createSession, revokeSession, issueSessionToken, getSessionFromRequest, getCsrfTokenForSession } from "../middleware/auth.js";
import { encryptSecret } from "../lib/secretCrypto.js";

export const authRouter = express.Router();
const verificationResendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many verification emails. Try again later." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Vercel frontend URL -- verification links and OAuth redirects both land
// back here (not the Render API URL).
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
// Render API's own public URL -- OAuth providers redirect back to this
// server (not the frontend) so we can exchange the code server-side.
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || "http://localhost:4000";

const OAUTH_STATE_COOKIE = "bom-oauth-state";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function setOAuthState(res, state) {
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/auth/github",
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  });
}

function clearOAuthState(res) {
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/auth/github",
  });
}

function makeVerificationToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  return { token, expires };
}

async function issueVerificationEmail(userId, email) {
  const { token, expires } = makeVerificationToken();
  await pool.query(
    "UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE id = $3",
    [token, expires, userId]
  );
  const verifyUrl = `${FRONTEND_URL}/?verify_token=${token}`;
  return sendVerificationEmail(email, verifyUrl);
}

// ---------- Email + password ----------

authRouter.post("/register", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }
  const trimmedEmail = email.toLowerCase().trim();
  if (!EMAIL_RE.test(trimmedEmail)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: "Password must be at least 12 characters" });
  }
  // bcrypt only uses the first 72 bytes of the input -- anything beyond
  // that is silently ignored, which would let two different long
  // passwords that share the same first 72 bytes hash identically.
  // Reject upfront instead of truncating silently.
  if (Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "Password must be 72 bytes or fewer (UTF-8)" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified",
      [trimmedEmail, hash]
    );
    const user = result.rows[0];
    const sessionId = await createSession(user.id);
    const token = issueSessionToken(user.id, sessionId);

    const emailResult = await issueVerificationEmail(user.id, user.email);
    if (!emailResult.sent) {
      console.warn(`Verification email not sent for ${user.email}: ${emailResult.error}`);
    }

    setAuthCookie(res, token);
    res.json({ user, verificationEmailSent: emailResult.sent });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error(e);
    res.status(500).json({ error: "Registration failed" });
  }
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [
    email.toLowerCase().trim(),
  ]);
  const user = result.rows[0];
  if (!user || !user.password_hash) {
    // No password_hash means this account was created via OAuth only.
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const sessionId = await createSession(user.id);
  const token = issueSessionToken(user.id, sessionId);
  setAuthCookie(res, token);
  res.json({
    user: { id: user.id, email: user.email, email_verified: user.email_verified },
  });
}));

authRouter.post("/verify", asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token required" });

  const result = await pool.query(
    "SELECT id, verification_token_expires FROM users WHERE verification_token = $1",
    [token]
  );
  const user = result.rows[0];
  if (!user) {
    return res.status(400).json({ error: "Invalid or already-used verification link" });
  }
  if (new Date(user.verification_token_expires) < new Date()) {
    return res.status(400).json({ error: "Verification link expired. Request a new one." });
  }
  await pool.query(
    "UPDATE users SET email_verified = true, verification_token = NULL, verification_token_expires = NULL WHERE id = $1",
    [user.id]
  );
  res.json({ verified: true });
}));

authRouter.post("/resend-verification", verificationResendLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const auth = await getSessionFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Invalid or expired session" });

  const result = await pool.query(
    "SELECT id, email, email_verified FROM users WHERE id = $1",
    [auth.payload.userId]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.email_verified) return res.json({ alreadyVerified: true });

  const emailResult = await issueVerificationEmail(user.id, user.email);
  res.json({ sent: emailResult.sent, error: emailResult.error });
}));

// Used by the frontend after an OAuth redirect to fetch the logged-in user
// from the HttpOnly session cookie set by the callback.
authRouter.get("/me", asyncHandler(async (req, res) => {
  const auth = await getSessionFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Invalid or expired session" });
  const result = await pool.query(
    "SELECT id, email, email_verified, (apify_token_encrypted IS NOT NULL) AS has_apify_token FROM users WHERE id = $1",
    [auth.payload.userId]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user, csrfToken: getCsrfTokenForSession(auth.payload.sid) });
}));

// A user's own Apify token, so BOM scrapes run against their Apify account
// (and their usage/billing). There is no shared/site-wide Apify token --
// without one set here, Apify-tier scrapes (Mouser, Arrow, Amazon) just
// fall back to the plain HTTP fetch path and may come back price_not_found.
// Never returned in plaintext once saved -- GET only reports whether one is
// set, matching how public_api_key etc. are handled elsewhere.
authRouter.put("/apify-key", requireCsrf, asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ error: "token is required" });
  }
  const trimmed = token.trim();
  if (trimmed.length > 500) return res.status(400).json({ error: "token is too long" });
  let encrypted;
  try {
    encrypted = encryptSecret(trimmed);
  } catch (e) {
    console.error("Failed to encrypt Apify token:", e);
    return res.status(500).json({ error: "Server is not configured to store this securely" });
  }
  await pool.query("UPDATE users SET apify_token_encrypted = $1 WHERE id = $2", [encrypted, req.userId]);
  res.json({ hasApifyToken: true });
}));

authRouter.delete("/apify-key", requireCsrf, asyncHandler(async (req, res) => {
  await pool.query("UPDATE users SET apify_token_encrypted = NULL WHERE id = $1", [req.userId]);
  res.json({ hasApifyToken: false });
}));

authRouter.get("/csrf", asyncHandler(async (req, res) => {
  const auth = await getSessionFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Missing or invalid session" });
  res.json({ csrfToken: getCsrfTokenForSession(auth.payload.sid) });
}));

authRouter.post("/logout", requireCsrf, asyncHandler(async (req, res) => {
  const auth = await getSessionFromRequest(req);
  if (auth) await revokeSession(auth.payload.sid);
  clearAuthCookie(res);
  res.status(204).send();
}));

authRouter.post("/logout-all", requireCsrf, asyncHandler(async (req, res) => {
  const auth = await getSessionFromRequest(req);
  if (auth) {
    await pool.query(
      "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [auth.payload.userId]
    );
  }
  clearAuthCookie(res);
  res.status(204).send();
}));

// ---------- Shared OAuth helper ----------
// Finds an existing user by (provider, providerId). If none, links to an
// existing password account with the same email if one exists (so someone
// who registered with email+password can also just click "Continue with
// Google" later using the same address). Otherwise creates a brand new
// OAuth-only user. OAuth emails are trusted as pre-verified.
async function findOrCreateOAuthUser({ provider, providerId, email }) {
  const trimmedEmail = email.toLowerCase().trim();

  const existingOAuth = await pool.query(
    "SELECT * FROM users WHERE oauth_provider = $1 AND oauth_id = $2",
    [provider, providerId]
  );
  if (existingOAuth.rows[0]) return existingOAuth.rows[0];

  const existingByEmail = await pool.query("SELECT * FROM users WHERE email = $1", [trimmedEmail]);
  if (existingByEmail.rows[0]) {
    const linked = await pool.query(
      `UPDATE users SET oauth_provider = $1, oauth_id = $2, email_verified = true
       WHERE id = $3 RETURNING *`,
      [provider, providerId, existingByEmail.rows[0].id]
    );
    return linked.rows[0];
  }

  const created = await pool.query(
    `INSERT INTO users (email, oauth_provider, oauth_id, email_verified)
     VALUES ($1, $2, $3, true) RETURNING *`,
    [trimmedEmail, provider, providerId]
  );
  return created.rows[0];
}

// OAuth callback stores the session in an HttpOnly cookie, then redirects
// to the frontend without exposing the session token in the URL.
async function redirectWithToken(res, userId) {
  const sessionId = await createSession(userId);
  const token = issueSessionToken(userId, sessionId);
  setAuthCookie(res, token);
  res.redirect(FRONTEND_URL);
}

function redirectWithError(res, message) {
  res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(message)}`);
}

// ---------- GitHub OAuth ----------

authRouter.get("/github/start", (req, res) => {
  if (!process.env.GITHUB_OAUTH_CLIENT_ID) {
    return redirectWithError(res, "GitHub login isn't configured yet");
  }
  const state = crypto.randomBytes(32).toString("hex");
  setOAuthState(res, state);
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: `${API_PUBLIC_URL}/api/auth/github/callback`,
    scope: "read:user user:email",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRouter.get("/github/callback", asyncHandler(async (req, res) => {
  const { code, error, state } = req.query;
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
  if (error || !code) { clearOAuthState(res); return redirectWithError(res, "GitHub login was cancelled or failed"); }
  if (!state || !expectedState) { clearOAuthState(res); return redirectWithError(res, "GitHub login session expired. Please try again."); }
  const stateBuf = Buffer.from(String(state));
  const expectedBuf = Buffer.from(String(expectedState));
  if (stateBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(stateBuf, expectedBuf)) {
    clearOAuthState(res);
    return redirectWithError(res, "Invalid GitHub login state. Please try again.");
  }
  clearOAuthState(res);

  try {
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        code,
        client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        redirect_uri: `${API_PUBLIC_URL}/api/auth/github/callback`,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      console.error("GitHub token exchange failed:", tokenData);
      return redirectWithError(res, "GitHub login failed");
    }

    const userResp = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "bom-tool" },
    });
    const githubUser = await userResp.json();
    if (!githubUser.id) return redirectWithError(res, "Could not read GitHub account info");

    // GitHub's /user endpoint often omits email if it's private -- fetch
    // the verified email list separately and take the primary one.
    let email = githubUser.email;
    if (!email) {
      const emailResp = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "bom-tool" },
      });
      const emails = await emailResp.json();
      const primary = Array.isArray(emails)
        ? emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified)
        : null;
      email = primary?.email;
    }
    if (!email) return redirectWithError(res, "GitHub account has no accessible verified email");

    const user = await findOrCreateOAuthUser({
      provider: "github",
      providerId: String(githubUser.id),
      email,
    });
    await redirectWithToken(res, user.id);
  } catch (e) {
    console.error("GitHub OAuth error:", e);
    redirectWithError(res, "GitHub login failed");
  }
}));
