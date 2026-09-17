jest.mock("../config/prisma", () => ({}));

const { computeDebts, summarizeUserBalances } = require("./balanceService");

const ME = 1;
const BOB = 2;
const CAROL = 3;

describe("computeDebts", () => {
  test("turns an expense split into a debt to the payer", () => {
    const debts = computeDebts(
      [{ paidBy: ME, splits: [{ userId: BOB, amountOwed: 1500 }, { userId: ME, amountOwed: 1500 }] }],
      []
    );

    // The payer's own share nets to nothing and must not appear.
    expect(debts).toEqual([{ from: BOB, to: ME, amount: 1500 }]);
  });

  test("a settlement cancels the debt it pays", () => {
    const debts = computeDebts(
      [{ paidBy: ME, splits: [{ userId: BOB, amountOwed: 1500 }] }],
      [{ fromUser: BOB, toUser: ME, amount: 1500 }]
    );

    expect(debts).toEqual([]);
  });

  // The case the settlement bug lived in: simplification routes Carol's debt
  // past Bob, who nets to zero.
  test("routes a debt through someone who nets to zero", () => {
    const debts = computeDebts(
      [
        { paidBy: ME, splits: [{ userId: BOB, amountOwed: 1500 }] },
        { paidBy: BOB, splits: [{ userId: CAROL, amountOwed: 1500 }] },
      ],
      []
    );

    expect(debts).toEqual([{ from: CAROL, to: ME, amount: 1500 }]);
  });
});

describe("summarizeUserBalances", () => {
  const group = (id, debts) => ({ id, name: `Group ${id}`, debts });

  test("signs amounts from the user's point of view", () => {
    const { people } = summarizeUserBalances(ME, [
      group(1, [
        { from: BOB, to: ME, amount: 1500 },
        { from: ME, to: CAROL, amount: 400 },
      ]),
    ]);

    // Positive: they owe me. Negative: I owe them.
    expect(people).toEqual([
      { userId: BOB, net: 1500, groups: [{ id: 1, name: "Group 1", amount: 1500 }] },
      { userId: CAROL, net: -400, groups: [{ id: 1, name: "Group 1", amount: -400 }] },
    ]);
  });

  test("nets a debt in one group against a credit in another", () => {
    const { people } = summarizeUserBalances(ME, [
      group(1, [{ from: BOB, to: ME, amount: 2500 }]),
      group(2, [{ from: ME, to: BOB, amount: 1000 }]),
    ]);

    expect(people).toEqual([
      {
        userId: BOB,
        net: 1500,
        groups: [
          { id: 1, name: "Group 1", amount: 2500 },
          { id: 2, name: "Group 2", amount: -1000 },
        ],
      },
    ]);
  });

  // Even overall is not the same as nothing to do: settling happens per
  // group, so both balances still need clearing, and the breakdown is what
  // says where.
  test("still lists someone you are even with overall when balances remain underneath", () => {
    const { people, totalOwedToYou, totalYouOwe } = summarizeUserBalances(ME, [
      group(1, [{ from: BOB, to: ME, amount: 1000 }]),
      group(2, [{ from: ME, to: BOB, amount: 1000 }]),
    ]);

    expect(people).toHaveLength(1);
    expect(people[0].net).toBe(0);
    expect(people[0].groups).toHaveLength(2);
    expect(totalOwedToYou).toBe(0);
    expect(totalYouOwe).toBe(0);
  });

  test("ignores debts between two other members", () => {
    const { people } = summarizeUserBalances(ME, [group(1, [{ from: BOB, to: CAROL, amount: 900 }])]);

    expect(people).toEqual([]);
  });

  test("totals over the net per person, so offsetting balances don't inflate both sides", () => {
    const { totalOwedToYou, totalYouOwe } = summarizeUserBalances(ME, [
      group(1, [
        { from: BOB, to: ME, amount: 2500 },
        { from: ME, to: CAROL, amount: 700 },
      ]),
      group(2, [{ from: ME, to: BOB, amount: 1000 }]),
    ]);

    // Bob nets to +1500, Carol to -700.
    expect(totalOwedToYou).toBe(1500);
    expect(totalYouOwe).toBe(700);
  });

  test("puts the largest balances first, whichever direction they run", () => {
    const { people } = summarizeUserBalances(ME, [
      group(1, [
        { from: BOB, to: ME, amount: 300 },
        { from: ME, to: CAROL, amount: 5000 },
      ]),
    ]);

    expect(people.map((p) => p.userId)).toEqual([CAROL, BOB]);
  });

  test("returns empty totals when there are no groups", () => {
    expect(summarizeUserBalances(ME, [])).toEqual({ people: [], totalOwedToYou: 0, totalYouOwe: 0 });
  });
});
