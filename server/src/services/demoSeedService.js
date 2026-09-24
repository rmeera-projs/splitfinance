const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const { splitEvenly } = require("../utils/money");

// Backs "Try the demo" - a fresh, isolated sandbox account created on the
// spot rather than one fixed shared login. A shared demo account means
// concurrent visitors stomp on each other's data (one deletes the expenses
// another is mid-tour of), needs a published password, and needs manual
// reseeding once it drifts from its starting state. A fresh sandbox per
// click sidesteps all three: nobody else can reach it, nothing to publish,
// and it starts clean every time by construction.
//
// Deliberately NOT email-verified. requireVerifiedEmail.js exists because
// signup is free and instant, which makes throwaway accounts the cheap
// route to this project's metered Cohere quota - a demo account is *more*
// throwaway than an ordinary signup (it needs no email at all), so
// pre-verifying it would reopen exactly the hole that middleware closes,
// worse than before. The AI-powered actions stay behind the same "confirm
// your email" wall as any other unverified account; the seeded expenses
// below are already given realistic categories so the categorization
// feature still has something to show even though this account can't
// trigger it live.
//
// Cleanup is lazy rather than a scheduled job: every call here first
// deletes any of its own past sandboxes older than MAX_AGE_MS. That is
// enough to keep the database bounded without new infrastructure (no cron,
// no extra AWS resource) as long as the endpoint gets clicked occasionally;
// a sandbox created and never revisited outlives its age by however long it
// takes for the *next* demo request to arrive and sweep it up.

const SALT_ROUNDS = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CATEGORIES = {
  rent: "Housing & Utilities",
  groceries: "Groceries",
  dinner: "Food & Drink",
  movie: "Entertainment",
  gas: "Transportation",
};

function randomSuffix() {
  return crypto.randomBytes(4).toString("hex");
}

// Deletes every demo User/Group older than MAX_AGE_MS, in dependency order
// (children before parents) - User/Group rows the rest of the schema does
// NOT cascade-delete for (Group.owner, Expense.payer, ExpenseSplit.user,
// Settlement.from/to are all onDelete: Restrict by default, unlike
// GroupMember, which does cascade). Every query below filters on isDemo, so
// a bug elsewhere in the app can't make this reach a real account's data -
// there is no join or derived condition to get subtly wrong.
async function cleanupExpiredDemoAccounts() {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);

  const expiredGroups = await prisma.group.findMany({
    where: { isDemo: true, createdAt: { lt: cutoff } },
    select: { id: true },
  });
  const groupIds = expiredGroups.map((g) => g.id);

  if (groupIds.length > 0) {
    await prisma.expenseSplit.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
    await prisma.expense.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.settlement.deleteMany({ where: { groupId: { in: groupIds } } });
    // GroupMember rows are cascade-deleted by the Group delete below.
    await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
  }

  // Deleted independently of the group sweep above (not "the owner of one
  // of those groups"): a synthetic co-member never owns a group, so it
  // would never be reached by a groupIds-based query, only by its own
  // isDemo flag and age.
  await prisma.user.deleteMany({ where: { isDemo: true, createdAt: { lt: cutoff } } });
}

// A password nobody needs to know: this account is only ever reached by
// the cookie createDemoAccount sets directly on the response, never by
// typing credentials into the login form. Still a real bcrypt hash rather
// than a placeholder, so no other code path (changePassword, the login
// form itself if someone goes looking) has to special-case a demo account.
async function randomPasswordHash() {
  return bcrypt.hash(crypto.randomBytes(24).toString("hex"), SALT_ROUNDS);
}

async function createDemoUser(tx, { name, username }) {
  const suffix = randomSuffix();
  return tx.user.create({
    data: {
      name,
      username: `${username}_${suffix}`,
      email: `${username}_${suffix}@demo.splitfinance.org`,
      passwordHash: await randomPasswordHash(),
      isDemo: true,
    },
  });
}

// Splits so the parts sum to the total exactly - the API enforces that with
// no tolerance (see utils/money.js), and a demo account is not exempt.
function buildSplits(memberIds, totalCents) {
  const shares = splitEvenly(totalCents, memberIds.length);
  return memberIds.map((userId, i) => ({ userId, amountOwed: shares[i] }));
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/**
 * Creates a fresh demo sandbox: a primary user plus two synthetic
 * co-members, a group they all share, a handful of realistic expenses
 * (pre-categorized, split between varying subsets of the three), and one
 * settlement - a mix of "owed to you" and "you owe" so the balances and
 * insights pages have something worth looking at immediately.
 *
 * @returns {Promise<import("@prisma/client").User>} the primary demo user -
 *   the one the caller should log in (setAuthCookie), never the co-members.
 */
async function createDemoAccount() {
  await cleanupExpiredDemoAccounts();

  // Prisma's interactive transaction form (a callback, not the `[...]`
  // batch array used elsewhere in this codebase) - needed because each
  // step here depends on an id the previous one just created (the group's
  // id for its expenses, the users' ids for the group's membership), which
  // a batch of independent operations can't express.
  return prisma.$transaction(async (tx) => {
    const me = await createDemoUser(tx, { name: "Demo User", username: "demo" });
    const alex = await createDemoUser(tx, { name: "Alex Morgan", username: "alex" });
    const jordan = await createDemoUser(tx, { name: "Jordan Lee", username: "jordan" });
    const memberIds = [me.id, alex.id, jordan.id];

    const group = await tx.group.create({
      data: {
        name: "Ski Trip",
        createdBy: me.id,
        isDemo: true,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
    });

    const expenses = [
      { description: "Cabin rental", amount: 60000, category: CATEGORIES.rent, paidBy: me.id, days: 6, split: memberIds },
      { description: "Grocery run", amount: 8750, category: CATEGORIES.groceries, paidBy: alex.id, days: 5, split: memberIds },
      { description: "Dinner at the lodge", amount: 12400, category: CATEGORIES.dinner, paidBy: jordan.id, days: 4, split: memberIds },
      { description: "Movie night", amount: 3600, category: CATEGORIES.movie, paidBy: me.id, days: 3, split: [me.id, alex.id] },
      { description: "Gas for the drive up", amount: 5200, category: CATEGORIES.gas, paidBy: alex.id, days: 6, split: memberIds },
    ];

    for (const e of expenses) {
      await tx.expense.create({
        data: {
          groupId: group.id,
          paidBy: e.paidBy,
          amount: e.amount,
          description: e.description,
          category: e.category,
          date: daysAgo(e.days),
          splits: { create: buildSplits(e.split, e.amount) },
        },
      });
    }

    // One partial settlement, so the group shows a mix of settled and
    // outstanding rather than either extreme.
    await tx.settlement.create({
      data: { groupId: group.id, fromUser: jordan.id, toUser: me.id, amount: 2000, date: daysAgo(1) },
    });

    return me;
  });
}

module.exports = { createDemoAccount, cleanupExpiredDemoAccounts, MAX_AGE_MS };
