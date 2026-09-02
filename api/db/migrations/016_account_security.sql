-- Account security: pending email changes.
-- New email addresses are not applied until the verification link is used.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_change_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_change_token_expires TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pending_email
  ON users (pending_email)
  WHERE pending_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_change_token
  ON users (email_change_token)
  WHERE email_change_token IS NOT NULL;
