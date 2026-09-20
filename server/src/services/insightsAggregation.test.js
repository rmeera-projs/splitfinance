const { aggregateByCategory } = require("./insightsAggregation");

describe("aggregateByCategory", () => {
  test("sums amounts per category, sorted largest first", () => {
    const result = aggregateByCategory([
      { amount: 500, category: "Travel" },
      { amount: 1000, category: "Food & Drink" },
      { amount: 300, category: "Food & Drink" },
    ]);

    expect(result).toEqual([
      { category: "Food & Drink", totalCents: 1300 },
      { category: "Travel", totalCents: 500 },
    ]);
  });

  test("buckets a missing category under Other", () => {
    const result = aggregateByCategory([{ amount: 100, category: null }]);
    expect(result).toEqual([{ category: "Other", totalCents: 100 }]);
  });
});
