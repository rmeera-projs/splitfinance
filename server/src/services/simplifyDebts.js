/**
 * Debt simplification: given a list of raw debts within a group, net them
 * down and settle the group in at most (n - 1) transactions for n people.
 *
 * Approach (greedy largest-first matching):
 *   1. Reduce all pairwise debts to a single net balance per person
 *      (positive = is owed money, negative = owes money).
 *   2. Repeatedly settle the largest creditor against the largest debtor.
 *      Each pass zeroes out at least one person's balance, so the process
 *      terminates in at most (n - 1) transactions.
 *
 * The (n - 1) bound is guaranteed. Minimising the transaction count in the
 * general case is NP-hard (it reduces to partitioning the balances into as
 * many zero-sum subsets as possible), so this deliberately doesn't claim to
 * be optimal - it's the same well-known heuristic Splitwise uses in
 * practice, and it does well for typical group sizes.
 *
 * Every amount in and out is integer cents (see src/utils/money.js), which
 * is what lets "settled" mean exactly zero rather than "within a cent".
 *
 * @param {Array<{from: number, to: number, amount: number}>} debts
 *   Raw debts in cents, e.g. [{ from: userIdA, to: userIdB, amount: 2000 }]
 *   meaning "A owes B $20.00".
 * @returns {Array<{from: number, to: number, amount: number}>}
 *   Simplified list of payments, in cents, that settles the group.
 */
function simplifyDebts(debts) {
  const netBalance = new Map();

  for (const { from, to, amount } of debts) {
    if (amount <= 0) continue;
    netBalance.set(from, (netBalance.get(from) || 0) - amount);
    netBalance.set(to, (netBalance.get(to) || 0) + amount);
  }

  // Split into creditors (positive balance) and debtors (negative balance),
  // ignoring anyone already settled. Every amount here is integer cents, so
  // "settled" is exactly zero - this used to need a 0.01 epsilon to absorb
  // float drift, which also meant a genuine one-cent debt was silently
  // treated as settled.
  const creditors = [];
  const debtors = [];

  for (const [userId, balance] of netBalance.entries()) {
    if (balance > 0) creditors.push({ userId, balance });
    else if (balance < 0) debtors.push({ userId, balance: -balance });
  }

  // Largest balances first, so the two-pointer walk below actually matches
  // the biggest debtor against the biggest creditor each pass. Without this
  // the walk still settles the group within the same (n - 1) bound, but in
  // whatever arbitrary order the debts happened to arrive in - matching
  // large against large is what tends to zero two people out at once, and
  // it makes the result stable regardless of expense ordering.
  creditors.sort((a, b) => b.balance - a.balance);
  debtors.sort((a, b) => b.balance - a.balance);

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
      // Already a whole number of cents - no rounding needed, where the
      // float version had to round every transaction back to 2dp.
      amount: settledAmount,
    });

    debtor.balance -= settledAmount;
    creditor.balance -= settledAmount;

    if (debtor.balance === 0) i++;
    if (creditor.balance === 0) j++;
  }

  return transactions;
}

module.exports = { simplifyDebts };
