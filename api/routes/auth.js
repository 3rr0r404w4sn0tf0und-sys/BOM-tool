import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { sendVerificationEmail } from "../lib/mailer.js";

export const authRouter = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Set this to your Vercel frontend URL (not the Render API URL) so
// verification links point somewhere a user can actually click through.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

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

authRouter.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }
  const trimmedEmail = email.toLowerCase().trim();
  if (!EMAIL_RE.test(trimmedEmail)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified",
      [trimmedEmail, hash]
    );
    const user = result.rows[0];

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    // Don't block registration on email sending -- log in immediately,
    // fire the verification email in the background.
    const emailResult = await issueVerificationEmail(user.id, user.email);
    if (!emailResult.sent) {
      console.warn(`Verification email not sent for ${user.email}: ${emailResult.error}`);
    }

    res.json({ token, user, verificationEmailSent: emailResult.sent });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error(e);
    res.status(500).json({ error: "Registration failed" });
  }
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [
    email.toLowerCase().trim(),
  ]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
  res.json({
    token,
    user: { id: user.id, email: user.email, email_verified: user.email_verified },
  });
});

// Public: called by the frontend after the user clicks the link in their
// verification email (frontend reads ?verify_token= from the URL and
// POSTs it here).
authRouter.post("/verify", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "token required" });
  }
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
});

// Auth'd: lets a logged-in-but-unverified user request a fresh link
// (e.g. their first one expired, or the email never arrived).
authRouter.post("/resend-verification", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const result = await pool.query(
    "SELECT id, email, email_verified FROM users WHERE id = $1",
    [payload.userId]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.email_verified) return res.json({ alreadyVerified: true });

  const emailResult = await issueVerificationEmail(user.id, user.email);
  res.json({ sent: emailResult.sent, error: emailResult.error });
});
