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

  test("handles multiple creditors and debtors with minimum transactions", () => {
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
});
