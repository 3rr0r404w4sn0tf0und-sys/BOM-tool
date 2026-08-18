import { Hono } from "hono";
import { triggerScrapeJob } from "../lib/githubDispatch.js";

const price = new Hono();

// Frontend calls this to kick off a scrape. Returns a job_id to poll.
price.post("/price/start", async (c) => {
  const { url } = await c.req.json();
  if (!url) return c.json({ error: "url required" }, 400);

  const jobId = crypto.randomUUID();
  await c.env.GEOMETRY_KV.put(`price-job:${jobId}`, JSON.stringify({ status: "pending" }), {
    expirationTtl: 60 * 10, // jobs should resolve in well under 10 min
  });

  const callbackUrl = `${new URL(c.req.url).origin}/api/price/callback`;

  try {
    await triggerScrapeJob(c.env, jobId, url, callbackUrl);
  } catch (err) {
    await c.env.GEOMETRY_KV.put(
      `price-job:${jobId}`,
      JSON.stringify({ status: "error", error: err.message }),
      { expirationTtl: 60 * 10 }
    );
    return c.json({ error: err.message }, 500);
  }

  return c.json({ job_id: jobId, status: "pending" });
});

// GitHub Action POSTs the result here once the scrape finishes.
price.post("/price/callback", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (secret !== c.env.INTERNAL_SCRAPE_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json();
  const { job_id, found, price: value, source, error } = body;
  if (!job_id) return c.json({ error: "job_id required" }, 400);

  await c.env.GEOMETRY_KV.put(
    `price-job:${job_id}`,
    JSON.stringify({ status: "done", found, price: value, source, error }),
    { expirationTtl: 60 * 10 }
  );

  return c.json({ ok: true });
});

// Frontend polls this until status is "done".
price.get("/price/status/:job_id", async (c) => {
  const raw = await c.env.GEOMETRY_KV.get(`price-job:${c.req.param("job_id")}`);
  if (!raw) return c.json({ status: "not_found" }, 404);
  return c.json(JSON.parse(raw));
});

export default price;
