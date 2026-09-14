const { CohereClient } = require("cohere-ai");

function getClient() {
  if (!process.env.COHERE_API_KEY) return null;
  return new CohereClient({ token: process.env.COHERE_API_KEY });
}

// "$45", "45.50", "45 dollars" - captures the numeric part either way. Used
// both to build the fallback parse below and to sanity-check whatever
// number the model comes back with.
const AMOUNT_RE = /\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars?)?/i;

function buildPrompt(text, members, currentUserId) {
  const memberList = members
    .map((m) => `- id ${m.id}: ${m.name}${m.id === currentUserId ? ' (this is the current user - "I"/"me"/"my" means them)' : ""}`)
    .join("\n");

  return (
    "You extract structured expense data from one sentence for a bill-splitting app. " +
    "Reply with ONLY a single JSON object, no markdown formatting and no explanation.\n\n" +
    "Group members:\n" +
    `${memberList}\n\n` +
    "JSON shape:\n" +
    '{"description": string, "amount": number, "payerId": number|null, "splitWithIds": number[]|null}\n\n' +
    "Rules:\n" +
    '- "description" is a short label for what the expense was for, with the amount/payer/split details removed\n' +
    '- "amount" is the total cost as a plain number, no currency symbol\n' +
    '- "payerId" is one of the member ids above, matched by name - null if the sentence doesn\'t say who paid\n' +
    '- "splitWithIds" is the list of member ids to split the cost between, matched by name - null if the ' +
    "sentence doesn't specify (meaning split with everyone, which the caller decides, not you)\n\n" +
    `Sentence: "${text}"\nJSON:`
  );
}

// Cohere sometimes wraps its answer in a ```json fence despite being told
// not to - strip that before parsing rather than failing on it.
function extractJson(rawText) {
  if (!rawText) return null;
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// Keeps only ids that actually belong to this group - the model can
// hallucinate an id, or a caller could feed it a stale member list.
function sanitizeIds(ids, validIds) {
  if (!Array.isArray(ids)) return null;
  const filtered = ids.filter((id) => validIds.has(id));
  return filtered.length > 0 ? filtered : null;
}

function sanitizeResult(parsed, members) {
  if (!parsed || typeof parsed !== "object") return null;

  const amount = Number(parsed.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const validIds = new Set(members.map((m) => m.id));
  const payerId = validIds.has(parsed.payerId) ? parsed.payerId : null;

  return {
    description: typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim() : null,
    amount,
    payerId,
    splitWithIds: sanitizeIds(parsed.splitWithIds, validIds),
  };
}

// No API key configured - a much cruder regex-only parse so the feature
// still does *something* locally without requiring a Cohere key, same
// "optional until you need it" spirit as categorizeExpense's fallback.
// Only ever fills in amount/description; payer/split are left for the
// user to pick, same as manually filling out the form.
function heuristicParse(text) {
  const match = text.match(AMOUNT_RE);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const description = text.replace(match[0], "").replace(/\bpaid by\b|\bsplit with\b/gi, "").trim() || null;

  return { description, amount, payerId: null, splitWithIds: null };
}

/**
 * Parses a free-text sentence like "Dinner at Olive Garden $60, I paid,
 * split with Bob and Charlie" into a structured expense suggestion the
 * client can pre-fill its add-expense form with. Never invents a payer or
 * split the sentence didn't actually specify - `null` there means "the
 * user should pick," not "split with everyone," which is a decision this
 * service deliberately leaves to the caller.
 *
 * @param {string} text
 * @param {{id: number, name: string}[]} members - the group's current members
 * @param {number} currentUserId - resolves "I"/"me"/"my" in the sentence
 * @param {{ client?: import("cohere-ai").CohereClient }} [options] - inject
 *   a client (e.g. a mock in tests) instead of building one from env.
 * @returns {Promise<{description: string|null, amount: number, payerId: number|null, splitWithIds: number[]|null} | null>}
 *   null means the sentence couldn't be understood at all - the caller
 *   should ask the user to rephrase or fill out the form manually.
 */
async function parseExpenseText(text, members, currentUserId, options = {}) {
  if (!text || !text.trim()) return null;

  const client = options.client || getClient();
  if (!client) return heuristicParse(text);

  try {
    const response = await client.chat({
      model: "command-r7b-12-2024",
      message: buildPrompt(text, members, currentUserId),
      temperature: 0,
    });

    const parsed = extractJson(response && response.text);
    return sanitizeResult(parsed, members) || heuristicParse(text);
  } catch (err) {
    console.error("Cohere expense parsing failed, falling back to a plain-text guess:", err.message);
    return heuristicParse(text);
  }
}

module.exports = { parseExpenseText };
