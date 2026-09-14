const bcrypt = require("bcrypt");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { publicUserSelect } = require("../utils/publicUser");
const { USERNAME_RE } = require("../utils/validators");
const { generateToken } = require("../utils/jwt");

const SALT_ROUNDS = 10;

// Every field optional - a PATCH only sends what actually changed, and
// .refine() below rejects a body that changed nothing rather than
// silently no-op'ing (better to tell the client than pretend it worked).
const updateProfileSchema = z
  .object({
    name: z.string().min(1).optional(),
    username: z.string().regex(USERNAME_RE, "Username must be 3-20 characters: letters, numbers, and underscores only").optional(),
    email: z.string().email().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: publicUserSelect });
    if (!user) throw new ApiError(404, "User not found");
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const updates = updateProfileSchema.parse(req.body);

    // Same collision check as signup - email/username are both unique, so
    // check both in one query rather than two round trips, and report
    // which one actually collided (never someone else's row, just theirs).
    if (updates.email || updates.username) {
      const existing = await prisma.user.findFirst({
        where: {
          id: { not: req.userId },
          OR: [updates.email && { email: updates.email }, updates.username && { username: updates.username }].filter(
            Boolean
          ),
        },
      });
      if (existing) {
        throw new ApiError(
          409,
          existing.email === updates.email ? "An account with this email already exists" : "That username is taken"
        );
      }
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: updates,
      select: publicUserSelect,
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new ApiError(404, "User not found");

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new ApiError(401, "Current password is incorrect");

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    // tokenVersion increments too, invalidating every token issued before
    // now - including, deliberately, the one that just authenticated this
    // very request. A fresh token is issued below so the requester's own
    // session survives; anyone else holding an older token (e.g. one that
    // leaked - possibly the very reason for this password change) doesn't.
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    res.json({ message: "Password updated.", token: generateToken(updated.id, updated.tokenVersion) });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateProfile, changePassword };
