process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const express = require("express");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn() },
}));

const prisma = require("../config/prisma");
const { requireAuth } = require("./auth");

function tokenFor(userId, tokenVersion) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

// A minimal app wrapping only requireAuth + a trivial protected route -
// exercises the real middleware without pulling in any controller.
function buildApp() {
  const app = express();
  app.get("/protected", requireAuth, (req, res) => res.json({ userId: req.userId }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("requireAuth", () => {
  test("allows a request whose token tokenVersion matches the user's current one", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 3 });

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${tokenFor(1, 3)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 1 });
  });

  test("rejects a missing Authorization header", async () => {
    const res = await request(buildApp()).get("/protected");
    expect(res.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test("rejects a malformed Authorization header (not Bearer)", async () => {
    const res = await request(buildApp()).get("/protected").set("Authorization", "Basic abc123");
    expect(res.status).toBe(401);
  });

  test("rejects an invalid/garbage token", async () => {
    const res = await request(buildApp()).get("/protected").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  // Security-review regression: a password change/reset bumps tokenVersion
  // (see authController's resetPassword and userController's
  // changePassword) - a token issued before that point must stop working
  // immediately, not just at its natural 7-day expiry.
  test("rejects a well-formed, unexpired token whose tokenVersion is stale", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 5 });

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${tokenFor(1, 4)}`);

    expect(res.status).toBe(401);
  });

  test("rejects a token for a user that no longer exists", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${tokenFor(1, 0)}`);

    expect(res.status).toBe(401);
  });
});
