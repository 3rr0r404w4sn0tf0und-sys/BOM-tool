// One-off backfill: migrates existing plaintext boms.public_api_key
// values into the new hashed + encrypted columns added by
// migrations/012_hashed_api_keys.sql.
//
// Run this ONCE, after applying migration 012 and before migration 013
// (which drops the old public_api_key column). Needs the same
// SECRET_ENCRYPTION_KEY and DATABASE_URL the API server uses.
//
//   cd api && node scripts/backfill-api-keys.js
//
// Safe to re-run: only touches rows where public_api_key IS NOT NULL
// AND public_api_key_hash IS NULL, so already-backfilled rows are
// skipped.

import { pool } from "../db/pool.js";
import { encryptSecret } from "../lib/secretCrypto.js";
import crypto from "node:crypto";

function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

async function main() {
  const { rows } = await pool.query(
    `SELECT id, public_api_key FROM boms
     WHERE public_api_key IS NOT NULL AND public_api_key_hash IS NULL`
  );

  console.log(`Found ${rows.length} BOM(s) with a plaintext key to migrate.`);

  let migrated = 0;
  for (const row of rows) {
    const hash = hashApiKey(row.public_api_key);
    const encrypted = encryptSecret(row.public_api_key);
    await pool.query(
      `UPDATE boms SET public_api_key_hash = $1, public_api_key_encrypted = $2 WHERE id = $3`,
      [hash, encrypted, row.id]
    );
    migrated++;
  }

  console.log(`Migrated ${migrated} BOM(s).`);
  console.log(
    "Once you've confirmed the app works (API keys still work, ApiModal still shows keys), " +
    "apply migrations/013_drop_plaintext_api_key.sql to drop the old column."
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
