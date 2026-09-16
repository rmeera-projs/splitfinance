process.env.JWT_SECRET = "test-secret";

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
}));

const app = require("../app");
const prisma = require("../config/prisma");

// tokenVersion defaults to 0, matching the requireAuth mock default set in
// beforeEach below.
function tokenFor(userId, tokenVersion = 0) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

const USER_ID = 1;
const AUTH = { Cookie: `session=${tokenFor(USER_ID)}` };
const PUBLIC_USER = {
  id: USER_ID,
  name: "Alice",
  username: "alice1",
  email: "alice@example.com",
  createdAt: new Date(),
  tokenVersion: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  // requireAuth's tokenVersion check (middleware/auth.js) calls this same
  // prisma.user.findUnique mock (there's only one User table) before the
  // controller's own logic ever runs - this baseline covers that call for
  // every test in this file; individual tests below override it with
  // whatever additional fields (passwordHash, etc.) their own controller
  // logic needs, as long as tokenVersion: 0 stays present so both the
  // requireAuth check and the controller's use of the same resolved value
  // are satisfied together.
  prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
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
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID, passwordHash: currentHash, tokenVersion: 0 });
    prisma.user.update.mockResolvedValue({ id: USER_ID, tokenVersion: 1 });

    const res = await request(app)
      .patch("/api/users/me/password")
      .set(AUTH)
      .send({ currentPassword: "oldpassword", newPassword: "newpassword123" });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID }, data: expect.objectContaining({ tokenVersion: { increment: 1 } }) })
    );
    // The new hash should actually verify against the new password, not
    // just "some string was passed" - catches a swapped-argument bug.
    const newHash = prisma.user.update.mock.calls[0][0].data.passwordHash;
    expect(await bcrypt.compare("newpassword123", newHash)).toBe(true);
    // A fresh session cookie is set (carrying the bumped tokenVersion) so
    // the requester's own session survives the invalidation their password
    // change just caused. The browser swaps the cookie itself - nothing is
    // returned in the body for the client to store.
    expect(res.body.token).toBeUndefined();
    const raw = (res.headers["set-cookie"] || []).find((c) => c.startsWith("session="));
    const token = decodeURIComponent(raw.split(";")[0].split("=")[1]);
    expect(jwt.verify(token, process.env.JWT_SECRET)).toMatchObject({ userId: USER_ID, tokenVersion: 1 });
  });

  test("rejects an incorrect current password", async () => {
    const currentHash = await bcrypt.hash("oldpassword", 10);
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID, passwordHash: currentHash, tokenVersion: 0 });

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
    // findUnique is still called once, by requireAuth's tokenVersion check
    // - the assertion is that the controller's own logic never gets that
    // far, not that the mock function was never invoked at all.
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
