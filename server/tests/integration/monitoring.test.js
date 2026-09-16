const request = require("supertest");
const app = require("../../src/app");
const { signUp } = require("./helpers");
const { resetTracking } = require("../../src/services/securityLog");

// The unit suite proves securityLog formats and escalates correctly when it
// is called. What it cannot prove is that it is *reached* - that req.ip
// survives the proxy config, that the middleware runs in the right order,
// that a 403 raised deep in a controller actually arrives at the error
// handler. So these drive real HTTP requests through the real app against
// the real database and read what was written.

let info;
let warn;

beforeEach(() => {
  process.env.SECURITY_LOG_TEST_OUTPUT = "1";
  resetTracking();
  info = jest.spyOn(console, "log").mockImplementation(() => {});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SECURITY_LOG_TEST_OUTPUT;
});

// Only the structured security lines - console.log/warn carry other output
// too, and a non-JSON line here is not a failure, just not ours.
function events(spy) {
  return spy.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.type === "security");
}

function eventsOfType(name) {
  return [...events(info), ...events(warn)].filter((e) => e.event === name);
}

describe("authentication events", () => {
  test("records a failed login with the reason, and never the password", async () => {
    const user = await signUp();

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "not-the-password" });

    expect(res.status).toBe(401);
    const [event] = eventsOfType("auth.login_failed");
    expect(event).toMatchObject({ email: user.email, reason: "wrong password", level: "info" });

    // The submitted password must not appear anywhere in what was written.
    const allOutput = [...info.mock.calls, ...warn.mock.calls].flat().join("\n");
    expect(allOutput).not.toContain("not-the-password");
  });

  test("distinguishes an unknown account from a wrong password in the log only", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "whatever-goes-here" });

    // The response is the same generic message either way - the distinction
    // exists for whoever reads the log, not for the caller.
    expect(res.body.error).toBe("Invalid email or password");
    expect(eventsOfType("auth.login_failed")[0]).toMatchObject({ reason: "no such account" });
  });

  // The behaviour the whole module exists for: one failure is noise, five
  // against the same account is a line worth acting on.
  test("escalates to a warning after repeated failures against one account", async () => {
    const user = await signUp();

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").send({ email: user.email, password: `guess-${i}` });
    }

    const warnings = events(warn).filter((e) => e.event === "auth.login_failed");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "warn", count: 5, email: user.email });
  });

  test("records a successful login and a signup", async () => {
    const user = await signUp();
    expect(eventsOfType("auth.signup")[0]).toMatchObject({ userId: user.id, email: user.email });

    await request(app).post("/api/auth/login").send({ email: user.email, password: user.password });
    expect(eventsOfType("auth.login_succeeded")[0]).toMatchObject({ userId: user.id });
  });

  // The reset flow is the one place a live credential passes through the
  // server, so this asserts the absence of it rather than the presence of
  // anything.
  test("records a reset request without the token or the link", async () => {
    const user = await signUp();

    await request(app).post("/api/auth/forgot-password").send({ email: user.email });

    expect(eventsOfType("auth.password_reset_requested")[0]).toMatchObject({
      email: user.email,
      accountExists: true,
    });

    const allOutput = [...info.mock.calls, ...warn.mock.calls].flat().join("\n");
    expect(allOutput).not.toContain("reset-password?token=");
  });

  test("records a reset request for an address that has no account", async () => {
    await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.com" });

    expect(eventsOfType("auth.password_reset_requested")[0]).toMatchObject({ accountExists: false });
  });
});

describe("session and authorization events", () => {
  test("says nothing when a request simply arrives signed out", async () => {
    const res = await request(app).get("/api/users/me");

    expect(res.status).toBe(401);
    // This is the client asking "is anyone signed in", which happens on
    // every page load - logging it would bury everything else.
    expect(eventsOfType("auth.session_rejected")).toHaveLength(0);
  });

  test("records a request carrying a cookie that does not verify", async () => {
    const res = await request(app).get("/api/users/me").set("Cookie", "session=not-a-real-jwt");

    expect(res.status).toBe(401);
    expect(eventsOfType("auth.session_rejected")[0]).toMatchObject({
      reason: "JsonWebTokenError",
      path: "/api/users/me",
    });
  });

  test("records a signed-in account probing the admin API", async () => {
    const user = await signUp();

    const res = await request(app).get("/api/admin/stats").set(user.auth);

    expect(res.status).toBe(403);
    expect(eventsOfType("authz.denied")[0]).toMatchObject({
      userId: user.id,
      method: "GET",
      path: "/api/admin/stats",
      reason: "admin access required",
    });
  });

  // A 403 raised by a controller, not by middleware - this is the path that
  // reaches the central error handler, and the reason it is instrumented
  // there rather than at each throw site.
  test("records a 403 raised deep in a controller", async () => {
    const owner = await signUp();
    const outsider = await signUp();
    const group = await request(app)
      .post("/api/groups")
      .set(owner.auth)
      .send({ name: "Private", memberIdentifiers: [] });

    const res = await request(app).get(`/api/groups/${group.body.id}`).set(outsider.auth);

    expect(res.status).toBe(403);
    expect(eventsOfType("authz.denied")[0]).toMatchObject({
      userId: outsider.id,
      path: `/api/groups/${group.body.id}`,
    });
  });

  test("warns once one account has been denied repeatedly", async () => {
    const owner = await signUp();
    const outsider = await signUp();
    const group = await request(app)
      .post("/api/groups")
      .set(owner.auth)
      .send({ name: "Private", memberIdentifiers: [] });

    for (let i = 0; i < 5; i++) {
      await request(app).get(`/api/groups/${group.body.id}`).set(outsider.auth);
    }

    const warnings = events(warn).filter((e) => e.event === "authz.denied");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "warn", userId: outsider.id, count: 5 });
  });
});
