import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) setUser(JSON.parse(stored));
    setLoading(false);
  }, []);

  async function login(email, password) {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
  }

  async function signup(name, username, email, password) {
    const { data } = await api.post("/auth/signup", { name, username, email, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  // Neither of these establishes a session (no token comes back) - they
  // just proxy to the API so ForgotPasswordPage/ResetPasswordPage don't
  // need to know the endpoint shapes directly, same as login/signup above.
  async function forgotPassword(email) {
    await api.post("/auth/forgot-password", { email });
  }

  async function resetPassword(token, newPassword) {
    await api.post("/auth/reset-password", { token, newPassword });
  }

  // Updates localStorage/context with the server's response rather than
  // the submitted fields directly - keeps this the single place that
  // decides what "the current user" looks like after a change.
  async function updateProfile(fields) {
    const { data } = await api.patch("/users/me", fields);
    localStorage.setItem("user", JSON.stringify(data));
    setUser(data);
    return data;
  }

  async function changePassword(currentPassword, newPassword) {
    // The server invalidates every previously-issued token as part of this
    // (see userController's changePassword) - including the one that just
    // authenticated this very request - and issues a fresh one specifically
    // so this session survives. Store it, or the next authenticated request
    // would 401 with the now-stale token still in localStorage.
    const { data } = await api.patch("/users/me/password", { currentPassword, newPassword });
    localStorage.setItem("token", data.token);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, signup, logout, forgotPassword, resetPassword, updateProfile, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
