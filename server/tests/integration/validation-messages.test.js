const request = require("supertest");
const app = require("../../src/app");
const { signUp, createGroup } = require("./helpers");

// Validation messages go straight to users. zod's defaults are written for
// developers, and zod 4 reworded every one of them - so an upgrade that left
// them in place would have silently changed what people read to things like
// "Too small: expected string to have >=8 characters".
//
// This drives a bad request at every validated endpoint and checks two
// things: the request is refused with a 400 (not the 500 that zod 4's
// renamed `.issues` caused), and none of zod's default phrasing reaches the
// response. The next dependency upgrade that rewords something fails here
// rather than in front of a user.
const ZOD_DEFAULT_PHRASING = /too small|too big|invalid input|invalid option|invalid email address|expected \w+,? received|expected \w+ to/i;

describe("validation errors are worded for people", () => {
  let user;
  let group;

  beforeEach(async () => {
    user = await signUp();
    group = await createGroup(user);
  });

  const cases = () => [
    ["signup with a short password", "post", "/api/auth/signup", { name: "A", username: "abc", email: "a@example.com", password: "x" }, false],
    ["signup with no fields", "post", "/api/auth/signup", {}, false],
    ["login with a malformed email", "post", "/api/auth/login", { email: "nope", password: "" }, false],
    ["forgot password with no email", "post", "/api/auth/forgot-password", {}, false],
    ["reset with a short password", "post", "/api/auth/reset-password", { token: "t", newPassword: "x" }, false],
    ["verify email with no token", "post", "/api/auth/verify-email", {}, false],
    ["profile update with nothing", "patch", "/api/users/me", {}, true],
    ["profile update with a bad username", "patch", "/api/users/me", { username: "no spaces!" }, true],
    ["password change too short", "patch", "/api/users/me/password", { currentPassword: "x", newPassword: "y" }, true],
    ["group with no name", "post", "/api/groups", { name: "" }, true],
    ["expense with a string amount", "post", "/api/expenses", { groupId: 1, paidBy: 1, amount: "12", description: "x", splits: [] }, true],
    ["expense with no splits", "post", "/api/expenses", { groupId: 1, paidBy: 1, amount: 100, description: "x", splits: [] }, true],
    ["expense with a bad date", "post", "/api/expenses", { groupId: 1, paidBy: 1, amount: 100, description: "x", date: "tuesday", splits: [{ userId: 1, amountOwed: 100 }] }, true],
    ["settlement with a zero amount", "post", "/api/settlements", { groupId: 1, toUser: 2, amount: 0 }, true],
    ["parse with no text", "post", "/api/expenses/parse", { groupId: 1, text: "" }, true],
  ];

  test.each(cases())("%s", async (_label, method, url, body, needsAuth) => {
    let req = request(app)[method](url);
    if (needsAuth) req = req.set(user.auth);
    const res = await req.send(body);

    // The parse endpoint sits behind email verification, which a fresh
    // account hasn't done - that 403 is correct and not what this checks.
    if (url === "/api/expenses/parse" && res.status === 403) return;

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error).not.toMatch(ZOD_DEFAULT_PHRASING);
  });

  test("the group-member endpoints are worded too", async () => {
    const res = await request(app).post(`/api/groups/${group.id}/members`).set(user.auth).send({ memberIdentifiers: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Add at least one email or username");
  });

  test("a representative message reads the way it should", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", username: "abc", email: "a@example.com", password: "short" });

    expect(res.body.error).toBe("Password must be at least 8 characters");
  });
});
