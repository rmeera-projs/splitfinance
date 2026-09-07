const { ZodError } = require("zod");

// Centralized error handler. Controllers should call next(err) on failure
// rather than crafting their own error responses, so formatting stays consistent.
function errorHandler(err, req, res, next) {
  console.error(err);

  // A failed schema.parse() throws a ZodError, not an ApiError - map it to
  // 400 here so every route validating its body/params this way gets a
  // proper client error instead of falling through to a raw 500.
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => e.message).join(", ");
    return res.status(400).json({ error: message });
  }

  const status = err.status || 500;
  const message = status === 500 ? "Internal server error" : err.message;

  res.status(status).json({ error: message });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { errorHandler, ApiError };
