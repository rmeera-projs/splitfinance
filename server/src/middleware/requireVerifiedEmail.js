const { logSecurityEvent } = require("../services/securityLog");

// Gates the Cohere-backed endpoints on a confirmed email address.
//
// Scope is deliberately narrow. Signing up is free and instant, which makes
// throwaway accounts the cheapest route to someone else's metered AI quota -
// so the AI is what verification protects. Everything else about the app
// (creating groups, adding expenses, settling up) stays open to an
// unverified account, because none of it costs this project anything and
// putting a mail round-trip in front of the first-run experience would be a
// real cost for a problem that does not exist there.
//
// Must run after requireAuth, which is what sets req.emailVerified.
function requireVerifiedEmail(req, res, next) {
  if (req.emailVerified) return next();

  logSecurityEvent("authz.unverified_email", {
    userId: req.userId,
    ip: req.ip,
    path: req.originalUrl,
  });

  // A distinct `code` alongside the message: the client shows a "resend
  // confirmation" prompt for this specific case, and matching on prose
  // would break the moment the wording changes.
  res.status(403).json({
    error: "Confirm your email address to use the AI-powered features.",
    code: "EMAIL_NOT_VERIFIED",
  });
}

module.exports = { requireVerifiedEmail };
