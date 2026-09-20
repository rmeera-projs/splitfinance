import { describe, test, expect } from "vitest";
import { distributeProportionally, computeReceiptSplit } from "./receiptSplit";

const sum = (values) => values.reduce((a, b) => a + b, 0);

describe("distributeProportionally", () => {
  test("splits in proportion to the weights", () => {
    expect(distributeProportionally(1000, [3, 1])).toEqual([750, 250]);
  });

  test("hands leftover cents to the largest remainders so the parts equal the amount", () => {
    // 100 across three equal weights: 33.33.. each, one leftover cent.
    const parts = distributeProportionally(100, [1, 1, 1]);
    expect(sum(parts)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  test("gives the odd cent to whoever was rounded down the most, not just the first person", () => {
    // Exact shares are 0.4 / 0.6 of 1 cent: the second person has the larger remainder.
    expect(distributeProportionally(1, [2, 3])).toEqual([0, 1]);
  });

  test("handles a negative amount (a net discount) symmetrically", () => {
    const parts = distributeProportionally(-500, [3, 1]);
    expect(parts).toEqual([-375, -125]);
    expect(sum(parts)).toBe(-500);
  });

  test("falls back to an even split when every weight is zero", () => {
    expect(distributeProportionally(101, [0, 0])).toEqual([51, 50]);
  });

  test("returns nothing for no weights", () => {
    expect(distributeProportionally(100, [])).toEqual([]);
  });

  // The reason for BigInt: 2,000,000,000 * 2,000,000,000 is far past 2^53, so
  // a plain-number product would round and the parts would not reconcile.
  test("stays exact at the largest amounts an expense can hold", () => {
    const amount = 2147483647;
    const parts = distributeProportionally(amount, [2000000000, 147483647, 1]);
    expect(sum(parts)).toBe(amount);
  });

  test("always reconciles exactly, across many random inputs", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let n = 0; n < 500; n++) {
      const count = 1 + Math.floor(rand() * 8);
      const weights = Array.from({ length: count }, () => Math.floor(rand() * 20000));
      const amount = Math.floor((rand() - 0.3) * 200000);
      const parts = distributeProportionally(amount, weights);

      expect(sum(parts)).toBe(amount);
      expect(parts).toHaveLength(count);
    }
  });
});

const ALICE = 1;
const BOB = 2;
const CAROL = 3;

describe("computeReceiptSplit", () => {
  test("gives each person exactly what they ordered when there is no tax or tip", () => {
    const items = [{ amount: 2000 }, { amount: 1000 }];
    const result = computeReceiptSplit(items, [[ALICE], [BOB]], [ALICE, BOB], 3000);

    expect(result.shares).toEqual({ [ALICE]: 2000, [BOB]: 1000 });
    expect(result.extrasCents).toBe(0);
  });

  test("splits a shared item evenly between the people who shared it", () => {
    const result = computeReceiptSplit([{ amount: 1200 }], [[ALICE, BOB, CAROL]], [ALICE, BOB, CAROL], 1200);

    expect(result.shares).toEqual({ [ALICE]: 400, [BOB]: 400, [CAROL]: 400 });
  });

  test("puts an odd cent on someone rather than losing it", () => {
    const result = computeReceiptSplit([{ amount: 1001 }], [[ALICE, BOB]], [ALICE, BOB], 1001);

    expect(sum(Object.values(result.shares))).toBe(1001);
    expect(Object.values(result.shares).sort()).toEqual([500, 501]);
  });

  // The behaviour that motivated all this: tax and tip follow what you
  // ordered, they are not split down the middle.
  test("spreads tax and tip in proportion to what each person ordered", () => {
    // Steak $40 (Alice) and salad $10 (Bob) = $50 of items; the receipt total
    // is $60, so $10 of tax and tip. Alice ordered 80% of the items.
    const items = [{ amount: 4000 }, { amount: 1000 }];
    const result = computeReceiptSplit(items, [[ALICE], [BOB]], [ALICE, BOB], 6000);

    expect(result.extrasCents).toBe(1000);
    expect(result.shares).toEqual({ [ALICE]: 4800, [BOB]: 1200 });
  });

  test("always sums to the receipt total exactly", () => {
    const items = [{ amount: 1299 }, { amount: 845 }, { amount: 2210 }, { amount: 333 }];
    const assignments = [[ALICE, BOB], [CAROL], [ALICE], [BOB, CAROL]];
    const result = computeReceiptSplit(items, assignments, [ALICE, BOB, CAROL], 5187);

    expect(sum(Object.values(result.shares))).toBe(5187);
  });

  test("reconciles even when the scan missed lines, by spreading the gap like tax", () => {
    // Items add to $30 but the total is $50: $20 unexplained, spread by share.
    const result = computeReceiptSplit([{ amount: 1500 }, { amount: 1500 }], [[ALICE], [BOB]], [ALICE, BOB], 5000);

    expect(result.extrasCents).toBe(2000);
    expect(result.shares).toEqual({ [ALICE]: 2500, [BOB]: 2500 });
  });

  test("treats a total below the items as a discount, never a negative share", () => {
    const result = computeReceiptSplit([{ amount: 3000 }, { amount: 1000 }], [[ALICE], [BOB]], [ALICE, BOB], 3600);

    expect(result.extrasCents).toBe(-400);
    expect(result.shares).toEqual({ [ALICE]: 2700, [BOB]: 900 });
  });

  test("gives someone who had nothing a zero share, and no cut of the tip", () => {
    const result = computeReceiptSplit([{ amount: 2000 }], [[ALICE]], [ALICE, BOB], 2400);

    expect(result.shares).toEqual({ [ALICE]: 2400, [BOB]: 0 });
  });

  test("reports items nobody was assigned, and still sums to the total", () => {
    const result = computeReceiptSplit([{ amount: 1000 }, { amount: 500 }], [[ALICE], []], [ALICE, BOB], 1500);

    expect(result.unassigned).toEqual([1]);
    expect(sum(Object.values(result.shares))).toBe(1500);
  });

  test("ignores an assignment to someone who is not a member", () => {
    const result = computeReceiptSplit([{ amount: 1000 }], [[999]], [ALICE, BOB], 1000);

    expect(result.unassigned).toEqual([0]);
  });

  test("with no items at all, splits the total evenly", () => {
    const result = computeReceiptSplit([], [], [ALICE, BOB], 1001);

    expect(sum(Object.values(result.shares))).toBe(1001);
    expect(Object.values(result.shares).sort()).toEqual([500, 501]);
  });

  test("reconciles across many random receipts", () => {
    let seed = 987;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const members = [ALICE, BOB, CAROL];

    for (let n = 0; n < 300; n++) {
      const itemCount = 1 + Math.floor(rand() * 10);
      const items = Array.from({ length: itemCount }, () => ({ amount: 100 + Math.floor(rand() * 5000) }));
      const assignments = items.map(() => members.filter(() => rand() < 0.6));
      const itemsTotal = sum(items.map((i) => i.amount));
      const total = Math.max(1, Math.floor(itemsTotal * (0.85 + rand() * 0.4)));

      const result = computeReceiptSplit(items, assignments, members, total);

      expect(sum(Object.values(result.shares))).toBe(total);
      for (const share of Object.values(result.shares)) expect(share).toBeGreaterThanOrEqual(0);
    }
  });
});
