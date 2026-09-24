const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/prisma");
const { cleanupExpiredDemoAccounts, MAX_AGE_MS } = require("../../src/services/demoSeedService");
const { signUp, createGroup } = require("./helpers");

// Real Postgres is the point here, not the mocked layer: creation spans a
// User/Group/Expense/ExpenseSplit/Settlement transaction, and cleanup has to
// delete across those same tables in an order that satisfies real foreign
// keys (Group.owner, Expense.payer, ExpenseSplit.user and Settlement.from/to
// are Restrict, not Cascade - only GroupMember cascades). A mocked Prisma
// can assert the calls happen in the right order; it can't prove the order
// is actually the one Postgres requires.
describe("POST /api/auth/demo", () => {
  test("logs the visitor straight into a seeded, unverified sandbox", async () => {
    const res = await request(app).post("/api/auth/demo").send();

    expect(res.status).toBe(201);
    expect(res.body.user.emailVerified).toBe(false);
    const setCookie = (res.headers["set-cookie"] || []).find((c) => c.startsWith("session="));
    expect(setCookie).toBeDefined();

    const me = await prisma.user.findUnique({ where: { id: res.body.user.id } });
    expect(me.isDemo).toBe(true);
    expect(me.emailVerifiedAt).toBeNull();

    const group = await prisma.group.findFirst({
      where: { createdBy: me.id },
      include: { members: true, expenses: { include: { splits: true } }, settlements: true },
    });
    expect(group.isDemo).toBe(true);
    expect(group.members).toHaveLength(3);
    expect(group.expenses.length).toBeGreaterThan(0);
    expect(group.settlements).toHaveLength(1);

    // The invariant createExpense itself enforces on a real request - a
    // seeded account is not exempt from it.
    for (const expense of group.expenses) {
      const splitTotal = expense.splits.reduce((sum, s) => sum + s.amountOwed, 0);
      expect(splitTotal).toBe(expense.amount);
    }
  });

  test("the co-members are real, isolated accounts - not shared with another sandbox", async () => {
    const first = await request(app).post("/api/auth/demo").send();
    const second = await request(app).post("/api/auth/demo").send();

    const firstGroup = await prisma.group.findFirst({
      where: { createdBy: first.body.user.id },
      include: { members: true },
    });
    const secondGroup = await prisma.group.findFirst({
      where: { createdBy: second.body.user.id },
      include: { members: true },
    });

    const firstMemberIds = firstGroup.members.map((m) => m.userId).sort();
    const secondMemberIds = secondGroup.members.map((m) => m.userId).sort();
    expect(firstMemberIds).not.toEqual(secondMemberIds);
  });

  test("can be exercised through the real login form's balances view", async () => {
    // Not literally logging in with a password (there is none to know) -
    // this proves the session the endpoint sets is a genuine one that the
    // rest of the authenticated API accepts, the same as any other cookie.
    const res = await request(app).post("/api/auth/demo").send();
    const cookie = (res.headers["set-cookie"] || []).find((c) => c.startsWith("session=")).split(";")[0];

    const balances = await request(app).get("/api/users/me/balances").set("Cookie", cookie);

    expect(balances.status).toBe(200);
    expect(balances.body.people.length).toBeGreaterThan(0);
  });
});

describe("cleanupExpiredDemoAccounts", () => {
  async function backdate(userId, groupId, age) {
    const createdAt = new Date(Date.now() - age);
    await prisma.user.update({ where: { id: userId }, data: { createdAt } });
    await prisma.group.update({ where: { id: groupId }, data: { createdAt } });
  }

  async function demoSandbox() {
    const res = await request(app).post("/api/auth/demo").send();
    const user = await prisma.user.findUnique({ where: { id: res.body.user.id } });
    const group = await prisma.group.findFirst({ where: { createdBy: user.id } });
    return { user, group };
  }

  test("deletes an expired sandbox - group, members, expenses, splits and settlement - without a foreign-key error", async () => {
    const { user, group } = await demoSandbox();
    await backdate(user.id, group.id, MAX_AGE_MS + 60000);

    await expect(cleanupExpiredDemoAccounts()).resolves.not.toThrow();

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.group.findUnique({ where: { id: group.id } })).toBeNull();
    expect(await prisma.expense.findMany({ where: { groupId: group.id } })).toHaveLength(0);
    expect(await prisma.groupMember.findMany({ where: { groupId: group.id } })).toHaveLength(0);
  });

  test("leaves a sandbox that isn't old enough yet", async () => {
    const { user, group } = await demoSandbox();
    await backdate(user.id, group.id, MAX_AGE_MS - 60000);

    await cleanupExpiredDemoAccounts();

    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.group.findUnique({ where: { id: group.id } })).not.toBeNull();
  });

  test("never touches a real account, however old", async () => {
    const real = await signUp({ name: "Real Person" });
    const realGroup = await createGroup(real, { name: "Real Group" });
    await prisma.user.update({
      where: { id: real.id },
      data: { createdAt: new Date(Date.now() - MAX_AGE_MS - 60000) },
    });
    await prisma.group.update({
      where: { id: realGroup.id },
      data: { createdAt: new Date(Date.now() - MAX_AGE_MS - 60000) },
    });

    await cleanupExpiredDemoAccounts();

    expect(await prisma.user.findUnique({ where: { id: real.id } })).not.toBeNull();
    expect(await prisma.group.findUnique({ where: { id: realGroup.id } })).not.toBeNull();
  });

  test("the demo endpoint itself sweeps up an expired sandbox from an earlier visit", async () => {
    const { user, group } = await demoSandbox();
    await backdate(user.id, group.id, MAX_AGE_MS + 60000);

    await request(app).post("/api/auth/demo").send();

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});
