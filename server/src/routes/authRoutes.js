const express = require("express");
const { signup, login, forgotPassword, resetPassword, logout } = require("../controllers/authController");
const { authRateLimit } = require("../middleware/rateLimit");

const router = express.Router();

// Not applied to reset-password: its token is a high-entropy random value
// (see authController's crypto.randomBytes(32)), not something guessable
// enough to be worth throttling the way signup/login/forgot-password are.
router.post("/signup", authRateLimit, signup);
router.post("/login", authRateLimit, login);
router.post("/forgot-password", authRateLimit, forgotPassword);
router.post("/reset-password", resetPassword);
// Unauthenticated and unthrottled on purpose - see the comment on logout in
// authController. Clearing your own stale cookie should never be blocked.
router.post("/logout", logout);

module.exports = router;
