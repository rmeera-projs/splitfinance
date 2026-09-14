jest.mock("../config/prisma", () => ({
  groupMember: { findMany: jest.fn() },
}));

const prisma = require("../config/prisma");
const { assertGroupMembers } = require("./assertGroupMembers");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("assertGroupMembers", () => {
  test("resolves without throwing when every id belongs to the group", async () => {
    prisma.groupMember.findMany.mockResolvedValue([{ userId: 1 }, { userId: 2 }, { userId: 3 }]);

    await expect(
      assertGroupMembers(10, { paidBy: [1], "splits[].userId": [1, 2, 3] })
    ).resolves.toBeUndefined();
  });

  test("throws naming the field when an id isn't a member of the group", async () => {
    prisma.groupMember.findMany.mockResolvedValue([{ userId: 1 }, { userId: 2 }]);

    // userId 99 is a real, registered user - just not in this group.
    await expect(assertGroupMembers(10, { paidBy: [99] })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("paidBy"),
    });
  });

  test("checks every field, not just the first", async () => {
    prisma.groupMember.findMany.mockResolvedValue([{ userId: 1 }]);

    await expect(assertGroupMembers(10, { paidBy: [1], toUser: [99] })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("toUser"),
    });
  });

  test("checks every id in a multi-id field, not just the first", async () => {
    prisma.groupMember.findMany.mockResolvedValue([{ userId: 1 }, { userId: 2 }]);

    await expect(assertGroupMembers(10, { "splits[].userId": [1, 2, 99] })).rejects.toMatchObject({
      status: 400,
    });
  });
});
