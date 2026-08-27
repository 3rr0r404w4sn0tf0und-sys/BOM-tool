import crypto from "node:crypto";

// Encrypts small user-supplied credentials (e.g. a user's own Apify API
// token) before they touch the database. Separate from JWT_SECRET/
// INTERNAL_SCRAPE_SECRET on purpose -- those authenticate our own tokens
// and are fine to rotate freely; this key decrypts data at rest, so
// rotating it silently breaks every previously-saved token.
//
// SECRET_ENCRYPTION_KEY must be 32 raw bytes, base64-encoded (openssl rand
// -base64 32). Stored ciphertext is "<iv>:<authTag>:<ciphertext>", each
// base64, so it's one TEXT column with no extra columns to keep in sync.

const ALGO = "aes-256-gcm";

function loadKey() {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) throw new Error("SECRET_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)");
  }
  return key;
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || !plaintext) return null;
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(stored) {
  if (!stored) return null;
  const key = loadKey();
  const parts = stored.split(":");
  if (parts.length !== 3) return null;
  const [ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // Wrong key, corrupted row, or tampered ciphertext -- treat as absent
    // rather than crashing the scrape that was about to use it.
    return null;
  }
}
