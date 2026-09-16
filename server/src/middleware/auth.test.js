process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const express = require("express");
const cookieParser = require("cookie-parser");

jest.mock("../config/prisma", () => ({
  user: { findUnique: jest.fn() },
}));

const prisma = require("../config/prisma");
const { requireAuth, requireAdmin } = require("./auth");

function tokenFor(userId, tokenVersion) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET);
}

// A minimal app wrapping only requireAuth + a trivial protected route -
// exercises the real middleware without pulling in any controller.
// cookieParser is genuinely required rather than incidental: requireAuth
// reads the session from req.cookies, which stays undefined without it.
function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.get("/protected", requireAuth, (req, res) => res.json({ userId: req.userId }));
  app.get("/admin-only", requireAuth, requireAdmin, (req, res) => res.json({ ok: true }));
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
      .set("Cookie", `session=${tokenFor(1, 3)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 1 });
  });

  test("rejects a request with no session cookie", async () => {
    const res = await request(buildApp()).get("/protected");
    expect(res.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  // A cookie header that carries other cookies but not ours is the same
  // situation as no cookie at all - there is no session to verify.
  test("rejects a cookie header without the session cookie", async () => {
    const res = await request(buildApp()).get("/protected").set("Cookie", "theme=dark; other=1");
    expect(res.status).toBe(401);
  });

  test("rejects an invalid/garbage token", async () => {
    const res = await request(buildApp()).get("/protected").set("Cookie", "session=not-a-real-token");
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
      .set("Cookie", `session=${tokenFor(1, 4)}`);

    expect(res.status).toBe(401);
  });

  test("rejects a token for a user that no longer exists", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .get("/protected")
      .set("Cookie", `session=${tokenFor(1, 0)}`);

    expect(res.status).toBe(401);
  });
});

describe("requireAdmin", () => {
  test("allows an admin through", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, isAdmin: true });

    const res = await request(buildApp())
      .get("/admin-only")
      .set("Cookie", `session=${tokenFor(1, 0)}`);

    expect(res.status).toBe(200);
  });

  test("rejects a non-admin with 403, not 404", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, isAdmin: false });

    const res = await request(buildApp())
      .get("/admin-only")
      .set("Cookie", `session=${tokenFor(1, 0)}`);

    expect(res.status).toBe(403);
  });
});
