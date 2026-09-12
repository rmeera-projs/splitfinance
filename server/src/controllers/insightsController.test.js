process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  expenseSplit: { findMany: jest.fn() },
}));

const app = require("../app");
const prisma = require("../config/prisma");

function tokenFor(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const AUTH = { Authorization: `Bearer ${tokenFor(USER_ID)}` };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/insights", () => {
  test("flattens the user's own split shares across every group into one list", async () => {
    prisma.expenseSplit.findMany.mockResolvedValue([
      {
        amountOwed: "10.00",
        expense: {
          category: "Food & Drink",
          date: "2026-09-01T00:00:00.000Z",
          groupId: 1,
          group: { name: "Roommates" },
        },
      },
      {
        amountOwed: "25.50",
        expense: {
          category: "Travel",
          date: "2026-09-05T00:00:00.000Z",
          groupId: 2,
          group: { name: "Ski Trip" },
        },
      },
    ]);

    const res = await request(app).get("/api/insights").set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { amount: 10, category: "Food & Drink", date: "2026-09-01T00:00:00.000Z", groupId: 1, groupName: "Roommates" },
      { amount: 25.5, category: "Travel", date: "2026-09-05T00:00:00.000Z", groupId: 2, groupName: "Ski Trip" },
    ]);
    expect(prisma.expenseSplit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  test("returns an empty list for a user with no expenses anywhere", async () => {
    prisma.expenseSplit.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/insights").set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  test("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/insights");
    expect(res.status).toBe(401);
  });
});
