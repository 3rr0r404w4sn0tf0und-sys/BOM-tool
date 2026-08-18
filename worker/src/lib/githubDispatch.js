/**
 * Fires a repository_dispatch event to trigger .github/workflows/scrape-on-demand.yml.
 * Requires a GITHUB_TOKEN (fine-grained PAT, "Actions: write" + "Contents: read"
 * on the repo) set via `wrangler secret put GITHUB_TOKEN`.
 */
export async function triggerScrapeJob(env, jobId, url, callbackUrl) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "printed-parts-calc-worker",
    },
    body: JSON.stringify({
      event_type: "scrape-request",
      client_payload: { job_id: jobId, url, callback_url: callbackUrl },
    }),
  });

  if (res.status !== 204) {
    const body = await res.text();
    throw new Error(`GitHub dispatch failed (${res.status}): ${body}`);
  }
}
