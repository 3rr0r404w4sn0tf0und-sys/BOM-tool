-- Stop storing public_api_key as plaintext (a DB read/leak would
-- otherwise immediately hand over every public BOM API credential).
--
-- Two new columns instead of one:
--   public_api_key_hash      -- sha256(raw key), used for O(1) auth
--                                lookup (WHERE public_api_key_hash = $1).
--                                Not reversible, so a DB dump alone
--                                can't be used to authenticate.
--   public_api_key_encrypted -- AES-256-GCM (SECRET_ENCRYPTION_KEY),
--                                so the app can still decrypt and show
--                                the existing key in the API modal
--                                without regenerating it. A DB dump
--                                without SECRET_ENCRYPTION_KEY (which
--                                lives only in the app's environment,
--                                not the database) can't recover it.
--
-- Existing plaintext public_api_key values are intentionally NOT
-- migrated automatically here -- see SECURITY_CHANGES.md / the
-- accompanying one-off backfill script. The old column is kept until
-- that backfill has run in production, then should be dropped in a
-- follow-up migration.

ALTER TABLE boms
  ADD COLUMN public_api_key_hash TEXT,
  ADD COLUMN public_api_key_encrypted TEXT;

CREATE UNIQUE INDEX idx_boms_api_key_hash ON boms(public_api_key_hash) WHERE public_api_key_hash IS NOT NULL;
