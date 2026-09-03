const { CohereClient } = require("cohere-ai");

// Fixed set of categories the model is allowed to choose from. Keep this in
// sync with any category list surfaced in the client UI.
const CATEGORIES = [
  "Food & Drink",
  "Groceries",
  "Transportation",
  "Housing & Utilities",
  "Entertainment",
  "Shopping",
  "Travel",
  "Health & Wellness",
  "Other",
];

const FALLBACK_CATEGORY = "Other";

// Cohere's Classify endpoint is deprecated, so categorization is driven by a
// few-shot prompt over the Chat endpoint instead - one example per category.
const FEW_SHOT_EXAMPLES = [
  { description: "Dinner at Olive Garden", category: "Food & Drink" },
  { description: "Weekly grocery run at Trader Joe's", category: "Groceries" },
  { description: "Uber to the airport", category: "Transportation" },
  { description: "Electricity bill", category: "Housing & Utilities" },
  { description: "Movie tickets", category: "Entertainment" },
  { description: "New running shoes", category: "Shopping" },
  { description: "Flight to Chicago", category: "Travel" },
  { description: "Pharmacy - ibuprofen", category: "Health & Wellness" },
  { description: "Parking garage validation stickers", category: "Other" },
];

function buildPrompt(description) {
  const examples = FEW_SHOT_EXAMPLES.map(
    (ex) => `Description: "${ex.description}"\nCategory: ${ex.category}`
  ).join("\n\n");

  return (
    "You are classifying expenses for a bill-splitting app into exactly one of the following categories:\n" +
    `${CATEGORIES.join(", ")}\n\n` +
    "Reply with only the category name, exactly as written above, and nothing else.\n\n" +
    `${examples}\n\n` +
    `Description: "${description}"\nCategory:`
  );
}

// Cohere sometimes wraps the answer in quotes/punctuation or varies casing;
// match it back to the fixed list rather than trusting the raw string.
function normalizeCategory(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.trim().replace(/^["'\s]+|["'.\s]+$/g, "");
  return CATEGORIES.find((c) => c.toLowerCase() === cleaned.toLowerCase()) || null;
}

function getClient() {
  if (!process.env.COHERE_API_KEY) return null;
  return new CohereClient({ token: process.env.COHERE_API_KEY });
}

/**
 * Categorize an expense description into one of the fixed CATEGORIES using
 * Cohere's Chat endpoint with a few-shot prompt. Never throws - any failure
 * (missing API key, network/API error, an unrecognized response) falls back
 * to "Other" so expense creation is never blocked on the model.
 *
 * @param {string} description
 * @param {{ client?: import("cohere-ai").CohereClient }} [options] - inject
 *   a client (e.g. a mock in tests) instead of building one from env.
 * @returns {Promise<string>} one of CATEGORIES
 */
async function categorizeExpense(description, options = {}) {
  const client = options.client || getClient();
  if (!client || !description || !description.trim()) {
    return FALLBACK_CATEGORY;
  }

  try {
    const response = await client.chat({
      // command-r was retired Sept 2025; command-r7b is its fast/cheap
      // successor and is plenty for a single-label classification prompt.
      model: "command-r7b-12-2024",
      message: buildPrompt(description),
      temperature: 0,
    });

    return normalizeCategory(response && response.text) || FALLBACK_CATEGORY;
  } catch (err) {
    console.error("Cohere categorization failed, falling back to 'Other':", err.message);
    return FALLBACK_CATEGORY;
  }
}

module.exports = { categorizeExpense, CATEGORIES, FALLBACK_CATEGORY };
