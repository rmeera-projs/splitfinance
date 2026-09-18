const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { assertGroupMembers } = require("../utils/assertGroupMembers");
const { getGroupBalances } = require("../services/balanceService");
const { emitGroupActivity } = require("../services/realtimeService");
const { id, amountInCents } = require("../utils/validators");

const createSettlementSchema = z.object({
  groupId: id("Group"),
  toUser: id("Recipient"),
  // Integer cents, like every other amount on the wire - see
  // src/utils/money.js. Shares its checks and wording with expenses.
  amount: amountInCents(),
});

// The authenticated user is always the one who paid (fromUser).
async function createSettlement(req, res, next) {
  try {
    const { groupId, toUser, amount } = createSettlementSchema.parse(req.body);

    if (toUser === req.userId) {
      throw new ApiError(400, "toUser cannot be the same as the person settling up");
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    // fromUser is always the requester, already confirmed above to be a
    // member - toUser is a separate id the request supplies, and needs its
    // own check.
    await assertGroupMembers(groupId, { toUser: [toUser] });

    // Settling more than is actually owed must be rejected server-side -
    // the client-side form isn't a trust boundary. Partial settlements
    // (paying off less than the full balance) are intentionally allowed.
    //
    // "Owed" means the simplified debts - the same list the group page shows
    // and settles from - not the direct balance between these two people.
    // The two disagree whenever simplification routes a debt through a third
    // person, and checking against the direct figure broke settling in both
    // directions: it refused debts the page displayed (Carol owes Bob, Bob
    // owes Alice, so the page says Carol owes Alice, but directly she owes
    // her nothing), and it accepted payments the page said weren't owed,
    // quietly creating a new debt. Simplification preserves everyone's net
    // position, so paying along a simplified edge is always a legitimate
    // settlement.
    const debts = await getGroupBalances(groupId);
    const balance = debts.find((d) => d.from === req.userId && d.to === toUser)?.amount ?? 0;
    if (balance <= 0) {
      throw new ApiError(400, "You don't owe this person anything in this group");
    }
    if (amount > balance) {
      throw new ApiError(400, "Settlement amount cannot exceed the outstanding balance");
    }

    const settlement = await prisma.settlement.create({
      data: { groupId, fromUser: req.userId, toUser, amount },
    });

    emitGroupActivity(groupId, { type: "settlement", actorId: req.userId });
    res.status(201).json(settlement);
  } catch (err) {
    next(err);
  }
}

module.exports = { createSettlement };
