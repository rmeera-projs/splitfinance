process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn(), findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  settlement: { create: jest.fn() },
}));

const app = require("../app");
const prisma = require("../config/prisma");

// tokenVersion defaults to 0, matching the requireAuth mock default set in
// beforeEach below.
function tokenFor(userId, tokenVersion = 0) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const OTHER_USER_ID = 2;
const AUTH = { Authorization: `Bearer ${tokenFor(USER_ID)}` };

beforeEach(() => {
  jest.clearAllMocks();
  // requireAuth's tokenVersion check (middleware/auth.js) - every
  // authenticated request in this file goes through it now.
  prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
  // Default membership for assertGroupMembers's toUser check - both users
  // belong to the group, so only the BOLA test needs to override it.
  prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }, { userId: OTHER_USER_ID }]);
});

describe("POST /api/settlements", () => {
  const validBody = { groupId: 10, toUser: OTHER_USER_ID, amount: 25 };

  test("records a settlement with the requester as fromUser", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.settlement.create.mockResolvedValue({ id: 1, groupId: 10, fromUser: USER_ID, ...validBody });

    const res = await request(app).post("/api/settlements").set(AUTH).send(validBody);

    expect(res.status).toBe(201);
    expect(prisma.settlement.create).toHaveBeenCalledWith({
      data: { groupId: 10, fromUser: USER_ID, toUser: OTHER_USER_ID, amount: 25 },
    });
  });

  test("rejects when the requester is not a member of the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/api/settlements").set(AUTH).send(validBody);

    expect(res.status).toBe(403);
    expect(prisma.settlement.create).not.toHaveBeenCalled();
  });

  // BOLA regression: the requester being a member only proves *they*
  // belong here - toUser is a separate id the request supplies, and
  // Settlement.toUser references the global User table with no DB-level
  // constraint tying it to this group's membership.
  test("rejects a toUser who isn't a member of the group, even though they're a real user", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    // OTHER_USER_ID is a real, registered user - just not in this group.
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app).post("/api/settlements").set(AUTH).send(validBody);

    expect(res.status).toBe(400);
    expect(prisma.settlement.create).not.toHaveBeenCalled();
  });

  test("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/settlements").send(validBody);
    expect(res.status).toBe(401);
  });
});
