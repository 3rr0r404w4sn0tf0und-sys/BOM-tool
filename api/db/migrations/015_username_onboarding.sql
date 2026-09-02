CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Username + account onboarding. Existing users are allowed to finish later.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username)) WHERE username IS NOT NULL;

-- Verification tokens are now stored as SHA-256 hashes. Existing pending
-- tokens are hashed in-place so already-sent links keep working.
UPDATE users
SET verification_token = encode(digest(verification_token, 'sha256'), 'hex')
WHERE verification_token IS NOT NULL;
