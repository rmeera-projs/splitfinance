process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn(), findMany: jest.fn() },
  group: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  expense: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("../services/categorizationService", () => {
  // Keep the real CATEGORIES/FALLBACK_CATEGORY (expenseController builds a
  // zod enum from CATEGORIES at module load time, so it cannot be
  // undefined) and only mock the network-calling categorizeExpense function.
  const actual = jest.requireActual("../services/categorizationService");
  return { ...actual, categorizeExpense: jest.fn() };
});

jest.mock("../services/expenseParsingService", () => ({ parseExpenseText: jest.fn() }));

const app = require("../app");
const prisma = require("../config/prisma");
const { categorizeExpense } = require("../services/categorizationService");
const { parseExpenseText } = require("../services/expenseParsingService");

// tokenVersion defaults to 0, matching the requireAuth mock default set in
// beforeEach below.
function tokenFor(userId, tokenVersion = 0) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const OTHER_USER_ID = 2;
const THIRD_USER_ID = 3;
const AUTH = { Cookie: `session=${tokenFor(USER_ID)}` };

beforeEach(() => {
  jest.clearAllMocks();
  // requireAuth's tokenVersion check (middleware/auth.js) - every
  // authenticated request in this file goes through it now.
  prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
  // Most tests don't care about group finalization; default to "not
  // finalized" so only the tests that specifically exercise that behavior
  // need to override it.
  prisma.group.findUnique.mockResolvedValue({ isFinalized: false });
  // Default membership for assertGroupMembers (paidBy/split-participant
  // validation) - USER_ID and OTHER_USER_ID both belong to the group, so
  // only the tests specifically exercising that check need to override it.
  prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }, { userId: OTHER_USER_ID }]);
});

describe("POST /api/expenses", () => {
  const validBody = {
    groupId: 10,
    paidBy: USER_ID,
    amount: 2000,
    description: "Dinner at Chipotle",
    splits: [{ userId: USER_ID, amountOwed: 2000 }],
  };

  test("creates the expense with the category from categorizeExpense", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    categorizeExpense.mockResolvedValue("Food & Drink");
    prisma.expense.create.mockResolvedValue({ id: 1, ...validBody, category: "Food & Drink" });

    const res = await request(app).post("/api/expenses").set(AUTH).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.category).toBe("Food & Drink");
    expect(categorizeExpense).toHaveBeenCalledWith("Dinner at Chipotle");
    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Food & Drink" }) })
    );
  });

  // Security-review regression: another group member only needs to see who
  // paid (name/username), not their email or account-creation date.
  test("never selects email/createdAt for the nested payer", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    categorizeExpense.mockResolvedValue("Food & Drink");
    prisma.expense.create.mockResolvedValue({ id: 1, ...validBody, category: "Food & Drink" });

    await request(app).post("/api/expenses").set(AUTH).send(validBody);

    const selectedFields = prisma.expense.create.mock.calls[0][0].include.payer.select;
    expect(selectedFields).toEqual({ id: true, name: true, username: true });
  });

  test("rejects when the caller is not a member of the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/api/expenses").set(AUTH).send(validBody);

    expect(res.status).toBe(403);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  test("rejects when splits don't sum to the total amount", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app)
      .post("/api/expenses")
      .set(AUTH)
      .send({ ...validBody, splits: [{ userId: USER_ID, amountOwed: 500 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  // Amounts used to be float dollars compared with a 0.01 tolerance, which
  // meant splits that were off by exactly a cent sailed through on every
  // expense. In integer cents the comparison is exact.
  test("rejects splits that are off by a single cent", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app)
      .post("/api/expenses")
      .set(AUTH)
      .send({ ...validBody, splits: [{ userId: USER_ID, amountOwed: 1999 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  test("accepts a three-way split whose parts can't be equal", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.groupMember.findMany.mockResolvedValue([
      { userId: USER_ID },
      { userId: OTHER_USER_ID },
      { userId: THIRD_USER_ID },
    ]);
    prisma.expense.create.mockResolvedValue({ id: 1 });

    // $60.50 three ways is 2016.666... cents each - the odd 2 cents have to
    // land somewhere, and the total must still reconcile exactly.
    const res = await request(app)
      .post("/api/expenses")
      .set(AUTH)
      .send({
        ...validBody,
        amount: 6050,
        splits: [
          { userId: USER_ID, amountOwed: 2017 },
          { userId: OTHER_USER_ID, amountOwed: 2017 },
          { userId: THIRD_USER_ID, amountOwed: 2016 },
        ],
      });

    expect(res.status).toBe(201);
  });

  test("rejects a fractional amount, since amounts are whole cents", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app)
      .post("/api/expenses")
      .set(AUTH)
      .send({ ...validBody, amount: 20.5, splits: [{ userId: USER_ID, amountOwed: 20.5 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  // Above INTEGER's range the database would raise an out-of-range error,
  // which would surface as a 500 rather than a client error.
  test("rejects an amount beyond what the column can hold", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app)
      .post("/api/expenses")
      .set(AUTH)
      .send({
        ...validBody,
        amount: 2147483648,
        splits: [{ userId: USER_ID, amountOwed: 2147483648 }],
      });

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  test("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/expenses").send(validBody);
    expect(res.status).toBe(401);
  });

  // BOLA regression: the requester being a group member only proves *they*
  // belong here - paidBy is a separate user id the request supplies, and
  // Expense.paidBy references the global User table with no DB-level
  // constraint tying it to this group's membership.
  test("rejects a paidBy that isn't a member of the group, even though they're a real user", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    // OTHER_USER_ID is a real, registered user - just not in this group.
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .post("/api/expenses")
      .set(AUTH)
      .send({ ...validBody, paidBy: OTHER_USER_ID, splits: [{ userId: USER_ID, amountOwed: 2000 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  test("rejects a split participant who isn't a member of the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .post("/api/expenses")
      .set(AUTH)
      .send({ ...validBody, splits: [{ userId: OTHER_USER_ID, amountOwed: 2000 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  test("rejects adding an expense to a finalized group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique.mockResolvedValue({ isFinalized: true });

    const res = await request(app).post("/api/expenses").set(AUTH).send(validBody);

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/expenses/:id", () => {
  const validBody = {
    paidBy: USER_ID,
    amount: 3500,
    description: "Dinner at Chipotle",
    splits: [{ userId: USER_ID, amountOwed: 3500 }],
  };

  test("keeps the existing category and skips re-categorization when the description is unchanged", async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 5,
      paidBy: USER_ID,
      description: "Dinner at Chipotle",
      category: "Food & Drink",
    });
    prisma.expense.update.mockResolvedValue({ id: 5, ...validBody, category: "Food & Drink" });

    const res = await request(app).patch("/api/expenses/5").set(AUTH).send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("Food & Drink");
    expect(categorizeExpense).not.toHaveBeenCalled();
    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Food & Drink" }) })
    );
  });

  test("re-categorizes when the description changes", async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 5,
      paidBy: USER_ID,
      description: "Dinner at Chipotle",
      category: "Food & Drink",
    });
    categorizeExpense.mockResolvedValue("Transportation");
    const newBody = { ...validBody, description: "Uber ride to the airport" };
    prisma.expense.update.mockResolvedValue({ id: 5, ...newBody, category: "Transportation" });

    const res = await request(app).patch("/api/expenses/5").set(AUTH).send(newBody);

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("Transportation");
    expect(categorizeExpense).toHaveBeenCalledWith("Uber ride to the airport");
  });

  test("rejects an edit from someone other than the payer", async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 5,
      paidBy: OTHER_USER_ID,
      description: "Dinner at Chipotle",
      category: "Food & Drink",
    });

    const res = await request(app).patch("/api/expenses/5").set(AUTH).send(validBody);

    expect(res.status).toBe(403);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  test("404s for an expense that doesn't exist", async () => {
    prisma.expense.findUnique.mockResolvedValue(null);

    const res = await request(app).patch("/api/expenses/999").set(AUTH).send(validBody);

    expect(res.status).toBe(404);
  });

  // BOLA regression - same reasoning as the create-expense tests: paidBy
  // and split participants are separate user ids the edit request
  // supplies, not implied by the payer-only authorization check above.
  test("rejects reassigning paidBy to someone who isn't a member of the group", async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 5,
      groupId: 10,
      paidBy: USER_ID,
      description: "Dinner at Chipotle",
      category: "Food & Drink",
    });
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .patch("/api/expenses/5")
      .set(AUTH)
      .send({ ...validBody, paidBy: OTHER_USER_ID, splits: [{ userId: USER_ID, amountOwed: 3500 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  test("rejects a split participant who isn't a member of the group", async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 5,
      groupId: 10,
      paidBy: USER_ID,
      description: "Dinner at Chipotle",
      category: "Food & Drink",
    });
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .patch("/api/expenses/5")
      .set(AUTH)
      .send({ ...validBody, splits: [{ userId: OTHER_USER_ID, amountOwed: 3500 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  test("rejects when the edited splits don't sum to the edited amount", async () => {
    const res = await request(app)
      .patch("/api/expenses/5")
      .set(AUTH)
      .send({ ...validBody, splits: [{ userId: USER_ID, amountOwed: 100 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.findUnique).not.toHaveBeenCalled();
  });

  test("rejects editing an expense in a finalized group", async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 5,
      groupId: 10,
      paidBy: USER_ID,
      description: "Dinner at Chipotle",
      category: "Food & Drink",
    });
    prisma.group.findUnique.mockResolvedValue({ isFinalized: true });

    const res = await request(app).patch("/api/expenses/5").set(AUTH).send(validBody);

    expect(res.status).toBe(400);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/expenses/:id", () => {
  test("deletes when the caller is the payer", async () => {
    prisma.expense.findUnique.mockResolvedValue({ id: 5, paidBy: USER_ID });

    const res = await request(app).delete("/api/expenses/5").set(AUTH);

    expect(res.status).toBe(204);
    expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  test("rejects a delete from someone other than the payer", async () => {
    prisma.expense.findUnique.mockResolvedValue({ id: 5, paidBy: OTHER_USER_ID });

    const res = await request(app).delete("/api/expenses/5").set(AUTH);

    expect(res.status).toBe(403);
    expect(prisma.expense.delete).not.toHaveBeenCalled();
  });

  test("404s for an expense that doesn't exist", async () => {
    prisma.expense.findUnique.mockResolvedValue(null);

    const res = await request(app).delete("/api/expenses/999").set(AUTH);

    expect(res.status).toBe(404);
  });

  test("rejects deleting an expense in a finalized group", async () => {
    prisma.expense.findUnique.mockResolvedValue({ id: 5, groupId: 10, paidBy: USER_ID });
    prisma.group.findUnique.mockResolvedValue({ isFinalized: true });

    const res = await request(app).delete("/api/expenses/5").set(AUTH);

    expect(res.status).toBe(400);
    expect(prisma.expense.delete).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/expenses/:id/category", () => {
  test("lets any group member override the category, not just the payer", async () => {
    prisma.expense.findUnique.mockResolvedValue({ id: 5, groupId: 10, paidBy: OTHER_USER_ID, category: "Other" });
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.expense.update.mockResolvedValue({ id: 5, category: "Groceries" });

    const res = await request(app)
      .patch("/api/expenses/5/category")
      .set(AUTH)
      .send({ category: "Groceries" });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("Groceries");
    expect(prisma.expense.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { category: "Groceries" },
      include: expect.anything(),
    });
  });

  test("rejects a category outside the fixed list", async () => {
    prisma.expense.findUnique.mockResolvedValue({ id: 5, groupId: 10, paidBy: USER_ID, category: "Other" });
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app)
      .patch("/api/expenses/5/category")
      .set(AUTH)
      .send({ category: "Made Up Category" });

    expect(res.status).toBe(400);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  test("rejects a caller who is not a member of the expense's group", async () => {
    prisma.expense.findUnique.mockResolvedValue({ id: 5, groupId: 10, paidBy: OTHER_USER_ID, category: "Other" });
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/expenses/5/category")
      .set(AUTH)
      .send({ category: "Groceries" });

    expect(res.status).toBe(403);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  test("404s for an expense that doesn't exist", async () => {
    prisma.expense.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/expenses/999/category")
      .set(AUTH)
      .send({ category: "Groceries" });

    expect(res.status).toBe(404);
  });

  test("is allowed even when the group is finalized (unlike edit/delete)", async () => {
    prisma.expense.findUnique.mockResolvedValue({ id: 5, groupId: 10, paidBy: OTHER_USER_ID, category: "Other" });
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.expense.update.mockResolvedValue({ id: 5, category: "Groceries" });
    // Prove finalized-ness is never even consulted for this endpoint.
    prisma.group.findUnique.mockResolvedValue({ isFinalized: true });

    const res = await request(app)
      .patch("/api/expenses/5/category")
      .set(AUTH)
      .send({ category: "Groceries" });

    expect(res.status).toBe(200);
    expect(prisma.group.findUnique).not.toHaveBeenCalled();
  });
});

describe("GET /api/expenses/categories", () => {
  test("returns the fixed category list", async () => {
    const res = await request(app).get("/api/expenses/categories").set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(expect.arrayContaining(["Food & Drink", "Other"]));
    expect(res.body.categories.length).toBeGreaterThan(1);
  });
});

describe("POST /api/expenses/parse", () => {
  test("returns the parsed suggestion for a member of the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.groupMember.findMany.mockResolvedValue([
      { user: { id: USER_ID, name: "Alice" } },
      { user: { id: OTHER_USER_ID, name: "Bob" } },
    ]);
    parseExpenseText.mockResolvedValue({ description: "Dinner", amount: 6000, payerId: OTHER_USER_ID, splitWithIds: null });

    const res = await request(app)
      .post("/api/expenses/parse")
      .set(AUTH)
      .send({ groupId: 10, text: "Dinner $60, Bob paid" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ description: "Dinner", amount: 6000, payerId: OTHER_USER_ID, splitWithIds: null });
    expect(parseExpenseText).toHaveBeenCalledWith(
      "Dinner $60, Bob paid",
      [
        { id: USER_ID, name: "Alice" },
        { id: OTHER_USER_ID, name: "Bob" },
      ],
      USER_ID
    );
  });

  test("rejects a non-member of the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/api/expenses/parse").set(AUTH).send({ groupId: 10, text: "Dinner $60" });

    expect(res.status).toBe(403);
    expect(parseExpenseText).not.toHaveBeenCalled();
  });

  test("responds with 422 when the sentence can't be understood at all", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.groupMember.findMany.mockResolvedValue([{ user: { id: USER_ID, name: "Alice" } }]);
    parseExpenseText.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/expenses/parse")
      .set(AUTH)
      .send({ groupId: 10, text: "dinner with friends" });

    expect(res.status).toBe(422);
  });

  test("rejects an empty sentence", async () => {
    const res = await request(app).post("/api/expenses/parse").set(AUTH).send({ groupId: 10, text: "" });

    expect(res.status).toBe(400);
    expect(prisma.groupMember.findUnique).not.toHaveBeenCalled();
  });
});
