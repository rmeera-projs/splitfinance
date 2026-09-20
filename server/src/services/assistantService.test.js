jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn(), findMany: jest.fn() },
  expense: { findMany: jest.fn() },
  settlement: { findMany: jest.fn() },
  expenseSplit: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
}));

delete process.env.COHERE_API_KEY;

const prisma = require("../config/prisma");
const { askAssistant, TOOL_IMPLEMENTATIONS } = require("./assistantService");

const ME = 1;
const BOB = 2;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("get_my_balances", () => {
  test("resolves names and formats amounts as dollar strings", async () => {
    prisma.groupMember.findMany.mockResolvedValue([{ group: { id: 10, name: "Ski Trip" } }]);
    prisma.expense.findMany.mockResolvedValue([
      { groupId: 10, paidBy: ME, splits: [{ userId: BOB, amountOwed: 1500 }] },
    ]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: BOB, name: "Bob" }]);

    const result = await TOOL_IMPLEMENTATIONS.get_my_balances({}, { userId: ME });

    expect(result).toEqual({
      totalOwedToYouDollars: "15.00",
      totalYouOweDollars: "0.00",
      people: [{ name: "Bob", netDollars: "15.00", groups: [{ groupName: "Ski Trip", amountDollars: "15.00" }] }],
    });
  });
});

describe("get_group_balances", () => {
  test("returns an error instead of throwing when the caller isn't a member", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const result = await TOOL_IMPLEMENTATIONS.get_group_balances({ groupId: 99 }, { userId: ME });

    expect(result).toEqual({ error: "You are not a member of that group" });
    // Never queries the group's actual debts for a group the caller isn't
    // in - the membership check is a hard stop, not just a label on the
    // response.
    expect(prisma.groupMember.findMany).not.toHaveBeenCalled();
  });

  test("rejects a non-integer groupId without touching the database", async () => {
    const result = await TOOL_IMPLEMENTATIONS.get_group_balances({ groupId: "not-a-number" }, { userId: ME });

    expect(result).toEqual({ error: "groupId must be an integer" });
    expect(prisma.groupMember.findUnique).not.toHaveBeenCalled();
  });
});

describe("get_my_spending", () => {
  test("rejects an unrecognized category", async () => {
    const result = await TOOL_IMPLEMENTATIONS.get_my_spending({ category: "Not A Real Category" }, { userId: ME });
    expect(result).toEqual({ error: expect.stringContaining("category must be one of") });
  });

  test("checks membership before scoping to a groupId", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const result = await TOOL_IMPLEMENTATIONS.get_my_spending({ groupId: 5 }, { userId: ME });

    expect(result).toEqual({ error: "You are not a member of that group" });
    expect(prisma.expenseSplit.findMany).not.toHaveBeenCalled();
  });

  test("aggregates by category and totals in dollars", async () => {
    prisma.expenseSplit.findMany.mockResolvedValue([
      { amountOwed: 1000, expense: { category: "Food & Drink" } },
      { amountOwed: 500, expense: { category: "Food & Drink" } },
      { amountOwed: 2000, expense: { category: "Travel" } },
    ]);

    const result = await TOOL_IMPLEMENTATIONS.get_my_spending({}, { userId: ME });

    expect(result).toEqual({
      totalDollars: "35.00",
      byCategory: [
        { category: "Travel", totalDollars: "20.00" },
        { category: "Food & Drink", totalDollars: "15.00" },
      ],
    });
  });
});

describe("askAssistant", () => {
  test("throws a 503 when no Cohere client is configured", async () => {
    await expect(askAssistant(ME, [], "how much do I owe?")).rejects.toMatchObject({ status: 503 });
  });

  test("runs a tool call and returns the model's final text answer", async () => {
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.expense.findMany.mockResolvedValue([]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        finishReason: "TOOL_CALL",
        message: {
          toolPlan: "checking balances",
          toolCalls: [{ id: "call_1", type: "function", function: { name: "get_my_balances", arguments: "{}" } }],
        },
      })
      .mockResolvedValueOnce({
        finishReason: "COMPLETE",
        message: { content: "You're all settled up." },
      });

    const reply = await askAssistant(ME, [], "am I settled up?", { client: { chat } });

    expect(reply).toBe("You're all settled up.");
    expect(chat).toHaveBeenCalledTimes(2);

    // The second call carries the tool's result back to the model.
    const secondCallMessages = chat.mock.calls[1][0].messages;
    const toolMessage = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMessage.toolCallId).toBe("call_1");
    expect(JSON.parse(toolMessage.content)).toMatchObject({ totalOwedToYouDollars: "0.00" });
  });

  test("hands the model an error result instead of crashing when it names an unknown tool", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        finishReason: "TOOL_CALL",
        message: {
          toolCalls: [{ id: "call_1", type: "function", function: { name: "delete_everything", arguments: "{}" } }],
        },
      })
      .mockResolvedValueOnce({ finishReason: "COMPLETE", message: { content: "I can't do that." } });

    const reply = await askAssistant(ME, [], "delete my account", { client: { chat } });

    expect(reply).toBe("I can't do that.");
    const toolMessage = chat.mock.calls[1][0].messages.find((m) => m.role === "tool");
    expect(JSON.parse(toolMessage.content)).toEqual({ error: "Unknown tool: delete_everything" });
  });

  test("stops after MAX_TOOL_ROUNDS rather than looping forever", async () => {
    const chat = jest.fn().mockResolvedValue({
      finishReason: "TOOL_CALL",
      message: {
        toolCalls: [{ id: "call_x", type: "function", function: { name: "list_my_groups", arguments: "{}" } }],
      },
    });
    prisma.groupMember.findMany.mockResolvedValue([]);

    const reply = await askAssistant(ME, [], "keep asking", { client: { chat } });

    expect(reply).toMatch(/taking a bit long/i);
    expect(chat).toHaveBeenCalledTimes(4); // MAX_TOOL_ROUNDS
  });
});
