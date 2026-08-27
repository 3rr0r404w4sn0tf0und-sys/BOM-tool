-- Lets a user bring their own Apify API token instead of scraping through
-- the shared/hosted APIFY_TOKEN GitHub Actions secret. Stored encrypted
-- (AES-256-GCM, see api/lib/secretCrypto.js) since it's a live credential
-- for the user's own Apify account, not a value we ever need to display
-- back in plaintext after it's saved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS apify_token_encrypted TEXT;
