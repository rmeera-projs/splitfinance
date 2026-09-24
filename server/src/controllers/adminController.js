const prisma = require("../config/prisma");

const RECENT_WINDOW_DAYS = 7;
const RECENT_LIST_SIZE = 5;

// Platform-wide counts and a short recent-activity glance - nothing here
// is scoped to a group or a specific user, which is exactly why it's
// gated by requireAdmin rather than the usual group-membership checks
// the rest of the API uses.
//
// Every query below excludes isDemo data. Without that, one click of "Try
// the demo" (demoSeedService.js) inflates every total by a handful of
// users/groups/expenses that no real person created, and - worse for a
// "recent activity" glance - can knock actual recent signups/groups
// straight off the bottom of a 5-row list. Expense/Settlement have no
// isDemo column of their own; they're demo-or-not by way of the group
// they belong to, so those two are scoped through that relation instead.
async function getStats(req, res, next) {
  try {
    const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const notDemoGroup = { group: { isDemo: false } };

    const [
      totalUsers,
      totalGroups,
      totalExpenses,
      totalSettlements,
      expenseAmountAgg,
      newUsers,
      newGroups,
      recentUsers,
      recentGroups,
    ] = await Promise.all([
      prisma.user.count({ where: { isDemo: false } }),
      prisma.group.count({ where: { isDemo: false } }),
      prisma.expense.count({ where: notDemoGroup }),
      prisma.settlement.count({ where: notDemoGroup }),
      prisma.expense.aggregate({ where: notDemoGroup, _sum: { amount: true } }),
      prisma.user.count({ where: { isDemo: false, createdAt: { gte: since } } }),
      prisma.group.count({ where: { isDemo: false, createdAt: { gte: since } } }),
      prisma.user.findMany({
        where: { isDemo: false },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIST_SIZE,
        select: { id: true, name: true, username: true, createdAt: true },
      }),
      prisma.group.findMany({
        where: { isDemo: false },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIST_SIZE,
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
      }),
    ]);

    res.json({
      totals: {
        users: totalUsers,
        groups: totalGroups,
        expenses: totalExpenses,
        settlements: totalSettlements,
      },
      // Cents. Prisma sums an Int column to a plain number, but it can be
      // null when there are no expenses at all, hence the fallback.
      totalExpenseAmount: expenseAmountAgg._sum.amount || 0,
      recentWindowDays: RECENT_WINDOW_DAYS,
      newUsers,
      newGroups,
      recentUsers,
      recentGroups: recentGroups.map((g) => ({
        id: g.id,
        name: g.name,
        createdAt: g.createdAt,
        memberCount: g._count.members,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStats };
