const bcrypt = require("bcrypt");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { publicUserSelect, groupUserSelect, presentUser } = require("../utils/publicUser");
const { getUserBalances } = require("../services/balanceService");
// Namespaced rather than destructured: handlers below destructure request
// fields called `username` and `email`, which would shadow the helpers.
const fields = require("../utils/validators");
const { setAuthCookie } = require("../utils/authCookie");

const SALT_ROUNDS = 10;

// Every field optional - a PATCH only sends what actually changed, and
// .refine() below rejects a body that changed nothing rather than
// silently no-op'ing (better to tell the client than pretend it worked).
const updateProfileSchema = z
  .object({
    name: fields.requiredText("Name").optional(),
    username: fields.username().optional(),
    email: fields.email().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { error: "Nothing to update" });

const changePasswordSchema = z.object({
  currentPassword: fields.requiredText("Current password"),
  newPassword: fields.newPassword("New password"),
});

async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: publicUserSelect });
    if (!user) throw new ApiError(404, "User not found");
    res.json(presentUser(user));
  } catch (err) {
    next(err);
  }
}

// What the signed-in user owes, and is owed, per person across every group
// they share. Everyone listed is necessarily a co-member of some group with
// the user - no debt can exist otherwise - so they get the same
// name/username-only shape as every other member on a group page, never
// email.
async function getMyBalances(req, res, next) {
  try {
    const summary = await getUserBalances(req.userId);

    const users = await prisma.user.findMany({
      where: { id: { in: summary.people.map((p) => p.userId) } },
      select: groupUserSelect,
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    res.json({
      totalOwedToYou: summary.totalOwedToYou,
      totalYouOwe: summary.totalYouOwe,
      people: summary.people.map(({ userId, net, groups }) => ({ user: userById.get(userId), net, groups })),
    });
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
    res.json(presentUser(user));
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
    // very request. A fresh session cookie is set below so the requester's
    // own session survives; anyone else holding an older token (e.g. one
    // that leaked - possibly the very reason for this password change)
    // doesn't.
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    setAuthCookie(res, updated);
    res.json({ message: "Password updated." });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, getMyBalances, updateProfile, changePassword };
