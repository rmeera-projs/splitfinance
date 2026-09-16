import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Deliberately outside ProtectedRoute (see App.jsx). The confirmation link
// arrives by email and is very often opened on a phone or in a different
// browser profile, where there is no session at all - requiring one would
// strand exactly the people doing what they were asked to do.
export default function VerifyEmailPage() {
  const { verifyEmail, user } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState(token ? "working" : "missing");
  const [error, setError] = useState("");

  // React 18 StrictMode mounts effects twice in development. The token is
  // single-use, so the second call would legitimately fail and show an
  // error on a confirmation that had actually just succeeded.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    verifyEmail(token)
      .then(() => setStatus("done"))
      .catch((err) => {
        setError(err.response?.data?.error || "Something went wrong");
        setStatus("failed");
      });
  }, [token, verifyEmail]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-xl shadow text-center">
        <h1 className="text-2xl font-bold mb-6">Confirm your email</h1>

        {status === "missing" && (
          <p className="text-sm text-red-600">
            This link is missing its confirmation token. Open the link from your email again, or ask for a
            new one from your account page.
          </p>
        )}

        {status === "working" && <p className="text-sm text-gray-600">Confirming your address...</p>}

        {status === "done" && (
          <p className="text-sm text-gray-600">
            Thanks - your address is confirmed and the AI-powered features are now available.
          </p>
        )}

        {status === "failed" && (
          <p className="text-sm text-red-600">
            {error} You can ask for a fresh link from your account page.
          </p>
        )}

        <p className="text-sm mt-6">
          <Link to={user ? "/" : "/login"} className="text-emerald-600 font-medium">
            {user ? "Back to your groups" : "Go to log in"}
          </Link>
        </p>
      </div>
    </div>
  );
}
