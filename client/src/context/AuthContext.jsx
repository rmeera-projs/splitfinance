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

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, forgotPassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
