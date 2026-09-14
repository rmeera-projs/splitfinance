const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");

// Financial records (Expense.paidBy, ExpenseSplit.userId, Settlement.toUser/
// fromUser) reference the global User table, not a group-scoped one - the
// database itself won't stop a request from naming a real, registered user
// who simply isn't in this group. The route-level "is the requester a
// member" check only proves *they* belong to the group; every other user id
// a request supplies has to be checked against the group's actual
// membership too, or an authenticated attacker could create their own
// group and freely reference any other account by (sequential, guessable)
// id as a payer/split participant/settlement counterparty.
//
// Throws ApiError(400) naming the field if any id isn't a current member of
// the group; otherwise resolves with nothing.
async function assertGroupMembers(groupId, idsByField) {
  const members = await prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } });
  const memberIds = new Set(members.map((m) => m.userId));

  for (const [field, ids] of Object.entries(idsByField)) {
    for (const id of ids) {
      if (!memberIds.has(id)) {
        throw new ApiError(400, `${field} must be a member of this group`);
      }
    }
  }
}

module.exports = { assertGroupMembers };
