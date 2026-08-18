-- Migration: GitHub OAuth support.
-- Run this against your Neon database (SQL Editor, paste + run).
--
-- Root cause of "GitHub register/login failed": auth.js's
-- findOrCreateOAuthUser() inserts into users(email, oauth_provider,
-- oauth_id, email_verified) -- but neither column existed yet, and
-- password_hash was NOT NULL with no value supplied for an OAuth-only
-- signup. Both problems fixed below.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT; -- e.g. 'github'
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id TEXT;       -- provider's user id, as a string

-- Lets one (provider, oauth_id) pair only ever map to one user, and lets
-- findOrCreateOAuthUser's lookup use an index instead of a full scan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL;
