const { Resend } = require("resend");

// Lazily constructed so a missing RESEND_API_KEY doesn't crash the app at
// startup - only actually needed when a password reset is requested, same
// "optional until you need it" pattern as COHERE_API_KEY.
function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// onboarding@resend.dev works without verifying a domain, which is enough
// to get this running - swap in a verified sending address for anything
// beyond personal-project use (see DEPLOYMENT.md).
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "SplitFinance <onboarding@resend.dev>";

// Never throws - a failed/unconfigured email send shouldn't turn into a
// 500 on an endpoint that intentionally always reports success (see
// forgotPassword in authController, which avoids leaking whether an email
// is registered). Callers that need to know whether the email actually
// went out can check the return value.
async function sendPasswordResetEmail(to, resetUrl) {
  const client = getClient();
  if (!client) {
    // The reset URL contains the raw token - safe to print locally for
    // testing, but must never land in production logs (a log aggregator
    // exposure would otherwise hand over a live reset link).
    if (process.env.NODE_ENV === "production") {
      console.warn("RESEND_API_KEY not set - skipping password reset email");
    } else {
      console.warn("RESEND_API_KEY not set - skipping password reset email (link would be):", resetUrl);
    }
    return false;
  }

  try {
    await client.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: "Reset your SplitFinance password",
      html: `
        <p>Someone requested a password reset for this email address.</p>
        <p><a href="${resetUrl}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
    return true;
  } catch (err) {
    console.error("Failed to send password reset email:", err);
    return false;
  }
}

module.exports = { sendPasswordResetEmail };
