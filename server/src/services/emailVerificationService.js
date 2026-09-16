const crypto = require("crypto");
const prisma = require("../config/prisma");
const { sendVerificationEmail } = require("./emailService");

// 24 hours rather than the password reset token's 1 hour. A reset link is a
// live credential for an existing account and should be short-lived; this
// one only confirms an address somebody already controls, and making it
// expire before they next check their email just generates support requests.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Issues a fresh verification token and emails the link.
//
// Never throws. Signup calls this, and an account must not fail to be
// created because Resend is down or unconfigured - the address stays
// unverified, the user can ask for another link, and everything except the
// AI features keeps working in the meantime.
async function sendVerification(user) {
  try {
    const rawToken = crypto.randomBytes(32).toString("hex");

    // Any outstanding link for this account is spent first, so "resend"
    // means the newest link is the only one that works. Without this, an
    // older token sitting in an inbox stays valid for its full 24 hours.
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    const verifyUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/verify-email?token=${rawToken}`;
    return await sendVerificationEmail(user.email, verifyUrl);
  } catch (err) {
    // The message only - an exception carrying the token or the URL in a
    // stack frame must not reach the log.
    console.error("Failed to issue an email verification token:", err.message);
    return false;
  }
}

module.exports = { sendVerification, hashToken, TOKEN_TTL_MS };
