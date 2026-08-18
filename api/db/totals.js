// Shared totals logic:
// - excluded (link_failed / price_not_found) items are dropped from the
//   math entirely and flagged.
// - stale Amazon items (status still "ok", but stale_price = true) keep
//   counting toward the total using their last known price -- an old
//   real number beats silently zeroing out an Amazon-heavy BOM -- but
//   are flagged separately so the UI can show a "prices may be outdated"
//   notice.

export function calculateTotals(items, taxRate) {
  const validItems = items.filter(
    (i) => i.status === "ok" && i.unit_price !== null
  );
  const excludedCount = items.length - validItems.length;
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
