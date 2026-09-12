const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { getGroupBalances } = require("../services/balanceService");
const { publicUserSelect } = require("../utils/publicUser");
const { assertGroupNotFinalized } = require("../utils/assertGroupNotFinalized");
const { emitGroupActivity } = require("../services/realtimeService");

const createGroupSchema = z.object({
  name: z.string().min(1),
  memberEmails: z.array(z.string().email()).optional().default([]),
});

const addMembersSchema = z.object({
  memberEmails: z.array(z.string().email()).min(1),
});

const setFinalizedSchema = z.object({
  finalized: z.boolean(),
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
      include: { members: { include: { user: { select: publicUserSelect } } } },
    });

    // Invited emails that don't belong to a registered user are silently
    // skipped above (a group can only hold real accounts) — report them
    // back so the caller can tell the invite didn't fully go through.
    const foundEmails = new Set(members.map((m) => m.email));
    const unmatchedEmails = memberEmails.filter((e) => !foundEmails.has(e));

    res.status(201).json({ ...group, unmatchedEmails });
  } catch (err) {
    next(err);
  }
}

// Any group member can add more people - there's no owner-only restriction,
// consistent with finalize/reopen. Blocked once the group is finalized: a
// finalized group is meant to be a closed, settled ledger, and letting
// membership drift after that would undercut what "finalized" means.
async function addMembers(req, res, next) {
  try {
    const groupId = Number(req.params.id);
    const { memberEmails } = addMembersSchema.parse(req.body);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    await assertGroupNotFinalized(groupId);

    const users = await prisma.user.findMany({
      where: { email: { in: memberEmails } },
    });

    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    const existingIds = new Set(existingMembers.map((m) => m.userId));

    const toAdd = users.filter((u) => !existingIds.has(u.id));
    if (toAdd.length > 0) {
      await prisma.groupMember.createMany({
        data: toAdd.map((u) => ({ groupId, userId: u.id })),
      });
    }

    // Same reporting pattern as createGroup: emails that don't match a
    // registered user, or that were already members, are silently skipped
    // above - surface both back to the caller.
    const foundEmails = new Set(users.map((u) => u.email));
    const unmatchedEmails = memberEmails.filter((e) => !foundEmails.has(e));

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { include: { user: { select: publicUserSelect } } } },
    });

    if (toAdd.length > 0) {
      emitGroupActivity(groupId, { type: "member-added", actorId: req.userId });
    }
    res.status(200).json({ ...group, unmatchedEmails });
  } catch (err) {
    next(err);
  }
}

async function listMyGroups(req, res, next) {
  try {
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: req.userId } } },
      include: { members: { include: { user: { select: publicUserSelect } } } },
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
        members: { include: { user: { select: publicUserSelect } } },
        expenses: {
          include: { splits: true, payer: { select: publicUserSelect } },
          orderBy: { date: "desc" },
        },
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

// Finalizing a group blocks new/edited/deleted expenses (see expenseController)
// while still allowing settlements to be recorded. Any member can finalize
// or reopen a group - there's no owner-only restriction here.
async function setFinalized(req, res, next) {
  try {
    const groupId = Number(req.params.id);
    const { finalized } = setFinalizedSchema.parse(req.body);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    const group = await prisma.group.update({
      where: { id: groupId },
      data: { isFinalized: finalized },
    });

    emitGroupActivity(groupId, { type: finalized ? "finalize" : "reopen", actorId: req.userId });
    res.json(group);
  } catch (err) {
    next(err);
  }
}

module.exports = { createGroup, listMyGroups, getGroup, setFinalized, addMembers };
