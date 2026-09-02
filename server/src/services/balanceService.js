const prisma = require("../config/prisma");
const { simplifyDebts } = require("./simplifyDebts");

/**
 * Computes the simplified list of "who should pay whom" for a group,
 * accounting for both logged expenses and recorded settlements.
 */
async function getGroupBalances(groupId) {
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: { splits: true },
  });

  const settlements = await prisma.settlement.findMany({
    where: { groupId },
  });

  const rawDebts = [];

  // Each expense split is a debt: split.user owes expense.payer their share,
  // unless the split *is* the payer (then it nets to zero, so skip).
  for (const expense of expenses) {
    for (const split of expense.splits) {
      if (split.userId === expense.paidBy) continue;
      rawDebts.push({
        from: split.userId,
        to: expense.paidBy,
        amount: Number(split.amountOwed),
      });
    }
  }

  // Settlements reduce debt in the opposite direction: if X paid Y,
  // that's equivalent to Y owing X the settled amount (cancels prior debt).
  for (const settlement of settlements) {
    rawDebts.push({
      from: settlement.toUser,
      to: settlement.fromUser,
      amount: Number(settlement.amount),
    });
  }

  return simplifyDebts(rawDebts);
}

module.exports = { getGroupBalances };
