process.env.JWT_SECRET = "test-secret";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));

jest.mock("../services/emailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock("../services/demoSeedService", () => ({ createDemoAccount: jest.fn() }));

const app = require("../app");
const prisma = require("../config/prisma");
const { sendPasswordResetEmail } = require("../services/emailService");
const { createDemoAccount } = require("../services/demoSeedService");

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Pulls the session cookie off a response so tests can assert on both the
// token it carries and the flags that make it worth using - the token isn't
// in the response body any more, by design.
function sessionCookie(res) {
  const raw = (res.headers["set-cookie"] || []).find((c) => c.startsWith("session="));
  if (!raw) return null;
  return { raw, token: decodeURIComponent(raw.split(";")[0].split("=")[1]) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/auth/signup", () => {
  const validBody = { name: "Alice", username: "alice1", email: "alice@example.com", password: "password123" };

  test("creates an account and starts a session via an HttpOnly cookie", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      passwordHash: "hashed",
      tokenVersion: 0,
    });

    const res = await request(app).post("/api/auth/signup").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      // A brand-new account has not confirmed its address yet; the client
      // uses this to decide whether to show the confirmation banner.
      emailVerified: false,
    });

    // The token must not come back in the body any more - a body the client
    // can read is a token the client can store, which is exactly what the
    // cookie is there to prevent.
    expect(res.body.token).toBeUndefined();

    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    // tokenVersion is embedded too (see middleware/auth.js) - not just userId.
    expect(jwt.verify(cookie.token, process.env.JWT_SECRET)).toMatchObject({ userId: 1, tokenVersion: 0 });
  });

  // The flags are the whole security value of moving off localStorage, so
  // they're worth asserting directly rather than assuming.
  test("sets the session cookie HttpOnly and SameSite=Lax", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      passwordHash: "hashed",
      tokenVersion: 0,
    });

    const res = await request(app).post("/api/auth/signup").send(validBody);

    const { raw } = sessionCookie(res);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//i);
  });

  test("rejects a username with invalid characters", async () => {
    const res = await request(app).post("/api/auth/signup").send({ ...validBody, username: "al!ce" });

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("rejects a username shorter than 3 characters", async () => {
    const res = await request(app).post("/api/auth/signup").send({ ...validBody, username: "al" });

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("rejects a duplicate email with a specific message", async () => {
    prisma.user.findFirst.mockResolvedValue({ email: "alice@example.com", username: "someoneelse" });

    const res = await request(app).post("/api/auth/signup").send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email already exists/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("rejects a duplicate username with a specific message", async () => {
    prisma.user.findFirst.mockResolvedValue({ email: "someone-else@example.com", username: "alice1" });

    const res = await request(app).post("/api/auth/signup").send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/username is taken/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/demo", () => {
  test("creates a sandbox account and starts a session via an HttpOnly cookie", async () => {
    createDemoAccount.mockResolvedValue({
      id: 9,
      name: "Demo User",
      username: "demo_ab12cd34",
      email: "demo_ab12cd34@demo.splitfinance.org",
      passwordHash: "hashed",
      tokenVersion: 0,
    });

    const res = await request(app).post("/api/auth/demo").send();

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: 9,
      name: "Demo User",
      username: "demo_ab12cd34",
      email: "demo_ab12cd34@demo.splitfinance.org",
      // Deliberately unverified - see demoSeedService.js. A verified demo
      // account would be a free route around the AI quota gate.
      emailVerified: false,
    });
    // Same contract as signup/login: no token in the body, only the cookie.
    expect(res.body.token).toBeUndefined();

    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    expect(jwt.verify(cookie.token, process.env.JWT_SECRET)).toMatchObject({ userId: 9, tokenVersion: 0 });
  });

  test("takes no request body - nothing for a visitor to supply", async () => {
    createDemoAccount.mockResolvedValue({
      id: 1,
      name: "Demo User",
      username: "demo_1",
      email: "demo_1@demo.splitfinance.org",
      passwordHash: "hashed",
      tokenVersion: 0,
    });

    await request(app).post("/api/auth/demo").send({ email: "ignored@example.com", password: "ignored" });

    expect(createDemoAccount).toHaveBeenCalledWith();
  });

  test("propagates a failure from the seed service as a 500 rather than a partial session", async () => {
    createDemoAccount.mockRejectedValue(new Error("db unavailable"));

    const res = await request(app).post("/api/auth/demo").send();

    expect(res.status).toBe(500);
    expect(sessionCookie(res)).toBeNull();
  });
});

describe("POST /api/auth/login", () => {
  test("logs in with the correct password and returns the username", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      passwordHash,
      tokenVersion: 2,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      // A brand-new account has not confirmed its address yet; the client
      // uses this to decide whether to show the confirmation banner.
      emailVerified: false,
    });
    expect(res.body.token).toBeUndefined();
    // tokenVersion is embedded too (see middleware/auth.js) - not just userId.
    expect(jwt.verify(sessionCookie(res).token, process.env.JWT_SECRET)).toMatchObject({
      userId: 1,
      tokenVersion: 2,
    });
  });

  test("rejects an unknown email", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(401);
  });

  test("rejects the wrong password", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      name: "Alice",
      username: "alice1",
      email: "alice@example.com",
      passwordHash,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/forgot-password", () => {
  test("creates a token and emails a reset link for a known account", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, email: "alice@example.com" });
    prisma.passwordResetToken.create.mockResolvedValue({});

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "alice@example.com" });

    expect(res.status).toBe(200);
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 1 }) })
    );
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      "alice@example.com",
      expect.stringContaining("/reset-password?token=")
    );
  });

  // Same response either way - a different one would let an attacker use
  // this endpoint to check which emails are registered.
  test("returns the same generic success response for an unknown email, without emailing anything", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.com" });

    expect(res.status).toBe(200);
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset-password", () => {
  test("resets the password with a valid, unexpired, unused token", async () => {
    const rawToken = "a-valid-raw-token";
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 5,
      userId: 1,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: null,
    });
    prisma.user.update.mockResolvedValue({});
    prisma.passwordResetToken.update.mockResolvedValue({});

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "new-password-123" });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } })
    );
    // Security-review regression: any token issued before this reset - one
    // that may have leaked, which could be exactly why someone's resetting
    // their password - must stop working immediately (see middleware/
    // auth.js's tokenVersion check), not just at its natural 7-day expiry.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) })
    );
    // Single-use: the token gets marked spent in the same transaction.
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ usedAt: expect.any(Date) }) })
    );
  });

  test("rejects a token that doesn't exist", async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "new-password-123" });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("rejects an expired token", async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 5,
      userId: 1,
      tokenHash: hashToken("expired-token"),
      expiresAt: new Date(Date.now() - 1000), // already in the past
      usedAt: null,
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "expired-token", newPassword: "new-password-123" });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("rejects a token that was already used", async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 5,
      userId: 1,
      tokenHash: hashToken("used-token"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: new Date(), // already spent
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "used-token", newPassword: "new-password-123" });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("rejects a new password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "some-token", newPassword: "short" });

    expect(res.status).toBe(400);
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/logout", () => {
  test("clears the session cookie", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);

    const raw = (res.headers["set-cookie"] || []).find((c) => c.startsWith("session="));
    expect(raw).toBeDefined();
    // Expiring a cookie means sending it back empty with a past expiry -
    // there's no other way to remove one from the browser.
    expect(raw).toMatch(/session=;/);
    expect(raw).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  // Someone whose session has already expired or been invalidated still
  // needs to clear the stale cookie, and requireAuth would turn that into a
  // 401 before they got the chance - so logout is deliberately open.
  test("works without a valid session", async () => {
    const res = await request(app).post("/api/auth/logout").set("Cookie", "session=not-a-real-token");

    expect(res.status).toBe(200);
  });
});
