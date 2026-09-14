const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { getGroupBalances } = require("../services/balanceService");
const { groupUserSelect } = require("../utils/publicUser");
const { assertGroupNotFinalized } = require("../utils/assertGroupNotFinalized");
const { emitGroupActivity } = require("../services/realtimeService");

// Each entry can be either an email or a username - resolveUsers() below
// looks a member up by whichever one it looks like.
const createGroupSchema = z.object({
  name: z.string().min(1),
  memberIdentifiers: z.array(z.string().min(1)).optional().default([]),
});

const addMembersSchema = z.object({
  memberIdentifiers: z.array(z.string().min(1)).min(1),
});

// Matches each identifier against either email or username in one query,
// then reports back which ones didn't match any registered user - shared
// by createGroup and addMembers so both invite flows behave identically.
async function resolveUsers(identifiers) {
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { in: identifiers } }, { username: { in: identifiers } }] },
  });
  const found = new Set(users.flatMap((u) => [u.email, u.username]));
  const unmatched = identifiers.filter((i) => !found.has(i));
  return { users, unmatched };
}

const setFinalizedSchema = z.object({
  finalized: z.boolean(),
});

async function createGroup(req, res, next) {
  try {
    const { name, memberIdentifiers } = createGroupSchema.parse(req.body);

    const { users: members, unmatched: unmatchedIdentifiers } = await resolveUsers(memberIdentifiers);

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
      include: { members: { include: { user: { select: groupUserSelect } } } },
    });

    res.status(201).json({ ...group, unmatchedIdentifiers });
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
    const { memberIdentifiers } = addMembersSchema.parse(req.body);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    await assertGroupNotFinalized(groupId);

    const { users, unmatched: unmatchedIdentifiers } = await resolveUsers(memberIdentifiers);

    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    const existingIds = new Set(existingMembers.map((m) => m.userId));

    // A registered user who's already a member isn't "unmatched" - they
    // matched fine, there's just nothing new to add for them.
    const toAdd = users.filter((u) => !existingIds.has(u.id));
    if (toAdd.length > 0) {
      await prisma.groupMember.createMany({
        data: toAdd.map((u) => ({ groupId, userId: u.id })),
      });
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { include: { user: { select: groupUserSelect } } } },
    });

    if (toAdd.length > 0) {
      emitGroupActivity(groupId, { type: "member-added", actorId: req.userId });
    }
    res.status(200).json({ ...group, unmatchedIdentifiers });
  } catch (err) {
    next(err);
  }
}

async function listMyGroups(req, res, next) {
  try {
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: req.userId } } },
      include: { members: { include: { user: { select: groupUserSelect } } } },
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
        members: { include: { user: { select: groupUserSelect } } },
        expenses: {
          include: { splits: true, payer: { select: groupUserSelect } },
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
