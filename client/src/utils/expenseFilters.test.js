import { describe, test, expect } from "vitest";
import { EMPTY_FILTERS, filterExpenses, hasActiveFilters, localDateKey } from "./expenseFilters";

const ALICE = { id: 1, name: "Alice" };
const BOB = { id: 2, name: "Bob" };

// Dates built from local calendar parts, so these tests mean the same thing
// in every timezone the suite might run in.
const onDay = (y, m, d, hour = 12) => new Date(y, m - 1, d, hour).toISOString();

const expenses = [
  { id: 1, description: "Tapas at Quimet", category: "Food & Drink", payer: ALICE, amount: 6450, date: onDay(2026, 9, 1) },
  { id: 2, description: "Airport taxi", category: "Transportation", payer: BOB, amount: 3840, date: onDay(2026, 9, 5) },
  { id: 3, description: "Late-night tapas", category: "Food & Drink", payer: BOB, amount: 2200, date: onDay(2026, 9, 10) },
];

const ids = (list) => list.map((e) => e.id);
const filter = (overrides) => filterExpenses(expenses, { ...EMPTY_FILTERS, ...overrides });

describe("filterExpenses", () => {
  test("returns everything when no filter is set", () => {
    expect(ids(filter({}))).toEqual([1, 2, 3]);
  });

  test("matches description text case-insensitively, ignoring surrounding spaces", () => {
    expect(ids(filter({ text: "  TAPAS " }))).toEqual([1, 3]);
  });

  test("filters by category", () => {
    expect(ids(filter({ category: "Transportation" }))).toEqual([2]);
  });

  // The payer comes from a <select>, whose value is always a string.
  test("filters by payer given the id as a string", () => {
    expect(ids(filter({ payerId: "2" }))).toEqual([2, 3]);
  });

  test("includes both ends of a date range", () => {
    expect(ids(filter({ from: "2026-09-01", to: "2026-09-05" }))).toEqual([1, 2]);
  });

  test("supports an open-ended range in either direction", () => {
    expect(ids(filter({ from: "2026-09-05" }))).toEqual([2, 3]);
    expect(ids(filter({ to: "2026-09-04" }))).toEqual([1]);
  });

  test("combines filters as AND", () => {
    expect(ids(filter({ text: "tapas", payerId: "2" }))).toEqual([3]);
    expect(ids(filter({ category: "Food & Drink", to: "2026-09-05" }))).toEqual([1]);
  });

  test("returns an empty list when nothing matches", () => {
    expect(filter({ text: "helicopter" })).toEqual([]);
  });
});

describe("localDateKey", () => {
  // The whole point: a late-evening expense belongs to that evening's date
  // for the person viewing it, not to whatever the UTC date happens to be.
  test("uses the viewer's local calendar date, not the UTC one", () => {
    expect(localDateKey(new Date(2026, 8, 16, 23, 30))).toBe("2026-09-16");
    expect(localDateKey(new Date(2026, 8, 17, 0, 15))).toBe("2026-09-17");
  });

  test("accepts an ISO string as stored by the API", () => {
    expect(localDateKey(onDay(2026, 1, 9))).toBe("2026-01-09");
  });

  test("zero-pads single-digit months and days", () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("hasActiveFilters", () => {
  test("is false for the empty filter set", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  test("is true once any single filter is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, to: "2026-09-01" })).toBe(true);
  });
});
