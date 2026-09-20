const { CohereClientV2 } = require("cohere-ai");
const { numberToCents } = require("../utils/money");
const { ApiError } = require("../middleware/errorHandler");

// Reads a photographed receipt and returns the merchant, the total and the
// individual line items, for the add-expense form to pre-fill and for the
// per-item splitter. It never invents anything: a receipt the model can't
// read a total from returns null and the caller asks the user to type it in.
// The items are best-effort on top of that - a receipt with unreadable lines
// still yields a usable total and an empty item list.
//
// The image is passed straight through as a data URI and is never written
// anywhere - not to disk, not to the database. A receipt photo can carry a
// card's last digits, a name and a location, and the feature's whole output
// is a few fields, so keeping the image would only create something to leak
// (backups, snapshots) for no benefit. If a future change wants to retain
// receipts "for reference", that is the argument it has to answer.

// Vision-capable Cohere model. Kept as one constant so it is a one-line
// change if the id needs to move.
const MODEL = "command-a-vision-07-2025";

const PROMPT =
  "You read a photographed receipt for a bill-splitting app. Reply with ONLY a single JSON object, " +
  "no markdown and no explanation.\n\n" +
  'JSON shape: {"merchant": string|null, "total": number|null, "items": [{"description": string, "amount": number}]}\n\n' +
  "Rules:\n" +
  '- "merchant" is the store or restaurant name as printed, null if unreadable\n' +
  '- "total" is the final amount charged including tax and tip, as a plain number with no currency ' +
  "symbol - NOT the subtotal. null if you cannot read it.\n" +
  '- "items" lists each purchased line as printed, with its price as a plain number (the line total ' +
  "if there is a quantity). Do NOT include subtotal, tax, tip, service charge, discount or total lines. " +
  "Use an empty list if you cannot read individual lines.\n" +
  "- The photo may be rotated, tilted, creased or taken at an angle - read it as best you can in " +
  "whatever orientation it appears, but never guess a number you cannot actually see.\n" +
  "- If the image is not a receipt, return null for both.";

function getClient() {
  if (!process.env.COHERE_API_KEY) return null;
  return new CohereClientV2({ token: process.env.COHERE_API_KEY });
}

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

// The model answers in dollars because that is how the receipt is printed;
// convert to cents right here at the boundary, like expenseParsingService.
function sanitizeResult(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const total = numberToCents(Number(parsed.total));
  if (total === null || total <= 0) return null;

  const merchant = typeof parsed.merchant === "string" && parsed.merchant.trim() ? parsed.merchant.trim().slice(0, 100) : null;
  return { merchant, total, items: sanitizeItems(parsed.items, total) };
}

// Bounds how many line items one response can hand the client to render.
const MAX_ITEMS = 60;

// Line items are best-effort: a bad one is dropped rather than failing the
// whole scan, since the total alone is still useful. An item can never cost
// more than the whole bill, which catches the model reading a phone number or
// a date as a price.
function sanitizeItems(rawItems, totalCents) {
  if (!Array.isArray(rawItems)) return [];

  const items = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const amount = numberToCents(Number(raw.amount));
    if (amount === null || amount <= 0 || amount > totalCents) continue;

    const description = typeof raw.description === "string" ? raw.description.trim().slice(0, 100) : "";
    items.push({ description: description || "Item", amount });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

/**
 * @param {Buffer} imageBuffer
 * @param {string} mimeType - already verified from the bytes, not the client
 * @param {{ client?: import("cohere-ai").CohereClientV2 }} [options]
 * @returns {Promise<{merchant: string|null, total: number, items: {description: string, amount: number}[]} | null>}
 *   every amount is integer cents. null means nothing usable could be read.
 */
async function extractReceipt(imageBuffer, mimeType, options = {}) {
  const client = options.client || getClient();
  // Absent, not broken: no key means no receipt scanning, and the form still
  // works by hand.
  if (!client) throw new ApiError(503, "Receipt scanning isn't available right now");

  const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  try {
    const response = await client.chat({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            // "high" rather than the default "auto": a tilted or crumpled receipt is
            // where small print gets lost when the image is downscaled.
            { type: "image_url", imageUrl: { url: dataUri, detail: "high" } },
          ],
        },
      ],
    });
    return sanitizeResult(extractJson(textFromContent(response.message?.content)));
  } catch (err) {
    console.error("Cohere receipt extraction failed:", err.message);
    return null;
  }
}

module.exports = { extractReceipt };
