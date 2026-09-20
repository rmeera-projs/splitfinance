// Pure category aggregation, used by the assistant's get_my_spending tool
// (assistantService.js) to turn a flat list of expense splits into a
// by-category breakdown before it ever reaches the model.
//
// This deliberately mirrors client/src/utils/insights.js's
// aggregateByCategory rather than importing it - server and client are
// separate npm packages with no shared build step, and duplicating one
// small pure function is a better trade than introducing a monorepo/shared-
// package layer for it. Keep the two in sync by hand if the aggregation
// rule ever changes.

/**
 * Sums item.amount (integer cents) per category, sorted by total descending.
 * @param {{amount: number, category: string|null}[]} items
 * @returns {{category: string, totalCents: number}[]}
 */
function aggregateByCategory(items) {
  const totals = new Map();
  for (const item of items) {
    const key = item.category || "Other";
    totals.set(key, (totals.get(key) || 0) + item.amount);
  }
  return [...totals.entries()]
    .map(([category, totalCents]) => ({ category, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

module.exports = { aggregateByCategory };
