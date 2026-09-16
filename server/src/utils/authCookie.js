const { generateToken } = require("./jwt");

// The session JWT travels in an HttpOnly cookie rather than a response body
// the client stores in localStorage. The point is exfiltration: a token in
// localStorage can be read by any script that gets injected into the page
// and replayed from the attacker's own machine until it expires, while an
// HttpOnly cookie is invisible to JavaScript entirely.
//
// Worth being clear about what this does *not* fix: an injected script can
// still make authenticated requests from the victim's own browser, because
// the cookie rides along automatically. This narrows the blast radius from
// "token stolen and reusable anywhere for 7 days" to "abuse confined to the
// live page" - which is why the Content-Security-Policy (see the Caddyfile
// in terraform/user_data.sh.tpl) matters just as much.
const COOKIE_NAME = "session";

// Matches the JWT's own 7d expiry from utils/jwt.js. The cookie expiring
// first would log people out while their token was still valid; the token
// expiring first would leave a cookie that only produces 401s.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    // No Domain attribute, deliberately: the cookie is set by the API and
    // only ever sent back to the API, so a host-only cookie is exactly the
    // scope needed. Widening it to .splitfinance.org would hand it to every
    // subdomain for no benefit.
    //
    // sameSite "lax" rather than "strict": the frontend and the API are
    // different origins but the same *site* (same registrable domain), so
    // "lax" is still sent on the SPA's own API calls while being withheld
    // from cross-site POST/fetch - which is what defuses CSRF here. "strict"
    // would additionally drop the cookie on top-level navigations that
    // arrive from elsewhere, so following the password-reset link out of an
    // email would land you looking signed-out.
    sameSite: "lax",
    // Chrome and Firefox both treat http://localhost as a secure context, but
    // the e2e stack and local dev serve plain http from other hostnames too,
    // where a Secure cookie would simply never be stored.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_MS,
  };
}

// Issues a fresh token for the user and puts it on the response as the
// session cookie. Used everywhere a session begins or is renewed: signup,
// login, password reset, and a password change (which bumps tokenVersion
// and would otherwise log the requester out of their own session).
function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, generateToken(user.id, user.tokenVersion), cookieOptions());
}

// Clearing has to match the flags the cookie was set with, or the browser
// treats it as a different cookie and leaves the original in place.
function clearAuthCookie(res) {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

module.exports = { setAuthCookie, clearAuthCookie, COOKIE_NAME };
