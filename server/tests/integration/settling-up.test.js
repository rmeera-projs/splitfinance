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
    const { alice, bob, group } = await groupWhereBobOwesAlice(20);

    const res = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceed/i);
    expect(await prisma.settlement.count()).toBe(0);
  });

  test("accepts a partial payment and leaves the remainder outstanding", async () => {
    const { alice, bob, group } = await groupWhereBobOwesAlice(100);

    const partial = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 30 });
    expect(partial.status).toBe(201);

    const detail = await request(app).get(`/api/groups/${group.id}`).set(bob.auth);
    expect(detail.body.balances).toHaveLength(1);
    expect(detail.body.balances[0]).toMatchObject({ from: bob.id, to: alice.id });
    expect(detail.body.balances[0].amount).toBeCloseTo(70, 2);

    // A second payment for more than the *remaining* $70 must now fail,
    // even though it would have been fine against the original $100.
    const tooMuch = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 71 });
    expect(tooMuch.status).toBe(400);
  });

  test("clears the balance entirely when the full amount is settled", async () => {
    const { alice, bob, group } = await groupWhereBobOwesAlice(45.5);

    const res = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: alice.id, amount: 45.5 });
    expect(res.status).toBe(201);

    const detail = await request(app).get(`/api/groups/${group.id}`).set(bob.auth);
    expect(detail.body.balances).toEqual([]);
  });

  test("refuses a settlement in the wrong direction", async () => {
    const { alice, bob, group } = await groupWhereBobOwesAlice(20);

    // Alice is owed money - she has nothing to settle with Bob.
    const res = await request(app)
      .post("/api/settlements")
      .set(alice.auth)
      .send({ groupId: group.id, toUser: bob.id, amount: 5 });

    expect(res.status).toBe(400);
    expect(await prisma.settlement.count()).toBe(0);
  });
});
