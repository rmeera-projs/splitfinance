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

// How much `fromUserId` currently owes `toUserId` within one group, as a
// direct pairwise total - not the debt-simplified graph from
// getGroupBalances, which can route a person's debt through a third party
// and so wouldn't reflect the literal amount owed between these two
// specific people (the number a settlement between them needs to be
// validated against).
async function getBalanceBetweenUsers(groupId, fromUserId, toUserId) {
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: { splits: true },
  });

  const settlements = await prisma.settlement.findMany({
    where: { groupId },
  });

  let balance = 0;

  for (const expense of expenses) {
    if (expense.paidBy === toUserId) {
      const split = expense.splits.find((s) => s.userId === fromUserId);
      if (split) balance += Number(split.amountOwed);
    } else if (expense.paidBy === fromUserId) {
      const split = expense.splits.find((s) => s.userId === toUserId);
      if (split) balance -= Number(split.amountOwed);
    }
  }

  for (const settlement of settlements) {
    if (settlement.fromUser === fromUserId && settlement.toUser === toUserId) {
      balance -= Number(settlement.amount);
    } else if (settlement.fromUser === toUserId && settlement.toUser === fromUserId) {
      balance += Number(settlement.amount);
    }
  }

  return balance;
}

module.exports = { getGroupBalances, getBalanceBetweenUsers };
