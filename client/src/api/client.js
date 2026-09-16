import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  // The session lives in an HttpOnly cookie the browser attaches itself.
  // Without this axios omits cookies on cross-origin calls, and the API is
  // a different origin from the frontend (api.splitfinance.org vs
  // splitfinance.org), so every authenticated request would 401.
  withCredentials: true,
});

// There's deliberately no request interceptor attaching a token: nothing in
// this app can read the session cookie, which is the entire point of it
// being HttpOnly.

// Endpoints where a 401 is an expected answer about the credentials in the
// request body rather than a statement about the current session - a failed
// login is the obvious one. Signing the user out on those would be wrong,
// and on /auth/login specifically it would redirect away from the form
// that's trying to show "invalid email or password".
const CREDENTIAL_ENDPOINTS = ["/auth/login", "/auth/signup", "/auth/reset-password", "/auth/logout"];

// A 401 anywhere else means the session itself is gone - expired, or
// invalidated by a password change/reset (see requireAuth's tokenVersion
// check). Without this, a dead session just makes every request silently
// fail and pages render as though the user had no data (an empty groups
// list, say) instead of clearly signing them out.
//
// This used to distinguish the two cases by checking whether the request
// carried an Authorization header. That signal is gone with cookies - the
// browser attaches them invisibly, so the client genuinely cannot tell
// whether it sent credentials - hence keying off the endpoint instead.
//
// Callers can also opt out per request with `skipAuthRedirect`, which
// AuthContext's session probe relies on: it asks /users/me on every page
// load precisely to find out whether anyone is signed in, so a 401 there is
// the answer rather than a failure. Without the opt-out, simply opening
// /signup while logged out would bounce the visitor to /login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || "";
    const isCredentialCheck = CREDENTIAL_ENDPOINTS.some((path) => url.includes(path));
    const optedOut = Boolean(error.config?.skipAuthRedirect);

    if (error.response?.status === 401 && !isCredentialCheck && !optedOut) {
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
