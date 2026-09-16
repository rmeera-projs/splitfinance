process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  expenseSplit: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
}));

const app = require("../app");
const prisma = require("../config/prisma");

// tokenVersion defaults to 0, matching the requireAuth mock default set in
// beforeEach below.
function tokenFor(userId, tokenVersion = 0) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const AUTH = { Cookie: `session=${tokenFor(USER_ID)}` };

beforeEach(() => {
  jest.clearAllMocks();
  // requireAuth's tokenVersion check (middleware/auth.js) - every
  // authenticated request in this file goes through it now.
  prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
});

describe("GET /api/insights", () => {
  test("flattens the user's own split shares across every group into one list", async () => {
    prisma.expenseSplit.findMany.mockResolvedValue([
      {
        amountOwed: 1000,
        expense: {
          category: "Food & Drink",
          date: "2026-09-01T00:00:00.000Z",
          groupId: 1,
          group: { name: "Roommates" },
        },
      },
      {
        amountOwed: 2550,
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
      { amount: 1000, category: "Food & Drink", date: "2026-09-01T00:00:00.000Z", groupId: 1, groupName: "Roommates" },
      { amount: 2550, category: "Travel", date: "2026-09-05T00:00:00.000Z", groupId: 2, groupName: "Ski Trip" },
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
