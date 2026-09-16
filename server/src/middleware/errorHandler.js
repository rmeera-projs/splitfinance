const { ZodError } = require("zod");
const { logServerError, logAuthorizationDenied } = require("../services/securityLog");

// Centralized error handler. Controllers should call next(err) on failure
// rather than crafting their own error responses, so formatting stays consistent.
//
// The unused 4th parameter is load-bearing: Express decides something is
// error-handling middleware by checking the function's arity, so dropping
// it would silently turn this back into an ordinary middleware that never
// sees errors. Named with a leading underscore so the lint rule knows the
// omission is deliberate.
function errorHandler(err, req, res, _next) {
  // A failed schema.parse() throws a ZodError, not an ApiError - map it to
  // 400 here so every route validating its body/params this way gets a
  // proper client error instead of falling through to a raw 500.
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => e.message).join(", ");
    return res.status(400).json({ error: message });
  }

  const status = err.status || 500;
  const message = status === 500 ? "Internal server error" : err.message;

  // Every controller reports failure by calling next(err), so this is the
  // one place that sees all of them - which makes it the right place to
  // record the two categories worth monitoring, rather than instrumenting
  // each throw site and inevitably missing one.
  if (status === 500) {
    // The stack goes to the container log for debugging; the structured
    // event alongside it is what makes a burst of 500s from one source
    // visible as a burst. Deliberately no longer printed for 4xx: those
    // are deliberate, controller-raised ApiErrors with known messages, and
    // a stack trace for each one buries the unexpected failures.
    console.error(err);
    logServerError(err, req);
  } else if (status === 403) {
    logAuthorizationDenied(req.userId, req.ip, req.method, req.originalUrl, err.message);
  }

  res.status(status).json({ error: message });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { errorHandler, ApiError };
