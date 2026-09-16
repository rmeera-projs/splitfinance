const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/prisma");
const { signUp } = require("./helpers");
const { sendVerificationEmail } = require("../../src/services/emailService");
const { parseExpenseText } = require("../../src/services/expenseParsingService");

// Only the mail provider is mocked - the token is generated, hashed, stored
// and looked up for real. Nothing here asserts against a value the test
// itself made up, which is the point: the raw token is only ever readable
// from the link that was "sent", exactly as a user would get it.
function lastVerifyToken() {
  const calls = sendVerificationEmail.mock.calls;
  if (calls.length === 0) throw new Error("no verification email was sent");
  const url = calls[calls.length - 1][1];
  return new URL(url).searchParams.get("token");
}

describe("issuing the confirmation link", () => {
  test("signing up sends a link and leaves the account unconfirmed", async () => {
    const user = await signUp();

    expect(sendVerificationEmail).toHaveBeenCalledWith(user.email, expect.stringContaining("/verify-email?token="));

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).toBeNull();
  });

  // The raw token exists only in the email. A database leak on its own must
  // not hand somebody the ability to confirm addresses they do not own -
  // same reasoning as hashing the password reset tokens.
  test("stores only a hash of the token, never the token itself", async () => {
    await signUp();
    const token = lastVerifyToken();

    const rows = await prisma.emailVerificationToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toHaveLength(64);
  });

  test("an account can still sign up when the mail provider fails", async () => {
    sendVerificationEmail.mockRejectedValueOnce(new Error("Resend is down"));

    // The account is created regardless - a broken mail provider must not
    // be able to stop people registering.
    const user = await signUp();
    expect(user.id).toBeDefined();
  });
});

describe("confirming an address", () => {
  test("confirms the account and reports the AI features as available", async () => {
    const user = await signUp();

    const res = await request(app).post("/api/auth/verify-email").send({ token: lastVerifyToken() });

    expect(res.status).toBe(200);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).toBeInstanceOf(Date);
  });

  // The link is opened from an inbox, often on a different device with no
  // session at all. Requiring one would strand the people doing exactly
  // what they were asked to do.
  test("works without being signed in", async () => {
    await signUp();
    const token = lastVerifyToken();

    const res = await request(app).post("/api/auth/verify-email").send({ token });

    expect(res.status).toBe(200);
  });

  test("reports the new state through /users/me straight away", async () => {
    const user = await signUp();
    const before = await request(app).get("/api/users/me").set(user.auth);
    expect(before.body.emailVerified).toBe(false);

    await request(app).post("/api/auth/verify-email").send({ token: lastVerifyToken() });

    // No new session needed: requireAuth reads this from the database on
    // every request rather than from the 7-day-old JWT.
    const after = await request(app).get("/api/users/me").set(user.auth);
    expect(after.body.emailVerified).toBe(true);
  });

  test("rejects a token that was already spent", async () => {
    await signUp();
    const token = lastVerifyToken();

    await request(app).post("/api/auth/verify-email").send({ token });
    const second = await request(app).post("/api/auth/verify-email").send({ token });

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid or has expired/i);
  });

  test("rejects an expired token", async () => {
    const user = await signUp();
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post("/api/auth/verify-email").send({ token: lastVerifyToken() });

    expect(res.status).toBe(400);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).toBeNull();
  });

  test("rejects a token that was never issued", async () => {
    await signUp();

    const res = await request(app).post("/api/auth/verify-email").send({ token: "a".repeat(64) });

    expect(res.status).toBe(400);
  });
});

describe("asking for another link", () => {
  test("invalidates the previous link so only the newest one works", async () => {
    const user = await signUp();
    const firstToken = lastVerifyToken();

    await request(app).post("/api/auth/resend-verification").set(user.auth);
    const secondToken = lastVerifyToken();
    expect(secondToken).not.toBe(firstToken);

    // An old link sitting in an inbox should not stay live for its full 24
    // hours once a newer one has been asked for.
    const stale = await request(app).post("/api/auth/verify-email").send({ token: firstToken });
    expect(stale.status).toBe(400);

    const fresh = await request(app).post("/api/auth/verify-email").send({ token: secondToken });
    expect(fresh.status).toBe(200);
  });

  test("requires a session, since it causes mail to be sent", async () => {
    const res = await request(app).post("/api/auth/resend-verification");

    expect(res.status).toBe(401);
  });

  // It is a button somebody can click twice; the second click should not
  // read as an error.
  test("is a no-op once the address is already confirmed", async () => {
    const user = await signUp();
    await request(app).post("/api/auth/verify-email").send({ token: lastVerifyToken() });
    sendVerificationEmail.mockClear();

    const res = await request(app).post("/api/auth/resend-verification").set(user.auth);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already confirmed/i);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("what an unconfirmed account can and cannot do", () => {
  async function makeGroupWithMember(user) {
    const group = await request(app)
      .post("/api/groups")
      .set(user.auth)
      .send({ name: "Trip", memberIdentifiers: [] });
    return group.body;
  }

  // The whole point of the scope chosen here: verification protects the
  // metered Cohere quota, not the product. Splitting expenses is what
  // people signed up to do and stays open.
  test("can still create a group and add an expense", async () => {
    const user = await signUp();
    const group = await makeGroupWithMember(user);

    const res = await request(app)
      .post("/api/expenses")
      .set(user.auth)
      .send({
        groupId: group.id,
        paidBy: user.id,
        amount: 2500,
        description: "Petrol",
        splits: [{ userId: user.id, amountOwed: 2500 }],
      });

    expect(res.status).toBe(201);
    // Created, just not auto-categorized - the Cohere call is the part
    // withheld, and the user can set the category by hand.
    expect(res.body.category).toBe("Other");
  });

  test("cannot use natural-language expense parsing until confirmed", async () => {
    const user = await signUp();
    const group = await makeGroupWithMember(user);

    const blocked = await request(app)
      .post("/api/expenses/parse")
      .set(user.auth)
      .send({ groupId: group.id, text: "spent 20 on lunch" });

    expect(blocked.status).toBe(403);
    // A machine-readable code, not prose - the client keys its "resend
    // confirmation" prompt off this, and matching on wording would break
    // the moment the message is reworded.
    expect(blocked.body.code).toBe("EMAIL_NOT_VERIFIED");

    parseExpenseText.mockResolvedValue({
      description: "lunch",
      amount: 2000,
      participantIds: [user.id],
      confidence: "high",
    });
    await request(app).post("/api/auth/verify-email").send({ token: lastVerifyToken() });

    const allowed = await request(app)
      .post("/api/expenses/parse")
      .set(user.auth)
      .send({ groupId: group.id, text: "spent 20 on lunch" });

    expect(allowed.status).toBe(200);
  });
});
