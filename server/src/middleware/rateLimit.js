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

// Applied to every endpoint that calls out to Cohere (expense creation/
// editing's auto-categorization, and natural-language expense parsing) -
// unlike the auth endpoints above, these sit behind requireAuth, but
// signup itself is public and free, so a per-IP limit alone wouldn't stop
// someone from registering a handful of accounts and hammering these from
// one machine anyway. Three limiters stack on these routes (see
// expenseRoutes.js): per-IP and per-user short-window limits catch a
// single source or account being obviously abusive, and a per-user daily
// ceiling catches slower, spread-out abuse that stays under the
// short-window limits but still adds up to real Cohere quota/cost over a
// day. All three use the same in-memory store convention as authRateLimit
// (fine for this app's single-instance deployment - see
// terraform/main.tf), and are skipped the same way under Jest.
const aiRateLimitPerIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many AI-powered requests from this network - please try again later." },
});

const aiRateLimitPerUser = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // These routes always run after requireAuth (see expenseRoutes.js), so
  // req.userId is set by the time this runs.
  keyGenerator: (req) => String(req.userId),
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many AI-powered requests - please try again later." },
});

const aiRateLimitDaily = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.userId),
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Daily limit for AI-powered requests reached - please try again tomorrow." },
});

const aiRateLimit = [aiRateLimitPerIp, aiRateLimitPerUser, aiRateLimitDaily];

module.exports = { authRateLimit, aiRateLimit };
