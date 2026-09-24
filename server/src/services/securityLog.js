// Structured security event logging.
//
// Everything here goes to stdout/stderr as one JSON object per line, which
// is the format the rest of the deployment already knows how to handle:
// Docker captures the container output, and `docker compose logs server` on
// the instance is how these are read today. Emitting JSON rather than prose
// means that when there is somewhere to ship logs to, these are already
// queryable ("every auth.login_failed for this email in the last hour")
// without anyone having to write a parser for a sentence.
//
// Two levels, and the distinction is the whole point of the file:
//
//   info  - a single event happened. Individually unremarkable; one failed
//           login is a typo, not an attack.
//   warn  - the same kind of event has happened often enough, from the same
//           source, to be worth a human looking. These are the lines worth
//           alerting on.
//
// Without the second level this would just be a firehose nobody reads.

// Field names matching this never get logged, whatever a caller passes.
// Defence in depth rather than a real expectation: no call site below logs
// a credential, but a future one might reach for `...req.body` without
// thinking, and a leaked reset token or session cookie sitting in a log
// file is exactly the exposure the password-reset logging fix was about.
const SENSITIVE_KEY = /pass|token|secret|auth|cookie|session|key|hash|credential/i;

function redact(fields) {
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      safe[key] = "[redacted]";
    } else if (value !== undefined) {
      safe[key] = value;
    }
  }
  return safe;
}

// Jest would otherwise print an event for every test that exercises a
// failed login or a 500 - hundreds of lines of noise around the actual
// results. Same convention as middleware/rateLimit.js and its `skip`. The
// securityLog tests set SECURITY_LOG_TEST_OUTPUT to opt back in, since they
// need to see what was written.
function silenced() {
  return process.env.NODE_ENV === "test" && !process.env.SECURITY_LOG_TEST_OUTPUT;
}

function emit(level, event, fields) {
  const line = {
    ts: new Date().toISOString(),
    type: "security",
    level,
    event,
    ...redact(fields),
  };
  if (!silenced()) {
    // warn goes to stderr, which keeps the lines worth acting on separable
    // from the routine ones without needing to parse anything.
    (level === "warn" ? console.warn : console.log)(JSON.stringify(line));
  }
  return line;
}

function logSecurityEvent(event, fields = {}) {
  return emit("info", event, fields);
}

// ---------------------------------------------------------------------------
// Rate-of-occurrence tracking
// ---------------------------------------------------------------------------
//
// In-memory, like the rate limiters in middleware/rateLimit.js, and for the
// same reason: this app runs as a single container on a single instance
// (see terraform/main.tf), so there is no second process whose counts would
// need sharing. It resets on deploy, which is acceptable - this escalates
// attention, it does not enforce anything.

const occurrences = new Map();

// Keys can be attacker-controlled (an email address on a failed login), so
// the map has to be bounded or spraying random addresses is a slow memory
// leak. At the cap, expired entries are pruned first and the whole map
// dropped only if that was not enough: losing counts degrades this to
// plain per-event logging, which is a far better failure than exhausting
// the container memory.
const MAX_TRACKED_KEYS = 10000;

function countRecent(key, windowMs, now) {
  const cutoff = now - windowMs;
  const recent = (occurrences.get(key) || []).filter((t) => t > cutoff);
  recent.push(now);
  occurrences.set(key, recent);

  if (occurrences.size > MAX_TRACKED_KEYS) {
    for (const [k, times] of occurrences) {
      if (!times.some((t) => t > cutoff)) occurrences.delete(k);
    }
    if (occurrences.size > MAX_TRACKED_KEYS) occurrences.clear();
  }

  return recent.length;
}

// Logs the event, and escalates it to warn once `threshold` of the same
// event have been seen for the same `key` inside `windowMs`.
//
// Every occurrence past the threshold warns, not only the one that crosses
// it - a burst that keeps going is more interesting than one that stopped,
// and a single warn line that scrolls away is easy to miss.
function logRepeatableEvent(event, key, fields, { threshold, windowMs }) {
  const count = countRecent(`${event}:${key}`, windowMs, Date.now());
  const level = count >= threshold ? "warn" : "info";
  return emit(level, event, {
    ...fields,
    count,
    windowMinutes: Math.round(windowMs / 60000),
  });
}

// Exported for tests, and for anything that legitimately needs a clean
// slate. Nothing in the app itself calls it.
function resetTracking() {
  occurrences.clear();
}

// ---------------------------------------------------------------------------
// The events themselves
// ---------------------------------------------------------------------------
//
// Thresholds are set relative to what a real person plausibly does, not to
// what the rate limiters already block. Where a limiter exists, the warning
// deliberately fires below it: by the time a limiter trips, the request that
// would have been the useful signal has already been thrown away.

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Five wrong passwords for one account in fifteen minutes is past the point
// where someone is mistyping. Keyed by email rather than IP on purpose: a
// distributed credential-stuffing run varies the address it comes from but
// not the account it is trying to get into.
function logLoginFailed(email, ip, reason) {
  return logRepeatableEvent(
    "auth.login_failed",
    email,
    { email, ip, reason },
    { threshold: 5, windowMs: FIFTEEN_MINUTES }
  );
}

function logLoginSucceeded(userId, email, ip) {
  return logSecurityEvent("auth.login_succeeded", { userId, email, ip });
}

// Keyed by IP: the thing being detected is one source registering accounts
// in bulk, which is what would precede abuse of the AI endpoints - free to
// the user, metered to this project Cohere account.
function logSignup(userId, email, ip) {
  return logRepeatableEvent("auth.signup", ip, { userId, email, ip }, { threshold: 4, windowMs: FIFTEEN_MINUTES });
}

// Same shape as logSignup and the same reasoning: a demo sandbox is an
// account creation with even less friction than signup (no email needed at
// all), so a burst from one IP is exactly as worth seeing.
function logDemoAccountCreated(userId, ip) {
  return logRepeatableEvent("auth.demo_created", ip, { userId, ip }, { threshold: 4, windowMs: FIFTEEN_MINUTES });
}

function logPasswordResetRequested(email, ip, accountExists) {
  return logRepeatableEvent(
    "auth.password_reset_requested",
    ip,
    // Never the reset URL or the raw token - that is the entire point of
    // the guard in services/emailService.js.
    { email, ip, accountExists },
    { threshold: 5, windowMs: FIFTEEN_MINUTES }
  );
}

function logPasswordResetCompleted(userId, ip) {
  return logSecurityEvent("auth.password_reset_completed", { userId, ip });
}

// A request arriving with a cookie that does not verify, which is a
// different thing from arriving with no cookie at all. No-cookie is the
// ordinary signed-out case and is not logged; this one means either a
// tampered or forged token, or a session revoked by a password change
// (tokenVersion) still being presented - worth seeing either way.
function logSessionRejected(ip, path, reason) {
  return logRepeatableEvent("auth.session_rejected", ip, { ip, path, reason }, { threshold: 10, windowMs: FIFTEEN_MINUTES });
}

// Every 403 the API returns. One is somebody clicking a stale link to a
// group they were removed from; a stream of them from one account is
// somebody walking ids looking for something they can reach.
function logAuthorizationDenied(userId, ip, method, path, reason) {
  return logRepeatableEvent(
    "authz.denied",
    String(userId ?? ip),
    { userId, ip, method, path, reason },
    { threshold: 5, windowMs: FIFTEEN_MINUTES }
  );
}

// Fires at 15 against a per-user limit of 20 per 15 minutes (see
// middleware/rateLimit.js), so the warning arrives while the account is
// still being served rather than after it has already been cut off.
function logAiRequest(userId, ip, path) {
  return logRepeatableEvent("ai.request", String(userId), { userId, ip, path }, { threshold: 15, windowMs: FIFTEEN_MINUTES });
}

// A limiter actually tripping is unusual enough to warn on the first
// occurrence - it means something got past every threshold above.
function logRateLimitExceeded(limiter, ip, userId) {
  return emit("warn", "ratelimit.exceeded", { limiter, ip, userId });
}

// 500s only. A handled 4xx is the API working correctly; an unhandled
// exception is either a bug or somebody finding an input nobody expected,
// and a burst of them from one source is usually the latter.
function logServerError(err, req) {
  return logRepeatableEvent(
    "server.error",
    req.ip || "unknown",
    {
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
      userId: req.userId,
      name: err.name,
      message: err.message,
    },
    { threshold: 5, windowMs: FIFTEEN_MINUTES }
  );
}

module.exports = {
  logSecurityEvent,
  logRepeatableEvent,
  resetTracking,
  logLoginFailed,
  logLoginSucceeded,
  logSignup,
  logDemoAccountCreated,
  logPasswordResetRequested,
  logPasswordResetCompleted,
  logSessionRejected,
  logAuthorizationDenied,
  logAiRequest,
  logRateLimitExceeded,
  logServerError,
};
