import test from "node:test";
import assert from "node:assert/strict";

const enabled = Boolean(process.env.TEST_DATABASE_URL);

// All DB-backed tests below share one pool (db/pool.js is a singleton via
// the ESM module cache), so it's only safe to close it once, after every
// test has run -- closing it inside an individual test starves every
// later test that imports the "same" pool.
test.after(async () => {
  if (!enabled) return;
  const { pool } = await import("../db/pool.js");
  await pool.end().catch(() => {});
});

test("ownership helpers prevent cross-user child access", { skip: !enabled }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = await import("../db/pool.js");
  const { getOwnedSection, getOwnedItem } = await import("../routes/boms.js");

  const suffix = Date.now().toString(36);
  const users = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [`security-a-${suffix}@example.test`, "x", `security-b-${suffix}@example.test`, "x"]
  );
  const userA = users.rows[0].id;
  const userB = users.rows[1].id;
  const bom = await pool.query(`INSERT INTO boms (user_id, title) VALUES ($1, 'security test') RETURNING id`, [userA]);
  const section = await pool.query(`INSERT INTO sections (bom_id, title) VALUES ($1, 'section') RETURNING id`, [bom.rows[0].id]);
  const item = await pool.query(`INSERT INTO items (section_id, name, qty) VALUES ($1, 'item', 1) RETURNING id`, [section.rows[0].id]);

  assert.ok(await getOwnedSection(section.rows[0].id, userA));
  assert.equal(await getOwnedSection(section.rows[0].id, userB), null);
  assert.ok(await getOwnedItem(item.rows[0].id, userA));
  assert.equal(await getOwnedItem(item.rows[0].id, userB), null);

  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
});

test("production source maps are disabled", async () => {
  const { readFile } = await import("node:fs/promises");
  const vite = await readFile(new URL("../../frontend/vite.config.js", import.meta.url), "utf8");
  assert.match(vite, /sourcemap:\s*false/);
});

// --- Sharing / role-based access control ---
// These exercise lib/access.js's getBomRole() directly against a real DB
// (same pattern as the ownership test above), since that's the single
// function every route's authorization ultimately funnels through.

test("owner, editor, viewer, and stranger all get the correct role", { skip: !enabled }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = await import("../db/pool.js");
  const { getBomRole } = await import("../lib/access.js");

  const suffix = Date.now().toString(36);
  const users = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2), ($3, $4), ($5, $6) RETURNING id`,
    [
      `share-owner-${suffix}@example.test`, "x",
      `share-editor-${suffix}@example.test`, "x",
      `share-stranger-${suffix}@example.test`, "x",
    ]
  );
  const owner = users.rows[0].id;
  const editor = users.rows[1].id;
  const stranger = users.rows[2].id;

  const bom = await pool.query(`INSERT INTO boms (user_id, title) VALUES ($1, 'share test') RETURNING id`, [owner]);
  const bomId = bom.rows[0].id;
  await pool.query(
    `INSERT INTO bom_shares (bom_id, email, user_id, role, invited_by)
     VALUES ($1, $2, $3, 'editor', $4)`,
    [bomId, `share-editor-${suffix}@example.test`, editor, owner]
  );

  assert.equal(await getBomRole(bomId, owner), "owner");
  assert.equal(await getBomRole(bomId, editor), "editor");
  assert.equal(await getBomRole(bomId, stranger), null);

  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[owner, editor, stranger]]);
});

test("pending email invite is claimed on first access and role checks by user_id afterward", { skip: !enabled }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = await import("../db/pool.js");
  const { getBomRole } = await import("../lib/access.js");

  const suffix = Date.now().toString(36);
  const users = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [`share-owner2-${suffix}@example.test`, "x", `share-invitee-${suffix}@example.test`, "x"]
  );
  const owner = users.rows[0].id;
  const invitee = users.rows[1].id;

  const bom = await pool.query(`INSERT INTO boms (user_id, title) VALUES ($1, 'invite test') RETURNING id`, [owner]);
  const bomId = bom.rows[0].id;

  // Invite sent to the email with no user_id yet attached (simulates
  // inviting someone before they'd necessarily be looked up/linked).
  const share = await pool.query(
    `INSERT INTO bom_shares (bom_id, email, role, invited_by) VALUES ($1, $2, 'viewer', $3) RETURNING id`,
    [bomId, `share-invitee-${suffix}@example.test`, owner]
  );

  const role = await getBomRole(bomId, invitee);
  assert.equal(role, "viewer");

  const claimed = await pool.query("SELECT user_id, accepted_at FROM bom_shares WHERE id = $1", [share.rows[0].id]);
  assert.equal(claimed.rows[0].user_id, invitee);
  assert.ok(claimed.rows[0].accepted_at);

  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[owner, invitee]]);
});

test("public_access grants view/edit to non-shared users without a bom_shares row", { skip: !enabled }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = await import("../db/pool.js");
  const { getBomRole } = await import("../lib/access.js");

  const suffix = Date.now().toString(36);
  const users = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [`share-owner3-${suffix}@example.test`, "x", `share-rando-${suffix}@example.test`, "x"]
  );
  const owner = users.rows[0].id;
  const rando = users.rows[1].id;

  const bom = await pool.query(
    `INSERT INTO boms (user_id, title, public_access) VALUES ($1, 'public test', 'private') RETURNING id`,
    [owner]
  );
  const bomId = bom.rows[0].id;

  assert.equal(await getBomRole(bomId, rando), null);

  await pool.query("UPDATE boms SET public_access = 'view' WHERE id = $1", [bomId]);
  assert.equal(await getBomRole(bomId, rando), "viewer");

  await pool.query("UPDATE boms SET public_access = 'edit' WHERE id = $1", [bomId]);
  assert.equal(await getBomRole(bomId, rando), "editor");

  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[owner, rando]]);
});

test("getOwnedSection/getOwnedItem respect minRole (viewer can read, not write)", { skip: !enabled }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = await import("../db/pool.js");
  const { getOwnedSection, getOwnedItem, userOwnsBom } = await import("../routes/boms.js");

  const suffix = Date.now().toString(36);
  const users = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [`share-owner4-${suffix}@example.test`, "x", `share-viewer-${suffix}@example.test`, "x"]
  );
  const owner = users.rows[0].id;
  const viewer = users.rows[1].id;

  const bom = await pool.query(`INSERT INTO boms (user_id, title) VALUES ($1, 'viewer test') RETURNING id`, [owner]);
  const bomId = bom.rows[0].id;
  const section = await pool.query(`INSERT INTO sections (bom_id, title) VALUES ($1, 'section') RETURNING id`, [bomId]);
  const item = await pool.query(`INSERT INTO items (section_id, name, qty) VALUES ($1, 'item', 1) RETURNING id`, [section.rows[0].id]);
  await pool.query(
    `INSERT INTO bom_shares (bom_id, email, user_id, role, invited_by) VALUES ($1, $2, $3, 'viewer', $4)`,
    [bomId, `share-viewer-${suffix}@example.test`, viewer, owner]
  );

  // Viewer can be resolved at viewer level (reads)...
  assert.ok(await getOwnedSection(section.rows[0].id, viewer, "viewer"));
  assert.ok(await getOwnedItem(item.rows[0].id, viewer, "viewer"));
  assert.ok(await userOwnsBom(bomId, viewer, "viewer"));
  // ...but not at editor level (writes) -- this is what every
  // section/item mutation route in boms.js actually checks.
  assert.equal(await getOwnedSection(section.rows[0].id, viewer, "editor"), null);
  assert.equal(await getOwnedItem(item.rows[0].id, viewer, "editor"), null);
  assert.equal(await userOwnsBom(bomId, viewer, "editor"), false);
  // And never at owner level (sharing/deletion/API key).
  assert.equal(await userOwnsBom(bomId, viewer, "owner"), false);

  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[owner, viewer]]);
});

