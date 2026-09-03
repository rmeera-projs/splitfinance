process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn() },
  group: { update: jest.fn() },
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
