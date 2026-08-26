import test from "node:test";
import assert from "node:assert/strict";

const enabled = Boolean(process.env.TEST_DATABASE_URL);

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
  await pool.end();
});

test("production source maps are disabled", async () => {
  const { readFile } = await import("node:fs/promises");
  const vite = await readFile(new URL("../../frontend/vite.config.js", import.meta.url), "utf8");
  assert.match(vite, /sourcemap:\s*false/);
});
