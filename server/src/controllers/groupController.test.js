process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
  group: { update: jest.fn(), findUnique: jest.fn() },
  user: { findMany: jest.fn() },
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

describe("POST /api/groups/:id/members", () => {
  test("adds a new member by email", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique
      .mockResolvedValueOnce({ isFinalized: false }) // assertGroupNotFinalized
      .mockResolvedValueOnce({ id: 10, name: "Trip", members: [] }); // final refetch
    prisma.user.findMany.mockResolvedValue([{ id: 2, email: "b@x.com" }]);
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberEmails: ["b@x.com"] });

    expect(res.status).toBe(200);
    expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
      data: [{ groupId: 10, userId: 2 }],
    });
    expect(res.body.unmatchedEmails).toEqual([]);
  });

  test("reports emails that don't match a registered user", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique
      .mockResolvedValueOnce({ isFinalized: false })
      .mockResolvedValueOnce({ id: 10, name: "Trip", members: [] });
    prisma.user.findMany.mockResolvedValue([]); // nobody registered with that email
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberEmails: ["nobody@x.com"] });

    expect(res.status).toBe(200);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    expect(res.body.unmatchedEmails).toEqual(["nobody@x.com"]);
  });

  test("skips a user who is already a member instead of erroring", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique
      .mockResolvedValueOnce({ isFinalized: false })
      .mockResolvedValueOnce({ id: 10, name: "Trip", members: [] });
    prisma.user.findMany.mockResolvedValue([{ id: 2, email: "already@x.com" }]);
    prisma.groupMember.findMany.mockResolvedValue([{ userId: USER_ID }, { userId: 2 }]);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberEmails: ["already@x.com"] });

    expect(res.status).toBe(200);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    expect(res.body.unmatchedEmails).toEqual([]); // matched a real user, just already in the group
  });

  test("rejects a non-member of the group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberEmails: ["b@x.com"] });

    expect(res.status).toBe(403);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
  });

  test("rejects adding members to a finalized group", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });
    prisma.group.findUnique.mockResolvedValueOnce({ isFinalized: true });

    const res = await request(app)
      .post("/api/groups/10/members")
      .set(AUTH)
      .send({ memberEmails: ["b@x.com"] });

    expect(res.status).toBe(400);
    expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
  });

  test("rejects an empty memberEmails array", async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: USER_ID });

    const res = await request(app).post("/api/groups/10/members").set(AUTH).send({ memberEmails: [] });

    expect(res.status).toBe(400);
  });
});
