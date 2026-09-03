import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
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
const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
const ONBOARDING_TOKEN_MAX_AGE = "15m";
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

function validatePassword(password) {
  if (typeof password !== "string") return "Password is required";
  if (password.length < PASSWORD_MIN_LENGTH) return "Password must be at least 8 characters";
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return "Password must be 72 bytes or fewer (UTF-8)";
  const uppercase = (password.match(/[A-Z]/g) || []).length;
  const lowercase = (password.match(/[a-z]/g) || []).length;
  const numbers = (password.match(/[0-9]/g) || []).length;
  const symbols = (password.match(/[^A-Za-z0-9\s]/g) || []).length;
  if (uppercase < 2) return "Password must contain at least 2 uppercase letters";
  if (lowercase < 2) return "Password must contain at least 2 lowercase letters";
  if (numbers < 2) return "Password must contain at least 2 numbers";
  if (symbols < 2) return "Password must contain at least 2 symbols";
  return null;
}

function makeEmailChangeToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return { token, tokenHash, expires };
}

async function sendEmailChangeVerification(userId, newEmail) {
  const { token, tokenHash, expires } = makeEmailChangeToken();
  await pool.query(
    "UPDATE users SET pending_email = $1, email_change_token = $2, email_change_token_expires = $3 WHERE id = $4",
    [newEmail, tokenHash, expires, userId]
  );
  const verifyUrl = `${FRONTEND_URL}/settings/account?email_change_token=${encodeURIComponent(token)}`;
  return sendVerificationEmail(newEmail, verifyUrl);
}

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
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  return { token, tokenHash, expires };
}

function normalizeUsername(username) {
  return typeof username === "string" ? username.trim() : "";
}

function validateUsername(username) {
  const value = normalizeUsername(username);
  if (!USERNAME_RE.test(value)) {
    return "Username must be 3–24 characters and use only letters, numbers, and underscores";
  }
  return null;
}

function issueOnboardingToken(userId) {
  return jwt.sign({ purpose: "onboarding", userId }, process.env.JWT_SECRET, { expiresIn: ONBOARDING_TOKEN_MAX_AGE });
}

function verifyOnboardingToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== "onboarding" || !payload.userId) return null;
    return payload;
  } catch {
    return null;
  }
}

async function issueVerificationEmail(userId, email) {
  const { token, tokenHash, expires } = makeVerificationToken();
  await pool.query(
    "UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE id = $3",
    [tokenHash, expires, userId]
  );
  const verifyUrl = `${FRONTEND_URL}/finish?verify_token=${token}`;
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
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified",
      [trimmedEmail, hash]
    );
    const user = result.rows[0];

    const emailResult = await issueVerificationEmail(user.id, user.email);
    if (!emailResult.sent) {
      console.warn(`Verification email not sent for ${user.email}: ${emailResult.error}`);
    }

    // Do not create a session until the email is verified and onboarding is complete.
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
  if (!user.email_verified) {
    return res.status(403).json({ error: "Please verify your email before logging in", code: "EMAIL_NOT_VERIFIED" });
  }
  const sessionId = await createSession(user.id);
  const token = issueSessionToken(user.id, sessionId);
  setAuthCookie(res, token);
  res.json({
    user: { id: user.id, email: user.email, email_verified: user.email_verified, username: user.username },
  });
}));

authRouter.post("/verify", asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") return res.status(400).json({ error: "token required" });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const result = await pool.query(
    "SELECT id, email_verified, verification_token_expires FROM users WHERE verification_token = $1",
    [tokenHash]
  );
  const user = result.rows[0];
  if (!user) return res.status(400).json({ error: "Invalid or already-used verification link" });
  if (!user.verification_token_expires || new Date(user.verification_token_expires) < new Date()) {
    return res.status(400).json({ error: "Verification link expired. Request a new one." });
  }

  await pool.query(
    "UPDATE users SET email_verified = true, verification_token = NULL, verification_token_expires = NULL WHERE id = $1",
    [user.id]
  );

  // This is deliberately an onboarding-only token, not a normal authenticated session.
  // It expires quickly and can only be used to finish the account profile.
  res.json({ verified: true, onboardingToken: issueOnboardingToken(user.id) });
}));
authRouter.post("/resend-verification-public", verificationResendLimiter, asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
  if (!EMAIL_RE.test(email)) return res.json({ sent: true }); // don't reveal account existence
  const result = await pool.query(
    "SELECT id, email, email_verified FROM users WHERE email = $1",
    [email]
  );
  const user = result.rows[0];
  if (!user || user.email_verified) return res.json({ sent: true });
  const emailResult = await issueVerificationEmail(user.id, user.email);
  // Deliberately keep the response generic so this endpoint cannot be used
  // as an email-account enumeration oracle.
  res.json({ sent: !!emailResult.sent });
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
    "SELECT id, email, username, email_verified, (apify_token_encrypted IS NOT NULL) AS has_apify_token, (password_hash IS NOT NULL) AS has_password FROM users WHERE id = $1",
    [auth.payload.userId]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user, csrfToken: getCsrfTokenForSession(auth.payload.sid) });
}));

// ---------- Username / onboarding ----------

authRouter.get("/username/check", asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.query.username);
  const validationError = validateUsername(username);
  if (validationError) return res.json({ valid: false, available: false, error: validationError });
  const result = await pool.query(
    "SELECT 1 FROM users WHERE lower(username) = lower($1) LIMIT 1",
    [username]
  );
  res.json({ valid: true, available: result.rowCount === 0 });
}));

authRouter.post("/complete-profile", asyncHandler(async (req, res) => {
  const { onboardingToken, username } = req.body || {};
  const payload = verifyOnboardingToken(onboardingToken);
  if (!payload) return res.status(401).json({ error: "Onboarding session expired. Please verify your email again." });
  const validationError = validateUsername(username);
  if (validationError) return res.status(400).json({ error: validationError });
  const normalized = normalizeUsername(username);

  try {
    const result = await pool.query(
      `UPDATE users SET username = $1
       WHERE id = $2 AND email_verified = true AND username IS NULL
       RETURNING id, email, username, email_verified, (apify_token_encrypted IS NOT NULL) AS has_apify_token, (password_hash IS NOT NULL) AS has_password`,
      [normalized, payload.userId]
    );
    if (!result.rows[0]) return res.status(409).json({ error: "Account setup has already been completed" });
    const sessionId = await createSession(payload.userId);
    const sessionToken = issueSessionToken(payload.userId, sessionId);
    setAuthCookie(res, sessionToken);
    res.json({ user: result.rows[0], csrfToken: getCsrfTokenForSession(sessionId) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username is already taken", code: "USERNAME_TAKEN" });
    throw e;
  }
}));
authRouter.get("/account", asyncHandler(async (req, res) => {
  const auth = await getSessionFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Missing or invalid session" });
  const result = await pool.query(
    "SELECT id, email, username, email_verified, (apify_token_encrypted IS NOT NULL) AS has_apify_token, (password_hash IS NOT NULL) AS has_password FROM users WHERE id = $1",
    [auth.payload.userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
  res.json({ user: result.rows[0] });
}));

authRouter.patch("/username", requireCsrf, asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const validationError = validateUsername(username);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const result = await pool.query(
      `UPDATE users SET username = $1 WHERE id = $2
       RETURNING id, email, username, email_verified, (apify_token_encrypted IS NOT NULL) AS has_apify_token, (password_hash IS NOT NULL) AS has_password`,
      [username, req.userId]
    );
    res.json({ user: result.rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username is already taken", code: "USERNAME_TAKEN" });
    throw e;
  }
}));

// ---------- Account security ----------

authRouter.patch("/email", requireCsrf, asyncHandler(async (req, res) => {
  const newEmail = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: "Enter a valid email address" });

  const current = await pool.query(
    "SELECT email, password_hash, email_verified FROM users WHERE id = $1",
    [req.userId]
  );
  const user = current.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  if (newEmail === user.email.toLowerCase()) return res.status(400).json({ error: "That is already your email address" });

  if (user.password_hash) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  } else {
    return res.status(400).json({ error: "Set a password before changing the email address" });
  }

  const existing = await pool.query(
    "SELECT id FROM users WHERE (email = $1 OR pending_email = $1) AND id <> $2 LIMIT 1",
    [newEmail, req.userId]
  );
  if (existing.rows[0]) return res.status(409).json({ error: "That email address is already registered" });

  const emailResult = await sendEmailChangeVerification(req.userId, newEmail);
  if (!emailResult.sent) {
    await pool.query(
      "UPDATE users SET pending_email = NULL, email_change_token = NULL, email_change_token_expires = NULL WHERE id = $1",
      [req.userId]
    );
    return res.status(503).json({ error: "Could not send the verification email. Please try again later." });
  }
  res.json({ pending: true, email: user.email, pendingEmail: newEmail });
}));

authRouter.post("/email/verify-change", asyncHandler(async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) return res.status(400).json({ error: "token required" });
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, pending_email, email_change_token_expires
       FROM users
       WHERE email_change_token = $1
       FOR UPDATE`,
      [tokenHash]
    );
    const user = result.rows[0];
    if (!user || !user.pending_email) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid or already-used email change link" });
    }
    if (!user.email_change_token_expires || new Date(user.email_change_token_expires) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Email change link expired. Request another one." });
    }

    try {
      await client.query(
        `UPDATE users
         SET email = pending_email,
             pending_email = NULL,
             email_change_token = NULL,
             email_change_token_expires = NULL,
             email_verified = true
         WHERE id = $1`,
        [user.id]
      );
    } catch (e) {
      if (e.code === "23505") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "That email address is already registered" });
      }
      throw e;
    }
    await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
    await client.query("COMMIT");
    clearAuthCookie(res);
    res.json({ emailChanged: true });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}));

authRouter.post("/password", requireCsrf, asyncHandler(async (req, res) => {
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.password_hash) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return res.status(400).json({ error: "New password must be different from your current password" });
    }
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.userId]);
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.userId]);
  clearAuthCookie(res);
  res.json({ passwordChanged: true, loggedOut: true });
}));

authRouter.delete("/account", requireCsrf, asyncHandler(async (req, res) => {
  const confirmation = typeof req.body?.confirmation === "string" ? req.body.confirmation : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  if (confirmation !== "DELETE") return res.status(400).json({ error: 'Type "DELETE" to confirm account deletion' });

  const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.password_hash) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }

  await pool.query("DELETE FROM users WHERE id = $1", [req.userId]);
  clearAuthCookie(res);
  res.json({ deleted: true });
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
  const result = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
  const needsFinish = !result.rows[0]?.username;
  const sessionId = await createSession(userId);
  const token = issueSessionToken(userId, sessionId);
  setAuthCookie(res, token);
  res.redirect(`${FRONTEND_URL}${needsFinish ? "/finish" : "/dashboard"}`);
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
