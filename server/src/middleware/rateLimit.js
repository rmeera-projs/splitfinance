const rateLimit = require("express-rate-limit");

// Applied to signup/login/forgot-password - the three endpoints where an
// attacker gains something from many rapid guesses (credential stuffing on
// login, account enumeration via signup's "already exists" response or
// forgot-password's timing/behavior). 10 requests per 15 minutes per IP is
// generous enough for a real user who mistypes a password a few times, but
// too slow to usefully brute-force anything.
//
// Skipped entirely under Jest (NODE_ENV=test, set automatically by the
// jest CLI) - the shared in-memory store would otherwise carry a count
// across every test in the same run, tripping the limit on tests that
// deliberately hit these routes many times with no relation to a real
// client's request rate.
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many attempts - please try again later." },
});

module.exports = { authRateLimit };
