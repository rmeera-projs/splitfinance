process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn() },
  group: { findUnique: jest.fn() },
  expense: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("../services/categorizationService", () => ({
  categorizeExpense: jest.fn(),
  FALLBACK_CATEGORY: "Other",
}));

const app = require("../app");
const prisma = require("../config/prisma");
const { categorizeExpense } = require("../services/categorizationService");

function tokenFor(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const OTHER_USER_ID = 2;
const AUTH = { Authorization: `Bearer ${tokenFor(USER_ID)}` };

beforeEach(() => {
  jest.clearAllMocks();
  // Most tests don't care about group finalization; default to "not
  // finalized" so only the tests that specifically exercise that behavior
  // need to override it.
  prisma.group.findUnique.mockResolvedValue({ isFinalized: false });
});

describe("POST /api/expenses", () => {
  const validBody = {
    groupId: 10,
    paidBy: USER_ID,
    amount: 20,
    description: "Dinner at Chipotle",
    splits: [{ userId: USER_ID, amountOwed: 20 }],
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
      .send({ ...validBody, splits: [{ userId: USER_ID, amountOwed: 5 }] });

    expect(res.status).toBe(400);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  test("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/expenses").send(validBody);
    expect(res.status).toBe(401);
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
    amount: 35,
    description: "Dinner at Chipotle",
    splits: [{ userId: USER_ID, amountOwed: 35 }],
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

  test("rejects when the edited splits don't sum to the edited amount", async () => {
    const res = await request(app)
      .patch("/api/expenses/5")
      .set(AUTH)
      .send({ ...validBody, splits: [{ userId: USER_ID, amountOwed: 1 }] });

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
