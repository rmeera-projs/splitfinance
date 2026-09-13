import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    try {
      await resetPassword(token, newPassword);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-xl shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">Choose a new password</h1>
        {!token ? (
          <p className="text-sm text-red-600 text-center">
            This link is missing its reset token. Request a new one from the{" "}
            <Link to="/forgot-password" className="text-emerald-600 font-medium">
              forgot password
            </Link>{" "}
            page.
          </p>
        ) : done ? (
          <p className="text-sm text-gray-600 text-center">
            Password updated - taking you to log in...
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              className="w-full border rounded px-3 py-2"
              type="password"
              placeholder="New password (min 8 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className="w-full border rounded px-3 py-2"
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button className="w-full bg-emerald-600 text-white rounded py-2 font-medium hover:bg-emerald-700">
              Update password
            </button>
          </form>
        )}
        <p className="text-sm text-center mt-4">
          <Link to="/login" className="text-emerald-600 font-medium">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}
