const { parseAmountToCents, numberToCents, formatCents, splitEvenly } = require("./money");

describe("parseAmountToCents", () => {
  test.each([
    ["10", 1000],
    ["10.2", 1020],
    ["10.23", 1023],
    ["0.01", 1],
    ["0", 0],
    ["$45.50", 4550],
    ["  12.34  ", 1234],
    ["1000000.99", 100000099],
  ])("parses %s to %i cents", (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  // The float trap this module exists to avoid: 1.005 * 100 is
  // 100.49999999999999 in binary floating point, so Math.round would give
  // 100 cents instead of 101. Parsing the string can't get this wrong.
  test("is exact for values that float multiplication rounds the wrong way", () => {
    expect(parseAmountToCents("1.005")).toBeNull(); // 3dp is rejected outright
    expect(parseAmountToCents("1.01")).toBe(101);
    expect(parseAmountToCents("8.07")).toBe(807);
    expect(Math.round(8.07 * 100)).toBe(807); // (this one happens to be fine)
    expect(parseAmountToCents("1.13")).toBe(113);
  });

  test.each([
    ["", "empty"],
    [".", "bare dot"],
    ["abc", "letters"],
    ["10.234", "too many decimals"],
    ["-5", "negative"],
    ["1e3", "exponent notation"],
    [null, "null"],
    [undefined, "undefined"],
  ])("rejects %s (%s)", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
});

describe("numberToCents", () => {
  test("rounds a model-supplied number to the nearest cent", () => {
    expect(numberToCents(60)).toBe(6000);
    expect(numberToCents(60.5)).toBe(6050);
    expect(numberToCents(60.499999)).toBe(6050);
    expect(numberToCents(0)).toBe(0);
  });

  test("rejects non-finite and non-numeric values", () => {
    expect(numberToCents(NaN)).toBeNull();
    expect(numberToCents(Infinity)).toBeNull();
    expect(numberToCents("60")).toBeNull();
  });
});

describe("formatCents", () => {
  test.each([
    [1023, "10.23"],
    [1000, "10.00"],
    [1, "0.01"],
    [0, "0.00"],
    [-2550, "-25.50"],
    [100000099, "1000000.99"],
  ])("renders %i as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe("splitEvenly", () => {
  test("divides evenly when it can", () => {
    expect(splitEvenly(6000, 3)).toEqual([2000, 2000, 2000]);
  });

  // 6050 / 3 = 2016.666..., which no set of equal whole cents can make.
  test("hands the leftover cents out one at a time", () => {
    expect(splitEvenly(6050, 3)).toEqual([2017, 2017, 2016]);
  });

  test("always sums back to exactly the total", () => {
    for (const total of [1, 7, 100, 6050, 9999, 123457]) {
      for (const n of [1, 2, 3, 4, 7, 11]) {
        const parts = splitEvenly(total, n);
        expect(parts).toHaveLength(n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        // No part is ever more than a cent away from any other.
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("handles a zero-person split without dividing by zero", () => {
    expect(splitEvenly(1000, 0)).toEqual([]);
  });
});
