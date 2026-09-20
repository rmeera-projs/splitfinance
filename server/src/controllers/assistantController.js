const { z } = require("zod");
const { askAssistant } = require("../services/assistantService");
const { requiredText } = require("../utils/validators");

// Capped well above what a real back-and-forth needs, but low enough that a
// client (malicious or buggy) can't hand back an ever-growing transcript and
// turn every request into an ever-larger prompt.
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;

const historyEntrySchema = z.object({
  role: z.enum(["user", "assistant"], { error: "History entries must have role \"user\" or \"assistant\"" }),
  content: z.string().max(MAX_MESSAGE_LENGTH, "Message is too long"),
});

const askSchema = z.object({
  message: requiredText("Message").max(MAX_MESSAGE_LENGTH, "Message is too long"),
  // The client resends the visible transcript on every request rather than
  // the server holding conversation state - consistent with this app
  // having no other server-side session concept beyond the auth cookie
  // itself. Only plain {role, content} pairs are accepted; tool-call
  // internals are never trusted from the client and are reconstructed
  // fresh from scratch inside assistantService on every request.
  history: z.array(historyEntrySchema).max(MAX_HISTORY_MESSAGES, "Conversation is too long - start a new one").optional(),
});

async function ask(req, res, next) {
  try {
    const { message, history } = askSchema.parse(req.body);
    const reply = await askAssistant(req.userId, history || [], message);
    res.json({ reply });
  } catch (err) {
    next(err);
  }
}

module.exports = { ask };
