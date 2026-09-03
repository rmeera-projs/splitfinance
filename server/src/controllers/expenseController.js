const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { publicUserSelect } = require("../utils/publicUser");
const { categorizeExpense, FALLBACK_CATEGORY } = require("../services/categorizationService");

const splitSchema = z.object({
  userId: z.number(),
  amountOwed: z.number().positive(),
});

const createExpenseSchema = z.object({
  groupId: z.number(),
  paidBy: z.number(),
  amount: z.number().positive(),
  description: z.string().min(1),
  date: z.string().datetime().optional(),
  splits: z.array(splitSchema).min(1),
});

// Same shape as create, minus groupId - an expense can't be moved between
// groups, only edited in place.
const updateExpenseSchema = z.object({
  paidBy: z.number(),
  amount: z.number().positive(),
  description: z.string().min(1),
  date: z.string().datetime().optional(),
  splits: z.array(splitSchema).min(1),
});

// A finalized group is a closed ledger: no new/edited/deleted expenses, but
// settlements (see settlementController) are still allowed against it.
async function assertGroupNotFinalized(groupId) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { isFinalized: true },
  });
  if (group?.isFinalized) {
    throw new ApiError(400, "This group is finalized - reopen it to change expenses");
  }
}

async function createExpense(req, res, next) {
  try {
    const data = createExpenseSchema.parse(req.body);

    // Verify the splits actually sum to the total (within a cent of rounding).
    const splitTotal = data.splits.reduce((sum, s) => sum + s.amountOwed, 0);
    if (Math.abs(splitTotal - data.amount) > 0.01) {
      throw new ApiError(400, "Split amounts must sum to the total expense amount");
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: data.groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    await assertGroupNotFinalized(data.groupId);

    // Best-effort auto-categorization; categorizeExpense already falls back
    // to FALLBACK_CATEGORY internally, but guard here too so a surprise
    // throw can never block expense creation.
    const category = await categorizeExpense(data.description).catch(() => FALLBACK_CATEGORY);

    const expense = await prisma.expense.create({
      data: {
        groupId: data.groupId,
        paidBy: data.paidBy,
        amount: data.amount,
        description: data.description,
        category,
        date: data.date ? new Date(data.date) : undefined,
        splits: {
          create: data.splits.map((s) => ({
            userId: s.userId,
            amountOwed: s.amountOwed,
          })),
        },
      },
      include: { splits: true, payer: { select: publicUserSelect } },
    });

    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
}

async function updateExpense(req, res, next) {
  try {
    const expenseId = Number(req.params.id);
    const data = updateExpenseSchema.parse(req.body);

    const splitTotal = data.splits.reduce((sum, s) => sum + s.amountOwed, 0);
    if (Math.abs(splitTotal - data.amount) > 0.01) {
      throw new ApiError(400, "Split amounts must sum to the total expense amount");
    }

    const existing = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!existing) throw new ApiError(404, "Expense not found");

    // Only the person who logged the payment can edit it (same rule as delete).
    if (existing.paidBy !== req.userId) {
      throw new ApiError(403, "Only the payer can edit this expense");
    }

    await assertGroupNotFinalized(existing.groupId);

    // Only re-run categorization when the description actually changed -
    // avoids burning a Cohere call on every edit, and keeps a manually
    // corrected category from getting silently overwritten by unrelated edits.
    const category =
      data.description === existing.description
        ? existing.category
        : await categorizeExpense(data.description).catch(() => FALLBACK_CATEGORY);

    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        paidBy: data.paidBy,
        amount: data.amount,
        description: data.description,
        category,
        date: data.date ? new Date(data.date) : undefined,
        splits: {
          deleteMany: {},
          create: data.splits.map((s) => ({
            userId: s.userId,
            amountOwed: s.amountOwed,
          })),
        },
      },
      include: { splits: true, payer: { select: publicUserSelect } },
    });

    res.json(expense);
  } catch (err) {
    next(err);
  }
}

async function deleteExpense(req, res, next) {
  try {
    const expenseId = Number(req.params.id);
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new ApiError(404, "Expense not found");

    // Only the person who logged the payment can delete it.
    if (expense.paidBy !== req.userId) {
      throw new ApiError(403, "Only the payer can delete this expense");
    }

    await assertGroupNotFinalized(expense.groupId);

    await prisma.expense.delete({ where: { id: expenseId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { createExpense, updateExpense, deleteExpense };
