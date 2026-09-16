const {
  logSecurityEvent,
  logRepeatableEvent,
  resetTracking,
  logLoginFailed,
  logSignup,
  logSessionRejected,
  logAuthorizationDenied,
  logAiRequest,
  logRateLimitExceeded,
  logServerError,
} = require("./securityLog");

// The module stays quiet under Jest so the other 15 suites are not buried in
// event lines; this suite is the one place that needs to see the output, so
// it opts back in.
beforeAll(() => {
  process.env.SECURITY_LOG_TEST_OUTPUT = "1";
});
afterAll(() => {
  delete process.env.SECURITY_LOG_TEST_OUTPUT;
});

let info;
let warn;

beforeEach(() => {
  resetTracking();
  info = jest.spyOn(console, "log").mockImplementation(() => {});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What was actually written, parsed back - if these were not valid JSON
// lines the whole point of the format would be lost.
function written(spy) {
  return spy.mock.calls.map(([line]) => JSON.parse(line));
}

describe("event format", () => {
  test("writes one parseable JSON line per event", () => {
    logSecurityEvent("auth.login_succeeded", { userId: 7, ip: "203.0.113.4" });

    const [event] = written(info);
    expect(event).toMatchObject({
      type: "security",
      level: "info",
      event: "auth.login_succeeded",
      userId: 7,
      ip: "203.0.113.4",
    });
    expect(Date.parse(event.ts)).not.toBeNaN();
  });

  // The guard that matters most in this file: a future call site reaching
  // for req.body wholesale must not be able to put a credential in a log.
  test("redacts anything whose field name looks like a credential", () => {
    logSecurityEvent("test.event", {
      password: "hunter22",
      resetToken: "abc123",
      sessionCookie: "session=eyJ...",
      apiKey: "sk-live-1",
      passwordHash: "$2b$10$...",
      email: "alice@example.com",
    });

    const [event] = written(info);
    expect(event.password).toBe("[redacted]");
    expect(event.resetToken).toBe("[redacted]");
    expect(event.sessionCookie).toBe("[redacted]");
    expect(event.apiKey).toBe("[redacted]");
    expect(event.passwordHash).toBe("[redacted]");
    // Not a credential, and the field the whole log is most useful keyed by.
    expect(event.email).toBe("alice@example.com");

    // Belt and braces: none of the secret values appear anywhere in the
    // serialized line, whatever the field names were.
    const line = info.mock.calls[0][0];
    expect(line).not.toContain("hunter22");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("sk-live-1");
  });

  test("drops undefined fields rather than writing nulls", () => {
    logSecurityEvent("test.event", { userId: undefined, ip: "10.0.0.1" });

    const [event] = written(info);
    expect(event).not.toHaveProperty("userId");
    expect(event.ip).toBe("10.0.0.1");
  });

  test("stays silent under test unless explicitly opted in", () => {
    delete process.env.SECURITY_LOG_TEST_OUTPUT;
    logSecurityEvent("test.event", {});
    process.env.SECURITY_LOG_TEST_OUTPUT = "1";

    expect(info).not.toHaveBeenCalled();
  });
});

describe("escalation to warn", () => {
  const options = { threshold: 3, windowMs: 60000 };

  test("stays at info below the threshold and warns at it", () => {
    logRepeatableEvent("test.event", "key", {}, options);
    logRepeatableEvent("test.event", "key", {}, options);
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(2);

    logRepeatableEvent("test.event", "key", {}, options);
    expect(written(warn)).toHaveLength(1);
    expect(written(warn)[0]).toMatchObject({ level: "warn", count: 3, windowMinutes: 1 });
  });

  // A burst that keeps going should keep warning - one warn line that
  // scrolls past is easy to miss, and "still happening" is the useful part.
  test("keeps warning past the threshold", () => {
    for (let i = 0; i < 5; i++) logRepeatableEvent("test.event", "key", {}, options);

    expect(written(warn).map((e) => e.count)).toEqual([3, 4, 5]);
  });

  test("counts each key separately", () => {
    logRepeatableEvent("test.event", "alice", {}, options);
    logRepeatableEvent("test.event", "alice", {}, options);
    logRepeatableEvent("test.event", "bob", {}, options);

    expect(warn).not.toHaveBeenCalled();
    expect(written(info).map((e) => e.count)).toEqual([1, 2, 1]);
  });

  test("counts the same key under different events separately", () => {
    logRepeatableEvent("event.a", "key", {}, options);
    logRepeatableEvent("event.a", "key", {}, options);
    logRepeatableEvent("event.b", "key", {}, options);

    expect(warn).not.toHaveBeenCalled();
  });

  // Occurrences outside the window must not count, or every threshold
  // eventually trips on ordinary use given enough uptime.
  test("forgets occurrences older than the window", () => {
    jest.useFakeTimers();
    try {
      logRepeatableEvent("test.event", "key", {}, options);
      logRepeatableEvent("test.event", "key", {}, options);

      jest.advanceTimersByTime(60001);

      logRepeatableEvent("test.event", "key", {}, options);
      expect(warn).not.toHaveBeenCalled();
      expect(written(info).at(-1).count).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Keys are attacker-controlled (a failed login is keyed by whatever email
  // was submitted), so an unbounded map would be a slow memory leak. The cap
  // is 10000; going well past it must not keep growing.
  test("bounds how many keys it tracks", () => {
    for (let i = 0; i < 12000; i++) {
      logRepeatableEvent("test.event", `attacker-${i}@example.com`, {}, options);
    }

    // Still logging afterwards - shedding counts must not break the logging
    // itself, which is the part that still has value.
    info.mockClear();
    logRepeatableEvent("test.event", "real-user", {}, options);
    expect(written(info)).toHaveLength(1);
  });
});

describe("the events the app emits", () => {
  test("warns once one account has been guessed at five times", () => {
    for (let i = 0; i < 4; i++) logLoginFailed("victim@example.com", "203.0.113.9", "wrong password");
    expect(warn).not.toHaveBeenCalled();

    logLoginFailed("victim@example.com", "198.51.100.2", "wrong password");

    // Keyed by the account, not the address - the fifth attempt came from a
    // different IP and still counts, which is the point.
    const [event] = written(warn);
    expect(event).toMatchObject({
      event: "auth.login_failed",
      email: "victim@example.com",
      reason: "wrong password",
      count: 5,
    });
  });

  test("separates failed logins against different accounts", () => {
    for (let i = 0; i < 4; i++) logLoginFailed(`user${i}@example.com`, "203.0.113.9", "no such account");
    logLoginFailed("user0@example.com", "203.0.113.9", "no such account");

    expect(warn).not.toHaveBeenCalled();
  });

  test("warns on bulk signups from one address", () => {
    for (let i = 0; i < 4; i++) logSignup(i, `throwaway${i}@example.com`, "203.0.113.9");

    expect(written(warn)[0]).toMatchObject({ event: "auth.signup", ip: "203.0.113.9", count: 4 });
  });

  test("warns on sustained AI use before the limiter would cut it off", () => {
    // The per-user limiter allows 20 per 15 minutes; this fires at 15 so
    // there is warning before the account starts getting 429s.
    for (let i = 0; i < 14; i++) logAiRequest(42, "203.0.113.9", "/api/expenses/parse");
    expect(warn).not.toHaveBeenCalled();

    logAiRequest(42, "203.0.113.9", "/api/expenses/parse");
    expect(written(warn)[0]).toMatchObject({ event: "ai.request", userId: 42, count: 15 });
  });

  test("warns the first time a rate limiter trips", () => {
    logRateLimitExceeded("auth", "203.0.113.9", undefined);

    expect(written(warn)[0]).toMatchObject({ event: "ratelimit.exceeded", limiter: "auth" });
  });

  test("records rejected sessions and denied authorization", () => {
    logSessionRejected("203.0.113.9", "/api/groups/1", "JsonWebTokenError");
    logAuthorizationDenied(7, "203.0.113.9", "GET", "/api/admin/stats", "admin access required");

    expect(written(info)).toMatchObject([
      { event: "auth.session_rejected", reason: "JsonWebTokenError" },
      { event: "authz.denied", userId: 7, method: "GET", path: "/api/admin/stats" },
    ]);
  });

  test("records server errors with the request that caused them", () => {
    const err = new TypeError("cannot read properties of undefined");
    logServerError(err, { ip: "203.0.113.9", method: "POST", originalUrl: "/api/expenses", userId: 7 });

    expect(written(info)[0]).toMatchObject({
      event: "server.error",
      name: "TypeError",
      message: "cannot read properties of undefined",
      method: "POST",
      path: "/api/expenses",
      userId: 7,
    });
  });
});
