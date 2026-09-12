import { describe, test, expect } from "vitest";
import { aggregateByCategory, aggregateByDimension, aggregateByTime } from "./insights";

describe("aggregateByCategory", () => {
  test("sums amounts per category, sorted largest first", () => {
    const items = [
      { amount: 10, category: "Food & Drink", date: "2026-01-01" },
      { amount: 5, category: "Travel", date: "2026-01-02" },
      { amount: 7, category: "Food & Drink", date: "2026-01-03" },
    ];

    expect(aggregateByCategory(items)).toEqual([
      { label: "Food & Drink", total: 17 },
      { label: "Travel", total: 5 },
    ]);
  });

  test("falls back to 'Other' for a missing category", () => {
    const items = [{ amount: 3, category: null, date: "2026-01-01" }];
    expect(aggregateByCategory(items)).toEqual([{ label: "Other", total: 3 }]);
  });

  test("returns an empty list for no items", () => {
    expect(aggregateByCategory([])).toEqual([]);
  });
});

describe("aggregateByDimension", () => {
  test("sums amounts by whatever key function is given", () => {
    const items = [
      { amount: 10, payer: "Alice" },
      { amount: 5, payer: "Bob" },
      { amount: 20, payer: "Alice" },
    ];

    expect(aggregateByDimension(items, (i) => i.payer)).toEqual([
      { label: "Alice", total: 30 },
      { label: "Bob", total: 5 },
    ]);
  });

  test("fills in a zero entry for a known label that has no items", () => {
    const items = [{ amount: 10, payer: "Alice" }];

    expect(aggregateByDimension(items, (i) => i.payer, ["Alice", "Carol"])).toEqual([
      { label: "Alice", total: 10 },
      { label: "Carol", total: 0 },
    ]);
  });

  test("doesn't duplicate a known label that already has items", () => {
    const items = [
      { amount: 10, payer: "Alice" },
      { amount: 5, payer: "Bob" },
    ];

    const result = aggregateByDimension(items, (i) => i.payer, ["Alice", "Bob"]);
    expect(result).toHaveLength(2);
  });

  test("with no items at all, every known label still appears at zero", () => {
    expect(aggregateByDimension([], (i) => i.payer, ["Alice", "Bob"])).toEqual([
      { label: "Alice", total: 0 },
      { label: "Bob", total: 0 },
    ]);
  });
});

describe("aggregateByTime", () => {
  test("buckets by month and sorts chronologically regardless of input order", () => {
    const items = [
      { amount: 10, date: "2026-03-15" },
      { amount: 5, date: "2026-01-05" },
      { amount: 7, date: "2026-01-20" },
    ];

    expect(aggregateByTime(items, "month")).toEqual([
      { label: "Jan 2026", total: 12 },
      { label: "Mar 2026", total: 10 },
    ]);
  });

  test("buckets by day, keeping distinct days separate", () => {
    const items = [
      { amount: 10, date: "2026-01-05T09:00:00.000Z" },
      { amount: 5, date: "2026-01-06T09:00:00.000Z" },
    ];

    const result = aggregateByTime(items, "day");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.total)).toEqual([10, 5]);
  });

  test("buckets by week, grouping days in the same week together", () => {
    // Monday 2026-01-05 and Wednesday 2026-01-07 fall in the same ISO week.
    const items = [
      { amount: 10, date: "2026-01-05T00:00:00.000Z" },
      { amount: 5, date: "2026-01-07T00:00:00.000Z" },
    ];

    expect(aggregateByTime(items, "week")).toHaveLength(1);
    expect(aggregateByTime(items, "week")[0].total).toBe(15);
  });

  test("rounds to the cent", () => {
    const items = [
      { amount: 0.1, date: "2026-01-01" },
      { amount: 0.2, date: "2026-01-01" },
    ];
    expect(aggregateByTime(items, "day")[0].total).toBe(0.3);
  });
});
