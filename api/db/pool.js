import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // node-postgres defaults `max` to 10. That's fine for one person testing
  // locally, but with several users polling their open BOMs every 4s (each
  // poll fires the bom+sections+items queries in parallel, i.e. up to 3
  // connections at once) it's easy to exhaust with real concurrent usage --
  // requests then queue behind connectionTimeoutMillis and start failing.
  // Override via DB_POOL_MAX if the Postgres host's own connection cap
  // (e.g. Neon's free-tier limit) is lower than this.
  max: Number(process.env.DB_POOL_MAX) || 20,
  // Defaults here are 0 (wait forever) for connectionTimeoutMillis, which
  // means if the pool is ever exhausted (e.g. a leaked client, or Neon's
  // own connection cap hit from the scraper Actions workflows hitting
  // DATABASE_URL directly), a query just hangs forever with no error --
  // another possible cause of "clicking a BOM loads forever". Fail loud
  // instead so it surfaces as a 500 (via the global error handler) and
  // shows up in the Render logs.
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
});
