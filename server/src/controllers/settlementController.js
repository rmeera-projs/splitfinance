const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");

const createSettlementSchema = z.object({
  groupId: z.number(),
  toUser: z.number(),
  amount: z.number().positive(),
});

// The authenticated user is always the one who paid (fromUser).
async function createSettlement(req, res, next) {
  try {
    const { groupId, toUser, amount } = createSettlementSchema.parse(req.body);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    const settlement = await prisma.settlement.create({
      data: { groupId, fromUser: req.userId, toUser, amount },
    });

    res.status(201).json(settlement);
  } catch (err) {
    next(err);
  }
}

module.exports = { createSettlement };
