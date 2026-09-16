const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { sendPasswordResetEmail } = require("../services/emailService");
const { USERNAME_RE } = require("../utils/validators");
const { setAuthCookie, clearAuthCookie } = require("../utils/authCookie");
const {
  logLoginFailed,
  logLoginSucceeded,
  logSignup,
  logPasswordResetRequested,
  logPasswordResetCompleted,
} = require("../services/securityLog");

const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

const signupSchema = z.object({
  name: z.string().min(1),
  username: z
    .string()
    .regex(USERNAME_RE, "Username must be 3-20 characters: letters, numbers, and underscores only"),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

async function signup(req, res, next) {
  try {
    const { name, username, email, password } = signupSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      throw new ApiError(
        409,
        existing.email === email ? "An account with this email already exists" : "That username is taken"
      );
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { name, username, email, passwordHash },
    });

    logSignup(user.id, user.email, req.ip);
    setAuthCookie(res, user);
    res.status(201).json({
      user: { id: user.id, name: user.name, username: user.username, email: user.email, isAdmin: user.isAdmin },
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    // The response is identical either way - the reason is recorded only
    // in the log, never sent back, since telling a caller which half
    // failed is the account enumeration this endpoint avoids.
    if (!user) {
      logLoginFailed(email, req.ip, "no such account");
      throw new ApiError(401, "Invalid email or password");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      logLoginFailed(email, req.ip, "wrong password");
      throw new ApiError(401, "Invalid email or password");
    }

    logLoginSucceeded(user.id, user.email, req.ip);
    setAuthCookie(res, user);
    res.json({
      user: { id: user.id, name: user.name, username: user.username, email: user.email, isAdmin: user.isAdmin },
    });
  } catch (err) {
    next(err);
  }
}

// Always responds with the same generic success message whether or not the
// email belongs to an account - a different response for "unknown email"
// vs "email sent" would let anyone enumerate which addresses are
// registered just by trying this endpoint.
async function forgotPassword(req, res, next) {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    // Same shape as the login logging above: whether the address is
    // registered is recorded, but the response stays identical regardless.
    logPasswordResetRequested(email, req.ip, Boolean(user));
    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const resetUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
      await sendPasswordResetEmail(email, resetUrl);
    }

    res.json({ message: "If an account exists for that email, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new ApiError(400, "This reset link is invalid or has expired");
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.$transaction([
      // tokenVersion increments too - any token issued before this reset
      // (e.g. one that leaked, which may be exactly why someone is
      // resetting their password) stops working immediately, not just
      // whenever it would have naturally expired.
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      }),
      // Single-use: mark it spent so the same link can't be replayed.
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    ]);

    // A completed reset is worth recording on its own: it invalidates every
    // existing session for the account, so if the owner did not do it, this
    // is the line that says when it happened.
    logPasswordResetCompleted(resetToken.userId, req.ip);

    res.json({ message: "Password updated - you can now log in with your new password." });
  } catch (err) {
    next(err);
  }
}

// Signing out has to be a server round-trip now. When the token lived in
// localStorage the client could simply delete it, but an HttpOnly cookie is
// by definition unreachable from JavaScript, so only a response carrying a
// Set-Cookie that expires it can end the session.
//
// Deliberately unauthenticated: someone whose token has already expired or
// been invalidated still needs to be able to clear the stale cookie, and
// requireAuth would reject them before they got the chance. There's nothing
// to abuse here - the worst a forged request achieves is signing out a
// browser that sent it.
function logout(req, res) {
  clearAuthCookie(res);
  res.json({ message: "Signed out." });
}

module.exports = { signup, login, forgotPassword, resetPassword, logout };
