const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { groupUserSelect } = require("../utils/publicUser");
const { assertGroupNotFinalized } = require("../utils/assertGroupNotFinalized");
const { assertGroupMembers } = require("../utils/assertGroupMembers");
const { categorizeExpense, FALLBACK_CATEGORY, CATEGORIES } = require("../services/categorizationService");
const { parseExpenseText } = require("../services/expenseParsingService");
const { emitGroupActivity } = require("../services/realtimeService");
const { id, requiredText, amountInCents } = require("../utils/validators");

// Every amount on the wire is integer cents, never dollars - $10.23 is
// 1023 (see src/utils/money.js). Rejecting non-integers at the schema is
// what lets the sum check below be exact equality instead of a tolerance.
// amountInCents also caps at the INTEGER column's own limit
// ($21,474,836.47); without that an oversized amount would reach Postgres
// and come back as an out-of-range 500 rather than a clean 400. Field
// wording lives in utils/validators.js.

const splitSchema = z.object({
  userId: id("Split member"),
  amountOwed: amountInCents(),
});

const expenseDate = () => z.iso.datetime({ error: "Date must be a valid date and time" }).optional();

const splits = () =>
  z
    .array(splitSchema, { error: "Splits must be a list" })
    .min(1, "An expense must be split between at least one person");

const createExpenseSchema = z.object({
  groupId: id("Group"),
  paidBy: id("Payer"),
  amount: amountInCents(),
  description: requiredText("Description"),
  date: expenseDate(),
  splits: splits(),
});

// Same shape as create, minus groupId - an expense can't be moved between
// groups, only edited in place.
const updateExpenseSchema = z.object({
  paidBy: id("Payer"),
  amount: amountInCents(),
  description: requiredText("Description"),
  date: expenseDate(),
  splits: splits(),
});

const updateCategorySchema = z.object({
  category: z.enum(CATEGORIES, { error: "Choose one of the listed categories" }),
});

const parseExpenseSchema = z.object({
  groupId: id("Group"),
  text: requiredText("Expense text"),
});

async function createExpense(req, res, next) {
  try {
    const data = createExpenseSchema.parse(req.body);

    // Exact equality, not a tolerance: both sides are integer cents, so
    // there's no rounding slop to absorb. The old float version allowed a
    // discrepancy of up to a full cent through on every expense.
    const splitTotal = data.splits.reduce((sum, s) => sum + s.amountOwed, 0);
    if (splitTotal !== data.amount) {
      throw new ApiError(400, "Split amounts must sum to the total expense amount");
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: data.groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    // The requester being a member only proves *they* belong here - paidBy
    // and every split participant are separate user ids the request
    // supplies, and the database won't stop a reference to some other
    // registered user who isn't actually in this group.
    await assertGroupMembers(data.groupId, {
      paidBy: [data.paidBy],
      "splits[].userId": data.splits.map((s) => s.userId),
    });

    await assertGroupNotFinalized(data.groupId);

    // Best-effort auto-categorization; categorizeExpense already falls back
    // to FALLBACK_CATEGORY internally, but guard here too so a surprise
    // throw can never block expense creation.
    //
    // Skipped entirely for an unverified account. Adding an expense is core
    // functionality and stays open to everyone (which is why this route has
    // no requireVerifiedEmail on it, unlike /parse) - but the Cohere call
    // hidden inside it is the metered part, so that is what gets withheld.
    // The expense is still created, just in the default category, which the
    // user can set by hand.
    const category = req.emailVerified
      ? await categorizeExpense(data.description).catch(() => FALLBACK_CATEGORY)
      : FALLBACK_CATEGORY;

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
      include: { splits: true, payer: { select: groupUserSelect } },
    });

    emitGroupActivity(data.groupId, { type: "expense-added", actorId: req.userId });
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
}

async function updateExpense(req, res, next) {
  try {
    const expenseId = Number(req.params.id);
    const data = updateExpenseSchema.parse(req.body);

    // Exact, for the same reason as createExpense above.
    const splitTotal = data.splits.reduce((sum, s) => sum + s.amountOwed, 0);
    if (splitTotal !== data.amount) {
      throw new ApiError(400, "Split amounts must sum to the total expense amount");
    }

    const existing = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!existing) throw new ApiError(404, "Expense not found");

    // Only the person who logged the payment can edit it (same rule as delete).
    if (existing.paidBy !== req.userId) {
      throw new ApiError(403, "Only the payer can edit this expense");
    }

    // Same reasoning as createExpense - paidBy/split participants are
    // separate user ids the request supplies, not implied by the requester
    // already being a member of this group.
    await assertGroupMembers(existing.groupId, {
      paidBy: [data.paidBy],
      "splits[].userId": data.splits.map((s) => s.userId),
    });

    await assertGroupNotFinalized(existing.groupId);

    // Only re-run categorization when the description actually changed -
    // avoids burning a Cohere call on every edit, and keeps a manually
    // corrected category from getting silently overwritten by unrelated edits.
    // Unverified accounts keep whatever category is already set rather than
    // re-running the Cohere call - same reasoning as createExpense above.
    const category =
      data.description === existing.description || !req.emailVerified
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
      include: { splits: true, payer: { select: groupUserSelect } },
    });

    emitGroupActivity(existing.groupId, { type: "expense-updated", actorId: req.userId });
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
      include: { splits: true, payer: { select: groupUserSelect } },
    });

    emitGroupActivity(existing.groupId, { type: "expense-category", actorId: req.userId });
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
    emitGroupActivity(expense.groupId, { type: "expense-deleted", actorId: req.userId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function listCategories(req, res) {
  res.json({ categories: CATEGORIES });
}

// Parses a free-text sentence ("Dinner $60, I paid, split with Bob and
// Charlie") into a { description, amount, payerId, splitWithIds } suggestion
// for the client to pre-fill its add-expense form with - this never creates
// an expense itself, so a bad parse just means re-typing the sentence or
// editing the pre-filled form, not a wrong charge silently going through.
async function parseExpense(req, res, next) {
  try {
    const { groupId, text } = parseExpenseSchema.parse(req.body);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.userId } },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this group");

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: groupUserSelect } },
    });
    const memberList = members.map((m) => ({ id: m.user.id, name: m.user.name }));

    const result = await parseExpenseText(text, memberList, req.userId);
    if (!result) {
      throw new ApiError(422, 'Couldn\'t understand that - try including an amount, e.g. "Dinner $45"');
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { createExpense, updateExpense, updateExpenseCategory, deleteExpense, listCategories, parseExpense };
