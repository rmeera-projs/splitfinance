const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/prisma");
const { signUp, createGroup, addExpense } = require("./helpers");

// Settlement validation reads the live balance out of the database before
// deciding whether to accept a payment, so it's precisely the logic a
// mocked Prisma client can't meaningfully test - the unit suite has to
// hand-feed it the balance it's supposed to be computing.
describe("settling up against a real database", () => {
  async function groupWhereBobOwesAlice(amount) {
    const alice = await signUp({ name: "Alice" });
    const bob = await signUp({ name: "Bob" });
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    const res = await addExpense(alice, {
      groupId: group.id,
      amount,
      paidBy: alice.id,
      splits: [{ userId: bob.id, amountOwed: amount }],
    });
    expect(res.status).toBe(201);

    return { alice, bob, group };
  }

  test("refuses to settle more than is actually owed", async () => {
    const { alice, bob, group } = await groupWhereBobOwesAlice(2000);

    const res = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 50000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceed/i);
    expect(await prisma.settlement.count()).toBe(0);
  });

  test("accepts a partial payment and leaves the remainder outstanding", async () => {
    const { alice, bob, group } = await groupWhereBobOwesAlice(10000);

    const partial = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 3000 });
    expect(partial.status).toBe(201);

    const detail = await request(app).get(`/api/groups/${group.id}`).set(bob.auth);
    expect(detail.body.balances).toHaveLength(1);
    expect(detail.body.balances[0]).toMatchObject({ from: bob.id, to: alice.id });
    expect(detail.body.balances[0].amount).toBe(7000);

    // A second payment for more than the *remaining* $70.00 must now fail,
    // even though it would have been fine against the original $100.00.
    const tooMuch = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 7001 });
    expect(tooMuch.status).toBe(400);
  });

  test("clears the balance entirely when the full amount is settled", async () => {
    const { alice, bob, group } = await groupWhereBobOwesAlice(4550);

    const res = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 4550 });
    expect(res.status).toBe(201);

    const detail = await request(app).get(`/api/groups/${group.id}`).set(bob.auth);
    expect(detail.body.balances).toEqual([]);
  });

  test("refuses a settlement in the wrong direction", async () => {
    const { alice, bob, group } = await groupWhereBobOwesAlice(2000);

    // Alice is owed money - she has nothing to settle with Bob.
    const res = await request(app)
      .post("/api/settlements")
      .set(alice.auth)
      .send({ groupId: group.id, toUser: bob.id, amount: 500 });

    expect(res.status).toBe(400);
    expect(await prisma.settlement.count()).toBe(0);
  });

  // Regression. The group page lists *simplified* debts and its Settle up
  // button sends exactly what it shows. Settlements used to be checked
  // against the direct balance between the two people instead, and those
  // disagree as soon as simplification routes a debt through a third
  // person: here Carol owes Bob and Bob owes Alice, so the page says Carol
  // owes Alice - yet directly Carol owes Alice nothing, and the server
  // refused the very payment the page offered. Carol could see the debt and
  // never settle it. A two-person group can't reproduce this, which is why
  // nothing caught it.
  test("accepts settling a debt that simplification routed through someone else", async () => {
    const alice = await signUp({ name: "Alice" });
    const bob = await signUp({ name: "Bob" });
    const carol = await signUp({ name: "Carol" });
    const group = await createGroup(alice, { memberIdentifiers: [bob.username, carol.username] });

    // Alice fronts $15 for Bob; Bob fronts $15 for Carol.
    expect(
      (await addExpense(alice, { groupId: group.id, amount: 1500, paidBy: alice.id, splits: [{ userId: bob.id, amountOwed: 1500 }] }))
        .status
    ).toBe(201);
    expect(
      (await addExpense(bob, { groupId: group.id, amount: 1500, paidBy: bob.id, splits: [{ userId: carol.id, amountOwed: 1500 }] }))
        .status
    ).toBe(201);

    // Bob nets to zero, so the group page shows a single debt: Carol -> Alice.
    const before = await request(app).get(`/api/groups/${group.id}`).set(carol.auth);
    expect(before.body.balances).toEqual([{ from: carol.id, to: alice.id, amount: 1500 }]);

    // Exactly what the Settle up button sends.
    const res = await request(app)
      .post("/api/settlements")
      .set(carol.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 1500 });
    expect(res.status).toBe(201);

    const after = await request(app).get(`/api/groups/${group.id}`).set(carol.auth);
    expect(after.body.balances).toEqual([]);
  });

  // The other half of the same change: validating against the simplified
  // graph must not loosen anything. Bob owes Alice directly, but once the
  // debts are simplified he owes nobody - so there is nothing for him to
  // settle, and letting him pay would put the group out of balance.
  test("refuses a payment to someone the simplified debts say you don't owe", async () => {
    const alice = await signUp({ name: "Alice" });
    const bob = await signUp({ name: "Bob" });
    const carol = await signUp({ name: "Carol" });
    const group = await createGroup(alice, { memberIdentifiers: [bob.username, carol.username] });

    await addExpense(alice, { groupId: group.id, amount: 1500, paidBy: alice.id, splits: [{ userId: bob.id, amountOwed: 1500 }] });
    await addExpense(bob, { groupId: group.id, amount: 1500, paidBy: bob.id, splits: [{ userId: carol.id, amountOwed: 1500 }] });

    const res = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 1500 });

    expect(res.status).toBe(400);
    expect(await prisma.settlement.count()).toBe(0);
  });
});
