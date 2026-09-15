const { simplifyDebts } = require("./simplifyDebts");

describe("simplifyDebts", () => {
  test("collapses a settle-up cycle into zero transactions", () => {
    // Alice owes Bob 10, Bob owes Carol 10, Carol owes Alice 10 -> nets to nothing
    const debts = [
      { from: 1, to: 2, amount: 10 },
      { from: 2, to: 3, amount: 10 },
      { from: 3, to: 1, amount: 10 },
    ];
    expect(simplifyDebts(debts)).toEqual([]);
  });

  test("simplifies a chain into a single transaction", () => {
    // A owes B 20, B owes C 20 -> should simplify to A pays C 20
    const debts = [
      { from: 1, to: 2, amount: 20 },
      { from: 2, to: 3, amount: 20 },
    ];
    const result = simplifyDebts(debts);
    expect(result).toEqual([{ from: 1, to: 3, amount: 20 }]);
  });

  test("handles multiple creditors and debtors without over-paying", () => {
    // A owes 30, B owes 10, C is owed 25, D is owed 15
    const debts = [
      { from: 1, to: 3, amount: 25 },
      { from: 1, to: 4, amount: 5 },
      { from: 2, to: 4, amount: 10 },
    ];
    const result = simplifyDebts(debts);
    const totalPaid = result.reduce((sum, t) => sum + t.amount, 0);
    expect(totalPaid).toBeCloseTo(40);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test("returns empty array for no debts", () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  // The documented approach is "largest creditor against largest debtor",
  // which only holds if the balances are actually sorted first. These debts
  // are deliberately fed in smallest-first order, so an unsorted
  // implementation would pair the small debtor with the small creditor and
  // produce a different first transaction.
  test("matches the largest debtor against the largest creditor first", () => {
    const debts = [
      { from: 1, to: 3, amount: 10 }, // small debtor (1) -> small creditor (3)
      { from: 2, to: 4, amount: 90 }, // large debtor (2) -> large creditor (4)
    ];

    const result = simplifyDebts(debts);

    expect(result[0]).toEqual({ from: 2, to: 4, amount: 90 });
  });

  // The float version treated anything under a cent as settled, so a
  // genuine one-cent debt disappeared instead of being reported. In integer
  // cents "settled" is exactly zero, and a single cent is a real balance.
  test("reports a one-cent debt instead of rounding it away", () => {
    const result = simplifyDebts([{ from: 1, to: 2, amount: 1 }]);

    expect(result).toEqual([{ from: 1, to: 2, amount: 1 }]);
  });

  // The (n - 1) bound is the claim the docstring actually makes, so it's
  // worth pinning: 4 people with tangled debts must never need more than 3
  // transactions to settle.
  test("settles n people in at most (n - 1) transactions", () => {
    const debts = [
      { from: 1, to: 2, amount: 3333 },
      { from: 2, to: 3, amount: 1750 },
      { from: 3, to: 4, amount: 4200 },
      { from: 4, to: 1, amount: 825 },
      { from: 1, to: 3, amount: 1240 },
    ];

    const result = simplifyDebts(debts);

    const people = new Set(debts.flatMap((d) => [d.from, d.to]));
    expect(result.length).toBeLessThanOrEqual(people.size - 1);

    // ...and everyone still ends up square: each person's net position
    // across the simplified transactions must cancel their original one.
    const net = (list) =>
      list.reduce((acc, { from, to, amount }) => {
        acc.set(from, (acc.get(from) || 0) - amount);
        acc.set(to, (acc.get(to) || 0) + amount);
        return acc;
      }, new Map());

    const original = net(debts);
    const simplified = net(result);
    for (const person of people) {
      expect(simplified.get(person) || 0).toBeCloseTo(original.get(person) || 0, 2);
    }
  });
});
