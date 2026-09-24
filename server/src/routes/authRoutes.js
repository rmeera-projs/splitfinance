const express = require("express");
const {
  signup,
  login,
  demoLogin,
  forgotPassword,
  resetPassword,
  logout,
  verifyEmail,
  resendVerification,
} = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { authRateLimit } = require("../middleware/rateLimit");

const router = express.Router();

// Not applied to reset-password: its token is a high-entropy random value
// (see authController's crypto.randomBytes(32)), not something guessable
// enough to be worth throttling the way signup/login/forgot-password are.
router.post("/signup", authRateLimit, signup);
router.post("/login", authRateLimit, login);
// Same limiter as signup: creating a demo sandbox is an account creation
// (server/src/services/demoSeedService.js), just one with even less
// friction, so it gets at least the same throttling.
router.post("/demo", authRateLimit, demoLogin);
router.post("/forgot-password", authRateLimit, forgotPassword);
router.post("/reset-password", resetPassword);
// Unauthenticated and unthrottled on purpose - see the comment on logout in
// authController. Clearing your own stale cookie should never be blocked.
router.post("/logout", logout);

// Unauthenticated for the same reason reset-password is: the link is opened
// from an inbox, frequently in a browser with no session. The token is the
// authority, and it is 32 random bytes, so there is nothing to throttle.
router.post("/verify-email", verifyEmail);
// Authenticated and throttled, unlike the above - this one causes an email
// to be sent, which is the part worth protecting.
router.post("/resend-verification", requireAuth, authRateLimit, resendVerification);

module.exports = router;
