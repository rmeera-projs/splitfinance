const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { sendPasswordResetEmail } = require("../services/emailService");
const { USERNAME_RE } = require("../utils/validators");

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

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

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

    const token = generateToken(user.id);
    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, username: user.username, email: user.email },
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new ApiError(401, "Invalid email or password");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError(401, "Invalid email or password");

    const token = generateToken(user.id);
    res.json({
      token,
      user: { id: user.id, name: user.name, username: user.username, email: user.email },
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
      prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      // Single-use: mark it spent so the same link can't be replayed.
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    ]);

    res.json({ message: "Password updated - you can now log in with your new password." });
  } catch (err) {
    next(err);
  }
}

module.exports = { signup, login, forgotPassword, resetPassword };
