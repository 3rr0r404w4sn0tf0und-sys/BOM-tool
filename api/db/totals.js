// Shared totals logic: excluded (link_failed / price_not_found) items
// are dropped from the math entirely and flagged, per product decision.

export function calculateTotals(items, taxRate) {
  const validItems = items.filter(
    (i) => i.status === "ok" && i.unit_price !== null
  );
  const excludedCount = items.length - validItems.length;

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
  };
}
