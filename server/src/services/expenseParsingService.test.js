const { parseExpenseText } = require("./expenseParsingService");

// A minimal stand-in for CohereClient - only the `chat` method is used by
// the service, so that's all we need to mock.
function mockClient(chatImpl) {
  return { chat: jest.fn(chatImpl) };
}

const MEMBERS = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Charlie" },
];
const ALICE_ID = 1;

describe("parseExpenseText", () => {
  test("returns the parsed fields from a clean JSON response", async () => {
    const client = mockClient(async () => ({
      text: '{"description": "Dinner", "amount": 60, "payerId": 2, "splitWithIds": [1, 2, 3]}',
    }));

    const result = await parseExpenseText("Dinner $60, Bob paid, split with everyone", MEMBERS, ALICE_ID, { client });

    expect(result).toEqual({ description: "Dinner", amount: 6000, payerId: 2, splitWithIds: [1, 2, 3] });
  });

  test("includes the member list and marks the current user in the prompt", async () => {
    const client = mockClient(async () => ({ text: '{"description": "Coffee", "amount": 5}' }));

    await parseExpenseText("Coffee $5", MEMBERS, ALICE_ID, { client });

    const [callArgs] = client.chat.mock.calls[0];
    expect(callArgs.message).toContain("id 1: Alice");
    expect(callArgs.message).toContain("current user");
    expect(callArgs.message).toContain("id 2: Bob");
    expect(callArgs.message).toContain("Coffee $5");
  });

  test("strips a markdown code fence around the JSON", async () => {
    const client = mockClient(async () => ({
      text: '```json\n{"description": "Groceries", "amount": 32.5}\n```',
    }));

    const result = await parseExpenseText("Groceries, $32.50", MEMBERS, ALICE_ID, { client });

    expect(result).toEqual({ description: "Groceries", amount: 3250, payerId: null, splitWithIds: null });
  });

  test("drops a hallucinated payerId that isn't an actual group member", async () => {
    const client = mockClient(async () => ({
      text: '{"description": "Rent", "amount": 900, "payerId": 999}',
    }));

    const result = await parseExpenseText("Rent $900", MEMBERS, ALICE_ID, { client });

    expect(result.payerId).toBeNull();
  });

  test("filters out hallucinated ids from splitWithIds but keeps the valid ones", async () => {
    const client = mockClient(async () => ({
      text: '{"description": "Pizza", "amount": 20, "splitWithIds": [1, 999, 2]}',
    }));

    const result = await parseExpenseText("Pizza $20 split between me and Bob", MEMBERS, ALICE_ID, { client });

    expect(result.splitWithIds).toEqual([1, 2]);
  });

  test("falls back to a plain-text guess when the model's amount is missing/invalid", async () => {
    const client = mockClient(async () => ({ text: '{"description": "Something"}' }));

    const result = await parseExpenseText("Something for $25", MEMBERS, ALICE_ID, { client });

    expect(result.amount).toBe(2500);
  });

  test("falls back to a plain-text guess when the response isn't valid JSON", async () => {
    const client = mockClient(async () => ({ text: "Sorry, I can't help with that." }));

    const result = await parseExpenseText("Movie tickets $30", MEMBERS, ALICE_ID, { client });

    expect(result.amount).toBe(3000);
  });

  test("falls back to a plain-text guess when the Cohere call throws", async () => {
    const client = mockClient(async () => {
      throw new Error("Cohere API is down");
    });

    const result = await parseExpenseText("Taxi $18", MEMBERS, ALICE_ID, { client });

    expect(result.amount).toBe(1800);
  });

  test("returns null when there's no amount to find anywhere, even in the fallback", async () => {
    const client = mockClient(async () => ({ text: "not json" }));

    const result = await parseExpenseText("Dinner with friends", MEMBERS, ALICE_ID, { client });

    expect(result).toBeNull();
  });

  test("returns null for empty text without calling the client", async () => {
    const client = mockClient(async () => ({ text: '{"amount": 10}' }));

    const result = await parseExpenseText("   ", MEMBERS, ALICE_ID, { client });

    expect(result).toBeNull();
    expect(client.chat).not.toHaveBeenCalled();
  });

  test("falls back to a heuristic regex parse when no client is available (e.g. missing API key)", async () => {
    const originalKey = process.env.COHERE_API_KEY;
    delete process.env.COHERE_API_KEY;

    try {
      const result = await parseExpenseText("Dinner at Olive Garden $45.50", MEMBERS, ALICE_ID);
      expect(result.amount).toBe(4550);
      expect(result.payerId).toBeNull();
      expect(result.splitWithIds).toBeNull();
    } finally {
      if (originalKey === undefined) delete process.env.COHERE_API_KEY;
      else process.env.COHERE_API_KEY = originalKey;
    }
  });
});
