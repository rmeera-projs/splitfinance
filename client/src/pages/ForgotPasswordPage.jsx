import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  // Shown after a successful submit, regardless of whether the email
  // actually matched an account - the server intentionally responds the
  // same way either way (see authController.forgotPassword), so the UI
  // shouldn't reveal that distinction either.
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await forgotPassword(email);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-xl shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">Reset your password</h1>
        {submitted ? (
          <p className="text-sm text-gray-600 text-center">
            If an account exists for <span className="font-medium">{email}</span>, we&apos;ve sent a link to
            reset your password. Check your inbox.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-500">
              Enter the email on your account and we&apos;ll send you a link to reset your password.
            </p>
            <input
              className="w-full border rounded px-3 py-2"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button className="w-full bg-emerald-600 text-white rounded py-2 font-medium hover:bg-emerald-700">
              Send reset link
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
