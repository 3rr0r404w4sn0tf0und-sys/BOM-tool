// Mirrors api/db/totals.js exactly, so local optimistic updates (add row,
// edit qty, delete row, undo/redo...) can recompute the subtotal/tax/total
// instantly on the client instead of waiting on a server round trip.

// Thousands-separated currency string, e.g. 12290.65 -> "12,290.65". Used
// everywhere a dollar amount is shown so large BOMs stay readable.
export function formatMoney(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function calculateTotals(items, taxRate) {
  const validItems = items.filter((i) => i.status === "ok" && i.unit_price !== null);
  const excludedCount = items.filter(
    (i) => i.status === "link_failed" || i.status === "price_not_found"
  ).length;
  const staleCount = items.filter((i) => i.stale_price).length;

  const subtotal = validItems.reduce((sum, i) => sum + Number(i.unit_price) * Number(i.qty), 0);
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

export function allItems(sections) {
  return sections.flatMap((s) => s.items);
}
