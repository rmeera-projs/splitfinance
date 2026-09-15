const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/prisma");
const { signUp, createGroup, addExpense } = require("./helpers");

// The money path, end to end, against real Decimal(10,2) columns. The unit
// suite mocks Prisma, so it can only ever assert "we asked Prisma for X" -
// it can't catch a value that survives the request but comes back from
// Postgres as a different type or a rounded figure.
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
      amount: 90,
      description: "Cabin",
      splits: [
        { userId: alice.id, amountOwed: 30 },
        { userId: bob.id, amountOwed: 30 },
        { userId: carol.id, amountOwed: 30 },
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
      expect(txn.amount).toBeCloseTo(30, 2);
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
        amount: 10,
        paidBy: payer.id,
        splits: [{ userId: ower.id, amountOwed: 10 }],
      });
      expect(res.status).toBe(201);
    }

    const detail = await request(app).get(`/api/groups/${group.id}`).set(alice.auth);

    expect(detail.body.balances).toEqual([]);
  });

  test("stores amounts as exact decimals, not drifting floats", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    // 0.1 + 0.2 is the canonical float-precision trap.
    const res = await addExpense(alice, {
      groupId: group.id,
      amount: 0.3,
      splits: [
        { userId: alice.id, amountOwed: 0.1 },
        { userId: bob.id, amountOwed: 0.2 },
      ],
    });
    expect(res.status).toBe(201);

    const stored = await prisma.expense.findUnique({
      where: { id: res.body.id },
      include: { splits: true },
    });

    expect(stored.amount.toString()).toBe("0.3");
    const owed = stored.splits.map((s) => s.amountOwed.toString()).sort();
    expect(owed).toEqual(["0.1", "0.2"]);
  });

  test("rejects splits that don't add up to the total", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    const res = await addExpense(alice, {
      groupId: group.id,
      amount: 100,
      splits: [
        { userId: alice.id, amountOwed: 20 },
        { userId: bob.id, amountOwed: 20 },
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
      amount: 50,
      splits: [{ userId: bob.id, amountOwed: 50 }],
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
