import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
