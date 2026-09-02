const { categorizeExpense, CATEGORIES, FALLBACK_CATEGORY } = require("./categorizationService");

// A minimal stand-in for CohereClient - only the `chat` method is used by
// the service, so that's all we need to mock.
function mockClient(chatImpl) {
  return { chat: jest.fn(chatImpl) };
}

describe("categorizeExpense", () => {
  test("returns the category from a clean Cohere response", async () => {
    const client = mockClient(async () => ({ text: "Groceries" }));

    const category = await categorizeExpense("Whole Foods run", { client });

    expect(category).toBe("Groceries");
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  test("sends a few-shot prompt containing the description and the fixed category list", async () => {
    const client = mockClient(async () => ({ text: "Travel" }));

    await categorizeExpense("Flight to Denver", { client });

    const [callArgs] = client.chat.mock.calls[0];
    expect(callArgs.message).toContain("Flight to Denver");
    for (const category of CATEGORIES) {
      expect(callArgs.message).toContain(category);
    }
  });

  test("trims whitespace/punctuation and matches case-insensitively", async () => {
    const client = mockClient(async () => ({ text: '  "entertainment".\n' }));

    const category = await categorizeExpense("Concert tickets", { client });

    expect(category).toBe("Entertainment");
  });

  test("falls back to 'Other' when Cohere returns a category outside the fixed list", async () => {
    const client = mockClient(async () => ({ text: "Miscellaneous Fun Stuff" }));

    const category = await categorizeExpense("Arcade tokens", { client });

    expect(category).toBe(FALLBACK_CATEGORY);
  });

  test("falls back to 'Other' when Cohere returns an empty response", async () => {
    const client = mockClient(async () => ({ text: "" }));

    const category = await categorizeExpense("Something odd", { client });

    expect(category).toBe(FALLBACK_CATEGORY);
  });

  test("falls back to 'Other' when the Cohere call throws", async () => {
    const client = mockClient(async () => {
      throw new Error("Cohere API is down");
    });

    const category = await categorizeExpense("Dinner with friends", { client });

    expect(category).toBe(FALLBACK_CATEGORY);
  });

  test("falls back to 'Other' without calling the client for an empty description", async () => {
    const client = mockClient(async () => ({ text: "Food & Drink" }));

    const category = await categorizeExpense("   ", { client });

    expect(category).toBe(FALLBACK_CATEGORY);
    expect(client.chat).not.toHaveBeenCalled();
  });

  test("falls back to 'Other' when no client is available (e.g. missing API key)", async () => {
    const originalKey = process.env.COHERE_API_KEY;
    delete process.env.COHERE_API_KEY;

    try {
      const category = await categorizeExpense("Taxi ride");
      expect(category).toBe(FALLBACK_CATEGORY);
    } finally {
      if (originalKey === undefined) delete process.env.COHERE_API_KEY;
      else process.env.COHERE_API_KEY = originalKey;
    }
  });
});
