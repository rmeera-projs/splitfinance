import { describe, test, expect } from "vitest";
import { parseAmountToCents, formatCents, centsToInputValue, splitEvenly } from "./money";

describe("parseAmountToCents", () => {
  test.each([
    ["10", 1000],
    ["10.2", 1020],
    ["10.23", 1023],
    ["0.01", 1],
    ["$45.50", 4550],
    ["  12.34  ", 1234],
  ])("parses %s to %i cents", (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  test.each([["", "empty"], [".", "bare dot"], ["abc", "letters"], ["10.234", "3dp"], ["-5", "negative"]])(
    "rejects %s (%s)",
    (input) => {
      expect(parseAmountToCents(input)).toBeNull();
    }
  );
});

describe("formatCents", () => {
  test.each([
    [1023, "10.23"],
    [1000, "10.00"],
    [1, "0.01"],
    [0, "0.00"],
    [-2550, "-25.50"],
  ])("renders %i as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

// The form prefill and the display path have to agree, or editing an
// expense would quietly change its amount just by opening the form.
describe("centsToInputValue", () => {
  test("round-trips back through parseAmountToCents unchanged", () => {
    for (const cents of [1, 99, 100, 1023, 6050, 123456]) {
      expect(parseAmountToCents(centsToInputValue(cents))).toBe(cents);
    }
  });
});

describe("splitEvenly", () => {
  test("divides evenly when it can", () => {
    expect(splitEvenly(6000, 3)).toEqual([2000, 2000, 2000]);
  });

  // $60.50 three ways is 2016.666... cents - the API now requires the
  // splits to sum to the total exactly, so the odd cents must go somewhere
  // explicit rather than being rounded away.
  test("hands the leftover cents out one at a time", () => {
    expect(splitEvenly(6050, 3)).toEqual([2017, 2017, 2016]);
  });

  test("always sums back to exactly the total", () => {
    for (const total of [1, 7, 100, 6050, 9999, 123457]) {
      for (const n of [1, 2, 3, 4, 7, 11]) {
        const parts = splitEvenly(total, n);
        expect(parts).toHaveLength(n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });
});
