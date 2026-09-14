const jwt = require("jsonwebtoken");

// tokenVersion is checked against the user's current value on every
// authenticated request (see middleware/auth.js) - bumping it (done by
// authController's resetPassword and userController's changePassword)
// invalidates every token issued before that point, not just the ones a
// client happens to still be holding. Shared between authController
// (signup/login) and userController (changePassword re-issues a token so
// the requester's own session survives the tokenVersion bump their own
// password change just caused).
function generateToken(userId, tokenVersion) {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

module.exports = { generateToken };
