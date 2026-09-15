process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn(), findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  expense: { findMany: jest.fn() },
  settlement: { create: jest.fn(), findMany: jest.fn() },
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
  // Default balance: OTHER_USER_ID paid a $100 expense split evenly, so
  // USER_ID (the requester/fromUser in these tests) owes them $100 -
  // enough headroom for the existing $25 settlement test. Tests that care
  // about a specific balance override these.
  prisma.expense.findMany.mockResolvedValue([
    {
      paidBy: OTHER_USER_ID,
      splits: [{ userId: USER_ID, amountOwed: 100 }],
    },
  ]);
  prisma.settlement.findMany.mockResolvedValue([]);
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

  test("rejects toUser being the same as the requester", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app)
      .post("/api/settlements")
      .set(AUTH)
      .send({ ...validBody, toUser: USER_ID });

    expect(res.status).toBe(400);
    expect(prisma.settlement.create).not.toHaveBeenCalled();
  });

  test("rejects an amount that exceeds the outstanding balance", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    // Default balance from beforeEach is $100 owed - ask for more than that.

    const res = await request(app)
      .post("/api/settlements")
      .set(AUTH)
      .send({ ...validBody, amount: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceed/i);
    expect(prisma.settlement.create).not.toHaveBeenCalled();
  });

  test("allows settling the exact outstanding balance", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.settlement.create.mockResolvedValue({ id: 1, groupId: 10, fromUser: USER_ID, ...validBody, amount: 100 });

    const res = await request(app)
      .post("/api/settlements")
      .set(AUTH)
      .send({ ...validBody, amount: 100 });

    expect(res.status).toBe(201);
    expect(prisma.settlement.create).toHaveBeenCalledWith({
      data: { groupId: 10, fromUser: USER_ID, toUser: OTHER_USER_ID, amount: 100 },
    });
  });

  test("allows a partial settlement toward the outstanding balance", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.settlement.create.mockResolvedValue({ id: 1, groupId: 10, fromUser: USER_ID, ...validBody, amount: 10 });

    const res = await request(app)
      .post("/api/settlements")
      .set(AUTH)
      .send({ ...validBody, amount: 10 });

    expect(res.status).toBe(201);
  });

  test("rejects settling up when nothing is owed in that direction", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    // Nobody owes anybody anything in this group.
    prisma.expense.findMany.mockResolvedValue([]);

    const res = await request(app).post("/api/settlements").set(AUTH).send(validBody);

    expect(res.status).toBe(400);
    expect(prisma.settlement.create).not.toHaveBeenCalled();
  });

  test("rejects settling up when the debt actually runs the other way", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    // USER_ID is the one who paid - OTHER_USER_ID owes USER_ID, not the
    // other way around, so USER_ID "settling up" with OTHER_USER_ID should
    // be rejected rather than silently creating a negative-balance record.
    prisma.expense.findMany.mockResolvedValue([
      { paidBy: USER_ID, splits: [{ userId: OTHER_USER_ID, amountOwed: 100 }] },
    ]);

    const res = await request(app).post("/api/settlements").set(AUTH).send(validBody);

    expect(res.status).toBe(400);
    expect(prisma.settlement.create).not.toHaveBeenCalled();
  });

  test("accounts for prior settlements when computing the remaining balance", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    // $100 owed, $80 already paid back - only $20 remains.
    prisma.settlement.findMany.mockResolvedValue([{ fromUser: USER_ID, toUser: OTHER_USER_ID, amount: 80 }]);

    const overRes = await request(app)
      .post("/api/settlements")
      .set(AUTH)
      .send({ ...validBody, amount: 21 });
    expect(overRes.status).toBe(400);

    prisma.settlement.create.mockResolvedValue({ id: 2, groupId: 10, fromUser: USER_ID, ...validBody, amount: 20 });
    const exactRes = await request(app)
      .post("/api/settlements")
      .set(AUTH)
      .send({ ...validBody, amount: 20 });
    expect(exactRes.status).toBe(201);
  });
});
