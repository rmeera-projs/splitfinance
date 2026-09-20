import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AssistantChat from "./AssistantChat";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { post: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AssistantChat", () => {
  test("shows a prompt hint before any question is asked", () => {
    render(<AssistantChat />);
    expect(screen.getByText(/ask about your balances or spending/i)).toBeInTheDocument();
  });

  test("sends the question and displays the reply", async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ data: { reply: "You owe Bob $15.00." } });

    render(<AssistantChat />);
    await user.type(screen.getByLabelText("Ask the assistant"), "who do I owe?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("You owe Bob $15.00.")).toBeInTheDocument();
    expect(screen.getByText("who do I owe?")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/assistant/ask", { message: "who do I owe?", history: [] });
  });

  test("sends prior turns as history on a follow-up question", async () => {
    const user = userEvent.setup();
    api.post
      .mockResolvedValueOnce({ data: { reply: "About $40 this month." } })
      .mockResolvedValueOnce({ data: { reply: "Mostly Food & Drink." } });

    render(<AssistantChat />);

    await user.type(screen.getByLabelText("Ask the assistant"), "how much have I spent?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("About $40 this month.");

    await user.type(screen.getByLabelText("Ask the assistant"), "on what?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Mostly Food & Drink.");

    expect(api.post).toHaveBeenLastCalledWith("/assistant/ask", {
      message: "on what?",
      history: [
        { role: "user", content: "how much have I spent?" },
        { role: "assistant", content: "About $40 this month." },
      ],
    });
  });

  test("clears the input after sending", async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ data: { reply: "Sure." } });

    render(<AssistantChat />);
    const input = screen.getByLabelText("Ask the assistant");
    await user.type(input, "hi");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(input).toHaveValue("");
  });

  test("does not submit an empty or whitespace-only question", async () => {
    const user = userEvent.setup();
    render(<AssistantChat />);

    await user.type(screen.getByLabelText("Ask the assistant"), "   ");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(api.post).not.toHaveBeenCalled();
  });

  test("shows the server's error message and keeps the question visible on failure", async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue({
      response: { data: { error: "Confirm your email address to use the AI-powered features." } },
    });

    render(<AssistantChat />);
    await user.type(screen.getByLabelText("Ask the assistant"), "who do I owe?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText(/confirm your email address/i)).toBeInTheDocument();
    expect(screen.getByText("who do I owe?")).toBeInTheDocument();
  });
});
