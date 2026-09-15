const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/prisma");
const { signUp, createGroup, addExpense } = require("./helpers");

// The money path, end to end, against the real INTEGER cent columns. The
// unit suite mocks Prisma, so it can only ever assert "we asked Prisma for
// X" - it can't catch a value that survives the request but comes back from
// Postgres as a different type or a rounded figure.
//
// Every amount here is cents: 9000 is $90.00.
describe("expenses and balances against a real database", () => {
  test("splits an expense three ways and reports who owes whom", async () => {
    const alice = await signUp({ name: "Alice" });
    const bob = await signUp({ name: "Bob" });
    const carol = await signUp({ name: "Carol" });

    const group = await createGroup(alice, {
      name: "Ski Trip",
      memberIdentifiers: [bob.username, carol.username],
    });
    expect(group.members).toHaveLength(3);

    // Alice fronts $90, split evenly - so Bob and Carol owe her $30 each.
    const res = await addExpense(alice, {
      groupId: group.id,
      amount: 9000,
      description: "Cabin",
      splits: [
        { userId: alice.id, amountOwed: 3000 },
        { userId: bob.id, amountOwed: 3000 },
        { userId: carol.id, amountOwed: 3000 },
      ],
    });
    expect(res.status).toBe(201);

    const detail = await request(app).get(`/api/groups/${group.id}`).set(bob.auth);
    expect(detail.status).toBe(200);

    // Two debtors, one creditor - both owe Alice, and nobody owes anyone else.
    const balances = detail.body.balances;
    expect(balances).toHaveLength(2);
    for (const txn of balances) {
      expect(txn.to).toBe(alice.id);
      expect(txn.amount).toBe(3000);
    }
    expect(balances.map((t) => t.from).sort()).toEqual([bob.id, carol.id].sort());
  });

  // The three-way cycle from the README, but with real persisted rows
  // rather than an array passed straight into simplifyDebts.
  test("nets a circular set of debts down to nothing", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const carol = await signUp();
    const group = await createGroup(alice, {
      memberIdentifiers: [bob.username, carol.username],
    });

    // Each person fronts $10 that the next person owes back in full.
    const pairs = [
      [alice, bob],
      [bob, carol],
      [carol, alice],
    ];
    for (const [payer, ower] of pairs) {
      const res = await addExpense(payer, {
        groupId: group.id,
        amount: 1000,
        paidBy: payer.id,
        splits: [{ userId: ower.id, amountOwed: 1000 }],
      });
      expect(res.status).toBe(201);
    }

    const detail = await request(app).get(`/api/groups/${group.id}`).set(alice.auth);

    expect(detail.body.balances).toEqual([]);
  });

  // 0.1 + 0.2 !== 0.3 is the canonical float trap, and it's exactly the
  // shape of a two-way split of 30 cents. As integers it's 10 + 20 === 30,
  // with nothing to round and no tolerance needed.
  test("stores amounts as exact integer cents, not floats", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    const res = await addExpense(alice, {
      groupId: group.id,
      amount: 30,
      splits: [
        { userId: alice.id, amountOwed: 10 },
        { userId: bob.id, amountOwed: 20 },
      ],
    });
    expect(res.status).toBe(201);

    const stored = await prisma.expense.findUnique({
      where: { id: res.body.id },
      include: { splits: true },
    });

    // Plain JS numbers straight out of Postgres - not Prisma Decimal
    // objects that stringify to "0.30", and not floats.
    expect(stored.amount).toBe(30);
    expect(Number.isInteger(stored.amount)).toBe(true);
    expect(stored.splits.map((s) => s.amountOwed).sort((a, b) => a - b)).toEqual([10, 20]);
  });

  test("refuses an amount that isn't a whole number of cents", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    const res = await addExpense(alice, {
      groupId: group.id,
      amount: 30.5,
      splits: [
        { userId: alice.id, amountOwed: 10.25 },
        { userId: bob.id, amountOwed: 20.25 },
      ],
    });

    expect(res.status).toBe(400);
    expect(await prisma.expense.count()).toBe(0);
  });

  // A three-way split of $60.50 can't be equal in whole cents, so the
  // remainder has to be assigned - and the stored splits must still
  // reconcile against the stored total exactly.
  test("keeps an unevenly-divisible split reconciled against its total", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const carol = await signUp();
    const group = await createGroup(alice, {
      memberIdentifiers: [bob.username, carol.username],
    });

    const res = await addExpense(alice, {
      groupId: group.id,
      amount: 6050,
      splits: [
        { userId: alice.id, amountOwed: 2017 },
        { userId: bob.id, amountOwed: 2017 },
        { userId: carol.id, amountOwed: 2016 },
      ],
    });
    expect(res.status).toBe(201);

    const stored = await prisma.expense.findUnique({
      where: { id: res.body.id },
      include: { splits: true },
    });
    const splitTotal = stored.splits.reduce((sum, s) => sum + s.amountOwed, 0);
    expect(splitTotal).toBe(stored.amount);
  });

  test("rejects splits that don't add up to the total", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    const res = await addExpense(alice, {
      groupId: group.id,
      amount: 10000,
      splits: [
        { userId: alice.id, amountOwed: 2000 },
        { userId: bob.id, amountOwed: 2000 },
      ],
    });

    expect(res.status).toBe(400);
    expect(await prisma.expense.count()).toBe(0);
  });

  // Deleting an expense has to take its splits with it, or balances silently
  // keep counting debts from an expense that no longer exists. That's a
  // database-level cascade, so a mocked Prisma client can't verify it.
  test("deleting an expense removes its splits and clears the balance", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    const created = await addExpense(alice, {
      groupId: group.id,
      amount: 5000,
      splits: [{ userId: bob.id, amountOwed: 5000 }],
    });
    expect(created.status).toBe(201);
    expect(await prisma.expenseSplit.count()).toBe(1);

    const del = await request(app).delete(`/api/expenses/${created.body.id}`).set(alice.auth);
    expect(del.status).toBe(204);

    expect(await prisma.expenseSplit.count()).toBe(0);
    const detail = await request(app).get(`/api/groups/${group.id}`).set(alice.auth);
    expect(detail.body.balances).toEqual([]);
  });
});
