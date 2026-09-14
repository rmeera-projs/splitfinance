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

const app = require("../app");
const prisma = require("../config/prisma");
const { sendPasswordResetEmail } = require("../services/emailService");

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/auth/signup", () => {
  const validBody = { name: "Alice", username: "alice1", email: "alice@example.com", password: "password123" };

  test("creates an account and returns a token with the username included", async () => {
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
    expect(res.body.user).toEqual({ id: 1, name: "Alice", username: "alice1", email: "alice@example.com" });
    // tokenVersion is embedded too (see middleware/auth.js) - not just userId.
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ userId: 1, tokenVersion: 0 });
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
    expect(res.body.user).toEqual({ id: 1, name: "Alice", username: "alice1", email: "alice@example.com" });
    // tokenVersion is embedded too (see middleware/auth.js) - not just userId.
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ userId: 1, tokenVersion: 2 });
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
