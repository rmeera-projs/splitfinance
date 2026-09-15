const prisma = require("../config/prisma");

const RECENT_WINDOW_DAYS = 7;
const RECENT_LIST_SIZE = 5;

// Platform-wide counts and a short recent-activity glance - nothing here
// is scoped to a group or a specific user, which is exactly why it's
// gated by requireAdmin rather than the usual group-membership checks
// the rest of the API uses.
async function getStats(req, res, next) {
  try {
    const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

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
      prisma.user.count(),
      prisma.group.count(),
      prisma.expense.count(),
      prisma.settlement.count(),
      prisma.expense.aggregate({ _sum: { amount: true } }),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.group.count({ where: { createdAt: { gte: since } } }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: RECENT_LIST_SIZE,
        select: { id: true, name: true, username: true, createdAt: true },
      }),
      prisma.group.findMany({
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
