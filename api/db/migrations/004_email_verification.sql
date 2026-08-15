-- Migration: email verification support.
-- Run this against your existing Neon database (SQL Editor, paste + run).
-- Also folded into api/db/schema.sql for fresh installs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMPTZ;
