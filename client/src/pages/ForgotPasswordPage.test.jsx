import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ForgotPasswordPage from "./ForgotPasswordPage";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ForgotPasswordPage", () => {
  test("submits the email and shows a generic confirmation message", async () => {
    const user = userEvent.setup();
    const forgotPassword = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ forgotPassword });

    renderPage();

    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(forgotPassword).toHaveBeenCalledWith("alice@example.com");
    expect(await screen.findByText(/alice@example.com/)).toBeInTheDocument();
  });

  // Even an email the server doesn't recognize should show the same
  // confirmation - the backend always responds with success either way, so
  // there's no separate error path to render here for "unknown email".
  test("shows the same confirmation even if the account doesn't exist, since the API never says", async () => {
    const user = userEvent.setup();
    const forgotPassword = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ forgotPassword });

    renderPage();

    await user.type(screen.getByPlaceholderText("Email"), "nobody@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText(/we've sent a link/i)).toBeInTheDocument();
  });

  test("shows an error if the request itself fails", async () => {
    const user = userEvent.setup();
    const forgotPassword = vi.fn().mockRejectedValue({ response: { data: { error: "Server error" } } });
    useAuth.mockReturnValue({ forgotPassword });

    renderPage();

    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });
});
