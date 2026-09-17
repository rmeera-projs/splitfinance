const prisma = require("../config/prisma");
const { simplifyDebts } = require("./simplifyDebts");

// There is exactly one definition of "who owes whom" in this app, and this
// is it. The group page lists these debts, the Settle up button pays them,
// settlementController validates payments against them, and the dashboard's
// per-person balances add them up across groups.
//
// That singularity is the point. Settlements used to be validated against a
// separate direct two-person balance, which disagreed with this whenever
// simplification routed a debt through a third person - so the app refused
// payments it was displaying and accepted ones it wasn't. Anything that
// needs to know what is owed should come through here rather than
// re-deriving it.

// Pure: turns one group's expenses and settlements into its simplified
// debts. Kept free of Prisma so both the single-group and the cross-group
// paths below share it without either duplicating the arithmetic.
function computeDebts(expenses, settlements) {
  const rawDebts = [];

  // Each expense split is a debt: split.user owes expense.payer their share,
  // unless the split *is* the payer (then it nets to zero, so skip).
  for (const expense of expenses) {
    for (const split of expense.splits) {
      if (split.userId === expense.paidBy) continue;
      rawDebts.push({ from: split.userId, to: expense.paidBy, amount: split.amountOwed });
    }
  }

  // Settlements reduce debt in the opposite direction: if X paid Y,
  // that's equivalent to Y owing X the settled amount (cancels prior debt).
  for (const settlement of settlements) {
    rawDebts.push({ from: settlement.toUser, to: settlement.fromUser, amount: settlement.amount });
  }

  return simplifyDebts(rawDebts);
}

/**
 * Computes the simplified list of "who should pay whom" for a group,
 * accounting for both logged expenses and recorded settlements.
 */
async function getGroupBalances(groupId) {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({ where: { groupId }, include: { splits: true } }),
    prisma.settlement.findMany({ where: { groupId } }),
  ]);
  return computeDebts(expenses, settlements);
}

// Pure: folds every group's debts into one entry per person the user has an
// open balance with. `amount`s are signed from the user's point of view -
// positive means that person owes the user, negative means the user owes
// them - which lets a debt in one group and a credit in another net off.
//
// The per-group breakdown is kept alongside the net figure rather than
// replaced by it, because settling up still happens one group at a time: if
// you owe Bob $10 in one group and he owes you $10 in another, you are even
// overall but there are still two balances to clear, and the breakdown is
// what says where. For the same reason a person whose net is exactly zero is
// still listed when there are balances underneath it.
function summarizeUserBalances(userId, groups) {
  const byPerson = new Map();

  for (const group of groups) {
    for (const debt of group.debts) {
      let otherId;
      let signed;
      if (debt.to === userId) {
        otherId = debt.from;
        signed = debt.amount;
      } else if (debt.from === userId) {
        otherId = debt.to;
        signed = -debt.amount;
      } else {
        // Two other members owing each other - nothing to do with this user.
        continue;
      }

      if (!byPerson.has(otherId)) byPerson.set(otherId, { userId: otherId, net: 0, groups: [] });
      const entry = byPerson.get(otherId);
      entry.net += signed;
      entry.groups.push({ id: group.id, name: group.name, amount: signed });
    }
  }

  const people = [...byPerson.values()]
    // Largest balances first, in either direction - what matters most is
    // what is biggest, not whether it is owed to you or by you.
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.userId - b.userId);

  // Totals are taken over the net figures, so a debt and a credit with the
  // same person cancel rather than inflating both sides.
  const totalOwedToYou = people.reduce((sum, p) => sum + Math.max(p.net, 0), 0);
  const totalYouOwe = people.reduce((sum, p) => sum + Math.max(-p.net, 0), 0);

  return { people, totalOwedToYou, totalYouOwe };
}

// Everything the user owes and is owed, across every group they belong to.
//
// Two queries in total, however many groups there are, rather than two per
// group - the naive version would issue a round trip pair for every group on
// every dashboard load.
async function getUserBalances(userId) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { group: { select: { id: true, name: true } } },
  });
  const groups = memberships.map((m) => m.group);
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length === 0) return { people: [], totalOwedToYou: 0, totalYouOwe: 0 };

  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({ where: { groupId: { in: groupIds } }, include: { splits: true } }),
    prisma.settlement.findMany({ where: { groupId: { in: groupIds } } }),
  ]);

  const withDebts = groups.map((group) => ({
    ...group,
    debts: computeDebts(
      expenses.filter((e) => e.groupId === group.id),
      settlements.filter((s) => s.groupId === group.id)
    ),
  }));

  return summarizeUserBalances(userId, withDebts);
}

module.exports = { getGroupBalances, getUserBalances, computeDebts, summarizeUserBalances };
