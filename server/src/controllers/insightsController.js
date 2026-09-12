const prisma = require("../config/prisma");

// Returns every expense-split "share" belonging to the current user, across
// every group they're a member of - this is the raw material for the
// personal spending dashboard. Aggregation (by category, by group, by
// time bucket) happens client-side rather than here, since the volume is
// small (one person's splits) and it lets the UI switch time granularity
// instantly with no refetch. See client/src/utils/insights.js.
async function getMyInsights(req, res, next) {
  try {
    const splits = await prisma.expenseSplit.findMany({
      where: { userId: req.userId },
      include: {
        expense: {
          select: {
            category: true,
            date: true,
            groupId: true,
            group: { select: { name: true } },
          },
        },
      },
    });

    const items = splits.map((s) => ({
      amount: Number(s.amountOwed),
      category: s.expense.category,
      date: s.expense.date,
      groupId: s.expense.groupId,
      groupName: s.expense.group.name,
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyInsights };
