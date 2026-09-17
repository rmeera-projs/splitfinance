const request = require("supertest");
const app = require("../../src/app");
const { signUp, createGroup, addExpense } = require("./helpers");

// Per-person balances add up simplified debts across groups, so the numbers
// only mean anything against persisted expenses and settlements - and the
// consistency they promise (the dashboard agrees with every group page) is
// exactly the kind of claim a mocked Prisma can't check.
describe("GET /api/users/me/balances", () => {
  async function expense(payer, group, amount, splits) {
    const res = await addExpense(payer, { groupId: group.id, amount, paidBy: payer.id, splits });
    expect(res.status).toBe(201);
  }

  async function balancesFor(user) {
    const res = await request(app).get("/api/users/me/balances").set(user.auth);
    expect(res.status).toBe(200);
    return res.body;
  }

  test("adds up what one person owes you across several groups", async () => {
    const me = await signUp({ name: "Me" });
    const bob = await signUp({ name: "Bob" });
    const trip = await createGroup(me, { name: "Trip", memberIdentifiers: [bob.username] });
    const flat = await createGroup(me, { name: "Flat", memberIdentifiers: [bob.username] });

    await expense(me, trip, 2500, [{ userId: bob.id, amountOwed: 2500 }]);
    await expense(me, flat, 1000, [{ userId: bob.id, amountOwed: 1000 }]);

    const body = await balancesFor(me);

    expect(body.totalOwedToYou).toBe(3500);
    expect(body.totalYouOwe).toBe(0);
    expect(body.people).toHaveLength(1);
    expect(body.people[0].net).toBe(3500);
    expect(body.people[0].groups.map((g) => g.name).sort()).toEqual(["Flat", "Trip"]);
  });

  test("nets a debt in one group against a credit with the same person in another", async () => {
    const me = await signUp({ name: "Me" });
    const bob = await signUp({ name: "Bob" });
    const trip = await createGroup(me, { name: "Trip", memberIdentifiers: [bob.username] });
    const flat = await createGroup(me, { name: "Flat", memberIdentifiers: [bob.username] });

    await expense(me, trip, 2500, [{ userId: bob.id, amountOwed: 2500 }]);
    await expense(bob, flat, 1000, [{ userId: me.id, amountOwed: 1000 }]);

    const mine = await balancesFor(me);
    expect(mine.people[0].net).toBe(1500);
    expect(mine.totalOwedToYou).toBe(1500);
    expect(mine.totalYouOwe).toBe(0);

    // And the mirror image from Bob's side - the two views must agree.
    const bobs = await balancesFor(bob);
    expect(bobs.people[0].net).toBe(-1500);
    expect(bobs.totalYouOwe).toBe(1500);
  });

  // The consistency this feature depends on. If the dashboard computed its
  // own direct balances, it would say Carol owes Alice nothing while the
  // group page says she owes $15 - the same split-brain that broke settling.
  test("matches what the group page shows when a debt is routed through someone else", async () => {
    const alice = await signUp({ name: "Alice" });
    const bob = await signUp({ name: "Bob" });
    const carol = await signUp({ name: "Carol" });
    const group = await createGroup(alice, { memberIdentifiers: [bob.username, carol.username] });

    await expense(alice, group, 1500, [{ userId: bob.id, amountOwed: 1500 }]);
    await expense(bob, group, 1500, [{ userId: carol.id, amountOwed: 1500 }]);

    const groupPage = await request(app).get(`/api/groups/${group.id}`).set(carol.auth);
    expect(groupPage.body.balances).toEqual([{ from: carol.id, to: alice.id, amount: 1500 }]);

    const carols = await balancesFor(carol);
    expect(carols.people).toHaveLength(1);
    expect(carols.people[0].user.id).toBe(alice.id);
    expect(carols.people[0].net).toBe(-1500);

    // Bob nets to zero in the simplified debts, so he has nothing to show.
    expect((await balancesFor(bob)).people).toEqual([]);
  });

  test("reflects a partial settlement", async () => {
    const me = await signUp({ name: "Me" });
    const bob = await signUp({ name: "Bob" });
    const group = await createGroup(me, { memberIdentifiers: [bob.username] });
    await expense(me, group, 10000, [{ userId: bob.id, amountOwed: 10000 }]);

    const settled = await request(app)
      .post("/api/settlements")
      .set(bob.auth)
      .send({ groupId: group.id, toUser: me.id, amount: 3000 });
    expect(settled.status).toBe(201);

    expect((await balancesFor(me)).people[0].net).toBe(7000);
  });

  // Everyone listed shares a group with the user, and gets the same
  // name/username-only shape a group page gives them - never email.
  test("never exposes another person's email", async () => {
    const me = await signUp({ name: "Me" });
    const bob = await signUp({ name: "Bob" });
    const group = await createGroup(me, { memberIdentifiers: [bob.username] });
    await expense(me, group, 500, [{ userId: bob.id, amountOwed: 500 }]);

    const body = await balancesFor(me);

    expect(body.people[0].user).toEqual({ id: bob.id, name: "Bob", username: bob.username });
    expect(JSON.stringify(body)).not.toContain(bob.email);
  });

  test("leaves out groups the user doesn't belong to", async () => {
    const me = await signUp({ name: "Me" });
    const bob = await signUp({ name: "Bob" });
    const carol = await signUp({ name: "Carol" });
    const theirs = await createGroup(bob, { memberIdentifiers: [carol.username] });
    await expense(bob, theirs, 900, [{ userId: carol.id, amountOwed: 900 }]);

    expect(await balancesFor(me)).toEqual({ totalOwedToYou: 0, totalYouOwe: 0, people: [] });
  });

  test("requires a session", async () => {
    const res = await request(app).get("/api/users/me/balances");
    expect(res.status).toBe(401);
  });
});
