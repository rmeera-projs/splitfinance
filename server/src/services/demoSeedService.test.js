jest.mock("../config/prisma", () => ({
  group: { findMany: jest.fn(), deleteMany: jest.fn() },
  user: { create: jest.fn(), deleteMany: jest.fn() },
  expense: { deleteMany: jest.fn() },
  expenseSplit: { deleteMany: jest.fn() },
  settlement: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
}));

const prisma = require("../config/prisma");
const { createDemoAccount, cleanupExpiredDemoAccounts } = require("./demoSeedService");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.group.findMany.mockResolvedValue([]);
});

describe("cleanupExpiredDemoAccounts", () => {
  test("deletes children before the group, then expired users, all scoped to isDemo", async () => {
    prisma.group.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    const order = [];
    for (const [name, mock] of [
      ["expenseSplit", prisma.expenseSplit.deleteMany],
      ["expense", prisma.expense.deleteMany],
      ["settlement", prisma.settlement.deleteMany],
      ["group", prisma.group.deleteMany],
      ["user", prisma.user.deleteMany],
    ]) {
      mock.mockImplementation(() => {
        order.push(name);
        return Promise.resolve({ count: 0 });
      });
    }

    await cleanupExpiredDemoAccounts();

    expect(prisma.group.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isDemo: true }) })
    );
    expect(prisma.expenseSplit.deleteMany).toHaveBeenCalledWith({
      where: { expense: { groupId: { in: [10, 11] } } },
    });
    expect(prisma.expense.deleteMany).toHaveBeenCalledWith({ where: { groupId: { in: [10, 11] } } });
    expect(prisma.settlement.deleteMany).toHaveBeenCalledWith({ where: { groupId: { in: [10, 11] } } });
    expect(prisma.group.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [10, 11] } } });
    expect(prisma.user.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isDemo: true }) })
    );
    // Children (splits, expenses, settlements) and the group they belong to
    // must all go before the users deleteMany - Group.owner/Expense.payer/
    // ExpenseSplit.user/Settlement.from/to are Restrict, not Cascade.
    expect(order).toEqual(["expenseSplit", "expense", "settlement", "group", "user"]);
  });

  test("still sweeps expired users when there are no expired groups", async () => {
    prisma.group.findMany.mockResolvedValue([]);

    await cleanupExpiredDemoAccounts();

    expect(prisma.expenseSplit.deleteMany).not.toHaveBeenCalled();
    expect(prisma.expense.deleteMany).not.toHaveBeenCalled();
    expect(prisma.settlement.deleteMany).not.toHaveBeenCalled();
    expect(prisma.group.deleteMany).not.toHaveBeenCalled();
    // Co-members never own a group, so they're only ever reached here.
    expect(prisma.user.deleteMany).toHaveBeenCalled();
  });
});

describe("createDemoAccount", () => {
  function fakeTx() {
    let nextUserId = 100;
    let nextGroupId = 1;
    const tx = {
      user: { create: jest.fn(({ data }) => Promise.resolve({ id: nextUserId++, ...data })) },
      group: { create: jest.fn(({ data }) => Promise.resolve({ id: nextGroupId++, ...data })) },
      expense: { create: jest.fn(({ data }) => Promise.resolve({ id: 1, ...data })) },
      settlement: { create: jest.fn(({ data }) => Promise.resolve({ id: 1, ...data })) },
    };
    return tx;
  }

  beforeEach(() => {
    prisma.$transaction.mockImplementation((cb) => cb(fakeTx()));
  });

  test("cleans up expired sandboxes before creating a new one", async () => {
    await createDemoAccount();
    expect(prisma.group.findMany).toHaveBeenCalled(); // the first step of cleanupExpiredDemoAccounts
  });

  test("creates three isDemo users with distinct usernames and emails", async () => {
    let capturedTx;
    prisma.$transaction.mockImplementation((cb) => {
      capturedTx = fakeTx();
      return cb(capturedTx);
    });

    await createDemoAccount();

    const created = capturedTx.user.create.mock.calls.map((c) => c[0].data);
    expect(created).toHaveLength(3);
    for (const u of created) {
      expect(u.isDemo).toBe(true);
      expect(u.emailVerifiedAt).toBeUndefined(); // never set - stays unverified by omission
    }
    const usernames = created.map((u) => u.username);
    const emails = created.map((u) => u.email);
    expect(new Set(usernames).size).toBe(3);
    expect(new Set(emails).size).toBe(3);
  });

  test("returns the primary user, not a co-member", async () => {
    const user = await createDemoAccount();
    expect(user.name).toBe("Demo User");
  });

  test("creates one isDemo group owned by the primary user, with all three as members", async () => {
    let capturedTx;
    prisma.$transaction.mockImplementation((cb) => {
      capturedTx = fakeTx();
      return cb(capturedTx);
    });

    const user = await createDemoAccount();

    expect(capturedTx.group.create).toHaveBeenCalledTimes(1);
    const groupData = capturedTx.group.create.mock.calls[0][0].data;
    expect(groupData.isDemo).toBe(true);
    expect(groupData.createdBy).toBe(user.id);
    expect(groupData.members.create).toHaveLength(3);
  });

  test("every expense's splits sum to exactly its amount", async () => {
    let capturedTx;
    prisma.$transaction.mockImplementation((cb) => {
      capturedTx = fakeTx();
      return cb(capturedTx);
    });

    await createDemoAccount();

    const expenses = capturedTx.expense.create.mock.calls.map((c) => c[0].data);
    expect(expenses.length).toBeGreaterThan(0);
    for (const e of expenses) {
      const splitTotal = e.splits.create.reduce((sum, s) => sum + s.amountOwed, 0);
      expect(splitTotal).toBe(e.amount);
    }
  });

  test("creates exactly one settlement in the seeded group", async () => {
    let capturedTx;
    prisma.$transaction.mockImplementation((cb) => {
      capturedTx = fakeTx();
      return cb(capturedTx);
    });

    await createDemoAccount();

    expect(capturedTx.settlement.create).toHaveBeenCalledTimes(1);
  });
});
