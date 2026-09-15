const request = require("supertest");
const crypto = require("crypto");
const app = require("../../src/app");
const prisma = require("../../src/config/prisma");
const { signUp, createGroup, addExpense } = require("./helpers");

describe("auth and access control against a real database", () => {
  test("enforces unique emails and usernames at the database level", async () => {
    const alice = await signUp();

    const sameEmail = await request(app).post("/api/auth/signup").send({
      name: "Impostor",
      username: "someone_else",
      email: alice.email,
      password: "correct-horse-battery",
    });
    expect(sameEmail.status).toBe(409);

    const sameUsername = await request(app).post("/api/auth/signup").send({
      name: "Impostor",
      username: alice.username,
      email: "different@example.com",
      password: "correct-horse-battery",
    });
    expect(sameUsername.status).toBe(409);

    expect(await prisma.user.count()).toBe(1);
  });

  // tokenVersion revocation, end to end: the unit suite mocks the user
  // lookup that reads the version, so only a real round-trip proves the
  // column is actually written and compared.
  test("invalidates existing tokens when the password changes", async () => {
    const alice = await signUp({ password: "original-password" });

    const before = await request(app).get("/api/users/me").set(alice.auth);
    expect(before.status).toBe(200);

    const changed = await request(app)
      .patch("/api/users/me/password")
      .set(alice.auth)
      .send({ currentPassword: "original-password", newPassword: "a-brand-new-password" });
    expect(changed.status).toBe(200);

    // The old token is now worthless...
    const after = await request(app).get("/api/users/me").set(alice.auth);
    expect(after.status).toBe(401);

    // ...but the fresh one handed back by the change survives.
    const renewed = { Authorization: `Bearer ${changed.body.token}` };
    expect((await request(app).get("/api/users/me").set(renewed)).status).toBe(200);

    const stored = await prisma.user.findUnique({ where: { id: alice.id } });
    expect(stored.tokenVersion).toBe(1);
  });

  // BOLA regression with real rows: Mallory is a genuine registered user
  // with a genuine group of her own, and Bob's id is a real id - it just
  // isn't a member of her group.
  test("refuses to name a non-member as the payer, even with real user ids", async () => {
    const mallory = await signUp();
    const bob = await signUp();
    const mallorysGroup = await createGroup(mallory, { name: "Mallory only" });

    const res = await addExpense(mallory, {
      groupId: mallorysGroup.id,
      amount: 10000,
      paidBy: bob.id,
      splits: [{ userId: mallory.id, amountOwed: 10000 }],
    });

    expect(res.status).toBe(400);
    expect(await prisma.expense.count()).toBe(0);
  });

  test("hides other members' email addresses in group responses", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const group = await createGroup(alice, { memberIdentifiers: [bob.username] });

    const detail = await request(app).get(`/api/groups/${group.id}`).set(alice.auth);

    const serialized = JSON.stringify(detail.body);
    expect(serialized).not.toContain(bob.email);
    // Alice can still see her own account's email on the account endpoint.
    const me = await request(app).get("/api/users/me").set(alice.auth);
    expect(me.body.email).toBe(alice.email);
  });

  test("stores only a hash of a password-reset token, and burns it after use", async () => {
    const alice = await signUp({ password: "original-password" });

    const requested = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: alice.email });
    expect(requested.status).toBe(200);

    const row = await prisma.passwordResetToken.findFirst({ where: { userId: alice.id } });
    expect(row).toBeTruthy();
    expect(row.usedAt).toBeNull();

    // Whatever is in the database must not be a usable token. We can't read
    // the raw one (it only ever went out by email), so assert the shape: a
    // SHA-256 hex digest, and not something that validates as-is.
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const replay = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: row.tokenHash, newPassword: "attacker-chosen-password" });
    expect(replay.status).toBe(400);

    // The real flow: hash(raw) === stored, so derive a raw token that
    // matches by writing a known hash, the way the emailed link would.
    const rawToken = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex") },
    });

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "a-freshly-reset-password" });
    expect(reset.status).toBe(200);

    // Single use: the same link can't be replayed.
    const reused = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "yet-another-password" });
    expect(reused.status).toBe(400);

    // And the new password actually works.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: alice.email, password: "a-freshly-reset-password" });
    expect(login.status).toBe(200);
  });
});
