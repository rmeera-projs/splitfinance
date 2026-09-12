// Client-side aggregation for the spending insights panels (see
// InsightsPanel). Both GroupPage and DashboardPage fetch a flat list of
// { amount, category, date, ...breakdown fields } once and aggregate it here
// in the browser, rather than the server precomputing every breakdown - the
// data volumes involved (one group's or one person's expenses) are small,
// and this lets the "Over Time" granularity toggle switch instantly with no
// refetch.

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Sums item.amount per key(item), sorted by total descending - used for the
// category and member/group breakdowns, where "biggest first" is the useful
// order.
function aggregateByTotal(items, keyFn) {
  const totals = new Map();
  for (const item of items) {
    const key = keyFn(item);
    totals.set(key, (totals.get(key) || 0) + item.amount);
  }
  return [...totals.entries()]
    .map(([label, total]) => ({ label, total: round2(total) }))
    .sort((a, b) => b.total - a.total);
}

export function aggregateByCategory(items) {
  return aggregateByTotal(items, (i) => i.category || "Other");
}

// `keyFn` extracts the breakdown label from an item - the payer's name for
// the per-group "By Member" view, or the group's name for the personal
// "By Group" view.
//
// `knownLabels`, if given, is every label that *should* appear even if it
// has no items yet - e.g. every current group member's name, so someone
// just added to the group shows up at $0 instead of being missing from the
// breakdown entirely (which reads as "insights didn't update").
export function aggregateByDimension(items, keyFn, knownLabels) {
  const result = aggregateByTotal(items, keyFn);
  if (!knownLabels) return result;

  const present = new Set(result.map((r) => r.label));
  const zeros = knownLabels.filter((label) => !present.has(label)).map((label) => ({ label, total: 0 }));
  return [...result, ...zeros].sort((a, b) => b.total - a.total);
}

// Buckets item.date by day/week/month. Returns a *sortable* key (so buckets
// come back in chronological order) and a Date to derive a display label
// from - kept apart from the display label because "Sep 2026" isn't safely
// re-parseable/sortable as a string on its own.
// Buckets by UTC calendar date rather than the viewer's local timezone, so
// the same expense lands in the same bucket for every viewer regardless of
// where they are - important since dates default to `now()` at whatever
// instant the expense was logged, and comparing local-time buckets against
// a UTC instant would shift day/week boundaries depending on the reader's
// timezone (and even flip an expense to a different calendar day).
function bucketStart(dateStr, granularity) {
  const d = new Date(dateStr);
  if (granularity === "month") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  if (granularity === "week") {
    const day = d.getUTCDay(); // 0 (Sun) - 6 (Sat)
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + mondayOffset));
  }
  // day
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function labelForBucket(bucketDate, granularity) {
  const opts = { timeZone: "UTC" };
  if (granularity === "month") {
    return bucketDate.toLocaleDateString(undefined, { ...opts, month: "short", year: "numeric" });
  }
  if (granularity === "week") {
    return `Week of ${bucketDate.toLocaleDateString(undefined, { ...opts, month: "short", day: "numeric" })}`;
  }
  return bucketDate.toLocaleDateString(undefined, { ...opts, month: "short", day: "numeric" });
}

/**
 * Buckets items by day/week/month, sorted chronologically (oldest first) -
 * unlike the other breakdowns, time order matters more than size order here.
 */
export function aggregateByTime(items, granularity) {
  const buckets = new Map(); // sortKey (ms since epoch) -> { date, total }
  for (const item of items) {
    const bucketDate = bucketStart(item.date, granularity);
    const sortKey = bucketDate.getTime();
    const existing = buckets.get(sortKey);
    if (existing) {
      existing.total += item.amount;
    } else {
      buckets.set(sortKey, { date: bucketDate, total: item.amount });
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, { date, total }]) => ({ label: labelForBucket(date, granularity), total: round2(total) }));
}
