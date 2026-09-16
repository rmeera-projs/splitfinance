const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const { COOKIE_NAME } = require("../utils/authCookie");
const { logSessionRejected, logAuthorizationDenied } = require("../services/securityLog");

// Async (a DB read on every authenticated request) rather than the purely
// stateless signature check this used to be - the tradeoff for actually
// being able to revoke a token before its 7-day expiry. A password
// change/reset bumps the user's tokenVersion (see userController's
// changePassword and authController's resetPassword); comparing it here
// means a token issued before that point is rejected immediately, not
// just whenever it would have naturally expired.
async function requireAuth(req, res, next) {
  // The session token comes from an HttpOnly cookie, not an Authorization
  // header - see utils/authCookie.js. Nothing in the browser can read it,
  // so there's no client-side code attaching it to requests; the browser
  // sends it automatically to this origin.
  const token = req.cookies?.[COOKIE_NAME];
  // Not logged as a security event: no cookie is simply the signed-out
  // case, and the client probes /users/me on every page load precisely to
  // ask this question, so recording it would drown out the cases below.
  if (!token) {
    return res.status(401).json({ error: "Not signed in" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true, isAdmin: true, emailVerifiedAt: true },
    });
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      // A signature that verified against a real JWT_SECRET, for a user
      // who no longer matches. Usually benign - a password change bumped
      // tokenVersion and another tab is still holding the old session -
      // but it is also exactly what a replayed stolen token looks like.
      logSessionRejected(req.ip, req.originalUrl, user ? "stale token version" : "unknown user");
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.userId = payload.userId;
    // Free to grab here - this query already runs on every authenticated
    // request for the tokenVersion check above, so requireAdmin below
    // doesn't need a second DB round trip.
    req.isAdmin = user.isAdmin;
    // Read from the database on every request rather than baked into the
    // JWT, so confirming an address takes effect immediately instead of
    // whenever the 7-day session happens to be reissued. Same query as the
    // tokenVersion check above, so it costs nothing extra.
    req.emailVerified = Boolean(user.emailVerifiedAt);
    next();
  } catch (err) {
    // jwt.verify threw: a malformed, expired, or wrong-signature token.
    // The expired case is routine, but a bad signature means somebody
    // presented a token this server did not issue.
    logSessionRejected(req.ip, req.originalUrl, err.name);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Must run after requireAuth (relies on req.isAdmin, which only requireAuth
// sets) - a 403, not a 404, so a non-admin gets a clear "you can't do this"
// rather than the endpoint appearing not to exist.
function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    // Logged here rather than left to the error handler, because this
    // path returns a response directly instead of calling next(err) - and
    // an authenticated account probing the admin API is the single most
    // interesting 403 the app can produce.
    logAuthorizationDenied(req.userId, req.ip, req.method, req.originalUrl, "admin access required");
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
