process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  group: { count: jest.fn(), findMany: jest.fn() },
  expense: { count: jest.fn(), aggregate: jest.fn() },
  settlement: { count: jest.fn() },
}));

const app = require("../app");
const prisma = require("../config/prisma");

function tokenFor(userId, tokenVersion = 0) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

const ADMIN_ID = 1;
const ADMIN_AUTH = { Cookie: `session=${tokenFor(ADMIN_ID)}` };
const NON_ADMIN_AUTH = { Cookie: `session=${tokenFor(2)}` };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/admin/stats", () => {
  function mockCounts() {
    prisma.user.count.mockResolvedValueOnce(42).mockResolvedValueOnce(3); // total, then newUsers
    prisma.group.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2); // total, then newGroups
    prisma.expense.count.mockResolvedValue(137);
    prisma.settlement.count.mockResolvedValue(25);
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 456789 } });
    prisma.user.findMany.mockResolvedValue([{ id: 1, name: "Alice", username: "alice1", createdAt: new Date() }]);
    prisma.group.findMany.mockResolvedValue([
      { id: 1, name: "Trip", createdAt: new Date(), _count: { members: 3 } },
    ]);
  }

  test("returns platform-wide stats for an admin", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, isAdmin: true });
    mockCounts();

    const res = await request(app).get("/api/admin/stats").set(ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ users: 42, groups: 10, expenses: 137, settlements: 25 });
    expect(res.body.totalExpenseAmount).toBe(456789);
    expect(res.body.newUsers).toBe(3);
    expect(res.body.newGroups).toBe(2);
    expect(res.body.recentUsers).toHaveLength(1);
    expect(res.body.recentGroups).toEqual([
      expect.objectContaining({ id: 1, name: "Trip", memberCount: 3 }),
    ]);
  });

  // Every query demo data could inflate or crowd out has to exclude it -
  // one click of "Try the demo" would otherwise count as real growth and
  // could bump a genuine recent signup off the bottom of the list.
  test("excludes demo users/groups (and their expenses/settlements) from every query", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, isAdmin: true });
    mockCounts();

    await request(app).get("/api/admin/stats").set(ADMIN_AUTH);

    expect(prisma.user.count).toHaveBeenNthCalledWith(1, { where: { isDemo: false } });
    expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
      where: { isDemo: false, createdAt: { gte: expect.any(Date) } },
    });
    expect(prisma.group.count).toHaveBeenNthCalledWith(1, { where: { isDemo: false } });
    expect(prisma.group.count).toHaveBeenNthCalledWith(2, {
      where: { isDemo: false, createdAt: { gte: expect.any(Date) } },
    });
    expect(prisma.expense.count).toHaveBeenCalledWith({ where: { group: { isDemo: false } } });
    expect(prisma.settlement.count).toHaveBeenCalledWith({ where: { group: { isDemo: false } } });
    expect(prisma.expense.aggregate).toHaveBeenCalledWith({
      where: { group: { isDemo: false } },
      _sum: { amount: true },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isDemo: false } }));
    expect(prisma.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isDemo: false } }));
  });

  test("rejects a non-admin with 403", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, isAdmin: false });

    const res = await request(app).get("/api/admin/stats").set(NON_ADMIN_AUTH);

    expect(res.status).toBe(403);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  test("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/admin/stats");
    expect(res.status).toBe(401);
  });

  test("reports zero spend rather than null when there are no expenses yet", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, isAdmin: true });
    prisma.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.group.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.expense.count.mockResolvedValue(0);
    prisma.settlement.count.mockResolvedValue(0);
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.user.findMany.mockResolvedValue([]);
    prisma.group.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/admin/stats").set(ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.totalExpenseAmount).toBe(0);
  });
});
