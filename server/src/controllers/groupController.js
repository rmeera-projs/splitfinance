const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { getGroupBalances } = require("../services/balanceService");

const createGroupSchema = z.object({
  name: z.string().min(1),
  memberEmails: z.array(z.string().email()).optional().default([]),
});

async function createGroup(req, res, next) {
  try {
    const { name, memberEmails } = createGroupSchema.parse(req.body);

    const members = await prisma.user.findMany({
      where: { email: { in: memberEmails } },
    });

    const group = await prisma.group.create({
      data: {
        name,
        createdBy: req.userId,
        members: {
          create: [
            { userId: req.userId },
            ...members
              .filter((m) => m.id !== req.userId)
              .map((m) => ({ userId: m.id })),
          ],
        },
      },
      include: { members: { include: { user: true } } },
    });

    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
}

async function listMyGroups(req, res, next) {
  try {
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: req.userId } } },
      include: { members: { include: { user: true } } },
    });
    res.json(groups);
  } catch (err) {
    next(err);
  }
}

async function getGroup(req, res, next) {
  try {
    const groupId = Number(req.params.id);
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: { include: { user: true } },
        expenses: { include: { splits: true, payer: true }, orderBy: { date: "desc" } },
        settlements: true,
      },
    });

    if (!group) throw new ApiError(404, "Group not found");
    const isMember = group.members.some((m) => m.userId === req.userId);
    if (!isMember) throw new ApiError(403, "You are not a member of this group");

    const balances = await getGroupBalances(groupId);
    res.json({ ...group, balances });
  } catch (err) {
    next(err);
  }
}

module.exports = { createGroup, listMyGroups, getGroup };
