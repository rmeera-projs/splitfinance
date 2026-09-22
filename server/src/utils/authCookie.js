const { generateToken } = require("./jwt");

// The session JWT lives in an HttpOnly cookie rather than a client-stored
// token, so a script injected into the page can't read and replay it
// elsewhere - though it can still ride the cookie for same-origin requests,
// which is what the CSP (terraform/user_data.sh.tpl's Caddyfile) is for.
const COOKIE_NAME = "session";

// Matches the JWT's own 7d expiry in utils/jwt.js - the two have to move
// together, or one side outlives the other.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    // No Domain attribute: host-only, sent only to the API that set it.
    // "lax" rather than "strict" keeps the cookie on the SPA's own calls
    // while still blocking cross-site POSTs - "strict" would also drop it
    // on the password-reset link's top-level navigation.
    sameSite: "lax",
    // Local dev and the e2e stack serve plain http, where Secure cookies
    // never get stored.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_MS,
  };
}

// Used wherever a session begins or renews: signup, login, password reset,
// and a password change (which bumps tokenVersion and would otherwise log
// the requester out of their own new session).
function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, generateToken(user.id, user.tokenVersion), cookieOptions());
}

// Must clear with the same flags it was set with, or the browser treats it
// as a different cookie and leaves the original in place.
function clearAuthCookie(res) {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

module.exports = { setAuthCookie, clearAuthCookie, COOKIE_NAME };
