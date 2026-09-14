process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
  group: { update: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  user: { findMany: jest.fn(), findUnique: jest.fn() },
}));

jest.mock("../services/balanceService", () => ({ getGroupBalances: jest.fn() }));

const app = require("../app");
const prisma = require("../config/prisma");
const { getGroupBalances } = require("../services/balanceService");

// tokenVersion defaults to 0, matching the requireAuth mock default set in
// beforeEach below - only tests that specifically exercise requireAuth's
// tokenVersion check (none in this file; see middleware/auth.test.js) need
// to pass a different value.
function tokenFor(userId, tokenVersion = 0) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const AUTH = { Authorization: `Bearer ${tokenFor(USER_ID)}` };

beforeEach(() => {
  jest.clearAllMocks();
  // requireAuth's tokenVersion check (middleware/auth.js) - every
  // authenticated request in this file goes through it now.
  prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
});

describe("PATCH /api/groups/:id/finalize", () => {
  test("finalizes the group for any member (not just the owner)", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.update.mockResolvedValue({ id: 10, isFinalized: true });

    const res = await request(app).patch("/api/groups/10/finalize").set(AUTH).send({ finalized: true });

    expect(res.status).toBe(200);
    expect(res.body.isFinalized).toBe(true);
    expect(prisma.group.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isFinalized: true },
    });
  });

  test("reopens (unfinalizes) the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.update.mockResolvedValue({ id: 10, isFinalized: false });

    const res = await request(app).patch("/api/groups/10/finalize").set(AUTH).send({ finalized: false });

    expect(res.status).toBe(200);
    expect(res.body.isFinalized).toBe(false);
  });

  test("rejects a non-member", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const res = await request(app).patch("/api/groups/10/finalize").set(AUTH).send({ finalized: true });

    expect(res.status).toBe(403);
    expect(prisma.group.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/groups", () => {
  test("resolves invited members by email or username in one call", async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 2, email: "b@x.com", username: "bob" },
      { id: 3, email: "carol@x.com", username: "carol123" },
    ]);
    prisma.group.create.mockResolvedValue({ id: 10, name: "Trip", members: [] });

    const res = await request(app)
      .post("/api/groups")
      .set(AUTH)
      .send({ name: "Trip", memberIdentifiers: ["b@x.com", "carol123"] });

    expect(res.status).toBe(201);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { OR: [{ email: { in: ["b@x.com", "carol123"] } }, { username: { in: ["b@x.com", "carol123"] } }] },
    });
    expect(res.body.unmatchedIdentifiers).toEqual([]);
  });

  // Security-review regression: a group member only needs to see who's in
  // the group (name/username), not their email or account-creation date -
  // exposing that turns every member row into a PII leak, worse once
  // combined with a user id that isn't actually theirs to see.
  test("never selects email/createdAt for nested member users", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.group.create.mockResolvedValue({ id: 10, name: "Trip", members: [] });

    await request(app).post("/api/groups").set(AUTH).send({ name: "Trip" });

    const selectedFields = prisma.group.create.mock.calls[0][0].include.members.include.user.select;
    expect(selectedFields).toEqual({ id: true, name: true, username: true });
  });

  test("reports an identifier that doesn't match any registered user's email or username", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.group.create.mockResolvedValue({ id: 10, name: "Trip", members: [] });

    const res = await request(app)
      .post("/api/groups")
      .set(AUTH)
      .send({ name: "Trip", memberIdentifiers: ["nobody"] });

    expect(res.status).toBe(201);
    expect(res.body.unmatchedIdentifiers).toEqual(["nobody"]);
  });
});

describe("POST /api/groups/:id/members", () => {
  test("adds a new member by email", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique
      .mockResolvedValueOnce({ isFinalized: false }) // assertGroupNotFinalized
      .mockResolvedValueOnce({ id: 10, name: "Trip", members: [] }); // final refetch
    prisma.user.findMany.mockResolvedValue([{ id: 2, email: "b@x.com", username: "bob" }]);
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberIdentifiers: ["b@x.com"] });

    expect(res.status).toBe(200);
    expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
      data: [{ groupId: 10, userId: 2 }],
    });
    expect(res.body.unmatchedIdentifiers).toEqual([]);
  });

  test("adds a new member by username instead of email", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique
      .mockResolvedValueOnce({ isFinalized: false })
      .mockResolvedValueOnce({ id: 10, name: "Trip", members: [] });
    prisma.user.findMany.mockResolvedValue([{ id: 2, email: "b@x.com", username: "bob" }]);
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberIdentifiers: ["bob"] });

    expect(res.status).toBe(200);
    expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
      data: [{ groupId: 10, userId: 2 }],
    });
    expect(res.body.unmatchedIdentifiers).toEqual([]);
  });

  test("reports identifiers that don't match a registered user", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique
      .mockResolvedValueOnce({ isFinalized: false })
      .mockResolvedValueOnce({ id: 10, name: "Trip", members: [] });
    prisma.user.findMany.mockResolvedValue([]); // nobody registered with that email/username
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberIdentifiers: ["nobody@x.com"] });

    expect(res.status).toBe(200);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    expect(res.body.unmatchedIdentifiers).toEqual(["nobody@x.com"]);
  });

  test("skips a user who is already a member instead of erroring", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique
      .mockResolvedValueOnce({ isFinalized: false })
      .mockResolvedValueOnce({ id: 10, name: "Trip", members: [] });
    prisma.user.findMany.mockResolvedValue([{ id: 2, email: "already@x.com", username: "already" }]);
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }, { userId: 2 }]);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberIdentifiers: ["already@x.com"] });

    expect(res.status).toBe(200);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    expect(res.body.unmatchedIdentifiers).toEqual([]); // matched a real user, just already in the group
  });

  test("rejects a non-member of the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberIdentifiers: ["b@x.com"] });

    expect(res.status).toBe(403);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
  });

  test("rejects adding members to a finalized group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique.mockResolvedValueOnce({ isFinalized: true });

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberIdentifiers: ["b@x.com"] });

    expect(res.status).toBe(400);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
  });

  test("rejects an empty memberIdentifiers array", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app).post("/api/groups/10/members").set(AUTH).send({ memberIdentifiers: [] });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/groups/:id", () => {
  const OTHER_USER_ID = 2;

  test("returns the group with balances for a member", async () => {
    prisma.group.findUnique.mockResolvedValue({
      id: 10,
      name: "Trip",
      members: [{ userId: USER_ID, user: { id: USER_ID, name: "Alice", username: "alice1" } }],
      expenses: [],
      settlements: [],
    });
    getGroupBalances.mockResolvedValue([{ from: USER_ID, to: OTHER_USER_ID, amount: 20 }]);

    const res = await request(app).get("/api/groups/10").set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Trip");
    expect(res.body.balances).toEqual([{ from: USER_ID, to: OTHER_USER_ID, amount: 20 }]);
  });

  test("rejects a non-member", async () => {
    prisma.group.findUnique.mockResolvedValue({
      id: 10,
      name: "Trip",
      members: [{ userId: OTHER_USER_ID, user: { id: OTHER_USER_ID, name: "Bob", username: "bob2" } }],
      expenses: [],
      settlements: [],
    });

    const res = await request(app).get("/api/groups/10").set(AUTH);

    expect(res.status).toBe(403);
    expect(getGroupBalances).not.toHaveBeenCalled();
  });

  test("404s for a group that doesn't exist", async () => {
    prisma.group.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/api/groups/999").set(AUTH);

    expect(res.status).toBe(404);
  });

  // Security-review regression: same reasoning as the createGroup test -
  // members and expense payers should only expose name/username to other
  // group members, never email or account-creation date.
  test("never selects email/createdAt for nested member or payer users", async () => {
    prisma.group.findUnique.mockResolvedValue({
      id: 10,
      name: "Trip",
      members: [{ userId: USER_ID, user: { id: USER_ID, name: "Alice", username: "alice1" } }],
      expenses: [],
      settlements: [],
    });
    getGroupBalances.mockResolvedValue([]);

    await request(app).get("/api/groups/10").set(AUTH);

    const call = prisma.group.findUnique.mock.calls[0][0];
    expect(call.include.members.include.user.select).toEqual({ id: true, name: true, username: true });
    expect(call.include.expenses.include.payer.select).toEqual({ id: true, name: true, username: true });
  });
});
