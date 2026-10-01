// Scrape tracking helpers, shared by the /track page and the per-BOM debug
// panel.
//
// KEEP IN SYNC with api/routes/track.js -- that file classifies items in
// SQL for the cross-BOM /track page; this does the same thing client-side
// for a single loaded BOM (so the per-BOM panel is live with polling and
// needs no extra request). Same method buckets, same state rules.

export const METHODS = [
  { key: "amazon", label: "Amazon" },
  { key: "mouser", label: "Mouser" },
  { key: "etsy", label: "Etsy" },
  { key: "generic", label: "Generic (all other sites)" },
];

export const METHOD_LABELS = Object.fromEntries(METHODS.map((m) => [m.key, m.label]));

// Same substring rules the scrapers/dispatcher use (ILIKE '%amazon.%' ...).
export function methodOf(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("amazon.")) return "amazon";
  if (u.includes("mouser.")) return "mouser";
  if (u.includes("etsy.")) return "etsy";
  return "generic";
}

// pending -> scrape in flight
// stale   -> scrape failed, an older price is being kept
// failed  -> no usable price (link_failed / price_not_found)
// ok      -> everything else
export function stateOf(item) {
  if (item.status === "pending") return "pending";
  if (item.stale_price && item.unit_price !== null && item.unit_price !== undefined) return "stale";
  if (item.status === "link_failed" || item.status === "price_not_found") return "failed";
  return "ok";
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

// Summarize a flat list of items (already scoped to one BOM) into the same
// shape /api/track returns: { methods: [...], failures: [...], last_scrape }.
export function summarizeItems(items) {
  const rows = Object.fromEntries(METHODS.map((m) => [m.key, {
    method: m.key, total: 0, ok: 0, stale: 0, failed: 0, pending: 0,
    never_checked: 0, last_scrape: null, last_success: null,
  }]));
  const failures = [];

  for (const item of items) {
    if (!item.url) continue; // no URL = nothing to scrape
    const method = methodOf(item.url);
    const state = stateOf(item);
    const row = rows[method];
    row.total += 1;
    row[state] += 1;
    if (!item.last_checked && state !== "pending") row.never_checked += 1;

    // Hand-typed prices set last_checked too but aren't scrapes.
    if (item.source !== "manual" && item.last_checked) {
      row.last_scrape = maxIso(row.last_scrape, item.last_checked);
      if (state === "ok") row.last_success = maxIso(row.last_success, item.last_checked);
    }

    if (state === "failed" || state === "stale") {
      failures.push({
        id: item.id,
        name: item.name,
        url: item.url,
        status: item.status,
        state,
        method,
        last_error: item.last_error || null,
        last_checked: item.last_checked || null,
      });
    }
  }

  failures.sort((a, b) => {
    const at = a.last_checked ? new Date(a.last_checked).getTime() : -Infinity;
    const bt = b.last_checked ? new Date(b.last_checked).getTime() : -Infinity;
    return bt - at;
  });

  const methods = METHODS.map((m) => rows[m.key]);
  const last_scrape = methods.reduce((latest, m) => maxIso(latest, m.last_scrape), null);
  return { methods, failures, last_scrape };
}

// "3h ago" style, with the exact local time available via the title attr.
export function formatWhen(iso) {
  if (!iso) return { text: "Never", title: "No scrape recorded yet" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: "Unknown", title: "" };
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  let text;
  if (seconds < 60) text = "just now";
  else if (seconds < 3600) text = `${Math.floor(seconds / 60)}m ago`;
  else if (seconds < 86400) text = `${Math.floor(seconds / 3600)}h ago`;
  else if (seconds < 86400 * 60) text = `${Math.floor(seconds / 86400)}d ago`;
  else text = d.toLocaleDateString();
  return { text, title: d.toLocaleString() };
}

// What to show in the "reason" column. Failures recorded before the
// scrapers started writing last_error (or manual status flips) have no
// reason, so say that plainly instead of leaving it blank.
export function reasonFor(failure) {
  if (failure.last_error) return failure.last_error;
  if (failure.state === "stale") return "Refresh failed; keeping the last known price (no reason recorded).";
  if (failure.status === "link_failed") return "Link failed (no reason recorded).";
  return "Price not found (no reason recorded).";
}
