// Shared totals logic:
// - excluded items are ones a scrape was actually attempted for and
//   failed (status link_failed / price_not_found). Freshly-added items
//   that just haven't been scraped yet ("pending") are NOT excluded --
//   they simply don't contribute to the subtotal yet, same as excluded
//   ones do, but they shouldn't trip the "fix your links" banner before
//   they've even had a chance to resolve.
// - stale Amazon items (status still "ok", but stale_price = true) keep
//   counting toward the total using their last known price -- an old
//   real number beats silently zeroing out an Amazon-heavy BOM -- but
//   are flagged separately so the UI can show a "prices may be outdated"
//   notice.

export function calculateTotals(items, taxRate) {
  const validItems = items.filter(
    (i) => i.status === "ok" && i.unit_price !== null
  );
  const excludedCount = items.filter(
    (i) => i.status === "link_failed" || i.status === "price_not_found"
  ).length;
  const staleCount = items.filter((i) => i.stale_price).length;

  const subtotal = validItems.reduce(
    (sum, i) => sum + Number(i.unit_price) * Number(i.qty),
    0
  );
  const tax = Math.round(subtotal * Number(taxRate) * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax,
    total,
    excludedCount,
    staleCount,
  };
}
