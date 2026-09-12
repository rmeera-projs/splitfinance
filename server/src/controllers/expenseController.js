const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { publicUserSelect } = require("../utils/publicUser");
const { assertGroupNotFinalized } = require("../utils/assertGroupNotFinalized");
const { categorizeExpense, FALLBACK_CATEGORY, CATEGORIES } = require("../services/categorizationService");

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

const updateCategorySchema = z.object({
  category: z.enum(CATEGORIES),
});

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

// Lets any group member manually correct a mis-categorized expense - not
// restricted to the payer (unlike edit/delete), since the category is
// shared organizational metadata rather than a financial detail only the
// payer should control. Deliberately skips assertGroupNotFinalized too:
// finalizing freezes the financial ledger (amounts/splits), but relabeling
// an expense's category has no financial effect, so there's no reason to
// require reopening the group just to fix a tag.
async function updateExpenseCategory(req, res, next) {
  try {
    const expenseId = Number(req.params.id);
    const { category } = updateCategorySchema.parse(req.body);

    const existing = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!existing) throw new ApiError(404, "Expense not found");

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: existing.groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: { category },
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

async function listCategories(req, res) {
  res.json({ categories: CATEGORIES });
}

module.exports = { createExpense, updateExpense, updateExpenseCategory, deleteExpense, listCategories };
