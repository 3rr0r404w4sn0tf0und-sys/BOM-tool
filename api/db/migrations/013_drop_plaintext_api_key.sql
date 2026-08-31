-- Run this ONLY after applying migration 012_hashed_api_keys.sql and
-- successfully running api/scripts/backfill-api-keys.js to migrate
-- every existing plaintext key into the new hashed/encrypted columns.
-- Confirm API key auth (public.js) and the API modal (frontend) both
-- still work before running this -- it is NOT reversible.

ALTER TABLE boms DROP COLUMN IF EXISTS public_api_key;
