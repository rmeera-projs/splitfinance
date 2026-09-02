/**
 * Debt simplification: given a list of raw debts within a group, produce the
 * minimum number of transactions needed to settle all balances.
 *
 * Approach (greedy max-flow matching):
 *   1. Reduce all pairwise debts to a single net balance per person
 *      (positive = is owed money, negative = owes money).
 *   2. Repeatedly settle the largest creditor against the largest debtor.
 *      Each settlement zeroes out at least one person's balance, so the
 *      process terminates in at most (n - 1) transactions for n people.
 *
 * This is a well-known heuristic (not always provably optimal in the
 * general min-transaction sense, which is NP-hard), but it's the same
 * approach Splitwise uses in practice and performs well for typical
 * group sizes.
 *
 * @param {Array<{from: number, to: number, amount: number}>} debts
 *   Raw debts, e.g. [{ from: userIdA, to: userIdB, amount: 20 }, ...]
 *   meaning "A owes B $20".
 * @returns {Array<{from: number, to: number, amount: number}>}
 *   Simplified list of payments that settles the group.
 */
function simplifyDebts(debts) {
  const netBalance = new Map();

  for (const { from, to, amount } of debts) {
    if (amount <= 0) continue;
    netBalance.set(from, (netBalance.get(from) || 0) - amount);
    netBalance.set(to, (netBalance.get(to) || 0) + amount);
  }

  // Split into creditors (positive balance) and debtors (negative balance),
  // ignoring anyone already settled (balance ~0).
  const EPSILON = 0.01; // cents-level rounding tolerance
  const creditors = [];
  const debtors = [];

  for (const [userId, balance] of netBalance.entries()) {
    if (balance > EPSILON) creditors.push({ userId, balance });
    else if (balance < -EPSILON) debtors.push({ userId, balance: -balance });
  }

  const transactions = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const settledAmount = Math.min(debtor.balance, creditor.balance);
    transactions.push({
      from: debtor.userId,
      to: creditor.userId,
      amount: Math.round(settledAmount * 100) / 100,
    });

    debtor.balance -= settledAmount;
    creditor.balance -= settledAmount;

    if (debtor.balance < EPSILON) i++;
    if (creditor.balance < EPSILON) j++;
  }

  return transactions;
}

module.exports = { simplifyDebts };
