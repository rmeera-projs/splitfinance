import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VerifyEmailPage from "./VerifyEmailPage";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderPage(search = "?token=abc123") {
  return render(
    <MemoryRouter initialEntries={[`/verify-email${search}`]}>
      <VerifyEmailPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifyEmailPage", () => {
  test("confirms using the token from the URL", async () => {
    const verifyEmail = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ verifyEmail, user: null });

    renderPage("?token=abc123");

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByText(/your address is confirmed/i)).toBeInTheDocument();
  });

  // The token is single-use, so a second call fails. React 18 StrictMode
  // mounts effects twice in development, which without a guard would show
  // an error on a confirmation that had just succeeded.
  test("only ever spends the token once", async () => {
    const verifyEmail = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ verifyEmail, user: null });

    const { rerender } = renderPage("?token=abc123");
    rerender(
      <MemoryRouter initialEntries={["/verify-email?token=abc123"]}>
        <VerifyEmailPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(1));
  });

  test("reports an expired or already-used link", async () => {
    const verifyEmail = vi
      .fn()
      .mockRejectedValue({ response: { data: { error: "This confirmation link is invalid or has expired" } } });
    useAuth.mockReturnValue({ verifyEmail, user: null });

    renderPage();

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  test("says so when the link has no token at all", async () => {
    const verifyEmail = vi.fn();
    useAuth.mockReturnValue({ verifyEmail, user: null });

    renderPage("");

    expect(await screen.findByText(/missing its confirmation token/i)).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  // The page is reachable signed out, because the link is usually opened
  // from a phone - so it has to offer the right way back either way.
  test("sends a signed-out visitor to log in, and a signed-in one to their groups", async () => {
    useAuth.mockReturnValue({ verifyEmail: vi.fn().mockResolvedValue(), user: null });
    const { unmount } = renderPage();
    expect(await screen.findByRole("link", { name: /go to log in/i })).toBeInTheDocument();
    unmount();

    useAuth.mockReturnValue({ verifyEmail: vi.fn().mockResolvedValue(), user: { id: 1, name: "Alice" } });
    renderPage();
    expect(await screen.findByRole("link", { name: /back to your groups/i })).toBeInTheDocument();
  });
});
