process.env.JWT_SECRET = "test-secret";

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
}));

const app = require("../app");
const prisma = require("../config/prisma");

function tokenFor(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const AUTH = { Authorization: `Bearer ${tokenFor(USER_ID)}` };
const PUBLIC_USER = { id: USER_ID, name: "Alice", username: "alice1", email: "alice@example.com", createdAt: new Date() };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/users/me", () => {
  test("returns the current user's public fields", async () => {
    prisma.user.findUnique.mockResolvedValue(PUBLIC_USER);

    const res = await request(app).get("/api/users/me").set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("alice1");
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } })
    );
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/users/me", () => {
  test("updates the given fields and returns the updated user", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({ ...PUBLIC_USER, name: "Alicia" });

    const res = await request(app).patch("/api/users/me").set(AUTH).send({ name: "Alicia" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Alicia");
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID }, data: { name: "Alicia" } })
    );
  });

  test("rejects an empty body", async () => {
    const res = await request(app).patch("/api/users/me").set(AUTH).send({});

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("rejects a username with invalid characters", async () => {
    const res = await request(app).patch("/api/users/me").set(AUTH).send({ username: "al!ce" });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("rejects an email already used by another account", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 2, email: "taken@example.com", username: "someoneelse" });

    const res = await request(app).patch("/api/users/me").set(AUTH).send({ email: "taken@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("rejects a username already taken by another account", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 2, email: "someoneelse@example.com", username: "bob2" });

    const res = await request(app).patch("/api/users/me").set(AUTH).send({ username: "bob2" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/username/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // A user changing only their name shouldn't be blocked by someone else
  // merely existing with a different email/username - the collision check
  // only needs to run against fields actually being changed.
  test("doesn't check for collisions when neither email nor username changed", async () => {
    prisma.user.update.mockResolvedValue({ ...PUBLIC_USER, name: "Alicia" });

    const res = await request(app).patch("/api/users/me").set(AUTH).send({ name: "Alicia" });

    expect(res.status).toBe(200);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/users/me/password", () => {
  test("changes the password when the current one is correct", async () => {
    const currentHash = await bcrypt.hash("oldpassword", 10);
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID, passwordHash: currentHash });
    prisma.user.update.mockResolvedValue({});

    const res = await request(app)
      .patch("/api/users/me/password")
      .set(AUTH)
      .send({ currentPassword: "oldpassword", newPassword: "newpassword123" });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } })
    );
    // The new hash should actually verify against the new password, not
    // just "some string was passed" - catches a swapped-argument bug.
    const newHash = prisma.user.update.mock.calls[0][0].data.passwordHash;
    expect(await bcrypt.compare("newpassword123", newHash)).toBe(true);
  });

  test("rejects an incorrect current password", async () => {
    const currentHash = await bcrypt.hash("oldpassword", 10);
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID, passwordHash: currentHash });

    const res = await request(app)
      .patch("/api/users/me/password")
      .set(AUTH)
      .send({ currentPassword: "wrongpassword", newPassword: "newpassword123" });

    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("rejects a new password shorter than 8 characters", async () => {
    const res = await request(app)
      .patch("/api/users/me/password")
      .set(AUTH)
      .send({ currentPassword: "oldpassword", newPassword: "short" });

    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
