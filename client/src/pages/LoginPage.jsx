import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [demoLoading, setDemoLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  }

  // Skips the form entirely - the server creates a fresh, already-seeded
  // sandbox account and logs it in on the spot (see AuthContext.demoLogin).
  async function handleDemo() {
    setError("");
    setDemoLoading(true);
    try {
      await demoLogin();
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't start the demo - try again in a moment");
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-xl shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">SplitFinance</h1>
        <div className="space-y-4">
          <input
            className="w-full border rounded px-3 py-2"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            onClick={handleSubmit}
            className="w-full bg-emerald-600 text-white rounded py-2 font-medium hover:bg-emerald-700"
          >
            Log in
          </button>
        </div>
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400 uppercase">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <button
          onClick={handleDemo}
          disabled={demoLoading}
          className="w-full border border-emerald-600 text-emerald-700 rounded py-2 font-medium hover:bg-emerald-50 disabled:opacity-50"
        >
          {demoLoading ? "Setting up your demo…" : "Try the demo - no signup required"}
        </button>
        <p className="text-sm text-center mt-4">
          <Link to="/forgot-password" className="text-emerald-600 font-medium">
            Forgot password?
          </Link>
        </p>
        <p className="text-sm text-center mt-2">
          No account?{" "}
          <Link to="/signup" className="text-emerald-600 font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
