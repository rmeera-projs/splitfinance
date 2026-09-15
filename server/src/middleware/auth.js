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

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true, isAdmin: true },
    });
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.userId = payload.userId;
    // Free to grab here - this query already runs on every authenticated
    // request for the tokenVersion check above, so requireAdmin below
    // doesn't need a second DB round trip.
    req.isAdmin = user.isAdmin;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Must run after requireAuth (relies on req.isAdmin, which only requireAuth
// sets) - a 403, not a 404, so a non-admin gets a clear "you can't do this"
// rather than the endpoint appearing not to exist.
function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
