import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ResetPasswordPage from "./ResetPasswordPage";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderPage(search = "?token=valid-token") {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPasswordPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ResetPasswordPage", () => {
  test("submits the token from the URL with the new password", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resetPassword = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ resetPassword });

    renderPage("?token=abc123");

    await user.type(screen.getByPlaceholderText(/^new password/i), "new-password-123");
    await user.type(screen.getByPlaceholderText(/confirm/i), "new-password-123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith("abc123", "new-password-123"));
    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
  });

  test("rejects mismatched passwords before ever calling the API", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resetPassword = vi.fn();
    useAuth.mockReturnValue({ resetPassword });

    renderPage();

    await user.type(screen.getByPlaceholderText(/^new password/i), "new-password-123");
    await user.type(screen.getByPlaceholderText(/confirm/i), "different-password");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  test("shows an error for an invalid or expired token", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resetPassword = vi.fn().mockRejectedValue({
      response: { data: { error: "This reset link is invalid or has expired" } },
    });
    useAuth.mockReturnValue({ resetPassword });

    renderPage();

    await user.type(screen.getByPlaceholderText(/^new password/i), "new-password-123");
    await user.type(screen.getByPlaceholderText(/confirm/i), "new-password-123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  test("shows a message instead of a form when the URL has no token", () => {
    renderPage("");

    expect(screen.getByText(/missing its reset token/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^new password/i)).not.toBeInTheDocument();
  });
});
