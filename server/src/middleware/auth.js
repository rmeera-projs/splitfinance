const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

// Async (a DB read on every authenticated request) rather than the purely
// stateless signature check this used to be - the tradeoff for actually
// being able to revoke a token before its 7-day expiry. A password
// change/reset bumps the user's tokenVersion (see userController's
// changePassword and authController's resetPassword); comparing it here
// means a token issued before that point is rejected immediately, not
// just whenever it would have naturally expired.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { tokenVersion: true } });
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
