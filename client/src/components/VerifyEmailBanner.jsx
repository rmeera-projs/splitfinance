import { useState } from "react";
import { useAuth } from "../context/AuthContext";

// Shown above every protected page until the address is confirmed.
//
// Worded as an offer rather than a warning on purpose: nothing the user
// came here to do is blocked, so an alarming red bar would misrepresent the
// situation. Only the AI features are waiting on this.
export default function VerifyEmailBanner() {
  const { user, resendVerification } = useAuth();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  if (!user || user.emailVerified) return null;

  async function handleResend() {
    setSending(true);
    setMessage("");
    try {
      setMessage(await resendVerification());
    } catch (err) {
      setMessage(err.response?.data?.error || "Could not send the link - try again in a minute.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-2xl mx-auto px-6 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Confirm your email address to unlock the AI-powered features. Everything else works as normal.
        </span>
        {message ? (
          <span className="font-medium">{message}</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={sending}
            className="font-medium underline disabled:opacity-60"
          >
            {sending ? "Sending..." : "Resend the link"}
          </button>
        )}
      </div>
    </div>
  );
}
