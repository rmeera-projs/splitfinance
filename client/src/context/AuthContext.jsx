import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Nothing about the session is readable from the browser any more - the
  // token is in an HttpOnly cookie - so "am I signed in?" is a question only
  // the server can answer, and this asks it on every cold load. That's a
  // request the old localStorage version didn't make, in exchange for the
  // server being the single source of truth: previously a stale `user`
  // object in localStorage could claim a session that the API would reject.
  //
  // A 401 here is the normal signed-out case, not an error worth surfacing,
  // so this opts out of the client's sign-out redirect: without
  // skipAuthRedirect, merely opening /signup while logged out would bounce
  // the visitor to /login before they could type anything.
  useEffect(() => {
    let cancelled = false;

    api
      .get("/users/me", { skipAuthRedirect: true })
      .then(({ data }) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // login/signup no longer receive a token to store - the server sets the
  // session cookie on the response, and the browser keeps it from there.
  async function login(email, password) {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data.user);
  }

  async function signup(name, username, email, password) {
    const { data } = await api.post("/auth/signup", { name, username, email, password });
    setUser(data.user);
  }

  // Signing out is a server round-trip now: an HttpOnly cookie can't be
  // deleted from JavaScript, so only the API's Set-Cookie can end the
  // session.
  //
  // A failure here is swallowed rather than rethrown. The local state is
  // cleared either way - if the network is down the user should still end
  // up looking signed out rather than stuck in a half-state, and the cookie
  // they keep is one the server will reject anyway once it's reachable. It
  // also matters that this never rejects: NavBar wires it straight to
  // onClick, where a rejected promise would surface as an unhandled
  // rejection rather than anything the user could act on.
  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // Intentionally ignored - see above.
    }
    setUser(null);
  }

  // Neither of these establishes a session - they just proxy to the API so
  // ForgotPasswordPage/ResetPasswordPage don't need to know the endpoint
  // shapes directly, same as login/signup above.
  async function forgotPassword(email) {
    await api.post("/auth/forgot-password", { email });
  }

  async function resetPassword(token, newPassword) {
    await api.post("/auth/reset-password", { token, newPassword });
  }

  // Unauthenticated on the server, so this works from a link opened in a
  // browser with no session. When there *is* a session, the local user is
  // refreshed afterwards so the confirmation banner disappears without a
  // reload - the failure is ignored because a signed-out visitor confirming
  // from their phone is the ordinary case, not an error.
  async function verifyEmail(token) {
    await api.post("/auth/verify-email", { token });
    try {
      const { data } = await api.get("/users/me", { skipAuthRedirect: true });
      setUser(data);
    } catch {
      // Confirmed anyway - see above.
    }
  }

  async function resendVerification() {
    const { data } = await api.post("/auth/resend-verification");
    return data.message;
  }

  // Uses the server's response rather than the submitted fields directly -
  // keeps this the single place that decides what "the current user" looks
  // like after a change.
  async function updateProfile(fields) {
    const { data } = await api.patch("/users/me", fields);
    setUser(data);
    return data;
  }

  async function changePassword(currentPassword, newPassword) {
    // The server invalidates every previously-issued token as part of this
    // (see userController's changePassword) - including the one that just
    // authenticated this very request - and sets a fresh session cookie on
    // the response specifically so this session survives. Nothing to store
    // here any more; the browser swaps the cookie itself.
    await api.patch("/users/me/password", { currentPassword, newPassword });
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        logout,
        forgotPassword,
        resetPassword,
        verifyEmail,
        resendVerification,
        updateProfile,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
