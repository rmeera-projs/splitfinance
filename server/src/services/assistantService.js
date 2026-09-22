const { CohereClientV2 } = require("cohere-ai");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");
const { getUserBalances, getGroupBalances } = require("./balanceService");
const { aggregateByCategory } = require("./insightsAggregation");
const { formatCents } = require("../utils/money");
const { groupUserSelect } = require("../utils/publicUser");
const { CATEGORIES } = require("./categorizationService");

// A conversational front end over balanceService.js/insightsAggregation.js -
// "how much did I spend on food?" as a question instead of a page to read.
//
// The rule every tool is built around: no tool takes a userId parameter.
// Each closes over the authenticated caller instead, so there's no argument
// a prompt-injection payload in an expense description could use to ask for
// someone else's data. groupId is unavoidable, so any tool that takes one
// checks membership first - the same boundary the app enforces at the route
// level, just enforced here too.
//
// Every tool is read-only - an agent that can act on a sentence it read is a
// different risk class than one that only answers, and settling up stays a
// deliberate button press.

// command-r7b (used by categorizationService/expenseParsingService) has no
// documented tool-use support - command-a-03-2025 is the model the
// cohere-ai SDK's own reference docs use for v2 chat/tool-calling examples.
const MODEL = "command-a-03-2025";

// Multi-turn tool use is several Cohere calls for one user question. This
// bounds the worst case (a model that keeps calling tools instead of
// answering) to a fixed, small cost instead of an unbounded one.
const MAX_TOOL_ROUNDS = 4;

// Only ever answers for the caller's own history/groups - never persisted,
// never includes another user's data. Kept short and factual on purpose:
// this assistant's whole value is being trustworthy about numbers it did
// not invent, not being chatty.
const SYSTEM_PROMPT =
  "You are a balances and spending assistant for SplitFinance, a bill-splitting app. " +
  "Answer questions about the current user's own balances, groups, and spending by calling the " +
  "tools provided - never guess or calculate a dollar figure yourself. Every tool result already " +
  "has amounts formatted as dollar strings (e.g. \"12.50\"); quote them back exactly as given, " +
  "prefixed with $. If a tool reports an error (e.g. the user isn't a member of a group), relay " +
  "that plainly rather than retrying with a different guess. Keep answers short - a sentence or " +
  "two, not a report.";

function getClient() {
  if (!process.env.COHERE_API_KEY) return null;
  return new CohereClientV2({ token: process.env.COHERE_API_KEY });
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------
// Each takes (args, ctx) where ctx = { userId } and returns a plain,
// JSON-serializable result - never throws for an expected condition (e.g.
// "not a member of that group"), since a thrown error would abort the whole
// request instead of giving the model something to relay to the user.

async function resolveNames(userIds) {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: groupUserSelect });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function toolGetMyBalances(_args, ctx) {
  const { people, totalOwedToYou, totalYouOwe } = await getUserBalances(ctx.userId);
  const names = await resolveNames(people.map((p) => p.userId));

  return {
    totalOwedToYouDollars: formatCents(totalOwedToYou),
    totalYouOweDollars: formatCents(totalYouOwe),
    people: people.map((p) => ({
      name: names.get(p.userId) || `User ${p.userId}`,
      // Positive netDollars means this person owes the current user;
      // negative means the current user owes them.
      netDollars: formatCents(p.net),
      groups: p.groups.map((g) => ({ groupName: g.name, amountDollars: formatCents(g.amount) })),
    })),
  };
}

async function toolListMyGroups(_args, ctx) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId: ctx.userId },
    select: { group: { select: { id: true, name: true } } },
  });
  return { groups: memberships.map((m) => ({ groupId: m.group.id, name: m.group.name })) };
}

async function toolGetGroupBalances(args, ctx) {
  const groupId = Number(args.groupId);
  if (!Number.isInteger(groupId)) return { error: "groupId must be an integer" };

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: ctx.userId } },
  });
  if (!membership) return { error: "You are not a member of that group" };

  const [debts, members] = await Promise.all([
    getGroupBalances(groupId),
    prisma.groupMember.findMany({ where: { groupId }, include: { user: { select: groupUserSelect } } }),
  ]);
  const names = new Map(members.map((m) => [m.user.id, m.user.name]));

  return {
    debts: debts.map((d) => ({
      from: names.get(d.from) || `User ${d.from}`,
      to: names.get(d.to) || `User ${d.to}`,
      amountDollars: formatCents(d.amount),
    })),
  };
}

async function toolGetMySpending(args, ctx) {
  const where = { userId: ctx.userId };
  const expenseWhere = {};

  if (args.groupId !== undefined && args.groupId !== null) {
    const groupId = Number(args.groupId);
    if (!Number.isInteger(groupId)) return { error: "groupId must be an integer" };
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: ctx.userId } },
    });
    if (!membership) return { error: "You are not a member of that group" };
    expenseWhere.groupId = groupId;
  }

  if (args.category) {
    if (!CATEGORIES.includes(args.category)) {
      return { error: `category must be one of: ${CATEGORIES.join(", ")}` };
    }
    expenseWhere.category = args.category;
  }

  if (args.sinceDate || args.untilDate) {
    expenseWhere.date = {};
    if (args.sinceDate) expenseWhere.date.gte = new Date(args.sinceDate);
    if (args.untilDate) expenseWhere.date.lte = new Date(args.untilDate);
  }

  if (Object.keys(expenseWhere).length > 0) where.expense = expenseWhere;

  const splits = await prisma.expenseSplit.findMany({
    where,
    select: { amountOwed: true, expense: { select: { category: true } } },
  });

  const items = splits.map((s) => ({ amount: s.amountOwed, category: s.expense.category }));
  const byCategory = aggregateByCategory(items);
  const totalCents = items.reduce((sum, i) => sum + i.amount, 0);

  return {
    totalDollars: formatCents(totalCents),
    byCategory: byCategory.map((c) => ({ category: c.category, totalDollars: formatCents(c.totalCents) })),
  };
}

const TOOL_IMPLEMENTATIONS = {
  get_my_balances: toolGetMyBalances,
  list_my_groups: toolListMyGroups,
  get_group_balances: toolGetGroupBalances,
  get_my_spending: toolGetMySpending,
};

// ---------------------------------------------------------------------------
// Tool schemas (what the model sees)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_my_balances",
      description: "Get the current user's balances with every other person, across all their groups, netted per person.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_groups",
      description: "List the groups the current user belongs to, with their ids and names.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_group_balances",
      description: "Get who-owes-whom within one specific group. Requires the group's id - use list_my_groups first if you only have a name.",
      parameters: {
        type: "object",
        properties: { groupId: { type: "integer", description: "The group's id." } },
        required: ["groupId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_spending",
      description: "Get the current user's total spending (their share of expenses), optionally filtered by category, date range, and/or group. Omit filters for an all-time, all-category, all-group total.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: CATEGORIES, description: "Restrict to one expense category." },
          sinceDate: { type: "string", description: "ISO 8601 date - only expenses on or after this date." },
          untilDate: { type: "string", description: "ISO 8601 date - only expenses on or before this date." },
          groupId: { type: "integer", description: "Restrict to one group's id." },
        },
        required: [],
      },
    },
  },
];

function parseToolArguments(rawArguments) {
  if (!rawArguments) return {};
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Runs one user turn of the balances/spending assistant to completion,
 * driving Cohere's tool-calling loop until it produces a final text answer
 * (or the round cap is hit). `history` is the prior turns as plain
 * {role: "user"|"assistant", content} pairs - never tool-call internals,
 * which are reconstructed fresh each call rather than trusted from the
 * client.
 *
 * @param {number} userId - the authenticated caller; every tool is scoped
 *   to this id and cannot be redirected to anyone else's data.
 * @param {{role: "user"|"assistant", content: string}[]} history
 * @param {string} message - the new user message
 * @param {{ client?: import("cohere-ai").CohereClientV2 }} [options]
 * @returns {Promise<string>} the assistant's reply text
 */
async function askAssistant(userId, history, message, options = {}) {
  const client = options.client || getClient();
  if (!client) {
    // Absent, not broken - same posture as expenseParsingService and
    // categorizationService. 503, not 500, so errorHandler doesn't log it
    // as a bug.
    throw new ApiError(503, "The assistant isn't available right now");
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const ctx = { userId };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat({ model: MODEL, messages, tools: TOOLS });
    const assistantMessage = response.message;

    if (response.finishReason !== "TOOL_CALL" || !assistantMessage.toolCalls?.length) {
      return textFromContent(assistantMessage.content) || "I don't have an answer for that.";
    }

    messages.push({
      role: "assistant",
      toolPlan: assistantMessage.toolPlan,
      toolCalls: assistantMessage.toolCalls,
    });

    for (const call of assistantMessage.toolCalls) {
      const impl = TOOL_IMPLEMENTATIONS[call.function?.name];
      const args = parseToolArguments(call.function?.arguments);
      // A hallucinated tool name or a throwing implementation both become a
      // tool result the model can recover from, rather than a crashed request.
      let result;
      try {
        result = impl ? await impl(args, ctx) : { error: `Unknown tool: ${call.function?.name}` };
      } catch (err) {
        result = { error: `Tool failed: ${err.message}` };
      }
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
    }
  }

  return "That's taking a bit long to figure out - try asking a more specific question.";
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

module.exports = { askAssistant, TOOL_IMPLEMENTATIONS };
