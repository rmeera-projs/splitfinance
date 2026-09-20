import { useState } from "react";
import api from "../api/client";

// A chat box over the balances/spending assistant (server/src/services/
// assistantService.js). Deliberately thin: this component owns the
// transcript and the input box, and nothing else - it never computes a
// balance or a total itself, only displays whatever the server's tools
// already computed. The server is stateless between requests, so this
// component resends the visible transcript (role/content pairs only) on
// every question; see assistantController.js for why that's safe (capped
// length, tool-call internals never round-trip through the client).
export default function AssistantChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setError("");
    const history = messages.map(({ role, content }) => ({ role, content }));
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const { data } = await api.post("/assistant/ask", { message: text, history });
      setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
    } catch (err) {
      // The failed question stays visible rather than being rolled back -
      // seeing what you asked is what makes "try again" make sense.
      setError(err.response?.data?.error || "Couldn't reach the assistant - try again in a moment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border rounded-lg p-3 flex flex-col gap-3">
      {messages.length === 0 && (
        <p className="text-sm text-gray-500">
          Ask about your balances or spending - e.g. {'"who do I owe the most?"'} or {'"how much did I spend on food this month?"'}
        </p>
      )}

      {messages.length > 0 && (
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {messages.map((m, i) => (
            <li key={i} className={m.role === "user" ? "text-right" : "text-left"}>
              <span
                className={
                  "inline-block rounded-lg px-3 py-1.5 text-sm max-w-[85%] " +
                  (m.role === "user" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-900")
                }
              >
                {m.content}
              </span>
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="text-xs text-gray-500">Thinking…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-1.5 text-sm"
          placeholder="Ask a question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Ask the assistant"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-emerald-600 text-white px-3 rounded text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
