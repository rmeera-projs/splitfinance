import { useState } from "react";
import { aggregateByCategory, aggregateByDimension, aggregateByTime } from "../utils/insights";

// Plain CSS bar chart - no charting library dependency for what's just a
// handful of horizontal bars, and it's simple to assert on in tests.
function BarList({ data }) {
  if (data.length === 0) {
    return <p className="text-xs text-gray-400">Nothing to show yet.</p>;
  }
  const max = Math.max(...data.map((d) => d.total), 0.01);
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-700">{d.label}</span>
            <span className="text-gray-500">{`$${d.total.toFixed(2)}`}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded">
            <div
              className="h-2 bg-emerald-500 rounded"
              style={{ width: `${(d.total / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const GRANULARITIES = ["day", "week", "month"];

/**
 * Shared spending-insights panel used by both GroupPage (one group's
 * expenses, broken down by member) and DashboardPage (one user's share of
 * spending across every group, broken down by group).
 *
 * @param {Array<{amount: number, category: string, date: string}>} items
 * @param {string} dimensionLabel - heading for the third breakdown, e.g. "Member" or "Group"
 * @param {(item: object) => string} dimension - extracts that breakdown's label from an item
 * @param {string[]} [dimensionValues] - every label that should appear in the
 *   By-{dimensionLabel} breakdown even at $0 (e.g. every current group
 *   member's name), so someone with no expenses yet still shows up instead
 *   of silently missing from the chart
 */
export default function InsightsPanel({ items, dimensionLabel, dimension, dimensionValues }) {
  const [granularity, setGranularity] = useState("month");

  // Only bail out entirely when there's truly nothing to show - if
  // dimensionValues was given, the By-{dimensionLabel} column still has
  // something worth rendering (everyone at $0) even with zero expenses.
  if (items.length === 0 && !dimensionValues?.length) {
    return <p className="text-sm text-gray-500">No expenses yet.</p>;
  }

  const byCategory = aggregateByCategory(items);
  const byDimension = aggregateByDimension(items, dimension, dimensionValues);
  const byTime = aggregateByTime(items, granularity);

  return (
    <div className="grid gap-6 sm:grid-cols-3">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">By Category</h3>
        <BarList data={byCategory} />
      </div>
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">By {dimensionLabel}</h3>
        <BarList data={byDimension} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">Over Time</h3>
          <div className="flex text-xs border rounded overflow-hidden">
            {GRANULARITIES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`px-2 py-0.5 capitalize ${
                  granularity === g ? "bg-emerald-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <BarList data={byTime} />
      </div>
    </div>
  );
}
